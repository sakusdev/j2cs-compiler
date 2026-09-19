import type { RuleDatabase } from '../rules/loader.js';
import { loadRules } from '../rules/loader.js';
import type { CanonicalBundleRuleContract, CanonicalRuleProof } from './model.js';

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
    return {
      contract,
      verdict: hashMatches && strategyMatches ? 'proven' : 'changed',
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
