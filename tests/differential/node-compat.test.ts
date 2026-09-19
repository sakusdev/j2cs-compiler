import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import path from 'node:path';
import { ROOT } from '../../compiler/index.js';

function outcome(result: SpawnSyncReturns<string>) {
  if (result.error) throw result.error;
  return {
    exit: result.status,
    signal: result.signal,
    stdout: (result.stdout ?? '').replace(/\r\n/g, '\n'),
    stderr: (result.stderr ?? '').replace(/\r\n/g, '\n'),
  };
}

test('Node events/Buffer/streams runtime contract matches Node', { timeout: 90_000 }, () => {
  const fixture = path.join(ROOT, 'tests/differential/fixtures/node-compat');
  const project = path.join(fixture, 'NodeCompatProbe.csproj');
  const dotnet = process.env.DOTNET ?? 'dotnet';

  const build = outcome(spawnSync(dotnet, ['build', project, '--nologo', '-v', 'quiet'], {
    cwd: ROOT, encoding: 'utf8', timeout: 60_000,
  }));
  assert.equal(build.exit, 0, `dotnet build failed:\n${build.stdout}\n${build.stderr}`);

  const node = outcome(spawnSync(process.execPath, [path.join(fixture, 'input.cjs')], {
    cwd: ROOT, encoding: 'utf8', timeout: 30_000,
  }));
  const csharp = outcome(spawnSync(dotnet, [path.join(fixture, 'bin/Debug/net8.0/NodeCompatProbe.dll')], {
    cwd: ROOT, encoding: 'utf8', timeout: 30_000,
  }));

  assert.equal(node.exit, 0, node.stderr);
  assert.equal(csharp.exit, 0, csharp.stderr);
  assert.deepEqual(csharp, node);
});
