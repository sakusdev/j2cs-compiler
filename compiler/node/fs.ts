import { Facts, type FactModel } from '../analysis/facts.js';
import { fail } from '../diagnostics/index.js';
import { evaluate, type Predicate, type Proof, type Verdict } from '../rules/requirements.js';
import type { LoadedRule, RuleDatabase } from '../rules/loader.js';

export type NodeFsOperation =
  | 'readFileSync'
  | 'writeFileSync'
  | 'existsSync'
  | 'promises.readFile.awaited'
  | 'promises.writeFile.awaited';

export interface NodeFsRuleSpec {
  operation: NodeFsOperation;
  ruleId: string;
  sha256: string;
  helper: string;
}

export const NODE_FS_RULES: readonly NodeFsRuleSpec[] = [
  { operation: 'readFileSync', ruleId: 'node.fs.readfilesync', sha256: '931ff8436fed7e62fd07c42516175bb75576322caea1766bfa301b16b2525693', helper: 'NodeFs.ReadFileSync' },
  { operation: 'writeFileSync', ruleId: 'node.fs.writefilesync', sha256: '0c8d84cff0f7fec3244a1e9d114019f31312b2a59f16877a84827c0f97e3092a', helper: 'NodeFs.WriteFileSync' },
  { operation: 'existsSync', ruleId: 'node.fs.existssync', sha256: 'a181a3b664a35ee655894cc2fcc229a23271ff7f5dfeecd9a9cb3e4a3f9c70f8', helper: 'NodeFs.ExistsSync' },
  { operation: 'promises.readFile.awaited', ruleId: 'node.fs.promises.readfile.awaited', sha256: 'cf5b608d4819bd6b68e96c9fedaf865bff52410cc347c2de029a1e99af31cac4', helper: 'NodeFsPromises.ReadFileAsync' },
  { operation: 'promises.writeFile.awaited', ruleId: 'node.fs.promises.writefile.awaited', sha256: 'd51a182095754db31f2df3d0398fb712c96672cf4087979267c22b60e5dde3bc', helper: 'NodeFsPromises.WriteFileAsync' },
];

export interface NodeFsProofContext {
  moduleBinding: string;
  bindingKind: 'intrinsic' | 'lexical';
  optionsRepresentable?: boolean;
  directlyAwaited?: boolean;
  promiseSchedulerCompatible?: boolean;
  pathKind?: 'string' | 'other';
  dataKind?: 'string' | 'buffer' | 'other';
}

export interface NodeFsRuleProof {
  ruleId: string;
  helper: string;
  verdict: Verdict;
  checks: Proof[];
  facts: FactModel;
}

const byOperation = new Map<NodeFsOperation, NodeFsRuleSpec>(NODE_FS_RULES.map(spec => [spec.operation, spec] as const));

function contextFacts(context: NodeFsProofContext): Facts {
  const facts = new Facts()
    .prove('node.moduleBinding', context.moduleBinding, 'resolved module binding')
    .prove('binding.kind', context.bindingKind, 'lexical/module binding resolution');
  if (context.optionsRepresentable !== undefined)
    facts.prove('node.fs.optionsRepresentable', context.optionsRepresentable, 'Node fs options-shape analysis');
  if (context.directlyAwaited !== undefined)
    facts.prove('node.promise.directlyAwaited', context.directlyAwaited, 'await-use analysis');
  if (context.promiseSchedulerCompatible !== undefined)
    facts.prove('node.promise.schedulerCompatible', context.promiseSchedulerCompatible, 'Promise scheduler capability');
  if (context.pathKind !== undefined)
    facts.prove('node.fs.pathKind', context.pathKind, 'bounded Node fs path analysis');
  if (context.dataKind !== undefined)
    facts.prove('node.fs.dataKind', context.dataKind, 'bounded Node fs data analysis');
  return facts;
}

function requirementPredicate(key: string, value: unknown): Predicate {
  if (key === 'module_binding' && typeof value === 'string')
    return { fact: 'node.moduleBinding', equals: value };
  if (key === 'builtin_not_shadowed' && value === true)
    return { fact: 'binding.kind', equals: 'intrinsic' };
  if (key === 'options_shape' && value === 'statically known or represented by NodeFsOptions')
    return { fact: 'node.fs.optionsRepresentable', equals: true };
  if (key === 'usage' && value === 'directly awaited or otherwise lowered through JS-compatible Promise machinery')
    return { all: [
      { fact: 'node.promise.directlyAwaited', equals: true },
      { fact: 'node.promise.schedulerCompatible', equals: true },
    ] };
  return { unknown: `Unrecognized node_fs requirement ${key}=${JSON.stringify(value)}` };
}

function backendPredicates(operation: NodeFsOperation): Predicate[] {
  const checks: Predicate[] = [{ fact: 'node.fs.pathKind', equals: 'string' }];
  if (operation === 'writeFileSync' || operation === 'promises.writeFile.awaited')
    checks.push({ any: [
      { fact: 'node.fs.dataKind', equals: 'string' },
      { fact: 'node.fs.dataKind', equals: 'buffer' },
    ] });
  if (operation.startsWith('promises.'))
    checks.push({ fact: 'node.fs.optionsRepresentable', equals: true });
  return checks;
}

function allVerdict(checks: readonly Proof[]): Verdict {
  if (checks.some(check => check.verdict === 'disproven')) return 'disproven';
  if (checks.some(check => check.verdict === 'unknown')) return 'unknown';
  return 'proven';
}

function reviewedRule(database: RuleDatabase, spec: NodeFsRuleSpec): LoadedRule {
  const loaded = database.byId.get(spec.ruleId);
  if (!loaded) return fail('E_RULE_MISSING', `Reviewed Node fs rule is absent: ${spec.ruleId}`);
  if (loaded.sha256 !== spec.sha256)
    return fail('E_RULE_CONTRACT', `Rule ${spec.ruleId} changed; review its Node fs adapter before enabling it.`);
  if (loaded.rule.category !== 'node_fs' || loaded.rule.strategy !== 'helper' || loaded.rule.target.helper !== spec.helper)
    return fail('E_RULE_CONTRACT', `Rule ${spec.ruleId} no longer matches the reviewed Node fs helper contract.`);
  return loaded;
}

/**
 * Prove one canonical node_fs rule without parsing source.pattern or executing target.template.
 * Source-level wiring intentionally remains closed until module/async workstreams land.
 */
export function proveNodeFsRule(database: RuleDatabase, operation: NodeFsOperation, context: NodeFsProofContext): NodeFsRuleProof {
  const spec = byOperation.get(operation);
  if (!spec) return fail('E_RULE_MISSING', `No reviewed Node fs adapter for ${operation}`);
  const loaded = reviewedRule(database, spec);
  const facts = contextFacts(context);
  const canonical = Object.entries(loaded.rule.source.requirements ?? {}).map(([key, value]) => requirementPredicate(key, value));
  const checks = [...canonical, ...backendPredicates(operation)].map(predicate => evaluate(predicate, facts));
  return { ruleId: spec.ruleId, helper: spec.helper, verdict: allVerdict(checks), checks, facts };
}
