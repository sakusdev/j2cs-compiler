import { fail } from '../diagnostics/index.js';
import type { RuleDatabase } from '../rules/loader.js';
import type { ModuleIr } from './ir.js';
import {
  moduleFacts, requireModuleRule, reviewModuleRuleContracts, type ModuleRuleId, type ModuleRuleTrace,
} from './rules.js';

export type ModuleResolver = (fromModule: string, specifier: string) => string | undefined;

export interface BindingTarget {
  module: string;
  binding: string;
}

export type ExportResolution =
  | { kind: 'binding'; target: BindingTarget }
  | { kind: 'namespace'; module: string }
  | { kind: 'missing' }
  | { kind: 'ambiguous' };

export interface LinkedModule {
  id: string;
  imports: ReadonlyMap<string, ExportResolution>;
  exportNames: readonly string[];
}

export interface ModuleLinkResult {
  entry: string;
  modules: ReadonlyMap<string, LinkedModule>;
  evaluationOrder: readonly string[];
  cycles: readonly (readonly string[])[];
  trace: readonly ModuleRuleTrace[];
}

export class ModuleLinkError extends Error {
  constructor(public readonly code: string, message: string, public readonly ruleId?: ModuleRuleId) {
    super(message);
    this.name = 'ModuleLinkError';
  }
}

const BASE_FACTS = { source_type: 'ECMAScript module' } as const;

export function linkModuleGraph(
  modules: readonly ModuleIr[],
  entry: string,
  db: RuleDatabase,
  resolve: ModuleResolver = (_from, specifier) => specifier,
): ModuleLinkResult {
  reviewModuleRuleContracts(db);
  const records = new Map<string, ModuleIr>();
  for (const module of modules) {
    if (records.has(module.file)) throw new ModuleLinkError('E_MODULE_DUPLICATE', `Duplicate module record: ${module.file}`);
    records.set(module.file, module);
  }
  if (!records.has(entry)) throw new ModuleLinkError('E_MODULE_ENTRY', `Entry module is absent: ${entry}`);

  const trace: ModuleRuleTrace[] = [];
  const requestTargets = new Map<string, Map<string, string>>();
  const importBindings = new Map<string, Map<string, ExportResolution>>();

  const prove = (module: string, operation: string, ruleId: ModuleRuleId,
    entries: Record<string, string | number | boolean>): void => {
    const proof = requireModuleRule(db, ruleId, moduleFacts({ ...BASE_FACTS, ...entries }, `${module}: ${operation}`));
    trace.push({ module, operation, ...proof });
  };

  const targetFor = (from: string, specifier: string): string => {
    let bySpecifier = requestTargets.get(from);
    if (!bySpecifier) { bySpecifier = new Map(); requestTargets.set(from, bySpecifier); }
    const cached = bySpecifier.get(specifier);
    if (cached) return cached;
    const target = resolve(from, specifier);
    if (!target || !records.has(target))
      throw new ModuleLinkError('E_MODULE_RESOLVE', `Cannot statically resolve '${specifier}' from ${from}.`);
    bySpecifier.set(specifier, target);
    return target;
  };

  for (const module of records.values()) {
    for (const request of module.requests) targetFor(module.file, request.specifier);
    prove(module.file, 'evaluate once', 'modules.esm.evaluate-once', {});
    prove(module.file, 'dependency evaluation order', 'modules.esm.dependency-evaluation-order',
      { graph_statically_known_or_runtime_linked: true });
    if (module.imports.length || module.sideEffectImports.length) prove(
      module.file, 'static imports are hoisted', 'modules.esm.import-declarations-hoisted', { contains_static_import: true },
    );
    for (const side of module.sideEffectImports) prove(
      module.file, `side-effect import ${side.specifier}`, 'modules.esm.side-effect-import', { import_clause_absent: true },
    );
    for (const local of module.localExports) {
      if (module.defaultExport && local.exportName === 'default') continue;
      prove(module.file, `local export ${local.exportName}`,
        local.exportName === local.localName ? 'modules.esm.local-export-live-binding' : 'modules.esm.export-alias-live-binding',
        { local_binding_resolved: true });
    }
    if (module.defaultExport) prove(module.file, 'default export',
      module.defaultExport.form === 'expression' ? 'modules.esm.default-export-expression' : 'modules.esm.default-export-declaration',
      { form: module.defaultExport.form });
    for (const item of module.indirectExports) prove(module.file, `reexport ${item.exportName}`,
      item.importName === '*namespace*' ? 'modules.esm.namespace-reexport' : 'modules.esm.named-reexport',
      item.importName === '*namespace*' ? {} : { module_request_statically_resolved: true });
    for (const item of module.starExports) prove(module.file, `star reexport ${item.specifier}`, 'modules.esm.star-reexport', {});
    if (module.topLevelThis) prove(module.file, 'top-level this', 'modules.esm.top-level-this-undefined', { location: 'top level' });
  }

  const resolutionKey = (module: string, name: string) => `${module}\0${name}`;
  const sameResolution = (a: ExportResolution, b: ExportResolution): boolean =>
    a.kind === b.kind && (a.kind === 'binding' && b.kind === 'binding'
      ? a.target.module === b.target.module && a.target.binding === b.target.binding
      : a.kind === 'namespace' && b.kind === 'namespace' ? a.module === b.module : true);

  const resolveLocal = (module: ModuleIr, localName: string, resolveSet: Set<string>): ExportResolution => {
    const imported = importBindings.get(module.file)?.get(localName);
    if (imported) return imported;
    if (module.declaredBindings.includes(localName)) return { kind: 'binding', target: { module: module.file, binding: localName } };
    // Imported bindings can be needed while resolving exports before the module's import pass.
    const importEntry = module.imports.find(i => i.localName === localName);
    if (importEntry) {
      const target = records.get(targetFor(module.file, importEntry.specifier))!;
      if (importEntry.importName === '*namespace*') return { kind: 'namespace', module: target.file };
      return resolveExport(target, importEntry.importName, resolveSet);
    }
    return { kind: 'missing' };
  };

  const resolveExport = (module: ModuleIr, name: string, resolveSet: Set<string>): ExportResolution => {
    const key = resolutionKey(module.file, name);
    if (resolveSet.has(key)) return { kind: 'missing' };
    const next = new Set(resolveSet); next.add(key);

    const locals = module.localExports.filter(e => e.exportName === name);
    const indirect = module.indirectExports.filter(e => e.exportName === name);
    if (locals.length + indirect.length > 1)
      throw new ModuleLinkError('E_MODULE_DUP_EXPORT', `Duplicate explicit export '${name}' in ${module.file}.`);

    if (locals.length === 1) return resolveLocal(module, locals[0]!.localName, next);
    if (indirect.length === 1) {
      const item = indirect[0]!, target = records.get(targetFor(module.file, item.specifier))!;
      return item.importName === '*namespace*'
        ? { kind: 'namespace', module: target.file }
        : resolveExport(target, item.importName, next);
    }
    if (name === 'default') return { kind: 'missing' };

    let found: ExportResolution | undefined;
    for (const star of module.starExports) {
      const target = records.get(targetFor(module.file, star.specifier))!;
      const candidate = resolveExport(target, name, next);
      if (candidate.kind === 'missing') continue;
      if (candidate.kind === 'ambiguous') return candidate;
      if (!found) found = candidate;
      else if (!sameResolution(found, candidate)) return { kind: 'ambiguous' };
    }
    return found ?? { kind: 'missing' };
  };

  const exportedNames = (module: ModuleIr, visited = new Set<string>()): string[] => {
    if (visited.has(module.file)) return [];
    const next = new Set(visited); next.add(module.file);
    const candidates = new Set<string>([
      ...module.localExports.map(e => e.exportName),
      ...module.indirectExports.map(e => e.exportName),
    ]);
    for (const star of module.starExports) {
      const target = records.get(targetFor(module.file, star.specifier))!;
      for (const name of exportedNames(target, next)) if (name !== 'default') candidates.add(name);
    }
    return [...candidates].filter(name => {
      const r = resolveExport(module, name, new Set());
      return r.kind !== 'missing' && r.kind !== 'ambiguous';
    }).sort((a, b) => a.localeCompare(b));
  };

  const failResolution = (module: string, requested: string, resolution: ExportResolution): never => {
    if (resolution.kind === 'ambiguous') {
      const ruleId: ModuleRuleId = 'modules.esm.ambiguous-star-export-link-error';
      const proof = requireModuleRule(db, ruleId, moduleFacts({
        ...BASE_FACTS, resolved_export: 'ambiguous_due_to_export_star',
      }, `${module}: named import '${requested}' is ambiguous`));
      trace.push({ module, operation: `ambiguous import ${requested}`, ...proof });
      throw new ModuleLinkError('E_MODULE_AMBIGUOUS_EXPORT', `Export '${requested}' is ambiguous while linking ${module}.`, ruleId);
    }
    const ruleId: ModuleRuleId = 'modules.esm.missing-export-link-error';
    const proof = requireModuleRule(db, ruleId, moduleFacts({
      ...BASE_FACTS, requested_export_missing: true,
    }, `${module}: named import '${requested}' is missing`));
    trace.push({ module, operation: `missing import ${requested}`, ...proof });
    throw new ModuleLinkError('E_MODULE_MISSING_EXPORT', `Export '${requested}' is missing while linking ${module}.`, ruleId);
  };

  for (const module of records.values()) {
    const map = new Map<string, ExportResolution>();
    for (const item of module.imports) {
      if (map.has(item.localName)) throw new ModuleLinkError('E_MODULE_DUP_BINDING', `Duplicate imported binding '${item.localName}' in ${module.file}.`);
      const target = records.get(targetFor(module.file, item.specifier))!;
      let resolution: ExportResolution;
      if (item.importName === '*namespace*') {
        resolution = { kind: 'namespace', module: target.file };
        prove(module.file, `namespace import ${item.localName}`, 'modules.esm.namespace-import',
          { module_request_statically_resolved: true });
        prove(target.file, 'namespace exotic object', 'modules.esm.namespace-exotic-object',
          { value_proven: 'ECMAScript module namespace object' });
        prove(target.file, 'namespace key order', 'modules.esm.namespace-own-key-order',
          { receiver_proven: 'ECMAScript module namespace object' });
      } else {
        resolution = resolveExport(target, item.importName, new Set());
        if (resolution.kind === 'missing' || resolution.kind === 'ambiguous')
          failResolution(module.file, item.importName, resolution);
        prove(module.file, `import ${item.localName}`,
          item.importName === 'default' ? 'modules.esm.default-import-live-binding' : 'modules.esm.named-import-live-binding',
          { module_request_statically_resolved: true });
      }
      map.set(item.localName, resolution);
    }
    importBindings.set(module.file, map);

    for (const local of module.localExports) {
      const resolution = resolveLocal(module, local.localName, new Set());
      if (resolution.kind === 'missing') throw new ModuleLinkError(
        'E_MODULE_LOCAL_EXPORT', `Export '${local.exportName}' refers to unknown local binding '${local.localName}' in ${module.file}.`,
      );
    }
    for (const item of module.indirectExports) {
      if (item.importName === '*namespace*') continue;
      const target = records.get(targetFor(module.file, item.specifier))!;
      const resolution = resolveExport(target, item.importName, new Set());
      if (resolution.kind === 'missing' || resolution.kind === 'ambiguous')
        failResolution(module.file, item.importName, resolution);
    }
  }

  const cycles: string[][] = [], color = new Map<string, 0 | 1 | 2>(), stack: string[] = [];
  const cycleDfs = (id: string): void => {
    color.set(id, 1); stack.push(id);
    const module = records.get(id)!;
    for (const request of module.requests) {
      const target = targetFor(id, request.specifier), state = color.get(target) ?? 0;
      if (state === 0) cycleDfs(target);
      else if (state === 1) {
        const start = stack.lastIndexOf(target);
        const cycle = [...stack.slice(start), target];
        if (!cycles.some(c => c.join('\0') === cycle.join('\0'))) cycles.push(cycle);
      }
    }
    stack.pop(); color.set(id, 2);
  };
  for (const id of records.keys()) if ((color.get(id) ?? 0) === 0) cycleDfs(id);
  for (const cycle of cycles) prove(cycle[0]!, 'cycle TDZ boundary', 'modules.esm.cycle-tdz',
    { module_graph_contains_cycle: true, target_binding_may_be_uninitialized: true });

  const evaluationOrder: string[] = [], evalState = new Map<string, 0 | 1 | 2>();
  const evaluateDfs = (id: string): void => {
    const state = evalState.get(id) ?? 0;
    if (state === 2 || state === 1) return;
    evalState.set(id, 1);
    const module = records.get(id)!;
    for (const request of module.requests) evaluateDfs(targetFor(id, request.specifier));
    evalState.set(id, 2); evaluationOrder.push(id);
  };
  evaluateDfs(entry);

  const linked = new Map<string, LinkedModule>();
  for (const module of records.values()) linked.set(module.file, {
    id: module.file,
    imports: importBindings.get(module.file) ?? new Map(),
    exportNames: exportedNames(module),
  });
  return { entry, modules: linked, evaluationOrder, cycles, trace };
}
