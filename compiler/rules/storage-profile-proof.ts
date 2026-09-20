import { fail } from '../diagnostics/index.js';
import type { RuleDatabase, Strategy } from './loader.js';

export type StorageProfileRuleId =
  | 'dom.storage.local.get'
  | 'dom.storage.session.get'
  | 'dom.storage.get-item'
  | 'dom.storage.set-item'
  | 'dom.storage.remove-item'
  | 'dom.storage.clear'
  | 'electron.session.from-partition'
  | 'electron.session.is-persistent'
  | 'electron.session.storage-path'
  | 'electron.cookies.session-isolation'
  | 'electron.cookies.flush-store'
  | 'electron.session.flush-storage-data'
  | 'web.indexeddb.open'
  | 'web.caches.storage-key-boundary'
  | 'web.caches.open';

type ProofFact =
  | 'windowReceiver'
  | 'storageReceiver'
  | 'webStorageBackend'
  | 'webMemberIntegrity'
  | 'electronBinding'
  | 'electronMemberIntegrity'
  | 'mainProcess'
  | 'appReady'
  | 'indexedDbIntrinsic'
  | 'cacheStorageIntrinsic'
  | 'storagePartitioning'
  | 'secureContext';

export interface Evidence<T extends string> {
  value: T;
  evidence: string;
}

export interface StorageProfileProofFacts {
  windowReceiver?: Evidence<'Window' | 'other'>;
  storageReceiver?: Evidence<'Storage' | 'other'>;
  webStorageBackend?: Evidence<'native' | 'missing'>;
  webMemberIntegrity?: Evidence<'pristine' | 'mutated'>;
  electronBinding?: Evidence<'proven' | 'unproven'>;
  electronMemberIntegrity?: Evidence<'pristine' | 'mutated'>;
  mainProcess?: Evidence<'main' | 'renderer'>;
  appReady?: Evidence<'ready' | 'not-ready'>;
  indexedDbIntrinsic?: Evidence<'proven' | 'unproven'>;
  cacheStorageIntrinsic?: Evidence<'proven' | 'unproven'>;
  storagePartitioning?: Evidence<'observable' | 'collapsed'>;
  secureContext?: Evidence<'secure' | 'insecure'>;
}

export interface StorageProfileRuleContract {
  id: StorageProfileRuleId;
  sha256: string;
  strategy: Strategy;
  targetKind: string;
  targetHelper?: string;
  requirements: Readonly<Record<string, unknown>>;
  requires: readonly ProofFact[];
}

export interface StorageProfileRuleProof {
  id: StorageProfileRuleId;
  verdict: 'proven' | 'disproven' | 'unknown';
  evidence: readonly string[];
}

export const STORAGE_PROFILE_RULE_CONTRACTS: readonly StorageProfileRuleContract[] = [
  {
    id: 'dom.storage.local.get',
    sha256: '7fa506d536778854513cc60e3616c839a288e39ad11e5c64f26f5d84c9a1adad',
    strategy: 'helper',
    targetKind: 'helper',
    targetHelper: 'WebStorage.GetLocalStorage',
    requirements: { receiver_inferred_as: 'Window', native_web_storage_backend: true },
    requires: ['windowReceiver', 'webStorageBackend'],
  },
  {
    id: 'dom.storage.session.get',
    sha256: 'ba3a475b75cc80303a5250dc6bec9e39261c5c511e6d8f8f2a3480acf8ed3ff3',
    strategy: 'helper',
    targetKind: 'helper',
    targetHelper: 'WebStorage.GetSessionStorage',
    requirements: { receiver_inferred_as: 'Window', native_web_storage_backend: true },
    requires: ['windowReceiver', 'webStorageBackend'],
  },
  {
    id: 'dom.storage.get-item',
    sha256: '432b5e8659f9f3d7f0714c5ef8e79f071967e3b58507c84c1402a9f361838bc3',
    strategy: 'helper',
    targetKind: 'helper',
    targetHelper: 'WebStorage.GetItem',
    requirements: {
      receiver_inferred_as: 'Storage',
      builtin_webidl_member_not_overridden: true,
      native_web_storage_backend: true,
    },
    requires: ['storageReceiver', 'webMemberIntegrity', 'webStorageBackend'],
  },
  {
    id: 'dom.storage.set-item',
    sha256: 'f88d72d700b5d6aed558657be75ada6f3dee228b355e880f626b79c35a871e9a',
    strategy: 'helper',
    targetKind: 'helper',
    targetHelper: 'WebStorage.SetItem',
    requirements: {
      receiver_inferred_as: 'Storage',
      builtin_webidl_member_not_overridden: true,
      native_web_storage_backend: true,
    },
    requires: ['storageReceiver', 'webMemberIntegrity', 'webStorageBackend'],
  },
  {
    id: 'dom.storage.remove-item',
    sha256: '43115dec1a648e059b07e7fe00659fa67609b212f3136250f2b00a7a501c4b4d',
    strategy: 'helper',
    targetKind: 'helper',
    targetHelper: 'WebStorage.RemoveItem',
    requirements: {
      receiver_inferred_as: 'Storage',
      builtin_webidl_member_not_overridden: true,
      native_web_storage_backend: true,
    },
    requires: ['storageReceiver', 'webMemberIntegrity', 'webStorageBackend'],
  },
  {
    id: 'dom.storage.clear',
    sha256: 'e29a0c3508d3c5f2fd4d4dc43ab68caed66bc58ac64b12f941f75f2621386b96',
    strategy: 'helper',
    targetKind: 'helper',
    targetHelper: 'WebStorage.Clear',
    requirements: {
      receiver_inferred_as: 'Storage',
      builtin_webidl_member_not_overridden: true,
      native_web_storage_backend: true,
    },
    requires: ['storageReceiver', 'webMemberIntegrity', 'webStorageBackend'],
  },
  {
    id: 'electron.session.from-partition',
    sha256: 'f93e4199c32f134d037c4f782b7fca2984a6f0f108047edbb0cb124873f7a819',
    strategy: 'helper',
    targetKind: 'helper',
    targetHelper: 'ElectronCompat.Session.FromPartition',
    requirements: {
      electron_binding_proven: true,
      builtin_not_overridden: true,
      main_process: true,
      app_ready: true,
    },
    requires: ['electronBinding', 'electronMemberIntegrity', 'mainProcess', 'appReady'],
  },
  {
    id: 'electron.session.is-persistent',
    sha256: 'ddeceb730616a83a8f4ee3ee98899e244e65637cb58cc7767a89559e451241f1',
    strategy: 'helper',
    targetKind: 'helper',
    targetHelper: 'ElectronCompat.Session.IsPersistent',
    requirements: {
      electron_binding_proven: true,
      builtin_not_overridden: true,
      main_process: true,
    },
    requires: ['electronBinding', 'electronMemberIntegrity', 'mainProcess'],
  },
  {
    id: 'electron.session.storage-path',
    sha256: 'd1c1aa78df784c5d4bf37e0225b2a0dcb730f71994a141224f4848a6b5b1970c',
    strategy: 'helper',
    targetKind: 'helper',
    targetHelper: 'ElectronCompat.Session.StoragePath',
    requirements: {
      electron_binding_proven: true,
      builtin_not_overridden: true,
      main_process: true,
    },
    requires: ['electronBinding', 'electronMemberIntegrity', 'mainProcess'],
  },
  {
    id: 'electron.cookies.session-isolation',
    sha256: '0434a5ee9beea1245b1cc9ce5402b0b1eac170d9a4e40dc691aa8f19371eab08',
    strategy: 'helper',
    targetKind: 'helper',
    targetHelper: 'ElectronCompat.Cookies.SessionIsolation',
    requirements: {
      electron_binding_proven: true,
      builtin_not_overridden: true,
      main_process: true,
    },
    requires: ['electronBinding', 'electronMemberIntegrity', 'mainProcess'],
  },
  {
    id: 'electron.cookies.flush-store',
    sha256: 'e374c534d47dfb654d29c3122e803f11bf8d87fda312f22af85a08ba9227b018',
    strategy: 'helper',
    targetKind: 'helper',
    targetHelper: 'ElectronCompat.Cookies.FlushStore',
    requirements: {
      electron_binding_proven: true,
      builtin_not_overridden: true,
      main_process: true,
    },
    requires: ['electronBinding', 'electronMemberIntegrity', 'mainProcess'],
  },
  {
    id: 'electron.session.flush-storage-data',
    sha256: '9f58f48b635b5a02e91730855aed9c8ac6fc17f5f81598beba4606967d5312d6',
    strategy: 'helper',
    targetKind: 'helper',
    targetHelper: 'ElectronCompat.Session.FlushStorageData',
    requirements: {
      electron_binding_proven: true,
      builtin_not_overridden: true,
      main_process: true,
    },
    requires: ['electronBinding', 'electronMemberIntegrity', 'mainProcess'],
  },
  {
    id: 'web.indexeddb.open',
    sha256: 'cd94e89f8fef541101cbe32c0806d3097b1fac395bbc90acb71ac1e905b620ec',
    strategy: 'runtime',
    targetKind: 'runtime',
    requirements: { intrinsic_indexeddb_api: true, builtin_not_overridden: true },
    requires: ['indexedDbIntrinsic', 'webMemberIntegrity'],
  },
  {
    id: 'web.caches.storage-key-boundary',
    sha256: 'fe53a4287e2396c8de44f616f2b4676592a7fca7f722448d25e11f1c4dd0f3e6',
    strategy: 'runtime',
    targetKind: 'runtime',
    targetHelper: 'JsRuntime.WebCacheStorageForGlobal',
    requirements: {
      semantic_operation: 'obtain cache storage for global',
      storage_partitioning_observable: true,
    },
    requires: ['storagePartitioning'],
  },
  {
    id: 'web.caches.open',
    sha256: 'd60cb26ce6a86d8a91a1994ea219e4bc1172768f10802a7d0c3cf65aae70bc46',
    strategy: 'runtime',
    targetKind: 'runtime',
    targetHelper: 'JsRuntime.WebCachesOpen',
    requirements: {
      receiver_is_intrinsic_cache_storage: true,
      builtin_not_overridden: true,
      secure_context: true,
    },
    requires: ['cacheStorageIntrinsic', 'webMemberIntegrity', 'secureContext'],
  },
] as const;

const contracts = new Map<StorageProfileRuleId, StorageProfileRuleContract>(
  STORAGE_PROFILE_RULE_CONTRACTS.map(contract => [contract.id, contract])
);

function stable(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => JSON.stringify(key) + ':' + stable(item));
    return '{' + entries.join(',') + '}';
  }
  return JSON.stringify(value) ?? 'undefined';
}

function checkFact(name: ProofFact, facts: StorageProfileProofFacts): {
  verdict: 'proven' | 'disproven' | 'unknown';
  evidence: string;
} {
  const unknown = (message: string) => ({ verdict: 'unknown' as const, evidence: message });
  const checked = <T extends string>(
    fact: Evidence<T> | undefined,
    expected: T,
    message: string
  ) => !fact
    ? unknown(message)
    : ({ verdict: fact.value === expected ? 'proven' as const : 'disproven' as const, evidence: fact.evidence });

  switch (name) {
    case 'windowReceiver': return checked(facts.windowReceiver, 'Window', 'No proof that the receiver is the intrinsic Window.');
    case 'storageReceiver': return checked(facts.storageReceiver, 'Storage', 'No proof that the receiver is a Web Storage object.');
    case 'webStorageBackend': return checked(facts.webStorageBackend, 'native', 'No native Web Storage backend proof.');
    case 'webMemberIntegrity': return checked(facts.webMemberIntegrity, 'pristine', 'No proof that the Web API member is pristine.');
    case 'electronBinding': return checked(facts.electronBinding, 'proven', 'No proof of the Electron binding identity.');
    case 'electronMemberIntegrity': return checked(facts.electronMemberIntegrity, 'pristine', 'No proof that the Electron member is pristine.');
    case 'mainProcess': return checked(facts.mainProcess, 'main', 'No Electron main-process proof.');
    case 'appReady': return checked(facts.appReady, 'ready', 'No proof that Electron app readiness was reached.');
    case 'indexedDbIntrinsic': return checked(facts.indexedDbIntrinsic, 'proven', 'No intrinsic indexedDB proof.');
    case 'cacheStorageIntrinsic': return checked(facts.cacheStorageIntrinsic, 'proven', 'No intrinsic CacheStorage proof.');
    case 'storagePartitioning': return checked(facts.storagePartitioning, 'observable', 'No proof that storage partitioning remains observable.');
    case 'secureContext': return checked(facts.secureContext, 'secure', 'No secure-context proof.');
  }
}

export function proveStorageProfileRule(
  database: RuleDatabase,
  id: StorageProfileRuleId,
  facts: StorageProfileProofFacts
): StorageProfileRuleProof {
  const contract = contracts.get(id);
  if (!contract) return fail('E_RULE_MISSING', 'No reviewed storage/profile contract for ' + id + '.');

  const loaded = database.byId.get(id);
  if (!loaded) return fail('E_RULE_MISSING', 'Reviewed storage/profile rule is absent: ' + id);
  if (loaded.sha256 !== contract.sha256)
    return fail('E_RULE_CONTRACT', 'Rule ' + id + ' changed; review its storage/profile adapter before enabling it.');
  if (loaded.rule.strategy !== contract.strategy)
    return fail('E_RULE_CONTRACT', 'Rule ' + id + ' changed strategy from the reviewed contract.');
  if (loaded.rule.target.kind !== contract.targetKind)
    return fail('E_RULE_CONTRACT', 'Rule ' + id + ' changed target kind from the reviewed contract.');
  if (contract.targetHelper !== undefined && loaded.rule.target.helper !== contract.targetHelper)
    return fail('E_RULE_CONTRACT', 'Rule ' + id + ' changed helper target from the reviewed contract.');

  const requirements = loaded.rule.source.requirements ?? {};
  if (stable(requirements) !== stable(contract.requirements))
    return fail('E_RULE_CONTRACT', 'Rule ' + id + ' changed its reviewed requirement shape.');

  const checks = contract.requires.map(required => checkFact(required, facts));
  const verdict = checks.some(check => check.verdict === 'disproven')
    ? 'disproven'
    : checks.some(check => check.verdict === 'unknown') ? 'unknown' : 'proven';

  return { id, verdict, evidence: checks.map(check => check.evidence) };
}
