import { fail } from '../diagnostics/index.js';
import type { RuleDatabase } from '../rules/loader.js';
import type { ArrowSyntax } from '../parser/arrow.js';

export type ArrowVerdict = 'proven' | 'disproven' | 'unknown';

export interface ArrowRequirementCheck {
  requirement: string;
  expected: unknown;
  actual?: unknown;
  verdict: ArrowVerdict;
  evidence: string;
}
export interface ArrowRuleProof {
  ruleId: string;
  sha256: string;
  verdict: ArrowVerdict;
  checks: readonly ArrowRequirementCheck[];
}
export interface ArrowContext {
  enclosingThisStaticallyRepresented: boolean;
  enclosingArgumentsBindingKnown: boolean;
  enclosingNewTargetKnown: boolean;
  dynamicScope: boolean;
  identityObserved: boolean;
  propertiesObserved: boolean;
  targetStaticallyKnownArrow: boolean;
  constructionAttempt: boolean;
}

export const ARROW_RULE_SHA256 = {
  'function.arrow.lexical-this': '5f1c73715ff772a5a75a15329559f58f528b78e2ddc24a9fe0e769a2a5f47af6',
  'function.arrow.lexical-arguments': '351160b353cf0676aa9b57780d108f8d453c528dce30d1d5a300dfc8a4b8a8f0',
  'function.arrow.not-constructable': 'b2f473db5ca59f492810e0574425cbc66f2e4b1b7f76b302c766215cb875bffe',
} as const;
export type ArrowRuleId = keyof typeof ARROW_RULE_SHA256;

function aggregate(checks: readonly ArrowRequirementCheck[]): ArrowVerdict {
  return checks.some(c => c.verdict === 'disproven') ? 'disproven'
    : checks.some(c => c.verdict === 'unknown') ? 'unknown' : 'proven';
}

function facts(syntax: ArrowSyntax, context: ArrowContext): ReadonlyMap<string, unknown> {
  return new Map<string, unknown>([
    ['arrow_function', true],
    ['enclosing_this_statically_represented', context.enclosingThisStaticallyRepresented],
    ['enclosing_arguments_binding_known', context.enclosingArgumentsBindingKnown],
    ['no_eval_or_with', !context.dynamicScope],
    ['function_identity_unobserved', !context.identityObserved],
    ['function_properties_unobserved', !context.propertiesObserved],
    ['target_statically_known_arrow', context.targetStaticallyKnownArrow],
    ['syntax.uses_lexical_this', syntax.usesLexicalThis],
    ['syntax.uses_lexical_arguments', syntax.usesLexicalArguments],
    ['syntax.uses_lexical_new_target', syntax.usesLexicalNewTarget],
  ]);
}

/**
 * Proofs are intentionally evaluated from the canonical rule's own requirement
 * object instead of interpreting source.pattern or target.template.
 */
export function proveArrowRule(database: RuleDatabase, ruleId: ArrowRuleId,
  syntax: ArrowSyntax, context: ArrowContext): ArrowRuleProof {
  const loaded = database.byId.get(ruleId);
  if (!loaded) return fail('E_RULE_MISSING', `Canonical arrow rule is absent: ${ruleId}`, syntax.span);
  const expectedSha = ARROW_RULE_SHA256[ruleId];
  if (loaded.sha256 !== expectedSha)
    return fail('E_RULE_CONTRACT', `Rule ${ruleId} changed; review the arrow adapter before enabling it.`, syntax.span);

  const available = facts(syntax, context);
  const requirements = loaded.rule.source.requirements ?? {};
  const checks = Object.entries(requirements).map(([requirement, expected]): ArrowRequirementCheck => {
    const actual = available.get(requirement);
    if (actual === undefined)
      return { requirement, expected, verdict: 'unknown', evidence: `No reviewed arrow fact for ${requirement}` };
    const supportedScalar = ['boolean', 'string', 'number'].includes(typeof expected);
    if (!supportedScalar)
      return { requirement, expected, actual, verdict: 'unknown', evidence: 'Requirement shape is not a reviewed scalar arrow predicate' };
    return {
      requirement, expected, actual,
      verdict: actual === expected ? 'proven' : 'disproven',
      evidence: `AST/context fact ${requirement}=${JSON.stringify(actual)}`,
    };
  });
  return { ruleId, sha256: loaded.sha256, verdict: aggregate(checks), checks };
}

export function proveArrowContracts(database: RuleDatabase, syntax: ArrowSyntax, context: ArrowContext): ArrowRuleProof[] {
  const ids: ArrowRuleId[] = [];
  if (syntax.usesLexicalThis) ids.push('function.arrow.lexical-this');
  if (syntax.usesLexicalArguments) ids.push('function.arrow.lexical-arguments');
  if (context.constructionAttempt) ids.push('function.arrow.not-constructable');
  return ids.map(id => proveArrowRule(database, id, syntax, context));
}

/** Fail closed at integration boundaries that are owned by sibling workstreams. */
export function assertArrowContextSupported(database: RuleDatabase, syntax: ArrowSyntax, context: ArrowContext): ArrowRuleProof[] {
  const proofs = proveArrowContracts(database, syntax, context);
  const failed = proofs.find(p => p.verdict !== 'proven');
  if (failed)
    return fail('E_ARROW_PROOF', `Canonical arrow rule proof is not complete for ${failed.ruleId} (${failed.verdict}).`, syntax.span);
  if (syntax.usesLexicalNewTarget) {
    if (!context.enclosingNewTargetKnown)
      return fail('E_ARROW_NEW_TARGET_UNPROVEN', 'Arrow new.target is lexical but no enclosing new.target representation is proven.', syntax.span);
    return fail('E_ARROW_NEW_TARGET_RULE_MISSING',
      'The pinned j2cs rule DB has no reviewed arrow-specific lexical new.target lowering rule; integration remains fail-closed.', syntax.span);
  }
  return proofs;
}
