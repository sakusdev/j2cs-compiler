import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ROOT } from '../../compiler/index.js';
import { Facts } from '../../compiler/analysis/facts.js';
import { NODE_COMPAT_ADAPTERS, NODE_COMPAT_RULE_DB_COMMIT, loadNodeCompatProofIndex } from '../../compiler/node/adapters.js';

const index = await loadNodeCompatProofIndex(path.join(ROOT, 'rule-db'));

test('Node compatibility adapters pin the reviewed canonical rules', () => {
  assert.equal(NODE_COMPAT_RULE_DB_COMMIT, '35ca8d859f9352e90ee2497f4ac8f6edb9c19ed1');
  assert.equal(NODE_COMPAT_ADAPTERS.length, 19);
  assert.deepEqual(index.ruleIds(), NODE_COMPAT_ADAPTERS.map(adapter => adapter.ruleId));
});

test('EventEmitter proof requires the receiver and pristine member', () => {
  const facts = new Facts()
    .prove('node.receiver', 'events.EventEmitter', 'receiver inference')
    .prove('node.member.integrity', 'pristine', 'member integrity');
  const proof = index.prove('node.events.event-emitter.on', facts);
  assert.equal(proof.verdict, 'proven');
  assert.equal(proof.helper, 'NodeEvents.On');

  const missing = new Facts().prove('node.receiver', 'events.EventEmitter', 'receiver inference');
  assert.equal(index.prove('node.events.event-emitter.on', missing).verdict, 'unknown');

  const replaced = new Facts()
    .prove('node.receiver', 'events.EventEmitter', 'receiver inference')
    .prove('node.member.integrity', 'replaced', 'member integrity');
  assert.equal(index.prove('node.events.event-emitter.on', replaced).verdict, 'disproven');
});

test('unhandled error proof requires zero registered error listeners', () => {
  const facts = new Facts()
    .prove('node.receiver', 'events.EventEmitter', 'receiver inference')
    .prove('node.member.integrity', 'pristine', 'member integrity')
    .prove('node.event.errorListenerCount', 0, 'listener analysis');
  assert.equal(index.prove('node.events.event-emitter.emit-error-unhandled', facts).verdict, 'proven');
});

test('stream lifecycle helpers fail closed without a compatible scheduler', () => {
  const facts = new Facts()
    .prove('node.receiver', 'stream.Writable', 'receiver inference')
    .prove('node.member.integrity', 'pristine', 'member integrity');
  assert.equal(index.prove('node.stream.writable.write', facts).verdict, 'unknown');

  facts.prove('node.scheduler', 'compatible', 'host scheduler contract');
  const proof = index.prove('node.stream.writable.write', facts);
  assert.equal(proof.verdict, 'proven');
  assert.equal(proof.helper, 'NodeStreams.Write');
});

test('Buffer.from proof requires binding, member integrity and overload resolution', () => {
  const facts = new Facts()
    .prove('node.binding', 'Buffer', 'binding inference')
    .prove('node.member.integrity', 'pristine', 'member integrity')
    .prove('node.buffer.overloadResolved', true, 'overload analysis');
  const proof = index.prove('binary.buffer.from', facts);
  assert.equal(proof.verdict, 'proven');
  assert.equal(proof.helper, 'NodeBuffer.From');

  facts.prove('node.buffer.overloadResolved', false, 'ambiguous overload');
  assert.equal(index.prove('binary.buffer.from', facts).verdict, 'disproven');
});

test('unreviewed Node rules cannot be selected', () => {
  assert.throws(() => index.prove('node.stream.readable.pipe', new Facts()), /not reviewed/);
});
