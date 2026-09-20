import { Facts } from '../analysis/facts.js';
import type { FactModel } from '../analysis/facts.js';
import type { RuleDatabase } from '../rules/loader.js';
import { loadRules } from '../rules/loader.js';
import { evaluate } from '../rules/requirements.js';
import type { Predicate, Verdict } from '../rules/requirements.js';

export interface MediaRuleContract {
  ruleId: string;
  path: string;
  sha256: string;
  strategy: 'helper' | 'runtime';
  purpose: string;
}

export interface MediaRuleCheck {
  key: string;
  verdict: Verdict;
  evidence: readonly string[];
}

export interface MediaRuleProof {
  contract: MediaRuleContract;
  verdict: Verdict | 'missing' | 'changed';
  checks: readonly MediaRuleCheck[];
  evidence: readonly string[];
}

/**
 * The pinned j2cs database does not yet own WebRTC/getUserMedia operations.
 * This lane therefore pins only the canonical Promise semantic dependency that
 * any eventual source lowering must reuse. Media API operations themselves stay
 * fail-closed until canonical rules are added upstream.
 */
export const MEDIA_RULE_CONTRACTS: readonly MediaRuleContract[] = [
  {
    ruleId: 'async.promise.resolve',
    path: 'rules/async/promise-resolve.json',
    sha256: '09dc2ebbf1a0b7be4cb61aaeed60fa2320129c7aad11ba7df9631a64423ca5bb',
    strategy: 'helper',
    purpose: 'media API promise settlement must reuse JavaScript PromiseResolve semantics rather than Task identity/scheduling',
  },
] as const;

export const MEDIA_FAIL_CLOSED_SURFACES = [
  'navigator.mediaDevices.enumerateDevices',
  'navigator.mediaDevices.getUserMedia',
  'navigator.mediaDevices.getDisplayMedia',
  'RTCPeerConnection construction and methods',
  'MediaStream/MediaStreamTrack EventTarget delivery',
] as const;

const contractById = new Map(MEDIA_RULE_CONTRACTS.map(contract => [contract.ruleId, contract]));

function contractState(database: RuleDatabase, contract: MediaRuleContract): 'proven' | 'missing' | 'changed' {
  const loaded = database.byId.get(contract.ruleId);
  if (!loaded) return 'missing';
  return loaded.sha256 === contract.sha256 &&
    loaded.rule.strategy === contract.strategy &&
    loaded.file.replaceAll('\\', '/') === contract.path ? 'proven' : 'changed';
}

function reviewedMediaRequirementPredicate(ruleId: string, key: string, value: unknown): Predicate {
  if (ruleId === 'async.promise.resolve' && key === 'constructor' && value === 'intrinsic Promise')
    return { fact: 'media.promise.constructor', equals: 'intrinsic Promise' };
  if (ruleId === 'async.promise.resolve' && key === 'method_not_overridden' && value === true)
    return { fact: 'media.promise.resolveIntegrity', equals: 'pristine' };
  return { unknown: `Unreviewed media requirement ${ruleId}:${key}=${JSON.stringify(value)}` };
}

function aggregate(verdicts: readonly Verdict[]): Verdict {
  if (verdicts.includes('disproven')) return 'disproven';
  if (verdicts.includes('unknown')) return 'unknown';
  return 'proven';
}

export function proveMediaRule(database: RuleDatabase, ruleId: string, facts: FactModel): MediaRuleProof {
  const contract = contractById.get(ruleId);
  if (!contract) {
    const missing: MediaRuleContract = {
      ruleId,
      path: '',
      sha256: '',
      strategy: 'runtime',
      purpose: 'unreviewed media rule request',
    };
    return { contract: missing, verdict: 'missing', checks: [], evidence: ['No reviewed media dependency contract exists for this rule ID.'] };
  }

  const state = contractState(database, contract);
  const loaded = database.byId.get(ruleId);
  if (state !== 'proven' || !loaded) {
    return {
      contract,
      verdict: state,
      checks: [],
      evidence: loaded ? [
        `rule-db path: ${loaded.file}`,
        `sha256: ${loaded.sha256}`,
        `strategy: ${loaded.rule.strategy}`,
      ] : [`Pinned rule DB does not contain ${ruleId}.`],
    };
  }

  const checks = Object.entries(loaded.rule.source.requirements ?? {}).map(([key, value]) => {
    const proof = evaluate(reviewedMediaRequirementPredicate(ruleId, key, value), facts);
    return { key, verdict: proof.verdict, evidence: proof.evidence };
  });
  return {
    contract,
    verdict: aggregate(checks.map(check => check.verdict)),
    checks,
    evidence: checks.flatMap(check => check.evidence),
  };
}

export function proveMediaRules(database: RuleDatabase, facts: FactModel): MediaRuleProof[] {
  return MEDIA_RULE_CONTRACTS.map(contract => proveMediaRule(database, contract.ruleId, facts));
}

export async function proveMediaRulesFromRoot(ruleDbRoot: string, facts: FactModel): Promise<MediaRuleProof[]> {
  return proveMediaRules(await loadRules(ruleDbRoot), facts);
}

/**
 * Host/runtime evidence is intentionally explicit. Merely parsing a media API
 * spelling cannot prove mutable Promise intrinsic integrity.
 */
export function mediaPromiseFacts(options: {
  intrinsicPromiseConstructor?: boolean;
  pristinePromiseResolve?: boolean;
}): FactModel {
  const facts = new Facts();
  if (options.intrinsicPromiseConstructor)
    facts.prove('media.promise.constructor', 'intrinsic Promise', 'host integration proved the intrinsic Promise constructor');
  if (options.pristinePromiseResolve)
    facts.prove('media.promise.resolveIntegrity', 'pristine', 'host integration proved Promise.resolve has not been replaced');
  return facts;
}

export const MEDIA_COMPILER_BOUNDARY = {
  sourceLowering: 'fail-closed',
  canonicalMediaRules: 'absent-in-pinned-rule-db',
  runtimeContract: 'available',
  promiseDependency: 'sha-pinned-canonical-proof',
} as const;
