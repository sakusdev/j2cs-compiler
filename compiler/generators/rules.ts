import { fail, type Span } from '../diagnostics/index.js';
import type { RuleIndex } from '../rules/index.js';

export interface GeneratorTrace {
  ruleId: string;
  strategy: string;
  lowering: string;
  span: Span;
  sha256: string;
  requirements: {
    verdict: 'proven';
    checks: Array<{
      verdict: 'proven';
      predicate: { fact: string; equals: string | number | boolean };
      evidence: string[];
    }>;
    constraints: string[];
  };
  rejected: Array<{ id: string; verdict: string }>;
  ambiguous: string[];
}

type ProofValue = string | number | boolean;
export type GeneratorFacts = Readonly<Record<string, { value: ProofValue; evidence: string }>>;

const reviewed = new Map<string, string>([
  ['generator.call-lazy', 'bd3409af05e37567df3894ddca15d12192b60ea7c73c621eaa1eacf1facc152b'],
  ['generator.yield.value', 'a9f1c09b7affb1d4f2a8784dd7ba00b36637e8d5e78c994bf2dd935e8b9152be'],
  ['generator.yield.undefined', 'f239a8a96617533ee8fd05364bb3ea1a581654b7ed5066862304d51253b4331d'],
  ['generator.next.initial-argument-ignored', '077f666284346fed63cbc886ab25d62d72b809b65330f0be604864f2682f9325'],
  ['generator.next.resume-value', '2dc833b67120231872f1107535413c410f81cc588bdff372600b2cb83880b9d6'],
  ['generator.completed.next', 'b8c8a7ffd2e15bc5915979741730563d21d67660fdcfbc73a1230f1f16da6442'],
  ['generator.return.statement-value', '17fc18c4fa3a46bfe07cecefd1e424fd11161c6e82245a37b4c39e2c53f4c857'],
  ['generator.return.before-start', '32a7b0f634eecca439eb558968d0d29b658d209d65179a9b306b44e247fe6e0c'],
  ['generator.return.suspended', '3538070330aad57de375747a0b3084f5d98a36f64fa384b4cf5a10f24de5338d'],
  ['generator.completed.return', 'da74f5fa75573fca080bb97688edf87d902cf6ae4046c931296a146b1be34c05'],
  ['generator.yield-star.delegate-next', '20b9d42db7966f3cd7d084e11f8cabf5b29f0cf90d825b27300665c814f8ec2b'],
  ['generator.yield-star.completion-value', 'b49267070d86742614eeb1f0e0456c0fad23cc6fbcd82289d9972c0ea0ed08ee'],
  ['generator.yield-star.resume-forward', '00ab3b81a3f1757bda54f15051d121624ba184ee2c5d51cf7325d29c62399487'],
  ['generator.yield-star.return-forward', '9ea1753c1c95af3d1e79c475330896cc18b95b83bcadd428bc4ea3725deff1a2'],
  ['generator.yield-star.return-missing', '09de4044bb2da6c478bd32f295ef23b73960146b206d916ebc6aa5f66f1173f2'],
]);

const requirementFacts: Readonly<Record<string, string>> = {
  callee_statically_known_sync_generator: 'callee.syncGenerator',
  inside_sync_generator: 'context.syncGenerator',
  receiver_proven_sync_generator: 'receiver.syncGenerator',
  generator_state: 'generator.state',
  builtin_next_not_overridden: 'member.next.pristine',
  builtin_return_not_overridden: 'member.return.pristine',
  delegation_is_active: 'delegation.active',
  outer_resume_kind: 'outer.resumeKind',
  inner_return_absent: 'inner.return.absent',
};

export function proveGeneratorRule(
  index: RuleIndex,
  trace: GeneratorTrace[],
  ruleId: string,
  facts: GeneratorFacts,
  span: Span,
): void {
  const expected = reviewed.get(ruleId);
  if (!expected) fail('E_GENERATOR_RULE_ADAPTER', 'Generator rule is not reviewed by this compiler lane: ' + ruleId, span);
  const loaded = index.database.byId.get(ruleId);
  if (!loaded) fail('E_RULE_MISSING', 'Canonical j2cs generator rule is missing: ' + ruleId, span);
  if (loaded.sha256 !== expected)
    fail('E_RULE_CONTRACT', 'Canonical j2cs generator rule changed; review before enabling: ' + ruleId, span);

  const requirements = loaded.rule.source.requirements ?? {};
  const checks: GeneratorTrace['requirements']['checks'] = [];
  const constraints: string[] = [];
  for (const [key, expectedValue] of Object.entries(requirements)) {
    const factName = requirementFacts[key];
    if (!factName)
      fail('E_GENERATOR_RULE_PROOF', 'Unrecognized canonical generator requirement: ' + key, span);
    if (!['string', 'number', 'boolean'].includes(typeof expectedValue))
      fail('E_GENERATOR_RULE_PROOF', 'Non-scalar canonical generator requirement is not proven: ' + key, span);
    const fact = facts[factName];
    if (!fact)
      fail('E_GENERATOR_RULE_PROOF', 'Missing proof fact ' + factName + ' for ' + ruleId, span);
    if (fact.value !== expectedValue)
      fail('E_GENERATOR_RULE_PROOF', 'Fact ' + factName + ' does not prove ' + key + ' for ' + ruleId, span);
    const value = expectedValue as ProofValue;
    checks.push({
      verdict: 'proven',
      predicate: { fact: factName, equals: value },
      evidence: [fact.evidence],
    });
    constraints.push(JSON.stringify({ fact: factName, equals: value }));
  }

  trace.push({
    ruleId,
    strategy: loaded.rule.strategy,
    lowering: loaded.rule.target.helper ?? ('generator:' + ruleId),
    span,
    sha256: loaded.sha256,
    requirements: { verdict: 'proven', checks, constraints: [...new Set(constraints)].sort() },
    rejected: [],
    ambiguous: [],
  });
}

export function fact(value: ProofValue, evidence: string): { value: ProofValue; evidence: string } {
  return { value, evidence };
}
