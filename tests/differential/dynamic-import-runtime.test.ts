import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT } from '../../compiler/index.js';
import { run } from './harness.js';

const expected = [
  'promise',
  'tla',
  'same',
  '1',
  'missing-promise',
  'rejected',
  '',
].join('\n');

test('Node vs C#: dynamic import promise boundary delegates cache/identity and waits for TLA', { timeout: 90_000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'j2cs-dynamic-import-'));
  const nodeDir = path.join(dir, 'node');
  const csDir = path.join(dir, 'csharp');
  await mkdir(nodeDir);
  await mkdir(csDir);

  try {
    await writeFile(path.join(nodeDir, 'entry.mjs'), `
globalThis.trace = [];
globalThis.evaluationCount = 0;

const pending = import('./tla.mjs');
console.log('promise');
const first = await pending;
console.log(globalThis.trace.join(','));

const second = await import('./tla.mjs');
console.log(first === second ? 'same' : 'different');
console.log(globalThis.evaluationCount);

try {
  const missing = import('./missing.mjs');
  console.log('missing-promise');
  await missing;
} catch {
  console.log('rejected');
}
`);
    await writeFile(path.join(nodeDir, 'tla.mjs'), `
globalThis.evaluationCount++;
await Promise.resolve();
globalThis.trace.push('tla');
export const token = 1;
`);

    const runtimeProject = path.join(ROOT, 'runtime/J2cs.Runtime/J2cs.Runtime.csproj').replaceAll('\\', '/');
    await writeFile(path.join(csDir, 'ModuleFixture.csproj'), `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
  </PropertyGroup>
  <ItemGroup>
    <ProjectReference Include="${runtimeProject}" />
  </ItemGroup>
</Project>
`);

    await writeFile(path.join(csDir, 'Program.cs'), `
using System.Collections.Concurrent;
using J2cs.Runtime;

sealed class FixtureHost : IJsDynamicModuleHost
{
    private readonly ConcurrentDictionary<string, Lazy<Task<JsValue>>> evaluations =
        new(StringComparer.Ordinal);

    internal readonly List<string> Trace = new();
    internal int EvaluationCount;

    public ValueTask<string> ResolveAsync(string specifier, string? referrerCanonicalKey)
    {
        var key = specifier.StartsWith("./", StringComparison.Ordinal) ? specifier[2..] : specifier;
        if (key.EndsWith(".mjs", StringComparison.Ordinal))
            key = key[..^4];
        return ValueTask.FromResult(key);
    }

    public Task<JsValue> EvaluateAsync(string canonicalKey)
    {
        if (canonicalKey == "missing")
            return Task.FromException<JsValue>(new FileNotFoundException(canonicalKey));

        return evaluations.GetOrAdd(canonicalKey, static (key, state) =>
            new Lazy<Task<JsValue>>(
                () => state.EvaluateCoreAsync(key),
                LazyThreadSafetyMode.ExecutionAndPublication), this).Value;
    }

    private async Task<JsValue> EvaluateCoreAsync(string canonicalKey)
    {
        if (canonicalKey != "tla")
            throw new FileNotFoundException(canonicalKey);

        EvaluationCount++;
        await Task.Yield();
        Trace.Add("tla");
        return JsObject.Create();
    }
}

static class Program
{
    private static async Task Main()
    {
        var host = new FixtureHost();
        var runtime = new JsDynamicModuleRuntime(host);

        var pending = runtime.DynamicImport("./tla.mjs");
        Console.WriteLine("promise");
        var first = await pending.AsTask();
        Console.WriteLine(string.Join(",", host.Trace));

        var second = await runtime.DynamicImport("./tla.mjs").AsTask();
        Console.WriteLine(JsOperators.StrictEquals(first, second) ? "same" : "different");
        Console.WriteLine(host.EvaluationCount);

        try
        {
            var missing = runtime.DynamicImport("./missing.mjs");
            Console.WriteLine("missing-promise");
            await missing.AsTask();
        }
        catch (FileNotFoundException)
        {
            Console.WriteLine("rejected");
        }
    }
}
`);

    const node = await run(process.execPath, ['entry.mjs'], nodeDir);
    assert.equal(node.exit, 0, `Node fixture failed:\n${node.stdout}\n${node.stderr}`);
    assert.equal(node.stdout, expected, 'Node oracle expectation drift');

    const dotnet = process.env.DOTNET ?? 'dotnet';
    const build = await run(dotnet, ['build', 'ModuleFixture.csproj', '--nologo', '-v', 'quiet'], csDir, 60_000);
    assert.equal(build.exit, 0, `dotnet build failed:\n${build.stdout}\n${build.stderr}`);

    const csharp = await run(dotnet, [path.join(csDir, 'bin/Debug/net8.0/ModuleFixture.dll')], csDir);
    assert.deepEqual(csharp, node, 'Dynamic-import/TLA runtime boundary differs from the Node ESM oracle');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
