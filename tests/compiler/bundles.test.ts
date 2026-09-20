import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { Facts } from '../../compiler/analysis/facts.js';
import {
  analyzeBundle,
  bundleFactsFromAnalysis,
  proveBundleRuleContractsFromRoot,
  proveBundleRuleRequirementsFromRoot,
} from '../../compiler/bundles/index.js';

test('bundle analyzer recognizes minified webpack-like chunks and source-map provenance', () => {
  const source = `
    (self.x=self.x||[]).push([[17],{2:(a,b,c)=>{b.v=1},9:function(a,b){b.x=2}}]);
    //# sourceMappingURL=assets/app.abc123.js.map
  `;
  const result = analyzeBundle(source, { host: 'electron-renderer' });
  assert.ok(result.flavors.includes('webpack-chunk'));
  assert.deepEqual(result.webpackChunks[0]?.chunkIds, ['17']);
  assert.equal(result.webpackChunks[0]?.moduleFactoryCount, 2);
  assert.equal(result.sourceMap?.url, 'assets/app.abc123.js.map');
  assert.ok(result.requiredRuleIds.includes('modules.esm.evaluate-once'));
  assert.ok(result.deferredCapabilities.includes('module-factory-lowering'));
  assert.equal(result.canExecuteWithoutSiblingIntegration, false);
});

test('bundle analyzer connects React tags, Object.assign and preload-like dynamic imports to canonical rules', () => {
  const source = `
    const tag = Symbol.for('react.element');
    const props = Object.assign({}, {a:1});
    const preload=(loader,deps)=>Promise.resolve().then(loader);
    preload(()=>import('./lazy.js'), ['assets/lazy.js']);
    export {tag,props};
  `;
  const result = analyzeBundle(source, { host: 'node' });
  assert.ok(result.flavors.includes('vite-preload'));
  assert.ok(result.flavors.includes('esm-code-split'));
  assert.deepEqual(result.reactRegisteredSymbols, ['react.element']);
  assert.deepEqual(result.preloads[0]?.dependencies, ['assets/lazy.js']);
  for (const id of [
    'modules.esm.evaluate-once',
    'modules.esm.dependency-evaluation-order',
    'node.module-resolution.dynamic-import',
    'async.promise.then',
    'async.promise.resolve',
    'symbol.for.primitive-key',
    'object.assign',
  ]) assert.ok(result.requiredRuleIds.includes(id), `missing proof edge ${id}`);
});

test('bundle analyzer fails closed when intrinsic proof or deterministic chunk identity is unavailable', () => {
  const result = analyzeBundle(`
    const Symbol = {for:x=>x};
    Symbol.for('react.element');
    const id = 7;
    (globalThis.q=globalThis.q||[]).push([[id],{1:(m,e)=>{}}]);
    eval('1+1');
  `);
  assert.ok(result.diagnostics.some(d => d.code === 'BUNDLE_REACT_SYMBOL_SHADOWED' && d.severity === 'error'));
  assert.ok(result.diagnostics.some(d => d.code === 'BUNDLE_WEBPACK_DYNAMIC_CHUNK_ID' && d.severity === 'error'));
  assert.ok(result.diagnostics.some(d => d.code === 'BUNDLE_DYNAMIC_CODE' && d.severity === 'error'));
  assert.equal(result.canExecuteWithoutSiblingIntegration, false);
});

test('bundle canonical proof registry pins complete upstream rule SHA256 values', async () => {
  const requested = [
    'modules.esm.evaluate-once',
    'modules.esm.dependency-evaluation-order',
    'node.module-resolution.dynamic-import',
    'async.promise.then',
    'async.promise.resolve',
    'symbol.for.primitive-key',
    'object.assign',
  ];
  const proofs = await proveBundleRuleContractsFromRoot(path.resolve('rule-db'), requested);
  assert.equal(proofs.length, requested.length);
  for (const proof of proofs) {
    assert.equal(proof.verdict, 'proven', `${proof.contract.ruleId}: ${proof.evidence.join('; ')}`);
    assert.match(proof.contract.sha256, /^[0-9a-f]{64}$/);
  }
});


test('bundle semantic proof connects every reviewed canonical requirement to explicit facts', async () => {
  const requested = [
    'modules.esm.evaluate-once',
    'modules.esm.dependency-evaluation-order',
    'node.module-resolution.dynamic-import',
    'async.promise.then',
    'async.promise.resolve',
    'symbol.for.primitive-key',
    'object.assign',
  ];
  const facts = new Facts()
    .prove('bundle.sourceType', 'ECMAScript module', 'test module parse proof')
    .prove('bundle.moduleGraphLinked', true, 'test linker graph proof')
    .prove('profile.host', 'Node.js', 'test host profile proof')
    .prove('bundle.dynamicSpecifierAllowed', true, 'test dynamic import proof')
    .prove('bundle.promise.receiver', 'intrinsic Promise', 'test Promise representation proof')
    .prove('bundle.promise.thenIntegrity', 'pristine', 'test Promise.then integrity proof')
    .prove('bundle.promise.species', 'intrinsic Promise', 'test Promise species proof')
    .prove('bundle.promise.constructor', 'intrinsic Promise', 'test Promise constructor proof')
    .prove('bundle.promise.resolveIntegrity', 'pristine', 'test Promise.resolve integrity proof')
    .prove('bundle.symbol.binding', '%Symbol%', 'test intrinsic Symbol proof')
    .prove('bundle.symbol.forIntegrity', 'Symbol.for', 'test Symbol.for integrity proof')
    .prove('bundle.symbol.keyDomain', 'primitive', 'test primitive symbol key proof')
    .prove('bundle.object.assignIntegrity', 'pristine', 'test Object.assign integrity proof');

  const proofs = await proveBundleRuleRequirementsFromRoot(path.resolve('rule-db'), requested, facts);
  assert.equal(proofs.length, requested.length);
  for (const proof of proofs) {
    assert.equal(proof.verdict, 'proven', `${proof.ruleId}: ${proof.evidence.join('; ')}`);
    assert.ok(proof.checks.length > 0, `${proof.ruleId} did not expose canonical source requirements`);
  }
});

test('bundle scanner facts stay fail-closed for mutable builtin integrity', async () => {
  const analysis = analyzeBundle(`
    export const load = () => import('./lazy.js');
    const tag = Symbol.for('react.element');
    const copy = Object.assign({}, {a:1});
  `, { host: 'node' });
  const facts = bundleFactsFromAnalysis(analysis);
  const proofs = await proveBundleRuleRequirementsFromRoot(path.resolve('rule-db'), [
    'modules.esm.evaluate-once',
    'node.module-resolution.dynamic-import',
    'symbol.for.primitive-key',
    'object.assign',
  ], facts);
  const byId = new Map(proofs.map(proof => [proof.ruleId, proof]));
  assert.equal(byId.get('modules.esm.evaluate-once')?.verdict, 'proven');
  assert.equal(byId.get('node.module-resolution.dynamic-import')?.verdict, 'proven');
  assert.equal(byId.get('symbol.for.primitive-key')?.verdict, 'unknown');
  assert.equal(byId.get('object.assign')?.verdict, 'unknown');
});
