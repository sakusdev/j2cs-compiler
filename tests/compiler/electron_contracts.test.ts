import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { Facts } from '../../compiler/analysis/facts.js';
import {
  ELECTRON_RULE_CONTRACTS,
  ElectronContractRegistry,
  electronMainHostFacts,
  loadElectronContractRegistry,
} from '../../compiler/electron/contracts.js';

const registry = await loadElectronContractRegistry(path.resolve('rule-db'));

function cloneFacts(facts: Facts): Facts {
  return new Facts(facts);
}

test('Electron #43 adapters pin reviewed canonical j2cs rules and strategies', () => {
  assert.equal(registry.contracts.length, 12);
  assert.deepEqual(
    registry.contracts.map(contract => contract.ruleId),
    ELECTRON_RULE_CONTRACTS.map(contract => contract.ruleId),
  );
  for (const contract of registry.contracts) {
    assert.match(contract.sha256, /^[0-9a-f]{64}$/);
    assert.ok(['helper', 'runtime', 'unsupported'].includes(contract.strategy));
  }
});

test('app readiness proof requires canonical Electron binding and main-process evidence', () => {
  const complete = electronMainHostFacts(true, true)
    .prove('electron.moduleBinding', 'electron.app', 'Resolved import/require binding is electron.app');
  const selected = registry.prove('electron.app.whenready', complete);
  assert.equal(selected.proof.verdict, 'proven');
  assert.equal(selected.contract?.runtimeContract, 'App.WhenReadyAsync');

  const missingBinding = electronMainHostFacts(true, true);
  assert.equal(registry.prove('electron.app.whenready', missingBinding).proof.verdict, 'unknown');

  const wrongProcess = cloneFacts(complete).prove('electron.processKind', 'renderer', 'Renderer entry point');
  assert.equal(registry.prove('electron.app.whenready', wrongProcess).proof.verdict, 'disproven');
});

test('BrowserWindow constructor and native operations require a proven native-window backend', () => {
  const constructor = electronMainHostFacts(true, false)
    .prove('electron.constructorBinding', 'electron.BrowserWindow', 'Resolved Electron constructor binding');
  assert.equal(registry.prove('electron.browserwindow.constructor', constructor).proof.verdict, 'proven');

  const unavailable = electronMainHostFacts(false, false)
    .prove('electron.constructorBinding', 'electron.BrowserWindow', 'Resolved Electron constructor binding');
  assert.equal(registry.prove('electron.browserwindow.constructor', unavailable).proof.verdict, 'disproven');

  const windowFacts = electronMainHostFacts(true, false)
    .prove('electron.receiver', 'Electron BrowserWindow', 'Flow identity is BrowserWindow');
  assert.equal(registry.prove('electron.browserwindow.show', windowFacts).proof.verdict, 'proven');
});

test('navigation runtime stays fail-closed until renderer capability is proven', () => {
  const noRenderer = electronMainHostFacts(true, false)
    .prove('electron.receiver', 'Electron BrowserWindow', 'Flow identity is BrowserWindow');
  const blocked = registry.prove('electron.browserwindow.loadurl', noRenderer);
  assert.equal(blocked.proof.verdict, 'disproven');
  assert.equal(blocked.contract, undefined);

  const renderer = electronMainHostFacts(true, true)
    .prove('electron.receiver', 'Electron BrowserWindow', 'Flow identity is BrowserWindow');
  const selected = registry.prove('electron.browserwindow.loadurl', renderer);
  assert.equal(selected.proof.verdict, 'proven');
  assert.equal(selected.contract?.strategy, 'runtime');
  assert.equal(selected.contract?.runtimeContract, 'BrowserWindow.LoadUrlAsync');
});

test('dynamic WebContents source remains explicitly unsupported even with complete proof', () => {
  const facts = electronMainHostFacts(true, true)
    .prove('electron.receiver', 'Electron WebContents', 'Flow identity is WebContents')
    .prove('electron.dynamicCodeStaticallyReducible', false, 'Runtime source string is not statically reducible');
  const selected = registry.prove('electron.webcontents.executejavascript', facts);
  assert.equal(selected.proof.verdict, 'proven');
  assert.equal(selected.contract?.strategy, 'unsupported');
  assert.match(selected.contract?.runtimeContract ?? '', /explicit rejection/);
});

test('registry instances cannot prove contracts that were not explicitly supplied', () => {
  const empty = new ElectronContractRegistry([]);
  const facts = electronMainHostFacts(true, true)
    .prove('electron.moduleBinding', 'electron.app', 'Resolved import/require binding is electron.app');
  const result = empty.prove('electron.app.whenready', facts);
  assert.equal(result.proof.verdict, 'unknown');
  assert.equal(result.contract, undefined);
});

test('unknown Electron rule IDs never acquire a lowering contract', () => {
  const result = registry.prove('electron.unreviewed.future-api', electronMainHostFacts(true, true));
  assert.equal(result.proof.verdict, 'unknown');
  assert.equal(result.contract, undefined);
});
