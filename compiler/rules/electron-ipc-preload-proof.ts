import { Facts, type FactModel } from '../analysis/facts.js';
import { fail } from '../diagnostics/index.js';
import type { LoadedRule, RuleDatabase, Strategy } from './loader.js';
import { evaluate, type Predicate, type Proof, type Verdict } from './requirements.js';

export const ELECTRON_IPC_PRELOAD_RULE_DB_COMMIT = '35ca8d859f9352e90ee2497f4ac8f6edb9c19ed1';

export interface ElectronIpcPreloadRuleSpec {
  readonly ruleId: string;
  readonly file: string;
  readonly sha256: string;
  readonly category: 'electron.ipc' | 'electron_preload_context';
  readonly strategy: Strategy;
  readonly targetKind: 'runtime' | 'helper';
  readonly helper?: string;
  readonly runtimeContract: string;
  readonly operation: string;
}

export const ELECTRON_IPC_PRELOAD_RULES: readonly ElectronIpcPreloadRuleSpec[] = [
  {
    ruleId: 'electron.ipcmain.on',
    file: 'rules/electron/ipc/on.json',
    sha256: '74b9ece4d20323f472b14b5a4be6053608361066d2939a28b6a3dc238d18965d',
    category: 'electron.ipc',
    strategy: 'runtime',
    targetKind: 'runtime',
    runtimeContract: 'ElectronCompat.IpcMain.On',
    operation: 'ipc.main.on',
  },
  {
    ruleId: 'electron.ipcrenderer.send',
    file: 'rules/electron/ipc/send.json',
    sha256: '107aec6ccb78af9f395c55920b0e5a2d8d75ba03e8eabb70996f013c61aef0aa',
    category: 'electron.ipc',
    strategy: 'runtime',
    targetKind: 'runtime',
    runtimeContract: 'ElectronCompat.IpcRenderer.Send',
    operation: 'ipc.renderer.send',
  },
  {
    ruleId: 'electron.ipcmain.handle',
    file: 'rules/electron/ipc/handle.json',
    sha256: 'd7ef57784b7020923f6a6373c99015cba8719aed5823b26faf7fd3caf9577eef',
    category: 'electron.ipc',
    strategy: 'runtime',
    targetKind: 'runtime',
    runtimeContract: 'ElectronCompat.IpcMain.Handle',
    operation: 'ipc.main.handle',
  },
  {
    ruleId: 'electron.ipcrenderer.invoke',
    file: 'rules/electron/ipc/invoke.json',
    sha256: '7263b13811a8971da163fa01c7460018f3f30b7809dc99ef93950ff2df6ff125',
    category: 'electron.ipc',
    strategy: 'runtime',
    targetKind: 'runtime',
    runtimeContract: 'ElectronCompat.IpcRenderer.InvokeAsync',
    operation: 'ipc.renderer.invoke',
  },
  {
    ruleId: 'electron.ipcrenderer.sendsync',
    file: 'rules/electron/ipc/sendsync.json',
    sha256: 'cf221bb50ef4163c97362413f0de180a28730e54f2a01bb2478b6bcff2e6970f',
    category: 'electron.ipc',
    strategy: 'runtime',
    targetKind: 'runtime',
    runtimeContract: 'ElectronCompat.IpcRenderer.SendSync',
    operation: 'ipc.renderer.sendSync',
  },
  {
    ruleId: 'electron.ipcmain.handleonce',
    file: 'rules/electron/ipc/handleonce.json',
    sha256: '35be9f69d12c3470911fa6f6877d6dd3514245fb53c133090d61e4796ed06e1f',
    category: 'electron.ipc',
    strategy: 'runtime',
    targetKind: 'runtime',
    runtimeContract: 'ElectronCompat.IpcMain.HandleOnce',
    operation: 'ipc.main.handleOnce',
  },
  {
    ruleId: 'electron.ipcmain.removehandler',
    file: 'rules/electron/ipc/removehandler.json',
    sha256: 'a3677a537611406784bc550e4cee351b72f31bbecc866603ca2cc5d45e190156',
    category: 'electron.ipc',
    strategy: 'runtime',
    targetKind: 'runtime',
    runtimeContract: 'ElectronCompat.IpcMain.RemoveHandler',
    operation: 'ipc.main.removeHandler',
  },
  {
    ruleId: 'electron.preload.isolated-world',
    file: 'rules/electron_preload_context/preload-isolated-world.json',
    sha256: 'e2c8481dbded1505e62227b5eb516c5b03c177fe899dff07eb3a8b7752cae980',
    category: 'electron_preload_context',
    strategy: 'runtime',
    targetKind: 'runtime',
    runtimeContract: 'ElectronCompat.PreloadContext',
    operation: 'preload.isolatedWorld',
  },
  {
    ruleId: 'electron.preload.context-isolation-default',
    file: 'rules/electron_preload_context/preload-context-isolation-default.json',
    sha256: 'cf4ffa4a2c828a8f8133f112bf6323ad96e00c3be21cb5b92dc097e1ba50caa5',
    category: 'electron_preload_context',
    strategy: 'helper',
    targetKind: 'helper',
    helper: 'ElectronCompat.Preload.DefaultContextIsolation',
    runtimeContract: 'ElectronCompat.PreloadContext.ModernDefault',
    operation: 'preload.contextIsolationDefault',
  },
  {
    ruleId: 'electron.preload.bridge-required-for-window-api',
    file: 'rules/electron_preload_context/preload-bridge-required-for-window-api.json',
    sha256: '1d74d6660925a59ee4d00cb4473ad7f2499820af243cd18c0b848e0f0e089598',
    category: 'electron_preload_context',
    strategy: 'runtime',
    targetKind: 'runtime',
    runtimeContract: 'ElectronCompat.PreloadContext.ExposeInMainWorld',
    operation: 'preload.bridgeRequired',
  },
  {
    ruleId: 'electron.preload.ipc-wrapper-closure',
    file: 'rules/electron_preload_context/preload-ipc-wrapper-closure.json',
    sha256: 'b87f86312e9f28eca4f3fe311a318daccc5f72428d63e57aab13fbd64d1075a8',
    category: 'electron_preload_context',
    strategy: 'runtime',
    targetKind: 'runtime',
    runtimeContract: 'ElectronCompat.BridgeFunctionProxyValue',
    operation: 'preload.ipcWrapperClosure',
  },
  {
    ruleId: 'electron.contextbridge.expose-main-world',
    file: 'rules/electron_preload_context/contextbridge-expose-main-world.json',
    sha256: 'c750752a1e76ce4ca9a90be65abf39b501417649c0dfe41f34b79f188f09d1a6',
    category: 'electron_preload_context',
    strategy: 'runtime',
    targetKind: 'runtime',
    runtimeContract: 'ElectronCompat.ContextBridge.ExposeInMainWorld',
    operation: 'contextBridge.exposeMainWorld',
  },
  {
    ruleId: 'electron.contextbridge.nested-api',
    file: 'rules/electron_preload_context/contextbridge-nested-api.json',
    sha256: '2d876365f4c7723d07d4d61dc276fcfcd5ce49f2bfc3e042dddf49ba659aae4d',
    category: 'electron_preload_context',
    strategy: 'runtime',
    targetKind: 'runtime',
    runtimeContract: 'ElectronCompat.ContextBridge.CopyAndFreeze',
    operation: 'contextBridge.nestedApi',
  },
  {
    ruleId: 'electron.contextbridge.value-copy-freeze',
    file: 'rules/electron_preload_context/contextbridge-value-copy-freeze.json',
    sha256: '837a9368975aa6c52db93a58c12a46116be5185e63019a477173bec3cab7345e',
    category: 'electron_preload_context',
    strategy: 'runtime',
    targetKind: 'runtime',
    runtimeContract: 'ElectronCompat.ContextBridge.CopyAndFreeze',
    operation: 'contextBridge.valueCopyFreeze',
  },
  {
    ruleId: 'electron.contextbridge.arguments-copy',
    file: 'rules/electron_preload_context/contextbridge-arguments-copy.json',
    sha256: 'c8203884e2d06e06f769a8e28456f0ee45ffc6a4fc7385a08382c207e2e8c13b',
    category: 'electron_preload_context',
    strategy: 'runtime',
    targetKind: 'runtime',
    runtimeContract: 'ElectronCompat.BridgeFunctionProxyValue.InvokeAsync',
    operation: 'contextBridge.argumentsCopy',
  },
  {
    ruleId: 'electron.contextbridge.return-copy',
    file: 'rules/electron_preload_context/contextbridge-return-copy.json',
    sha256: '727f3df95621c91e20f0df1589c2b14fcdcb02754cddb5581458d6e742c1eb9f',
    category: 'electron_preload_context',
    strategy: 'runtime',
    targetKind: 'runtime',
    runtimeContract: 'ElectronCompat.ContextBridge.CopyAndFreeze',
    operation: 'contextBridge.returnCopy',
  },
  {
    ruleId: 'electron.contextbridge.ipc-renderer-restriction',
    file: 'rules/electron_preload_context/contextbridge-ipc-renderer-restriction.json',
    sha256: '05de470c80ebe7b5165e0b9d406ada822aa6fa41e32539e74134a00ff59269c4',
    category: 'electron_preload_context',
    strategy: 'runtime',
    targetKind: 'runtime',
    runtimeContract: 'ElectronCompat.ContextBridge.CopyAndFreeze',
    operation: 'contextBridge.ipcRendererRestriction',
  },
  {
    ruleId: 'electron.contextbridge.security-wrapper',
    file: 'rules/electron_preload_context/contextbridge-security-wrapper.json',
    sha256: '13f048c968dbf3ee6b4bd14e9e50a5f90fa388139ccfddf1efc1767c79605c10',
    category: 'electron_preload_context',
    strategy: 'helper',
    targetKind: 'helper',
    helper: 'ElectronCompat.ContextBridge.ValidateSafeWrapper',
    runtimeContract: 'ElectronCompat.ContextBridge.ValidateSafeWrapper',
    operation: 'contextBridge.securityWrapper',
  },
];

const byId = new Map(ELECTRON_IPC_PRELOAD_RULES.map(spec => [spec.ruleId, spec] as const));

function eq(fact: string, equals: string | number | boolean): Predicate {
  return { fact, equals };
}

function canonicalRequirement(key: string, value: unknown): Predicate {
  if (key === 'module_binding' && typeof value === 'string')
    return eq('electron.moduleBinding', value);
  if (key === 'builtin_not_overridden' && value === true)
    return eq('electron.memberIntegrity', 'pristine');
  if (key === 'main_process' && value === true)
    return eq('electron.process', 'main');
  if (key === 'renderer_process' && value === true)
    return eq('electron.process', 'renderer');
  if (key === 'electron_renderer_context' && value === true)
    return eq('electron.rendererContext', 'isolated-preload');
  return { unknown: 'Unrecognized Electron IPC/preload requirement ' + key + '=' + JSON.stringify(value) };
}

function backendPredicates(spec: ElectronIpcPreloadRuleSpec): Predicate[] {
  if (spec.category === 'electron.ipc') {
    const predicates: Predicate[] = [
      eq('electron.ipcRuntime', 'ElectronCompat.IpcRuntime.v1'),
      eq('electron.structuredClone', 'ElectronCompat.IpcValue.v1'),
    ];

    if (spec.operation === 'ipc.main.on' || spec.operation === 'ipc.renderer.send')
      predicates.push(eq('electron.ipcOrdering', 'fifo-task-queue'));

    if (spec.operation === 'ipc.main.handle' || spec.operation === 'ipc.renderer.invoke' ||
        spec.operation === 'ipc.main.handleOnce') {
      predicates.push(eq('electron.invokeCorrelation', 'request-reply-v1'));
      predicates.push(eq('electron.errorSerialization', 'remote-error-v1'));
    }

    if (spec.operation === 'ipc.renderer.sendSync')
      predicates.push(eq('electron.syncDispatch', 'explicit-blocking'));

    if (spec.operation === 'ipc.main.handleOnce')
      predicates.push(eq('electron.oneShot', 'remove-before-call'));

    return predicates;
  }

  const predicates: Predicate[] = [
    eq('electron.contextBridgeRuntime', 'ElectronCompat.ContextBridge.v1'),
  ];

  if (spec.operation !== 'preload.contextIsolationDefault')
    predicates.push(eq('electron.contextIsolation', true));

  if (spec.operation.startsWith('contextBridge.') ||
      spec.operation === 'preload.bridgeRequired' ||
      spec.operation === 'preload.ipcWrapperClosure')
    predicates.push(eq('electron.bridgeValueDomain', 'supported-tree-v1'));

  if (spec.operation === 'contextBridge.ipcRendererRestriction' ||
      spec.operation === 'preload.contextIsolationDefault')
    predicates.push(eq('electron.electronProfile', '29+'));

  if (spec.operation === 'preload.ipcWrapperClosure')
    predicates.push(eq('electron.bridgeClosureProxy', true));

  if (spec.operation === 'contextBridge.securityWrapper')
    predicates.push(eq('electron.bridgePolicy', 'channel-filtered'));

  return predicates;
}

function aggregate(checks: readonly Proof[]): Verdict {
  if (checks.some(check => check.verdict === 'disproven')) return 'disproven';
  if (checks.some(check => check.verdict === 'unknown')) return 'unknown';
  return 'proven';
}

function reviewedRule(database: RuleDatabase, spec: ElectronIpcPreloadRuleSpec): LoadedRule {
  const loaded = database.byId.get(spec.ruleId);
  if (!loaded) return fail('E_RULE_MISSING', 'Reviewed Electron IPC/preload rule is absent: ' + spec.ruleId);

  const normalizedFile = loaded.file.split('\\').join('/');
  if (normalizedFile !== spec.file)
    return fail('E_RULE_CONTRACT', 'Canonical Electron IPC/preload rule moved: ' + spec.ruleId);
  if (loaded.sha256 !== spec.sha256)
    return fail('E_RULE_CONTRACT', 'Canonical Electron IPC/preload rule changed: ' + spec.ruleId);
  if (loaded.rule.category !== spec.category || loaded.rule.strategy !== spec.strategy)
    return fail('E_RULE_CONTRACT', 'Canonical Electron IPC/preload category/strategy changed: ' + spec.ruleId);
  if (loaded.rule.target.kind !== spec.targetKind)
    return fail('E_RULE_CONTRACT', 'Canonical Electron IPC/preload target kind changed: ' + spec.ruleId);
  if (spec.helper !== undefined && loaded.rule.target.helper !== spec.helper)
    return fail('E_RULE_CONTRACT', 'Canonical Electron IPC/preload helper changed: ' + spec.ruleId);

  return loaded;
}

export interface ElectronIpcPreloadRuleProof {
  readonly ruleId: string;
  readonly runtimeContract: string;
  readonly verdict: Verdict;
  readonly checks: readonly Proof[];
}

export function proveElectronIpcPreloadRule(
  database: RuleDatabase,
  ruleId: string,
  facts: FactModel,
): ElectronIpcPreloadRuleProof {
  const spec = byId.get(ruleId);
  if (!spec) return fail('E_RULE_MISSING', 'No reviewed Electron IPC/preload adapter for ' + ruleId);

  const loaded = reviewedRule(database, spec);
  const predicates = [
    ...Object.entries(loaded.rule.source.requirements ?? {})
      .map(([key, value]) => canonicalRequirement(key, value)),
    ...backendPredicates(spec),
  ];
  const checks = predicates.map(predicate => evaluate(predicate, facts));
  return {
    ruleId,
    runtimeContract: spec.runtimeContract,
    verdict: aggregate(checks),
    checks,
  };
}

export function verifyElectronIpcPreloadRuleContracts(database: RuleDatabase): readonly LoadedRule[] {
  return ELECTRON_IPC_PRELOAD_RULES.map(spec => reviewedRule(database, spec));
}

function ipcRuntimeFacts(process: 'main' | 'renderer', moduleBinding: string): Facts {
  return new Facts()
    .prove('electron.moduleBinding', moduleBinding, 'Exact Electron builtin module binding')
    .prove('electron.memberIntegrity', 'pristine', 'Reviewed Electron member is unmodified')
    .prove('electron.process', process, 'Explicit Electron process role')
    .prove('electron.ipcRuntime', 'ElectronCompat.IpcRuntime.v1', 'Typed IPC routing/runtime contract')
    .prove('electron.structuredClone', 'ElectronCompat.IpcValue.v1', 'Typed structured-clone value layer')
    .prove('electron.ipcOrdering', 'fifo-task-queue', 'Deterministic event-loop task queue boundary')
    .prove('electron.invokeCorrelation', 'request-reply-v1', 'Request/reply correlation is runtime-owned')
    .prove('electron.errorSerialization', 'remote-error-v1', 'Main errors cross as serialized remote errors')
    .prove('electron.syncDispatch', 'explicit-blocking', 'sendSync remains a synchronous call boundary')
    .prove('electron.oneShot', 'remove-before-call', 'handleOnce is atomically removed before invocation');
}

export function electronIpcMainFacts(): Facts {
  return ipcRuntimeFacts('main', 'electron.ipcMain');
}

export function electronIpcRendererFacts(): Facts {
  return ipcRuntimeFacts('renderer', 'electron.ipcRenderer');
}

export function electronContextBridgeFacts(): Facts {
  return new Facts()
    .prove('electron.rendererContext', 'isolated-preload', 'Preload executes in an isolated Electron renderer world')
    .prove('electron.contextBridgeRuntime', 'ElectronCompat.ContextBridge.v1', 'Typed contextBridge runtime contract')
    .prove('electron.contextIsolation', true, 'Preload and page globals remain distinct')
    .prove('electron.bridgeValueDomain', 'supported-tree-v1', 'Only reviewed bridge value shapes are admitted')
    .prove('electron.electronProfile', '29+', 'Modern Electron profile with ipcRenderer bridge restriction')
    .prove('electron.bridgeClosureProxy', true, 'Exposed functions execute through source-world proxies')
    .prove('electron.bridgePolicy', 'channel-filtered', 'IPC wrapper policy restricts capabilities/channels');
}
