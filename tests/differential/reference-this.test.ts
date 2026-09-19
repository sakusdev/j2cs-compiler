import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT } from '../../compiler/index.js';
import { run } from './harness.js';

function xml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

async function buildProbe(source: string) {
  const dir = await mkdtemp(path.join(tmpdir(), 'j2cs-reference-diff-'));
  const runtime = path.join(ROOT, 'runtime/J2cs.Runtime/J2cs.Runtime.csproj');
  await writeFile(path.join(dir, 'Probe.csproj'), `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
  </PropertyGroup>
  <ItemGroup><ProjectReference Include="${xml(runtime)}" /></ItemGroup>
</Project>
`);
  await writeFile(path.join(dir, 'Program.cs'), source);
  const dotnet = process.env.DOTNET ?? 'dotnet';
  const build = await run(dotnet, ['build', 'Probe.csproj', '--nologo', '-v', 'quiet'], dir, 60_000);
  assert.equal(build.exit, 0, `reference probe build failed:\n${build.stdout}\n${build.stderr}`);
  return { dir, dotnet };
}

test('Node vs C#: property-reference and ordinary this binding contract', { timeout: 90_000 }, async () => {
  const nodeSource = `
    const o = { m: function(){ 'use strict'; return this === o; } };
    console.log(o.m());
    const f = o.m;
    console.log(f.call(undefined) === undefined);
    function strictProbe(){ 'use strict'; return this; }
    console.log(strictProbe.call(null) === null);
    console.log(strictProbe.call(3) === 3);
    function sloppyProbe(){ return this; }
    console.log(sloppyProbe.call(null) === globalThis);
    console.log(sloppyProbe.call(o) === o);
  `;
  const csharpSource = `
using J2cs.Runtime;
internal static class Program
{
    private static string Bool(bool value) => value ? "true" : "false";
    private static void Main()
    {
        var callableToken = JsValue.FromNumber(1d);
        var receiver = JsObject.DefineDataProperty(JsObject.Create(), "m", callableToken);

        var method = JsCallReference.FromProperty(receiver, "m");
        Console.WriteLine(Bool(JsOperators.StrictEquals(
            method.BindOrdinaryThis(JsThisMode.Strict, JsUndefined.Value), receiver)));

        var detached = JsCallReference.FromValue(method.Callee);
        Console.WriteLine(Bool(detached.ThisArgument.Kind == JsKind.Undefined));

        var strictNull = JsCallReference.BindOrdinaryThis(JsNull.Value, JsThisMode.Strict, JsUndefined.Value);
        Console.WriteLine(Bool(strictNull.Kind == JsKind.Null));

        var strictNumber = JsCallReference.BindOrdinaryThis(JsValue.FromNumber(3d), JsThisMode.Strict, JsUndefined.Value);
        Console.WriteLine(Bool(strictNumber.Kind == JsKind.Number && strictNumber.Number == 3d));

        var globalThis = JsObject.Create();
        var sloppyNull = JsCallReference.BindOrdinaryThis(JsNull.Value, JsThisMode.Sloppy, globalThis);
        Console.WriteLine(Bool(JsOperators.StrictEquals(sloppyNull, globalThis)));

        var sloppyObject = JsCallReference.BindOrdinaryThis(receiver, JsThisMode.Sloppy, globalThis);
        Console.WriteLine(Bool(JsOperators.StrictEquals(sloppyObject, receiver)));
    }
}
`;

  const { dir, dotnet } = await buildProbe(csharpSource);
  try {
    await writeFile(path.join(dir, 'oracle.cjs'), nodeSource);
    const node = await run(process.execPath, ['oracle.cjs'], dir);
    const csharp = await run(dotnet, [path.join(dir, 'bin/Debug/net8.0/Probe.dll')], dir);
    assert.deepEqual(csharp, node, 'Reference/this contract differs from Node');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('C# runtime fails closed for sloppy primitive this until ToObject boxing is available', { timeout: 90_000 }, async () => {
  const source = `
using J2cs.Runtime;
internal static class Program
{
    private static void Main()
    {
        try
        {
            _ = JsCallReference.BindOrdinaryThis(
                JsValue.FromNumber(3d), JsThisMode.Sloppy, JsObject.Create());
            Console.WriteLine("unsafe");
        }
        catch (InvalidOperationException)
        {
            Console.WriteLine("deferred");
        }
    }
}
`;
  const { dir, dotnet } = await buildProbe(source);
  try {
    const result = await run(dotnet, [path.join(dir, 'bin/Debug/net8.0/Probe.dll')], dir);
    assert.equal(result.exit, 0);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout, 'deferred\n');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
