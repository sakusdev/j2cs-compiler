import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { Facts } from '../../compiler/analysis/facts.js';
import { loadRules } from '../../compiler/rules/loader.js';
import {
  blobFacts,
  proveRendererRule,
  rendererWebAdapters,
  standaloneEventFacts,
} from '../../compiler/web/rendererProof.js';

const database = await loadRules(path.resolve('rule-db'));

test('renderer adapters pin complete canonical j2cs rule files', () => {
  const mismatches: string[] = [];
  for (const adapter of rendererWebAdapters) {
    const loaded = database.byId.get(adapter.ruleId);
    if (!loaded) mismatches.push(adapter.ruleId + ': missing');
    else if (adapter.sha256 !== loaded.sha256)
      mismatches.push(adapter.ruleId + ': expected=' + adapter.sha256 + ' actual=' + loaded.sha256);
  }
  assert.equal(mismatches.length, 0, 'Renderer SHA256 pins:\n' + mismatches.join('\n'));
});

test('standalone EventTarget rules require explicit host and callback proofs', () => {
  const facts = standaloneEventFacts('EventTarget');
  for (const ruleId of [
    'dom.eventtarget.add-event-listener',
    'dom.eventtarget.remove-event-listener',
    'dom.eventtarget.dispatch-event',
  ]) assert.equal(proveRendererRule(database, ruleId, facts).verdict, 'proven', ruleId);

  const missingSubsystem = new Facts(facts);
  missingSubsystem.delete('renderer.eventSubsystem');
  assert.equal(proveRendererRule(database, 'dom.eventtarget.dispatch-event', missingSubsystem).verdict, 'unknown');

  const wrongReceiver = new Facts(facts)
    .prove('renderer.receiverKind', 'Blob', 'Intentional negative proof');
  assert.equal(proveRendererRule(database, 'dom.eventtarget.add-event-listener', wrongReceiver).verdict, 'disproven');
});

test('Event proofs distinguish Event state and fail closed when timestamp becomes observable', () => {
  const eventFacts = standaloneEventFacts('Event');
  for (const ruleId of [
    'dom.event.prevent-default',
    'dom.event.stop-propagation',
    'dom.event.stop-immediate-propagation',
  ]) assert.equal(proveRendererRule(database, ruleId, eventFacts).verdict, 'proven', ruleId);

  const constructorFacts = standaloneEventFacts();
  assert.equal(proveRendererRule(database, 'dom.event.constructor', constructorFacts).verdict, 'proven');

  const timestampObservable = new Facts(constructorFacts)
    .prove('renderer.eventTimestamp', 'observable-unimplemented', 'Intentional negative proof');
  assert.equal(proveRendererRule(database, 'dom.event.constructor', timestampObservable).verdict, 'disproven');
});

test('Blob/File core rules connect to canonical j2cs while dependency-heavy rules stay disabled', () => {
  const blob = blobFacts('Blob', 'string');
  for (const ruleId of [
    'web.blob.constructor',
    'web.blob.string-part',
    'web.blob.size',
    'web.blob.type',
    'web.blob.slice',
  ]) assert.equal(proveRendererRule(database, ruleId, blob).verdict, 'proven', ruleId);

  const file = blobFacts('File', 'string');
  for (const ruleId of ['web.file.constructor', 'web.file.name', 'web.file.last-modified'])
    assert.equal(proveRendererRule(database, ruleId, file).verdict, 'proven', ruleId);

  const enabled = new Set(rendererWebAdapters.map(adapter => adapter.ruleId));
  for (const deferred of [
    'web.blob.buffer-source-copy',
    'web.blob.text',
    'web.file.blob-inheritance',
  ]) assert.equal(enabled.has(deferred), false, deferred + ' must stay fail-closed');

  assert.throws(() => proveRendererRule(database, 'web.blob.text', blob), /not enabled by this lane/);
});
