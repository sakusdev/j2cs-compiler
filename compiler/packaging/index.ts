import { access, copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  loadPackagingRuleProofs,
  type PackagingRuleProof,
} from './rules.js';

export type PackagingPlatform = 'win32' | 'darwin' | 'linux';
export type PackagingArch = 'x64' | 'arm64';
export type PackagingFileKind = 'managed' | 'resource' | 'native';
export type WindowsPackaging = 'msix' | 'squirrel';
export type SigningStage = 'after-layout' | 'after-artifact';
export type UpdateMechanism = 'msix' | 'squirrel' | 'squirrel-mac' | 'none';

export interface PackagingFile {
  readonly source: string;
  readonly relativePath: string;
  readonly kind: PackagingFileKind;
}

export interface PackagingRequest {
  readonly appId: string;
  readonly appName: string;
  readonly version: string;
  readonly platform: PackagingPlatform;
  readonly arch: PackagingArch;
  readonly entryExecutable: string;
  readonly files: readonly PackagingFile[];
  readonly windowsPackaging?: WindowsPackaging;
  readonly signed?: boolean;
  readonly enableAutoUpdate?: boolean;
  readonly channel?: string;
}

export interface SigningHook {
  readonly id: 'windows-package-sign' | 'windows-executable-sign' | 'macos-codesign';
  readonly stage: SigningStage;
  readonly required: boolean;
  readonly commandHint: 'signtool' | 'codesign';
}

export interface UpdaterContract {
  readonly enabled: boolean;
  readonly supported: boolean;
  readonly mechanism: UpdateMechanism;
  readonly channel: string;
  readonly reason?: string;
  readonly rollback: {
    readonly mode: 'host-managed';
    readonly automatic: false;
    readonly note: string;
  };
}

export interface PackageMapping {
  readonly source: string;
  readonly destination: string;
  readonly kind: PackagingFileKind;
}

export interface PackagingPlan {
  readonly schemaVersion: 1;
  readonly appId: string;
  readonly appName: string;
  readonly version: string;
  readonly platform: PackagingPlatform;
  readonly arch: PackagingArch;
  readonly rid: string;
  readonly artifactFormat: 'portable' | 'msix' | 'squirrel' | 'app-bundle';
  readonly layout: {
    readonly bundleRoot: string;
    readonly managedRoot: string;
    readonly resourcesRoot: string;
    readonly electronAppPath: string;
    readonly nativeRoot: string;
    readonly entryExecutable: string;
  };
  readonly mappings: readonly PackageMapping[];
  readonly signingHooks: readonly SigningHook[];
  readonly updater: UpdaterContract;
  readonly ruleProofs: readonly PackagingRuleProof[];
}

const BASE_RULES = ['electron.app.getapppath'] as const;
const UPDATE_RULES = [
  'electron.autoupdater.platform-support',
  'electron.autoupdater.set-feed-url',
  'electron.autoupdater.check-for-updates',
  'electron.autoupdater.event-downloaded',
  'electron.autoupdater.apply-next-launch',
  'electron.autoupdater.quit-and-install',
] as const;

function safeSegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '.' || trimmed === '..' || /[\\/\0\r\n]/.test(trimmed)) {
    throw new Error(`${label} must be a non-empty path segment`);
  }
  return trimmed;
}

function relativeFile(value: string, label: string): string {
  const normalized = path.posix.normalize(value.replace(/\\/g, '/'));
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
    throw new Error(`${label} must stay inside the package layout`);
  }
  return normalized;
}

function joinBundle(...parts: string[]): string {
  return parts.filter(Boolean).join('/');
}

function ridFor(platform: PackagingPlatform, arch: PackagingArch): string {
  const os = platform === 'win32' ? 'win' : platform === 'darwin' ? 'osx' : 'linux';
  return `${os}-${arch}`;
}

function updaterContract(request: PackagingRequest): UpdaterContract {
  const enabled = request.enableAutoUpdate ?? false;
  const channel = safeSegment(request.channel ?? 'stable', 'channel');
  const rollback = {
    mode: 'host-managed' as const,
    automatic: false as const,
    note: 'Canonical Electron autoUpdater rules do not define rollback. Retain a previous artifact and require an explicit platform host action.',
  };
  if (!enabled) return { enabled, supported: false, mechanism: 'none', channel, reason: 'auto-update disabled by package request', rollback };
  if (request.platform === 'linux') {
    return {
      enabled,
      supported: false,
      mechanism: 'none',
      channel,
      reason: 'canonical electron.autoupdater.platform-support forbids silently emulating the built-in updater on Linux',
      rollback,
    };
  }
  if (request.platform === 'darwin') {
    if (!request.signed) {
      return {
        enabled,
        supported: false,
        mechanism: 'none',
        channel,
        reason: 'canonical electron.autoupdater.mac-signing requires a signed macOS application',
        rollback,
      };
    }
    return { enabled, supported: true, mechanism: 'squirrel-mac', channel, rollback };
  }
  if (!request.windowsPackaging) {
    throw new Error('windowsPackaging is required when Windows auto-update is enabled; the canonical rule selects behavior from packaging');
  }
  return {
    enabled,
    supported: true,
    mechanism: request.windowsPackaging,
    channel,
    rollback,
  };
}

function signingHooks(request: PackagingRequest): readonly SigningHook[] {
  if (request.platform === 'darwin') {
    return [{
      id: 'macos-codesign',
      stage: 'after-layout',
      required: request.enableAutoUpdate ?? false,
      commandHint: 'codesign',
    }];
  }
  if (request.platform === 'win32' && request.windowsPackaging === 'msix') {
    return [{
      id: 'windows-package-sign',
      stage: 'after-artifact',
      required: true,
      commandHint: 'signtool',
    }];
  }
  if (request.platform === 'win32') {
    return [{
      id: 'windows-executable-sign',
      stage: 'after-layout',
      required: false,
      commandHint: 'signtool',
    }];
  }
  return [];
}

function assertProofs(proofs: readonly PackagingRuleProof[], required: readonly string[]): readonly PackagingRuleProof[] {
  const byId = new Map(proofs.map(proof => [proof.ruleId, proof]));
  const selected: PackagingRuleProof[] = [];
  for (const id of required) {
    const proof = byId.get(id);
    if (!proof) throw new Error(`Packaging capability lacks a proven canonical j2cs rule: ${id}`);
    selected.push(proof);
  }
  return selected;
}

export function planPackage(request: PackagingRequest, proofs: readonly PackagingRuleProof[]): PackagingPlan {
  const appName = safeSegment(request.appName, 'appName');
  const appId = safeSegment(request.appId, 'appId');
  const version = safeSegment(request.version, 'version');
  const entryRelative = relativeFile(request.entryExecutable, 'entryExecutable');
  if (request.platform !== 'win32' && request.windowsPackaging) {
    throw new Error('windowsPackaging is only valid for win32 packages');
  }

  const rid = ridFor(request.platform, request.arch);
  const bundleRoot = request.platform === 'darwin'
    ? `${appName}.app`
    : `${appName}-${version}-${rid}`;
  const managedRoot = request.platform === 'darwin'
    ? joinBundle(bundleRoot, 'Contents', 'MacOS')
    : bundleRoot;
  const resourcesRoot = request.platform === 'darwin'
    ? joinBundle(bundleRoot, 'Contents', 'Resources')
    : joinBundle(bundleRoot, 'resources');
  const electronAppPath = joinBundle(resourcesRoot, 'app');
  const nativeRoot = joinBundle(resourcesRoot, 'native', rid);

  const mappings: PackageMapping[] = request.files.map(file => {
    const relative = relativeFile(file.relativePath, 'file.relativePath');
    const root = file.kind === 'managed' ? managedRoot : file.kind === 'resource' ? electronAppPath : nativeRoot;
    return { source: file.source, destination: joinBundle(root, relative), kind: file.kind };
  });
  const seen = new Set<string>();
  for (const mapping of mappings) {
    if (seen.has(mapping.destination)) throw new Error(`Duplicate package destination: ${mapping.destination}`);
    seen.add(mapping.destination);
  }

  const entryExecutable = joinBundle(managedRoot, entryRelative);
  if (!mappings.some(mapping => mapping.kind === 'managed' && mapping.destination === entryExecutable)) {
    throw new Error('entryExecutable must name one of the managed package files');
  }

  const updater = updaterContract(request);
  const requiredRules: string[] = [...BASE_RULES];
  if (request.enableAutoUpdate) {
    requiredRules.push(...UPDATE_RULES);
    if (request.platform === 'win32') requiredRules.push('electron.autoupdater.windows-updater-selection');
    if (request.platform === 'darwin') requiredRules.push('electron.autoupdater.mac-signing');
  }

  const artifactFormat = request.platform === 'darwin'
    ? 'app-bundle'
    : request.platform === 'win32'
      ? request.windowsPackaging ?? 'portable'
      : 'portable';

  return {
    schemaVersion: 1,
    appId,
    appName,
    version,
    platform: request.platform,
    arch: request.arch,
    rid,
    artifactFormat,
    layout: {
      bundleRoot,
      managedRoot,
      resourcesRoot,
      electronAppPath,
      nativeRoot,
      entryExecutable,
    },
    mappings,
    signingHooks: signingHooks(request),
    updater,
    ruleProofs: assertProofs(proofs, requiredRules),
  };
}

export async function loadAndPlanPackage(request: PackagingRequest, ruleDbRoot: string): Promise<PackagingPlan> {
  return planPackage(request, await loadPackagingRuleProofs(ruleDbRoot));
}

function nativeDestination(outputRoot: string, bundlePath: string): string {
  return path.join(outputRoot, ...bundlePath.split('/'));
}

async function exists(file: string): Promise<boolean> {
  try { await access(file); return true; } catch { return false; }
}

export async function materializePackage(plan: PackagingPlan, outputRoot: string): Promise<string> {
  const bundleDir = nativeDestination(outputRoot, plan.layout.bundleRoot);
  if (await exists(bundleDir)) throw new Error(`Package output already exists: ${bundleDir}`);
  await mkdir(bundleDir, { recursive: true });

  for (const mapping of plan.mappings) {
    const destination = nativeDestination(outputRoot, mapping.destination);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(mapping.source, destination);
  }

  const manifest = path.join(bundleDir, 'j2cs-package.json');
  await writeFile(manifest, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
  return manifest;
}
