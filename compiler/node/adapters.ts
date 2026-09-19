import type { FactModel } from '../analysis/facts.js';
import { loadRules, type LoadedRule, type RuleDatabase } from '../rules/loader.js';
import { evaluate, type Predicate, type Proof, type Verdict } from '../rules/requirements.js';

export const NODE_COMPAT_RULE_DB_COMMIT = '35ca8d859f9352e90ee2497f4ac8f6edb9c19ed1';

export interface NodeCompatAdapter {
  ruleId: string;
  sha256: string;
  helper: string;
  requires?: readonly Predicate[];
}

export interface NodeCompatProof {
  ruleId: string;
  helper: string;
  verdict: Verdict;
  checks: readonly Proof[];
}

const schedulerCompatible: Predicate = { fact: 'node.scheduler', equals: 'compatible' };
const metaEventsUnobserved: Predicate = { fact: 'node.events.metaEventsObserved', equals: false };
const rawListenersUnobserved: Predicate = { fact: 'node.events.rawListenersObserved', equals: false };
const listenerThisUnobserved: Predicate = { fact: 'node.listener.thisObserved', equals: false };
const nonErrorPayload: Predicate = { fact: 'node.errorPayload.kind', equals: 'nonError' };
const pausedReadable: Predicate = { fact: 'node.stream.flowing', equals: false };
const bufferReadMode: Predicate = { fact: 'node.stream.readEncoding', equals: 'buffer' };
const noDataListeners: Predicate = { fact: 'node.stream.dataListenerCount', equals: 0 };
const admittedChunk: Predicate = { fact: 'node.stream.chunkRepresentation', equals: 'NodeStreamChunk' };
const defaultEndEncoding: Predicate = { fact: 'node.stream.endEncoding', equals: 'default' };
const noFinalHook: Predicate = { fact: 'node.stream.customFinalHook', equals: false };
const noReadHook: Predicate = { fact: 'node.stream.customReadHook', equals: false };
const bufferViewOnly: Predicate = { fact: 'node.buffer.viewOperation', equals: 'sliceOrSubarray' };
const bufferMetadataUnobserved: Predicate = { fact: 'node.buffer.metadataObserved', equals: false };
const bufferFromSupported: Predicate = { fact: 'node.buffer.fromProfile', equals: 'supported' };
const bufferAllocSupported: Predicate = { fact: 'node.buffer.allocProfile', equals: 'byteFillOrDefault' };
const bufferByteLengthSupported: Predicate = { fact: 'node.buffer.byteLengthProfile', equals: 'supported' };

export const NODE_COMPAT_ADAPTERS: readonly NodeCompatAdapter[] = [
  { ruleId: 'node.events.event-emitter.constructor', sha256: '7ae8c721a6499d2f4ddf2ea7b40998524ffcf96033c346d1affd6152a44ac44d', helper: 'NodeEvents.Create' },
  { ruleId: 'node.events.event-emitter.on', sha256: '30caac2ef980c6de93b38fb9aaac4de72ef3e8dcfb3caf76a6716ebe7643bbb6', helper: 'NodeEvents.On', requires: [metaEventsUnobserved] },
  { ruleId: 'node.events.event-emitter.once', sha256: '97f98117a404d778fec5ca92dfe6d7405f8d1604e9912a5670c51e822457d198', helper: 'NodeEvents.Once', requires: [metaEventsUnobserved, rawListenersUnobserved] },
  { ruleId: 'node.events.event-emitter.remove-listener', sha256: '1c796b320da1bbc9ac58542e071d17620cbc05bcaa8223b05830efee50f7af50', helper: 'NodeEvents.RemoveListener', requires: [metaEventsUnobserved] },
  { ruleId: 'node.events.event-emitter.emit', sha256: 'd336acbf84edcf6c1577484b281eb37659bdad1bbdf4d54a3a852aabdee41782', helper: 'NodeEvents.Emit', requires: [listenerThisUnobserved] },
  { ruleId: 'node.events.event-emitter.emit-error-unhandled', sha256: '14740ce5323bc4aefa67eeedc8523784ebfe6e12cfbc1c48c0b1d237a0d701c6', helper: 'NodeEvents.Emit', requires: [nonErrorPayload] },

  { ruleId: 'node.stream.high-water-mark', sha256: 'daa83c43c81971dfccd8ebb9661059199ba02ff912864adb51ef816928fe5459', helper: 'NodeStreams.ConfigureHighWaterMark' },
  { ruleId: 'node.stream.readable.push', sha256: 'eb065396a065fabb5332d70e0b563be7687059cec6f41dc00d31823c98703fbe', helper: 'NodeStreams.Push', requires: [pausedReadable, admittedChunk] },
  { ruleId: 'node.stream.readable.push-eof', sha256: '57efdb1b07dff47c06aaa7685825f81d905907c183647d553376b88c2f68e8e9', helper: 'NodeStreams.PushEof', requires: [schedulerCompatible, pausedReadable] },
  { ruleId: 'node.stream.readable.read', sha256: 'f7050150bb4d332b959c764535851fb7669eacd40fe250ba835f8a8e75f2b62e', helper: 'NodeStreams.Read', requires: [schedulerCompatible, pausedReadable, bufferReadMode, noDataListeners] },
  { ruleId: 'node.stream.writable.write', sha256: '1910bc5207ef3f102c0bd3f0a9824d75c7d4574058d749fb03b782963e46d2ea', helper: 'NodeStreams.Write', requires: [schedulerCompatible, admittedChunk] },
  { ruleId: 'node.stream.writable.end', sha256: 'ed2d8430df786aa055b96cb320dfccabf57218122e571613df0d1cbb489eccdf', helper: 'NodeStreams.End', requires: [schedulerCompatible, admittedChunk, defaultEndEncoding, noFinalHook] },
  { ruleId: 'node.stream.writable.drain', sha256: '06ed7a21bdd228041b56908c0e367c1671cb1e4b102eeabd5e5c09f28cc8c9df', helper: 'NodeStreams.OnDrain', requires: [schedulerCompatible, metaEventsUnobserved] },
  { ruleId: 'node.stream.writable.finish', sha256: 'a423f29ceace75c7c4bbffa79aae15ce0d21b3dd26145e0a3c0dc124e05e2d7b', helper: 'NodeStreams.OnFinish', requires: [schedulerCompatible, metaEventsUnobserved, noFinalHook] },
  { ruleId: 'node.stream.duplex.constructor', sha256: 'c3aa992608e7d69483960078defd83f0c8999dae9a1614ffce896c1451912f74', helper: 'NodeStreams.CreateDuplex', requires: [schedulerCompatible, noReadHook, noFinalHook] },

  { ruleId: 'binary.buffer.from', sha256: 'd659b88ab766c3aff57f1afc3a21ae9e8d057c617572aa04a978e35f685cd040', helper: 'NodeBuffer.From', requires: [bufferFromSupported] },
  { ruleId: 'binary.buffer.alloc', sha256: 'd3c73cc08f689cc9fc51b41e4b02a6e37972ce951ec9559a26a94c0c6488775e', helper: 'NodeBuffer.Alloc', requires: [bufferAllocSupported] },
  { ruleId: 'binary.buffer.byte-length', sha256: 'fb9725b22158a08ad5355bb223622253321bc6473a3e725bdf0636a13b2a3f11', helper: 'NodeBuffer.ByteLength', requires: [bufferByteLengthSupported] },
  { ruleId: 'binary.buffer.view', sha256: 'da2797e6e0f19aded9da0a3d6896058806b60e52644ee7aa21bea54fe501f718', helper: 'NodeBuffer.View', requires: [bufferViewOnly, bufferMetadataUnobserved] },
];

function nodeRequirement(key: string, value: unknown): Predicate {
  if (value !== true && key !== 'receiver')
    return { unknown: `Unsupported Node compatibility requirement ${key}=${JSON.stringify(value)}` };

  const flags: Record<string, Predicate> = {
    binding_resolves_to_node_events_eventemitter: { fact: 'node.binding', equals: 'events.EventEmitter' },
    constructor_not_replaced: { fact: 'node.constructor.integrity', equals: 'pristine' },
    receiver_inferred_as_node_event_emitter: { fact: 'node.receiver', equals: 'events.EventEmitter' },
    builtin_method_not_overridden: { fact: 'node.member.integrity', equals: 'pristine' },
    builtin_emit_not_overridden: { fact: 'node.member.integrity', equals: 'pristine' },
    no_registered_error_listener: { fact: 'node.event.errorListenerCount', equals: 0 },
    receiver_or_constructor_inferred_as_node_stream: { fact: 'node.receiver.family', equals: 'stream' },
    receiver_inferred_as_node_readable: { fact: 'node.receiver', equals: 'stream.Readable' },
    builtin_push_not_overridden: { fact: 'node.member.integrity', equals: 'pristine' },
    chunk_not_null: { fact: 'node.chunk.null', equals: false },
    builtin_read_not_overridden: { fact: 'node.member.integrity', equals: 'pristine' },
    receiver_inferred_as_node_writable: { fact: 'node.receiver', equals: 'stream.Writable' },
    builtin_write_not_overridden: { fact: 'node.member.integrity', equals: 'pristine' },
    builtin_end_not_overridden: { fact: 'node.member.integrity', equals: 'pristine' },
    builtin_on_not_overridden: { fact: 'node.member.integrity', equals: 'pristine' },
    binding_resolves_to_node_stream_duplex: { fact: 'node.binding', equals: 'stream.Duplex' },
    builtin_Buffer_binding: { fact: 'node.binding', equals: 'Buffer' },
    method_not_overridden: { fact: 'node.member.integrity', equals: 'pristine' },
    overload_resolved_by_static_analysis_or_runtime_helper: { fact: 'node.buffer.overloadResolved', equals: true },
    builtin_method_not_overridden_when_called: { fact: 'node.member.integrity', equals: 'pristine' },
  };

  if (key === 'receiver')
    return value === 'Node Buffer'
      ? { fact: 'node.receiver', equals: 'Buffer' }
      : { unknown: `Unsupported Node receiver requirement ${JSON.stringify(value)}` };

  return flags[key] ?? { unknown: `Unrecognized Node compatibility requirement ${key}` };
}

function aggregate(checks: readonly Proof[]): Verdict {
  if (checks.some(check => check.verdict === 'disproven')) return 'disproven';
  if (checks.some(check => check.verdict === 'unknown')) return 'unknown';
  return 'proven';
}

export class NodeCompatProofIndex {
  private readonly adapters = new Map<string, { loaded: LoadedRule; adapter: NodeCompatAdapter }>();

  public constructor(database: RuleDatabase, adapters: readonly NodeCompatAdapter[] = NODE_COMPAT_ADAPTERS) {
    for (const adapter of adapters) {
      if (this.adapters.has(adapter.ruleId)) throw new Error(`Duplicate Node adapter: ${adapter.ruleId}`);
      const loaded = database.byId.get(adapter.ruleId);
      if (!loaded) throw new Error(`Canonical Node rule is absent: ${adapter.ruleId}`);
      if (loaded.sha256 !== adapter.sha256)
        throw new Error(`Canonical Node rule changed: ${adapter.ruleId}; review before enabling it`);
      if (loaded.rule.target.helper !== adapter.helper)
        throw new Error(`Canonical helper changed for ${adapter.ruleId}: expected ${adapter.helper}`);
      this.adapters.set(adapter.ruleId, { loaded, adapter });
    }
  }

  public ruleIds(): readonly string[] {
    return [...this.adapters.keys()];
  }

  public prove(ruleId: string, facts: FactModel): NodeCompatProof {
    const entry = this.adapters.get(ruleId);
    if (!entry) throw new Error(`Node rule is not reviewed by this lane: ${ruleId}`);
    const upstream = Object.entries(entry.loaded.rule.source.requirements ?? {})
      .map(([key, value]) => nodeRequirement(key, value));
    const checks = [...upstream, ...(entry.adapter.requires ?? [])].map(predicate => evaluate(predicate, facts));
    return { ruleId, helper: entry.adapter.helper, verdict: aggregate(checks), checks };
  }
}

export async function loadNodeCompatProofIndex(ruleDbRoot: string): Promise<NodeCompatProofIndex> {
  return new NodeCompatProofIndex(await loadRules(ruleDbRoot));
}
