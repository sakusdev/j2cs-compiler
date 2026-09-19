import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { analyzeBundle, proveBundleRuleContractsFromRoot } from '../../compiler/bundles/index.js';

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
