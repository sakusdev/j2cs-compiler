#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { compile, createCompiler } from './index.js';
import { writeProject } from './emit/project.js';
import { CompileError, formatDiagnostic } from './diagnostics/index.js';
async function main(): Promise<void> {
  const args = parseArgs({ allowPositionals: true, options: { out: { type: 'string' }, 'rule-db': { type: 'string' },
    'diagnostics-json': { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } });
  if (args.values.help) { console.log('Usage: npm run compile -- input.js --out <empty-directory> [--rule-db <j2cs-checkout>] [--diagnostics-json]'); return; }
  if (args.positionals.length !== 1 || !args.values.out) throw new Error('Expected one input file and --out. See --help.');
  try {
    const file = path.resolve(args.positionals[0]!), compiler = await createCompiler(args.values['rule-db']);
    const result = compile(await readFile(file, 'utf8'), compiler, file);
    const project = await writeProject(result, path.resolve(args.values.out));
    console.log(`Generated ${project} (${result.trace.length} proven rule decisions)`);
  } catch (e) {
    if (!(e instanceof CompileError)) throw e;
    console.error(args.values['diagnostics-json'] ? JSON.stringify(e.diagnostic) : formatDiagnostic(e.diagnostic)); process.exitCode = 1;
  }
}
main().catch(e => { console.error(String(e)); process.exitCode = 1; });
