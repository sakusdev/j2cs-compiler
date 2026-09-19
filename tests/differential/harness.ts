import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { compile } from '../../compiler/index.js';
import { writeProject } from '../../compiler/emit/project.js';
import type { RuleIndex } from '../../compiler/rules/index.js';
const exec = promisify(execFile);
export interface Execution { stdout: string; stderr: string; exit: number; signal: string | null }
export async function run(command: string, args: string[], cwd: string, timeout = 20_000): Promise<Execution> {
  try {
    const r = await exec(command, args, { cwd, timeout, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8',
      env: { ...process.env, NODE_OPTIONS: '', FORCE_COLOR: '0', DOTNET_NOLOGO: '1', DOTNET_CLI_TELEMETRY_OPTOUT: '1' } });
    return { stdout: r.stdout, stderr: r.stderr, exit: 0, signal: null };
  } catch (error) {
    const e = error as Error & { code?: number | string; signal?: string; stdout?: string; stderr?: string; killed?: boolean };
    if (typeof e.code !== 'number' || e.killed) throw new Error(`Infrastructure failure running ${command}: ${e.message}`);
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', exit: e.code, signal: e.signal ?? null };
  }
}
export interface Fixture { name: string; source: string; extension?: 'js' | 'ts'; observe?: string[]; stdout?: string }
export async function differential(index: RuleIndex, fixture: Fixture) {
  const dir = await mkdtemp(path.join(tmpdir(), 'j2cs-diff-')), dotnet = process.env.DOTNET ?? 'dotnet';
  const marker = '__j2cs_observation__';
  const source = fixture.source + '\n' + (fixture.observe ?? []).map((expression, i) =>
    `console.log("${marker}${i}:", (${expression}));`).join('\n');
  try {
    const result = compile(source, index, `${fixture.name}.${fixture.extension ?? 'js'}`);
    const project = await writeProject(result, path.join(dir, 'generated'));
    // TS annotations are erased for the Node oracle; the compiler itself never trusts them.
    const nodeSource = fixture.extension === 'ts' ? ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText : source;
    await writeFile(path.join(dir, 'input.cjs'), nodeSource);
    const build = await run(dotnet, ['build', project, '--nologo', '-v', 'quiet'], dir, 60_000);
    assert.equal(build.exit, 0, `dotnet build failed:\n${build.stdout}\n${build.stderr}`);
    const node = await run(process.execPath, ['input.cjs'], dir);
    const csharp = await run(dotnet, [path.join(dir, 'generated/bin/Debug/net8.0/J2cs.Generated.dll')], dir);
    assert.deepEqual(csharp, node, 'Generated C# differs from Node (stdout/stderr/exit/signal)');
    const observable = (r: Execution) => r.stdout.split('\n').filter(line => line.startsWith(marker));
    assert.deepEqual(observable(csharp), observable(node), 'Observable expression results differ');
    assert.equal(observable(node).length, fixture.observe?.length ?? 0);
    if (fixture.stdout !== undefined) assert.equal(node.stdout, fixture.stdout, 'Fixture oracle expectation drift');
    await rm(dir, { recursive: true, force: true });
    return { result, node, csharp, observations: observable(node) };
  } catch (e) {
    throw new Error(`${fixture.name}: ${String(e)}\nReproduction artifacts: ${dir}`, { cause: e });
  }
}
