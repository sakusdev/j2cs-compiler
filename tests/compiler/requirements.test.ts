import test from 'node:test';
import assert from 'node:assert/strict';
import { Facts } from '../../compiler/analysis/facts.js';
import { evaluate, evaluateRequirements } from '../../compiler/rules/requirements.js';
const facts = new Facts().type('left', ['Number'], 'inferred lhs').type('right', ['Number'], 'inferred rhs')
  .prove('intrinsics.integrity', 'pristine', 'closed program').prove('binding.kind', 'intrinsic', 'binder')
  .prove('binding.intrinsic', '%Number%', 'binder').prove('member.integrity', 'pristine', 'effect analysis')
  .prove('callback.identity', 'function:42', 'call target resolution')
  .prove('profile.host', 'Node.js', 'selected profile').prove('profile.platform', 'linux', 'selected profile')
  .prove('operands.domain', 'primitive', 'closed value domain').prove('operands.complete', true, 'tagged runtime domain');
test('known legacy requirements are evaluated from common facts', () => {
  assert.equal(evaluateRequirements({ left_type: 'Number', right_type: 'Number', no_to_primitive_required: true }, facts).verdict, 'proven');
  assert.equal(evaluateRequirements({ left_type: 'String' }, facts).verdict, 'disproven');
  assert.equal(evaluateRequirements({ library_side_effects_safe: 'probably' }, facts).verdict, 'unknown');
});
test('intrinsic, callback, member and platform predicates share the fact model', () => {
  assert.equal(evaluateRequirements({ builtin_not_shadowed: true, binding_resolves_to_intrinsic: '%Number%',
    builtin_not_replaced: true, callback_identity_known: true, method_not_overridden: true,
    property_not_overridden: true, platform: 'linux', host: 'Node.js' }, facts).verdict, 'proven');
  assert.equal(evaluateRequirements({ electron_profile: 'renderer' }, facts).verdict, 'unknown');
  assert.equal(evaluateRequirements({ platform: 'win32' }, facts).verdict, 'disproven');
});
test('array/object core requirements are proven only from explicit representation facts', () => {
  const array = new Facts(facts).type('receiver', ['Array'], 'flow receiver')
    .prove('receiver.proxy', false, 'closed profile').prove('receiver.representation', 'JsArray', 'runtime representation')
    .prove('receiver.indexedDataOnly', true, 'runtime representation').prove('intrinsics.arrayPrototypeIndexed', false, 'pristine prototype')
    .prove('object.ownPropertyTest', true, 'presence-aware storage');
  assert.equal(evaluateRequirements({ receiver_inferred_as_builtin_array: true, receiver_not_proxy: true,
    representation_exposes_exact_js_length: true }, array).verdict, 'proven');
  assert.equal(evaluateRequirements({ builtin_method_not_overridden: true, no_indexed_accessors_or_nonconfigurable_elements: true,
    no_indexed_prototype_properties: true }, array).verdict, 'proven');
  assert.equal(evaluateRequirements({ object_representation_supports_own_property_test: true }, array).verdict, 'proven');
  assert.equal(evaluateRequirements({ receiver_inferred_as_builtin_array: true }, facts).verdict, 'unknown');
});
test('structured versioned predicates preserve three-valued logic', () => {
  const r = evaluateRequirements({ $j2cs: { version: 1, predicate: { all: [
    { fact: 'left.type', equals: 'Number' }, { not: { fact: 'profile.platform', equals: 'win32' } },
  ] } } }, facts);
  assert.equal(r.verdict, 'proven'); assert.ok(r.checks[0]!.evidence.includes('inferred lhs'));
  assert.equal(evaluate({ not: { fact: 'missing', equals: true } }, facts).verdict, 'unknown');
  assert.equal(evaluate({ any: [{ fact: 'missing', equals: true }, { fact: 'left.type', equals: 'Number' }] }, facts).verdict, 'proven');
  assert.equal(evaluate({ all: [{ fact: 'missing', equals: true }, { fact: 'left.type', equals: 'String' }] }, facts).verdict, 'disproven');
});
test('unknown keys and malformed structured conditions cannot authorize lowering', () => {
  for (const requirements of [{ strange: true }, { $j2cs: { version: 2, predicate: { all: [] } } },
    { $j2cs: { version: 1, predicate: { all: [], ignored: true } } }, { left_type: {} },
    { $j2cs: { version: 1, predicate: 'Number' } }]) assert.equal(evaluateRequirements(requirements, facts).verdict, 'unknown');
});
test('finite union facts allow safe helper fallback but not native proof', () => {
  const union = new Facts(facts).type('left', ['Number', 'String'], 'joined branches');
  assert.equal(evaluateRequirements({ left_type: 'Number' }, union).verdict, 'unknown');
  assert.equal(evaluateRequirements({ operands_may_require_coercion: true }, union).verdict, 'proven');
});
