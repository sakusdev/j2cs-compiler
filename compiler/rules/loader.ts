import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { fail } from '../diagnostics/index.js';
export type Strategy = 'native' | 'helper' | 'runtime' | 'unsupported';
export interface Rule {
  id: string; category: string; source: { pattern: string; requirements?: Record<string, unknown> };
  target: { kind: string; helper?: string; template?: string }; strategy: Strategy;
  [key: string]: unknown;
}
export interface LoadedRule { rule: Rule; file: string; sha256: string }
export interface RuleDatabase {
  byId: Map<string, LoadedRule>; byCategory: Map<string, LoadedRule[]>; byStrategy: Map<Strategy, LoadedRule[]>;
}
async function jsonFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }), files: string[] = [];
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(root, e.name);
    if (e.isDirectory()) files.push(...await jsonFiles(file));
    else if (e.isFile() && e.name.endsWith('.json')) files.push(file);
  }
  return files;
}
export async function loadRules(root: string): Promise<RuleDatabase> {
  const db: RuleDatabase = { byId: new Map(), byCategory: new Map(), byStrategy: new Map() };
  let files: string[], schema: object;
  try { schema = JSON.parse(await readFile(path.join(root, 'schema/rule.schema.json'), 'utf8')); files = await jsonFiles(path.join(root, 'rules')); }
  catch (e) { return fail('E_RULE_DB', `Cannot load rule DB at ${root}. Run git submodule update --init. ${String(e)}`); }
  const validate = new Ajv2020({ strict: false, allErrors: true }).compile(schema);
  if (!files.length) fail('E_RULE_DB', 'Rule DB is empty.');
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    let rule: Rule;
    try { rule = JSON.parse(text); } catch { return fail('E_RULE_JSON', `Invalid rule JSON: ${file}`); }
    if (!validate(rule)) fail('E_RULE_SCHEMA', `Invalid rule schema: ${file}`, undefined, validate.errors);
    if (db.byId.has(rule.id)) fail('E_RULE_DUPLICATE', `Duplicate rule ID: ${rule.id}`);
    // Git may materialize text files as CRLF on Windows. JSON whitespace has no
    // semantic effect; preserve the reviewed LF fingerprint across checkouts.
    const loaded = { rule, file: path.relative(root, file), sha256: createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex') };
    db.byId.set(rule.id, loaded);
    for (const [index, key] of [[db.byCategory, rule.category], [db.byStrategy, rule.strategy]] as const) {
      // Both indexes contain the same immutable loaded records.
      const map = index as Map<string, LoadedRule[]>;
      map.set(key, [...(map.get(key) ?? []), loaded]);
    }
  }
  return db;
}
