import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run } from './harness.js';

function xml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
}

test('Node vs C#: React registered-symbol identity and bundle evaluate-once ledger', { timeout: 90_000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'j2cs-bundle-diff-'));
  try {
    const nodeSource = `
      const registry = new Map();
      const symbolFor = key => { if (!registry.has(key)) registry.set(key, {key}); return registry.get(key); };
      console.log(symbolFor('react.element') === symbolFor('react.element'));
      console.log(symbolFor('react.element') === symbolFor('react.fragment'));
      const states = new Map();
      function once(id, body) {
        const state = states.get(id);
        if (state === 'running' || state === 'done') return false;
        states.set(id, 'running');
        try { body(); states.set(id, 'done'); return true; }
        catch (e) { states.set(id, 'failed'); throw e; }
      }
      once('shared', () => console.log('shared'));
      once('main', () => { once('shared', () => console.log('bad')); console.log('main'); });
      console.log(once('shared', () => console.log('bad')));
      once('cycle', () => {
        console.log('cycle:start');
        console.log(once('cycle', () => console.log('bad')));
        console.log('cycle:end');
      });
    `;
    const runtime = path.resolve('runtime/J2cs.Runtime/J2cs.Runtime.csproj');
    const csproj = `<Project Sdk="Microsoft.NET.Sdk">
      <PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings><Nullable>enable</Nullable><TreatWarningsAsErrors>true</TreatWarningsAsErrors></PropertyGroup>
      <ItemGroup><ProjectReference Include="${xml(runtime)}" /></ItemGroup>
    </Project>`;
    const csharp = `using J2cs.Runtime.WebCompat;
var e1 = ReactSymbolRegistry.For("react.element");
var e2 = ReactSymbolRegistry.For("react.element");
var f = ReactSymbolRegistry.For("react.fragment");
Console.WriteLine(ReferenceEquals(e1, e2).ToString().ToLowerInvariant());
Console.WriteLine(ReferenceEquals(e1, f).ToString().ToLowerInvariant());
var ledger = new BundleExecutionLedger();
ledger.EvaluateOnce("shared", () => Console.WriteLine("shared"));
ledger.EvaluateOnce("main", () => {
    ledger.EvaluateOnce("shared", () => Console.WriteLine("bad"));
    Console.WriteLine("main");
});
Console.WriteLine(ledger.EvaluateOnce("shared", () => Console.WriteLine("bad")).ToString().ToLowerInvariant());
ledger.EvaluateOnce("cycle", () => {
    Console.WriteLine("cycle:start");
    Console.WriteLine(ledger.EvaluateOnce("cycle", () => Console.WriteLine("bad")).ToString().ToLowerInvariant());
    Console.WriteLine("cycle:end");
});
`;
    await writeFile(path.join(dir, 'oracle.cjs'), nodeSource);
    await writeFile(path.join(dir, 'BundleDiff.csproj'), csproj);
    await writeFile(path.join(dir, 'Program.cs'), csharp);
    const build = await run(process.env.DOTNET ?? 'dotnet', ['build', 'BundleDiff.csproj', '--nologo', '-v', 'quiet'], dir, 60_000);
    assert.equal(build.exit, 0, `dotnet build failed:\n${build.stdout}\n${build.stderr}`);
    const node = await run(process.execPath, ['oracle.cjs'], dir);
    const managed = await run(process.env.DOTNET ?? 'dotnet', [path.join(dir, 'bin/Debug/net8.0/BundleDiff.dll')], dir);
    assert.deepEqual(
      { ...managed, stdout: managed.stdout.replaceAll('\\r\\n', '\\n') },
      { ...node, stdout: node.stdout.replaceAll('\\r\\n', '\\n') },
    );
    assert.equal(node.stdout.replaceAll('\\r\\n', '\\n'), 'true\nfalse\nshared\nmain\nfalse\ncycle:start\nfalse\ncycle:end\n');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
