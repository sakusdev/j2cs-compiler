import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ROOT } from '../../compiler/index.js';
import { loadRules } from '../../compiler/rules/loader.js';
import {
  MODULE_RULE_CONTRACTS, linkModuleGraph, moduleFacts, normalizeModule, proveModuleRule,
  reviewModuleRuleContracts, ModuleLinkError,
} from '../../compiler/modules/index.js';

const ruleDb = async () => loadRules(path.join(ROOT, 'rule-db'));

test('module parser normalizes imports, local/indirect/star exports, default form, and top-level this', () => {
  const ir = normalizeModule(`
    import d, { x as y } from './a.mjs';
    import * as ns from './b.mjs';
    import './side.mjs';
    const local = 1;
    export { local as alias };
    export { x as rx } from './a.mjs';
    export * from './b.mjs';
    export * as bns from './b.mjs';
    export default local;
    console.log(this);
  `, './main.mjs');
  assert.deepEqual(ir.imports.map(i => [i.importName, i.localName]), [
    ['default', 'd'], ['x', 'y'], ['*namespace*', 'ns'],
  ]);
  assert.deepEqual(ir.sideEffectImports.map(i => i.specifier), ['./side.mjs']);
  assert.deepEqual(ir.localExports.filter(e => e.exportName !== 'default').map(e => [e.localName, e.exportName]), [['local', 'alias']]);
  assert.deepEqual(ir.indirectExports.map(e => [e.importName, e.exportName]), [['x', 'rx'], ['*namespace*', 'bns']]);
  assert.deepEqual(ir.starExports.map(e => e.specifier), ['./b.mjs']);
  assert.equal(ir.defaultExport?.form, 'expression');
  assert.equal(ir.topLevelThis, true);
});

test('dynamic import and top-level await remain explicitly fail-closed in the static ESM lane', () => {
  assert.throws(() => normalizeModule(`export const x = import('./x.mjs')`, './a.mjs'), /dynamic import/);
  assert.throws(() => normalizeModule(`export const x = await Promise.resolve(1)`, './a.mjs'), /top-level await/);
});

test('all module adapters pin the canonical j2cs rule content and unknown proof facts fail closed', async () => {
  const db = await ruleDb();
  assert.equal(MODULE_RULE_CONTRACTS.length, 20);
  reviewModuleRuleContracts(db);
  const proven = proveModuleRule(db, 'modules.esm.named-import-live-binding', moduleFacts({
    source_type: 'ECMAScript module', module_request_statically_resolved: true,
  }, 'test linker'));
  assert.equal(proven.verdict, 'proven');
  const unknown = proveModuleRule(db, 'modules.esm.named-import-live-binding', moduleFacts({
    source_type: 'ECMAScript module',
  }, 'missing resolution proof'));
  assert.equal(unknown.verdict, 'unknown');
});

test('named imports and export aliases resolve to the same live binding identity', async () => {
  const db = await ruleDb();
  const a = normalizeModule(`export let x = 1; export { x as y };`, './a.mjs');
  const main = normalizeModule(`import { x, y as alias } from './a.mjs';`, './main.mjs');
  const linked = linkModuleGraph([a, main], './main.mjs', db);
  const imports = linked.modules.get('./main.mjs')!.imports;
  assert.deepEqual(imports.get('x'), { kind: 'binding', target: { module: './a.mjs', binding: 'x' } });
  assert.deepEqual(imports.get('alias'), { kind: 'binding', target: { module: './a.mjs', binding: 'x' } });
  assert.deepEqual(linked.evaluationOrder, ['./a.mjs', './main.mjs']);
  assert.ok(linked.trace.some(t => t.ruleId === 'modules.esm.named-import-live-binding' && t.verdict === 'proven'));
  assert.ok(linked.trace.some(t => t.ruleId === 'modules.esm.export-alias-live-binding' && t.verdict === 'proven'));
});

test('export default expression is a separate captured binding, not a live alias of the identifier expression', async () => {
  const db = await ruleDb();
  const a = normalizeModule(`let x = 1; export { x }; export default x;`, './a.mjs');
  const main = normalizeModule(`import value, { x } from './a.mjs';`, './main.mjs');
  const linked = linkModuleGraph([a, main], './main.mjs', db);
  const imports = linked.modules.get('./main.mjs')!.imports;
  const captured = imports.get('value');
  const live = imports.get('x');
  assert.equal(captured?.kind, 'binding');
  assert.equal(live?.kind, 'binding');
  if (captured?.kind === 'binding' && live?.kind === 'binding')
    assert.notEqual(captured.target.binding, live.target.binding);
  assert.ok(linked.trace.some(t => t.ruleId === 'modules.esm.default-export-expression' && t.verdict === 'proven'));
  assert.ok(linked.trace.some(t => t.ruleId === 'modules.esm.default-import-live-binding' && t.verdict === 'proven'));
});

test('star export ambiguity is omitted from namespace keys and rejects a named import', async () => {
  const db = await ruleDb();
  const a = normalizeModule(`export const x = 1; export const z = 3;`, './a.mjs');
  const b = normalizeModule(`export const x = 2; export const a = 4;`, './b.mjs');
  const mid = normalizeModule(`export * from './a.mjs'; export * from './b.mjs';`, './mid.mjs');
  const nsMain = normalizeModule(`import * as ns from './mid.mjs';`, './main.mjs');
  const namespace = linkModuleGraph([a, b, mid, nsMain], './main.mjs', db);
  assert.deepEqual(namespace.modules.get('./mid.mjs')!.exportNames, ['a', 'z']);

  const namedMain = normalizeModule(`import { x } from './mid.mjs';`, './named.mjs');
  assert.throws(() => linkModuleGraph([a, b, mid, namedMain], './named.mjs', db), (error: unknown) =>
    error instanceof ModuleLinkError
      && error.code === 'E_MODULE_AMBIGUOUS_EXPORT'
      && error.ruleId === 'modules.esm.ambiguous-star-export-link-error');
});

test('missing named export is a canonical link-phase failure, not undefined', async () => {
  const db = await ruleDb();
  const a = normalizeModule(`export const x = 1;`, './a.mjs');
  const main = normalizeModule(`import { y } from './a.mjs';`, './main.mjs');
  assert.throws(() => linkModuleGraph([a, main], './main.mjs', db), (error: unknown) =>
    error instanceof ModuleLinkError
      && error.code === 'E_MODULE_MISSING_EXPORT'
      && error.ruleId === 'modules.esm.missing-export-link-error');
});

test('cycles are retained in the graph proof while evaluation order remains finite and evaluate-once', async () => {
  const db = await ruleDb();
  const a = normalizeModule(`import { b } from './b.mjs'; export const a = 1;`, './a.mjs');
  const b = normalizeModule(`import { a } from './a.mjs'; export const b = 2;`, './b.mjs');
  const main = normalizeModule(`import './a.mjs';`, './main.mjs');
  const linked = linkModuleGraph([a, b, main], './main.mjs', db);
  assert.equal(linked.cycles.length, 1);
  assert.deepEqual(new Set(linked.evaluationOrder), new Set(['./a.mjs', './b.mjs', './main.mjs']));
  assert.equal(linked.evaluationOrder.length, 3);
  assert.ok(linked.trace.some(t => t.ruleId === 'modules.esm.cycle-tdz' && t.verdict === 'proven'));
  assert.ok(linked.trace.some(t => t.ruleId === 'modules.esm.evaluate-once' && t.verdict === 'proven'));
});
