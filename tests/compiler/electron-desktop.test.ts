import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from '../../compiler/index.js';
import { loadRules } from '../../compiler/rules/loader.js';
import {
  ELECTRON_DESKTOP_RULE_DB_COMMIT,
  ELECTRON_DESKTOP_RULES,
  proveElectronDesktopRule,
  validateElectronDesktopRuleContracts,
  type ElectronDesktopProofContext,
} from '../../compiler/electron/desktop.js';

const database = await loadRules(path.join(ROOT, 'rule-db'));

function contextFor(ruleId: string): ElectronDesktopProofContext {
  const common = { memberIntegrity: 'pristine' as const, hostCapability: true };
  switch (ruleId) {
    case 'electron.tray.constructor':
      return { ...common, moduleBinding: 'electron.Tray', process: 'main', appReady: true };
    case 'electron.menu.append':
      return { ...common, receiver: 'Electron Menu', process: 'main' };
    case 'electron.notification.show':
      return { ...common, receiver: 'Electron Notification', process: 'main' };
    case 'electron.clipboard.readtext':
    case 'electron.clipboard.writetext':
      return { ...common, moduleBinding: 'electron.clipboard' };
    case 'electron.dialog.showmessagebox':
      return { ...common, moduleBinding: 'electron.dialog', process: 'main' };
    case 'electron.shell.openexternal':
      return { ...common, moduleBinding: 'electron.shell' };
    case 'electron.globalshortcut.register':
      return { ...common, moduleBinding: 'electron.globalShortcut', process: 'main', appReady: true };
    case 'electron.protocol.scheme-name':
      return { ...common, electronProfile: 'current Electron' };
    case 'electron.screen.getprimarydisplay':
      return { ...common, moduleBinding: 'electron.screen', process: 'main', appReady: true };
    case 'electron.native-theme.themesource-write':
      return { ...common, moduleBinding: 'electron.nativeTheme', process: 'main' };
    case 'electron.power.powersave.start':
      return { ...common, moduleBinding: 'electron.powerSaveBlocker', process: 'main', appReady: true };
    default:
      throw new Error('Missing test proof context for ' + ruleId);
  }
}

test('Electron desktop proof manifest is pinned to canonical j2cs commit and full rule hashes', async () => {
  const adapters = JSON.parse(
    await readFile(path.join(ROOT, 'compiler/rules/adapters.json'), 'utf8'),
  ) as { ruleDbCommit: string };
  assert.equal(ELECTRON_DESKTOP_RULE_DB_COMMIT, adapters.ruleDbCommit);

  const loaded = validateElectronDesktopRuleContracts(database);
  assert.equal(loaded.length, ELECTRON_DESKTOP_RULES.length);
  for (const spec of ELECTRON_DESKTOP_RULES) {
    const rule = database.byId.get(spec.ruleId);
    assert.ok(rule, 'missing canonical rule ' + spec.ruleId);
    assert.equal(rule.sha256, spec.sha256);
    assert.equal(rule.rule.category, spec.category);
    assert.equal(rule.rule.strategy, 'helper');
    assert.equal(rule.rule.target.helper, spec.helper);
  }
});

test('reviewed desktop rules prove only with exact canonical facts and host capability', () => {
  for (const spec of ELECTRON_DESKTOP_RULES) {
    const proof = proveElectronDesktopRule(database, spec.ruleId, contextFor(spec.ruleId));
    assert.equal(proof.verdict, 'proven', spec.ruleId);
    assert.equal(proof.helper, spec.helper);
    assert.ok(proof.checks.every(check => check.verdict === 'proven'), spec.ruleId);
  }
});

test('desktop proof remains fail-closed when lifecycle, host, binding, or integrity evidence is absent', () => {
  const notReady = proveElectronDesktopRule(database, 'electron.tray.constructor', {
    moduleBinding: 'electron.Tray',
    memberIntegrity: 'pristine',
    process: 'main',
    appReady: false,
    hostCapability: true,
  });
  assert.equal(notReady.verdict, 'disproven');

  const readinessUnknown = proveElectronDesktopRule(database, 'electron.tray.constructor', {
    moduleBinding: 'electron.Tray',
    memberIntegrity: 'pristine',
    process: 'main',
    hostCapability: true,
  });
  assert.equal(readinessUnknown.verdict, 'unknown');

  const hostUnknown = proveElectronDesktopRule(database, 'electron.shell.openexternal', {
    moduleBinding: 'electron.shell',
    memberIntegrity: 'pristine',
  });
  assert.equal(hostUnknown.verdict, 'unknown');

  const overridden = proveElectronDesktopRule(database, 'electron.clipboard.readtext', {
    moduleBinding: 'electron.clipboard',
    memberIntegrity: 'overridden',
    hostCapability: true,
  });
  assert.equal(overridden.verdict, 'disproven');

  const renderer = proveElectronDesktopRule(database, 'electron.dialog.showmessagebox', {
    moduleBinding: 'electron.dialog',
    memberIntegrity: 'pristine',
    process: 'renderer',
    hostCapability: true,
  });
  assert.equal(renderer.verdict, 'disproven');

  const wrongModule = proveElectronDesktopRule(database, 'electron.globalshortcut.register', {
    moduleBinding: 'electron.shell',
    memberIntegrity: 'pristine',
    process: 'main',
    appReady: true,
    hostCapability: true,
  });
  assert.equal(wrongModule.verdict, 'disproven');

  const wrongProfile = proveElectronDesktopRule(database, 'electron.protocol.scheme-name', {
    electronProfile: 'legacy Electron',
    memberIntegrity: 'pristine',
    hostCapability: true,
  });
  assert.equal(wrongProfile.verdict, 'disproven');
});

test('OS default-protocol registration is not invented as a canonical source rule', () => {
  assert.throws(
    () => proveElectronDesktopRule(database, 'electron.app.set-as-default-protocol-client', {
      memberIntegrity: 'pristine',
      process: 'main',
      hostCapability: true,
    }),
    /No reviewed Electron desktop adapter/,
  );
});
