import { fail } from '../diagnostics/index.js';
import type { RuleDatabase, Strategy } from '../rules/loader.js';

export interface ModuleRuleProof {
  readonly ruleId: string;
  readonly sha256: string;
  readonly file: string;
  readonly strategy: Strategy;
}

interface Contract {
  readonly id: string;
  readonly strategy: Strategy;
  readonly requirementKeys: readonly string[];
}

export const MODULE_RULE_CONTRACTS: readonly Contract[] = [
  { id: 'modules.cjs.wrapper-bindings', strategy: 'runtime', requirementKeys: ['host', 'module_system'] },
  { id: 'modules.cjs.module-exports-assignment', strategy: 'helper', requirementKeys: ['host', 'module_system', 'module_binding_is_builtin_wrapper_parameter'] },
  { id: 'modules.cjs.exports-property-write', strategy: 'helper', requirementKeys: ['host', 'module_system', 'exports_binding_still_aliases_initial_module_exports'] },
  { id: 'modules.cjs.alias-break-after-module-exports-replacement', strategy: 'helper', requirementKeys: ['host', 'module_system', 'exports_not_rebound_after_module_exports_replacement'] },
  { id: 'modules.cjs.require-cache', strategy: 'runtime', requirementKeys: ['host', 'module_system', 'require_not_shadowed'] },
  { id: 'modules.cjs.require-cycle-partial-exports', strategy: 'runtime', requirementKeys: ['host', 'module_system', 'dependency_cycle_possible'] },
  { id: 'modules.cjs.require-resolution', strategy: 'runtime', requirementKeys: ['host', 'module_system', 'specifier_not_compile_time_intrinsic'] },
  { id: 'modules.interop.esm-import-commonjs-default', strategy: 'runtime', requirementKeys: ['host', 'importer', 'target'] },
  { id: 'modules.interop.esm-import-commonjs-named', strategy: 'runtime', requirementKeys: ['host', 'importer', 'target'] },
  { id: 'modules.interop.require-esm-synchronous', strategy: 'runtime', requirementKeys: ['host', 'caller', 'target', 'target_graph_synchronous'] },
  { id: 'modules.interop.require-esm-top-level-await-error', strategy: 'runtime', requirementKeys: ['host', 'caller', 'target', 'target_graph_contains_top_level_await'] },
  { id: 'node.module-resolution.package-exports-main', strategy: 'runtime', requirementKeys: ['host', 'package_exports_present'] },
  { id: 'node.module-resolution.package-exports-subpath', strategy: 'runtime', requirementKeys: ['package_exports_present', 'package_subpath'] },
  { id: 'node.module-resolution.package-exports-pattern', strategy: 'runtime', requirementKeys: ['exports_pattern'] },
  { id: 'node.module-resolution.conditional-exports-order', strategy: 'runtime', requirementKeys: ['conditional_exports'] },
  { id: 'node.module-resolution.package-imports', strategy: 'runtime', requirementKeys: ['specifier_starts_hash', 'inside_package_scope'] },
  { id: 'node.module-resolution.package-imports-pattern', strategy: 'runtime', requirementKeys: ['package_imports_pattern'] },
  { id: 'node.module-resolution.package-imports-external-target', strategy: 'runtime', requirementKeys: ['imports_target_external_package'] },
  { id: 'node.module-resolution.package-target-relative', strategy: 'runtime', requirementKeys: ['package_target_resolution'] },
  { id: 'node.module-resolution.import-require-conditions', strategy: 'runtime', requirementKeys: ['request_kind'] },
  { id: 'node.module-resolution.package-type', strategy: 'runtime', requirementKeys: ['file_extension', 'host'] },
] as const;

/**
 * Connect the compiler module subsystem to the canonical, pinned j2cs rule DB.
 *
 * This is intentionally not a lowering adapter: parser/linker syntax wiring belongs to
 * separate module lanes and must remain fail-closed until their facts exist. Instead,
 * every independently testable resolver/runtime capability records the exact loaded
 * upstream rule fingerprint and verifies the rule's proof surface before use.
 */
export function proveCanonicalModuleContracts(database: RuleDatabase): readonly ModuleRuleProof[] {
  return MODULE_RULE_CONTRACTS.map(contract => {
    const loaded = database.byId.get(contract.id);
    if (!loaded) fail('E_MODULE_RULE_MISSING', `Canonical j2cs module rule is absent: ${contract.id}`);
    if (loaded.rule.strategy !== contract.strategy) {
      fail('E_MODULE_RULE_CONTRACT', `Canonical j2cs rule ${contract.id} changed strategy from ${contract.strategy} to ${loaded.rule.strategy}.`);
    }
    const requirements = loaded.rule.source.requirements ?? {};
    for (const key of contract.requirementKeys) {
      if (!Object.prototype.hasOwnProperty.call(requirements, key)) {
        fail('E_MODULE_RULE_CONTRACT', `Canonical j2cs rule ${contract.id} no longer exposes required proof key "${key}".`);
      }
    }
    return {
      ruleId: contract.id,
      sha256: loaded.sha256,
      file: loaded.file,
      strategy: loaded.rule.strategy,
    };
  });
}
