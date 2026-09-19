import path from 'node:path';

export interface SecurityPolicy {
  readonly contextIsolationRequired: boolean;
  readonly sandboxRequired: boolean;
  readonly allowNodeIntegration: boolean;
  readonly allowedIpcChannels: ReadonlySet<string>;
  readonly allowedNetworkOrigins: ReadonlySet<string>;
  readonly allowedFileRoots: readonly string[];
  readonly allowedExternalSchemes: ReadonlySet<string>;
  readonly allowWindowOpen: boolean;
}

export interface RendererSecurityProfile {
  readonly contextIsolation: boolean;
  readonly sandbox: boolean;
  readonly nodeIntegration: boolean;
}

export type SecurityRequest =
  | { readonly kind: 'ipc-invoke'; readonly channel: string }
  | { readonly kind: 'network-origin'; readonly url: string }
  | { readonly kind: 'file-read'; readonly filePath: string }
  | { readonly kind: 'shell-open-external'; readonly url: string }
  | { readonly kind: 'window-open'; readonly url: string };

export interface SecurityDecision {
  readonly allowed: boolean;
  readonly code: string;
  readonly reason: string;
}

function deny(code: string, reason: string): SecurityDecision { return { allowed: false, code, reason }; }
function allow(code: string, reason: string): SecurityDecision { return { allowed: true, code, reason }; }

function normalizedOrigin(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (!parsed.protocol || !parsed.hostname) return undefined;
    return parsed.origin;
  } catch {
    return undefined;
  }
}

function isContained(root: string, candidate: string): boolean {
  const normalizedRoot = path.resolve(root);
  const normalizedCandidate = path.resolve(candidate);
  const relative = path.relative(normalizedRoot, normalizedCandidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export function validateRendererSecurityProfile(policy: SecurityPolicy, profile: RendererSecurityProfile): SecurityDecision {
  if (policy.contextIsolationRequired && !profile.contextIsolation)
    return deny('E_SECURITY_CONTEXT_ISOLATION', 'Renderer contextIsolation is required by policy.');
  if (policy.sandboxRequired && !profile.sandbox)
    return deny('E_SECURITY_SANDBOX', 'Renderer sandbox is required by policy.');
  if (!policy.allowNodeIntegration && profile.nodeIntegration)
    return deny('E_SECURITY_NODE_INTEGRATION', 'Renderer nodeIntegration is forbidden by policy.');
  return allow('SECURITY_PROFILE_OK', 'Renderer security profile satisfies policy.');
}

export function evaluateSecurityRequest(policy: SecurityPolicy, request: SecurityRequest): SecurityDecision {
  switch (request.kind) {
    case 'ipc-invoke': {
      if (!request.channel || !policy.allowedIpcChannels.has(request.channel))
        return deny('E_SECURITY_IPC_CAPABILITY', `IPC channel is not granted: ${request.channel || '<empty>'}`);
      return allow('SECURITY_IPC_ALLOWED', `IPC channel granted: ${request.channel}`);
    }
    case 'network-origin': {
      const origin = normalizedOrigin(request.url);
      if (origin === undefined) return deny('E_SECURITY_URL', 'Network URL is invalid or lacks an origin.');
      if (!policy.allowedNetworkOrigins.has(origin)) return deny('E_SECURITY_ORIGIN', `Network origin is not granted: ${origin}`);
      return allow('SECURITY_ORIGIN_ALLOWED', `Network origin granted: ${origin}`);
    }
    case 'file-read': {
      if (!path.isAbsolute(request.filePath)) return deny('E_SECURITY_PATH', 'File capability requires an absolute path.');
      const root = policy.allowedFileRoots.find(candidate => isContained(candidate, request.filePath));
      if (root === undefined) return deny('E_SECURITY_PATH_CAPABILITY', 'File path is outside all granted roots.');
      return allow('SECURITY_PATH_ALLOWED', `File path is contained by granted root: ${path.resolve(root)}`);
    }
    case 'shell-open-external': {
      let parsed: URL;
      try { parsed = new URL(request.url); } catch { return deny('E_SECURITY_URL', 'External URL is invalid.'); }
      const scheme = parsed.protocol.slice(0, -1).toLowerCase();
      if (!policy.allowedExternalSchemes.has(scheme))
        return deny('E_SECURITY_EXTERNAL_SCHEME', `External scheme is not granted: ${scheme}`);
      return allow('SECURITY_EXTERNAL_ALLOWED', `External scheme granted: ${scheme}`);
    }
    case 'window-open': {
      if (!policy.allowWindowOpen) return deny('E_SECURITY_WINDOW_OPEN', 'New windows are denied by policy.');
      const origin = normalizedOrigin(request.url);
      if (origin === undefined || !policy.allowedNetworkOrigins.has(origin))
        return deny('E_SECURITY_WINDOW_ORIGIN', 'Window target origin is not granted.');
      return allow('SECURITY_WINDOW_ALLOWED', `Window target origin granted: ${origin}`);
    }
  }
}
