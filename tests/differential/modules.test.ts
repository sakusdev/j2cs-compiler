import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT } from '../../compiler/index.js';
import { run } from './harness.js';

function xml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

test('Node vs C# runtime: CommonJS cache, cycle partial exports, and alias break', { timeout: 90_000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'j2cs-cjs-diff-'));
  const dotnet = process.env.DOTNET ?? 'dotnet';
  try {
    await writeFile(path.join(dir, 'a.cjs'), [
      "console.log('load-a');",
      "exports.before = 'before';",
      "const b = require('./b.cjs');",
      "console.log('cycle', b.sawBefore);",
      "module.exports = { replaced: 'yes' };",
      "exports.stale = 'old';",
      '',
    ].join('\n'));
    await writeFile(path.join(dir, 'b.cjs'), [
      "const a = require('./a.cjs');",
      "exports.sawBefore = a.before;",
      '',
    ].join('\n'));
    await writeFile(path.join(dir, 'main.cjs'), [
      "const a1 = require('./a.cjs');",
      "const a2 = require('./a.cjs');",
      "console.log('cache', a1 === a2);",
      "console.log('replacement', a1.replaced, a1.stale);",
      '',
    ].join('\n'));

    const csharpDir = path.join(dir, 'csharp');
    await mkdir(csharpDir);
    const runtimeProject = path.join(ROOT, 'runtime/J2cs.Runtime/J2cs.Runtime.csproj');
    await writeFile(path.join(csharpDir, 'CjsDiff.csproj'), `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
  </PropertyGroup>
  <ItemGroup>
    <ProjectReference Include="${xml(runtimeProject)}" />
  </ItemGroup>
</Project>
`);

    await writeFile(path.join(csharpDir, 'Program.cs'), `using J2cs.Runtime;

static string Resolve(string parent, string specifier) => (parent, specifier) switch
{
    ("/main.cjs", "./a.cjs") => "/a.cjs",
    ("/a.cjs", "./b.cjs") => "/b.cjs",
    ("/b.cjs", "./a.cjs") => "/a.cjs",
    _ => throw new FileNotFoundException($"MODULE_NOT_FOUND: {specifier}")
};

var runtime = new JsCommonJsRuntime(Resolve);
runtime.RegisterModule("/a.cjs", a =>
{
    JsConsole.Log(JsValue.FromString("load-a"));
    JsObject.SetProperty(a.Exports, "before", JsValue.FromString("before"));
    var b = a.Require("./b.cjs");
    JsConsole.Log(JsValue.FromString("cycle"), JsObject.GetProperty(b, "sawBefore"));

    var replacement = JsObject.Create();
    JsObject.SetProperty(replacement, "replaced", JsValue.FromString("yes"));
    JsCommonJsRuntime.SetModuleExports(a, replacement);
    JsObject.SetProperty(a.Exports, "stale", JsValue.FromString("old"));
});
runtime.RegisterModule("/b.cjs", b =>
{
    var a = b.Require("./a.cjs");
    JsObject.SetProperty(b.Exports, "sawBefore", JsObject.GetProperty(a, "before"));
});

var a1 = runtime.RequireFrom("/main.cjs", "./a.cjs");
var a2 = runtime.RequireFrom("/main.cjs", "./a.cjs");
JsConsole.Log(JsValue.FromString("cache"), JsValue.FromBoolean(JsOperators.StrictEquals(a1, a2)));
JsConsole.Log(
    JsValue.FromString("replacement"),
    JsObject.GetProperty(a1, "replaced"),
    JsObject.GetProperty(a1, "stale"));
`);

    const build = await run(dotnet, ['build', 'CjsDiff.csproj', '--nologo', '-v', 'quiet'], csharpDir, 60_000);
    assert.equal(build.exit, 0, `dotnet build failed:\n${build.stdout}\n${build.stderr}`);

    const node = await run(process.execPath, ['main.cjs'], dir);
    const csharp = await run(dotnet, [path.join(csharpDir, 'bin/Debug/net8.0/CjsDiff.dll')], dir);
    assert.equal(node.exit, 0);
    assert.deepEqual(csharp, node, 'CommonJS runtime observable behavior differs from Node');
    assert.equal(node.stdout, [
      'load-a',
      'cycle before',
      'cache true',
      'replacement yes undefined',
      '',
    ].join('\n'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
