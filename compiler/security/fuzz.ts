import { evaluateSecurityRequest, type SecurityDecision, type SecurityPolicy, type SecurityRequest } from './capabilities.js';

export interface SecurityFuzzCase {
  readonly name: string;
  readonly request: SecurityRequest;
  readonly mustDeny: boolean;
}

export interface SecurityFuzzResult {
  readonly name: string;
  readonly decision: SecurityDecision;
  readonly invariantSatisfied: boolean;
}

export function defaultSecurityFuzzCorpus(root: string): readonly SecurityFuzzCase[] {
  return [
    { name: 'empty-ipc-channel', request: { kind: 'ipc-invoke', channel: '' }, mustDeny: true },
    { name: 'unknown-ipc-channel', request: { kind: 'ipc-invoke', channel: '__unknown__' }, mustDeny: true },
    { name: 'malformed-network-url', request: { kind: 'network-origin', url: 'not a url' }, mustDeny: true },
    { name: 'network-origin-confusion', request: { kind: 'network-origin', url: 'https://allowed.example.evil.invalid/' }, mustDeny: true },
    { name: 'relative-file-path', request: { kind: 'file-read', filePath: '../secret' }, mustDeny: true },
    { name: 'file-traversal', request: { kind: 'file-read', filePath: `${root}/../secret.txt` }, mustDeny: true },
    { name: 'javascript-external', request: { kind: 'shell-open-external', url: 'javascript:alert(1)' }, mustDeny: true },
    { name: 'window-open-default-deny', request: { kind: 'window-open', url: 'https://allowed.example/' }, mustDeny: true },
  ];
}

export function runSecurityFuzzCorpus(policy: SecurityPolicy, cases: readonly SecurityFuzzCase[]): readonly SecurityFuzzResult[] {
  return cases.map(testCase => {
    let decision: SecurityDecision;
    try {
      decision = evaluateSecurityRequest(policy, testCase.request);
    } catch (error) {
      decision = { allowed: false, code: 'E_SECURITY_EXCEPTION', reason: String(error) };
    }
    return {
      name: testCase.name,
      decision,
      invariantSatisfied: testCase.mustDeny ? !decision.allowed : decision.allowed,
    };
  });
}
