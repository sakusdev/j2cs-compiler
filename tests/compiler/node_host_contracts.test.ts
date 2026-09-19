import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { compile, createCompiler, ROOT } from '../../compiler/index.js';
import { CompileError } from '../../compiler/diagnostics/index.js';
import { loadRules, type RuleDatabase } from '../../compiler/rules/loader.js';
import { PINNED_J2CS_COMMIT, proveNodeHostContracts } from '../../compiler/node/contracts.js';

const ruleDbPath = path.join(ROOT, 'rule-db');

function code(error: unknown): string | undefined {
  return error instanceof CompileError ? error.diagnostic.code : undefined;
}

test('Node host runtime contracts are connected to the exact pinned canonical j2cs rules', async () => {
  const actualCommit = execFileSync('git', ['-C', ruleDbPath, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  assert.equal(actualCommit, PINNED_J2CS_COMMIT);

  const database = await loadRules(ruleDbPath);
  const proofs = proveNodeHostContracts(database);
  assert.equal(proofs.length, 11);
  assert.equal(new Set(proofs.map(proof => proof.ruleId)).size, proofs.length);
  assert.ok(proofs.every(proof => /^[0-9a-f]{64}$/.test(proof.sha256)));
  assert.ok(proofs.every(proof => proof.ruleDbCommit === PINNED_J2CS_COMMIT));
  assert.ok(proofs.some(proof => proof.ruleId === 'node.timers.set-timeout'));
  assert.ok(proofs.some(proof => proof.ruleId === 'node.child-process.spawn-sync'));
  assert.ok(proofs.some(proof => proof.ruleId === 'node.worker-threads.exit-event'));
});

test('Node host proof fails closed if an owned canonical rule is unavailable', async () => {
  const database = await loadRules(ruleDbPath);
  const missing: RuleDatabase = {
    byId: new Map(database.byId),
    byCategory: database.byCategory,
    byStrategy: database.byStrategy,
  };
  missing.byId.delete('node.timers.set-timeout');
  assert.throws(() => proveNodeHostContracts(missing), error => code(error) === 'E_RULE_MISSING');
});

test('unmerged Node/module syntax remains fail-closed instead of silently selecting host contracts', async () => {
  const index = await createCompiler();
  assert.throws(() => compile('setTimeout(1, 0);', index), error => code(error) === 'E_UNRESOLVED_BINDING');
  assert.throws(() => compile("require('node:child_process');", index), error => code(error) === 'E_UNRESOLVED_BINDING');
  assert.throws(() => compile("require('node:worker_threads');", index), error => code(error) === 'E_UNRESOLVED_BINDING');
});
