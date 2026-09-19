import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT } from '../../compiler/index.js';
import {
  loadAndPlanPackage,
  materializePackage,
  planPackage,
  type PackagingRequest,
} from '../../compiler/packaging/index.js';
import { loadRules } from '../../compiler/rules/loader.js';
import {
  loadPackagingRuleProofs,
  provePackagingRuleContracts,
  PACKAGING_RULE_DB_COMMIT,
  PACKAGING_RULE_IDS,
} from '../../compiler/packaging/rules.js';

const ruleDb = path.join(ROOT, 'rule-db');

function request(overrides: Partial<PackagingRequest> = {}): PackagingRequest {
  return {
    appId: 'org.example.demo',
    appName: 'Demo',
    version: '1.2.3',
    platform: 'win32',
    arch: 'x64',
    entryExecutable: 'Demo.exe',
    windowsPackaging: 'msix',
    signed: true,
    enableAutoUpdate: true,
    channel: 'stable',
    files: [
      { source: 'publish/Demo.exe', relativePath: 'Demo.exe', kind: 'managed' },
      { source: 'publish/Demo.dll', relativePath: 'Demo.dll', kind: 'managed' },
      { source: 'assets/index.html', relativePath: 'index.html', kind: 'resource' },
      { source: 'native/demo.dll', relativePath: 'demo.dll', kind: 'native' },
    ],
    ...overrides,
  };
}

test('packaging proof manifest is tied to the same pinned j2cs commit as compiler adapters', async () => {
  const adapters = JSON.parse(await readFile(path.join(ROOT, 'compiler/rules/adapters.json'), 'utf8')) as { ruleDbCommit: string };
  assert.equal(PACKAGING_RULE_DB_COMMIT, adapters.ruleDbCommit);
  const proofs = await loadPackagingRuleProofs(ruleDb);
  assert.deepEqual(proofs.map(proof => proof.ruleId), [...PACKAGING_RULE_IDS]);
  assert.ok(proofs.every(proof => /^[0-9a-f]{64}$/.test(proof.sha256)));
});

test('packaging rule proof fails closed when canonical content fingerprint changes', async () => {
  const database = await loadRules(ruleDb);
  const loaded = database.byId.get('electron.autoupdater.platform-support');
  assert.ok(loaded);
  loaded.sha256 = '0'.repeat(64);
  assert.throws(() => provePackagingRuleContracts(database), /changed content/);
});

test('Windows MSIX plan maps managed, Electron resource and native payloads deterministically', async () => {
  const plan = await loadAndPlanPackage(request(), ruleDb);
  assert.equal(plan.rid, 'win-x64');
  assert.equal(plan.artifactFormat, 'msix');
  assert.equal(plan.layout.entryExecutable, 'Demo-1.2.3-win-x64/Demo.exe');
  assert.equal(plan.layout.electronAppPath, 'Demo-1.2.3-win-x64/resources/app');
  assert.equal(plan.layout.nativeRoot, 'Demo-1.2.3-win-x64/resources/native/win-x64');
  assert.equal(plan.updater.supported, true);
  assert.equal(plan.updater.mechanism, 'msix');
  assert.deepEqual(plan.signingHooks, [{
    id: 'windows-package-sign',
    stage: 'after-artifact',
    required: true,
    commandHint: 'signtool',
  }]);
  assert.ok(plan.ruleProofs.some(proof => proof.ruleId === 'electron.autoupdater.windows-updater-selection'));
  assert.ok(plan.ruleProofs.some(proof => proof.ruleId === 'electron.app.getapppath'));
});

test('macOS updater fails closed when the app is unsigned', async () => {
  const plan = await loadAndPlanPackage(request({
    platform: 'darwin',
    arch: 'arm64',
    entryExecutable: 'Demo',
    windowsPackaging: undefined,
    signed: false,
    files: [{ source: 'publish/Demo', relativePath: 'Demo', kind: 'managed' }],
  }), ruleDb);
  assert.equal(plan.artifactFormat, 'app-bundle');
  assert.equal(plan.layout.entryExecutable, 'Demo.app/Contents/MacOS/Demo');
  assert.equal(plan.updater.supported, false);
  assert.match(plan.updater.reason ?? '', /signed macOS application/);
  assert.ok(plan.ruleProofs.some(proof => proof.ruleId === 'electron.autoupdater.mac-signing'));
});

test('Linux does not silently emulate Electron built-in autoUpdater', async () => {
  const plan = await loadAndPlanPackage(request({
    platform: 'linux',
    entryExecutable: 'Demo',
    windowsPackaging: undefined,
    signed: false,
    files: [{ source: 'publish/Demo', relativePath: 'Demo', kind: 'managed' }],
  }), ruleDb);
  assert.equal(plan.updater.supported, false);
  assert.equal(plan.updater.mechanism, 'none');
  assert.match(plan.updater.reason ?? '', /Linux/);
});

test('Windows updater selection is required instead of guessed', async () => {
  const proofs = await loadPackagingRuleProofs(ruleDb);
  assert.throws(() => planPackage(request({ windowsPackaging: undefined }), proofs), /windowsPackaging is required/);
});

test('package paths reject traversal and duplicate destinations', async () => {
  const proofs = await loadPackagingRuleProofs(ruleDb);
  assert.throws(() => planPackage(request({
    files: [
      { source: 'publish/Demo.exe', relativePath: 'Demo.exe', kind: 'managed' },
      { source: 'secret', relativePath: '../secret', kind: 'resource' },
    ],
  }), proofs), /stay inside/);
  assert.throws(() => planPackage(request({
    files: [
      { source: 'publish/Demo.exe', relativePath: 'Demo.exe', kind: 'managed' },
      { source: 'publish/other.exe', relativePath: 'Demo.exe', kind: 'managed' },
    ],
  }), proofs), /Duplicate package destination/);
});

test('materializer copies package payload and emits proof-bearing manifest', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'j2cs-package-'));
  try {
    const src = path.join(root, 'src');
    const out = path.join(root, 'out');
    await import('node:fs/promises').then(fs => fs.mkdir(src, { recursive: true }));
    const exe = path.join(src, 'Demo.exe');
    const html = path.join(src, 'index.html');
    const native = path.join(src, 'demo.dll');
    await Promise.all([
      writeFile(exe, 'exe'),
      writeFile(html, '<p>ok</p>'),
      writeFile(native, 'native'),
    ]);
    const plan = await loadAndPlanPackage(request({
      enableAutoUpdate: false,
      files: [
        { source: exe, relativePath: 'Demo.exe', kind: 'managed' },
        { source: html, relativePath: 'web/index.html', kind: 'resource' },
        { source: native, relativePath: 'demo.dll', kind: 'native' },
      ],
    }), ruleDb);
    const manifestPath = await materializePackage(plan, out);
    assert.equal(await readFile(path.join(out, plan.layout.entryExecutable), 'utf8'), 'exe');
    assert.equal(await readFile(path.join(out, plan.layout.electronAppPath, 'web/index.html'), 'utf8'), '<p>ok</p>');
    assert.equal(await readFile(path.join(out, plan.layout.nativeRoot, 'demo.dll'), 'utf8'), 'native');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { ruleProofs: Array<{ ruleId: string }> };
    assert.deepEqual(manifest.ruleProofs.map(proof => proof.ruleId), ['electron.app.getapppath']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
