import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT } from '../../compiler/index.js';
import { run } from './harness.js';

test('Node vs C#: arrow lexical capture and non-constructability runtime contract', { timeout: 90_000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'j2cs-arrow-diff-'));
  const dotnet = process.env.DOTNET ?? 'dotnet';
  const nodeSource = `
    "use strict";
    function lexicalThis() {
      const arrow = () => this;
      return arrow.call(9);
    }
    console.log(lexicalThis.call(7));

    function lexicalArguments(x) {
      const arrow = () => arguments[0];
      console.log(arrow(99));
    }
    lexicalArguments(4);

    const arrow = () => {};
    try { new arrow(); }
    catch (error) { console.log(error instanceof TypeError); }
  `;
  const csharpSource = `using J2cs.Runtime;

internal static class Program
{
    private static void Main()
    {
        var lexicalThis = JsArrowFunction.CaptureLexicalThis(JsValue.FromNumber(7));
        JsConsole.Log(lexicalThis);

        var lexicalArguments = JsArrowFunction.CaptureLexicalArguments(JsValue.FromNumber(4));
        JsConsole.Log(lexicalArguments);

        try
        {
            JsArrowFunction.ThrowNotConstructable();
        }
        catch (JsArrowNotConstructableException)
        {
            JsConsole.Log(JsValue.FromBoolean(true));
        }
    }
}
`;
  const project = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <AssemblyName>J2cs.ArrowContract</AssemblyName>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>
  <ItemGroup>
    <ProjectReference Include="runtime/J2cs.Runtime/J2cs.Runtime.csproj" />
  </ItemGroup>
</Project>
`;

  try {
    await writeFile(path.join(dir, 'input.cjs'), nodeSource);
    await mkdir(path.join(dir, 'runtime'), { recursive: true });
    await cp(path.join(ROOT, 'runtime/J2cs.Runtime'), path.join(dir, 'runtime/J2cs.Runtime'), { recursive: true });
    await writeFile(path.join(dir, 'Program.cs'), csharpSource);
    await writeFile(path.join(dir, 'ArrowContract.csproj'), project);

    const build = await run(dotnet, ['build', 'ArrowContract.csproj', '--nologo', '-v', 'quiet'], dir, 60_000);
    assert.equal(build.exit, 0, `dotnet build failed:\n${build.stdout}\n${build.stderr}`);
    const node = await run(process.execPath, ['input.cjs'], dir);
    const csharp = await run(dotnet, [path.join(dir, 'bin/Debug/net8.0/J2cs.ArrowContract.dll')], dir);
    assert.equal(node.exit, 0);
    assert.equal(csharp.exit, 0);
    assert.equal(node.stdout, '7\n4\ntrue\n');
    assert.deepEqual(csharp, node, 'Arrow runtime contract differs from Node observable output');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
