import path from 'node:path';
import type { FactModel } from '../analysis/facts.js';
import { Facts } from '../analysis/facts.js';
import { fail } from '../diagnostics/index.js';
import { loadRules, type Strategy } from '../rules/loader.js';
import { evaluateRequirements, type Predicate, type RequirementsProof } from '../rules/requirements.js';

export interface ElectronRuleContract {
  ruleId: string;
  file: string;
  sha256: string;
  strategy: Strategy;
  runtimeContract: string;
  canonicalPredicates: Predicate[];
  backendPredicates?: Predicate[];
}

const eq = (fact: string, equals: string | number | boolean): Predicate => ({ fact, equals });
const appRequirements = (): Predicate[] => [
  eq('electron.moduleBinding', 'electron.app'),
  eq('electron.memberIntegrity', 'pristine'),
  eq('electron.processKind', 'main'),
];
const windowRequirements = (nativeWindow = true): Predicate[] => [
  eq('electron.receiver', 'Electron BrowserWindow'),
  eq('electron.memberIntegrity', 'pristine'),
  eq('electron.processKind', 'main'),
  ...(nativeWindow ? [eq('electron.nativeWindowBackend', true)] : []),
];
const webContentsRequirements = (): Predicate[] => [
  eq('electron.receiver', 'Electron WebContents'),
  eq('electron.memberIntegrity', 'pristine'),
];

export const ELECTRON_RULE_CONTRACTS: readonly ElectronRuleContract[] = [
  {
    ruleId: 'electron.app.whenready',
    file: 'rules/electron/app/whenready.json',
    sha256: '67ddf45cfc221d33f0d3fcba00d91f39308734ccc69fd13b9752112f3b7bcf65',
    strategy: 'helper',
    runtimeContract: 'App.WhenReadyAsync',
    canonicalPredicates: appRequirements(),
  },
  {
    ruleId: 'electron.app.isready',
    file: 'rules/electron/app/isready.json',
    sha256: '8bb23cff42ac1f5ed4ee1ef6f13999b4b201b89e94ff2a48bce045994133c21b',
    strategy: 'helper',
    runtimeContract: 'App.IsReady',
    canonicalPredicates: appRequirements(),
  },
  {
    ruleId: 'electron.app.quit',
    file: 'rules/electron/app/quit.json',
    sha256: '61ad03e792fd18d1d1ecec3c91b0e68e2e4b41f45b1174823a71c2c2db8c2e7d',
    strategy: 'helper',
    runtimeContract: 'App.Quit',
    canonicalPredicates: appRequirements(),
  },
  {
    ruleId: 'electron.browserwindow.constructor',
    file: 'rules/electron/browserwindow/constructor.json',
    sha256: '0eada4021eb9446f20e339ff5500d9f4b37e33cece998f93738f88128210e891',
    strategy: 'helper',
    runtimeContract: 'BrowserWindow.Create',
    canonicalPredicates: [
      eq('electron.constructorBinding', 'electron.BrowserWindow'),
      eq('electron.memberIntegrity', 'pristine'),
      eq('electron.processKind', 'main'),
      eq('electron.nativeWindowBackend', true),
    ],
  },
  {
    ruleId: 'electron.browserwindow.show',
    file: 'rules/electron/browserwindow/show.json',
    sha256: 'e7db567ad4aba2bc73b139ba0ffc2a3252f287e76285694e35a781fa6f2e88a3',
    strategy: 'helper',
    runtimeContract: 'BrowserWindow.Show',
    canonicalPredicates: windowRequirements(),
  },
  {
    ruleId: 'electron.browserwindow.hide',
    file: 'rules/electron/browserwindow/hide.json',
    sha256: 'c30efb679a125f052a365ad9a9af780a085826b20b5f341dd327442eabce8490',
    strategy: 'helper',
    runtimeContract: 'BrowserWindow.Hide',
    canonicalPredicates: windowRequirements(),
  },
  {
    ruleId: 'electron.browserwindow.close',
    file: 'rules/electron/browserwindow/close.json',
    sha256: '8138d546c40cd86a0107bcc0ccb8351e55cc9fe256ba03e4e62e5b45be9a9f3a',
    strategy: 'helper',
    runtimeContract: 'BrowserWindow.Close',
    canonicalPredicates: windowRequirements(),
  },
  {
    ruleId: 'electron.browserwindow.loadurl',
    file: 'rules/electron/browserwindow/loadurl.json',
    sha256: '0163431f00af72d3e7b67cb15616bdb3ab63ff7e0177d52096dd2884b6e52f74',
    strategy: 'runtime',
    runtimeContract: 'BrowserWindow.LoadUrlAsync',
    canonicalPredicates: windowRequirements(false),
    backendPredicates: [eq('electron.rendererBackend', true)],
  },
  {
    ruleId: 'electron.webcontents.navigation.load-url',
    file: 'rules/electron/webcontents_advanced/navigation-load-url.json',
    sha256: '6e12c1724d423b1b5b7353f3b643d48175454d38be077e37b28f4270076addf5',
    strategy: 'runtime',
    runtimeContract: 'WebContents.LoadUrlAsync',
    canonicalPredicates: webContentsRequirements(),
    backendPredicates: [eq('electron.rendererBackend', true)],
  },
  {
    ruleId: 'electron.webcontents.navigation.event-did-finish-load',
    file: 'rules/electron/webcontents_advanced/navigation-event-did-finish-load.json',
    sha256: '4e5ccac63c6c3effc15ba6300b79fa8e49a4290ac200875e4de27a8813476e2d',
    strategy: 'runtime',
    runtimeContract: 'WebContents.DidFinishLoad',
    canonicalPredicates: webContentsRequirements(),
    backendPredicates: [eq('electron.rendererBackend', true)],
  },
  {
    ruleId: 'electron.webcontents.navigation.get-url',
    file: 'rules/electron/webcontents_advanced/navigation-get-url.json',
    sha256: 'c611f992288e8435418f45c1632a0ad563063b0794734b2756c7ce52e66b0208',
    strategy: 'runtime',
    runtimeContract: 'WebContents.GetUrl',
    canonicalPredicates: webContentsRequirements(),
    backendPredicates: [eq('electron.rendererBackend', true)],
  },
  {
    ruleId: 'electron.webcontents.executejavascript',
    file: 'rules/electron/webcontents/executejavascript.json',
    sha256: '395f0d25e08e5d341c8fb910d0e0a671ceb20451d3885620799cbb1eb159f9b9',
    strategy: 'unsupported',
    runtimeContract: 'WebContents.ExecuteJavaScriptAsync (explicit rejection)',
    canonicalPredicates: [
      ...webContentsRequirements(),
      eq('electron.dynamicCodeStaticallyReducible', false),
    ],
  },
];

export interface ElectronContractSelection {
  contract?: ElectronRuleContract;
  proof: RequirementsProof;
}

export class ElectronContractRegistry {
  private readonly byId: ReadonlyMap<string, ElectronRuleContract>;

  constructor(public readonly contracts: readonly ElectronRuleContract[]) {
    this.byId = new Map(contracts.map(contract => [contract.ruleId, contract] as const));
  }

  prove(ruleId: string, facts: FactModel): ElectronContractSelection {
    const contract = this.byId.get(ruleId);
    if (!contract) {
      return { proof: evaluateRequirements({}, facts, [{ unknown: 'No reviewed Electron adapter for ' + ruleId }]) };
    }
    const proof = evaluateRequirements({}, facts, [
      ...contract.canonicalPredicates,
      ...(contract.backendPredicates ?? []),
    ]);
    return { contract: proof.verdict === 'proven' ? contract : undefined, proof };
  }
}

export async function loadElectronContractRegistry(ruleDb: string): Promise<ElectronContractRegistry> {
  const database = await loadRules(ruleDb);
  for (const contract of ELECTRON_RULE_CONTRACTS) {
    const loaded = database.byId.get(contract.ruleId);
    if (!loaded) fail('E_ELECTRON_RULE_MISSING', 'Canonical Electron rule is absent: ' + contract.ruleId);
    if (loaded.file.split(path.sep).join('/') !== contract.file)
      fail('E_ELECTRON_RULE_CONTRACT', 'Canonical Electron rule moved: ' + contract.ruleId);
    if (loaded.sha256 !== contract.sha256)
      fail('E_ELECTRON_RULE_CONTRACT', 'Canonical Electron rule changed; review #43 adapter before enabling ' + contract.ruleId);
    if (loaded.rule.strategy !== contract.strategy)
      fail('E_ELECTRON_RULE_CONTRACT', 'Canonical Electron strategy changed; review #43 adapter before enabling ' + contract.ruleId);
  }
  return new ElectronContractRegistry(ELECTRON_RULE_CONTRACTS);
}

/**
 * Facts for the isolated Electron-main host contract. These are deliberately not
 * injected into the current Node-only compiler pipeline: module graph / Electron
 * binding analysis is owned by sibling lanes and remains fail-closed until merged.
 */
export function electronMainHostFacts(nativeWindowBackend: boolean, rendererBackend: boolean): Facts {
  return new Facts()
    .prove('profile.host', 'Electron', 'Explicit Electron main-process host contract')
    .prove('profile.electron', 'main-v1', 'Versioned Electron main-process compatibility profile')
    .prove('electron.processKind', 'main', 'Entry point is proven to execute in the Electron main process')
    .prove('electron.memberIntegrity', 'pristine', 'Reviewed Electron binding/member has not escaped or been overwritten')
    .prove('electron.nativeWindowBackend', nativeWindowBackend, 'Configured typed native-window backend capability')
    .prove('electron.rendererBackend', rendererBackend, 'Configured typed renderer/navigation backend capability');
}
