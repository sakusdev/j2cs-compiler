import { Facts, type FactModel } from '../analysis/facts.js';
import { fail } from '../diagnostics/index.js';
import type { LoadedRule, RuleDatabase } from '../rules/loader.js';
import { evaluate, type Predicate, type Proof, type Verdict } from '../rules/requirements.js';

export const ELECTRON_DESKTOP_RULE_DB_COMMIT = '35ca8d859f9352e90ee2497f4ac8f6edb9c19ed1';

export interface ElectronDesktopRuleSpec {
  readonly ruleId: string;
  readonly sha256: string;
  readonly category: string;
  readonly helper: string;
}

export const ELECTRON_DESKTOP_RULES: readonly ElectronDesktopRuleSpec[] = [
  {
    ruleId: 'electron.tray.constructor',
    sha256: 'd7ffb015373e6576b4d4c7dfe1e0153907b8d0ad2e42ac7f56ff955f98434d82',
    category: 'electron.tray',
    helper: 'ElectronCompat.Tray.Create',
  },
  {
    ruleId: 'electron.menu.append',
    sha256: '7826753b981940d9883877673a2fd9a782b3347250b0aea3129551ab67426e18',
    category: 'electron.menu',
    helper: 'ElectronCompat.Menu.Append',
  },
  {
    ruleId: 'electron.notification.show',
    sha256: '534551578a91e09e02d958b69cc93c2bac2c2f02aa6e25aaabe3e4522c68387d',
    category: 'electron.notification',
    helper: 'ElectronCompat.Notification.Show',
  },
  {
    ruleId: 'electron.clipboard.readtext',
    sha256: '1f3e6e2c557d130b9be2f2c254a36ecbed9c02f4f3a3447f1a571b7adefe0881',
    category: 'electron.clipboard',
    helper: 'ElectronCompat.Clipboard.ReadText',
  },
  {
    ruleId: 'electron.clipboard.writetext',
    sha256: 'a43f2da600f27a2c48e65daf837d552c683293dbe2bafe6b9a748ab6c3b8dbb5',
    category: 'electron.clipboard',
    helper: 'ElectronCompat.Clipboard.WriteText',
  },
  {
    ruleId: 'electron.dialog.showmessagebox',
    sha256: '69323623aed8557df0b295db2f58325c505b31f09db6030644eee6c71ede1b83',
    category: 'electron.dialog',
    helper: 'ElectronCompat.Dialog.ShowMessageBoxAsync',
  },
  {
    ruleId: 'electron.shell.openexternal',
    sha256: '698927ab454a5a463bce802b2c8e8ff80a953d97a6156c681c6dac60e19ab43d',
    category: 'electron.shell',
    helper: 'ElectronCompat.Shell.OpenExternalAsync',
  },
  {
    ruleId: 'electron.globalshortcut.register',
    sha256: 'b0fbaed4503d4cb551f9d9c0431932e43e77f260bf115e19f20277fe4c2c5bf4',
    category: 'electron.globalshortcut',
    helper: 'ElectronCompat.GlobalShortcut.Register',
  },
  {
    ruleId: 'electron.protocol.scheme-name',
    sha256: '5630a6f71f57e23d1c8309c34af672a9065a9992846fad0b3720850e8ff37377',
    category: 'electron_net_protocol',
    helper: 'ElectronCompat.Protocol.ValidateSchemeName',
  },
  {
    ruleId: 'electron.screen.getprimarydisplay',
    sha256: 'ee0ff002c39305aeed92d24753d9514a31c825127524317f3f12bc4202e20bca',
    category: 'electron.screen',
    helper: 'ElectronCompat.Screen.GetPrimaryDisplay',
  },
  {
    ruleId: 'electron.native-theme.themesource-write',
    sha256: 'e1c7919640cda0f9e25ea85872fe1ea7ae375a0c1408d0d7533461d7baa51454',
    category: 'electron.native-theme',
    helper: 'ElectronCompat.NativeTheme.SetThemeSource',
  },
  {
    ruleId: 'electron.power.powersave.start',
    sha256: '327e33916327908bb86a05b46d8806fddadac13f31134dfd8594d6771d695c70',
    category: 'electron.power',
    helper: 'ElectronCompat.PowerSaveBlocker.Start',
  },
];

export interface ElectronDesktopProofContext {
  readonly moduleBinding?: string;
  readonly receiver?: string;
  readonly memberIntegrity?: 'pristine' | 'overridden';
  readonly process?: 'main' | 'renderer';
  readonly appReady?: boolean;
  readonly electronProfile?: string;
  readonly hostCapability?: boolean;
  readonly argumentsRepresentable?: boolean;
}

export interface ElectronDesktopRuleProof {
  readonly ruleId: string;
  readonly helper: string;
  readonly verdict: Verdict;
  readonly checks: readonly Proof[];
  readonly facts: FactModel;
}

const byId = new Map(ELECTRON_DESKTOP_RULES.map(spec => [spec.ruleId, spec] as const));

function reviewedRule(database: RuleDatabase, spec: ElectronDesktopRuleSpec): LoadedRule {
  const loaded = database.byId.get(spec.ruleId);
  if (!loaded) return fail('E_RULE_MISSING', 'Reviewed Electron desktop rule is absent: ' + spec.ruleId);
  if (loaded.sha256 !== spec.sha256) {
    return fail(
      'E_RULE_CONTRACT',
      'Rule ' + spec.ruleId + ' changed; review the Electron desktop adapter before enabling it.',
    );
  }
  if (
    loaded.rule.category !== spec.category
    || loaded.rule.strategy !== 'helper'
    || loaded.rule.target.helper !== spec.helper
  ) {
    return fail('E_RULE_CONTRACT', 'Rule ' + spec.ruleId + ' no longer matches the reviewed Electron desktop helper contract.');
  }
  return loaded;
}

function contextFacts(context: ElectronDesktopProofContext): Facts {
  const facts = new Facts();
  if (context.moduleBinding !== undefined) {
    facts.prove('electron.moduleBinding', context.moduleBinding, 'resolved Electron module binding');
  }
  if (context.receiver !== undefined) {
    facts.prove('electron.receiver', context.receiver, 'resolved Electron receiver kind');
  }
  if (context.memberIntegrity !== undefined) {
    facts.prove('electron.memberIntegrity', context.memberIntegrity, 'Electron builtin/member integrity analysis');
  }
  if (context.process !== undefined) {
    facts.prove('electron.process', context.process, 'Electron process-role analysis');
  }
  if (context.appReady !== undefined) {
    facts.prove('electron.appReady', context.appReady, 'Electron app lifecycle analysis');
  }
  if (context.electronProfile !== undefined) {
    facts.prove('electron.profile', context.electronProfile, 'Electron compilation profile');
  }
  if (context.hostCapability !== undefined) {
    facts.prove('electron.desktop.hostCapability', context.hostCapability, 'desktop platform adapter capability');
  }
  if (context.argumentsRepresentable !== undefined) {
    facts.prove(
      'electron.desktop.argumentsRepresentable',
      context.argumentsRepresentable,
      'bounded desktop helper argument-shape analysis',
    );
  }
  return facts;
}

function requirementPredicate(key: string, value: unknown): Predicate {
  if (key === 'module_binding' && typeof value === 'string') {
    return { fact: 'electron.moduleBinding', equals: value };
  }
  if (key === 'receiver' && typeof value === 'string') {
    return { fact: 'electron.receiver', equals: value };
  }
  if ((key === 'builtin_not_overridden' || key === 'builtin_electron_member_not_overridden') && value === true) {
    return { fact: 'electron.memberIntegrity', equals: 'pristine' };
  }
  if (key === 'main_process' && value === true) {
    return { fact: 'electron.process', equals: 'main' };
  }
  if (key === 'app_ready' && value === true) {
    return { fact: 'electron.appReady', equals: true };
  }
  if (key === 'electron_app_profile' && typeof value === 'string') {
    return { fact: 'electron.profile', equals: value };
  }
  return { unknown: 'Unrecognized Electron desktop requirement ' + key + '=' + JSON.stringify(value) };
}

function aggregate(checks: readonly Proof[]): Verdict {
  if (checks.some(check => check.verdict === 'disproven')) return 'disproven';
  if (checks.some(check => check.verdict === 'unknown')) return 'unknown';
  return 'proven';
}

export function proveElectronDesktopRule(
  database: RuleDatabase,
  ruleId: string,
  context: ElectronDesktopProofContext,
): ElectronDesktopRuleProof {
  const spec = byId.get(ruleId);
  if (!spec) return fail('E_RULE_MISSING', 'No reviewed Electron desktop adapter for ' + ruleId);
  const loaded = reviewedRule(database, spec);
  const facts = contextFacts(context);
  const canonical = Object.entries(loaded.rule.source.requirements ?? {})
    .map(([key, value]) => requirementPredicate(key, value));
  const backend: Predicate[] = [
    { fact: 'electron.desktop.hostCapability', equals: true },
    { fact: 'electron.desktop.argumentsRepresentable', equals: true },
  ];
  const checks = [...canonical, ...backend].map(predicate => evaluate(predicate, facts));
  return { ruleId: spec.ruleId, helper: spec.helper, verdict: aggregate(checks), checks, facts };
}

/**
 * Validate every reviewed canonical contract without claiming source-level lowering.
 * Module/app/callback integration remains fail-closed until its owning lanes merge.
 */
export function validateElectronDesktopRuleContracts(database: RuleDatabase): readonly LoadedRule[] {
  return ELECTRON_DESKTOP_RULES.map(spec => reviewedRule(database, spec));
}
