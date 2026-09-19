import { fail } from '../diagnostics/index.js';
import type { FactModel } from '../analysis/facts.js';
import { evaluate, type Predicate, type RequirementsProof } from './requirements.js';
import type { LoadedRule, RuleDatabase } from './loader.js';

export interface PromiseCoreContract {
  ruleId: string;
  sha256: string;
  selector: string;
  lowering: string;
  helper: string;
}

export const PROMISE_CORE_CONTRACTS: readonly PromiseCoreContract[] = [
  {
    ruleId: 'async.promise.constructor',
    sha256: '6916e160490ee40d11f9a0f971b7f8e28d7665907d1b30a28e19b469795fc24b',
    selector: 'promise.constructor',
    lowering: 'promise.create',
    helper: 'JsPromise.Create',
  },
  {
    ruleId: 'async.promise.resolve',
    sha256: '09dc2ebbf1a0b7be4cb61aaeed60fa2320129c7aad11ba7df9631a64423ca5bb',
    selector: 'promise.resolve',
    lowering: 'promise.resolve',
    helper: 'JsPromise.Resolve',
  },
  {
    ruleId: 'async.promise.reject',
    sha256: '49a0fcaf4f915f855ddfcd13244251de58eb500200f853df7b1dd05ee2d0870c',
    selector: 'promise.reject',
    lowering: 'promise.reject',
    helper: 'JsPromise.Reject',
  },
  {
    ruleId: 'async.promise.then',
    sha256: '295484006af1f31150f6348e010220e98ac0c81ccc8aa40475f8f405a502f09d',
    selector: 'promise.then',
    lowering: 'promise.then',
    helper: 'JsPromise.Then',
  },
  {
    ruleId: 'async.promise.catch',
    sha256: '449c509fa499708df12355b87c602c0680c8526161ce6912ffacc2aa582b45b5',
    selector: 'promise.catch',
    lowering: 'promise.catch',
    helper: 'JsPromise.Catch',
  },
  {
    ruleId: 'async.promise.finally',
    sha256: 'cdbcd4f3d0bd02ca3306cfef1a0de16e47e08804b1fac883f1729b39216183a9',
    selector: 'promise.finally',
    lowering: 'promise.finally',
    helper: 'JsPromise.Finally',
  },
];

function contract(ruleId: string): PromiseCoreContract {
  const found = PROMISE_CORE_CONTRACTS.find(c => c.ruleId === ruleId);
  if (!found) return fail('E_PROMISE_RULE', `Unsupported Promise core rule contract: ${ruleId}`);
  return found;
}

function checkedRule(database: RuleDatabase, ruleId: string): LoadedRule {
  const expected = contract(ruleId);
  const loaded = database.byId.get(ruleId);
  if (!loaded) return fail('E_RULE_MISSING', `Canonical Promise rule is absent: ${ruleId}`);
  if (loaded.sha256 !== expected.sha256)
    return fail('E_RULE_CONTRACT', `Canonical Promise rule changed: ${ruleId}; review the async adapter before enabling it.`);
  if (loaded.rule.strategy !== 'helper' || loaded.rule.target.helper !== expected.helper)
    return fail('E_RULE_CONTRACT', `Canonical Promise helper contract changed: ${ruleId}`);
  return loaded;
}

const eq = (fact: string, equals: string | boolean): Predicate => ({ fact, equals });

function requirementPredicate(ruleId: string, key: string, value: unknown): Predicate {
  if (key === 'constructor' && value === 'intrinsic Promise') return eq('promise.constructor', 'intrinsic');
  if (key === 'constructor_not_overridden' && value === true) return eq('promise.constructor.integrity', 'pristine');
  if (key === 'executor' && value === 'callable') return eq('promise.executor', 'callable');
  if (key === 'receiver' && value === 'proven intrinsic Promise representation')
    return eq('promise.receiver.representation', 'JsPromise');
  if (key === 'species' && value === 'intrinsic Promise') return eq('promise.species', 'intrinsic');

  const methodKeys: Record<string, string> = {
    builtin_then_not_overridden: 'then',
    builtin_catch_not_overridden: 'catch',
    builtin_finally_not_overridden: 'finally',
  };
  if (value === true && methodKeys[key])
    return eq(`promise.method.${methodKeys[key]}.integrity`, 'pristine');

  if (key === 'method_not_overridden' && value === true) {
    const method = ruleId === 'async.promise.resolve' ? 'resolve'
      : ruleId === 'async.promise.reject' ? 'reject'
      : undefined;
    if (method) return eq(`promise.method.${method}.integrity`, 'pristine');
  }

  return { unknown: `Unrecognized Promise requirement ${key}=${JSON.stringify(value)} for ${ruleId}` };
}

export function provePromiseCoreRule(database: RuleDatabase, ruleId: string, facts: FactModel): RequirementsProof {
  const loaded = checkedRule(database, ruleId);
  const requirements = loaded.rule.source.requirements ?? {};
  const predicates = Object.entries(requirements).map(([key, value]) => requirementPredicate(ruleId, key, value));
  const checks = predicates.map(p => evaluate(p, facts));
  const verdict = checks.some(c => c.verdict === 'disproven') ? 'disproven'
    : checks.some(c => c.verdict === 'unknown') ? 'unknown' : 'proven';
  return {
    verdict,
    checks,
    constraints: [...new Set(predicates.map(p => JSON.stringify(p)))].sort(),
  };
}

export function validatePromiseCoreContracts(database: RuleDatabase): void {
  for (const { ruleId } of PROMISE_CORE_CONTRACTS) checkedRule(database, ruleId);
}
