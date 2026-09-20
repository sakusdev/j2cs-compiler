import { readFile } from 'node:fs/promises';
import { fail } from '../diagnostics/index.js';
import type { FactModel } from '../analysis/facts.js';
import { evaluate, type Predicate, type Proof, type Verdict } from '../rules/requirements.js';
import type { LoadedRule, RuleDatabase } from '../rules/loader.js';

export const NODE_URL_UTIL_ZLIB_RULE_DB_COMMIT = '35ca8d859f9352e90ee2497f4ac8f6edb9c19ed1';

export interface NodeUrlUtilZlibAdapter {
  ruleId: string;
  sha256: string;
  selector: string;
  lowering: string;
  requires: readonly { fact: string; equals: string | number | boolean }[];
}

export interface NodeUrlUtilZlibProof {
  ruleId: string;
  lowering: string;
  verdict: Verdict;
  checks: readonly Proof[];
}

interface RegistryFile {
  version: number;
  ruleDbCommit: string;
  adapters: NodeUrlUtilZlibAdapter[];
}

const EXPECTED_CATEGORY: Readonly<Record<string, string>> = {
  'node.url.fileurltopath': 'node_core',
  'node.util.format': 'node_core',
  'node.zlib.gzip.sync': 'node_zlib',
  'web.urlsearchparams.to-string': 'web_url_fetch',
};

function aggregate(checks: readonly Proof[]): Verdict {
  if (checks.some(check => check.verdict === 'disproven')) return 'disproven';
  if (checks.some(check => check.verdict === 'unknown')) return 'unknown';
  return 'proven';
}

function canonicalRequirement(ruleId: string, key: string, value: unknown): Predicate {
  if (ruleId === 'node.url.fileurltopath') {
    if (key === 'module_binding' && value === 'node:url builtin')
      return { fact: 'node.moduleBinding', equals: 'node:url builtin' };
    if (key === 'builtin_not_shadowed' && value === true)
      return { fact: 'node.bindingIntegrity', equals: 'pristine' };
    if (key === 'input' && value === 'string or WHATWG URL represented by compatible URL layer')
      return { fact: 'node.url.inputCompatible', equals: true };
    if (key === 'options' && value === 'windows true/false/undefined preserved')
      return { fact: 'node.url.optionsPreserved', equals: true };
  }

  if (ruleId === 'node.util.format') {
    if (key === 'module_binding' && value === 'node:util builtin')
      return { fact: 'node.moduleBinding', equals: 'node:util builtin' };
    if (key === 'builtin_not_shadowed' && value === true)
      return { fact: 'node.bindingIntegrity', equals: 'pristine' };
    if (key === 'arguments' && value === 'runtime values represented by JS-compatible value layer')
      return { fact: 'node.valueDomain', equals: 'primitive' };
  }

  if (ruleId === 'node.zlib.gzip.sync') {
    if (key === 'node_builtin_zlib_not_overridden' && value === true)
      return { fact: 'node.zlib.bindingIntegrity', equals: 'pristine' };
  }

  if (ruleId === 'web.urlsearchparams.to-string') {
    if (key === 'receiver' && value === 'intrinsic URLSearchParams')
      return { fact: 'web.urlSearchParams.receiver', equals: 'intrinsic' };
    if (key === 'builtin_not_overridden' && value === true)
      return { fact: 'web.urlSearchParams.memberIntegrity', equals: 'pristine' };
  }

  return { unknown: `Unrecognized canonical requirement ${ruleId}:${key}=${JSON.stringify(value)}` };
}

function reviewedRule(database: RuleDatabase, adapter: NodeUrlUtilZlibAdapter): LoadedRule {
  const loaded = database.byId.get(adapter.ruleId);
  if (!loaded) return fail('E_RULE_MISSING', `Canonical rule is absent: ${adapter.ruleId}`);
  if (loaded.sha256 !== adapter.sha256)
    return fail('E_RULE_CONTRACT', `Canonical rule changed: ${adapter.ruleId}; review before enabling it.`);

  const expectedCategory = EXPECTED_CATEGORY[adapter.ruleId];
  if (!expectedCategory)
    return fail('E_RULE_CONTRACT', `No reviewed category contract for ${adapter.ruleId}.`);
  if (loaded.rule.category !== expectedCategory || loaded.rule.strategy !== 'helper' ||
      loaded.rule.target.kind !== 'helper' || loaded.rule.target.helper !== adapter.lowering) {
    return fail('E_RULE_CONTRACT', `Canonical target contract changed: ${adapter.ruleId}.`);
  }
  return loaded;
}

export class NodeUrlUtilZlibProofIndex {
  private readonly entries = new Map<string, { adapter: NodeUrlUtilZlibAdapter; loaded: LoadedRule }>();

  constructor(readonly ruleDbCommit: string, adapters: readonly NodeUrlUtilZlibAdapter[], database: RuleDatabase) {
    if (ruleDbCommit !== NODE_URL_UTIL_ZLIB_RULE_DB_COMMIT)
      fail('E_RULE_CONTRACT', 'NODE_URL_UTIL_ZLIB_MISC registry points at an unreviewed rule-db commit.');
    for (const adapter of adapters) {
      if (this.entries.has(adapter.ruleId))
        fail('E_RULE_CONTRACT', `Duplicate NODE_URL_UTIL_ZLIB_MISC adapter: ${adapter.ruleId}.`);
      this.entries.set(adapter.ruleId, { adapter, loaded: reviewedRule(database, adapter) });
    }
  }

  ruleIds(): readonly string[] {
    return [...this.entries.keys()];
  }

  adapter(ruleId: string): NodeUrlUtilZlibAdapter {
    return this.entries.get(ruleId)?.adapter ??
      fail('E_RULE_MISSING', `No reviewed NODE_URL_UTIL_ZLIB_MISC adapter for ${ruleId}.`);
  }

  prove(ruleId: string, facts: FactModel): NodeUrlUtilZlibProof {
    const entry = this.entries.get(ruleId) ??
      fail('E_RULE_MISSING', `No reviewed NODE_URL_UTIL_ZLIB_MISC adapter for ${ruleId}.`);
    const canonical = Object.entries(entry.loaded.rule.source.requirements ?? {})
      .map(([key, value]) => canonicalRequirement(ruleId, key, value));
    const backend = entry.adapter.requires.map(requirement => ({
      fact: requirement.fact,
      equals: requirement.equals,
    } satisfies Predicate));
    const checks = [...canonical, ...backend].map(predicate => evaluate(predicate, facts));
    return { ruleId, lowering: entry.adapter.lowering, verdict: aggregate(checks), checks };
  }
}

function isRegistryFile(value: unknown): value is RegistryFile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.version === 1 && typeof record.ruleDbCommit === 'string' && Array.isArray(record.adapters);
}

export async function loadNodeUrlUtilZlibProofIndex(
  database: RuleDatabase,
  registryFile: string,
): Promise<NodeUrlUtilZlibProofIndex> {
  const parsed = JSON.parse(await readFile(registryFile, 'utf8')) as unknown;
  if (!isRegistryFile(parsed))
    return fail('E_RULE_CONTRACT', 'Invalid NODE_URL_UTIL_ZLIB_MISC adapter registry.');
  return new NodeUrlUtilZlibProofIndex(parsed.ruleDbCommit, parsed.adapters, database);
}
