import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT } from '../../compiler/index.js';
import { run } from './harness.js';

test('Node vs C# runtime: Date/RegExp/JSON/Error proof-gated helpers', { timeout: 90_000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'j2cs-builtins-'));
  const dotnet = process.env.DOTNET ?? 'dotnet';
  const nodeSource = String.raw`
console.log(Date.UTC(99,0,1));
console.log(Date.UTC(2020,12,1));
console.log(Date.UTC());
console.log(new Date(-0.5).getTime(), Object.is(new Date(-0.5).getTime(), -0));
console.log(Date.parse('1970-01-01'));
console.log(Date.parse('1970-01-01T01:00:00+01:00'));

const parsed = JSON.parse('{"2":"b","1":"a","x":-0,"u":"ok"}');
console.log(JSON.stringify(parsed));
console.log(JSON.stringify([NaN,Infinity,-Infinity,-0,undefined]));
console.log(JSON.stringify(String.fromCharCode(0xd800)));
try { JSON.parse('{"a":1,}'); } catch (e) { console.log(e.name); }
const cycle = {}; cycle.self = cycle;
try { JSON.stringify(cycle); } catch (e) { console.log(e.name); }

const r = /a/g;
console.log(r.test('a'), r.lastIndex);
console.log(r.test('a'), r.lastIndex);
console.log(/a/ === /a/);

const e = Error(12);
console.log(e.message);
console.log(e.toString());
console.log(Object.hasOwn(e, 'message'));
console.log(e === Error(12));
`;

  const csharpSource = String.raw`
using J2cs.Runtime;

internal static class Program
{
    private static void Main()
    {
        JsConsole.Log(JsValue.FromNumber(JsDate.Utc(JsValue.FromNumber(99), JsValue.FromNumber(0), JsValue.FromNumber(1))));
        JsConsole.Log(JsValue.FromNumber(JsDate.Utc(JsValue.FromNumber(2020), JsValue.FromNumber(12), JsValue.FromNumber(1))));
        JsConsole.Log(JsValue.FromNumber(JsDate.Utc()));
        var clipped = JsDate.TimeClip(-0.5d);
        JsConsole.Log(JsValue.FromNumber(clipped), JsValue.FromBoolean(double.IsNegative(clipped)));
        JsConsole.Log(JsValue.FromNumber(JsDate.ParseStandard(JsValue.FromString("1970-01-01"))));
        JsConsole.Log(JsValue.FromNumber(JsDate.ParseStandard(JsValue.FromString("1970-01-01T01:00:00+01:00"))));

        var parsed = JsJson.Parse(JsValue.FromString("{\\\"2\\\":\\\"b\\\",\\\"1\\\":\\\"a\\\",\\\"x\\\":-0,\\\"u\\\":\\\"ok\\\"}"));
        JsConsole.Log(JsJson.Stringify(parsed));
        var specials = JsArray.Create(0d);
        JsArray.Push(specials, JsValue.FromNumber(double.NaN), JsValue.FromNumber(double.PositiveInfinity),
            JsValue.FromNumber(double.NegativeInfinity), JsValue.FromNumber(-0.0d), JsUndefined.Value);
        JsConsole.Log(JsJson.Stringify(specials));
        JsConsole.Log(JsJson.Stringify(JsValue.FromString("\\ud800")));
        try
        {
            _ = JsJson.Parse(JsValue.FromString("{\\\"a\\\":1,}"));
        }
        catch (JsSyntaxErrorException error)
        {
            JsConsole.Log(JsError.Name(error.Value));
        }
        var cycle = JsObject.Create();
        JsObject.SetProperty(cycle, "self", cycle);
        try
        {
            _ = JsJson.Stringify(cycle);
        }
        catch (JsTypeErrorException error)
        {
            JsConsole.Log(JsError.Name(error.Value));
        }

        var regexp = JsRegExp.CreateLiteral("a", "g");
        JsConsole.Log(JsRegExp.Test(regexp, JsValue.FromString("a")), JsRegExp.LastIndex(regexp));
        JsConsole.Log(JsRegExp.Test(regexp, JsValue.FromString("a")), JsRegExp.LastIndex(regexp));
        JsConsole.Log(JsValue.FromBoolean(JsOperators.StrictEquals(
            JsRegExp.CreateLiteral("a", ""), JsRegExp.CreateLiteral("a", ""))));

        var errorValue = JsError.Create(JsValue.FromNumber(12));
        JsConsole.Log(JsError.Message(errorValue));
        JsConsole.Log(JsError.ToString(errorValue));
        JsConsole.Log(JsValue.FromBoolean(JsObject.HasOwn(errorValue, "message")));
        JsConsole.Log(JsValue.FromBoolean(JsOperators.StrictEquals(errorValue, JsError.Create(JsValue.FromNumber(12)))));
    }
}
`;

  const project = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>
  <ItemGroup>
    <ProjectReference Include="runtime/J2cs.Runtime/J2cs.Runtime.csproj" />
  </ItemGroup>
</Project>
`;

  try {
    await cp(path.join(ROOT, 'runtime/J2cs.Runtime'), path.join(dir, 'runtime/J2cs.Runtime'), { recursive: true });
    await writeFile(path.join(dir, 'Program.cs'), csharpSource);
    await writeFile(path.join(dir, 'BuiltinDifferential.csproj'), project);
    await writeFile(path.join(dir, 'oracle.cjs'), nodeSource);

    const build = await run(dotnet, ['build', 'BuiltinDifferential.csproj', '--nologo', '-v', 'quiet'], dir, 60_000);
    assert.equal(build.exit, 0, `dotnet build failed:\n${build.stdout}\n${build.stderr}`);
    const node = await run(process.execPath, ['oracle.cjs'], dir);
    const csharp = await run(dotnet, [path.join(dir, 'bin/Debug/net8.0/BuiltinDifferential.dll')], dir);
    assert.equal(node.exit, 0, `Node oracle failed:\n${node.stderr}`);
    assert.deepEqual(csharp, node, 'Issue #30 runtime helpers differ from Node');
    await rm(dir, { recursive: true, force: true });
  } catch (error) {
    throw new Error(`builtin runtime differential failed: ${String(error)}\nReproduction artifacts: ${dir}`, { cause: error });
  }
});
