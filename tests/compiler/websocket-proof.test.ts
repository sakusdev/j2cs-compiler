import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ROOT, compile, createCompiler } from '../../compiler/index.js';
import { loadRules } from '../../compiler/rules/loader.js';
import {
  WEBSOCKET_RULE_CONTRACTS,
  proveWebSocketRule,
  type WebSocketProofFacts
} from '../../compiler/rules/websocket-proof.js';

const completeFacts: WebSocketProofFacts = {
  webBuiltinIntegrity: { value: 'pristine', evidence: 'closed browser host profile resolves the intrinsic WebSocket binding' },
  networkBoundary: { value: 'browser-host', evidence: 'DNS/proxy/TLS/upgrade/framing are delegated to the browser host adapter' },
  urlResolution: { value: 'relevant-settings-object', evidence: 'constructor URLs resolve against the browser relevant-settings-object base' },
  taskDispatch: { value: 'event-loop', evidence: 'host callbacks enqueue browser-style tasks rather than invoking synchronously' },
};

test('reviewed WebSocket contracts stay pinned to canonical j2cs rules', async () => {
  const db = await loadRules(path.join(ROOT, 'rule-db'));
  assert.equal(WEBSOCKET_RULE_CONTRACTS.length, 16);
  for (const contract of WEBSOCKET_RULE_CONTRACTS) {
    const proof = proveWebSocketRule(db, contract.id, completeFacts);
    assert.equal(proof.verdict, 'proven', contract.id);
    assert.ok(proof.evidence.length >= 2);
  }
});

test('WebSocket proof fails closed without browser-host evidence', async () => {
  const db = await loadRules(path.join(ROOT, 'rule-db'));
  assert.equal(proveWebSocketRule(db, 'web.websocket.send.text', {
    webBuiltinIntegrity: completeFacts.webBuiltinIntegrity,
  }).verdict, 'unknown');

  assert.equal(proveWebSocketRule(db, 'web.websocket.network-runtime-boundary', {
    webBuiltinIntegrity: completeFacts.webBuiltinIntegrity,
    networkBoundary: { value: 'raw-socket', evidence: 'attempted ClientWebSocket/raw socket shortcut' },
  }).verdict, 'disproven');

  assert.equal(proveWebSocketRule(db, 'web.websocket.event.open', {
    webBuiltinIntegrity: completeFacts.webBuiltinIntegrity,
    networkBoundary: completeFacts.networkBoundary,
    taskDispatch: { value: 'synchronous', evidence: 'callback would run inline' },
  }).verdict, 'disproven');
});

test('changed canonical WebSocket rule content cannot silently reuse proof', async () => {
  const db = await loadRules(path.join(ROOT, 'rule-db'));
  const id = 'web.websocket.ready-state';
  const loaded = db.byId.get(id)!;
  const changed = {
    ...db,
    byId: new Map(db.byId).set(id, { ...loaded, sha256: '0'.repeat(64) }),
  };
  assert.throws(() => proveWebSocketRule(changed, id, completeFacts), /changed/);
});

test('source-level WebSocket syntax remains fail-closed until renderer/host wiring lands', async () => {
  const index = await createCompiler();
  assert.throws(
    () => compile("const s = new WebSocket('wss://example.com/socket'); console.log(s.readyState);", index),
    /not supported|unsupported|WebSocket|syntax/i
  );
});
