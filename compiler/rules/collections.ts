import { readFile } from 'node:fs/promises';
import type { FactModel, Fact } from '../analysis/facts.js';
import { fail } from '../diagnostics/index.js';
import { evaluate, type Predicate, type Proof, type Verdict } from './requirements.js';
import type { LoadedRule, RuleDatabase, Strategy } from './loader.js';

export type CollectionKind = 'Map' | 'Set' | 'WeakMap' | 'WeakSet';

export interface CollectionAdapter {
  ruleId: string;
  sha256: string;
  strategy: 'helper' | 'runtime';
  lowering: string;
}

export interface CollectionAdapterRegistry {
  version: 1;
  ruleDbCommit: string;
  adapters: readonly CollectionAdapter[];
}

export interface CollectionRuleProof {
  adapter: CollectionAdapter;
  loaded: LoadedRule;
  verdict: Verdict;
  checks: Proof[];
}

/**
 * Collection facts intentionally remain separate from the main syntax producer until
 * construction/member AST wiring can land without depending on unmerged sibling work.
 * They use the common FactModel so future analysis can provide the same evidence directly.
 */
export const CollectionFact = {
  globalIntrinsic: 'collection.globalIntrinsic',
  newTarget: 'collection.newTarget',
  receiverKind: 'collection.receiverKind',
  memberIntegrity: 'collection.memberIntegrity',
  receiverProxy: 'collection.receiverProxy',
  sizeAccessorIntegrity: 'collection.sizeAccessorIntegrity',
  symbolIteratorIntegrity: 'collection.symbolIteratorIntegrity',
} as const;

const eq = (fact: string, equals: Fact['value']): Predicate => {
  if (Array.isArray(equals)) return { unknown: `Collection equality facts cannot compare arrays: ${fact}` };
  return { fact, equals: equals as string | number | boolean };
};

function expectedKind(suffix: string): CollectionKind | undefined {
  return suffix === 'map' ? 'Map'
    : suffix === 'set' ? 'Set'
      : suffix === 'weakmap' ? 'WeakMap'
        : suffix === 'weakset' ? 'WeakSet'
          : undefined;
}

/**
 * Translate only the reviewed legacy requirement vocabulary used by the pinned
 * map_set rules. New or changed requirement keys fail closed as unknown.
 */
export function collectionRequirementPredicate(key: string, value: unknown): Predicate {
  if (value !== true) return { unknown: `Unrecognized collection requirement ${key}=${JSON.stringify(value)}` };

  const global = /^global_(map|set|weakmap|weakset)_binding_builtin$/.exec(key);
  if (global) return eq(CollectionFact.globalIntrinsic, expectedKind(global[1]!)!);

  const newTarget = /^new_target_is_builtin_(map|set|weakmap|weakset)$/.exec(key);
  if (newTarget) return eq(CollectionFact.newTarget, expectedKind(newTarget[1]!)!);

  const receiver = /^receiver_inferred_builtin_(map|set|weakmap|weakset)$/.exec(key);
  if (receiver) return eq(CollectionFact.receiverKind, expectedKind(receiver[1]!)!);

  switch (key) {
    case 'builtin_member_not_overridden_or_shadowed':
      return eq(CollectionFact.memberIntegrity, 'pristine');
    case 'receiver_not_proxy':
      return eq(CollectionFact.receiverProxy, false);
    case 'builtin_size_accessor_not_overridden':
      return eq(CollectionFact.sizeAccessorIntegrity, 'pristine');
    case 'symbol_iterator_builtin':
      return eq(CollectionFact.symbolIteratorIntegrity, 'pristine');
    default:
      return { unknown: `Unrecognized collection requirement ${key}=true` };
  }
}

function aggregate(checks: readonly Proof[]): Verdict {
  return checks.some(check => check.verdict === 'disproven') ? 'disproven'
    : checks.some(check => check.verdict === 'unknown') ? 'unknown'
      : 'proven';
}

function resolveAdapter(database: RuleDatabase, adapter: CollectionAdapter): LoadedRule {
  const loaded = database.byId.get(adapter.ruleId);
  if (!loaded) return fail('E_COLLECTION_RULE_MISSING', `Reviewed collection rule is absent: ${adapter.ruleId}`);
  if (loaded.sha256 !== adapter.sha256)
    return fail('E_COLLECTION_RULE_CONTRACT', `Collection rule ${adapter.ruleId} changed; review its adapter before enabling it.`);
  if (loaded.rule.category !== 'map_set')
    return fail('E_COLLECTION_RULE_CONTRACT', `Collection adapter ${adapter.ruleId} no longer points to map_set semantics.`);
  if (loaded.rule.strategy !== adapter.strategy)
    return fail('E_COLLECTION_RULE_CONTRACT', `Collection rule ${adapter.ruleId} strategy changed from reviewed ${adapter.strategy}.`);
  return loaded;
}

/**
 * Prove every source.requirements obligation on a SHA-pinned canonical j2cs rule.
 * source.pattern and target.template remain descriptive and are never executed.
 */
export function proveCollectionRule(database: RuleDatabase, adapter: CollectionAdapter, facts: FactModel): CollectionRuleProof {
  const loaded = resolveAdapter(database, adapter);
  const requirements = loaded.rule.source.requirements ?? {};
  const checks = Object.entries(requirements).map(([key, value]) =>
    evaluate(collectionRequirementPredicate(key, value), facts));
  return { adapter, loaded, checks, verdict: aggregate(checks) };
}

export function proveCollectionOperation(
  database: RuleDatabase,
  registry: CollectionAdapterRegistry,
  lowering: string,
  facts: FactModel,
): CollectionRuleProof | undefined {
  const adapter = registry.adapters.find(candidate => candidate.lowering === lowering);
  return adapter ? proveCollectionRule(database, adapter, facts) : undefined;
}

export function verifyCollectionAdapters(database: RuleDatabase, registry: CollectionAdapterRegistry): void {
  for (const adapter of registry.adapters) resolveAdapter(database, adapter);
}

export async function loadCollectionAdapters(file: string): Promise<CollectionAdapterRegistry> {
  const data = JSON.parse(await readFile(file, 'utf8')) as Partial<CollectionAdapterRegistry>;
  if (data.version !== 1 || typeof data.ruleDbCommit !== 'string' || !Array.isArray(data.adapters))
    return fail('E_COLLECTION_ADAPTER_SCHEMA', 'Unsupported collection adapter registry.');

  const ids = new Set<string>(), lowerings = new Set<string>();
  for (const adapter of data.adapters) {
    if (!adapter || typeof adapter.ruleId !== 'string' || typeof adapter.sha256 !== 'string'
      || !['helper', 'runtime'].includes(adapter.strategy) || typeof adapter.lowering !== 'string')
      return fail('E_COLLECTION_ADAPTER_SCHEMA', 'Invalid collection adapter entry.');
    if (ids.has(adapter.ruleId) || lowerings.has(adapter.lowering))
      return fail('E_COLLECTION_ADAPTER_SCHEMA', `Duplicate collection adapter: ${adapter.ruleId}`);
    ids.add(adapter.ruleId);
    lowerings.add(adapter.lowering);
  }

  return data as CollectionAdapterRegistry;
}
