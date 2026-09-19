import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ROOT } from '../../compiler/index.js';
import { promiseFacts } from '../../compiler/analysis/async.js';
import { loadRules, type RuleDatabase } from '../../compiler/rules/loader.js';
import { PROMISE_CORE_CONTRACTS, provePromiseCoreRule, validatePromiseCoreContracts } from '../../compiler/rules/promise.js';

const database = await loadRules(path.join(ROOT, 'rule-db'));

test('Promise core adapters pin canonical j2cs rules and helper contracts', () => {
  validatePromiseCoreContracts(database);
  assert.deepEqual(PROMISE_CORE_CONTRACTS.map(c => c.ruleId), [
    'async.promise.constructor',
    'async.promise.resolve',
    'async.promise.reject',
    'async.promise.then',
    'async.promise.catch',
    'async.promise.finally',
  ]);
});

test('Promise constructor proof requires intrinsic/pristine/callable evidence', () => {
  const proven = promiseFacts({ intrinsicConstructor: true, constructorPristine: true, executorCallable: true });
  assert.equal(provePromiseCoreRule(database, 'async.promise.constructor', proven).verdict, 'proven');

  const missingCallable = promiseFacts({ intrinsicConstructor: true, constructorPristine: true });
  assert.equal(provePromiseCoreRule(database, 'async.promise.constructor', missingCallable).verdict, 'unknown');
});

test('Promise static and reaction helpers fail closed without exact method/receiver/species proof', () => {
  const staticFacts = promiseFacts({ intrinsicConstructor: true, pristineMethods: ['resolve', 'reject'] });
  assert.equal(provePromiseCoreRule(database, 'async.promise.resolve', staticFacts).verdict, 'proven');
  assert.equal(provePromiseCoreRule(database, 'async.promise.reject', staticFacts).verdict, 'proven');

  const chainFacts = promiseFacts({
    receiverRepresentation: 'JsPromise',
    pristineMethods: ['then', 'catch', 'finally'],
    intrinsicSpecies: true,
  });
  for (const id of ['async.promise.then', 'async.promise.catch', 'async.promise.finally'])
    assert.equal(provePromiseCoreRule(database, id, chainFacts).verdict, 'proven');

  assert.equal(provePromiseCoreRule(database, 'async.promise.then',
    promiseFacts({ receiverRepresentation: 'JsPromise', pristineMethods: ['then'] })).verdict, 'unknown');
  assert.equal(provePromiseCoreRule(database, 'async.promise.catch',
    promiseFacts({ receiverRepresentation: 'JsPromise', pristineMethods: ['catch'], intrinsicSpecies: true })).verdict, 'unknown');
});

test('Promise adapter rejects a changed upstream rule fingerprint', () => {
  const original = database.byId.get('async.promise.resolve')!;
  const changed: RuleDatabase = {
    byId: new Map(database.byId),
    byCategory: database.byCategory,
    byStrategy: database.byStrategy,
  };
  changed.byId.set(original.rule.id, { ...original, sha256: 'changed' });
  assert.throws(() => validatePromiseCoreContracts(changed), /changed/);
});
