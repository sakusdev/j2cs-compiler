import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadRules } from '../../compiler/rules/loader.js';
import {
  MEDIA_COMPILER_BOUNDARY,
  MEDIA_FAIL_CLOSED_SURFACES,
  MEDIA_RULE_CONTRACTS,
  mediaPromiseFacts,
  proveMediaRule,
  proveMediaRulesFromRoot,
} from '../../compiler/web/media.js';

test('media canonical dependency pins the reviewed Promise.resolve rule', async () => {
  const facts = mediaPromiseFacts({ intrinsicPromiseConstructor: true, pristinePromiseResolve: true });
  const proofs = await proveMediaRulesFromRoot(path.resolve('rule-db'), facts);
  assert.equal(proofs.length, 1);
  const proof = proofs[0]!;
  assert.equal(proof.contract.ruleId, 'async.promise.resolve');
  assert.equal(proof.verdict, 'proven', proof.evidence.join('; '));
  assert.match(proof.contract.sha256, /^[0-9a-f]{64}$/);
  assert.equal(proof.checks.length, 2, 'every canonical source requirement must have an explicit proof check');
  assert.deepEqual(proof.checks.map(check => check.key).sort(), ['constructor', 'method_not_overridden']);
});

test('media Promise proof remains fail-closed when mutable intrinsic integrity is not proven', async () => {
  const facts = mediaPromiseFacts({ intrinsicPromiseConstructor: true });
  const [proof] = await proveMediaRulesFromRoot(path.resolve('rule-db'), facts);
  assert.equal(proof?.verdict, 'unknown');
  assert.equal(proof?.checks.find(check => check.key === 'constructor')?.verdict, 'proven');
  assert.equal(proof?.checks.find(check => check.key === 'method_not_overridden')?.verdict, 'unknown');
});

test('unreviewed media source rules are not synthesized from nearby web semantics', async () => {
  const database = await loadRules(path.resolve('rule-db'));
  const proof = proveMediaRule(database, 'web.media.get-user-media', mediaPromiseFacts({
    intrinsicPromiseConstructor: true,
    pristinePromiseResolve: true,
  }));
  assert.equal(proof.verdict, 'missing');
  assert.equal(proof.checks.length, 0);
  assert.match(proof.evidence.join(' '), /No reviewed media dependency contract/);
});

test('media source integration documents an explicit fail-closed compiler boundary', () => {
  assert.equal(MEDIA_COMPILER_BOUNDARY.sourceLowering, 'fail-closed');
  assert.equal(MEDIA_COMPILER_BOUNDARY.canonicalMediaRules, 'absent-in-pinned-rule-db');
  assert.equal(MEDIA_COMPILER_BOUNDARY.runtimeContract, 'available');
  assert.equal(MEDIA_RULE_CONTRACTS.length, 1);
  for (const surface of [
    'navigator.mediaDevices.getUserMedia',
    'navigator.mediaDevices.getDisplayMedia',
    'RTCPeerConnection construction and methods',
  ] as const) assert.ok(MEDIA_FAIL_CLOSED_SURFACES.includes(surface));
});
