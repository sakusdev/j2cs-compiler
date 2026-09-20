import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ROOT } from '../../compiler/index.js';
import { PersistentAnalysisCache, moduleFingerprint, planIncrementalAnalysis, type ModuleInput } from '../../compiler/cache/incremental.js';
import { TraceRecorder, diffTrace } from '../../compiler/observability/trace.js';
import { evaluateSecurityRequest, validateRendererSecurityProfile, type SecurityPolicy } from '../../compiler/security/capabilities.js';
import { defaultSecurityFuzzCorpus, runSecurityFuzzCorpus } from '../../compiler/security/fuzz.js';
import { evaluateSecurityRuleProof, loadSecurityRuleProofs, proveSecurityRuleContracts, SECURITY_RULE_DB_COMMIT, SECURITY_RULE_IDS } from '../../compiler/security/rules.js';
import { loadRules } from '../../compiler/rules/loader.js';
import { runDiscordClassAcceptance } from '../e2e/discord-class.js';

const ruleDb = path.join(ROOT, 'rule-db');

function policy(root: string): SecurityPolicy {
  return {
    contextIsolationRequired: true,
    sandboxRequired: true,
    allowNodeIntegration: false,
    allowedIpcChannels: new Set(['safe:read']),
    allowedNetworkOrigins: new Set(['https://allowed.example']),
    allowedFileRoots: [root],
    allowedExternalSchemes: new Set(['https']),
    allowWindowOpen: false,
  };
}

test('security proof manifest pins reviewed j2cs rules at the compiler rule-db commit', async () => {
  const adapters = await import('node:fs/promises').then(fs => fs.readFile(path.join(ROOT, 'compiler/rules/adapters.json'), 'utf8'));
  assert.equal(SECURITY_RULE_DB_COMMIT, (JSON.parse(adapters) as { ruleDbCommit: string }).ruleDbCommit);
  const proofs = await loadSecurityRuleProofs(ruleDb);
  assert.deepEqual(proofs.map(proof => proof.ruleId), [...SECURITY_RULE_IDS]);
  assert.ok(proofs.every(proof => /^[0-9a-f]{64}$/.test(proof.sha256)));
});

test('security proof fails closed on canonical hash drift and unproven facts', async () => {
  const database = await loadRules(ruleDb);
  const loaded = database.byId.get('electron.ipcmain.handle');
  assert.ok(loaded);
  loaded.sha256 = '0'.repeat(64);
  assert.throws(() => proveSecurityRuleContracts(database), /changed content/);

  const proof = (await loadSecurityRuleProofs(ruleDb)).find(item => item.ruleId === 'electron.ipcmain.handle');
  assert.ok(proof);
  assert.equal(evaluateSecurityRuleProof(proof, { module_binding: 'electron.ipcMain' }).verdict, 'unknown');
  assert.equal(evaluateSecurityRuleProof(proof, {
    module_binding: 'electron.ipcMain', builtin_not_overridden: false, main_process: true,
  }).verdict, 'disproven');
  assert.equal(evaluateSecurityRuleProof(proof, {
    module_binding: 'electron.ipcMain', builtin_not_overridden: true, main_process: true,
  }).verdict, 'proven');
});

test('trace recording is deterministic, bounded and reports the first mismatch', () => {
  const left = new TraceRecorder(2);
  left.append('ipc', 'invoke', 'r|1', [['z', '2'], ['a', 'x;y']]);
  left.append('lifecycle', 'close');
  const right = new TraceRecorder(2);
  right.append('ipc', 'invoke', 'r|1', [['a', 'x;y'], ['z', '2']]);
  right.append('lifecycle', 'close');
  assert.deepEqual(left.canonicalLines(), right.canonicalLines());
  assert.equal(left.canonicalLines()[0], '1|ipc|invoke|r\\p1|a=x\\sy;z=2');
  assert.equal(left.sha256(), right.sha256());
  assert.equal(diffTrace(left.snapshot(), right.snapshot()).equal, true);
  assert.throws(() => left.append('dom', 'overflow'), /limit/);

  const changed = new TraceRecorder();
  changed.append('ipc', 'send');
  const diff = diffTrace(right.snapshot(), changed.snapshot());
  assert.equal(diff.equal, false);
  assert.equal(diff.firstMismatch?.index, 0);
});

test('security capability checks default-deny unsafe renderer and host requests', () => {
  const root = path.resolve('authorized-data');
  const p = policy(root);
  assert.equal(validateRendererSecurityProfile(p, { contextIsolation: true, sandbox: true, nodeIntegration: false }).allowed, true);
  assert.equal(validateRendererSecurityProfile(p, { contextIsolation: false, sandbox: true, nodeIntegration: false }).code, 'E_SECURITY_CONTEXT_ISOLATION');
  assert.equal(evaluateSecurityRequest(p, { kind: 'ipc-invoke', channel: 'safe:read' }).allowed, true);
  assert.equal(evaluateSecurityRequest(p, { kind: 'ipc-invoke', channel: 'admin:delete' }).allowed, false);
  assert.equal(evaluateSecurityRequest(p, { kind: 'network-origin', url: 'https://allowed.example/path' }).allowed, true);
  assert.equal(evaluateSecurityRequest(p, { kind: 'network-origin', url: 'https://allowed.example.evil.invalid/' }).allowed, false);
  assert.equal(evaluateSecurityRequest(p, { kind: 'file-read', filePath: path.join(root, 'safe.txt') }).allowed, true);
  assert.equal(evaluateSecurityRequest(p, { kind: 'file-read', filePath: path.resolve(root, '..', 'secret.txt') }).allowed, false);
  assert.equal(evaluateSecurityRequest(p, { kind: 'window-open', url: 'https://allowed.example/' }).allowed, false);
  assert.ok(runSecurityFuzzCorpus(p, defaultSecurityFuzzCorpus(root)).every(result => result.invariantSatisfied));
});

test('persistent incremental cache invalidates reverse dependents and is cycle-safe', () => {
  const modules: readonly ModuleInput[] = [
    { id: 'a', source: 'a1', dependencies: ['b'] },
    { id: 'b', source: 'b1', dependencies: ['c'] },
    { id: 'c', source: 'c1', dependencies: [] },
    { id: 'x', source: 'x1', dependencies: [] },
  ];
  const cache = new PersistentAnalysisCache();
  for (const module of modules) cache.put({ moduleId: module.id, fingerprint: moduleFingerprint(module, 'v1'), summary: module.id });
  const restored = PersistentAnalysisCache.deserialize(cache.serialize());
  const changed = modules.map(module => module.id === 'c' ? { ...module, source: 'c2' } : module);
  const plan = planIncrementalAnalysis(changed, restored, 'v1');
  assert.deepEqual(plan.invalidated, ['a', 'b', 'c']);
  assert.deepEqual(plan.reusable, ['x']);
  assert.deepEqual(plan.missingDependencies, []);

  const cyclic: readonly ModuleInput[] = [
    { id: 'p', source: 'p', dependencies: ['q'] },
    { id: 'q', source: 'q', dependencies: ['p', 'missing'] },
  ];
  const empty = new PersistentAnalysisCache();
  const cyclePlan = planIncrementalAnalysis(cyclic, empty, 'v1');
  assert.deepEqual(cyclePlan.invalidated, ['p', 'q']);
  assert.deepEqual(cyclePlan.missingDependencies, ['q->missing']);
});

test('Discord-shaped synthetic E2E acceptance passes only explicit supported contracts', () => {
  const report = runDiscordClassAcceptance(path.resolve('authorized-e2e-data'));
  assert.equal(report.accepted, true);
  assert.equal(report.traceEqual, true);
  assert.equal(report.securityPassed, true);
  assert.equal(report.cachePassed, true);
  assert.equal(report.unsupportedFallbacks, 0);
  assert.deepEqual(report.invalidatedModules, ['app', 'profile', 'transport']);
});
