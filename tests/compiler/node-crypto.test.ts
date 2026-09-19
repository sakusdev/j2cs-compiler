import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from '../../compiler/index.js';
import {
  NODE_CRYPTO_RULE_DB_COMMIT,
  NODE_CRYPTO_RULE_PROOFS,
  planNodeCrypto,
  type NodeCryptoFacts,
} from '../../compiler/node/crypto.js';

const baseFacts: NodeCryptoFacts = {
  nodeCryptoBuiltin: true,
  builtinNotShadowed: true,
  bufferCompat: false,
  webCryptoIntrinsic: true,
  bufferSourceCompat: false,
  promiseJobs: false,
};

test('Node crypto adapters pin complete canonical j2cs rule SHA256 values', async () => {
  assert.equal(NODE_CRYPTO_RULE_DB_COMMIT, '35ca8d859f9352e90ee2497f4ac8f6edb9c19ed1');
  const ids = new Set<string>();
  for (const proof of NODE_CRYPTO_RULE_PROOFS) {
    assert.ok(!ids.has(proof.id), `duplicate crypto rule proof: ${proof.id}`);
    ids.add(proof.id);
    const raw = await readFile(path.join(ROOT, 'rule-db', proof.path), 'utf8');
    const normalized = raw.replaceAll('\r\n', '\n');
    assert.equal(createHash('sha256').update(normalized, 'utf8').digest('hex'), proof.sha256, proof.path);
    const rule = JSON.parse(normalized) as { id?: string; strategy?: string; target?: { kind?: string; helper?: string } };
    assert.equal(rule.id, proof.id);
    assert.equal(rule.strategy, 'helper');
    assert.equal(rule.target?.kind, 'helper');
  }
});

test('hash/HMAC planning requires builtin proof and a bounded digest algorithm', () => {
  const hash = planNodeCrypto({ kind: 'hash-utf8', algorithm: 'SHA-256', digestEncoding: 'hex' }, baseFacts);
  assert.equal(hash.status, 'runtime');
  if (hash.status === 'runtime') {
    assert.deepEqual(hash.ruleIds, ['node.crypto.create-hash', 'node.crypto.hash.update', 'node.crypto.hash.digest']);
    assert.deepEqual(hash.helpers, ['NodeCrypto.CreateHash', 'NodeCrypto.HashUpdate', 'NodeCrypto.HashDigest']);
  }

  const hmac = planNodeCrypto({ kind: 'hmac-utf8', algorithm: 'sha512', digestEncoding: 'base64' }, baseFacts);
  assert.equal(hmac.status, 'runtime');

  const unknown = planNodeCrypto({ kind: 'hash-utf8', algorithm: 'blake2b512', digestEncoding: 'hex' }, baseFacts);
  assert.equal(unknown.status, 'unsupported');
  if (unknown.status === 'unsupported') assert.equal(unknown.code, 'E_NODE_CRYPTO_ALGORITHM');

  const unproven = planNodeCrypto({ kind: 'random-uuid' }, { ...baseFacts, nodeCryptoBuiltin: false });
  assert.equal(unproven.status, 'unsupported');
  if (unproven.status === 'unsupported') assert.equal(unproven.code, 'E_NODE_CRYPTO_MODULE_PROOF');
});

test('Buffer-observable crypto surfaces stay fail-closed until the Buffer lane is proven', () => {
  for (const request of [
    { kind: 'random-bytes' as const },
    { kind: 'timing-safe-equal' as const },
    { kind: 'secret-key' as const },
  ]) {
    const plan = planNodeCrypto(request, baseFacts);
    assert.equal(plan.status, 'unsupported');
    if (plan.status === 'unsupported') assert.equal(plan.code, 'E_NODE_CRYPTO_BUFFER_DEPENDENCY');
  }

  const enabled = planNodeCrypto({ kind: 'secret-key' }, { ...baseFacts, bufferCompat: true });
  assert.equal(enabled.status, 'runtime');
  if (enabled.status === 'runtime') {
    assert.deepEqual(enabled.ruleIds, ['node.crypto.create-secret-key', 'node.crypto.secret-key-export']);
  }
});

test('WebCrypto digest requires both BufferSource and Promise-job semantics', () => {
  const binaryMissing = planNodeCrypto({ kind: 'webcrypto-digest', algorithm: 'SHA-256' }, baseFacts);
  assert.equal(binaryMissing.status, 'unsupported');
  if (binaryMissing.status === 'unsupported') assert.equal(binaryMissing.code, 'E_WEB_CRYPTO_BINARY_DEPENDENCY');

  const asyncMissing = planNodeCrypto(
    { kind: 'webcrypto-digest', algorithm: 'SHA-384' },
    { ...baseFacts, bufferSourceCompat: true },
  );
  assert.equal(asyncMissing.status, 'unsupported');
  if (asyncMissing.status === 'unsupported') assert.equal(asyncMissing.code, 'E_WEB_CRYPTO_ASYNC_DEPENDENCY');

  const ready = planNodeCrypto(
    { kind: 'webcrypto-digest', algorithm: 'SHA-512' },
    { ...baseFacts, bufferSourceCompat: true, promiseJobs: true },
  );
  assert.equal(ready.status, 'runtime');
  if (ready.status === 'runtime') {
    assert.deepEqual(ready.ruleIds, ['web.subtle-crypto.digest', 'web.subtle-crypto.digest.sha-512']);
    assert.deepEqual(ready.helpers, ['NodeCrypto.WebCryptoDigestCore', 'JsWebCrypto.Digest']);
  }
});

test('randomInt/UUID planning remains Buffer-independent', () => {
  const randomInt = planNodeCrypto({ kind: 'random-int' }, baseFacts);
  const uuid = planNodeCrypto({ kind: 'random-uuid' }, baseFacts);
  assert.equal(randomInt.status, 'runtime');
  assert.equal(uuid.status, 'runtime');
});
