import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT } from '../../compiler/index.js';
import { run } from './harness.js';

function xml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function fixtureProject(runtimeProject: string): string {
  return [
    '<Project Sdk="Microsoft.NET.Sdk">',
    '  <PropertyGroup>',
    '    <OutputType>Exe</OutputType>',
    '    <TargetFramework>net8.0</TargetFramework>',
    '    <ImplicitUsings>enable</ImplicitUsings>',
    '    <Nullable>enable</Nullable>',
    '    <AssemblyName>NodeFsFixture</AssemblyName>',
    '  </PropertyGroup>',
    '  <ItemGroup>',
    '    <ProjectReference Include="' + xml(runtimeProject) + '" />',
    '  </ItemGroup>',
    '</Project>',
    '',
  ].join('\n');
}

async function compareNodeAndCSharp(name: string, nodeSource: string, csharpSource: string): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'j2cs-node-fs-'));
  const nodeDir = path.join(root, 'node');
  const csharpDir = path.join(root, 'csharp');
  await mkdir(nodeDir);
  await mkdir(csharpDir);
  try {
    await writeFile(path.join(nodeDir, 'input.cjs'), nodeSource);
    await writeFile(path.join(csharpDir, 'Fixture.csproj'), fixtureProject(path.join(ROOT, 'runtime/J2cs.Runtime/J2cs.Runtime.csproj')));
    await writeFile(path.join(csharpDir, 'Program.cs'), csharpSource);
    const dotnet = process.env.DOTNET ?? 'dotnet';
    const build = await run(dotnet, ['build', 'Fixture.csproj', '--nologo', '-v', 'quiet'], csharpDir, 60_000);
    assert.equal(build.exit, 0, name + ' dotnet build failed:\n' + build.stdout + '\n' + build.stderr);
    const node = await run(process.execPath, ['input.cjs'], nodeDir);
    const csharp = await run(dotnet, [path.join(csharpDir, 'bin/Debug/net8.0/NodeFsFixture.dll')], csharpDir);
    assert.deepEqual(csharp, node, name + ' runtime output differs from Node');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('NODE_FS sync runtime matches Node for bytes, encodings, existence and exclusive flags', async () => {
  const nodeSource = [
    "const fs = require('node:fs');",
    "fs.writeFileSync('a.txt', 'héllo', { encoding: 'utf8' });",
    "const b = fs.readFileSync('a.txt');",
    "console.log(b.length);",
    "console.log(fs.readFileSync('a.txt', 'utf8'));",
    "console.log(fs.readFileSync('a.txt', 'hex'));",
    "console.log(fs.existsSync('a.txt'), fs.existsSync('missing'));",
    "try { fs.writeFileSync('a.txt', 'x', { flag: 'wx' }); } catch (e) { console.log(e.code); }",
    '',
  ].join('\n');
  const csharpSource = [
    'using System.Text;',
    'using J2cs.Runtime.NodeCompat;',
    'Console.OutputEncoding = new UTF8Encoding(false);',
    'static void Line(string value) => Console.Write(value + "\\n");',
    'NodeFs.WriteFileSync("a.txt", "héllo", NodeFsWriteFileOptions.FromEncoding("utf8"));',
    'var b = NodeFs.ReadFileSync("a.txt");',
    'Line(b.Buffer.Length.ToString(System.Globalization.CultureInfo.InvariantCulture));',
    'Line(NodeFs.ReadFileSync("a.txt", NodeFsReadFileOptions.FromEncoding("utf8")).Text);',
    'Line(NodeFs.ReadFileSync("a.txt", NodeFsReadFileOptions.FromEncoding("hex")).Text);',
    'Line(NodeFs.ExistsSync("a.txt").ToString().ToLowerInvariant() + " " + NodeFs.ExistsSync("missing").ToString().ToLowerInvariant());',
    'try { NodeFs.WriteFileSync("a.txt", "x", NodeFsWriteFileOptions.FromFlag("wx")); }',
    'catch (NodeFsException e) { Line(e.Code); }',
    '',
  ].join('\n');
  await compareNodeAndCSharp('sync fs', nodeSource, csharpSource);
});

test('NODE_FS promise runtime matches directly awaited Node I/O with an explicit compatible scheduler', async () => {
  const nodeSource = [
    "const fsp = require('node:fs/promises');",
    '(async () => {',
    "  await fsp.writeFile('async.txt', 'µ-task', { encoding: 'utf8' });",
    "  console.log(await fsp.readFile('async.txt', 'utf8'));",
    "  console.log((await fsp.readFile('async.txt')).length);",
    '})().catch((e) => { console.error(e); process.exitCode = 1; });',
    '',
  ].join('\n');
  const csharpSource = [
    'using System.Text;',
    'using J2cs.Runtime.NodeCompat;',
    'Console.OutputEncoding = new UTF8Encoding(false);',
    'static void Line(string value) => Console.Write(value + "\\n");',
    'var scheduler = new CompatibleScheduler();',
    'await NodeFsPromises.WriteFileAsync("async.txt", "µ-task", NodeFsWriteFileOptions.FromEncoding("utf8"), scheduler);',
    'Line((await NodeFsPromises.ReadFileAsync("async.txt", NodeFsReadFileOptions.FromEncoding("utf8"), scheduler)).Text);',
    'Line((await NodeFsPromises.ReadFileAsync("async.txt", NodeFsReadFileOptions.BufferDefault, scheduler)).Buffer.Length.ToString(System.Globalization.CultureInfo.InvariantCulture));',
    '',
    'sealed class CompatibleScheduler : INodePromiseScheduler',
    '{',
    '    public bool PreservesJavaScriptMicrotaskOrdering => true;',
    '    public async Task<T> Schedule<T>(Func<CancellationToken, Task<T>> operation, CancellationToken cancellationToken)',
    '        => await operation(cancellationToken).ConfigureAwait(false);',
    '}',
    '',
  ].join('\n');
  await compareNodeAndCSharp('fs.promises', nodeSource, csharpSource);
});
