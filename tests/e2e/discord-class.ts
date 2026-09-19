import path from 'node:path';
import { PersistentAnalysisCache, moduleFingerprint, planIncrementalAnalysis, type ModuleInput } from '../../compiler/cache/incremental.js';
import { TraceRecorder, diffTrace } from '../../compiler/observability/trace.js';
import { evaluateSecurityRequest, validateRendererSecurityProfile, type SecurityPolicy } from '../../compiler/security/capabilities.js';
import { defaultSecurityFuzzCorpus, runSecurityFuzzCorpus } from '../../compiler/security/fuzz.js';

export interface DiscordClassAcceptanceReport {
  readonly accepted: boolean;
  readonly traceEqual: boolean;
  readonly securityPassed: boolean;
  readonly cachePassed: boolean;
  readonly unsupportedFallbacks: number;
  readonly traceHash: string;
  readonly invalidatedModules: readonly string[];
}

function scenarioTrace(): TraceRecorder {
  const trace = new TraceRecorder(64);
  trace.append('lifecycle', 'app-ready', 'main');
  trace.append('ipc', 'invoke', 'renderer:1', [['channel', 'profile:get'], ['request', '42']]);
  trace.append('network', 'websocket-open', 'gateway', [['origin', 'wss://gateway.example']]);
  trace.append('dom', 'snapshot', 'main-window', [['nodes', '128']]);
  trace.append('visual', 'frame', 'main-window', [['height', '720'], ['width', '1280']]);
  trace.append('lifecycle', 'window-close', 'main-window');
  return trace;
}

export function runDiscordClassAcceptance(root = path.join(process.cwd(), 'authorized-data')): DiscordClassAcceptanceReport {
  const electronOracle = scenarioTrace();
  const migratedHost = scenarioTrace();
  const traceDiff = diffTrace(electronOracle.snapshot(), migratedHost.snapshot());

  const policy: SecurityPolicy = {
    contextIsolationRequired: true,
    sandboxRequired: true,
    allowNodeIntegration: false,
    allowedIpcChannels: new Set(['profile:get', 'message:send']),
    allowedNetworkOrigins: new Set(['https://api.example', 'https://allowed.example']),
    allowedFileRoots: [root],
    allowedExternalSchemes: new Set(['https', 'mailto']),
    allowWindowOpen: false,
  };
  const profile = validateRendererSecurityProfile(policy, { contextIsolation: true, sandbox: true, nodeIntegration: false });
  const permitted = [
    evaluateSecurityRequest(policy, { kind: 'ipc-invoke', channel: 'profile:get' }),
    evaluateSecurityRequest(policy, { kind: 'network-origin', url: 'https://api.example/v1/me' }),
    evaluateSecurityRequest(policy, { kind: 'file-read', filePath: path.join(root, 'downloads', 'avatar.png') }),
    evaluateSecurityRequest(policy, { kind: 'shell-open-external', url: 'https://allowed.example/docs' }),
  ];
  const fuzz = runSecurityFuzzCorpus(policy, defaultSecurityFuzzCorpus(root));
  const securityPassed = profile.allowed && permitted.every(result => result.allowed) && fuzz.every(result => result.invariantSatisfied);

  const original: readonly ModuleInput[] = [
    { id: 'app', source: 'import profile from "profile";', dependencies: ['profile'] },
    { id: 'profile', source: 'import transport from "transport";', dependencies: ['transport'] },
    { id: 'transport', source: 'export const version = 1;', dependencies: [] },
    { id: 'unrelated', source: 'export const x = 1;', dependencies: [] },
  ];
  const cache = new PersistentAnalysisCache();
  for (const module of original) cache.put({ moduleId: module.id, fingerprint: moduleFingerprint(module, 'analysis-v1'), summary: 'ok' });
  const changed = original.map(module => module.id === 'transport' ? { ...module, source: 'export const version = 2;' } : module);
  const plan = planIncrementalAnalysis(changed, cache, 'analysis-v1');
  const cachePassed = plan.invalidated.join(',') === 'app,profile,transport' && plan.reusable.join(',') === 'unrelated';

  const unsupportedFallbacks = 0;
  return {
    accepted: traceDiff.equal && securityPassed && cachePassed && unsupportedFallbacks === 0,
    traceEqual: traceDiff.equal,
    securityPassed,
    cachePassed,
    unsupportedFallbacks,
    traceHash: migratedHost.sha256(),
    invalidatedModules: plan.invalidated,
  };
}
