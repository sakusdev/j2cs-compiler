import { Facts } from '../analysis/facts.js';
import type { FactModel } from '../analysis/facts.js';
import type { RuleDatabase } from '../rules/loader.js';
import { loadRules } from '../rules/loader.js';
import { evaluate } from '../rules/requirements.js';
import type { Predicate, Verdict } from '../rules/requirements.js';
import type { BundleAnalysis, CanonicalBundleRuleContract, CanonicalRuleProof } from './model.js';

export const BUNDLE_RULE_CONTRACTS: readonly CanonicalBundleRuleContract[] = [
  {
    ruleId: 'modules.esm.evaluate-once',
    path: 'rules/modules/esm-evaluate-once.json',
    sha256: 'dfaca413b2a23b81fc08df03e32cd51683f6e75f23ae9aab2a39f655ddc1aaaf',
    strategy: 'runtime',
    purpose: 'one module record executes once and importers share its identity',
  },
  {
    ruleId: 'modules.esm.dependency-evaluation-order',
    path: 'rules/modules/esm-dependency-evaluation-order.json',
    sha256: 'f7175da20aee24a1c0369ebb9309f16d53cb2a73802d4674a0d3c599856f7b7d',
    strategy: 'runtime',
    purpose: 'dependency evaluation precedes importer execution without textual substitution',
  },
  {
    ruleId: 'node.module-resolution.dynamic-import',
    path: 'rules/node_vm_module_resolution/node-module-resolution-dynamic-import.json',
    sha256: 'ecd244773ad89c9e61ae923cdf4f8d37326ac376bc864880bffd6b432172bea4',
    strategy: 'runtime',
    purpose: 'Node dynamic import resolves asynchronously and reuses module semantics',
  },
  {
    ruleId: 'async.promise.then',
    path: 'rules/async/promise-then.json',
    sha256: '295484006af1f31150f6348e010220e98ac0c81ccc8aa40475f8f405a502f09d',
    strategy: 'helper',
    purpose: 'preload continuations retain Promise-job ordering',
  },
  {
    ruleId: 'async.promise.resolve',
    path: 'rules/async/promise-resolve.json',
    sha256: '09dc2ebbf1a0b7be4cb61aaeed60fa2320129c7aad11ba7df9631a64423ca5bb',
    strategy: 'helper',
    purpose: 'bundle bootstrap Promise.resolve keeps JavaScript Promise resolution semantics',
  },
  {
    ruleId: 'symbol.for.primitive-key',
    path: 'rules/symbol/for-primitive-key.json',
    sha256: 'c0f0d7c24928890d38bf11d510059c69cc82c7606426f864fc1ebdda7d870273',
    strategy: 'helper',
    purpose: 'production React registered tags use the process-wide Symbol.for registry',
  },
  {
    ruleId: 'object.assign',
    path: 'rules/object/assign.json',
    sha256: '67742b24dc9ede119f746df6cabfd3a5c3fe16bf8319da146b61bc41b0a550a5',
    strategy: 'runtime',
    purpose: 'bundled Object.assign preserves key ordering, accessors, and partial failure semantics',
  },
] as const;

const byId = new Map(BUNDLE_RULE_CONTRACTS.map(contract => [contract.ruleId, contract]));

export function bundleRuleContract(ruleId: string): CanonicalBundleRuleContract | undefined {
  return byId.get(ruleId);
}

export function proveBundleRuleContracts(database: RuleDatabase, ruleIds: readonly string[]): CanonicalRuleProof[] {
  return [...new Set(ruleIds)].map(ruleId => {
    const contract = byId.get(ruleId);
    if (!contract) {
      return {
        contract: { ruleId, path: '', sha256: '', strategy: 'runtime', purpose: 'unreviewed bundle rule request' },
        verdict: 'missing',
        evidence: ['No reviewed bundle contract exists for this rule ID.'],
      };
    }
    const loaded = database.byId.get(ruleId);
    if (!loaded) return { contract, verdict: 'missing', evidence: [`Pinned rule DB does not contain ${ruleId}.`] };
    const strategyMatches = loaded.rule.strategy === contract.strategy;
    const hashMatches = loaded.sha256 === contract.sha256;
    const pathMatches = loaded.file.replaceAll('\\', '/') === contract.path;
    return {
      contract,
      verdict: hashMatches && strategyMatches && pathMatches ? 'proven' : 'changed',
      evidence: [
        `rule-db path: ${loaded.file}`,
        `sha256: ${loaded.sha256}`,
        `strategy: ${loaded.rule.strategy}`,
      ],
    };
  });
}

export async function proveBundleRuleContractsFromRoot(ruleDbRoot: string, ruleIds: readonly string[]): Promise<CanonicalRuleProof[]> {
  return proveBundleRuleContracts(await loadRules(ruleDbRoot), ruleIds);
}


export interface BundleRequirementCheck {
  key: string;
  verdict: Verdict;
  evidence: readonly string[];
}

export interface BundleRequirementProof {
  ruleId: string;
  verdict: Verdict | 'missing' | 'changed';
  checks: readonly BundleRequirementCheck[];
  evidence: readonly string[];
}

/**
 * Translate only requirement vocabulary reviewed for this bundle lane.
 * Any upstream requirement drift or new key remains unknown and therefore fail-closed.
 */
function reviewedBundleRequirementPredicate(ruleId: string, key: string, value: unknown): Predicate {
  if (
    (ruleId === 'modules.esm.evaluate-once' || ruleId === 'modules.esm.dependency-evaluation-order') &&
    key === 'source_type' && value === 'ECMAScript module'
  ) return { fact: 'bundle.sourceType', equals: 'ECMAScript module' };

  if (
    ruleId === 'modules.esm.dependency-evaluation-order' &&
    key === 'graph_statically_known_or_runtime_linked' && value === true
  ) return { fact: 'bundle.moduleGraphLinked', equals: true };

  if (
    ruleId === 'node.module-resolution.dynamic-import' &&
    key === 'host' && value === 'Node.js'
  ) return { fact: 'profile.host', equals: 'Node.js' };

  if (
    ruleId === 'node.module-resolution.dynamic-import' &&
    key === 'specifier_may_be_dynamic' && value === true
  ) return { fact: 'bundle.dynamicSpecifierAllowed', equals: true };

  if (
    ruleId === 'async.promise.then' &&
    key === 'receiver' && value === 'proven intrinsic Promise representation'
  ) return { fact: 'bundle.promise.receiver', equals: 'intrinsic Promise' };

  if (
    ruleId === 'async.promise.then' &&
    key === 'builtin_then_not_overridden' && value === true
  ) return { fact: 'bundle.promise.thenIntegrity', equals: 'pristine' };

  if (
    ruleId === 'async.promise.then' &&
    key === 'species' && value === 'intrinsic Promise'
  ) return { fact: 'bundle.promise.species', equals: 'intrinsic Promise' };

  if (
    ruleId === 'async.promise.resolve' &&
    key === 'constructor' && value === 'intrinsic Promise'
  ) return { fact: 'bundle.promise.constructor', equals: 'intrinsic Promise' };

  if (
    ruleId === 'async.promise.resolve' &&
    key === 'method_not_overridden' && value === true
  ) return { fact: 'bundle.promise.resolveIntegrity', equals: 'pristine' };

  if (
    ruleId === 'symbol.for.primitive-key' &&
    key === 'binding_resolves_to_intrinsic' && value === '%Symbol%'
  ) return { fact: 'bundle.symbol.binding', equals: '%Symbol%' };

  if (
    ruleId === 'symbol.for.primitive-key' &&
    key === 'property_resolves_to_builtin' && value === 'Symbol.for'
  ) return { fact: 'bundle.symbol.forIntegrity', equals: 'Symbol.for' };

  if (
    ruleId === 'symbol.for.primitive-key' &&
    key === 'key_statically_primitive' && value === true
  ) return { fact: 'bundle.symbol.keyDomain', equals: 'primitive' };

  if (
    ruleId === 'object.assign' &&
    key === 'builtin_not_overridden' && value === true
  ) return { fact: 'bundle.object.assignIntegrity', equals: 'pristine' };

  return { unknown: `Unreviewed bundle requirement ${ruleId}:${key}=${JSON.stringify(value)}` };
}

function aggregateRequirementVerdicts(verdicts: readonly Verdict[]): Verdict {
  if (verdicts.includes('disproven')) return 'disproven';
  if (verdicts.includes('unknown')) return 'unknown';
  return 'proven';
}

/**
 * Prove canonical source requirements from the shared evidence-bearing FactModel.
 * Fingerprint/path/strategy drift is reported separately as "changed" before any
 * semantic requirement is trusted.
 */
export function proveBundleRuleRequirements(
  database: RuleDatabase,
  ruleIds: readonly string[],
  facts: FactModel,
): BundleRequirementProof[] {
  return [...new Set(ruleIds)].map(ruleId => {
    const contract = byId.get(ruleId);
    if (!contract) {
      return {
        ruleId,
        verdict: 'missing',
        checks: [],
        evidence: ['No reviewed bundle contract exists for this rule ID.'],
      };
    }

    const loaded = database.byId.get(ruleId);
    if (!loaded) {
      return {
        ruleId,
        verdict: 'missing',
        checks: [],
        evidence: [`Pinned rule DB does not contain ${ruleId}.`],
      };
    }

    const normalizedPath = loaded.file.replaceAll('\\', '/');
    if (
      loaded.sha256 !== contract.sha256 ||
      loaded.rule.strategy !== contract.strategy ||
      normalizedPath !== contract.path
    ) {
      return {
        ruleId,
        verdict: 'changed',
        checks: [],
        evidence: [
          `rule-db path: ${loaded.file}`,
          `sha256: ${loaded.sha256}`,
          `strategy: ${loaded.rule.strategy}`,
        ],
      };
    }

    const requirements = loaded.rule.source.requirements ?? {};
    const checks = Object.entries(requirements).map(([key, value]) => {
      const proof = evaluate(reviewedBundleRequirementPredicate(ruleId, key, value), facts);
      return { key, verdict: proof.verdict, evidence: proof.evidence };
    });
    return {
      ruleId,
      verdict: aggregateRequirementVerdicts(checks.map(check => check.verdict)),
      checks,
      evidence: checks.flatMap(check => check.evidence),
    };
  });
}

export async function proveBundleRuleRequirementsFromRoot(
  ruleDbRoot: string,
  ruleIds: readonly string[],
  facts: FactModel,
): Promise<BundleRequirementProof[]> {
  return proveBundleRuleRequirements(await loadRules(ruleDbRoot), ruleIds, facts);
}

/**
 * Facts that the bundle scanner can prove on its own. Integrity-sensitive
 * Promise/Object/Symbol facts are deliberately absent; parser shape alone cannot
 * prove that mutable builtins/properties have not been replaced.
 */
export function bundleFactsFromAnalysis(analysis: BundleAnalysis): FactModel {
  const facts = new Facts();
  if (analysis.esmSyntax) {
    facts.prove('bundle.sourceType', 'ECMAScript module', 'top-level import/export syntax parsed by TypeScript AST');
  }
  if (analysis.host === 'node') {
    facts.prove('profile.host', 'Node.js', 'bundle analysis host profile is Node');
  }
  if (analysis.dynamicImports.length > 0) {
    facts.prove('bundle.dynamicSpecifierAllowed', true, 'AST contains dynamic import() syntax');
  }
  return facts;
}
