import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT } from '../../compiler/index.js';
import { run } from './harness.js';

test('Node vs C# timers, worker ordering, and child-process host contracts', { timeout: 90_000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'j2cs-node-host-diff-'));
  const dotnet = process.env.DOTNET ?? 'dotnet';
  try {
    await mkdir(path.join(dir, 'runtime'), { recursive: true });
    await cp(
      path.join(ROOT, 'runtime/J2cs.Runtime'),
      path.join(dir, 'runtime/J2cs.Runtime'),
      { recursive: true },
    );

    const fixtureDir = path.join(ROOT, 'tests/differential/fixtures');
    const nodeOracle = await readFile(path.join(fixtureDir, 'node_host_oracle.cjs'), 'utf8');
    const csharpOracle = await readFile(path.join(fixtureDir, 'NodeHostProgram.cs'), 'utf8');
    await writeFile(path.join(dir, 'oracle.cjs'), nodeOracle);
    await writeFile(path.join(dir, 'Program.cs'), csharpOracle);
    await writeFile(path.join(dir, 'NodeHostDiff.csproj'), `
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <AssemblyName>NodeHostDiff</AssemblyName>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
  </PropertyGroup>
  <ItemGroup>
    <ProjectReference Include="runtime/J2cs.Runtime/J2cs.Runtime.csproj" />
  </ItemGroup>
</Project>
`);

    const build = await run(dotnet, ['build', 'NodeHostDiff.csproj', '--nologo', '-v', 'quiet'], dir, 60_000);
    assert.equal(build.exit, 0, `dotnet build failed:\n${build.stdout}\n${build.stderr}`);

    const node = await run(process.execPath, ['oracle.cjs'], dir, 30_000);
    const csharp = await run(dotnet, [
      path.join(dir, 'bin/Debug/net8.0/NodeHostDiff.dll'),
      process.execPath,
    ], dir, 30_000);
    assert.deepEqual(csharp, node, 'Node host observables differ from the C# compatibility runtime');
    assert.equal(node.stdout.includes('bad-timeout'), false);
    assert.match(node.stdout, /worker:number:1,string:x,exit:0/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
