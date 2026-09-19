import type { RuleDatabase } from './loader.js';

export const BINARY_BIGINT_RULE_DB_COMMIT = '35ca8d859f9352e90ee2497f4ac8f6edb9c19ed1';

export interface BinaryBigIntRuleContract {
  id: string;
  category: 'values' | 'bigint' | 'operators' | 'coercion' | 'binary';
  strategy: 'native' | 'helper';
  helper?: string;
  requirements: Readonly<Record<string, string | boolean>>;
}

export const BINARY_BIGINT_RULES: readonly BinaryBigIntRuleContract[] = [
  { id: 'values.bigint.representation', category: 'values', strategy: 'native',
    requirements: { static_type: 'BigInt', value_already_bigint: true } },
  { id: 'bigint.literal', category: 'bigint', strategy: 'native',
    requirements: { ast_node: 'BigIntLiteral', literal_value_already_parsed_exactly: true } },
  { id: 'coercion.number-to-bigint', category: 'coercion', strategy: 'helper', helper: 'JsCoercion.NumberToBigInt',
    requirements: { semantic_operation: 'NumberToBigInt', input_already_number: true } },
  { id: 'coercion.string-to-bigint', category: 'coercion', strategy: 'helper', helper: 'JsCoercion.StringToBigInt',
    requirements: { semantic_operation: 'StringToBigInt', static_type: 'String' } },
  { id: 'coercion.bigint-function.primitive', category: 'coercion', strategy: 'helper', helper: 'JsCoercion.BigIntFunctionPrimitive',
    requirements: { binding_resolves_to_intrinsic: '%BigInt%', builtin_not_replaced: true, argument_is_primitive: true } },
  { id: 'coercion.to-bigint.primitive-other', category: 'coercion', strategy: 'helper', helper: 'JsCoercion.ToBigIntPrimitive',
    requirements: { semantic_operation: 'ToBigInt', input_is_primitive: true, static_type_excludes: 'BigInt' } },
  { id: 'coercion.to-bigint64.bigint', category: 'coercion', strategy: 'helper', helper: 'JsCoercion.ToBigInt64',
    requirements: { semantic_operation: 'ToBigInt64', input_already_bigint: true } },
  { id: 'coercion.to-biguint64.bigint', category: 'coercion', strategy: 'helper', helper: 'JsCoercion.ToBigUint64',
    requirements: { semantic_operation: 'ToBigUint64', input_already_bigint: true } },
  { id: 'binary.arraybuffer.constructor.fixed', category: 'binary', strategy: 'helper', helper: 'JsBinary.NewArrayBuffer',
    requirements: { builtin_constructor_not_overridden: true } },
  { id: 'binary.typedarray.constructor.buffer', category: 'binary', strategy: 'helper', helper: 'JsBinary.NewTypedArrayView',
    requirements: { builtin_constructor_not_overridden: true, typed_array_constructor_known: true } },
  { id: 'binary.typedarray.indexed-read', category: 'binary', strategy: 'helper', helper: 'JsBinary.TypedArrayGet',
    requirements: { receiver: 'builtin TypedArray', indexed_access_not_intercepted_by_outer_proxy: true } },
  { id: 'binary.typedarray.indexed-write-number', category: 'binary', strategy: 'helper', helper: 'JsBinary.TypedArraySetNumber',
    requirements: { receiver: 'Number-content builtin TypedArray', indexed_access_not_intercepted_by_outer_proxy: true } },
  { id: 'binary.typedarray.indexed-write-bigint', category: 'binary', strategy: 'helper', helper: 'JsBinary.TypedArraySetBigInt',
    requirements: { receiver: 'BigInt-content builtin TypedArray', indexed_access_not_intercepted_by_outer_proxy: true } },
  { id: 'binary.dataview.constructor', category: 'binary', strategy: 'helper', helper: 'JsBinary.NewDataView',
    requirements: { builtin_constructor_not_overridden: true } },
  { id: 'binary.dataview.get', category: 'binary', strategy: 'helper', helper: 'JsBinary.DataViewGet',
    requirements: { receiver: 'builtin DataView', builtin_method_not_overridden: true, method_family_resolved: true } },
  { id: 'binary.dataview.set', category: 'binary', strategy: 'helper', helper: 'JsBinary.DataViewSet',
    requirements: { receiver: 'builtin DataView', builtin_method_not_overridden: true, method_family_resolved: true } },
] as const;

export function validateBinaryBigIntRuleContract(database: RuleDatabase): string[] {
  const errors: string[] = [];
  for (const expected of BINARY_BIGINT_RULES) {
    const loaded = database.byId.get(expected.id);
    if (!loaded) { errors.push(`missing canonical rule ${expected.id}`); continue; }
    const rule = loaded.rule;
    if (rule.category !== expected.category) errors.push(`${expected.id}: category drift`);
    if (rule.strategy !== expected.strategy) errors.push(`${expected.id}: strategy drift`);
    if (expected.helper !== undefined && rule.target.helper !== expected.helper) errors.push(`${expected.id}: helper drift`);
    const actual = rule.source.requirements ?? {};
    for (const [key, value] of Object.entries(expected.requirements))
      if (actual[key] !== value) errors.push(`${expected.id}: requirement ${key} drift`);
  }
  return errors;
}

export type BinaryBigIntProofVerdict = 'proven' | 'disproven' | 'unknown';
export type BinaryBigIntProofFacts = Readonly<Record<string, string | boolean | undefined>>;

const proofRequirements: Readonly<Record<string, Readonly<Record<string, string | boolean>>>> = {
  'values.bigint.representation': { 'value.staticType': 'BigInt', 'value.exactBigInt': true },
  'bigint.literal': { 'ast.kind': 'BigIntLiteral', 'literal.parsedExactly': true },
  'coercion.number-to-bigint': { 'operation': 'NumberToBigInt', 'input.type': 'Number' },
  'coercion.string-to-bigint': { 'operation': 'StringToBigInt', 'input.type': 'String' },
  'coercion.bigint-function.primitive': { 'binding.intrinsic': '%BigInt%', 'builtin.pristine': true, 'argument.domain': 'primitive' },
  'coercion.to-bigint.primitive-other': { 'operation': 'ToBigInt', 'input.domain': 'primitive', 'input.excludesBigInt': true },
  'coercion.to-bigint64.bigint': { 'operation': 'ToBigInt64', 'input.type': 'BigInt' },
  'coercion.to-biguint64.bigint': { 'operation': 'ToBigUint64', 'input.type': 'BigInt' },
  'binary.arraybuffer.constructor.fixed': { 'builtin.pristine': true },
  'binary.typedarray.constructor.buffer': { 'builtin.pristine': true, 'typedArray.kindKnown': true },
  'binary.typedarray.indexed-read': { 'receiver.brand': 'TypedArray', 'receiver.proxyIntercepted': false, 'index.canonicalNumeric': true },
  'binary.typedarray.indexed-write-number': { 'receiver.content': 'Number', 'receiver.proxyIntercepted': false, 'index.canonicalNumeric': true },
  'binary.typedarray.indexed-write-bigint': { 'receiver.content': 'BigInt', 'receiver.proxyIntercepted': false, 'index.canonicalNumeric': true },
  'binary.dataview.constructor': { 'builtin.pristine': true },
  'binary.dataview.get': { 'receiver.brand': 'DataView', 'member.pristine': true, 'method.familyResolved': true },
  'binary.dataview.set': { 'receiver.brand': 'DataView', 'member.pristine': true, 'method.familyResolved': true },
};

export function proveBinaryBigIntRule(ruleId: string, facts: BinaryBigIntProofFacts): BinaryBigIntProofVerdict {
  const required = proofRequirements[ruleId];
  if (!required) return 'unknown';
  let unknown = false;
  for (const [key, expected] of Object.entries(required)) {
    const actual = facts[key];
    if (actual === undefined) unknown = true;
    else if (actual !== expected) return 'disproven';
  }
  return unknown ? 'unknown' : 'proven';
}
