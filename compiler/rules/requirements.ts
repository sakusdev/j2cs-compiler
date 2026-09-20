import type { FactModel } from '../analysis/facts.js';
export type Verdict = 'proven' | 'disproven' | 'unknown';
export type Predicate =
  | { fact: string; equals: string | number | boolean }
  | { fact: string; contains: string }
  | { fact: string; subsetOf: string[] }
  | { fact: string; exists: true }
  | { equalFacts: [string, string] }
  | { all: Predicate[] } | { any: Predicate[] } | { not: Predicate }
  | { unknown: string };
export interface Proof { verdict: Verdict; predicate: Predicate; evidence: string[] }
export interface RequirementsProof { verdict: Verdict; checks: Proof[]; constraints: string[] }
function aggregate(verdicts: Verdict[], mode: 'all' | 'any'): Verdict {
  if (mode === 'all') return verdicts.includes('disproven') ? 'disproven' : verdicts.includes('unknown') ? 'unknown' : 'proven';
  return verdicts.includes('proven') ? 'proven' : verdicts.includes('unknown') ? 'unknown' : 'disproven';
}
export function evaluate(predicate: Predicate, facts: FactModel): Proof {
  const result = (verdict: Verdict, evidence: string[] = []): Proof => ({ verdict, predicate, evidence });
  if ('unknown' in predicate) return result('unknown', [predicate.unknown]);
  if ('all' in predicate || 'any' in predicate) {
    const mode = 'all' in predicate ? 'all' : 'any', children = 'all' in predicate ? predicate.all : predicate.any;
    const checks = children.map(p => evaluate(p, facts));
    return result(aggregate(checks.map(c => c.verdict), mode), checks.flatMap(c => c.evidence));
  }
  if ('not' in predicate) {
    const check = evaluate(predicate.not, facts);
    return result(check.verdict === 'unknown' ? 'unknown' : check.verdict === 'proven' ? 'disproven' : 'proven', check.evidence);
  }
  if ('equalFacts' in predicate) {
    const [a, b] = predicate.equalFacts.map(k => facts.get(k));
    return !a || !b ? result('unknown') : result(a.value === b.value ? 'proven' : 'disproven', [a.evidence, b.evidence]);
  }
  const fact = facts.get(predicate.fact);
  if (!fact) return result('unknown', [`No evidence for ${predicate.fact}`]);
  let matches: boolean;
  if ('exists' in predicate) matches = true;
  else if ('contains' in predicate) matches = Array.isArray(fact.value) && fact.value.includes(predicate.contains);
  else if ('subsetOf' in predicate) matches = Array.isArray(fact.value) && fact.value.length > 0 && fact.value.every(v => predicate.subsetOf.includes(v));
  else matches = fact.value === predicate.equals;
  return result(matches ? 'proven' : 'disproven', [fact.evidence]);
}
const eq = (fact: string, equals: string | number | boolean): Predicate => ({ fact, equals });
const absentObservation = (name: string): Predicate => ({ not: { fact: 'function.observes', contains: name } });
const typeIs = (key: string, type: string): Predicate => ({ fact: `${key}.types`, subsetOf: [type] });
const both = (type: string): Predicate => ({ all: [typeIs('left', type), typeIs('right', type)] });
const numericOperands: Predicate = { any: [both('Number'), typeIs('operand', 'Number')] };
const sameNative: Predicate = { any: ['Number', 'String', 'Boolean'].map(both) };
const primitiveDomain = (key: string): Predicate => eq(`${key}.domain`, 'primitive');
const knownFlags: Record<string, Predicate> = {
  no_to_primitive_required: eq('operands.domain', 'primitive'),
  no_to_numeric_required: numericOperands,
  operands_non_null_primitive_strings: both('String'),
  value_already_number: eq('result.type', 'Number'),
  not_shadowed_by_lexical_or_parameter_binding: eq('binding.kind', 'intrinsic'),
  builtin_not_shadowed: eq('binding.kind', 'intrinsic'),
  builtin_not_replaced: eq('intrinsics.integrity', 'pristine'),
  builtin_not_overridden: eq('member.integrity', 'pristine'),
  builtin_method_not_overridden: eq('member.integrity', 'pristine'),
  method_resolution_intrinsic: eq('member.integrity', 'pristine'),
  property_not_overridden: eq('member.integrity', 'pristine'),
  method_not_overridden: eq('member.integrity', 'pristine'),
  callback_identity_known: { fact: 'callback.identity', exists: true },
  operands_may_require_coercion: { not: { any: [both('Number'), both('String')] } },
  operands_not_both_in_same_native_specialization: { not: sameNative },
  general_operands: eq('operands.complete', true),
  operand_may_be_non_boolean: { not: typeIs('operand', 'Boolean') },
  expression_may_be_non_boolean: { not: typeIs('operand', 'Boolean') },
  operand_may_require_coercion: primitiveDomain('operand'),
  operands_may_require_to_primitive_or_mixed_numeric_handling: eq('operands.domain', 'primitive'),
  input_is_primitive: primitiveDomain('input'),
  argument_is_primitive: primitiveDomain('argument'),
  value_is_primitive: primitiveDomain('value'),
  radix_to_int32_lowerable: primitiveDomain('radix'),
  radix_coercion_lowerable: primitiveDomain('radix'),
  radix_omitted: eq('call.radixOmitted', true),
  lhs_is_assignable_reference: eq('reference.kind', 'mutable-lexical'),
  operand_is_assignable_reference: eq('reference.kind', 'mutable-lexical'),
  target_statically_known: eq('binding.kind', 'function'),
  target_formals_known: eq('function.formalsKnown', true),
  provided_argument_count_less_than_formal_count: eq('call.fewerThanFormals', true),
  provided_argument_count_greater_than_formal_count: eq('call.moreThanFormals', true),
  exact_arity: { equalFacts: ['call.argumentCount', 'function.parameterCount'] },
  this_unused: absentObservation('this'), arguments_unused: absentObservation('arguments'),
  no_default_or_rest_params: eq('function.parameters', 'simple'),
  not_proxy_or_bound: eq('binding.origin', 'declaration'),
  callee_not_overridden: eq('binding.mutable', false),
  ordinary_function: eq('function.kind', 'ordinary'),
  no_eval_or_with: eq('analysis.dynamicScope', false),
  binding_is_lexical_or_var: eq('binding.lexical', true),
  per_iteration_binding_not_required: eq('binding.perIteration', false),
  scope_binding_conflicts_resolved: eq('analysis.bindings', 'resolved'),
  block_level_annex_b_not_applicable: eq('function.scope', 'module'),
  function_identity_unobserved: absentObservation('identity'),
  function_properties_unobserved: absentObservation('properties'),
  not_used_with_new: absentObservation('construct'),
  this_arguments_new_target_unused: { all: ['this', 'arguments', 'new.target'].map(absentObservation) },
  function_result_may_be_observed: eq('return.representation', 'value'),
  receiver_inferred_as_builtin_array: typeIs('receiver', 'Array'),
  receiver_not_proxy: eq('receiver.proxy', false),
  representation_exposes_exact_js_length: eq('receiver.representation', 'JsArray'),
  no_indexed_accessors_or_nonconfigurable_elements: eq('receiver.indexedDataOnly', true),
  no_indexed_prototype_properties: eq('intrinsics.arrayPrototypeIndexed', false),
  object_representation_supports_own_property_test: eq('object.ownPropertyTest', true),
};
const names: Record<string, string> = {
  left_type: 'left.type', right_type: 'right.type', operand_type: 'operand.type', static_type: 'result.type',
  argument_static_type: 'argument.type', operator: 'operator.semantic', semantic_operation: 'operation.semantic',
  ast_node: 'ast.kind', constant_value: 'constant.value',
  identifier_resolves_to_intrinsic_global_property: 'binding.globalProperty',
  binding_resolves_to_intrinsic: 'binding.intrinsic', platform: 'profile.platform', host: 'profile.host',
  node_profile: 'profile.node', electron_profile: 'profile.electron',
};
/** Translate only reviewed legacy vocabulary. Prose and unknown keys fail closed. */
export function legacyPredicate(key: string, value: unknown): Predicate {
  if (names[key] && ['string', 'number', 'boolean'].includes(typeof value))
    return eq(names[key]!, value as string | number | boolean);
  const excludes: Record<string, string> = {
    static_type_excludes: 'result.types',
    argument_static_type_excludes: 'argument.types',
    value_static_type_excludes: 'value.types',
  };
  if (excludes[key] && typeof value === 'string') return { not: { fact: excludes[key]!, contains: value } };
  if (value === true && knownFlags[key]) return knownFlags[key]!;
  return { unknown: `Unrecognized requirement ${key}=${JSON.stringify(value)}` };
}
function isPredicate(x: unknown): x is Predicate {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  const p = x as Record<string, unknown>, keys = Object.keys(p).sort().join(',');
  if (keys === 'all' || keys === 'any') { const a = p[keys]; return Array.isArray(a) && a.every(isPredicate); }
  if (keys === 'not') return isPredicate(p.not);
  if (keys === 'equalFacts') return Array.isArray(p.equalFacts) && p.equalFacts.length === 2 && p.equalFacts.every(v => typeof v === 'string');
  if (typeof p.fact !== 'string') return false;
  if (keys === 'equals,fact') return ['string', 'number', 'boolean'].includes(typeof p.equals);
  if (keys === 'contains,fact') return typeof p.contains === 'string';
  if (keys === 'fact,subsetOf') return Array.isArray(p.subsetOf) && p.subsetOf.every(v => typeof v === 'string');
  return keys === 'exists,fact' && p.exists === true;
}
function leaves(p: Predicate): string[] {
  return 'all' in p ? p.all.flatMap(leaves) : [JSON.stringify(p)];
}
export function evaluateRequirements(requirements: Record<string, unknown>, facts: FactModel, backend: Predicate[] = []): RequirementsProof {
  const predicates: Predicate[] = Object.entries(requirements).map(([key, value]) => {
    if (key !== '$j2cs') return legacyPredicate(key, value);
    const v = value as { version?: unknown; predicate?: unknown } | null;
    if (v && Object.keys(v).sort().join(',') === 'predicate,version' && v.version === 1 && isPredicate(v.predicate)) return v.predicate;
    return { unknown: 'Invalid or unsupported $j2cs requirement version/shape' };
  });
  const checks = [...predicates, ...backend].map(p => evaluate(p, facts));
  return { verdict: aggregate(checks.map(c => c.verdict), 'all'), checks, constraints: [...new Set(predicates.flatMap(leaves))].sort() };
}
