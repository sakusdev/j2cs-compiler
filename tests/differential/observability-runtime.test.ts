import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT } from '../../compiler/index.js';
import { TraceRecorder } from '../../compiler/observability/trace.js';

function normalize(text: string): string { return text.replace(/\r\n/g, '\n').trimEnd(); }
function xml(value: string): string { return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

test('Node vs generated C# deterministic observability trace', { timeout: 90_000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'j2cs-observability-diff-'));
  try {
    const runtimeProject = path.join(ROOT, 'runtime/J2cs.Runtime/J2cs.Runtime.csproj');
    const project = path.join(root, 'Probe.csproj');
    const program = path.join(root, 'Program.cs');
    await writeFile(project, `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings><Nullable>enable</Nullable><TreatWarningsAsErrors>true</TreatWarningsAsErrors></PropertyGroup>
  <ItemGroup><ProjectReference Include="${xml(runtimeProject)}" /></ItemGroup>
</Project>\n`);
    await writeFile(program, `using J2cs.Runtime.Observability;
var trace = new DeterministicTrace();
trace.Append("lifecycle", "app-ready", "main");
trace.Append("ipc", "invoke", "renderer|1", new TraceField("request", "42"), new TraceField("channel", "profile;get"));
trace.Append("network", "message", "gateway", new TraceField("payload", "line1\\nline2=ok"));
foreach (var line in trace.CanonicalLines()) Console.WriteLine(line);
Console.WriteLine(trace.ComputeSha256());
`);

    const oracle = new TraceRecorder();
    oracle.append('lifecycle', 'app-ready', 'main');
    oracle.append('ipc', 'invoke', 'renderer|1', [['request', '42'], ['channel', 'profile;get']]);
    oracle.append('network', 'message', 'gateway', [['payload', 'line1\nline2=ok']]);
    const expected = [...oracle.canonicalLines(), oracle.sha256()].join('\n');

    const dotnet = process.env.DOTNET ?? 'dotnet';
    const managed = spawnSync(dotnet, ['run', '--project', project, '--configuration', 'Release', '--nologo'], {
      encoding: 'utf8', cwd: root,
      env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1' },
    });
    if (managed.error) throw managed.error;
    assert.equal(managed.status, 0, managed.stderr);
    assert.equal(normalize(managed.stderr), '');
    assert.equal(normalize(managed.stdout), normalize(expected));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
