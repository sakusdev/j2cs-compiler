import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ROOT } from '../../compiler/index.js';
import { loadRules } from '../../compiler/rules/loader.js';
import {
  NATIVE_CJS_RULE_ID,
  NATIVE_CJS_RULE_SHA256,
  discoverNativeModule,
  planNativeModule,
  proveNativeModuleResolution,
  traceNativeModulePlan,
  type NativeAbiContract,
  type NativeBackendCandidate,
  type NativeModuleDescriptor,
} from '../../compiler/native/index.js';

const database = await loadRules(path.join(ROOT, 'rule-db'));
const resolverProof = proveNativeModuleResolution(database, {
  host: 'Node.js',
  moduleSystem: 'CommonJS',
  specifierNotCompileTimeIntrinsic: true,
});

const abi = (
  family = 'napi',
  major = 8,
  lifetime: NativeAbiContract['lifetime'] = 'module',
  errors: NativeAbiContract['errors'] = 'napi-status',
): NativeAbiContract => ({ family, major, lifetime, errors });

const descriptor = (request = 'sharp'): NativeModuleDescriptor => ({
  request,
  resolvedPath: `/modules/${request}.node`,
  format: 'node-addon',
  rid: 'linux-x64',
  abi: abi(),
});

const backend = (
  route: NativeBackendCandidate['route'],
  id: string,
  contract = abi(),
  supportedRids: readonly string[] = ['linux-x64'],
): NativeBackendCandidate => ({ route, id, supportedRids, abi: contract });

test('native planner pins and proves canonical CommonJS require resolution', () => {
  assert.equal(resolverProof.ruleId, NATIVE_CJS_RULE_ID);
  assert.equal(resolverProof.sha256, NATIVE_CJS_RULE_SHA256);
  assert.equal(resolverProof.verdict, 'proven');
  assert.ok(resolverProof.evidence.length >= 3);
});

test('native planner fails closed when canonical resolver requirements are not proven', () => {
  assert.throws(() => proveNativeModuleResolution(database, {
    host: 'Node.js',
    moduleSystem: 'ESM',
    specifierNotCompileTimeIntrinsic: true,
  }), /proof is not proven/);
});


test('native discovery requires resolver-proven kind and ABI metadata', () => {
  const found = discoverNativeModule(database, {
    host: 'Node.js',
    moduleSystem: 'CommonJS',
    specifierNotCompileTimeIntrinsic: true,
  }, {
    request: 'sharp',
    resolvedPath: '/modules/sharp.node',
    kind: 'native-addon',
    rid: 'linux-x64',
    abi: abi(),
  });
  assert.equal(found.kind, 'native-module');
  if (found.kind === 'native-module') assert.equal(found.descriptor.format, 'node-addon');

  const noAbi = discoverNativeModule(database, {
    host: 'Node.js',
    moduleSystem: 'CommonJS',
    specifierNotCompileTimeIntrinsic: true,
  }, {
    request: 'opaque',
    resolvedPath: '/modules/opaque.node',
    kind: 'native-addon',
    rid: 'linux-x64',
  });
  assert.equal(noAbi.kind, 'unsupported-native');
  if (noAbi.kind === 'unsupported-native')
    assert.equal(noAbi.diagnostic.code, 'E_NATIVE_MODULE_ABI_UNKNOWN');

  const unknown = discoverNativeModule(database, {
    host: 'Node.js',
    moduleSystem: 'CommonJS',
    specifierNotCompileTimeIntrinsic: true,
  }, {
    request: 'mystery',
    resolvedPath: '/modules/mystery',
    kind: 'unknown',
    rid: 'linux-x64',
  });
  assert.equal(unknown.kind, 'unsupported-native');
  if (unknown.kind === 'unsupported-native')
    assert.equal(unknown.diagnostic.code, 'E_NATIVE_MODULE_KIND_UNKNOWN');
});

test('known adapters outrank exact wrapper and sidecar contracts', () => {
  const plan = planNativeModule(descriptor(), [
    backend('sidecar-bridge', 'sidecar'),
    backend('pinvoke-wrapper', 'wrapper'),
    backend('known-adapter', 'sharp-adapter'),
  ], resolverProof);
  assert.equal(plan.route, 'known-adapter');
  assert.equal(plan.backendId, 'sharp-adapter');
});

test('fallback requires exact RID, ABI, lifetime and error contracts', () => {
  const plan = planNativeModule(descriptor(), [
    backend('known-adapter', 'wrong-rid', abi(), ['win-x64']),
    backend('pinvoke-wrapper', 'wrong-error', abi('napi', 8, 'module', 'return-code')),
    backend('sidecar-bridge', 'safe-sidecar'),
  ], resolverProof);
  assert.equal(plan.route, 'sidecar-bridge');
  assert.equal(plan.backendId, 'safe-sidecar');
});

test('multiple exact backends in one tier fail closed instead of using ID order', () => {
  const plan = planNativeModule(descriptor('ambiguous'), [
    backend('pinvoke-wrapper', 'a'),
    backend('pinvoke-wrapper', 'b'),
    backend('sidecar-bridge', 'later-tier'),
  ], resolverProof);
  assert.equal(plan.route, 'unsupported');
  assert.equal(plan.diagnostic?.code, 'E_NATIVE_MODULE_AMBIGUOUS');
});

test('unmatched native modules produce explicit unsupported diagnostic and stable trace', () => {
  const plan = planNativeModule(
    descriptor('missing'),
    [backend('known-adapter', 'windows-only', abi(), ['win-x64'])],
    resolverProof,
  );
  assert.equal(plan.route, 'unsupported');
  assert.equal(plan.diagnostic?.code, 'E_NATIVE_MODULE_UNSUPPORTED');
  assert.equal(
    traceNativeModulePlan(plan),
    'unsupported|-|missing|/modules/missing.node|linux-x64|napi@8|module|napi-status|E_NATIVE_MODULE_UNSUPPORTED',
  );
});
