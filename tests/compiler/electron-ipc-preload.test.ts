import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from '../../compiler/index.js';
import { loadRules } from '../../compiler/rules/loader.js';
import {
  ELECTRON_IPC_PRELOAD_RULE_DB_COMMIT,
  ELECTRON_IPC_PRELOAD_RULES,
  proveElectronIpcPreloadRule,
  validateElectronIpcPreloadRuleContracts,
  type ElectronIpcPreloadProofContext,
} from '../../compiler/electron/ipcPreload.js';

const database = await loadRules(path.join(ROOT, 'rule-db'));

function completeContext(ruleId: string): ElectronIpcPreloadProofContext {
  const host = { hostCapability: true };
  switch (ruleId) {
    case 'electron.ipcmain.handle':
    case 'electron.ipcmain.handleonce':
    case 'electron.ipcmain.on':
      return {
        ...host,
        moduleBinding: 'electron.ipcMain',
        memberIntegrity: 'pristine',
        process: 'main',
        callbackRepresentable: true,
      };
    case 'electron.ipcmain.removehandler':
      return {
        ...host,
        moduleBinding: 'electron.ipcMain',
        memberIntegrity: 'pristine',
        process: 'main',
      };
    case 'electron.ipcrenderer.invoke':
    case 'electron.ipcrenderer.send':
      return {
        ...host,
        moduleBinding: 'electron.ipcRenderer',
        memberIntegrity: 'pristine',
        process: 'renderer',
        argumentsRepresentable: true,
      };
    case 'electron.webcontents.send':
      return {
        ...host,
        receiver: 'Electron WebContents',
        memberIntegrity: 'pristine',
        process: 'main',
        argumentsRepresentable: true,
      };
    case 'electron.preload.isolated-world':
      return { ...host, rendererContext: true };
    case 'electron.preload.context-isolation-default':
      return { ...host, rendererContext: true, modernElectronProfile: true };
    case 'electron.contextbridge.expose-main-world':
      return { ...host, rendererContext: true, bridgeValueRepresentable: true };
    case 'electron.contextbridge.security-wrapper':
      return {
        ...host,
        rendererContext: true,
        callbackRepresentable: true,
        bridgePolicyRestricted: true,
      };
    case 'electron.contextbridge.ipc-renderer-restriction':
      return { ...host, rendererContext: true, modernElectronProfile: true };
    default:
      throw new Error('Missing proof context for ' + ruleId);
  }
}

test('Electron IPC/preload contracts pin the canonical j2cs revision and full rule hashes', async () => {
  const adapters = JSON.parse(
    await readFile(path.join(ROOT, 'compiler/rules/adapters.json'), 'utf8'),
  ) as { ruleDbCommit: string; adapters: Array<{ ruleId: string }> };

  assert.equal(ELECTRON_IPC_PRELOAD_RULE_DB_COMMIT, adapters.ruleDbCommit);
  const loaded = validateElectronIpcPreloadRuleContracts(database);
  assert.equal(loaded.length, ELECTRON_IPC_PRELOAD_RULES.length);

  for (const spec of ELECTRON_IPC_PRELOAD_RULES) {
    const rule = database.byId.get(spec.ruleId);
    assert.ok(rule, 'missing canonical rule ' + spec.ruleId);
    assert.equal(rule.sha256, spec.sha256, spec.ruleId);
    assert.equal(rule.rule.category, spec.category, spec.ruleId);
    assert.equal(rule.rule.strategy, spec.strategy, spec.ruleId);
  }

  const globallyWired = new Set(adapters.adapters.map(adapter => adapter.ruleId));
  for (const spec of ELECTRON_IPC_PRELOAD_RULES)
    assert.equal(globallyWired.has(spec.ruleId), false, spec.ruleId + ' must remain isolated until module/source wiring merges');
});

test('reviewed Electron IPC/preload rules prove only with exact canonical and backend facts', () => {
  for (const spec of ELECTRON_IPC_PRELOAD_RULES) {
    const proof = proveElectronIpcPreloadRule(database, spec.ruleId, completeContext(spec.ruleId));
    assert.equal(proof.verdict, 'proven', spec.ruleId);
    assert.equal(proof.runtimeContract, spec.runtimeContract);
    assert.ok(proof.checks.every(check => check.verdict === 'proven'), spec.ruleId);
  }
});

test('IPC rules fail closed for wrong process, missing clone proof, or unavailable host', () => {
  const wrongProcess = proveElectronIpcPreloadRule(database, 'electron.ipcrenderer.invoke', {
    moduleBinding: 'electron.ipcRenderer',
    memberIntegrity: 'pristine',
    process: 'main',
    hostCapability: true,
    argumentsRepresentable: true,
  });
  assert.equal(wrongProcess.verdict, 'disproven');

  const missingClone = proveElectronIpcPreloadRule(database, 'electron.ipcrenderer.send', {
    moduleBinding: 'electron.ipcRenderer',
    memberIntegrity: 'pristine',
    process: 'renderer',
    hostCapability: true,
  });
  assert.equal(missingClone.verdict, 'unknown');

  const unsupportedClone = proveElectronIpcPreloadRule(database, 'electron.webcontents.send', {
    receiver: 'Electron WebContents',
    memberIntegrity: 'pristine',
    process: 'main',
    hostCapability: true,
    argumentsRepresentable: false,
  });
  assert.equal(unsupportedClone.verdict, 'disproven');

  const hostUnknown = proveElectronIpcPreloadRule(database, 'electron.ipcmain.removehandler', {
    moduleBinding: 'electron.ipcMain',
    memberIntegrity: 'pristine',
    process: 'main',
  });
  assert.equal(hostUnknown.verdict, 'unknown');
});

test('preload/contextBridge rules require isolated renderer evidence and reviewed security policy', () => {
  const rendererUnknown = proveElectronIpcPreloadRule(database, 'electron.preload.isolated-world', {
    hostCapability: true,
  });
  assert.equal(rendererUnknown.verdict, 'unknown');

  const legacyDefault = proveElectronIpcPreloadRule(database, 'electron.preload.context-isolation-default', {
    hostCapability: true,
    rendererContext: true,
    modernElectronProfile: false,
  });
  assert.equal(legacyDefault.verdict, 'disproven');

  const unsafeWrapper = proveElectronIpcPreloadRule(database, 'electron.contextbridge.security-wrapper', {
    hostCapability: true,
    rendererContext: true,
    callbackRepresentable: true,
    bridgePolicyRestricted: false,
  });
  assert.equal(unsafeWrapper.verdict, 'disproven');

  const rawRestrictionUnknownProfile = proveElectronIpcPreloadRule(
    database,
    'electron.contextbridge.ipc-renderer-restriction',
    { hostCapability: true, rendererContext: true },
  );
  assert.equal(rawRestrictionUnknownProfile.verdict, 'unknown');
});

test('unreviewed Electron IPC/preload rules cannot acquire a runtime contract', () => {
  assert.throws(
    () => proveElectronIpcPreloadRule(database, 'electron.ipcrenderer.future-api', {
      hostCapability: true,
      rendererContext: true,
    }),
    /No reviewed Electron IPC\/preload adapter/,
  );
});
