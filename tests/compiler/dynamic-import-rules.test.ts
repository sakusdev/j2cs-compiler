import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../../compiler/parser/index.js';
import { CompileError } from '../../compiler/diagnostics/index.js';
import { Facts } from '../../compiler/analysis/facts.js';
import {
  DynamicModuleRuleIndex,
  createDynamicModuleRuleIndex,
  dynamicImportFacts,
  topLevelAwaitFacts,
} from '../../compiler/modules/dynamic-import-rules.js';

const index = await createDynamicModuleRuleIndex();

test('dynamic import and top-level await are SHA-pinned to canonical j2cs runtime rules', () => {
  const dynamicImport = index.prove('dynamic-import', dynamicImportFacts());
  assert.equal(dynamicImport.loaded.rule.id, 'node.module-resolution.dynamic-import');
  assert.equal(dynamicImport.loaded.sha256, 'ecd244773ad89c9e61ae923cdf4f8d37326ac376bc864880bffd6b432172bea4');
  assert.equal(dynamicImport.loaded.rule.strategy, 'runtime');
  assert.equal(dynamicImport.adapter.lowering, 'JsDynamicModuleRuntime.DynamicImport');
  assert.equal(dynamicImport.proof.verdict, 'proven');

  const tla = index.prove('top-level-await', topLevelAwaitFacts());
  assert.equal(tla.loaded.rule.id, 'async.top-level-await');
  assert.equal(tla.loaded.sha256, '25e90cdbefb3ec887048ff039e0d6334fdefe76401d5381feb8292e83f4b2f36');
  assert.equal(tla.loaded.rule.strategy, 'runtime');
  assert.equal(tla.adapter.lowering, 'JsDynamicModuleRuntime.EvaluateWithTopLevelAwait');
  assert.equal(tla.proof.verdict, 'proven');
});

test('dynamic-module proof requirements fail closed without exact evidence', () => {
  const wrongHost = new Facts()
    .prove('profile.host', 'Browser', 'fixture host')
    .prove('module.specifierMayBeDynamic', true, 'fixture dynamic specifier');
  assert.equal(index.prove('dynamic-import', wrongHost).proof.verdict, 'disproven');

  const missingSpecifierProof = new Facts().prove('profile.host', 'Node.js', 'fixture host');
  assert.equal(index.prove('dynamic-import', missingSpecifierProof).proof.verdict, 'unknown');

  const missingLocation = new Facts().prove(
    'module.sourceType', 'ECMAScript module', 'fixture source type');
  assert.equal(index.prove('top-level-await', missingLocation).proof.verdict, 'unknown');
});

test('changed canonical rule content cannot silently reuse a dynamic-module adapter', () => {
  const canonical = index.adapters[0]!;
  const tampered = { ...canonical, sha256: '0'.repeat(64) };
  assert.throws(() => new DynamicModuleRuleIndex(index.database, [tampered]), (error: unknown) => {
    assert.ok(error instanceof CompileError);
    assert.equal(error.diagnostic.code, 'E_MODULE_RULE_CONTRACT');
    return true;
  });
});

for (const [name, source] of [
  ['dynamic import', "import('./dep.mjs');"],
  ['top-level await', 'await 1;'],
  ['static import', "import './dep.mjs';"],
] as const) {
  test(`unmerged language integration remains fail-closed: ${name}`, () => {
    assert.throws(() => parse(source, 'entry.mjs'), (error: unknown) => {
      assert.ok(error instanceof CompileError);
      assert.equal(error.diagnostic.code, 'E_UNSUPPORTED_SYNTAX');
      return true;
    });
  });
}
