import { fail } from '../diagnostics/index.js';
import type { FactModel } from '../analysis/facts.js';
import type { LoadedRule, RuleDatabase, Strategy } from './loader.js';

export type ReferenceRuleId =
  | 'function.method-call.this-binding'
  | 'function.method-extraction-loses-this'
  | 'function.this.strict'
  | 'function.this.sloppy'
  | 'function.evaluation-order.call';

interface ReferenceRuleContract {
  file: string;
  strategy: Strategy;
  targetKind: string;
  helper?: string;
  requirements: Readonly<Record<string, string>>;
}

const contracts: Readonly<Record<ReferenceRuleId, ReferenceRuleContract>> = {
  'function.method-call.this-binding': {
    file: 'rules/functions/method-call-this-binding.json',
    strategy: 'helper',
    targetKind: 'helper',
    helper: 'JsFunction.Call',
    requirements: {
      property_resolves_to_known_js_function: 'call.property.knownJsFunction',
      getter_side_effects_accounted_for: 'call.lookup.effectsAccountedFor',
      method_not_proxy: 'call.method.notProxy',
    },
  },
  'function.method-extraction-loses-this': {
    file: 'rules/functions/method-extraction-loses-this.json',
    strategy: 'helper',
    targetKind: 'helper',
    helper: 'JsFunction.Call',
    requirements: {
      property_value_is_js_function: 'call.extraction.propertyValueJsFunction',
      ordinary_call_after_extraction: 'call.extraction.ordinaryCall',
    },
  },
  'function.this.strict': {
    file: 'rules/functions/this-strict.json',
    strategy: 'helper',
    targetKind: 'helper',
    helper: 'JsFunction.InvokeStrict',
    requirements: {
      ordinary_strict_function: 'function.this.strict',
    },
  },
  'function.this.sloppy': {
    file: 'rules/functions/this-sloppy.json',
    strategy: 'helper',
    targetKind: 'helper',
    helper: 'JsFunction.InvokeSloppy',
    requirements: {
      ordinary_non_strict_function: 'function.this.sloppy',
      script_or_host_global_this_known: 'host.globalThis.known',
    },
  },
  'function.evaluation-order.call': {
    file: 'rules/functions/evaluation-order-call.json',
    strategy: 'native',
    targetKind: 'csharp',
    requirements: {
      side_effectful_callee_or_arguments: 'call.sideEffectful',
    },
  },
};

export type ReferenceRequirementVerdict = 'proven' | 'disproven' | 'unknown';

export interface ReferenceRequirementCheck {
  requirement: string;
  fact: string;
  verdict: ReferenceRequirementVerdict;
  evidence: string;
}

export interface ReferenceRuleProof {
  rule: LoadedRule;
  verdict: ReferenceRequirementVerdict;
  checks: ReferenceRequirementCheck[];
}

/**
 * Narrow proof adapter for the reference/this lane. It consumes the pinned j2cs rule object,
 * validates the reviewed requirement vocabulary/target shape, then maps only those named
 * requirements onto generic semantic facts. Requirement drift fails closed.
 *
 * This module is intentionally not wired into the shared global adapter registry while the
 * FUNCTIONS_CLOSURES PR owns that integration surface.
 */
export function proveReferenceRule(database: RuleDatabase, id: ReferenceRuleId, facts: FactModel): ReferenceRuleProof {
  const contract = contracts[id];
  const loaded = database.byId.get(id);
  if (!loaded) return fail('E_RULE_MISSING', `Canonical reference rule is absent: ${id}`);
  if (loaded.file !== contract.file || loaded.rule.strategy !== contract.strategy
      || loaded.rule.target.kind !== contract.targetKind || loaded.rule.target.helper !== contract.helper) {
    return fail('E_RULE_CONTRACT', `Canonical reference rule changed shape and requires review: ${id}`);
  }

  const requirements = loaded.rule.source.requirements ?? {};
  const expectedKeys = Object.keys(contract.requirements).sort();
  const actualKeys = Object.keys(requirements).sort();
  if (expectedKeys.length !== actualKeys.length || expectedKeys.some((key, i) => key !== actualKeys[i])) {
    return fail('E_RULE_CONTRACT', `Canonical reference requirements changed and require review: ${id}`);
  }

  const checks = expectedKeys.map((requirement): ReferenceRequirementCheck => {
    if (requirements[requirement] !== true) {
      return fail('E_RULE_CONTRACT', `Unsupported canonical requirement value for ${id}: ${requirement}`);
    }
    const factName = contract.requirements[requirement]!;
    const fact = facts.get(factName);
    if (!fact) return { requirement, fact: factName, verdict: 'unknown', evidence: `No evidence for ${factName}` };
    return {
      requirement,
      fact: factName,
      verdict: fact.value === true ? 'proven' : 'disproven',
      evidence: fact.evidence,
    };
  });

  const verdict: ReferenceRequirementVerdict = checks.some(check => check.verdict === 'disproven')
    ? 'disproven'
    : checks.some(check => check.verdict === 'unknown') ? 'unknown' : 'proven';
  return { rule: loaded, verdict, checks };
}
