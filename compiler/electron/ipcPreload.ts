import { Facts, type FactModel } from '../analysis/facts.js';
import { fail } from '../diagnostics/index.js';
import type { LoadedRule, RuleDatabase } from '../rules/loader.js';
import { evaluate, type Predicate, type Proof, type Verdict } from '../rules/requirements.js';

export const ELECTRON_IPC_PRELOAD_RULE_DB_COMMIT = '35ca8d859f9352e90ee2497f4ac8f6edb9c19ed1';

export type ElectronIpcPreloadArea = 'ipc' | 'preload' | 'contextBridge';

export interface ElectronIpcPreloadRuleSpec {
  readonly ruleId: string;
  readonly sha256: string;
  readonly category: string;
  readonly strategy: 'helper' | 'runtime';
  readonly runtimeContract: string;
  readonly area: ElectronIpcPreloadArea;
  readonly needsArguments?: boolean;
  readonly needsCallback?: boolean;
  readonly needsBridgeValue?: boolean;
  readonly needsRestrictedPolicy?: boolean;
  readonly needsModernProfile?: boolean;
}

export const ELECTRON_IPC_PRELOAD_RULES: readonly ElectronIpcPreloadRuleSpec[] = [
  {
    ruleId: 'electron.ipcmain.handle',
    sha256: 'd7ef57784b7020923f6a6373c99015cba8719aed5823b26faf7fd3caf9577eef',
    category: 'electron.ipc',
    strategy: 'runtime',
    runtimeContract: 'IpcMain.Handle',
    area: 'ipc',
    needsCallback: true,
  },
  {
    ruleId: 'electron.ipcmain.handleonce',
    sha256: '35be9f69d12c3470911fa6f6877d6dd3514245fb53c133090d61e4796ed06e1f',
    category: 'electron.ipc',
    strategy: 'runtime',
    runtimeContract: 'IpcMain.HandleOnce',
    area: 'ipc',
    needsCallback: true,
  },
  {
    ruleId: 'electron.ipcmain.removehandler',
    sha256: 'a3677a537611406784bc550e4cee351b72f31bbecc866603ca2cc5d45e190156',
    category: 'electron.ipc',
    strategy: 'runtime',
    runtimeContract: 'IpcMain.RemoveHandler',
    area: 'ipc',
  },
  {
    ruleId: 'electron.ipcmain.on',
    sha256: '74b9ece4d20323f472b14b5a4be6053608361066d2939a28b6a3dc238d18965d',
    category: 'electron.ipc',
    strategy: 'runtime',
    runtimeContract: 'IpcMain.On',
    area: 'ipc',
    needsCallback: true,
  },
  {
    ruleId: 'electron.ipcrenderer.invoke',
    sha256: '7263b13811a8971da163fa01c7460018f3f30b7809dc99ef93950ff2df6ff125',
    category: 'electron.ipc',
    strategy: 'runtime',
    runtimeContract: 'IpcRenderer.InvokeAsync',
    area: 'ipc',
    needsArguments: true,
  },
  {
    ruleId: 'electron.ipcrenderer.send',
    sha256: '107aec6ccb78af9f395c55920b0e5a2d8d75ba03e8eabb70996f013c61aef0aa',
    category: 'electron.ipc',
    strategy: 'runtime',
    runtimeContract: 'IpcRenderer.Send',
    area: 'ipc',
    needsArguments: true,
  },
  {
    ruleId: 'electron.webcontents.send',
    sha256: 'e98d8c11fe4918a02d37da1d38d61a3d97e641a03e9c6c764a15ff3bf20d328e',
    category: 'electron.ipc',
    strategy: 'runtime',
    runtimeContract: 'IpcWebContents.Send',
    area: 'ipc',
    needsArguments: true,
  },
  {
    ruleId: 'electron.preload.isolated-world',
    sha256: 'e2c8481dbded1505e62227b5eb516c5b03c177fe899dff07eb3a8b7752cae980',
    category: 'electron_preload_context',
    strategy: 'runtime',
    runtimeContract: 'PreloadContext.CreateIsolated',
    area: 'preload',
  },
  {
    ruleId: 'electron.preload.context-isolation-default',
    sha256: 'cf4ffa4a2c828a8f8133f112bf6323ad96e00c3be21cb5b92dc097e1ba50caa5',
    category: 'electron_preload_context',
    strategy: 'helper',
    runtimeContract: 'Preload.DefaultContextIsolation',
    area: 'preload',
    needsModernProfile: true,
  },
  {
    ruleId: 'electron.contextbridge.expose-main-world',
    sha256: 'c750752a1e76ce4ca9a90be65abf39b501417649c0dfe41f34b79f188f09d1a6',
    category: 'electron_preload_context',
    strategy: 'runtime',
    runtimeContract: 'PreloadContext.ExposeInMainWorld',
    area: 'contextBridge',
    needsBridgeValue: true,
  },
  {
    ruleId: 'electron.contextbridge.security-wrapper',
    sha256: '13f048c968dbf3ee6b4bd14e9e50a5f90fa388139ccfddf1efc1767c79605c10',
    category: 'electron_preload_context',
    strategy: 'helper',
    runtimeContract: 'ContextBridge.ValidateSafeWrapper',
    area: 'contextBridge',
    needsCallback: true,
    needsRestrictedPolicy: true,
  },
  {
    ruleId: 'electron.contextbridge.ipc-renderer-restriction',
    sha256: '05de470c80ebe7b5165e0b9d406ada822aa6fa41e32539e74134a00ff59269c4',
    category: 'electron_preload_context',
    strategy: 'runtime',
    runtimeContract: 'ContextBridge.RejectRawIpcRenderer',
    area: 'contextBridge',
    needsModernProfile: true,
  },
];

export interface ElectronIpcPreloadProofContext {
  readonly moduleBinding?: string;
  readonly receiver?: string;
  readonly memberIntegrity?: 'pristine' | 'overridden';
  readonly process?: 'main' | 'renderer';
  readonly rendererContext?: boolean;
  readonly hostCapability?: boolean;
  readonly argumentsRepresentable?: boolean;
  readonly callbackRepresentable?: boolean;
  readonly bridgeValueRepresentable?: boolean;
  readonly bridgePolicyRestricted?: boolean;
  readonly modernElectronProfile?: boolean;
}

export interface ElectronIpcPreloadRuleProof {
  readonly ruleId: string;
  readonly runtimeContract: string;
  readonly verdict: Verdict;
  readonly checks: readonly Proof[];
  readonly facts: FactModel;
}

const byId = new Map(ELECTRON_IPC_PRELOAD_RULES.map(spec => [spec.ruleId, spec] as const));

function reviewedRule(database: RuleDatabase, spec: ElectronIpcPreloadRuleSpec): LoadedRule {
  const loaded = database.byId.get(spec.ruleId);
  if (!loaded) return fail('E_RULE_MISSING', 'Reviewed Electron IPC/preload rule is absent: ' + spec.ruleId);
  if (loaded.sha256 !== spec.sha256) {
    return fail(
      'E_RULE_CONTRACT',
      'Rule ' + spec.ruleId + ' changed; review the Electron IPC/preload adapter before enabling it.',
    );
  }
  if (loaded.rule.category !== spec.category || loaded.rule.strategy !== spec.strategy) {
    return fail('E_RULE_CONTRACT', 'Rule ' + spec.ruleId + ' no longer matches the reviewed category/strategy.');
  }
  return loaded;
}

function contextFacts(context: ElectronIpcPreloadProofContext): Facts {
  const facts = new Facts();
  if (context.moduleBinding !== undefined)
    facts.prove('electron.moduleBinding', context.moduleBinding, 'resolved Electron module binding');
  if (context.receiver !== undefined)
    facts.prove('electron.receiver', context.receiver, 'resolved Electron receiver identity');
  if (context.memberIntegrity !== undefined)
    facts.prove('electron.memberIntegrity', context.memberIntegrity, 'Electron member integrity analysis');
  if (context.process !== undefined)
    facts.prove('electron.process', context.process, 'Electron process-role analysis');
  if (context.rendererContext !== undefined)
    facts.prove('electron.rendererContext', context.rendererContext, 'Electron renderer/preload context analysis');
  if (context.hostCapability !== undefined)
    facts.prove('electron.ipcPreload.hostCapability', context.hostCapability, 'typed Electron IPC/preload host capability');
  if (context.argumentsRepresentable !== undefined)
    facts.prove('electron.ipc.argumentsRepresentable', context.argumentsRepresentable, 'structured-clone argument analysis');
  if (context.callbackRepresentable !== undefined)
    facts.prove('electron.ipc.callbackRepresentable', context.callbackRepresentable, 'typed callback identity/signature analysis');
  if (context.bridgeValueRepresentable !== undefined)
    facts.prove('electron.bridge.valueRepresentable', context.bridgeValueRepresentable, 'contextBridge value-shape analysis');
  if (context.bridgePolicyRestricted !== undefined)
    facts.prove('electron.bridge.policyRestricted', context.bridgePolicyRestricted, 'statically restricted wrapper policy');
  if (context.modernElectronProfile !== undefined)
    facts.prove('electron.profile.modern', context.modernElectronProfile, 'Electron 29+/modern profile evidence');
  return facts;
}

function requirementPredicate(key: string, value: unknown): Predicate {
  if (key === 'module_binding' && typeof value === 'string')
    return { fact: 'electron.moduleBinding', equals: value };
  if (key === 'receiver' && typeof value === 'string')
    return { fact: 'electron.receiver', equals: value };
  if (key === 'builtin_not_overridden' && value === true)
    return { fact: 'electron.memberIntegrity', equals: 'pristine' };
  if (key === 'main_process' && value === true)
    return { fact: 'electron.process', equals: 'main' };
  if (key === 'renderer_process' && value === true)
    return { fact: 'electron.process', equals: 'renderer' };
  if (key === 'electron_renderer_context' && value === true)
    return { fact: 'electron.rendererContext', equals: true };
  return { unknown: 'Unrecognized Electron IPC/preload requirement ' + key + '=' + JSON.stringify(value) };
}

function aggregate(checks: readonly Proof[]): Verdict {
  if (checks.some(check => check.verdict === 'disproven')) return 'disproven';
  if (checks.some(check => check.verdict === 'unknown')) return 'unknown';
  return 'proven';
}

function backendPredicates(spec: ElectronIpcPreloadRuleSpec): Predicate[] {
  const predicates: Predicate[] = [{ fact: 'electron.ipcPreload.hostCapability', equals: true }];
  if (spec.needsArguments) predicates.push({ fact: 'electron.ipc.argumentsRepresentable', equals: true });
  if (spec.needsCallback) predicates.push({ fact: 'electron.ipc.callbackRepresentable', equals: true });
  if (spec.needsBridgeValue) predicates.push({ fact: 'electron.bridge.valueRepresentable', equals: true });
  if (spec.needsRestrictedPolicy) predicates.push({ fact: 'electron.bridge.policyRestricted', equals: true });
  if (spec.needsModernProfile) predicates.push({ fact: 'electron.profile.modern', equals: true });
  return predicates;
}

export function proveElectronIpcPreloadRule(
  database: RuleDatabase,
  ruleId: string,
  context: ElectronIpcPreloadProofContext,
): ElectronIpcPreloadRuleProof {
  const spec = byId.get(ruleId);
  if (!spec) return fail('E_RULE_MISSING', 'No reviewed Electron IPC/preload adapter for ' + ruleId);
  const loaded = reviewedRule(database, spec);
  const facts = contextFacts(context);
  const canonical = Object.entries(loaded.rule.source.requirements ?? {})
    .map(([key, value]) => requirementPredicate(key, value));
  const checks = [...canonical, ...backendPredicates(spec)].map(predicate => evaluate(predicate, facts));
  return {
    ruleId: spec.ruleId,
    runtimeContract: spec.runtimeContract,
    verdict: aggregate(checks),
    checks,
    facts,
  };
}

export function validateElectronIpcPreloadRuleContracts(database: RuleDatabase): readonly LoadedRule[] {
  return ELECTRON_IPC_PRELOAD_RULES.map(spec => reviewedRule(database, spec));
}
