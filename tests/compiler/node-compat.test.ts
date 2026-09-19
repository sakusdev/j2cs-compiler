import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../../compiler/index.js';
import {
  NODE_RULE_ADAPTERS,
  NODE_RULE_DB_COMMIT,
  nodeOsFacts,
  nodePathFacts,
  nodeProcessFacts,
  selectNodeAdapter,
  verifyNodeRuleAdapters,
} from '../../compiler/node/index.js';

test('Node adapters pin reviewed canonical j2cs rule bytes', async () => {
  await verifyNodeRuleAdapters(path.join(ROOT, 'rule-db'));
  assert.equal(NODE_RULE_DB_COMMIT, '35ca8d859f9352e90ee2497f4ac8f6edb9c19ed1');
  for (const adapter of NODE_RULE_ADAPTERS) {
    const bytes = readFileSync(path.join(ROOT, 'rule-db', adapter.rulePath), 'utf8').replace(/\r\n/g, '\n');
    const sha256 = createHash('sha256').update(bytes, 'utf8').digest('hex');
    assert.equal(sha256, adapter.sha256, `canonical rule drifted: ${adapter.ruleId}`);
  }
});

test('process contracts require proven Node global identity and reject shadowing', () => {
  const facts = nodeProcessFacts();
  const cwd = selectNodeAdapter('process.cwd', facts);
  assert.equal(cwd.status, 'selected');
  if (cwd.status === 'selected') assert.equal(cwd.adapter.ruleId, 'node.process.cwd');

  facts.prove('binding.shadowed', true, 'test shadow');
  const shadowed = selectNodeAdapter('process.cwd', facts);
  assert.equal(shadowed.status, 'blocked');
  if (shadowed.status === 'blocked') assert.equal(shadowed.proof.verdict, 'false');
});

test('process.chdir requires a String proof and main-thread execution context', () => {
  const facts = nodeProcessFacts()
    .type('argument', ['String'], 'argument analysis')
    .prove('execution.context', 'main', 'main-thread host');
  assert.equal(selectNodeAdapter('process.chdir', facts).status, 'selected');

  facts.type('argument', ['Number'], 'changed test argument');
  assert.equal(selectNodeAdapter('process.chdir', facts).status, 'blocked');
});

test('path contracts require exact builtin provenance, static flavor, and argument proofs', () => {
  const normalizeFacts = nodePathFacts('posix').type('argument', ['String'], 'argument analysis');
  const normalize = selectNodeAdapter('path.normalize', normalizeFacts);
  assert.equal(normalize.status, 'selected');
  if (normalize.status === 'selected') assert.equal(normalize.adapter.target, 'NodePath.Normalize');

  const joinFacts = nodePathFacts('win32').prove('arguments.allString', true, 'all call arguments are Strings');
  assert.equal(selectNodeAdapter('path.join', joinFacts).status, 'selected');

  normalizeFacts.prove('binding.origin', 'user:path', 'shadow/user module');
  assert.equal(selectNodeAdapter('path.normalize', normalizeFacts).status, 'blocked');
});

test('os contracts expose runtime platform facts without compile-time host guessing', () => {
  const facts = nodeOsFacts();
  assert.equal(facts.get('host.platform')?.value, 'runtime');
  assert.equal(facts.get('host.arch')?.value, 'runtime');
  assert.equal(selectNodeAdapter('os.platform', facts).status, 'selected');
  assert.equal(selectNodeAdapter('os.arch', facts).status, 'selected');
  assert.equal(selectNodeAdapter('os.EOL', facts).status, 'selected');
});

test('unwired nearby Node APIs remain fail-closed', () => {
  assert.equal(selectNodeAdapter('process.kill', nodeProcessFacts()).status, 'unsupported');
  assert.equal(selectNodeAdapter('path.resolve', nodePathFacts('host')).status, 'unsupported');
  assert.equal(selectNodeAdapter('os.homedir', nodeOsFacts()).status, 'unsupported');
});
