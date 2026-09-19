import { fail } from '../diagnostics/index.js';
import { Facts, type FactModel } from '../analysis/facts.js';
import type { RuleDatabase } from '../rules/loader.js';

export const MODULE_RULE_CONTRACTS = [
  ['modules.esm.named-import-live-binding', '935e6d947af603764419ef5344a0b1a8d5adfc3b1cbe245ec5b2b6488575db6e'],
  ['modules.esm.local-export-live-binding', 'c725e42989dd1c80f0b20e1685bc063d8745ae41bd2dea7df82b20fc7ab1a429'],
  ['modules.esm.export-alias-live-binding', 'c5ae1fe4691ea0d2e5135d3e1fe0100cadf60bcd033189732cfc14c7923c3868'],
  ['modules.esm.import-declarations-hoisted', '0ecb5d3fc3754b59299f76947e7ef5eef5f12370566b4beb5d6be5d3e6d4ebff'],
  ['modules.esm.cycle-tdz', '15d701c9b246b6f7776cf44c62cee95a9598e04dd93bd96cc75039e4a6ad24b5'],
  ['modules.esm.dependency-evaluation-order', 'f7175da20aee24a1c0369ebb9309f16d53cb2a73802d4674a0d3c599856f7b7d'],
  ['modules.esm.evaluate-once', 'dfaca413b2a23b81fc08df03e32cd51683f6e75f23ae9aab2a39f655ddc1aaaf'],
  ['modules.esm.side-effect-import', '6d0467b0fc6fe97f82df47998387a8853bc580932f26ee5a64ef9668ae7deb80'],
  ['modules.esm.default-import-live-binding', 'dbd8c33e9629df0870a154ef3094e07ab8deb4e43af3d88c030fedb7bac6af33'],
  ['modules.esm.default-export-declaration', '01472ca238383ba684c1101650f1b1c1d848fd96c6bdbf729472d12ffd99a10c'],
  ['modules.esm.default-export-expression', 'cad32fed22d7b886d1eac1d06230238b3a0e7e56dfa9d74c4c83e10eb620fb72'],
  ['modules.esm.named-reexport', 'b66b82db8e3213ef3f7a99040e15b90e62dc4b0784bd5acef6a810ca5f6ba0d5'],
  ['modules.esm.star-reexport', 'b26e44b149030c193929369248909e82b57956f569ffea727cd8616176d160f4'],
  ['modules.esm.namespace-import', '9c216001bdf162cfbd247f675a1136453125fa7da0413fe8be66799060245c28'],
  ['modules.esm.namespace-reexport', '3d24b701e2916056e24a8eb824a2db37560dd99bc4a2b8b1a3fb82410ef49673'],
  ['modules.esm.namespace-exotic-object', '3688ad3136357ddae59133f8ee66226a3cd0fe719fc6c478f1749ae10d3f5e25'],
  ['modules.esm.missing-export-link-error', '0175c95188d0e2c038168501234fc416687af03b882d14c9b65483832dccb4ea'],
  ['modules.esm.ambiguous-star-export-link-error', '233b77d88a0ef97bf0d9972eb5f726be02fa1ecbc4e5ed25e6778c812c0780a9'],
  ['modules.esm.top-level-this-undefined', '0167e64640e722dfbe64d476371337cbac86d6a418c9616b1cdb13684ebc7d3b'],
  ['modules.esm.namespace-own-key-order', '2bfb81fcc552e33f174d66e0b62804068544f85847e5c35984e7cf8776de7539'],
] as const;

export type ModuleRuleId = typeof MODULE_RULE_CONTRACTS[number][0];

const KNOWN_REQUIREMENTS = new Set([
  'source_type', 'module_request_statically_resolved', 'local_binding_resolved', 'contains_static_import',
  'module_graph_contains_cycle', 'target_binding_may_be_uninitialized', 'graph_statically_known_or_runtime_linked',
  'import_clause_absent', 'form', 'requested_export_missing', 'resolved_export', 'value_proven',
  'receiver_proven', 'location',
]);

export interface ModuleProofCheck {
  requirement: string;
  expected: unknown;
  verdict: 'proven' | 'disproven' | 'unknown';
  evidence: string[];
}

export interface ModuleRuleProof {
  ruleId: ModuleRuleId;
  verdict: 'proven' | 'disproven' | 'unknown';
  checks: ModuleProofCheck[];
}

export interface ModuleRuleTrace extends ModuleRuleProof {
  module: string;
  operation: string;
}

export function moduleFacts(entries: Record<string, string | number | boolean>, evidence: string): Facts {
  const facts = new Facts();
  for (const [key, value] of Object.entries(entries)) facts.prove(key, value, evidence);
  return facts;
}

export function reviewModuleRuleContracts(db: RuleDatabase): void {
  for (const [ruleId, sha256] of MODULE_RULE_CONTRACTS) {
    const loaded = db.byId.get(ruleId);
    if (!loaded) fail('E_RULE_MISSING', `Reviewed module rule is absent: ${ruleId}`);
    if (loaded.sha256 !== sha256)
      fail('E_RULE_CONTRACT', `Module rule ${ruleId} changed; review the module adapter contract before enabling it.`);
  }
}

export function proveModuleRule(db: RuleDatabase, ruleId: ModuleRuleId, facts: FactModel): ModuleRuleProof {
  const contract = MODULE_RULE_CONTRACTS.find(([id]) => id === ruleId);
  if (!contract) return fail('E_MODULE_RULE', `Unreviewed module rule requested: ${ruleId}`);
  const loaded = db.byId.get(ruleId);
  if (!loaded) return fail('E_RULE_MISSING', `Reviewed module rule is absent: ${ruleId}`);
  if (loaded.sha256 !== contract[1])
    return fail('E_RULE_CONTRACT', `Module rule ${ruleId} changed; review the module adapter contract before enabling it.`);

  const requirements = loaded.rule.source.requirements ?? {};
  const checks: ModuleProofCheck[] = Object.entries(requirements).map(([requirement, expected]) => {
    if (!KNOWN_REQUIREMENTS.has(requirement)) return {
      requirement, expected, verdict: 'unknown' as const, evidence: [`Unreviewed module requirement ${requirement}`],
    };
    const fact = facts.get(requirement);
    if (!fact) return {
      requirement, expected, verdict: 'unknown' as const, evidence: [`No evidence for ${requirement}`],
    };
    return {
      requirement, expected,
      verdict: fact.value === expected ? 'proven' as const : 'disproven' as const,
      evidence: [fact.evidence],
    };
  });
  const verdict = checks.some(c => c.verdict === 'disproven') ? 'disproven'
    : checks.some(c => c.verdict === 'unknown') ? 'unknown' : 'proven';
  return { ruleId, verdict, checks };
}

export function requireModuleRule(db: RuleDatabase, ruleId: ModuleRuleId, facts: FactModel): ModuleRuleProof {
  const proof = proveModuleRule(db, ruleId, facts);
  if (proof.verdict !== 'proven') {
    const missing = proof.checks.filter(c => c.verdict !== 'proven').map(c => c.requirement).join(', ');
    fail('E_MODULE_RULE_PROOF', `Canonical rule ${ruleId} is not proven (${proof.verdict}): ${missing}`);
  }
  return proof;
}
