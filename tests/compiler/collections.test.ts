import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Facts } from '../../compiler/analysis/facts.js';
import { compile, createCompiler } from '../../compiler/index.js';
import { CompileError } from '../../compiler/diagnostics/index.js';
import { loadRules } from '../../compiler/rules/loader.js';
import {
  CollectionFact,
  loadCollectionAdapters,
  proveCollectionOperation,
  proveCollectionRule,
  verifyCollectionAdapters,
  type CollectionKind,
} from '../../compiler/rules/collections.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const database = await loadRules(path.join(root, 'rule-db'));
const registry = await loadCollectionAdapters(path.join(root, 'compiler/rules/collections-adapters.json'));

function kindFor(lowering: string): CollectionKind {
  if (lowering.startsWith('weakmap.')) return 'WeakMap';
  if (lowering.startsWith('weakset.')) return 'WeakSet';
  if (lowering.startsWith('map.')) return 'Map';
  if (lowering.startsWith('set.')) return 'Set';
  throw new Error(`Unknown collection lowering ${lowering}`);
}

function constructorFacts(kind: CollectionKind): Facts {
  return new Facts()
    .prove(CollectionFact.globalIntrinsic, kind, `binder proved intrinsic ${kind} global`)
    .prove(CollectionFact.newTarget, kind, `new-target analysis proved builtin ${kind}`);
}

function receiverFacts(kind: CollectionKind): Facts {
  return new Facts()
    .prove(CollectionFact.receiverKind, kind, `flow analysis proved builtin ${kind} receiver`)
    .prove(CollectionFact.memberIntegrity, 'pristine', 'closed profile proved builtin member integrity')
    .prove(CollectionFact.receiverProxy, false, 'compiler-owned collection cannot be Proxy')
    .prove(CollectionFact.sizeAccessorIntegrity, 'pristine', 'builtin size accessor is pristine')
    .prove(CollectionFact.symbolIteratorIntegrity, 'pristine', 'builtin Symbol.iterator is pristine');
}

test('collection registry pins reviewed canonical j2cs rules and every adapted requirement is provable', () => {
  assert.equal(registry.ruleDbCommit, '35ca8d859f9352e90ee2497f4ac8f6edb9c19ed1');
  assert.equal(registry.adapters.length, 30);
  verifyCollectionAdapters(database, registry);

  for (const adapter of registry.adapters) {
    const kind = kindFor(adapter.lowering);
    const facts = adapter.lowering.endsWith('.create') ? constructorFacts(kind) : receiverFacts(kind);
    const proof = proveCollectionRule(database, adapter, facts);
    assert.equal(proof.verdict, 'proven', `${adapter.ruleId}: ${JSON.stringify(proof.checks)}`);
    assert.equal(proof.loaded.sha256, adapter.sha256);
    assert.equal(proof.loaded.rule.strategy, adapter.strategy);
  }
});

test('collection rule proof fails closed on missing, conflicting, proxy and iterator evidence', () => {
  const missingIntegrity = new Facts()
    .prove(CollectionFact.receiverKind, 'Map', 'receiver proof')
    .prove(CollectionFact.receiverProxy, false, 'closed profile');
  assert.equal(proveCollectionOperation(database, registry, 'map.set', missingIntegrity)?.verdict, 'unknown');

  const proxy = receiverFacts('Map').prove(CollectionFact.receiverProxy, true, 'explicit proxy receiver');
  assert.equal(proveCollectionOperation(database, registry, 'map.get', proxy)?.verdict, 'disproven');

  const wrongKind = receiverFacts('Set');
  assert.equal(proveCollectionOperation(database, registry, 'map.has', wrongKind)?.verdict, 'disproven');

  const noSizeProof = receiverFacts('Set');
  noSizeProof.delete(CollectionFact.sizeAccessorIntegrity);
  assert.equal(proveCollectionOperation(database, registry, 'set.size', noSizeProof)?.verdict, 'unknown');

  const noIteratorProof = receiverFacts('Map');
  noIteratorProof.delete(CollectionFact.symbolIteratorIntegrity);
  assert.equal(proveCollectionOperation(database, registry, 'map.iterator', noIteratorProof)?.verdict, 'unknown');
});

test('unowned iterable/forEach syntax stays outside the adapter registry and source compilation fails closed', async () => {
  for (const lowering of ['map.foreach', 'set.foreach', 'map.constructIterable', 'set.constructIterable'])
    assert.equal(proveCollectionOperation(database, registry, lowering, new Facts()), undefined);

  const compiler = await createCompiler();
  assert.throws(
    () => compile('const m = new Map();', compiler, 'collections-not-wired.js'),
    error => error instanceof CompileError && error.diagnostic.code === 'E_UNSUPPORTED_SYNTAX',
  );
});
