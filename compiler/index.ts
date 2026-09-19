import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parse } from './parser/index.js';
import { resolveBindings } from './analysis/bindings.js';
import { analyze } from './analysis/index.js';
import { loadRules } from './rules/loader.js';
import { loadAdapters, RuleIndex } from './rules/index.js';
import { lower } from './lowering/index.js';
import { emitCSharp } from './emit/csharp/index.js';
export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export async function createCompiler(ruleDb = path.join(ROOT, 'rule-db')): Promise<RuleIndex> {
  const database = await loadRules(ruleDb);
  const [core, asyncAdapters] = await Promise.all([
    loadAdapters(path.join(ROOT, 'compiler/rules/adapters.json')),
    loadAdapters(path.join(ROOT, 'compiler/rules/async-adapters.json')),
  ]);
  return new RuleIndex(database, [...core, ...asyncAdapters]);
}
export function compile(source: string, index: RuleIndex, file = 'input.js') {
  const ast = parse(source, file), bindings = resolveBindings(ast), semantics = analyze(ast, bindings);
  const lowered = lower(semantics, index);
  return { source: emitCSharp(lowered.ir), ...lowered };
}
