import { Facts, type FactModel } from '../analysis/facts.js';
import type { LoadedRule, RuleDatabase } from '../rules/loader.js';
import { evaluate, type Predicate, type Proof, type RequirementsProof, type Verdict } from '../rules/requirements.js';

export interface RendererRuleAdapter {
  ruleId: string;
  sha256: string;
  operation: string;
  lowering: string;
}

/**
 * Reviewed renderer/Web adapters are intentionally isolated from the general compiler
 * registry until renderer/module/function workstreams are merged. This lets host
 * contracts be proved without pretending parser/lowering integration.
 */
export const rendererWebAdapters: readonly RendererRuleAdapter[] = [
  { ruleId: 'dom.event.constructor', sha256: 'PENDING', operation: 'event.construct', lowering: 'WebCompat.JsDomEvent' },
  { ruleId: 'dom.eventtarget.add-event-listener', sha256: 'PENDING', operation: 'eventTarget.add', lowering: 'WebCompat.JsEventTarget.AddEventListener' },
  { ruleId: 'dom.eventtarget.remove-event-listener', sha256: 'PENDING', operation: 'eventTarget.remove', lowering: 'WebCompat.JsEventTarget.RemoveEventListener' },
  { ruleId: 'dom.eventtarget.dispatch-event', sha256: 'PENDING', operation: 'eventTarget.dispatch', lowering: 'WebCompat.JsEventTarget.DispatchEvent' },
  { ruleId: 'dom.event.prevent-default', sha256: 'PENDING', operation: 'event.preventDefault', lowering: 'WebCompat.JsDomEvent.PreventDefault' },
  { ruleId: 'dom.event.stop-propagation', sha256: 'PENDING', operation: 'event.stopPropagation', lowering: 'WebCompat.JsDomEvent.StopPropagation' },
  { ruleId: 'dom.event.stop-immediate-propagation', sha256: 'PENDING', operation: 'event.stopImmediatePropagation', lowering: 'WebCompat.JsDomEvent.StopImmediatePropagation' },
  { ruleId: 'web.blob.constructor', sha256: 'PENDING', operation: 'blob.construct', lowering: 'WebCompat.JsBlob.Create' },
  { ruleId: 'web.blob.string-part', sha256: 'PENDING', operation: 'blob.stringPart', lowering: 'WebCompat.JsBlobPart.FromString' },
  { ruleId: 'web.blob.size', sha256: 'PENDING', operation: 'blob.size', lowering: 'WebCompat.JsBlob.Size' },
  { ruleId: 'web.blob.type', sha256: 'PENDING', operation: 'blob.type', lowering: 'WebCompat.JsBlob.Type' },
  { ruleId: 'web.blob.slice', sha256: 'PENDING', operation: 'blob.slice', lowering: 'WebCompat.JsBlob.Slice' },
  { ruleId: 'web.file.constructor', sha256: 'PENDING', operation: 'file.construct', lowering: 'WebCompat.JsFile.Create' },
  { ruleId: 'web.file.name', sha256: 'PENDING', operation: 'file.name', lowering: 'WebCompat.JsFile.Name' },
  { ruleId: 'web.file.last-modified', sha256: 'PENDING', operation: 'file.lastModified', lowering: 'WebCompat.JsFile.LastModified' },
];

const byId = new Map(rendererWebAdapters.map(adapter => [adapter.ruleId, adapter]));

function eq(fact: string, equals: string | number | boolean): Predicate {
  return { fact, equals };
}

function requirementPredicate(key: string, value: unknown): Predicate {
  if (key === 'receiver' && typeof value === 'string') return eq('renderer.receiverKind', value);
  if (key === 'receiver_inferred_as' && typeof value === 'string') return eq('renderer.receiverKind', value);
  if (key === 'part_inferred_as' && typeof value === 'string') return eq('renderer.partKind', value);
  if (value !== true) return { unknown: 'Unsupported renderer requirement ' + key + '=' + JSON.stringify(value) };

  const flags: Record<string, Predicate> = {
    builtin_constructor_not_overridden: eq('renderer.constructorIntegrity', 'pristine'),
    timestamp_unobservable_or_supported: eq('renderer.eventTimestamp', 'unobserved-or-supported'),
    builtin_not_overridden: eq('renderer.memberIntegrity', 'pristine'),
    callback_statically_supported: eq('renderer.callbackSupported', true),
    proxy_listener_unobservable: eq('renderer.listenerProxyObservable', false),
    native_event_subsystem: eq('renderer.eventSubsystem', 'WebCompat.EventTarget.v1'),
    callback_identity_preserved: eq('renderer.callbackIdentity', 'explicit-handle'),
    event_is_native_dom_event: eq('renderer.eventRepresentation', 'JsDomEvent'),
    host_activation_behavior_unobservable_or_supported: eq('renderer.hostActivation', 'unobserved-or-supported'),
    global_constructor_resolves_to_builtin: eq('renderer.globalConstructorIntegrity', 'pristine'),
    builtin_webidl_member_not_overridden: eq('renderer.memberIntegrity', 'pristine'),
    method_resolves_to_blob_builtin: eq('renderer.memberIntegrity', 'pristine'),
  };
  return flags[key] ?? { unknown: 'Unrecognized renderer requirement ' + key + '=true' };
}

function backendPredicates(adapter: RendererRuleAdapter): Predicate[] {
  if (adapter.operation.startsWith('eventTarget.'))
    return [eq('renderer.eventTargetFlavor', 'standalone')];
  if (adapter.operation === 'blob.construct' || adapter.operation === 'file.construct') {
    return [
      eq('renderer.blobPartDomain', 'WebCompatKnownParts'),
      eq('renderer.blobOptions', 'type+endings'),
    ];
  }
  return [];
}

function aggregate(checks: readonly Proof[]): Verdict {
  const verdicts = checks.map(check => check.verdict);
  return verdicts.includes('disproven') ? 'disproven' : verdicts.includes('unknown') ? 'unknown' : 'proven';
}

function loadReviewedRule(database: RuleDatabase, adapter: RendererRuleAdapter): LoadedRule {
  const loaded = database.byId.get(adapter.ruleId);
  if (!loaded) throw new Error('Reviewed renderer rule is absent: ' + adapter.ruleId);
  if (loaded.sha256 !== adapter.sha256)
    throw new Error('Canonical renderer rule changed: ' + adapter.ruleId + '; expected ' + adapter.sha256 + ', actual ' + loaded.sha256);
  return loaded;
}

export interface RendererRuleProof extends RequirementsProof {
  ruleId: string;
  operation: string;
  lowering: string;
  ruleFile: string;
  sha256: string;
}

export function proveRendererRule(database: RuleDatabase, ruleId: string, facts: FactModel): RendererRuleProof {
  const adapter = byId.get(ruleId);
  if (!adapter) throw new Error('Renderer rule is not enabled by this lane: ' + ruleId);
  const loaded = loadReviewedRule(database, adapter);
  const predicates = [
    ...Object.entries(loaded.rule.source.requirements ?? {}).map(([key, value]) => requirementPredicate(key, value)),
    ...backendPredicates(adapter),
  ];
  const checks = predicates.map(predicate => evaluate(predicate, facts));
  return {
    ruleId,
    operation: adapter.operation,
    lowering: adapter.lowering,
    ruleFile: loaded.file,
    sha256: loaded.sha256,
    verdict: aggregate(checks),
    checks,
    constraints: predicates.map(predicate => JSON.stringify(predicate)).sort(),
  };
}

export function standaloneEventFacts(receiverKind: 'EventTarget' | 'Event' = 'EventTarget'): Facts {
  return new Facts()
    .prove('renderer.receiverKind', receiverKind, 'Exact WebCompat event receiver')
    .prove('renderer.constructorIntegrity', 'pristine', 'Event constructor is statically resolved')
    .prove('renderer.memberIntegrity', 'pristine', 'Event/EventTarget builtin member is statically selected')
    .prove('renderer.eventTimestamp', 'unobserved-or-supported', 'Event.timeStamp is outside this contract')
    .prove('renderer.callbackSupported', true, 'Listener uses an explicit identity-bearing callback handle')
    .prove('renderer.listenerProxyObservable', false, 'Proxy listener entry is not admitted')
    .prove('renderer.eventSubsystem', 'WebCompat.EventTarget.v1', 'Dedicated synchronous EventTarget runtime')
    .prove('renderer.callbackIdentity', 'explicit-handle', 'Listener identity is handle reference identity')
    .prove('renderer.eventRepresentation', 'JsDomEvent', 'Dedicated DOM event state object')
    .prove('renderer.hostActivation', 'unobserved-or-supported', 'Standalone EventTarget has no activation behavior')
    .prove('renderer.eventTargetFlavor', 'standalone', 'DOM node-tree propagation is deliberately not wired');
}

export function blobFacts(receiverKind: 'Blob' | 'File' = 'Blob', partKind = 'string'): Facts {
  return new Facts()
    .prove('renderer.receiverKind', receiverKind, 'Exact WebCompat Blob/File receiver')
    .prove('renderer.globalConstructorIntegrity', 'pristine', 'Blob/File global constructor is statically resolved')
    .prove('renderer.memberIntegrity', 'pristine', 'Blob/File member is statically selected')
    .prove('renderer.partKind', partKind, 'Compiler-side BlobPart proof')
    .prove('renderer.blobPartDomain', 'WebCompatKnownParts', 'Only explicit string/byte/blob parts enter the helper')
    .prove('renderer.blobOptions', 'type+endings', 'WebCompat models Blob type and endings options');
}
