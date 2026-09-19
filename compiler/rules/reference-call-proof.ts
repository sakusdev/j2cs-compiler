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
  sha256: string;
  strategy: Strategy;
  targetKind: string;
  helper?: string;
  requirements: Readonly<Record<string, string>>;
}

const contracts: Readonly<Record<ReferenceRuleId, ReferenceRuleContract>> = {
  'function.method-call.this-binding': {
    file: 'rules/functions/method-call-this-binding.json',
    sha256: '1ff73feb23ecf24192ef244b7c44139813709171b88e7c2d0d457899a5dab1cb',
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
    sha256: 'f1043ffe0da35a118dde24b58145608474413cdaf37462f796e403c67c2f057f',
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
    sha256: '904f0313e9c1a836ed26f413c6339473e4c589a644eed4091826e81757a00666',
    strategy: 'helper',
    targetKind: 'helper',
    helper: 'JsFunction.InvokeStrict',
    requirements: {
      ordinary_strict_function: 'function.this.strict',
    },
  },
  'function.this.sloppy': {
    file: 'rules/functions/this-sloppy.json',
    sha256: 'a64ef3b5991ebf983e4757393c002c57979b75557816adfa84657101569da91a',
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
    sha256: 'b04c8bb5bf48cc8e1988fc202022050d7a274255e0da5cb06b65ea8df44d39b8',
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
 * validates its complete reviewed SHA256 plus requirement vocabulary/target shape, then maps
 * only those named requirements onto generic semantic facts. Any upstream drift fails closed.
 *
 * This module is intentionally not wired into the shared global adapter registry while the
 * FUNCTIONS_CLOSURES PR owns that integration surface.
 */
export function proveReferenceRule(database: RuleDatabase, id: ReferenceRuleId, facts: FactModel): ReferenceRuleProof {
  const contract = contracts[id];
  const loaded = database.byId.get(id);
  if (!loaded) return fail('E_RULE_MISSING', `Canonical reference rule is absent: ${id}`);
  if (loaded.sha256 !== contract.sha256) {
    return fail('E_RULE_CONTRACT', `Canonical reference rule changed and requires proof-adapter review: ${id}`);
  }
  const normalizedFile = loaded.file.replaceAll('\\\\', '/');
  if (normalizedFile !== contract.file || loaded.rule.strategy !== contract.strategy
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
