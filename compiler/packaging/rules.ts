import { loadRules, type RuleDatabase, type Strategy } from '../rules/loader.js';

export const PACKAGING_RULE_DB_COMMIT = '35ca8d859f9352e90ee2497f4ac8f6edb9c19ed1';

interface PackagingRuleContract {
  readonly ruleId: string;
  readonly strategy: Strategy;
  readonly helper: string;
  readonly requirements: Readonly<Record<string, string | boolean>>;
}

export interface PackagingRuleProof {
  readonly ruleId: string;
  readonly file: string;
  readonly sha256: string;
  readonly strategy: Strategy;
  readonly helper: string;
  readonly evidence: readonly string[];
}

export const PACKAGING_RULE_IDS = [
  'electron.app.getapppath',
  'electron.autoupdater.platform-support',
  'electron.autoupdater.set-feed-url',
  'electron.autoupdater.check-for-updates',
  'electron.autoupdater.event-downloaded',
  'electron.autoupdater.apply-next-launch',
  'electron.autoupdater.quit-and-install',
  'electron.autoupdater.windows-updater-selection',
  'electron.autoupdater.mac-signing',
] as const;

const CONTRACTS: readonly PackagingRuleContract[] = [
  {
    ruleId: 'electron.app.getapppath',
    strategy: 'helper',
    helper: 'ElectronCompat.App.GetAppPath',
    requirements: {
      module_binding: 'electron.app',
      builtin_not_overridden: true,
      main_process: true,
    },
  },
  {
    ruleId: 'electron.autoupdater.platform-support',
    strategy: 'runtime',
    helper: 'ElectronCompat.AutoUpdater.PlatformSupport',
    requirements: { electron_builtin_not_overridden: true },
  },
  {
    ruleId: 'electron.autoupdater.set-feed-url',
    strategy: 'runtime',
    helper: 'ElectronCompat.AutoUpdater.SetFeedURL',
    requirements: { electron_builtin_not_overridden: true },
  },
  {
    ruleId: 'electron.autoupdater.check-for-updates',
    strategy: 'runtime',
    helper: 'ElectronCompat.AutoUpdater.CheckForUpdates',
    requirements: { electron_builtin_not_overridden: true },
  },
  {
    ruleId: 'electron.autoupdater.event-downloaded',
    strategy: 'runtime',
    helper: 'ElectronCompat.AutoUpdater.OnEvent',
    requirements: { electron_builtin_not_overridden: true },
  },
  {
    ruleId: 'electron.autoupdater.apply-next-launch',
    strategy: 'runtime',
    helper: 'ElectronCompat.AutoUpdater.PersistDownloadedUpdate',
    requirements: { electron_builtin_not_overridden: true },
  },
  {
    ruleId: 'electron.autoupdater.quit-and-install',
    strategy: 'runtime',
    helper: 'ElectronCompat.AutoUpdater.QuitAndInstall',
    requirements: { electron_builtin_not_overridden: true },
  },
  {
    ruleId: 'electron.autoupdater.windows-updater-selection',
    strategy: 'runtime',
    helper: 'ElectronCompat.AutoUpdater.PlatformPreconditions',
    requirements: { electron_builtin_not_overridden: true },
  },
  {
    ruleId: 'electron.autoupdater.mac-signing',
    strategy: 'runtime',
    helper: 'ElectronCompat.AutoUpdater.PlatformPreconditions',
    requirements: { electron_builtin_not_overridden: true },
  },
];

function describe(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

export function provePackagingRuleContracts(database: RuleDatabase): readonly PackagingRuleProof[] {
  const proofs: PackagingRuleProof[] = [];
  for (const contract of CONTRACTS) {
    const loaded = database.byId.get(contract.ruleId);
    if (!loaded) throw new Error(`Canonical j2cs rule is missing: ${contract.ruleId}`);
    if (loaded.rule.strategy !== contract.strategy) {
      throw new Error(`Canonical j2cs rule ${contract.ruleId} changed strategy: expected ${contract.strategy}, got ${loaded.rule.strategy}`);
    }
    if (loaded.rule.target.helper !== contract.helper) {
      throw new Error(`Canonical j2cs rule ${contract.ruleId} changed helper: expected ${contract.helper}, got ${String(loaded.rule.target.helper)}`);
    }
    const actualRequirements = loaded.rule.source.requirements ?? {};
    const evidence: string[] = [];
    for (const [key, expected] of Object.entries(contract.requirements)) {
      const actual = actualRequirements[key];
      if (actual !== expected) {
        throw new Error(`Canonical j2cs rule ${contract.ruleId} requirement ${key} changed: expected ${describe(expected)}, got ${describe(actual)}`);
      }
      evidence.push(`${key}=${describe(expected)}`);
    }
    proofs.push({
      ruleId: contract.ruleId,
      file: loaded.file,
      sha256: loaded.sha256,
      strategy: loaded.rule.strategy,
      helper: contract.helper,
      evidence,
    });
  }
  return proofs;
}

export async function loadPackagingRuleProofs(ruleDbRoot: string): Promise<readonly PackagingRuleProof[]> {
  return provePackagingRuleContracts(await loadRules(ruleDbRoot));
}
