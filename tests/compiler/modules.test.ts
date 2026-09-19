import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, createCompiler } from '../../compiler/index.js';
import { CompileError } from '../../compiler/diagnostics/index.js';
import {
  classifyNodeModuleFormat,
  describeNodeInterop,
  ModuleResolutionError,
  resolvePackageExports,
  resolvePackageImports,
  type PackageTarget,
} from '../../compiler/modules/package-resolution.js';
import {
  MODULE_RULE_CONTRACTS,
  proveCanonicalModuleContracts,
} from '../../compiler/modules/proof.js';

const index = await createCompiler();

function expectResolutionError(action: () => unknown, code: ModuleResolutionError['code']): void {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof ModuleResolutionError);
    assert.equal(error.code, code);
    return true;
  });
}

test('module subsystem is connected to canonical pinned j2cs contracts', () => {
  const proofs = proveCanonicalModuleContracts(index.database);
  assert.equal(proofs.length, MODULE_RULE_CONTRACTS.length);
  assert.equal(new Set(proofs.map(proof => proof.ruleId)).size, proofs.length);
  for (const proof of proofs) {
    assert.match(proof.sha256, /^[0-9a-f]{64}$/);
    assert.match(proof.file, /^rules[\\/].*\.json$/);
    assert.ok(['helper', 'runtime'].includes(proof.strategy));
  }
});

test('package exports distinguish import/require and preserve condition insertion order', () => {
  const exportsTarget: PackageTarget = {
    '.': {
      import: './esm.mjs',
      require: './cjs.cjs',
      default: './fallback.js',
    },
    './feature/*': './src/features/*.js',
  };

  const imported = resolvePackageExports(exportsTarget, '.', 'import');
  assert.equal(imported.target, './esm.mjs');
  assert.deepEqual(imported.conditions.slice(0, 2), ['node', 'import']);
  assert.ok(imported.ruleIds.includes('node.module-resolution.package-exports-main'));
  assert.ok(imported.ruleIds.includes('node.module-resolution.import-require-conditions'));

  const required = resolvePackageExports(exportsTarget, '.', 'require');
  assert.equal(required.target, './cjs.cjs');

  const patterned = resolvePackageExports(exportsTarget, './feature/nested/x', 'require');
  assert.equal(patterned.target, './src/features/nested/x.js');
  assert.ok(patterned.ruleIds.includes('node.module-resolution.package-exports-pattern'));
  assert.ok(patterned.ruleIds.includes('node.module-resolution.package-target-relative'));

  const defaultFirst: PackageTarget = {
    '.': {
      default: './default.js',
      node: './node.js',
    },
  };
  assert.equal(resolvePackageExports(defaultFirst, '.', 'require').target, './default.js');
});

test('package exports reject unlisted and invalid targets with explicit Node-style codes', () => {
  expectResolutionError(
    () => resolvePackageExports({ '.': './index.js' }, './private.js', 'require'),
    'ERR_PACKAGE_PATH_NOT_EXPORTED',
  );
  expectResolutionError(
    () => resolvePackageExports({ '.': '../outside.js' }, '.', 'require'),
    'ERR_INVALID_PACKAGE_TARGET',
  );
  expectResolutionError(
    () => resolvePackageExports({ '.': './node_modules/x.js' }, '.', 'require'),
    'ERR_INVALID_PACKAGE_TARGET',
  );
  expectResolutionError(
    () => resolvePackageExports({ '.': './safe.js', default: './bad.js' }, '.', 'require'),
    'ERR_INVALID_PACKAGE_CONFIG',
  );
});

test('package imports support private patterns, conditions, and external package redirects', () => {
  const imports = {
    '#internal/*': './src/*.js',
    '#dep': {
      node: 'dep-node-native',
      default: 'dep-fallback',
    },
  } satisfies Readonly<Record<string, PackageTarget>>;

  const internal = resolvePackageImports(imports, '#internal/nested/x', 'import');
  assert.equal(internal.kind, 'package-file');
  assert.equal(internal.target, './src/nested/x.js');
  assert.ok(internal.ruleIds.includes('node.module-resolution.package-imports'));
  assert.ok(internal.ruleIds.includes('node.module-resolution.package-imports-pattern'));

  const external = resolvePackageImports(imports, '#dep', 'require');
  assert.equal(external.kind, 'external-package');
  assert.equal(external.target, 'dep-node-native');
  assert.ok(external.ruleIds.includes('node.module-resolution.package-imports-external-target'));

  expectResolutionError(
    () => resolvePackageImports(imports, '#missing', 'require'),
    'ERR_PACKAGE_IMPORT_NOT_DEFINED',
  );
  expectResolutionError(
    () => resolvePackageImports(imports, '#/', 'require'),
    'ERR_INVALID_MODULE_SPECIFIER',
  );
});

test('module format and ESM/CommonJS interop boundaries remain explicit and fail closed', () => {
  assert.equal(classifyNodeModuleFormat('/pkg/a.mjs', 'commonjs'), 'module');
  assert.equal(classifyNodeModuleFormat('/pkg/a.cjs', 'module'), 'commonjs');
  assert.equal(classifyNodeModuleFormat('/pkg/a.js', 'module'), 'module');
  assert.equal(classifyNodeModuleFormat('/pkg/a.js'), 'unknown');

  const defaultImport = describeNodeInterop({
    importer: 'module', target: 'commonjs', requestKind: 'import', importForm: 'default',
  });
  assert.equal(defaultImport.kind, 'runtime');
  assert.equal(defaultImport.ruleId, 'modules.interop.esm-import-commonjs-default');
  assert.equal(defaultImport.compileTimeBindingSafe, true);

  const namedImport = describeNodeInterop({
    importer: 'module', target: 'commonjs', requestKind: 'import', importForm: 'named',
  });
  assert.equal(namedImport.ruleId, 'modules.interop.esm-import-commonjs-named');
  assert.equal(namedImport.compileTimeBindingSafe, false);

  const unknownEsmGraph = describeNodeInterop({
    importer: 'commonjs', target: 'module', requestKind: 'require',
  });
  assert.equal(unknownEsmGraph.kind, 'unsupported');
  assert.equal(unknownEsmGraph.code, 'E_MODULE_GRAPH_ASYNC_UNKNOWN');

  const asyncEsmGraph = describeNodeInterop({
    importer: 'commonjs', target: 'module', requestKind: 'require',
    targetGraphContainsTopLevelAwait: true,
  });
  assert.equal(asyncEsmGraph.kind, 'error');
  assert.equal(asyncEsmGraph.code, 'ERR_REQUIRE_ASYNC_MODULE');
});

test('parser/linker entry paths owned by unmerged module lanes remain fail closed', () => {
  assert.throws(() => compile("const x = require('./x.cjs');", index), (error: unknown) => {
    assert.ok(error instanceof CompileError);
    assert.equal(error.diagnostic.code, 'E_UNRESOLVED_BINDING');
    return true;
  });

  assert.throws(() => compile("import x from './x.js'; console.log(x);", index), (error: unknown) => {
    assert.ok(error instanceof CompileError);
    assert.equal(error.diagnostic.code, 'E_UNSUPPORTED_SYNTAX');
    return true;
  });
});
