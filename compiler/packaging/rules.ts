import { loadRules, type RuleDatabase, type Strategy } from '../rules/loader.js';

export const PACKAGING_RULE_DB_COMMIT = '35ca8d859f9352e90ee2497f4ac8f6edb9c19ed1';

interface PackagingRuleContract {
  readonly ruleId: string;
  readonly strategy: Strategy;
  readonly helper: string;
  readonly sha256: string;
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
    sha256: 'b5c683719893df9694182ac2e015c9f1618e23b8b6ea90c7f4a78bf923a5693d',
    requirements: { module_binding: 'electron.app', builtin_not_overridden: true, main_process: true },
  },
  {
    ruleId: 'electron.autoupdater.platform-support',
    strategy: 'runtime',
    helper: 'ElectronCompat.AutoUpdater.PlatformSupport',
    sha256: '3cb632e63cc28ba135c94fbb3da06e7dc263d5e5c5996d34009e821b0106e345',
    requirements: { electron_builtin_not_overridden: true },
  },
  {
    ruleId: 'electron.autoupdater.set-feed-url',
    strategy: 'runtime',
    helper: 'ElectronCompat.AutoUpdater.SetFeedURL',
    sha256: '44e7df5946012acfa35e3ae41860cb33966db50399696c8429de63b453c22c49',
    requirements: { electron_builtin_not_overridden: true },
  },
  {
    ruleId: 'electron.autoupdater.check-for-updates',
    strategy: 'runtime',
    helper: 'ElectronCompat.AutoUpdater.CheckForUpdates',
    sha256: '6a3f6bd007c7712c690baf9023cb09b7ca5291b5fd748a07e6d6eebdf10b9cfb',
    requirements: { electron_builtin_not_overridden: true },
  },
  {
    ruleId: 'electron.autoupdater.event-downloaded',
    strategy: 'runtime',
    helper: 'ElectronCompat.AutoUpdater.OnEvent',
    sha256: '646e621948f7f7681463bfc622945eeb20386f2e417066d57c22de0df065e927',
    requirements: { electron_builtin_not_overridden: true },
  },
  {
    ruleId: 'electron.autoupdater.apply-next-launch',
    strategy: 'runtime',
    helper: 'ElectronCompat.AutoUpdater.PersistDownloadedUpdate',
    sha256: 'af87f9935bde0dafafb2057b49b455ba45bf8ba4587167bfb7456de5ae3c4976',
    requirements: { electron_builtin_not_overridden: true },
  },
  {
    ruleId: 'electron.autoupdater.quit-and-install',
    strategy: 'runtime',
    helper: 'ElectronCompat.AutoUpdater.QuitAndInstall',
    sha256: '4bb65214b20b7dea2a37dc5afeeec585dd92bb93adc6802b69fbc532b9091d13',
    requirements: { electron_builtin_not_overridden: true },
  },
  {
    ruleId: 'electron.autoupdater.windows-updater-selection',
    strategy: 'runtime',
    helper: 'ElectronCompat.AutoUpdater.PlatformPreconditions',
    sha256: 'd2ad1a0f9d0b2b816216c17abad3c62c6080d2e46ab221eedb615af9ecf76000',
    requirements: { electron_builtin_not_overridden: true },
  },
  {
    ruleId: 'electron.autoupdater.mac-signing',
    strategy: 'runtime',
    helper: 'ElectronCompat.AutoUpdater.PlatformPreconditions',
    sha256: 'f574ac7500cb14159c18859c111b020e0c03cd42adc3e27afbadbb1c3b5aeca0',
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
    if (loaded.sha256 !== contract.sha256) {
      throw new Error(`Canonical j2cs rule ${contract.ruleId} changed content: expected SHA-256 ${contract.sha256}, got ${loaded.sha256}`);
    }
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
