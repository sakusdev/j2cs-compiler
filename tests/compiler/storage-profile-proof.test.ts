import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ROOT, compile, createCompiler } from '../../compiler/index.js';
import { loadRules } from '../../compiler/rules/loader.js';
import {
  STORAGE_PROFILE_RULE_CONTRACTS,
  proveStorageProfileRule,
  type StorageProfileProofFacts,
} from '../../compiler/rules/storage-profile-proof.js';

const completeFacts: StorageProfileProofFacts = {
  windowReceiver: { value: 'Window', evidence: 'renderer analysis resolved the intrinsic Window receiver' },
  storageReceiver: { value: 'Storage', evidence: 'receiver identity is a host Web Storage object' },
  webStorageBackend: { value: 'native', evidence: 'browser host owns storage mutation/event semantics' },
  webMemberIntegrity: { value: 'pristine', evidence: 'reviewed Web API member identity is pristine' },
  electronBinding: { value: 'proven', evidence: 'module resolver proved the Electron binding' },
  electronMemberIntegrity: { value: 'pristine', evidence: 'reviewed Electron member identity is pristine' },
  mainProcess: { value: 'main', evidence: 'host role is Electron main process' },
  appReady: { value: 'ready', evidence: 'Electron app-ready lifecycle proof is present' },
  indexedDbIntrinsic: { value: 'proven', evidence: 'renderer host proved intrinsic indexedDB identity' },
  cacheStorageIntrinsic: { value: 'proven', evidence: 'renderer host proved intrinsic CacheStorage identity' },
  storagePartitioning: { value: 'observable', evidence: 'host preserves storage-key partition boundaries' },
  secureContext: { value: 'secure', evidence: 'renderer origin is a proven secure context' },
};

test('storage/profile proof bridge pins the reviewed canonical j2cs rules', async () => {
  const db = await loadRules(path.join(ROOT, 'rule-db'));
  assert.equal(STORAGE_PROFILE_RULE_CONTRACTS.length, 15);
  for (const contract of STORAGE_PROFILE_RULE_CONTRACTS) {
    const proof = proveStorageProfileRule(db, contract.id, completeFacts);
    assert.equal(proof.verdict, 'proven', contract.id);
    assert.ok(proof.evidence.length >= 1, contract.id);
  }
});

test('storage/profile proof stays unknown or disproven for unsafe host evidence', async () => {
  const db = await loadRules(path.join(ROOT, 'rule-db'));
  assert.equal(proveStorageProfileRule(db, 'dom.storage.set-item', {
    storageReceiver: completeFacts.storageReceiver,
    webMemberIntegrity: completeFacts.webMemberIntegrity,
  }).verdict, 'unknown');

  assert.equal(proveStorageProfileRule(db, 'electron.session.from-partition', {
    electronBinding: completeFacts.electronBinding,
    electronMemberIntegrity: completeFacts.electronMemberIntegrity,
    mainProcess: { value: 'renderer', evidence: 'renderer role cannot claim the main-process helper' },
    appReady: completeFacts.appReady,
  }).verdict, 'disproven');

  assert.equal(proveStorageProfileRule(db, 'web.caches.storage-key-boundary', {
    storagePartitioning: { value: 'collapsed', evidence: 'candidate backend would merge distinct storage keys' },
  }).verdict, 'disproven');

  assert.equal(proveStorageProfileRule(db, 'web.caches.open', {
    cacheStorageIntrinsic: completeFacts.cacheStorageIntrinsic,
    webMemberIntegrity: completeFacts.webMemberIntegrity,
    secureContext: { value: 'insecure', evidence: 'origin is not a secure context' },
  }).verdict, 'disproven');
});

test('canonical storage rule drift cannot silently reuse a reviewed adapter', async () => {
  const db = await loadRules(path.join(ROOT, 'rule-db'));
  const id = 'electron.session.from-partition';
  const loaded = db.byId.get(id)!;
  const changed = { ...db, byId: new Map(db.byId).set(id, { ...loaded, sha256: '0'.repeat(64) }) };
  assert.throws(() => proveStorageProfileRule(changed, id, completeFacts), /changed/);
});

test('source-level Web Storage syntax remains fail-closed until sibling renderer wiring lands', async () => {
  const index = await createCompiler();
  assert.throws(
    () => compile("const x = localStorage.getItem('x'); console.log(x);", index),
    /localStorage|unsupported|unresolved/i
  );
});
