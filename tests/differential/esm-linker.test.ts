import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT } from '../../compiler/index.js';
import { run } from './harness.js';

function xml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

async function moduleDifferential(
  name: string,
  files: Record<string, string>,
  entry: string,
  csharp: string,
  expectedStdout: string,
): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'j2cs-module-diff-'));
  const nodeDir = path.join(dir, 'node'), csDir = path.join(dir, 'csharp');
  const dotnet = process.env.DOTNET ?? 'dotnet';
  try {
    await mkdir(nodeDir); await mkdir(csDir);
    for (const [file, source] of Object.entries(files)) await writeFile(path.join(nodeDir, file), source);
    const runtimeProject = path.join(ROOT, 'runtime/J2cs.Runtime/J2cs.Runtime.csproj');
    await writeFile(path.join(csDir, 'Program.cs'), csharp);
    await writeFile(path.join(csDir, 'ModuleFixture.csproj'), `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
  </PropertyGroup>
  <ItemGroup><ProjectReference Include="${xml(runtimeProject)}" /></ItemGroup>
</Project>
`);
    const build = await run(dotnet, ['build', 'ModuleFixture.csproj', '--nologo', '-v', 'quiet'], csDir, 60_000);
    assert.equal(build.exit, 0, `${name}: dotnet build failed\n${build.stdout}\n${build.stderr}`);
    const node = await run(process.execPath, [entry], nodeDir);
    const managed = await run(dotnet, [path.join(csDir, 'bin/Debug/net8.0/ModuleFixture.dll')], csDir);
    assert.deepEqual(managed, node, `${name}: JsModuleRuntime differs from Node ESM behavior`);
    assert.equal(node.stdout, expectedStdout, `${name}: Node oracle expectation drift`);
  } catch (error) {
    throw new Error(`${name}: ${String(error)}\nReproduction artifacts: ${dir}`, { cause: error });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('Node/C# module differential: named import stays live after exporter mutation', async () => {
  await moduleDifferential('live-binding', {
    'a.mjs': `export let n = 1; export function set(v) { n = v; }`,
    'main.mjs': `import { n, set } from './a.mjs'; console.log(n); set(2); console.log(n);`,
  }, 'main.mjs', `
using J2cs.Runtime;
var a = new JsModuleRecord("a.mjs");
var n = a.DeclareLocal("n", mutable: true);
JsModuleRuntime.ExportLocal(a, "n", n);
var main = new JsModuleRecord("main.mjs");
JsModuleRuntime.RequireDependency(main, a);
var importedN = JsModuleRuntime.BindImport(main, "n", a, "n");
a.SetBody(_ => n.Initialize(JsValue.FromNumber(1)));
main.SetBody(_ => {
    JsConsole.Log(JsModuleRuntime.ReadBinding(importedN));
    n.Set(JsValue.FromNumber(2));
    JsConsole.Log(JsModuleRuntime.ReadBinding(importedN));
});
JsModuleRuntime.LinkAndEvaluate(main);
`, '1\n2\n');
});

test('Node/C# module differential: dependency order and evaluate-once match a diamond graph', async () => {
  await moduleDifferential('evaluate-once', {
    'shared.mjs': `console.log('shared');`,
    'a.mjs': `import './shared.mjs'; console.log('a');`,
    'b.mjs': `import './shared.mjs'; console.log('b');`,
    'main.mjs': `import './a.mjs'; import './b.mjs'; console.log('main');`,
  }, 'main.mjs', `
using J2cs.Runtime;
var shared = new JsModuleRecord("shared.mjs");
var a = new JsModuleRecord("a.mjs");
var b = new JsModuleRecord("b.mjs");
var main = new JsModuleRecord("main.mjs");
JsModuleRuntime.RequireDependency(a, shared);
JsModuleRuntime.RequireDependency(b, shared);
JsModuleRuntime.RequireDependency(main, a);
JsModuleRuntime.RequireDependency(main, b);
shared.SetBody(_ => JsConsole.Log(JsValue.FromString("shared")));
a.SetBody(_ => JsConsole.Log(JsValue.FromString("a")));
b.SetBody(_ => JsConsole.Log(JsValue.FromString("b")));
main.SetBody(_ => JsConsole.Log(JsValue.FromString("main")));
JsModuleRuntime.LinkAndEvaluate(main);
`, 'shared\na\nb\nmain\n');
});

test('Node/C# module differential: cyclic early read preserves TDZ ReferenceError boundary', async () => {
  await moduleDifferential('cycle-tdz', {
    'a.mjs': `import { b } from './b.mjs'; export const a = b;`,
    'b.mjs': `import { a } from './a.mjs'; export const b = a;`,
    'runner.mjs': `try { await import('./a.mjs'); } catch (error) { console.log(error.name); }`,
  }, 'runner.mjs', `
using J2cs.Runtime;
var a = new JsModuleRecord("a.mjs");
var b = new JsModuleRecord("b.mjs");
var aCell = a.DeclareLocal("a", mutable: false);
var bCell = b.DeclareLocal("b", mutable: false);
JsModuleRuntime.ExportLocal(a, "a", aCell);
JsModuleRuntime.ExportLocal(b, "b", bCell);
JsModuleRuntime.RequireDependency(a, b);
JsModuleRuntime.RequireDependency(b, a);
var bFromA = JsModuleRuntime.BindImport(a, "b", b, "b");
var aFromB = JsModuleRuntime.BindImport(b, "a", a, "a");
a.SetBody(_ => aCell.Initialize(JsModuleRuntime.ReadBinding(bFromA)));
b.SetBody(_ => bCell.Initialize(JsModuleRuntime.ReadBinding(aFromB)));
try { JsModuleRuntime.LinkAndEvaluate(a); }
catch (JsModuleReferenceError) { JsConsole.Log(JsValue.FromString("ReferenceError")); }
`, 'ReferenceError\n');
});

test('Node/C# module differential: ambiguous star names are omitted and namespace keys are sorted', async () => {
  await moduleDifferential('namespace-star', {
    'a.mjs': `export const x = 1; export const z = 3;`,
    'b.mjs': `export const x = 2; export const a = 4;`,
    'mid.mjs': `export * from './a.mjs'; export * from './b.mjs';`,
    'main.mjs': `import * as ns from './mid.mjs'; console.log(Object.keys(ns).join(','));`,
  }, 'main.mjs', `
using J2cs.Runtime;
var a = new JsModuleRecord("a.mjs");
var b = new JsModuleRecord("b.mjs");
var mid = new JsModuleRecord("mid.mjs");
var main = new JsModuleRecord("main.mjs");
var ax = a.DeclareLocal("x", false); var az = a.DeclareLocal("z", false);
var bx = b.DeclareLocal("x", false); var ba = b.DeclareLocal("a", false);
JsModuleRuntime.ExportLocal(a, "x", ax); JsModuleRuntime.ExportLocal(a, "z", az);
JsModuleRuntime.ExportLocal(b, "x", bx); JsModuleRuntime.ExportLocal(b, "a", ba);
JsModuleRuntime.ReExportStar(mid, a); JsModuleRuntime.ReExportStar(mid, b);
JsModuleRuntime.RequireDependency(mid, a); JsModuleRuntime.RequireDependency(mid, b);
JsModuleRuntime.RequireDependency(main, mid);
a.SetBody(_ => { ax.Initialize(JsValue.FromNumber(1)); az.Initialize(JsValue.FromNumber(3)); });
b.SetBody(_ => { bx.Initialize(JsValue.FromNumber(2)); ba.Initialize(JsValue.FromNumber(4)); });
var ns = JsModuleRuntime.BindNamespaceImport(main, "ns", mid);
main.SetBody(_ => JsConsole.Log(JsValue.FromString(string.Join(",", JsModuleRuntime.NamespaceOwnKeys(JsModuleRuntime.ReadBinding(ns))))));
JsModuleRuntime.LinkAndEvaluate(main);
`, 'a,z\n');
});
