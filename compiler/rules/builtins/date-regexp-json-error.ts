import type { RuleDatabase } from '../loader.js';

export type BuiltinFactValue = string | number | boolean;
export type BuiltinFacts = Readonly<Record<string, BuiltinFactValue>>;

export interface BuiltinRuleAdapter {
  operation: string;
  ruleId: string;
  sha256: string;
  lowering: string;
  guards?: Readonly<Record<string, BuiltinFactValue>>;
}

export interface BuiltinProofCheck {
  key: string;
  expected: BuiltinFactValue;
  actual?: BuiltinFactValue;
  verdict: 'proven' | 'disproven' | 'unknown';
  source: 'upstream' | 'backend';
}

export interface BuiltinRuleProof {
  ruleId: string;
  sha256: string;
  lowering: string;
  verdict: 'proven' | 'disproven' | 'unknown';
  checks: BuiltinProofCheck[];
}

export interface BuiltinOperationProof {
  operation: string;
  rules: BuiltinRuleProof[];
  verdict: 'proven' | 'disproven' | 'unknown';
}

export const dateRegExpJsonErrorAdapters: readonly BuiltinRuleAdapter[] = [
  {
    operation: 'date.now',
    ruleId: 'date.now',
    sha256: '2ef405e6df300a91534ce576706aa7eb5f8940f5590c88781293a327058b95c2',
    lowering: 'JsDate.Now',
    guards: { 'call.argumentCount': 0 },
  },
  {
    operation: 'date.utc',
    ruleId: 'date.utc',
    sha256: '07a7766685826e826df2f6fd84d4b3ff6d4ce24b2dd49ea48a601bdad5c5f757',
    lowering: 'JsDate.Utc',
    guards: { 'arguments.domain': 'primitive', 'call.argumentCount.max': 7 },
  },
  {
    operation: 'date.utc',
    ruleId: 'date.time-clip',
    sha256: '03143097a8646f630d1820ebc8a482a3956a95775aff307fd312500f9429a2fc',
    lowering: 'JsDate.TimeClip',
  },
  {
    operation: 'date.parse.standard',
    ruleId: 'date.parse.standard-string',
    sha256: '21da491f2a91c47ceab3fb5917ac7dcd30b5cf44cd85bf3dd6634277e29c1d22',
    lowering: 'JsDate.ParseStandard',
    guards: { 'date.standardPortableSubset': true },
  },
  {
    operation: 'json.parse.basic',
    ruleId: 'json.parse.basic',
    sha256: '0ea18371699db1ce8841bfd04b81222edeb27494a0670fe0d50326f75b259d79',
    lowering: 'JsJson.Parse',
    guards: { 'input.domain': 'primitive' },
  },
  {
    operation: 'json.stringify.basic',
    ruleId: 'json.stringify.basic',
    sha256: 'c23c3260c8bdf9b674dbb7b7f315ebb1d3aa1db0fe6bf1859c0392e9412176c7',
    lowering: 'JsJson.Stringify',
    guards: { 'reachable.toJSON': false, 'reachable.accessor': false, 'reachable.objectRepresentation': 'json-owned-or-array' },
  },
  {
    operation: 'json.stringify.number-specials',
    ruleId: 'json.stringify.basic',
    sha256: 'c23c3260c8bdf9b674dbb7b7f315ebb1d3aa1db0fe6bf1859c0392e9412176c7',
    lowering: 'JsJson.Stringify',
    guards: { 'reachable.toJSON': false, 'reachable.accessor': false, 'reachable.objectRepresentation': 'json-owned-or-array' },
  },
  {
    operation: 'json.stringify.number-specials',
    ruleId: 'json.stringify.number-specials',
    sha256: 'e2d6059ad0f7d698a8a122947027ab12963c9e9779ca595d28f72e15cf87c29c',
    lowering: 'JsJson.Stringify',
  },
  {
    operation: 'json.stringify.string',
    ruleId: 'json.stringify.basic',
    sha256: 'c23c3260c8bdf9b674dbb7b7f315ebb1d3aa1db0fe6bf1859c0392e9412176c7',
    lowering: 'JsJson.Stringify',
    guards: { 'reachable.toJSON': false, 'reachable.accessor': false, 'reachable.objectRepresentation': 'json-owned-or-array' },
  },
  {
    operation: 'json.stringify.string',
    ruleId: 'json.stringify.string-escaping',
    sha256: '1dcb3494765e11279ae21b19b619be188b8d5acc1a493b8b78b0f6355f8d9a53',
    lowering: 'JsJson.Stringify',
  },
  {
    operation: 'regexp.literal',
    ruleId: 'regexp.literal.create',
    sha256: '5f6f2aaf1f8b058254b03d2820592d6c242074250f8532f9d53ab9f2aee57c92',
    lowering: 'JsRegExp.CreateLiteral',
    guards: { 'regexp.patternSubset': 'nonempty-literal-utf16-no-meta', 'regexp.flagsSubset': 'g-or-empty' },
  },
  {
    operation: 'regexp.test',
    ruleId: 'regexp.prototype.test',
    sha256: 'af301d0c1f152e71e6f0bf9f56d2c9dd30106569ce014f3d68a5bb41db9ffa8c',
    lowering: 'JsRegExp.Test',
    guards: { 'regexp.execOverridden': false, 'regexp.patternSubset': 'nonempty-literal-utf16-no-meta', 'regexp.input.domain': 'primitive' },
  },
  {
    operation: 'error.call.empty',
    ruleId: 'error.constructor.call-without-new',
    sha256: 'aef2f67f90ed692add14a6f42e274d4eb1ce96e00aab916c94bac6f3345cc7c3',
    lowering: 'JsError.Create',
  },
  {
    operation: 'error.call.message',
    ruleId: 'error.constructor.call-without-new',
    sha256: 'aef2f67f90ed692add14a6f42e274d4eb1ce96e00aab916c94bac6f3345cc7c3',
    lowering: 'JsError.Create',
  },
  {
    operation: 'error.call.message',
    ruleId: 'error.constructor.message',
    sha256: 'c3605071c31cd010542a7e3ebf210c20ec3c467b643833c3f7ce1c279d5a8191',
    lowering: 'JsError.Create',
    guards: { 'message.domain': 'primitive', 'message.isUndefined': false },
  },
];

function scalar(value: unknown): value is BuiltinFactValue {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function proofVerdict(checks: readonly BuiltinProofCheck[]): BuiltinRuleProof['verdict'] {
  return checks.some(c => c.verdict === 'disproven') ? 'disproven'
    : checks.some(c => c.verdict === 'unknown') ? 'unknown' : 'proven';
}

function checkFacts(
  requirements: Readonly<Record<string, unknown>>,
  facts: BuiltinFacts,
  source: BuiltinProofCheck['source'],
): BuiltinProofCheck[] {
  return Object.entries(requirements).map(([key, expected]) => {
    if (!scalar(expected)) {
      return { key, expected: String(expected), verdict: 'unknown', source };
    }
    const actual = facts[key];
    return {
      key,
      expected,
      ...(actual === undefined ? {} : { actual }),
      verdict: actual === undefined ? 'unknown' : Object.is(actual, expected) ? 'proven' : 'disproven',
      source,
    };
  });
}

/**
 * Proof boundary for issue #30.
 *
 * This module is deliberately not wired into the shared parser/lowering surface while
 * sibling PRs own that integration. It consumes the pinned canonical rule requirements
 * verbatim and adds only backend-capability guards. Unknown requirements/facts fail closed.
 */
export function proveBuiltinOperation(database: RuleDatabase, operation: string, facts: BuiltinFacts): BuiltinOperationProof {
  const adapters = dateRegExpJsonErrorAdapters.filter(a => a.operation === operation);
  if (!adapters.length) throw new Error(`Unknown builtin proof operation: ${operation}`);
  const rules = adapters.map(adapter => {
    const loaded = database.byId.get(adapter.ruleId);
    if (!loaded) throw new Error(`Pinned j2cs rule is missing: ${adapter.ruleId}`);
    if (loaded.sha256 !== adapter.sha256)
      throw new Error(`Pinned j2cs rule changed and needs adapter review: ${adapter.ruleId}`);
    const upstream = checkFacts(loaded.rule.source.requirements ?? {}, facts, 'upstream');
    const backend = checkFacts(adapter.guards ?? {}, facts, 'backend');
    const checks = [...upstream, ...backend];
    return { ruleId: adapter.ruleId, sha256: loaded.sha256, lowering: adapter.lowering,
      verdict: proofVerdict(checks), checks } satisfies BuiltinRuleProof;
  });
  const verdict = rules.some(r => r.verdict === 'disproven') ? 'disproven'
    : rules.some(r => r.verdict === 'unknown') ? 'unknown' : 'proven';
  return { operation, rules, verdict };
}

export function requireProvenBuiltinOperation(
  database: RuleDatabase,
  operation: string,
  facts: BuiltinFacts,
): BuiltinOperationProof | undefined {
  const proof = proveBuiltinOperation(database, operation, facts);
  return proof.verdict === 'proven' ? proof : undefined;
}
