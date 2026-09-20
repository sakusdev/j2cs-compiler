import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ROOT } from '../../compiler/index.js';
import { loadRules } from '../../compiler/rules/loader.js';
import {
  planNativeModule,
  proveNativeModuleResolution,
  traceNativeModulePlan,
  type NativeAbiContract,
  type NativeBackendCandidate,
  type NativeModuleDescriptor,
} from '../../compiler/native/index.js';
import { run } from './harness.js';

const abi = (
  family = 'napi',
  major = 8,
  lifetime: NativeAbiContract['lifetime'] = 'module',
  errors: NativeAbiContract['errors'] = 'napi-status',
): NativeAbiContract => ({ family, major, lifetime, errors });

const descriptor = (request: string): NativeModuleDescriptor => ({
  request,
  resolvedPath: `/modules/${request}.node`,
  format: 'node-addon',
  rid: 'linux-x64',
  abi: abi(),
});

const candidate = (
  route: NativeBackendCandidate['route'],
  id: string,
  contract = abi(),
  supportedRids: readonly string[] = ['linux-x64'],
): NativeBackendCandidate => ({ route, id, supportedRids, abi: contract });

test('Node planner vs C# NativeCompat route and contract traces', { timeout: 90_000 }, async () => {
  const database = await loadRules(path.join(ROOT, 'rule-db'));
  const proof = proveNativeModuleResolution(database, {
    host: 'Node.js',
    moduleSystem: 'CommonJS',
    specifierNotCompileTimeIntrinsic: true,
  });

  const cases = [
    [descriptor('known'), [
      candidate('sidecar-bridge', 'side'),
      candidate('pinvoke-wrapper', 'wrap'),
      candidate('known-adapter', 'known-adapter'),
    ]],
    [descriptor('wrapper'), [
      candidate('known-adapter', 'wrong-rid', abi(), ['win-x64']),
      candidate('pinvoke-wrapper', 'pinvoke'),
    ]],
    [descriptor('sidecar'), [
      candidate('pinvoke-wrapper', 'wrong-abi', abi('napi', 7)),
      candidate('sidecar-bridge', 'bridge'),
    ]],
    [descriptor('ambiguous'), [
      candidate('sidecar-bridge', 'a'),
      candidate('sidecar-bridge', 'b'),
    ]],
    [descriptor('missing'), [
      candidate('known-adapter', 'windows-only', abi(), ['win-x64']),
    ]],
  ] as const;

  const expected = cases
    .map(([entry, candidates]) => traceNativeModulePlan(planNativeModule(entry, candidates, proof)))
    .join('\n') + '\n';

  const project = path.join(ROOT, 'tests/differential/native-runtime/NativeRuntimeFixture.csproj');
  const dotnet = process.env.DOTNET ?? 'dotnet';
  const build = await run(dotnet, ['build', project, '--nologo', '-v', 'quiet'], ROOT, 60_000);
  assert.equal(build.exit, 0, `dotnet build failed:\n${build.stdout}\n${build.stderr}`);

  const dll = path.join(ROOT, 'tests/differential/native-runtime/bin/Debug/net8.0/NativeRuntimeFixture.dll');
  const csharp = await run(dotnet, [dll], ROOT);
  assert.equal(csharp.exit, 0);
  assert.equal(csharp.stderr, '');
  assert.equal(csharp.stdout.replaceAll('\r\n', '\n'), expected);
});
