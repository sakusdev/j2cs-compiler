import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT } from '../../compiler/index.js';
import { run } from './harness.js';

const xml = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('"', '&quot;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;');

test('Node vs C#: process/path/os compatibility contracts', { timeout: 90_000 }, async () => {
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), 'j2cs-node-compat-')));
  const projectDir = path.join(dir, 'probe');
  const dotnet = process.env.DOTNET ?? 'dotnet';

  try {
    await mkdir(projectDir, { recursive: true });
    await mkdir(path.join(dir, 'sub'));

    const project = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
  </PropertyGroup>
  <ItemGroup>
    <ProjectReference Include="${xml(path.join(ROOT, 'runtime/J2cs.Runtime/J2cs.Runtime.csproj'))}" />
  </ItemGroup>
</Project>
`;

    const csharp = String.raw`using J2cs.Runtime;

static string B(bool value) => value ? "true" : "false";

Console.WriteLine(NodeProcess.Platform);
Console.WriteLine(NodeProcess.Arch);
Console.WriteLine(NodeOs.Platform());
Console.WriteLine(NodeOs.Arch());
Console.WriteLine(NodeOs.Eol == "\r\n" ? "\\r\\n" : "\\n");
Console.WriteLine(NodePath.Normalize("a//b/../c/", NodePathFlavor.Host));
Console.WriteLine(NodePath.Normalize("/a//b/../c/", NodePathFlavor.Posix));
Console.WriteLine(NodePath.Normalize(@"C:\temp\foo\..\bar", NodePathFlavor.Win32));
Console.WriteLine(NodePath.Join(NodePathFlavor.Host, "a", "", "b", "..", "c"));
Console.WriteLine(NodePath.Join(NodePathFlavor.Posix, "a", "b", "..", "c"));
Console.WriteLine(NodePath.Join(NodePathFlavor.Win32, @"C:\a", "b", "..", "c"));
Console.WriteLine(NodePath.Separator(NodePathFlavor.Host));
Console.WriteLine(NodePath.Delimiter(NodePathFlavor.Host));
Console.WriteLine(B(NodePath.IsAbsolute("/", NodePathFlavor.Host)));
Console.WriteLine(B(NodePath.IsAbsolute("/a", NodePathFlavor.Posix)));
Console.WriteLine(B(NodePath.IsAbsolute(@"C:\a", NodePathFlavor.Win32)));
Console.WriteLine(NodeProcess.Cwd());

var argv = NodeProcess.Argv;
var length = (int)JsArray.Length(argv);
Console.WriteLine(JsObject.GetProperty(argv, (length - 2).ToString()).String + "," +
                  JsObject.GetProperty(argv, (length - 1).ToString()).String);
Console.WriteLine(B(JsOperators.StrictEquals(NodeProcess.Argv, NodeProcess.Argv)));
Console.WriteLine(B(JsOperators.StrictEquals(NodeProcess.Env, NodeProcess.Env)));

JsObject.SetProperty(NodeProcess.Env, "J2CS_NODE_COMPAT_CASE", JsValue.FromString("seed"));
Console.WriteLine(JsObject.GetProperty(NodeProcess.Env, "J2CS_NODE_COMPAT_CASE").String);
JsObject.SetProperty(NodeProcess.Env, "J2CS_NODE_COMPAT_CASE", JsValue.FromString("mutated"));
Console.WriteLine(JsObject.GetProperty(NodeProcess.Env, "J2CS_NODE_COMPAT_CASE").String);
NodeEnvironment.Delete(NodeProcess.Env, "J2CS_NODE_COMPAT_CASE");
Console.WriteLine(B(JsObject.GetProperty(NodeProcess.Env, "J2CS_NODE_COMPAT_CASE").Kind == JsKind.Undefined));

var before = NodeProcess.Cwd();
NodeProcess.Chdir(Path.Combine(before, "sub"));
Console.WriteLine(B(NodeProcess.Cwd().EndsWith(Path.DirectorySeparatorChar + "sub", StringComparison.Ordinal)));
NodeProcess.Chdir(before);
`;

    const node = String.raw`const path = require('node:path');
const os = require('node:os');
const B = value => value ? 'true' : 'false';

console.log(process.platform);
console.log(process.arch);
console.log(os.platform());
console.log(os.arch());
console.log(os.EOL === '\r\n' ? '\\r\\n' : '\\n');
console.log(path.normalize('a//b/../c/'));
console.log(path.posix.normalize('/a//b/../c/'));
console.log(path.win32.normalize('C:\\temp\\foo\\..\\bar'));
console.log(path.join('a', '', 'b', '..', 'c'));
console.log(path.posix.join('a', 'b', '..', 'c'));
console.log(path.win32.join('C:\\a', 'b', '..', 'c'));
console.log(path.sep);
console.log(path.delimiter);
console.log(B(path.isAbsolute('/')));
console.log(B(path.posix.isAbsolute('/a')));
console.log(B(path.win32.isAbsolute('C:\\a')));
console.log(process.cwd());
console.log(process.argv.slice(-2).join(','));
console.log(B(process.argv === process.argv));
console.log(B(process.env === process.env));

process.env.J2CS_NODE_COMPAT_CASE = 'seed';
console.log(process.env.J2CS_NODE_COMPAT_CASE);
process.env.J2CS_NODE_COMPAT_CASE = 'mutated';
console.log(process.env.J2CS_NODE_COMPAT_CASE);
delete process.env.J2CS_NODE_COMPAT_CASE;
console.log(B(process.env.J2CS_NODE_COMPAT_CASE === undefined));

const before = process.cwd();
process.chdir(path.join(before, 'sub'));
console.log(B(process.cwd().endsWith(path.sep + 'sub')));
process.chdir(before);
`;

    await writeFile(path.join(projectDir, 'Probe.csproj'), project);
    await writeFile(path.join(projectDir, 'Program.cs'), csharp);
    await writeFile(path.join(dir, 'oracle.cjs'), node);

    const build = await run(dotnet, ['build', path.join(projectDir, 'Probe.csproj'), '--nologo', '-v', 'quiet'], dir, 60_000);
    assert.equal(build.exit, 0, `dotnet build failed:\n${build.stdout}\n${build.stderr}`);

    const nodeRun = await run(process.execPath, ['oracle.cjs', 'alpha', 'beta'], dir);
    const csRun = await run(dotnet, [path.join(projectDir, 'bin/Debug/net8.0/Probe.dll'), 'alpha', 'beta'], dir);

    const normalizeProbeOutput = <T extends { stdout: string; stderr: string }>(result: T): T => ({
      ...result,
      stdout: result.stdout.replace(/\r\n/g, '\n'),
      stderr: result.stderr.replace(/\r\n/g, '\n'),
    });
    assert.deepEqual(
      normalizeProbeOutput(csRun),
      normalizeProbeOutput(nodeRun),
      'NodeCompat runtime behavior differs from Node',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
