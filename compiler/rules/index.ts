import { readFile } from 'node:fs/promises';
import { fail } from '../diagnostics/index.js';
import type { FactModel } from '../analysis/facts.js';
import { evaluateRequirements, type Predicate, type RequirementsProof } from './requirements.js';
import type { LoadedRule, RuleDatabase, Strategy } from './loader.js';
export interface Selector { kind: string; operator?: string; intrinsic?: string }
export interface Adapter { ruleId: string; sha256: string; selector: Selector; lowering: string; requires?: Predicate[] }
export interface Candidate { loaded: LoadedRule; adapter: Adapter; proof: RequirementsProof }
export interface Selection { selected?: Candidate; candidates: Candidate[]; ambiguous: string[] }
export class RuleIndex {
  private readonly buckets = new Map<string, { loaded: LoadedRule; adapter: Adapter }[]>();
  constructor(public readonly database: RuleDatabase, public readonly adapters: readonly Adapter[]) {
    const seen = new Set<string>();
    for (const adapter of adapters) {
      if (seen.has(adapter.ruleId)) fail('E_ADAPTER_DUPLICATE', `Duplicate adapter ${adapter.ruleId}`);
      seen.add(adapter.ruleId);
      const loaded = database.byId.get(adapter.ruleId);
      if (!loaded) fail('E_RULE_MISSING', `Reviewed rule is absent: ${adapter.ruleId}`);
      if (adapter.sha256 !== loaded.sha256) fail('E_RULE_CONTRACT', `Rule ${adapter.ruleId} changed; review its adapter before enabling it.`);
      const key = adapter.selector.kind;
      this.buckets.set(key, [...(this.buckets.get(key) ?? []), { loaded, adapter }]);
    }
  }
  select(construct: Selector, facts: FactModel): Selection {
    const candidates: Candidate[] = (this.buckets.get(construct.kind) ?? [])
      .filter(({ adapter: a }) => Object.entries(a.selector).every(([key, value]) => construct[key as keyof Selector] === value))
      .map(({ loaded, adapter }) => ({ loaded, adapter, proof: evaluateRequirements(loaded.rule.source.requirements ?? {}, facts, adapter.requires) }));
    const ambiguous: string[] = [];
    for (const tier of ['native', 'helper', 'runtime', 'unsupported'] as Strategy[]) {
      const eligible = candidates.filter(c => c.loaded.rule.strategy === tier && c.proof.verdict === 'proven');
      const maximal = eligible.filter(c => !eligible.some(other => other !== c && dominates(other, c)));
      if (maximal.length === 1) return { selected: maximal[0], candidates, ambiguous };
      if (maximal.length > 1) ambiguous.push(...maximal.map(c => c.loaded.rule.id));
    }
    return { candidates, ambiguous };
  }
}
function constraints(c: Candidate): Set<string> {
  return new Set([...c.proof.constraints, ...Object.entries(c.adapter.selector).map(([k, v]) => `${k}=${v}`)]);
}
function dominates(a: Candidate, b: Candidate): boolean {
  const x = constraints(a), y = constraints(b);
  return x.size > y.size && [...y].every(k => x.has(k));
}
export async function loadAdapters(file: string): Promise<Adapter[]> {
  const data = JSON.parse(await readFile(file, 'utf8'));
  if (data.version !== 1 || !Array.isArray(data.adapters)) fail('E_ADAPTER_SCHEMA', 'Unsupported adapter registry.');
  for (const a of data.adapters) {
    if (!a || typeof a.ruleId !== 'string' || typeof a.sha256 !== 'string' || typeof a.lowering !== 'string'
      || typeof a.selector?.kind !== 'string') fail('E_ADAPTER_SCHEMA', 'Invalid adapter entry.');
  }
  return data.adapters;
}
