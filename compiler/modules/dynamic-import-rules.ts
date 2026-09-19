import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { fail } from '../diagnostics/index.js';
import { Facts, type Fact, type FactModel } from '../analysis/facts.js';
import { loadRules, type LoadedRule, type RuleDatabase } from '../rules/loader.js';

export type DynamicModuleConstruct = 'dynamic-import' | 'top-level-await' | 'evaluate-once' | 'dependency-order';
export type DynamicModuleProofVerdict = 'proven' | 'disproven' | 'unknown';

export interface DynamicModuleAdapter {
  ruleId: string;
  sha256: string;
  construct: DynamicModuleConstruct;
  lowering: 'JsDynamicModuleRuntime.DynamicImport' | 'JsDynamicModuleRuntime.EvaluateWithTopLevelAwait' | 'JsDynamicModuleRuntime.Evaluate';
}

export interface DynamicModuleRequirementCheck {
  requirement: string;
  fact?: string;
  expected: unknown;
  actual?: Fact['value'];
  verdict: DynamicModuleProofVerdict;
  evidence: string[];
}

export interface DynamicModuleProof {
  verdict: DynamicModuleProofVerdict;
  checks: DynamicModuleRequirementCheck[];
}

export interface DynamicModuleSelection {
  loaded: LoadedRule;
  adapter: DynamicModuleAdapter;
  proof: DynamicModuleProof;
}

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const ADAPTERS = path.join(ROOT, 'compiler/modules/dynamic-import-adapters.json');

function aggregate(verdicts: readonly DynamicModuleProofVerdict[]): DynamicModuleProofVerdict {
  return verdicts.includes('disproven') ? 'disproven' : verdicts.includes('unknown') ? 'unknown' : 'proven';
}

const requirementFacts: Readonly<Record<string, string>> = {
  host: 'profile.host',
  source_type: 'module.sourceType',
  location: 'module.location',
  specifier_may_be_dynamic: 'module.specifierMayBeDynamic',
  graph_statically_known_or_runtime_linked: 'module.graphLinked',
};

function checkRequirement(requirement: string, expected: unknown, facts: FactModel): DynamicModuleRequirementCheck {
  const factName = requirementFacts[requirement];
  if (!factName) {
    return {
      requirement,
      expected,
      verdict: 'unknown',
      evidence: [`Unreviewed dynamic-module requirement ${requirement}=${JSON.stringify(expected)}`],
    };
  }
  const fact = facts.get(factName);
  if (!fact) {
    return {
      requirement,
      fact: factName,
      expected,
      verdict: 'unknown',
      evidence: [`No evidence for ${factName}`],
    };
  }
  return {
    requirement,
    fact: factName,
    expected,
    actual: fact.value,
    verdict: fact.value === expected ? 'proven' : 'disproven',
    evidence: [fact.evidence],
  };
}

export function proveDynamicModuleRequirements(requirements: Readonly<Record<string, unknown>>, facts: FactModel): DynamicModuleProof {
  const checks = Object.entries(requirements).map(([key, value]) => checkRequirement(key, value, facts));
  return { verdict: aggregate(checks.map(check => check.verdict)), checks };
}

export class DynamicModuleRuleIndex {
  private readonly byConstruct = new Map<DynamicModuleConstruct, { loaded: LoadedRule; adapter: DynamicModuleAdapter }>();

  constructor(public readonly database: RuleDatabase, public readonly adapters: readonly DynamicModuleAdapter[]) {
    for (const adapter of adapters) {
      if (this.byConstruct.has(adapter.construct))
        fail('E_MODULE_ADAPTER_DUPLICATE', `Duplicate dynamic-module adapter for ${adapter.construct}.`);
      const loaded = database.byId.get(adapter.ruleId);
      if (!loaded) fail('E_MODULE_RULE_MISSING', `Reviewed dynamic-module rule is absent: ${adapter.ruleId}`);
      if (loaded.sha256 !== adapter.sha256)
        fail('E_MODULE_RULE_CONTRACT', `Rule ${adapter.ruleId} changed; review the dynamic-module adapter before enabling it.`);
      if (loaded.rule.strategy !== 'runtime' || loaded.rule.target.kind !== 'runtime')
        fail('E_MODULE_RULE_CONTRACT', `Rule ${adapter.ruleId} no longer selects a runtime boundary.`);
      this.byConstruct.set(adapter.construct, { loaded, adapter });
    }
  }

  prove(construct: DynamicModuleConstruct, facts: FactModel): DynamicModuleSelection {
    const candidate = this.byConstruct.get(construct);
    if (!candidate) fail('E_MODULE_CONSTRUCT', `No reviewed dynamic-module rule for ${construct}.`);
    const requirements = candidate.loaded.rule.source.requirements ?? {};
    return { ...candidate, proof: proveDynamicModuleRequirements(requirements, facts) };
  }
}

export async function loadDynamicModuleAdapters(file = ADAPTERS): Promise<DynamicModuleAdapter[]> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    return fail('E_MODULE_ADAPTER_SCHEMA', `Cannot load dynamic-module adapters: ${String(error)}`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return fail('E_MODULE_ADAPTER_SCHEMA', 'Dynamic-module adapter registry must be an object.');
  const registry = raw as { version?: unknown; adapters?: unknown };
  if (registry.version !== 1 || !Array.isArray(registry.adapters))
    return fail('E_MODULE_ADAPTER_SCHEMA', 'Unsupported dynamic-module adapter registry.');

  const constructs = new Set<DynamicModuleConstruct>(['dynamic-import', 'top-level-await', 'evaluate-once', 'dependency-order']);
  const lowerings = new Set<DynamicModuleAdapter['lowering']>([
    'JsDynamicModuleRuntime.DynamicImport',
    'JsDynamicModuleRuntime.EvaluateWithTopLevelAwait',
    'JsDynamicModuleRuntime.Evaluate',
  ]);
  const result: DynamicModuleAdapter[] = [];
  for (const entry of registry.adapters) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      return fail('E_MODULE_ADAPTER_SCHEMA', 'Invalid dynamic-module adapter entry.');
    const adapter = entry as Record<string, unknown>;
    if (Object.keys(adapter).sort().join(',') !== 'construct,lowering,ruleId,sha256'
      || typeof adapter.ruleId !== 'string'
      || typeof adapter.sha256 !== 'string'
      || !constructs.has(adapter.construct as DynamicModuleConstruct)
      || !lowerings.has(adapter.lowering as DynamicModuleAdapter['lowering']))
      return fail('E_MODULE_ADAPTER_SCHEMA', 'Invalid dynamic-module adapter entry.');
    result.push(adapter as unknown as DynamicModuleAdapter);
  }
  return result;
}

export async function createDynamicModuleRuleIndex(ruleDb = path.join(ROOT, 'rule-db')): Promise<DynamicModuleRuleIndex> {
  return new DynamicModuleRuleIndex(await loadRules(ruleDb), await loadDynamicModuleAdapters());
}

export function dynamicImportFacts(): Facts {
  return new Facts()
    .prove('profile.host', 'Node.js', 'Closed Node host contract for the dynamic-import runtime boundary')
    .prove('module.specifierMayBeDynamic', true, 'Dynamic import accepts a runtime specifier and delegates resolution to the host');
}

export function topLevelAwaitFacts(): Facts {
  return new Facts()
    .prove('module.sourceType', 'ECMAScript module', 'Top-level await is admitted only for an explicitly linked ESM module record')
    .prove('module.location', 'module top level', 'Async evaluation is attached to the module body, not an ordinary function');
}

export function moduleEvaluationFacts(graphLinked = true): Facts {
  return new Facts()
    .prove('module.sourceType', 'ECMAScript module', 'Evaluation operates on an ESM module record')
    .prove('module.graphLinked', graphLinked, graphLinked
      ? 'The runtime host resolved the requested dependency graph before evaluation'
      : 'The dependency graph has not been proven linked');
}
