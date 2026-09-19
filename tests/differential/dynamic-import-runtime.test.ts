import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT } from '../../compiler/index.js';
import { run } from './harness.js';

const expected = [
  'shared,a,b,diamond-main',
  'c2,c1,cycle-main',
  'same',
  '1',
  'promise',
  'rejected',
  '',
].join('\n');

test('Node vs C#: dynamic import cache, namespace identity, TLA ordering, cycles and rejection boundary', { timeout: 90_000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'j2cs-module-runtime-'));
  const nodeDir = path.join(dir, 'node');
  const csDir = path.join(dir, 'csharp');
  await mkdir(nodeDir);
  await mkdir(csDir);

  try {
    const nodeFiles: Record<string, string> = {
      'entry.mjs': `
globalThis.trace = [];
await import('./diamond-main.mjs');
console.log(globalThis.trace.join(','));

globalThis.trace = [];
await import('./cycle-main.mjs');
console.log(globalThis.trace.join(','));

const [first, second] = await Promise.all([import('./shared.mjs'), import('./shared.mjs')]);
console.log(first === second ? 'same' : 'different');
console.log(globalThis.sharedCount);

try {
  const pending = import('./missing.mjs');
  console.log('promise');
  await pending;
} catch {
  console.log('rejected');
}
`,
      'shared.mjs': `
globalThis.sharedCount = (globalThis.sharedCount ?? 0) + 1;
await Promise.resolve();
globalThis.trace.push('shared');
export const token = 1;
`,
      'a.mjs': "import './shared.mjs'; globalThis.trace.push('a');\n",
      'b.mjs': "import './shared.mjs'; globalThis.trace.push('b');\n",
      'diamond-main.mjs': "import './a.mjs'; import './b.mjs'; globalThis.trace.push('diamond-main');\n",
      'c1.mjs': "import './c2.mjs'; globalThis.trace.push('c1');\n",
      'c2.mjs': "import './c1.mjs'; await Promise.resolve(); globalThis.trace.push('c2');\n",
      'cycle-main.mjs': "import './c1.mjs'; globalThis.trace.push('cycle-main');\n",
    };
    await Promise.all(Object.entries(nodeFiles).map(([name, source]) => writeFile(path.join(nodeDir, name), source)));

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
using J2cs.Runtime;

sealed class FixtureHost : IJsDynamicModuleHost
{
    private readonly Dictionary<string, JsDynamicModuleDefinition> modules;
    internal readonly List<string> Trace = new();
    internal int SharedCount;

    internal FixtureHost()
    {
        modules = new(StringComparer.Ordinal)
        {
            ["shared"] = new JsDynamicModuleDefinition("shared", Array.Empty<string>(), true, async _ =>
            {
                await Task.Yield();
                SharedCount++;
                Trace.Add("shared");
            }),
            ["a"] = new JsDynamicModuleDefinition("a", new[] { "./shared.mjs" }, false, _ =>
            {
                Trace.Add("a");
                return Task.CompletedTask;
            }),
            ["b"] = new JsDynamicModuleDefinition("b", new[] { "./shared.mjs" }, false, _ =>
            {
                Trace.Add("b");
                return Task.CompletedTask;
            }),
            ["diamond-main"] = new JsDynamicModuleDefinition("diamond-main", new[] { "./a.mjs", "./b.mjs" }, false, _ =>
            {
                Trace.Add("diamond-main");
                return Task.CompletedTask;
            }),
            ["c1"] = new JsDynamicModuleDefinition("c1", new[] { "./c2.mjs" }, false, _ =>
            {
                Trace.Add("c1");
                return Task.CompletedTask;
            }),
            ["c2"] = new JsDynamicModuleDefinition("c2", new[] { "./c1.mjs" }, true, async _ =>
            {
                await Task.Yield();
                Trace.Add("c2");
            }),
            ["cycle-main"] = new JsDynamicModuleDefinition("cycle-main", new[] { "./c1.mjs" }, false, _ =>
            {
                Trace.Add("cycle-main");
                return Task.CompletedTask;
            }),
        };
    }

    public ValueTask<string> ResolveAsync(string specifier, string? referrerCanonicalKey)
    {
        var key = specifier.StartsWith("./", StringComparison.Ordinal) ? specifier[2..] : specifier;
        if (key.EndsWith(".mjs", StringComparison.Ordinal))
            key = key[..^4];
        return ValueTask.FromResult(key);
    }

    public ValueTask<JsDynamicModuleDefinition> LoadAsync(string canonicalKey)
        => modules.TryGetValue(canonicalKey, out var definition)
            ? ValueTask.FromResult(definition)
            : ValueTask.FromException<JsDynamicModuleDefinition>(new FileNotFoundException(canonicalKey));
}

static class Program
{
    private static async Task Main()
    {
        var host = new FixtureHost();
        var runtime = new JsDynamicModuleRuntime(host);

        await runtime.DynamicImport("./diamond-main.mjs").AsTask();
        Console.WriteLine(string.Join(",", host.Trace));

        host.Trace.Clear();
        await runtime.DynamicImport("./cycle-main.mjs").AsTask();
        Console.WriteLine(string.Join(",", host.Trace));

        var first = runtime.DynamicImport("./shared.mjs").AsTask();
        var second = runtime.DynamicImport("./shared.mjs").AsTask();
        var namespaces = await Task.WhenAll(first, second);
        Console.WriteLine(ReferenceEquals(namespaces[0], namespaces[1]) ? "same" : "different");
        Console.WriteLine(host.SharedCount);

        try
        {
            var pending = runtime.DynamicImport("./missing.mjs");
            Console.WriteLine("promise");
            await pending.AsTask();
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
    assert.deepEqual(csharp, node, 'Dynamic-module runtime differs from the Node ESM oracle');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
