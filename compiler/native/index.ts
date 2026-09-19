import { Facts } from '../analysis/facts.js';
import { fail } from '../diagnostics/index.js';
import type { RuleDatabase } from '../rules/loader.js';
import { evaluate, type Predicate } from '../rules/requirements.js';

export const NATIVE_CJS_RULE_ID = 'modules.cjs.require-resolution';
export const NATIVE_CJS_RULE_SHA256 = 'c13a5317de8ae0d42086ac3082e1bbdec571d83650e5161b92f6a835d26ebc6d';

export type NativeModuleRoute = 'known-adapter' | 'pinvoke-wrapper' | 'sidecar-bridge' | 'unsupported';
export type NativeModuleLifetime = 'process' | 'module' | 'handle';
export type NativeErrorModel = 'napi-status' | 'errno' | 'return-code' | 'exception-free';

export interface NativeAbiContract {
  family: string;
  major: number;
  lifetime: NativeModuleLifetime;
  errors: NativeErrorModel;
}

export interface NativeModuleDescriptor {
  request: string;
  resolvedPath: string;
  format: 'node-addon';
  rid: string;
  abi: NativeAbiContract;
}

export interface NativeModuleResolutionRecord {
  request: string;
  resolvedPath: string;
  kind: 'native-addon' | 'javascript' | 'json' | 'unknown';
  rid: string;
  abi?: NativeAbiContract;
}

export interface NativeBackendCandidate {
  route: Exclude<NativeModuleRoute, 'unsupported'>;
  id: string;
  supportedRids: readonly string[];
  abi: NativeAbiContract;
}

export interface NativeResolverContext {
  host: string;
  moduleSystem: string;
  specifierNotCompileTimeIntrinsic: boolean;
}

export interface NativeResolverProof {
  ruleId: typeof NATIVE_CJS_RULE_ID;
  sha256: string;
  verdict: 'proven';
  evidence: string[];
}

export interface NativeModuleDiagnostic {
  code:
    | 'E_NATIVE_MODULE_AMBIGUOUS'
    | 'E_NATIVE_MODULE_UNSUPPORTED'
    | 'E_NATIVE_MODULE_ABI_UNKNOWN'
    | 'E_NATIVE_MODULE_KIND_UNKNOWN';
  message: string;
}

export type NativeModuleDiscovery =
  | { kind: 'native-module'; descriptor: NativeModuleDescriptor; resolverProof: NativeResolverProof }
  | { kind: 'not-native'; resolverProof: NativeResolverProof }
  | { kind: 'unsupported-native'; resolverProof: NativeResolverProof; diagnostic: NativeModuleDiagnostic };

export interface NativeModulePlan {
  descriptor: NativeModuleDescriptor;
  route: NativeModuleRoute;
  backendId?: string;
  resolverProof: NativeResolverProof;
  diagnostic?: NativeModuleDiagnostic;
}

const resolverPredicate: Predicate = {
  all: [
    { fact: 'profile.host', equals: 'Node.js' },
    { fact: 'module.system', equals: 'CommonJS' },
    { fact: 'module.specifierNotCompileTimeIntrinsic', equals: true },
  ],
};

function validateCanonicalRuleShape(requirements: Record<string, unknown> | undefined): void {
  const keys = Object.keys(requirements ?? {}).sort().join(',');
  if (keys !== 'host,module_system,specifier_not_compile_time_intrinsic'
      || requirements?.host !== 'Node.js'
      || requirements?.module_system !== 'CommonJS'
      || requirements?.specifier_not_compile_time_intrinsic !== true) {
    fail('E_NATIVE_RULE_CONTRACT',
      `Canonical rule ${NATIVE_CJS_RULE_ID} requirements changed; review the native-module adapter before enabling it.`);
  }
}

export function proveNativeModuleResolution(database: RuleDatabase, context: NativeResolverContext): NativeResolverProof {
  const loaded = database.byId.get(NATIVE_CJS_RULE_ID);
  if (!loaded) fail('E_NATIVE_RULE_MISSING', `Canonical rule is absent: ${NATIVE_CJS_RULE_ID}`);
  if (loaded.sha256 !== NATIVE_CJS_RULE_SHA256) {
    fail('E_NATIVE_RULE_CONTRACT',
      `Canonical rule ${NATIVE_CJS_RULE_ID} changed; review the native-module adapter before enabling it.`,
      undefined, { expected: NATIVE_CJS_RULE_SHA256, actual: loaded.sha256, file: loaded.file });
  }
  validateCanonicalRuleShape(loaded.rule.source.requirements);
  const facts = new Facts()
    .prove('profile.host', context.host, 'Native module planner host profile')
    .prove('module.system', context.moduleSystem, 'Module resolver supplied the module-system fact')
    .prove('module.specifierNotCompileTimeIntrinsic', context.specifierNotCompileTimeIntrinsic,
      'Resolved request is not a compile-time intrinsic');
  const proof = evaluate(resolverPredicate, facts);
  if (proof.verdict !== 'proven') {
    fail('E_NATIVE_RULE_PROOF',
      `Canonical rule ${NATIVE_CJS_RULE_ID} proof is not proven; native module discovery remains fail-closed.`,
      undefined, proof);
  }
  return { ruleId: NATIVE_CJS_RULE_ID, sha256: loaded.sha256, verdict: 'proven', evidence: proof.evidence };
}

const routes: readonly Exclude<NativeModuleRoute, 'unsupported'>[] =
  ['known-adapter', 'pinvoke-wrapper', 'sidecar-bridge'];

export function discoverNativeModule(
  database: RuleDatabase,
  context: NativeResolverContext,
  resolution: NativeModuleResolutionRecord,
): NativeModuleDiscovery {
  const resolverProof = proveNativeModuleResolution(database, context);
  validateText(resolution.request, 'request');
  validateText(resolution.resolvedPath, 'resolved path');
  validateText(resolution.rid, 'RID');

  if (resolution.kind === 'javascript' || resolution.kind === 'json')
    return { kind: 'not-native', resolverProof };

  if (resolution.kind === 'unknown') {
    return {
      kind: 'unsupported-native',
      resolverProof,
      diagnostic: {
        code: 'E_NATIVE_MODULE_KIND_UNKNOWN',
        message: `Resolver did not prove a load kind for ${resolution.request}; refusing native migration guessing.`,
      },
    };
  }

  if (!resolution.abi) {
    return {
      kind: 'unsupported-native',
      resolverProof,
      diagnostic: {
        code: 'E_NATIVE_MODULE_ABI_UNKNOWN',
        message: `Resolver identified ${resolution.request} as a native addon without a reviewed ABI contract.`,
      },
    };
  }

  validateAbi(resolution.abi);
  return {
    kind: 'native-module',
    resolverProof,
    descriptor: {
      request: resolution.request,
      resolvedPath: resolution.resolvedPath,
      format: 'node-addon',
      rid: resolution.rid,
      abi: resolution.abi,
    },
  };
}

function validateText(value: string, field: string): void {
  if (!value.length) fail('E_NATIVE_PLAN', `Native module ${field} must be non-empty.`);
}

function validateAbi(abi: NativeAbiContract): void {
  validateText(abi.family, 'ABI family');
  if (!Number.isSafeInteger(abi.major) || abi.major < 0)
    fail('E_NATIVE_PLAN', 'Native module ABI major must be a non-negative safe integer.');
}

function sameAbi(a: NativeAbiContract, b: NativeAbiContract): boolean {
  return a.family === b.family && a.major === b.major && a.lifetime === b.lifetime && a.errors === b.errors;
}

function matches(descriptor: NativeModuleDescriptor, candidate: NativeBackendCandidate): boolean {
  return candidate.supportedRids.includes(descriptor.rid) && sameAbi(descriptor.abi, candidate.abi);
}

export function planNativeModule(
  descriptor: NativeModuleDescriptor,
  candidates: readonly NativeBackendCandidate[],
  resolverProof: NativeResolverProof,
): NativeModulePlan {
  validateText(descriptor.request, 'request');
  validateText(descriptor.resolvedPath, 'resolved path');
  validateText(descriptor.rid, 'RID');
  validateAbi(descriptor.abi);
  if (descriptor.format !== 'node-addon')
    fail('E_NATIVE_PLAN', 'Native module planner only accepts resolver-proven node-addon entries.');
  if (resolverProof.ruleId !== NATIVE_CJS_RULE_ID || resolverProof.sha256 !== NATIVE_CJS_RULE_SHA256
      || resolverProof.verdict !== 'proven') {
    fail('E_NATIVE_RULE_PROOF', 'Native module planning requires the reviewed canonical CommonJS resolver proof.');
  }
  for (const candidate of candidates) {
    validateText(candidate.id, 'backend id');
    validateAbi(candidate.abi);
    if (!candidate.supportedRids.length)
      fail('E_NATIVE_PLAN', `Native backend ${candidate.id} has no supported RIDs.`);
  }
  for (const route of routes) {
    const eligible = candidates.filter(candidate => candidate.route === route && matches(descriptor, candidate));
    if (eligible.length > 1) {
      return {
        descriptor, route: 'unsupported', resolverProof,
        diagnostic: {
          code: 'E_NATIVE_MODULE_AMBIGUOUS',
          message: `Multiple ${route} backends exactly match ${descriptor.request}; refusing arbitrary backend selection.`,
        },
      };
    }
    const chosen = eligible[0];
    if (chosen) return { descriptor, route, backendId: chosen.id, resolverProof };
  }
  return {
    descriptor, route: 'unsupported', resolverProof,
    diagnostic: {
      code: 'E_NATIVE_MODULE_UNSUPPORTED',
      message: `No reviewed native backend exactly matches ${descriptor.request} for ${descriptor.rid} and ABI ${descriptor.abi.family}@${descriptor.abi.major}.`,
    },
  };
}

function escapeTrace(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('|', '\\|').replaceAll('\r', '\\r').replaceAll('\n', '\\n');
}

export function traceNativeModulePlan(plan: NativeModulePlan): string {
  const d = plan.descriptor, a = d.abi;
  return [
    plan.route,
    plan.backendId ?? '-',
    escapeTrace(d.request),
    escapeTrace(d.resolvedPath),
    escapeTrace(d.rid),
    `${escapeTrace(a.family)}@${a.major}`,
    a.lifetime,
    a.errors,
    plan.diagnostic?.code ?? '-',
  ].join('|');
}
