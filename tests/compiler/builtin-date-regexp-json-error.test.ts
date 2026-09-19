import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ROOT, compile, createCompiler } from '../../compiler/index.js';
import { CompileError } from '../../compiler/diagnostics/index.js';
import { loadRules } from '../../compiler/rules/loader.js';
import {
  proveBuiltinOperation,
  requireProvenBuiltinOperation,
} from '../../compiler/rules/builtins/date-regexp-json-error.js';

const database = await loadRules(path.join(ROOT, 'rule-db'));

test('issue #30 builtin proof adapters pin canonical j2cs rules and require complete evidence', () => {
  const dateNow = proveBuiltinOperation(database, 'date.now', {
    global_date_binding_is_intrinsic: true,
    property_lookup_resolves_builtin: 'Date.now',
    'call.argumentCount': 0,
  });
  assert.equal(dateNow.verdict, 'proven');
  assert.equal(dateNow.rules[0]?.ruleId, 'date.now');

  const dateUtc = proveBuiltinOperation(database, 'date.utc', {
    global_date_binding_is_intrinsic: true,
    property_lookup_resolves_builtin: 'Date.UTC',
    'arguments.domain': 'primitive',
    'call.argumentCount.max': 7,
    semantic_operation: 'TimeClip',
  });
  assert.equal(dateUtc.verdict, 'proven');
  assert.deepEqual(dateUtc.rules.map(r => r.ruleId), ['date.utc', 'date.time-clip']);

  const dateParse = proveBuiltinOperation(database, 'date.parse.standard', {
    global_date_binding_is_intrinsic: true,
    property_lookup_resolves_builtin: 'Date.parse',
    argument_static_type: 'String',
    string_proven_ecmascript_date_time_format: true,
    'date.standardPortableSubset': true,
  });
  assert.equal(dateParse.verdict, 'proven');

  const jsonParse = proveBuiltinOperation(database, 'json.parse.basic', {
    builtin_json_method_not_overridden: true,
    ecmascript_value_model_available: true,
    reviver_omitted: true,
    'input.domain': 'primitive',
  });
  assert.equal(jsonParse.verdict, 'proven');

  const jsonStringify = proveBuiltinOperation(database, 'json.stringify.number-specials', {
    builtin_json_method_not_overridden: true,
    ecmascript_value_model_available: true,
    replacer_omitted: true,
    space_omitted: true,
    no_json_rawjson_values: true,
    reachable_proxy_or_unmodeled_exotic: false,
    value_may_contain_number: true,
    'reachable.toJSON': false,
    'reachable.accessor': false,
  });
  assert.equal(jsonStringify.verdict, 'proven');
  assert.deepEqual(jsonStringify.rules.map(r => r.ruleId), ['json.stringify.basic', 'json.stringify.number-specials']);

  const regexp = proveBuiltinOperation(database, 'regexp.test', {
    receiver_inferred_as: 'ECMAScript RegExp or runtime RegExp value',
    builtin_semantics_required: true,
    'regexp.execOverridden': false,
    'regexp.patternSubset': 'literal-utf16',
  });
  assert.equal(regexp.verdict, 'proven');

  const error = proveBuiltinOperation(database, 'error.call.message', {
    builtin_Error_not_overridden: true,
    called_without_new: true,
    message_not_undefined: true,
    'message.domain': 'primitive',
    'message.isUndefined': false,
  });
  assert.equal(error.verdict, 'proven');
});

test('issue #30 builtin proof adapters fail closed on absent or disproven facts', () => {
  assert.equal(requireProvenBuiltinOperation(database, 'date.now', {
    global_date_binding_is_intrinsic: true,
    property_lookup_resolves_builtin: 'Date.now',
  }), undefined);

  const wrong = proveBuiltinOperation(database, 'json.parse.basic', {
    builtin_json_method_not_overridden: false,
    ecmascript_value_model_available: true,
    reviver_omitted: true,
    'input.domain': 'primitive',
  });
  assert.equal(wrong.verdict, 'disproven');
  assert.ok(wrong.rules[0]?.checks.some(c => c.verdict === 'disproven'));
});

test('issue #30 syntax entry paths stay fail-closed until shared parser/lowering integration merges', async () => {
  const index = await createCompiler();
  const rejected: [string, string][] = [
    ['Date.now();', 'E_UNRESOLVED_BINDING'],
    ['JSON.parse("1");', 'E_UNRESOLVED_BINDING'],
    ['Error("x");', 'E_UNRESOLVED_BINDING'],
    ['/a/g.test("a");', 'E_UNSUPPORTED_SYNTAX'],
  ];
  for (const [source, code] of rejected) {
    assert.throws(() => compile(source, index, 'builtin-entry.js'), (error: unknown) => {
      assert.ok(error instanceof CompileError);
      assert.equal(error.diagnostic.code, code);
      return true;
    });
  }
});
