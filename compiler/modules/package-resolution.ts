export type ModuleRequestKind = 'import' | 'require';

export type PackageTarget =
  | string
  | null
  | readonly PackageTarget[]
  | { readonly [key: string]: PackageTarget };

export interface PackageJsonModel {
  readonly name?: string;
  readonly type?: 'module' | 'commonjs';
  readonly main?: string;
  readonly exports?: PackageTarget;
  readonly imports?: Readonly<Record<string, PackageTarget>>;
}

export type ModuleResolutionErrorCode =
  | 'ERR_INVALID_PACKAGE_CONFIG'
  | 'ERR_INVALID_PACKAGE_TARGET'
  | 'ERR_PACKAGE_PATH_NOT_EXPORTED'
  | 'ERR_PACKAGE_IMPORT_NOT_DEFINED'
  | 'ERR_INVALID_MODULE_SPECIFIER';

export class ModuleResolutionError extends Error {
  constructor(public readonly code: ModuleResolutionErrorCode, message: string) {
    super(message);
    this.name = 'ModuleResolutionError';
  }
}

export interface ResolvedPackageTarget {
  readonly kind: 'package-file' | 'external-package';
  readonly target: string;
  readonly conditions: readonly string[];
  readonly ruleIds: readonly string[];
}

export type NodeModuleFormat = 'commonjs' | 'module' | 'unknown';

export interface ModuleInteropBoundary {
  readonly kind: 'runtime' | 'error' | 'unsupported';
  readonly ruleId: string;
  readonly code?: 'ERR_REQUIRE_ASYNC_MODULE' | 'E_MODULE_GRAPH_ASYNC_UNKNOWN';
  readonly compileTimeBindingSafe: boolean;
  readonly note: string;
}

const PACKAGE_TARGET_RULE = 'node.module-resolution.package-target-relative';
const CONDITIONS_RULE = 'node.module-resolution.import-require-conditions';

function isTargetObject(value: PackageTarget): value is { readonly [key: string]: PackageTarget } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function conditionsFor(kind: ModuleRequestKind, custom: readonly string[]): readonly string[] {
  return unique(['node', kind, ...custom]);
}

function error(code: ModuleResolutionErrorCode, message: string): never {
  throw new ModuleResolutionError(code, message);
}

function assertConditionObjectKeys(target: { readonly [key: string]: PackageTarget }): void {
  for (const key of Object.keys(target)) {
    if (/^(0|[1-9]\d*)$/.test(key)) {
      error('ERR_INVALID_PACKAGE_CONFIG', 'Numeric package condition keys are not supported because condition insertion order is semantic.');
    }
  }
}

function replacePattern(value: string, patternMatch: string | undefined): string {
  return patternMatch === undefined ? value : value.replaceAll('*', patternMatch);
}

function validateRelativeTarget(target: string): void {
  if (!target.startsWith('./')) error('ERR_INVALID_PACKAGE_TARGET', `Package target must start with "./": ${target}`);
  if (/%2f|%2F|%5c|%5C/.test(target)) {
    error('ERR_INVALID_PACKAGE_TARGET', `Encoded path separators are not permitted in package targets: ${target}`);
  }
  const segments = target.slice(2).split('/');
  for (const segment of segments) {
    if (segment === '.' || segment === '..' || segment === 'node_modules') {
      error('ERR_INVALID_PACKAGE_TARGET', `Forbidden package target segment "${segment}" in ${target}`);
    }
  }
}

interface ResolveContext {
  readonly isImports: boolean;
  readonly conditions: ReadonlySet<string>;
  readonly conditionList: readonly string[];
  readonly patternMatch?: string;
}

function resolveTarget(target: PackageTarget, context: ResolveContext): ResolvedPackageTarget | undefined {
  if (target === null) return undefined;

  if (typeof target === 'string') {
    const mapped = replacePattern(target, context.patternMatch);
    if (mapped.startsWith('./')) {
      validateRelativeTarget(mapped);
      return {
        kind: 'package-file',
        target: mapped,
        conditions: context.conditionList,
        ruleIds: [PACKAGE_TARGET_RULE],
      };
    }
    if (!context.isImports) {
      error('ERR_INVALID_PACKAGE_TARGET', `Package exports target must be package-relative: ${mapped}`);
    }
    if (mapped.startsWith('../') || mapped.startsWith('/') || mapped === '' || mapped.startsWith('#')) {
      error('ERR_INVALID_PACKAGE_TARGET', `Invalid package imports target: ${mapped}`);
    }
    return {
      kind: 'external-package',
      target: mapped,
      conditions: context.conditionList,
      ruleIds: ['node.module-resolution.package-imports-external-target'],
    };
  }

  if (Array.isArray(target)) {
    let lastInvalidTarget: ModuleResolutionError | undefined;
    for (const entry of target) {
      try {
        const resolved = resolveTarget(entry, context);
        if (resolved) return resolved;
      } catch (caught) {
        if (caught instanceof ModuleResolutionError && caught.code === 'ERR_INVALID_PACKAGE_TARGET') {
          lastInvalidTarget = caught;
          continue;
        }
        throw caught;
      }
    }
    if (lastInvalidTarget) throw lastInvalidTarget;
    return undefined;
  }

  if (isTargetObject(target)) {
    assertConditionObjectKeys(target);
    for (const [condition, entry] of Object.entries(target)) {
      if (condition !== 'default' && !context.conditions.has(condition)) continue;
      const resolved = resolveTarget(entry, context);
      if (resolved) {
        return {
          ...resolved,
          ruleIds: unique(['node.module-resolution.conditional-exports-order', ...resolved.ruleIds]),
        };
      }
    }
    return undefined;
  }

  return undefined;
}

interface Match {
  readonly target: PackageTarget;
  readonly patternMatch?: string;
  readonly usedPattern: boolean;
}

function matchMap(map: Readonly<Record<string, PackageTarget>>, request: string): Match | undefined {
  if (Object.prototype.hasOwnProperty.call(map, request)) {
    return { target: map[request]!, usedPattern: false };
  }
  const matches: { key: string; prefix: string; suffix: string; target: PackageTarget }[] = [];
  for (const [key, target] of Object.entries(map)) {
    const first = key.indexOf('*');
    if (first < 0) continue;
    if (first !== key.lastIndexOf('*')) {
      error('ERR_INVALID_PACKAGE_CONFIG', `Package pattern key may contain only one "*": ${key}`);
    }
    const prefix = key.slice(0, first), suffix = key.slice(first + 1);
    if (request.startsWith(prefix) && request.endsWith(suffix) && request.length >= prefix.length + suffix.length) {
      matches.push({ key, prefix, suffix, target });
    }
  }
  matches.sort((a, b) => b.prefix.length - a.prefix.length || b.key.length - a.key.length);
  const best = matches[0];
  if (!best) return undefined;
  return {
    target: best.target,
    patternMatch: request.slice(best.prefix.length, request.length - best.suffix.length),
    usedPattern: true,
  };
}

function asExportsMap(exportsTarget: PackageTarget, subpath: string): Match | undefined {
  if (!isTargetObject(exportsTarget)) {
    return subpath === '.' ? { target: exportsTarget, usedPattern: false } : undefined;
  }
  const keys = Object.keys(exportsTarget);
  const dotKeys = keys.filter(key => key.startsWith('.'));
  if (dotKeys.length !== 0 && dotKeys.length !== keys.length) {
    error('ERR_INVALID_PACKAGE_CONFIG', 'Package exports cannot mix subpath keys and condition keys at the same level.');
  }
  if (dotKeys.length === 0) {
    return subpath === '.' ? { target: exportsTarget, usedPattern: false } : undefined;
  }
  return matchMap(exportsTarget, subpath);
}

function withRules(resolved: ResolvedPackageTarget, ruleIds: readonly string[]): ResolvedPackageTarget {
  return { ...resolved, ruleIds: unique([...ruleIds, ...resolved.ruleIds]) };
}

export function resolvePackageExports(
  exportsTarget: PackageTarget,
  subpath: string,
  kind: ModuleRequestKind,
  customConditions: readonly string[] = [],
): ResolvedPackageTarget {
  if (subpath !== '.' && !subpath.startsWith('./')) {
    error('ERR_INVALID_MODULE_SPECIFIER', `Invalid package subpath: ${subpath}`);
  }
  const conditions = conditionsFor(kind, customConditions);
  const match = asExportsMap(exportsTarget, subpath);
  if (!match) error('ERR_PACKAGE_PATH_NOT_EXPORTED', `Package subpath "${subpath}" is not exported.`);
  const resolved = resolveTarget(match.target, {
    isImports: false,
    conditions: new Set(conditions),
    conditionList: conditions,
    patternMatch: match.patternMatch,
  });
  if (!resolved) error('ERR_PACKAGE_PATH_NOT_EXPORTED', `Package subpath "${subpath}" is blocked by exports.`);
  const entryRule = subpath === '.'
    ? 'node.module-resolution.package-exports-main'
    : 'node.module-resolution.package-exports-subpath';
  return withRules(resolved, [
    CONDITIONS_RULE,
    entryRule,
    ...(match.usedPattern ? ['node.module-resolution.package-exports-pattern'] : []),
  ]);
}

export function resolvePackageImports(
  imports: Readonly<Record<string, PackageTarget>>,
  specifier: string,
  kind: ModuleRequestKind,
  customConditions: readonly string[] = [],
): ResolvedPackageTarget {
  if (!specifier.startsWith('#') || specifier === '#' || specifier.startsWith('#/')) {
    error('ERR_INVALID_MODULE_SPECIFIER', `Invalid package imports specifier: ${specifier}`);
  }
  const conditions = conditionsFor(kind, customConditions);
  const match = matchMap(imports, specifier);
  if (!match) error('ERR_PACKAGE_IMPORT_NOT_DEFINED', `Package import "${specifier}" is not defined.`);
  const resolved = resolveTarget(match.target, {
    isImports: true,
    conditions: new Set(conditions),
    conditionList: conditions,
    patternMatch: match.patternMatch,
  });
  if (!resolved) error('ERR_PACKAGE_IMPORT_NOT_DEFINED', `Package import "${specifier}" is blocked.`);
  return withRules(resolved, [
    CONDITIONS_RULE,
    'node.module-resolution.package-imports',
    ...(match.usedPattern ? ['node.module-resolution.package-imports-pattern'] : []),
  ]);
}

export function classifyNodeModuleFormat(filename: string, packageType?: 'module' | 'commonjs'): NodeModuleFormat {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.mjs')) return 'module';
  if (lower.endsWith('.cjs')) return 'commonjs';
  if (lower.endsWith('.js')) return packageType ?? 'unknown';
  return 'unknown';
}

export function describeNodeInterop(request: {
  readonly importer: 'commonjs' | 'module';
  readonly target: 'commonjs' | 'module';
  readonly requestKind: ModuleRequestKind;
  readonly importForm?: 'default' | 'named';
  readonly targetGraphContainsTopLevelAwait?: boolean;
}): ModuleInteropBoundary {
  if (request.importer === 'module' && request.target === 'commonjs' && request.requestKind === 'import') {
    if (request.importForm === 'named') {
      return {
        kind: 'runtime',
        ruleId: 'modules.interop.esm-import-commonjs-named',
        compileTimeBindingSafe: false,
        note: 'Named CommonJS exports are Node host heuristics and are not a general live binding.',
      };
    }
    return {
      kind: 'runtime',
      ruleId: 'modules.interop.esm-import-commonjs-default',
      compileTimeBindingSafe: true,
      note: 'The default export is the CommonJS module.exports value.',
    };
  }

  if (request.importer === 'commonjs' && request.target === 'module' && request.requestKind === 'require') {
    if (request.targetGraphContainsTopLevelAwait === true) {
      return {
        kind: 'error',
        ruleId: 'modules.interop.require-esm-top-level-await-error',
        code: 'ERR_REQUIRE_ASYNC_MODULE',
        compileTimeBindingSafe: false,
        note: 'CommonJS require must not synchronously block on an asynchronous ESM graph.',
      };
    }
    if (request.targetGraphContainsTopLevelAwait === false) {
      return {
        kind: 'runtime',
        ruleId: 'modules.interop.require-esm-synchronous',
        compileTimeBindingSafe: false,
        note: 'Synchronous require(esm) remains Node-version/profile gated and returns a namespace by default.',
      };
    }
    return {
      kind: 'unsupported',
      ruleId: 'modules.interop.require-esm-synchronous',
      code: 'E_MODULE_GRAPH_ASYNC_UNKNOWN',
      compileTimeBindingSafe: false,
      note: 'Fail closed until whole-graph top-level-await analysis proves synchronous evaluation.',
    };
  }

  if (request.importer === 'commonjs' && request.target === 'commonjs' && request.requestKind === 'require') {
    return {
      kind: 'runtime',
      ruleId: 'modules.cjs.require-cache',
      compileTimeBindingSafe: true,
      note: 'CommonJS require uses caller-relative resolution and cache-before-evaluation semantics.',
    };
  }

  return {
    kind: 'unsupported',
    ruleId: 'node.module-resolution.package-type',
    compileTimeBindingSafe: false,
    note: 'This module-system crossing is owned by another linker/runtime lane and remains fail-closed here.',
  };
}
