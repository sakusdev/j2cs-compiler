import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ROOT } from '../../compiler/index.js';
import { CompileError } from '../../compiler/diagnostics/index.js';
import { inspectArrowFunctions } from '../../compiler/parser/arrow.js';
import { assertArrowContextSupported, ARROW_RULE_SHA256, proveArrowRule, type ArrowContext } from '../../compiler/analysis/arrow.js';
import { loadRules } from '../../compiler/rules/loader.js';

const database = await loadRules(path.join(ROOT, 'rule-db'));
const baseContext: ArrowContext = {
  enclosingThisStaticallyRepresented: true,
  enclosingArgumentsBindingKnown: true,
  enclosingNewTargetKnown: false,
  dynamicScope: false,
  identityObserved: false,
  propertiesObserved: false,
  targetStaticallyKnownArrow: true,
  constructionAttempt: false,
};

test('arrow syntax contract is AST-first and records lexical meta-bindings', () => {
  const arrows = inspectArrowFunctions(`
    function outer(x) {
      const a = (y) => this;
      const b = () => arguments[0];
      const c = () => new.target;
      const d = z => z + x;
    }
  `);
  assert.equal(arrows.length, 4);
  assert.deepEqual(arrows.map(a => [a.parameters.length, a.bodyKind, a.usesLexicalThis,
    a.usesLexicalArguments, a.usesLexicalNewTarget]), [
    [1, 'expression', true, false, false],
    [0, 'expression', false, true, false],
    [0, 'expression', false, false, true],
    [1, 'expression', false, false, false],
  ]);
});

test('canonical arrow rule adapters are pinned by complete normalized SHA256', () => {
  for (const [ruleId, sha] of Object.entries(ARROW_RULE_SHA256)) {
    const loaded = database.byId.get(ruleId);
    assert.ok(loaded, `missing canonical rule ${ruleId}`);
    assert.equal(loaded.sha256, sha, `canonical rule fingerprint drift for ${ruleId}`);
  }
});

test('lexical this proof is enabled only with enclosing representation and unobserved function identity/properties', () => {
  const syntax = inspectArrowFunctions('function outer(){ return () => this; }')[0]!;
  const proof = proveArrowRule(database, 'function.arrow.lexical-this', syntax, baseContext);
  assert.equal(proof.verdict, 'proven');

  const noOuter = proveArrowRule(database, 'function.arrow.lexical-this', syntax,
    { ...baseContext, enclosingThisStaticallyRepresented: false });
  assert.equal(noOuter.verdict, 'disproven');

  const escaped = proveArrowRule(database, 'function.arrow.lexical-this', syntax,
    { ...baseContext, identityObserved: true });
  assert.equal(escaped.verdict, 'disproven');
});

test('lexical arguments proof requires the enclosing arguments binding and static scope', () => {
  const syntax = inspectArrowFunctions('function outer(){ return () => arguments[0]; }')[0]!;
  assert.equal(proveArrowRule(database, 'function.arrow.lexical-arguments', syntax, baseContext).verdict, 'proven');
  assert.equal(proveArrowRule(database, 'function.arrow.lexical-arguments', syntax,
    { ...baseContext, enclosingArgumentsBindingKnown: false }).verdict, 'disproven');
  assert.equal(proveArrowRule(database, 'function.arrow.lexical-arguments', syntax,
    { ...baseContext, dynamicScope: true }).verdict, 'disproven');
});

test('known arrow construction selects the canonical non-constructable proof', () => {
  const syntax = inspectArrowFunctions('const f = () => 1;')[0]!;
  const proof = proveArrowRule(database, 'function.arrow.not-constructable', syntax,
    { ...baseContext, constructionAttempt: true });
  assert.equal(proof.verdict, 'proven');
});

test('new.target remains fail-closed until a canonical arrow lexical new.target rule and constructor lane exist', () => {
  const syntax = inspectArrowFunctions('function F(){ return () => new.target; }')[0]!;
  assert.throws(() => assertArrowContextSupported(database, syntax,
    { ...baseContext, enclosingNewTargetKnown: true }), (error: unknown) =>
      error instanceof CompileError && error.diagnostic.code === 'E_ARROW_NEW_TARGET_RULE_MISSING');
});

test('unsupported adjacent arrow forms get explicit diagnostics', () => {
  assert.throws(() => inspectArrowFunctions('const f = async () => 1;'), (error: unknown) =>
    error instanceof CompileError && error.diagnostic.code === 'E_ARROW_ASYNC_DEPENDENCY');
  assert.throws(() => inspectArrowFunctions('const f = (x = 1) => x;'), (error: unknown) =>
    error instanceof CompileError && error.diagnostic.code === 'E_ARROW_PARAMETER_SHAPE');
  assert.throws(() => inspectArrowFunctions('const f = (...x) => x;'), (error: unknown) =>
    error instanceof CompileError && error.diagnostic.code === 'E_ARROW_PARAMETER_SHAPE');
});
