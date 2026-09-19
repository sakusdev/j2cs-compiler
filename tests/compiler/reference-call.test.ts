import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ROOT } from '../../compiler/index.js';
import { parse } from '../../compiler/parser/index.js';
import {
  methodExtractionFacts,
  ordinaryThisFacts,
  planCallReference,
  referenceCallFacts,
} from '../../compiler/analysis/reference.js';
import { loadRules } from '../../compiler/rules/loader.js';
import { proveReferenceRule } from '../../compiler/rules/reference-call-proof.js';

function parsedCall(source: string) {
  const program = parse(source);
  const statement = program.body.at(-1);
  assert.equal(statement?.kind, 'expression');
  assert.equal(statement.kind === 'expression' && statement.expression.kind, 'call');
  if (statement.kind !== 'expression' || statement.expression.kind !== 'call') throw new Error('expected call');
  return statement.expression;
}

test('AST-first call-reference planning distinguishes property References from value calls', () => {
  const property = planCallReference(parsedCall('const o={m:1}; o.m();').callee);
  assert.deepEqual(property, {
    kind: 'property',
    thisArgument: 'base',
    evaluateCalleeOnce: true,
    argumentOrder: 'left-to-right',
    property: 'm',
  });

  const value = planCallReference(parsedCall('const f=1; f();').callee);
  assert.deepEqual(value, {
    kind: 'value',
    thisArgument: 'undefined',
    evaluateCalleeOnce: true,
    argumentOrder: 'left-to-right',
  });
});

test('pinned canonical j2cs method/this rules are connected through explicit fail-closed facts', async () => {
  const database = await loadRules(path.join(ROOT, 'rule-db'));

  const propertyPlan = planCallReference(parsedCall('const o={m:1}; o.m();').callee);
  const propertyFacts = referenceCallFacts(propertyPlan, {
    propertyResolvesToKnownJsFunction: true,
    getterEffectsAccountedFor: true,
    methodNotProxy: true,
    sideEffectfulCalleeOrArguments: true,
  });
  const method = proveReferenceRule(database, 'function.method-call.this-binding', propertyFacts);
  assert.equal(method.verdict, 'proven');
  assert.equal(method.rule.rule.target.helper, 'JsFunction.Call');
  assert.equal(method.rule.sha256.length, 64);

  const order = proveReferenceRule(database, 'function.evaluation-order.call', propertyFacts);
  assert.equal(order.verdict, 'proven');

  const missingProxyProof = referenceCallFacts(propertyPlan, {
    propertyResolvesToKnownJsFunction: true,
    getterEffectsAccountedFor: true,
  });
  assert.equal(proveReferenceRule(database, 'function.method-call.this-binding', missingProxyProof).verdict, 'unknown');

  const disprovenProxy = referenceCallFacts(propertyPlan, {
    propertyResolvesToKnownJsFunction: true,
    getterEffectsAccountedFor: true,
    methodNotProxy: false,
  });
  assert.equal(proveReferenceRule(database, 'function.method-call.this-binding', disprovenProxy).verdict, 'disproven');

  assert.equal(proveReferenceRule(database, 'function.method-extraction-loses-this',
    methodExtractionFacts(true, true)).verdict, 'proven');

  assert.equal(proveReferenceRule(database, 'function.this.strict',
    ordinaryThisFacts('strict')).verdict, 'proven');

  assert.equal(proveReferenceRule(database, 'function.this.sloppy',
    ordinaryThisFacts('sloppy')).verdict, 'unknown',
    'sloppy this must stay unavailable until the host global object is proven');

  assert.equal(proveReferenceRule(database, 'function.this.sloppy',
    ordinaryThisFacts('sloppy', true)).verdict, 'proven');
});
