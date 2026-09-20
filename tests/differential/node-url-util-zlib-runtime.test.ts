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
    '    <AssemblyName>NodeUrlUtilZlibFixture</AssemblyName>',
    '  </PropertyGroup>',
    '  <ItemGroup>',
    '    <ProjectReference Include="' + xml(runtimeProject) + '" />',
    '  </ItemGroup>',
    '</Project>',
    '',
  ].join('\n');
}

async function compareNodeAndCSharp(nodeSource: string, csharpSource: string): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'j2cs-node-url-util-zlib-'));
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
    assert.equal(build.exit, 0, 'dotnet build failed:\n' + build.stdout + '\n' + build.stderr);
    const node = await run(process.execPath, ['input.cjs'], nodeDir);
    const csharp = await run(dotnet, [path.join(csharpDir, 'bin/Debug/net8.0/NodeUrlUtilZlibFixture.dll')], csharpDir);
    assert.deepEqual(csharp, node, 'NODE_URL_UTIL_ZLIB_MISC runtime output differs from Node');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('URL/util/zlib runtime contracts match Node for the bounded supported profile', { timeout: 90_000 }, async () => {
  const nodeSource = [
    "const { fileURLToPath } = require('node:url');",
    "const util = require('node:util');",
    "const zlib = require('node:zlib');",
    "console.log(fileURLToPath('file:///tmp/a%20b', { windows: false }));",
    "console.log(fileURLToPath('file:///C:/a%20b', { windows: true }));",
    "try { fileURLToPath('file:///tmp/a%2Fb', { windows: false }); } catch (e) { console.log(e.code); }",
    "const p = new URLSearchParams();",
    "p.append('q', 'a b~');",
    "p.append('q', 'two');",
    "p.set('q', 'a b~');",
    "p.append('emoji', '😀');",
    "console.log(p.toString());",
    "console.log(p.size, p.get('q'), p.getAll('q').length);",
    "console.log(util.format('x=%d %% %s', 5, 'ok', true));",
    "console.log(util.format(5, 'x', null));",
    "const gz = zlib.gzipSync('héllo');",
    "console.log(zlib.gunzipSync(gz).toString('utf8'));",
    "console.log(Buffer.isBuffer(gz), gz.length > 10);",
    '',
  ].join('\n');

  const csharpSource = [
    'using System.Text;',
    'using J2cs.Runtime;',
    'using J2cs.Runtime.NodeCompat;',
    'Console.OutputEncoding = new UTF8Encoding(false);',
    'static void Line(string value) => Console.Write(value + "\\n");',
    'Line(NodeUrl.FileUrlToPath("file:///tmp/a%20b", NodeUrlPlatformMode.Posix));',
    'Line(NodeUrl.FileUrlToPath("file:///C:/a%20b", NodeUrlPlatformMode.Windows));',
    'try { NodeUrl.FileUrlToPath("file:///tmp/a%2Fb", NodeUrlPlatformMode.Posix); }',
    'catch (NodeUrlException e) { Line(e.Code); }',
    'var p = new WebUrlSearchParams();',
    'p.Append("q", "a b~");',
    'p.Append("q", "two");',
    'p.Set("q", "a b~");',
    'p.Append("emoji", "😀");',
    'Line(p.Serialize());',
    'Line(p.Size.ToString(System.Globalization.CultureInfo.InvariantCulture) + " " + p.Get("q") + " " + p.GetAll("q").Count.ToString(System.Globalization.CultureInfo.InvariantCulture));',
    'Line(NodeUtil.Format(JsValue.FromString("x=%d %% %s"), JsValue.FromNumber(5), JsValue.FromString("ok"), JsValue.FromBoolean(true)));',
    'Line(NodeUtil.Format(JsValue.FromNumber(5), JsValue.FromString("x"), JsValue.Null));',
    'var gz = NodeZlib.SyncGzipSync("héllo");',
    'Line(Encoding.UTF8.GetString(NodeZlib.SyncGunzipSync(gz)));',
    'Line("true " + (gz.Length > 10).ToString().ToLowerInvariant());',
    '',
  ].join('\n');

  await compareNodeAndCSharp(nodeSource, csharpSource);
});
