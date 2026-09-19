import { loadRules, type RuleDatabase, type Strategy } from '../rules/loader.js';

export const SECURITY_RULE_DB_COMMIT = '35ca8d859f9352e90ee2497f4ac8f6edb9c19ed1';

export type SecurityFactValue = string | boolean;
export type SecurityFacts = Readonly<Record<string, SecurityFactValue | undefined>>;
export type SecurityProofVerdict = 'proven' | 'unknown' | 'disproven';

interface SecurityRuleContract {
  readonly ruleId: string;
  readonly strategy: Strategy;
  readonly targetKind: string;
  readonly helper?: string;
  readonly template: string;
  readonly sha256: string;
  readonly requirements: Readonly<Record<string, SecurityFactValue>>;
}

export interface SecurityRuleProof {
  readonly ruleId: string;
  readonly file: string;
  readonly sha256: string;
  readonly strategy: Strategy;
  readonly targetKind: string;
  readonly helper?: string;
  readonly template: string;
  readonly requirements: Readonly<Record<string, SecurityFactValue>>;
}

export interface SecurityProofEvaluation {
  readonly ruleId: string;
  readonly verdict: SecurityProofVerdict;
  readonly evidence: readonly string[];
}

export const SECURITY_RULE_IDS = [
  'electron.contextbridge.expose-main-world',
  'electron.contextbridge.security-wrapper',
  'electron.ipcmain.handle',
  'electron.ipcrenderer.invoke',
  'electron.protocol.handler-path-security',
  'electron.webcontents.advanced.set-window-open-handler',
  'electron.webcontents.navigation.event-will-navigate',
  'electron.preload.node-integration-boundary',
] as const;

const CONTRACTS: readonly SecurityRuleContract[] = [
  {
    ruleId: 'electron.contextbridge.expose-main-world', strategy: 'runtime', targetKind: 'runtime',
    template: 'JsRuntime.ElectronContextBridgeExposeMainWorld($apiKey, $api)',
    sha256: 'c750752a1e76ce4ca9a90be65abf39b501417649c0dfe41f34b79f188f09d1a6',
    requirements: { electron_renderer_context: true },
  },
  {
    ruleId: 'electron.contextbridge.security-wrapper', strategy: 'helper', targetKind: 'helper',
    helper: 'ElectronCompat.ContextBridge.ValidateSafeWrapper',
    template: 'ElectronCompat.ContextBridge.ValidateSafeWrapper($api)',
    sha256: '13f048c968dbf3ee6b4bd14e9e50a5f90fa388139ccfddf1efc1767c79605c10',
    requirements: { electron_renderer_context: true },
  },
  {
    ruleId: 'electron.ipcmain.handle', strategy: 'runtime', targetKind: 'runtime',
    template: 'ElectronRuntime.Current.IpcMain.Handle($channel, $listener)',
    sha256: 'd7ef57784b7020923f6a6373c99015cba8719aed5823b26faf7fd3caf9577eef',
    requirements: { module_binding: 'electron.ipcMain', builtin_not_overridden: true, main_process: true },
  },
  {
    ruleId: 'electron.ipcrenderer.invoke', strategy: 'runtime', targetKind: 'runtime',
    template: 'await ElectronRuntime.Current.IpcRenderer.InvokeAsync($channel, $args)',
    sha256: '7263b13811a8971da163fa01c7460018f3f30b7809dc99ef93950ff2df6ff125',
    requirements: { module_binding: 'electron.ipcRenderer', builtin_not_overridden: true, renderer_process: true },
  },
  {
    ruleId: 'electron.protocol.handler-path-security', strategy: 'helper', targetKind: 'helper',
    helper: 'ElectronCompat.Protocol.RequireSafePathResolution',
    template: 'ElectronCompat.Protocol.RequireSafePathResolution($base, $requestUrl)',
    sha256: '87e0aa14ed9258a0040150eae00bc511ae95bb0dfdfdf7df8b0e4af2ca30a859',
    requirements: { electron_app_profile: 'current Electron', builtin_electron_member_not_overridden: true },
  },
  {
    ruleId: 'electron.webcontents.advanced.set-window-open-handler', strategy: 'runtime', targetKind: 'runtime',
    template: 'ElectronCompat.SetWindowOpenHandler($contents,$handler)',
    sha256: '67603bb3c5c2b75902eb50a33ae5dce348f698ff25eec4c272287d8fcf8f87d2',
    requirements: { receiver: 'Electron WebContents', builtin_not_overridden: true },
  },
  {
    ruleId: 'electron.webcontents.navigation.event-will-navigate', strategy: 'runtime', targetKind: 'runtime',
    template: 'ElectronCompat.OnWillNavigate($contents,$listener)',
    sha256: '8807370c65802e62fb9979ab209cc6ab51fa1889593a8b9a1640b1d72629929e',
    requirements: { receiver: 'Electron WebContents', builtin_not_overridden: true },
  },
  {
    ruleId: 'electron.preload.node-integration-boundary', strategy: 'runtime', targetKind: 'runtime',
    template: 'JsRuntime.ElectronPreloadSecurityProfile($webPreferences)',
    sha256: 'c774e86f5cfa9659d6e9a0015dfadfcb143cbc23b6c7bca349589b205b009c22',
    requirements: { electron_renderer_context: true },
  },
];

function scalar(value: unknown): value is SecurityFactValue {
  return typeof value === 'string' || typeof value === 'boolean';
}

function stableRequirements(value: Record<string, unknown>): Record<string, SecurityFactValue> {
  const result: Record<string, SecurityFactValue> = {};
  for (const key of Object.keys(value).sort()) {
    const current = value[key];
    if (!scalar(current)) throw new Error(`Canonical security requirement ${key} is not a reviewed scalar.`);
    result[key] = current;
  }
  return result;
}

function sameRequirements(actual: Record<string, unknown>, expected: Readonly<Record<string, SecurityFactValue>>): boolean {
  const normalized = stableRequirements(actual);
  const actualKeys = Object.keys(normalized);
  const expectedKeys = Object.keys(expected).sort();
  return actualKeys.length === expectedKeys.length && expectedKeys.every(key => normalized[key] === expected[key]);
}

export function proveSecurityRuleContracts(database: RuleDatabase): readonly SecurityRuleProof[] {
  return CONTRACTS.map(contract => {
    const loaded = database.byId.get(contract.ruleId);
    if (!loaded) throw new Error(`Canonical j2cs rule is missing: ${contract.ruleId}`);
    if (loaded.sha256 !== contract.sha256)
      throw new Error(`Canonical j2cs rule ${contract.ruleId} changed content: expected SHA-256 ${contract.sha256}, got ${loaded.sha256}`);
    if (loaded.rule.strategy !== contract.strategy)
      throw new Error(`Canonical j2cs rule ${contract.ruleId} changed strategy: expected ${contract.strategy}, got ${loaded.rule.strategy}`);
    if (loaded.rule.target.kind !== contract.targetKind)
      throw new Error(`Canonical j2cs rule ${contract.ruleId} changed target kind.`);
    if (loaded.rule.target.helper !== contract.helper)
      throw new Error(`Canonical j2cs rule ${contract.ruleId} changed helper.`);
    if (loaded.rule.target.template !== contract.template)
      throw new Error(`Canonical j2cs rule ${contract.ruleId} changed target template.`);
    const actualRequirements = loaded.rule.source.requirements ?? {};
    if (!sameRequirements(actualRequirements, contract.requirements))
      throw new Error(`Canonical j2cs rule ${contract.ruleId} changed requirements.`);
    return {
      ruleId: contract.ruleId,
      file: loaded.file,
      sha256: loaded.sha256,
      strategy: loaded.rule.strategy,
      targetKind: loaded.rule.target.kind,
      ...(contract.helper === undefined ? {} : { helper: contract.helper }),
      template: contract.template,
      requirements: { ...contract.requirements },
    };
  });
}

export async function loadSecurityRuleProofs(ruleDbRoot: string): Promise<readonly SecurityRuleProof[]> {
  return proveSecurityRuleContracts(await loadRules(ruleDbRoot));
}

export function evaluateSecurityRuleProof(proof: SecurityRuleProof, facts: SecurityFacts): SecurityProofEvaluation {
  const evidence: string[] = [];
  let hasUnknown = false;
  for (const [key, expected] of Object.entries(proof.requirements).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    const actual = facts[key];
    if (actual === undefined) {
      hasUnknown = true;
      evidence.push(`${key}=unknown`);
      continue;
    }
    if (actual !== expected) {
      evidence.push(`${key}=disproven`);
      return { ruleId: proof.ruleId, verdict: 'disproven', evidence };
    }
    evidence.push(`${key}=proven`);
  }
  return { ruleId: proof.ruleId, verdict: hasUnknown ? 'unknown' : 'proven', evidence };
}
