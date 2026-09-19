import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run } from './harness.js';

function xml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

const nodeSource = [
  "const { Blob, File } = require('node:buffer');",
  "(async () => {",
  "  const calls = [];",
  "  const target = new EventTarget();",
  "  const stable = () => calls.push('stable');",
  "  target.addEventListener('x', stable, { once: false });",
  "  target.addEventListener('x', stable, { once: true });",
  "  target.addEventListener('x', e => { calls.push('once'); e.preventDefault(); }, { once: true });",
  "  console.log(target.dispatchEvent(new Event('x', { cancelable: true })));",
  "  console.log(target.dispatchEvent(new Event('x', { cancelable: true })));",
  "  console.log(calls.join(','));",
  "  const immediate = [];",
  "  const immediateTarget = new EventTarget();",
  "  immediateTarget.addEventListener('y', e => { immediate.push('first'); e.stopImmediatePropagation(); });",
  "  immediateTarget.addEventListener('y', () => immediate.push('second'));",
  "  immediateTarget.dispatchEvent(new Event('y'));",
  "  console.log(immediate.join(','));",
  "  let removedCount = 0;",
  "  const removeTarget = new EventTarget();",
  "  const removable = () => removedCount++;",
  "  removeTarget.addEventListener('r', removable, { passive: true });",
  "  removeTarget.removeEventListener('r', removable, { passive: false });",
  "  removeTarget.dispatchEvent(new Event('r'));",
  "  console.log(removedCount);",
  "  const passiveTarget = new EventTarget();",
  "  passiveTarget.addEventListener('p', e => e.preventDefault(), { passive: true });",
  "  console.log(passiveTarget.dispatchEvent(new Event('p', { cancelable: true })));",
  "  const source = new Uint8Array([1]);",
  "  const copied = new Blob([source]);",
  "  source[0] = 9;",
  "  console.log(new Uint8Array(await copied.arrayBuffer())[0]);",
  "  const blob = new Blob(['€', 'A', '\\ud800'], { type: 'Text/PLAIN' });",
  "  console.log(blob.size, blob.type);",
  "  console.log(Buffer.from(await blob.arrayBuffer()).toString('hex'));",
  "  const sliced = blob.slice(-4, -1, 'X/TEST');",
  "  console.log(sliced.size, sliced.type);",
  "  console.log(new Blob([], { type: 'téxt/plain' }).type === '');",
  "  const file = new File(['x'], 'a/b', { type: 'Text/PLAIN', lastModified: 123 });",
  "  console.log(file.name, file.type, file.lastModified, file.size, file.slice() instanceof File);",
  "})().catch(error => { console.error(error); process.exitCode = 1; });",
].join('\n');

const csharpSource = [
  "using J2cs.Runtime.WebCompat;",
  "",
  "static string B(bool value) => value ? \\"true\\" : \\"false\\";",
  "",
  "var calls = new List<string>();",
  "var target = new JsEventTarget();",
  "var stable = new JsEventListenerHandle(_ => calls.Add(\\"stable\\"));",
  "target.AddEventListener(\\"x\\", stable, new JsEventListenerOptions(Once: false));",
  "target.AddEventListener(\\"x\\", stable, new JsEventListenerOptions(Once: true));",
  "var once = new JsEventListenerHandle(e => { calls.Add(\\"once\\"); e.PreventDefault(); });",
  "target.AddEventListener(\\"x\\", once, new JsEventListenerOptions(Once: true));",
  "Console.WriteLine(B(target.DispatchEvent(new JsDomEvent(\\"x\\", cancelable: true))));",
  "Console.WriteLine(B(target.DispatchEvent(new JsDomEvent(\\"x\\", cancelable: true))));",
  "Console.WriteLine(string.Join(\\",\\", calls));",
  "",
  "var immediate = new List<string>();",
  "var immediateTarget = new JsEventTarget();",
  "immediateTarget.AddEventListener(\\"y\\", new JsEventListenerHandle(e => { immediate.Add(\\"first\\"); e.StopImmediatePropagation(); }));",
  "immediateTarget.AddEventListener(\\"y\\", new JsEventListenerHandle(_ => immediate.Add(\\"second\\")));",
  "immediateTarget.DispatchEvent(new JsDomEvent(\\"y\\"));",
  "Console.WriteLine(string.Join(\\",\\", immediate));",
  "",
  "var removedCount = 0;",
  "var removeTarget = new JsEventTarget();",
  "var removable = new JsEventListenerHandle(_ => removedCount++);",
  "removeTarget.AddEventListener(\\"r\\", removable, new JsEventListenerOptions(Passive: true));",
  "removeTarget.RemoveEventListener(\\"r\\", removable, new JsEventListenerOptions(Passive: false));",
  "removeTarget.DispatchEvent(new JsDomEvent(\\"r\\"));",
  "Console.WriteLine(removedCount);",
  "",
  "var passiveTarget = new JsEventTarget();",
  "passiveTarget.AddEventListener(\\"p\\", new JsEventListenerHandle(e => e.PreventDefault()), new JsEventListenerOptions(Passive: true));",
  "Console.WriteLine(B(passiveTarget.DispatchEvent(new JsDomEvent(\\"p\\", cancelable: true))));",
  "",
  "var source = new byte[] { 1 };",
  "var copiedPart = JsBlobPart.FromBytes(source);",
  "var copied = JsBlob.Create(new[] { copiedPart });",
  "source[0] = 9;",
  "Console.WriteLine(copied.ReadBytes()[0]);",
  "",
  "var blob = JsBlob.Create(new[] { JsBlobPart.FromString(\\"€\\"), JsBlobPart.FromString(\\"A\\"), JsBlobPart.FromString(\\"\\\\ud800\\") }, new JsBlobOptions(Type: \\"Text/PLAIN\\"));",
  "Console.WriteLine(blob.Size + \\" \\" + blob.Type);",
  "Console.WriteLine(Convert.ToHexString(blob.ReadBytes()).ToLowerInvariant());",
  "var sliced = blob.Slice(-4, -1, \\"X/TEST\\");",
  "Console.WriteLine(sliced.Size + \\" \\" + sliced.Type);",
  "Console.WriteLine(B(JsBlob.Create(options: new JsBlobOptions(Type: \\"téxt/plain\\")).Type == \\"\\"));",
  "",
  "var file = JsFile.Create(new[] { JsBlobPart.FromString(\\"x\\") }, \\"a/b\\", new JsFileOptions(Type: \\"Text/PLAIN\\", LastModified: 123));",
  "Console.WriteLine(file.Name + \\" \\" + file.Type + \\" \\" + file.LastModified + \\" \\" + file.Size + \\" \\" + B(file.Slice() is JsFile));",
].join('\n');

test('Node vs WebCompat C#: EventTarget and Blob/File contracts', { timeout: 90_000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'j2cs-renderer-web-'));
  const projectDir = path.join(dir, 'host');
  await mkdir(projectDir);
  const runtimeProject = path.resolve('runtime/J2cs.Runtime/J2cs.Runtime.csproj');
  const project = path.join(projectDir, 'RendererHost.csproj');

  await writeFile(path.join(dir, 'input.cjs'), nodeSource);
  await writeFile(path.join(projectDir, 'Program.cs'), csharpSource);
  await writeFile(project, [
    '<Project Sdk="Microsoft.NET.Sdk">',
    '  <PropertyGroup>',
    '    <OutputType>Exe</OutputType>',
    '    <TargetFramework>net8.0</TargetFramework>',
    '    <ImplicitUsings>enable</ImplicitUsings>',
    '    <Nullable>enable</Nullable>',
    '    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>',
    '  </PropertyGroup>',
    '  <ItemGroup>',
    '    <ProjectReference Include="' + xml(runtimeProject) + '" />',
    '  </ItemGroup>',
    '</Project>',
    '',
  ].join('\n'));

  try {
    const dotnet = process.env.DOTNET ?? 'dotnet';
    const build = await run(dotnet, ['build', project, '--nologo', '-v', 'quiet'], dir, 60_000);
    assert.equal(build.exit, 0, 'dotnet build failed:\n' + build.stdout + '\n' + build.stderr);

    const node = await run(process.execPath, ['--no-warnings', 'input.cjs'], dir);
    const csharp = await run(dotnet, [path.join(projectDir, 'bin/Debug/net8.0/RendererHost.dll')], dir);
    assert.equal(node.exit, 0, node.stderr);
    assert.equal(csharp.exit, 0, csharp.stderr);
    assert.equal(csharp.stdout, node.stdout, 'WebCompat runtime differs from Node');
    assert.equal(csharp.stderr, node.stderr, 'WebCompat stderr differs from Node');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
