import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT } from '../../compiler/index.js';
import { Facts } from '../../compiler/analysis/facts.js';
import { RuleIndex, type Adapter } from '../../compiler/rules/index.js';
import { loadRules, type Rule, type RuleDatabase, type Strategy } from '../../compiler/rules/loader.js';
const facts = new Facts().type('left', ['Number'], 'test analysis').prove('profile.platform', 'portable', 'profile');
function index(spec: { id: string; strategy: Strategy; requirements?: Record<string, unknown> }[]): RuleIndex {
  const db: RuleDatabase = { byId: new Map(), byCategory: new Map(), byStrategy: new Map() };
  const adapters: Adapter[] = [];
  for (const s of spec) {
    const rule: Rule = { id: s.id, category: 'fixture', strategy: s.strategy, source: { pattern: 'Not a regex (', requirements: s.requirements }, target: { kind: 'csharp' } };
    db.byId.set(s.id, { rule, file: 'test.json', sha256: 'fixture' });
    adapters.push({ ruleId: s.id, sha256: 'fixture', selector: { kind: 'binary', operator: '+' }, lowering: 'fixture' });
  }
  return new RuleIndex(db, adapters);
}
test('selector matching never parses source.pattern as a regex', () => {
  const i = index([{ id: 'a', strategy: 'native' }]);
  assert.equal(i.select({ kind: 'binary', operator: '+' }, facts).selected?.loaded.rule.id, 'a');
  assert.equal(i.select({ kind: 'binary', operator: '-' }, facts).selected, undefined);
});
test('unique strict requirement superset wins within a tier', () => {
  const i = index([{ id: 'general', strategy: 'native', requirements: { left_type: 'Number' } },
    { id: 'specific', strategy: 'native', requirements: { left_type: 'Number', platform: 'portable' } }]);
  assert.equal(i.select({ kind: 'binary', operator: '+' }, facts).selected?.loaded.rule.id, 'specific');
});
test('ambiguous native candidates fall back to a proven helper, never ID ordering', () => {
  const i = index([{ id: 'a', strategy: 'native' }, { id: 'b', strategy: 'native' }, { id: 'safe', strategy: 'helper' }]);
  const r = i.select({ kind: 'binary', operator: '+' }, facts);
  assert.equal(r.selected?.loaded.rule.id, 'safe'); assert.deepEqual(r.ambiguous, ['a', 'b']);
});
test('unknown native requirements can fall back to runtime or unsupported', () => {
  const i = index([{ id: 'a', strategy: 'native', requirements: { unimplemented_requirement: true } }, { id: 'r', strategy: 'runtime' }]);
  assert.equal(i.select({ kind: 'binary', operator: '+' }, facts).selected?.loaded.rule.id, 'r');
  const none = index([{ id: 'a', strategy: 'native', requirements: { unimplemented_requirement: true } }]);
  assert.equal(none.select({ kind: 'binary', operator: '+' }, facts).selected, undefined);
});
test('ambiguous helpers without a safe fallback remain unsupported', () => {
  const r = index([{ id: 'a', strategy: 'helper' }, { id: 'b', strategy: 'helper' }]).select({ kind: 'binary', operator: '+' }, facts);
  assert.equal(r.selected, undefined); assert.equal(r.ambiguous.length, 2);
});
test('changed rule content cannot silently reuse a reviewed lowering', () => {
  const i = index([{ id: 'a', strategy: 'native' }]);
  assert.throws(() => new RuleIndex(i.database, [{ ...i.adapters[0]!, sha256: 'changed' }]), /changed/);
});
test('loader enforces upstream schema and duplicate IDs', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'j2cs-loader-'));
  try {
    await mkdir(path.join(root, 'schema')); await mkdir(path.join(root, 'rules'));
    await copyFile(path.join(ROOT, 'rule-db/schema/rule.schema.json'), path.join(root, 'schema/rule.schema.json'));
    const rule = { id: 'fixture.one', category: 'fixture', source: { pattern: 'x' }, target: { kind: 'csharp' },
      strategy: 'native', confidence: 'high', semantics: {}, tests: [{ name: 'one', input: '1' }] };
    await writeFile(path.join(root, 'rules/one.json'), JSON.stringify(rule));
    assert.equal((await loadRules(root)).byId.size, 1);
    await writeFile(path.join(root, 'rules/two.json'), JSON.stringify(rule));
    await assert.rejects(loadRules(root), /Duplicate rule ID/);
    await writeFile(path.join(root, 'rules/two.json'), JSON.stringify({ ...rule, id: 'fixture.two', strategy: 'incorrect' }));
    await assert.rejects(loadRules(root), /Invalid rule schema/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
