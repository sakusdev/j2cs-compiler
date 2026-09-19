export type BundleHost = 'node' | 'electron-renderer' | 'browser';
export type BundleFlavor = 'webpack-chunk' | 'vite-preload' | 'esm-code-split' | 'unknown';

export interface BundleDiagnostic {
  code: string;
  severity: 'warning' | 'error';
  message: string;
  offset?: number;
}

export interface DynamicImportFact {
  specifier?: string;
  offset: number;
}

export interface WebpackChunkFact {
  chunkIds: readonly string[];
  moduleFactoryCount: number;
  offset: number;
}

export interface PreloadFact {
  dependencies: readonly string[];
  offset: number;
}

export interface SourceMapProvenance {
  url: string;
  kind: 'external' | 'data';
  offset: number;
}

export interface BundleAnalysis {
  host: BundleHost;
  flavors: readonly BundleFlavor[];
  esmSyntax: boolean;
  dynamicImports: readonly DynamicImportFact[];
  webpackChunks: readonly WebpackChunkFact[];
  preloads: readonly PreloadFact[];
  reactRegisteredSymbols: readonly string[];
  usesObjectAssign: boolean;
  usesPromiseResolve: boolean;
  sourceMap?: SourceMapProvenance;
  requiredRuleIds: readonly string[];
  deferredCapabilities: readonly string[];
  diagnostics: readonly BundleDiagnostic[];
  canExecuteWithoutSiblingIntegration: boolean;
}

export interface CanonicalBundleRuleContract {
  ruleId: string;
  path: string;
  sha256: string;
  strategy: 'helper' | 'runtime';
  purpose: string;
}

export interface CanonicalRuleProof {
  contract: CanonicalBundleRuleContract;
  verdict: 'proven' | 'missing' | 'changed';
  evidence: readonly string[];
}
