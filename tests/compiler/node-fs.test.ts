import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ROOT } from '../../compiler/index.js';
import { loadRules } from '../../compiler/rules/loader.js';
import { NODE_FS_RULES, proveNodeFsRule } from '../../compiler/node/fs.js';

const database = await loadRules(path.join(ROOT, 'rule-db'));

test('NODE_FS adapters pin canonical j2cs rules and helpers', () => {
  for (const spec of NODE_FS_RULES) {
    const loaded = database.byId.get(spec.ruleId);
    assert.ok(loaded, `missing canonical rule ${spec.ruleId}`);
    assert.equal(loaded.sha256, spec.sha256);
    assert.equal(loaded.rule.category, 'node_fs');
    assert.equal(loaded.rule.strategy, 'helper');
    assert.equal(loaded.rule.target.helper, spec.helper);
  }
});

test('sync fs rules require intrinsic module identity and representable options', () => {
  const read = proveNodeFsRule(database, 'readFileSync', {
    moduleBinding: 'node:fs builtin',
    bindingKind: 'intrinsic',
    optionsRepresentable: true,
    pathKind: 'string',
  });
  assert.equal(read.verdict, 'proven');
  assert.equal(read.helper, 'NodeFs.ReadFileSync');

  const shadowed = proveNodeFsRule(database, 'readFileSync', {
    moduleBinding: 'node:fs builtin',
    bindingKind: 'lexical',
    optionsRepresentable: true,
    pathKind: 'string',
  });
  assert.equal(shadowed.verdict, 'disproven');

  const unknownOptions = proveNodeFsRule(database, 'writeFileSync', {
    moduleBinding: 'node:fs builtin',
    bindingKind: 'intrinsic',
    pathKind: 'string',
    dataKind: 'string',
  });
  assert.equal(unknownOptions.verdict, 'unknown');

  const wrongModule = proveNodeFsRule(database, 'existsSync', {
    moduleBinding: 'node:fs/promises builtin',
    bindingKind: 'intrinsic',
    pathKind: 'string',
  });
  assert.equal(wrongModule.verdict, 'disproven');
});

test('fs.promises proof remains closed until await and JS scheduler facts are explicit', () => {
  const missingScheduler = proveNodeFsRule(database, 'promises.readFile.awaited', {
    moduleBinding: 'node:fs/promises builtin',
    bindingKind: 'intrinsic',
    directlyAwaited: true,
    optionsRepresentable: true,
    pathKind: 'string',
  });
  assert.equal(missingScheduler.verdict, 'unknown');

  const incompatible = proveNodeFsRule(database, 'promises.writeFile.awaited', {
    moduleBinding: 'node:fs/promises builtin',
    bindingKind: 'intrinsic',
    directlyAwaited: true,
    promiseSchedulerCompatible: false,
    optionsRepresentable: true,
    pathKind: 'string',
    dataKind: 'string',
  });
  assert.equal(incompatible.verdict, 'disproven');

  const proven = proveNodeFsRule(database, 'promises.readFile.awaited', {
    moduleBinding: 'node:fs/promises builtin',
    bindingKind: 'intrinsic',
    directlyAwaited: true,
    promiseSchedulerCompatible: true,
    optionsRepresentable: true,
    pathKind: 'string',
  });
  assert.equal(proven.verdict, 'proven');
  assert.equal(proven.helper, 'NodeFsPromises.ReadFileAsync');

  const unsupportedPath = proveNodeFsRule(database, 'existsSync', {
    moduleBinding: 'node:fs builtin',
    bindingKind: 'intrinsic',
    pathKind: 'other',
  });
  assert.equal(unsupportedPath.verdict, 'disproven');
});
