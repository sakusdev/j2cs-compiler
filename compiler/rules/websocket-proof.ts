import { fail } from '../diagnostics/index.js';
import type { RuleDatabase } from './loader.js';

export type WebSocketRuleId =
  | 'web.websocket.constructor.url'
  | 'web.websocket.constructor.protocols'
  | 'web.websocket.constructor.http-scheme-normalization'
  | 'web.websocket.ready-state'
  | 'web.websocket.send.text'
  | 'web.websocket.send.connecting-error'
  | 'web.websocket.buffered-amount'
  | 'web.websocket.buffered-amount-after-close'
  | 'web.websocket.close.code-validation'
  | 'web.websocket.close.reason-validation'
  | 'web.websocket.close.queued-messages'
  | 'web.websocket.event.open'
  | 'web.websocket.event.message'
  | 'web.websocket.event.error'
  | 'web.websocket.event.close'
  | 'web.websocket.network-runtime-boundary';

type ProofFact = 'webBuiltinIntegrity' | 'networkBoundary' | 'urlResolution' | 'taskDispatch';

export interface Evidence<T extends string> {
  value: T;
  evidence: string;
}

export interface WebSocketProofFacts {
  webBuiltinIntegrity?: Evidence<'pristine' | 'mutated'>;
  networkBoundary?: Evidence<'browser-host' | 'raw-socket'>;
  urlResolution?: Evidence<'relevant-settings-object' | 'missing-base'>;
  taskDispatch?: Evidence<'event-loop' | 'synchronous'>;
}

export interface WebSocketRuleContract {
  id: WebSocketRuleId;
  sha256: string;
  requires: readonly ProofFact[];
}

export interface WebSocketRuleProof {
  id: WebSocketRuleId;
  verdict: 'proven' | 'disproven' | 'unknown';
  evidence: readonly string[];
}

export const WEBSOCKET_RULE_CONTRACTS: readonly WebSocketRuleContract[] = [
  { id: 'web.websocket.constructor.url', sha256: '51caa2339f95ffc80db6479055aa439ea17ac76652cb57d316bc06a3b23c9dd1', requires: ['webBuiltinIntegrity', 'networkBoundary', 'urlResolution'] },
  { id: 'web.websocket.constructor.protocols', sha256: '749d74b3d350b4858376bfd78db67dfffff984536b9aa3baee6ba1a700e16cdf', requires: ['webBuiltinIntegrity', 'networkBoundary'] },
  { id: 'web.websocket.constructor.http-scheme-normalization', sha256: 'd227882e5cb5c41df6b9ce9b469b0dcf6faab6e2a35e21076e58bc4acafa73bc', requires: ['webBuiltinIntegrity', 'networkBoundary', 'urlResolution'] },
  { id: 'web.websocket.ready-state', sha256: '872ebe701eb95b57059d7b7a920484dc0fb99082760c408e42c3884defe86410', requires: ['webBuiltinIntegrity', 'networkBoundary'] },
  { id: 'web.websocket.send.text', sha256: '1086871d8f2a242d3b7cbf1366c557c62beb6eaa3405dabc78101ef2d8fc92d4', requires: ['webBuiltinIntegrity', 'networkBoundary'] },
  { id: 'web.websocket.send.connecting-error', sha256: 'f333e6ec405580567ca15d59587e415a32bce17c5b70df82abcb92888d7e06fd', requires: ['webBuiltinIntegrity', 'networkBoundary'] },
  { id: 'web.websocket.buffered-amount', sha256: '17038a9b233b16c18b4f5591d81c8810b506f61343b6a5fb2dc96ae3555ae435', requires: ['webBuiltinIntegrity', 'networkBoundary'] },
  { id: 'web.websocket.buffered-amount-after-close', sha256: '2424d55c80469196d84f2d9123f7eb0fd08ffa3d24e74b406be46167c4953b89', requires: ['webBuiltinIntegrity', 'networkBoundary'] },
  { id: 'web.websocket.close.code-validation', sha256: '13d9e861dd447ba9a9c7cbcac74de8c4eac700ab9fe8064d5a0c0b1739a8bd89', requires: ['webBuiltinIntegrity', 'networkBoundary'] },
  { id: 'web.websocket.close.reason-validation', sha256: '55fe0b4801fc094773dae165f843fe12133d1b359cf72b976ba71aadd2328c69', requires: ['webBuiltinIntegrity', 'networkBoundary'] },
  { id: 'web.websocket.close.queued-messages', sha256: '9448a4c4aba8fb69ba14f6bf005c6cab46883978c5ad2184dc6e384584ee720b', requires: ['webBuiltinIntegrity', 'networkBoundary'] },
  { id: 'web.websocket.event.open', sha256: 'e2d3c233a52153b918d03e8412f3db48bad846081a13d77fb70601e1636baf2c', requires: ['webBuiltinIntegrity', 'networkBoundary', 'taskDispatch'] },
  { id: 'web.websocket.event.message', sha256: 'aadce0c32d889503d2ccf2f2ffa60f4d41759e080ebb5af122ecfb122f4b1fc1', requires: ['webBuiltinIntegrity', 'networkBoundary', 'taskDispatch'] },
  { id: 'web.websocket.event.error', sha256: 'fac53e92a92c62902fc7d80930e0a1406d3975b2138e6cb02314f480afa86ae8', requires: ['webBuiltinIntegrity', 'networkBoundary', 'taskDispatch'] },
  { id: 'web.websocket.event.close', sha256: 'a979d8ae33f9aa1fc7fb3251d5c4b3fa2c4ecff2280480debac6506ccf8644eb', requires: ['webBuiltinIntegrity', 'networkBoundary', 'taskDispatch'] },
  { id: 'web.websocket.network-runtime-boundary', sha256: 'c16074581f1adff11f2dff75216fb9a84a38ec9511ac42ec7d0a60f611a4c185', requires: ['webBuiltinIntegrity', 'networkBoundary'] },
] as const;

const contracts = new Map<WebSocketRuleId, WebSocketRuleContract>(
  WEBSOCKET_RULE_CONTRACTS.map(contract => [contract.id, contract])
);

function checkFact(name: ProofFact, facts: WebSocketProofFacts): { verdict: 'proven' | 'disproven' | 'unknown'; evidence: string } {
  if (name === 'webBuiltinIntegrity') {
    if (!facts.webBuiltinIntegrity) return { verdict: 'unknown', evidence: 'No proof that the WebSocket builtin is pristine.' };
    return {
      verdict: facts.webBuiltinIntegrity.value === 'pristine' ? 'proven' : 'disproven',
      evidence: facts.webBuiltinIntegrity.evidence
    };
  }
  if (name === 'networkBoundary') {
    if (!facts.networkBoundary) return { verdict: 'unknown', evidence: 'No browser-host network boundary proof.' };
    return {
      verdict: facts.networkBoundary.value === 'browser-host' ? 'proven' : 'disproven',
      evidence: facts.networkBoundary.evidence
    };
  }
  if (name === 'urlResolution') {
    if (!facts.urlResolution) return { verdict: 'unknown', evidence: 'No relevant-settings-object URL resolution proof.' };
    return {
      verdict: facts.urlResolution.value === 'relevant-settings-object' ? 'proven' : 'disproven',
      evidence: facts.urlResolution.evidence
    };
  }
  if (!facts.taskDispatch) return { verdict: 'unknown', evidence: 'No event-loop dispatch proof.' };
  return {
    verdict: facts.taskDispatch.value === 'event-loop' ? 'proven' : 'disproven',
    evidence: facts.taskDispatch.evidence
  };
}

/**
 * Pins the complete upstream rule and adds stricter backend obligations.
 * Missing evidence stays unknown; raw-socket or synchronous substitutions are disproven.
 */
export function proveWebSocketRule(database: RuleDatabase, id: WebSocketRuleId, facts: WebSocketProofFacts): WebSocketRuleProof {
  const contract = contracts.get(id);
  if (!contract) return fail('E_RULE_MISSING', `No reviewed WebSocket contract for ${id}.`);
  const loaded = database.byId.get(id);
  if (!loaded) return fail('E_RULE_MISSING', `Reviewed rule is absent: ${id}`);
  if (loaded.sha256 !== contract.sha256)
    return fail('E_RULE_CONTRACT', `Rule ${id} changed; review its WebSocket adapter before enabling it.`);

  const requirements = loaded.rule.source.requirements ?? {};
  if (Object.keys(requirements).length !== 1 || requirements.web_builtin_not_overridden !== true)
    return fail('E_RULE_CONTRACT', `Rule ${id} no longer has the reviewed web_builtin_not_overridden requirement.`);

  const checks = contract.requires.map(required => checkFact(required, facts));
  const verdict = checks.some(check => check.verdict === 'disproven')
    ? 'disproven'
    : checks.some(check => check.verdict === 'unknown') ? 'unknown' : 'proven';
  return { id, verdict, evidence: checks.map(check => check.evidence) };
}
