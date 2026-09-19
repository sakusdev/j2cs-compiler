import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT } from '../../compiler/index.js';

function normalize(text: string): string {
  return text.replace(/\r\n/g, '\n').trimEnd();
}

function xml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

test('Node contract vs C# UpdateCompat ordering and platform gates', { timeout: 90_000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'j2cs-update-diff-'));
  try {
    const runtimeProject = path.join(ROOT, 'runtime/J2cs.Runtime/J2cs.Runtime.csproj');
    const project = path.join(root, 'Probe.csproj');
    const program = path.join(root, 'Program.cs');
    await writeFile(project, `<Project Sdk="Microsoft.NET.Sdk">
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
    await writeFile(program, `using System.Linq;
using J2cs.Runtime.UpdateCompat;

var updater = new UpdateCoordinator(UpdateHostPlatform.Windows, WindowsPackageKind.Msix, true, "stable");
Console.WriteLine(updater.Mechanism);
updater.SetFeedUrl(new Uri("https://updates.example.test/stable"));
Console.WriteLine(updater.State);
Console.WriteLine(updater.BeginCheck().Kind);
updater.MarkUpdateAvailable("2.0.0");
updater.MarkUpdateDownloaded("2.0.0");
Console.WriteLine(updater.PersistDownloadedForNextLaunch().Kind);
updater.RecordRollbackPoint("1.0.0");
Console.WriteLine(updater.RequestQuitAndInstall().Kind);
Console.WriteLine(string.Join(">", updater.Trace.Select(item => item.Name)));

try
{
    var linux = new UpdateCoordinator(UpdateHostPlatform.Linux, null, false, "stable");
    linux.SetFeedUrl(new Uri("https://updates.example.test/stable"));
    Console.WriteLine("linux:unexpected");
}
catch (PlatformNotSupportedException)
{
    Console.WriteLine("linux:unsupported");
}

try
{
    var mac = new UpdateCoordinator(UpdateHostPlatform.MacOS, null, false, "stable");
    mac.SetFeedUrl(new Uri("https://updates.example.test/stable"));
    Console.WriteLine("mac:unexpected");
}
catch (InvalidOperationException)
{
    Console.WriteLine("mac:unsigned");
}
`);

    const nodeScript = `
const trace = [];
let state = 'Idle';
const mechanism = 'Msix';
console.log(mechanism);
state = 'FeedConfigured'; trace.push('set-feed-url'); console.log(state);
state = 'Checking'; trace.push('check-for-updates'); console.log('CheckForUpdates');
state = 'Available'; trace.push('update-available');
state = 'Downloaded'; trace.push('update-downloaded');
trace.push('persist-downloaded-update'); console.log('PersistDownloadedUpdate');
trace.push('rollback-point');
state = 'InstallRequested'; trace.push('quit-and-install'); console.log('QuitAndInstall');
console.log(trace.join('>'));
console.log('linux:unsupported');
console.log('mac:unsigned');
`;
    const node = spawnSync(process.execPath, ['-e', nodeScript], { encoding: 'utf8' });
    assert.equal(node.status, 0, node.stderr);

    const dotnet = process.env.DOTNET ?? 'dotnet';
    const managed = spawnSync(dotnet, ['run', '--project', project, '--configuration', 'Release', '--nologo'], {
      encoding: 'utf8',
      cwd: root,
      env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1' },
    });
    if (managed.error) throw managed.error;
    assert.equal(managed.status, 0, managed.stderr);
    assert.equal(normalize(managed.stderr), '');
    assert.equal(normalize(managed.stdout), normalize(node.stdout));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
