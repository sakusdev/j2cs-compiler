import { createHash } from 'node:crypto';

export interface ModuleInput {
  readonly id: string;
  readonly source: string;
  readonly dependencies: readonly string[];
}

export interface CachedAnalysis {
  readonly moduleId: string;
  readonly fingerprint: string;
  readonly summary: string;
}

export interface IncrementalPlan {
  readonly reusable: readonly string[];
  readonly invalidated: readonly string[];
  readonly missingDependencies: readonly string[];
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
}

export function moduleFingerprint(input: ModuleInput, analysisKey: string): string {
  if (!input.id) throw new Error('Module id must be non-empty.');
  if (!analysisKey) throw new Error('Analysis key must be non-empty.');
  const payload = JSON.stringify({
    id: input.id,
    source: input.source.replace(/\r\n/g, '\n'),
    dependencies: sortedUnique(input.dependencies),
    analysisKey,
  });
  return createHash('sha256').update(payload).digest('hex');
}

export class PersistentAnalysisCache {
  readonly #entries = new Map<string, CachedAnalysis>();

  get(moduleId: string, fingerprint: string): CachedAnalysis | undefined {
    const entry = this.#entries.get(moduleId);
    return entry?.fingerprint === fingerprint ? entry : undefined;
  }

  put(entry: CachedAnalysis): void {
    if (!entry.moduleId || !/^[0-9a-f]{64}$/.test(entry.fingerprint)) throw new Error('Invalid cache entry.');
    this.#entries.set(entry.moduleId, { ...entry });
  }

  delete(moduleId: string): void { this.#entries.delete(moduleId); }
  size(): number { return this.#entries.size; }

  serialize(): string {
    return JSON.stringify([...this.#entries.values()].sort((a, b) => a.moduleId < b.moduleId ? -1 : a.moduleId > b.moduleId ? 1 : 0));
  }

  static deserialize(serialized: string): PersistentAnalysisCache {
    const parsed: unknown = JSON.parse(serialized);
    if (!Array.isArray(parsed)) throw new Error('Analysis cache payload must be an array.');
    const cache = new PersistentAnalysisCache();
    for (const value of parsed) {
      if (typeof value !== 'object' || value === null) throw new Error('Analysis cache entry must be an object.');
      const entry = value as Partial<CachedAnalysis>;
      if (typeof entry.moduleId !== 'string' || typeof entry.fingerprint !== 'string' || typeof entry.summary !== 'string')
        throw new Error('Analysis cache entry shape is invalid.');
      cache.put({ moduleId: entry.moduleId, fingerprint: entry.fingerprint, summary: entry.summary });
    }
    return cache;
  }
}

export function planIncrementalAnalysis(
  modules: readonly ModuleInput[],
  cache: PersistentAnalysisCache,
  analysisKey: string,
  maxModules = 100_000,
): IncrementalPlan {
  if (modules.length > maxModules) throw new Error(`Module graph exceeds configured limit ${maxModules}.`);
  const byId = new Map<string, ModuleInput>();
  for (const module of modules) {
    if (byId.has(module.id)) throw new Error(`Duplicate module id: ${module.id}`);
    byId.set(module.id, module);
  }

  const reverse = new Map<string, string[]>();
  const missing = new Set<string>();
  const missingUsers = new Set<string>();
  for (const module of modules) {
    for (const dependency of sortedUnique(module.dependencies)) {
      if (!byId.has(dependency)) { missing.add(`${module.id}->${dependency}`); missingUsers.add(module.id); }
      const users = reverse.get(dependency) ?? [];
      users.push(module.id);
      reverse.set(dependency, users);
    }
  }

  const invalidated = new Set<string>();
  const queue: string[] = [];
  for (const module of modules) {
    const fingerprint = moduleFingerprint(module, analysisKey);
    if (missingUsers.has(module.id) || cache.get(module.id, fingerprint) === undefined) {
      invalidated.add(module.id);
      queue.push(module.id);
    }
  }

  for (let index = 0; index < queue.length; index++) {
    const changed = queue[index];
    if (changed === undefined) continue;
    for (const user of reverse.get(changed) ?? []) {
      if (invalidated.has(user)) continue;
      invalidated.add(user);
      queue.push(user);
    }
  }

  const ids = [...byId.keys()].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  return {
    reusable: ids.filter(id => !invalidated.has(id)),
    invalidated: ids.filter(id => invalidated.has(id)),
    missingDependencies: [...missing].sort((a, b) => a < b ? -1 : a > b ? 1 : 0),
  };
}
