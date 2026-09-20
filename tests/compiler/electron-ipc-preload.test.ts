import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { Facts } from '../../compiler/analysis/facts.js';
import { ROOT } from '../../compiler/index.js';
import { loadRules } from '../../compiler/rules/loader.js';
import {
  ELECTRON_IPC_PRELOAD_RULE_DB_COMMIT,
  ELECTRON_IPC_PRELOAD_RULES,
  electronContextBridgeFacts,
  electronIpcMainFacts,
  electronIpcRendererFacts,
  proveElectronIpcPreloadRule,
  verifyElectronIpcPreloadRuleContracts,
} from '../../compiler/rules/electron-ipc-preload-proof.js';

const database = await loadRules(path.join(ROOT, 'rule-db'));

test('Electron IPC/preload adapters pin the reviewed canonical j2cs contracts', () => {
  assert.equal(ELECTRON_IPC_PRELOAD_RULE_DB_COMMIT, '35ca8d859f9352e90ee2497f4ac8f6edb9c19ed1');
  const loaded = verifyElectronIpcPreloadRuleContracts(database);
  assert.equal(loaded.length, ELECTRON_IPC_PRELOAD_RULES.length);
  assert.equal(loaded.length, 18);

  for (const spec of ELECTRON_IPC_PRELOAD_RULES) {
    const rule = database.byId.get(spec.ruleId);
    assert.ok(rule, spec.ruleId + ' must exist in the pinned rule DB');
    assert.equal(rule.sha256, spec.sha256, spec.ruleId + ' SHA256 drift');
    assert.equal(rule.file.replaceAll('\\', '/'), spec.file, spec.ruleId + ' path drift');
    assert.equal(rule.rule.category, spec.category, spec.ruleId + ' category drift');
    assert.equal(rule.rule.strategy, spec.strategy, spec.ruleId + ' strategy drift');
    assert.equal(rule.rule.target.kind, spec.targetKind, spec.ruleId + ' target-kind drift');
    if (spec.helper !== undefined)
      assert.equal(rule.rule.target.helper, spec.helper, spec.ruleId + ' helper drift');
  }
});

test('ipcMain rules require exact main-process binding and typed runtime proof', () => {
  const facts = electronIpcMainFacts();
  for (const ruleId of [
    'electron.ipcmain.on',
    'electron.ipcmain.handle',
    'electron.ipcmain.handleonce',
    'electron.ipcmain.removehandler',
  ])
    assert.equal(proveElectronIpcPreloadRule(database, ruleId, facts).verdict, 'proven', ruleId);

  const missingRuntime = new Facts(facts);
  missingRuntime.delete('electron.ipcRuntime');
  assert.equal(
    proveElectronIpcPreloadRule(database, 'electron.ipcmain.handle', missingRuntime).verdict,
    'unknown',
  );

  const shadowed = new Facts(facts)
    .prove('electron.memberIntegrity', 'overridden', 'Intentional negative proof');
  assert.equal(
    proveElectronIpcPreloadRule(database, 'electron.ipcmain.on', shadowed).verdict,
    'disproven',
  );

  const wrongProcess = new Facts(facts)
    .prove('electron.process', 'renderer', 'Intentional negative proof');
  assert.equal(
    proveElectronIpcPreloadRule(database, 'electron.ipcmain.handle', wrongProcess).verdict,
    'disproven',
  );
});

test('ipcRenderer send/invoke/sendSync prove distinct ordering and sync boundaries', () => {
  const facts = electronIpcRendererFacts();
  for (const ruleId of [
    'electron.ipcrenderer.send',
    'electron.ipcrenderer.invoke',
    'electron.ipcrenderer.sendsync',
  ])
    assert.equal(proveElectronIpcPreloadRule(database, ruleId, facts).verdict, 'proven', ruleId);

  const asyncSubstitution = new Facts(facts)
    .prove('electron.syncDispatch', 'async-substitution', 'sendSync must not become invoke');
  assert.equal(
    proveElectronIpcPreloadRule(database, 'electron.ipcrenderer.sendsync', asyncSubstitution).verdict,
    'disproven',
  );

  const uncorrelated = new Facts(facts);
  uncorrelated.delete('electron.invokeCorrelation');
  assert.equal(
    proveElectronIpcPreloadRule(database, 'electron.ipcrenderer.invoke', uncorrelated).verdict,
    'unknown',
  );
});

test('handleOnce requires atomic removal-before-call proof', () => {
  const facts = electronIpcMainFacts()
    .prove('electron.oneShot', 'after-call', 'Intentional race-prone implementation');
  assert.equal(
    proveElectronIpcPreloadRule(database, 'electron.ipcmain.handleonce', facts).verdict,
    'disproven',
  );
});

test('preload/contextBridge rules require isolated renderer and reviewed bridge profile', () => {
  const facts = electronContextBridgeFacts();
  for (const ruleId of [
    'electron.preload.isolated-world',
    'electron.preload.context-isolation-default',
    'electron.preload.bridge-required-for-window-api',
    'electron.preload.ipc-wrapper-closure',
    'electron.contextbridge.expose-main-world',
    'electron.contextbridge.nested-api',
    'electron.contextbridge.value-copy-freeze',
    'electron.contextbridge.arguments-copy',
    'electron.contextbridge.return-copy',
    'electron.contextbridge.ipc-renderer-restriction',
    'electron.contextbridge.security-wrapper',
  ])
    assert.equal(proveElectronIpcPreloadRule(database, ruleId, facts).verdict, 'proven', ruleId);

  const sameWorld = new Facts(facts)
    .prove('electron.rendererContext', 'page-main-world', 'Intentional isolation violation');
  assert.equal(
    proveElectronIpcPreloadRule(database, 'electron.contextbridge.expose-main-world', sameWorld).verdict,
    'disproven',
  );

  const legacyProfile = new Facts(facts)
    .prove('electron.electronProfile', 'legacy', 'Intentional legacy profile');
  assert.equal(
    proveElectronIpcPreloadRule(database, 'electron.contextbridge.ipc-renderer-restriction', legacyProfile).verdict,
    'disproven',
  );

  const unrestricted = new Facts(facts)
    .prove('electron.bridgePolicy', 'unrestricted', 'Raw channel exposure is unsafe');
  assert.equal(
    proveElectronIpcPreloadRule(database, 'electron.contextbridge.security-wrapper', unrestricted).verdict,
    'disproven',
  );
});

test('sibling WebContents compiler rule remains outside this lane', () => {
  const enabled = new Set(ELECTRON_IPC_PRELOAD_RULES.map(spec => spec.ruleId));
  assert.equal(enabled.has('electron.webcontents.send'), false);
  assert.throws(
    () => proveElectronIpcPreloadRule(database, 'electron.webcontents.send', electronIpcMainFacts()),
    /No reviewed Electron IPC\/preload adapter/,
  );
});
