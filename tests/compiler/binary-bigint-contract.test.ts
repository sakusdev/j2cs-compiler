import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, createCompiler } from '../../compiler/index.js';
import { CompileError } from '../../compiler/diagnostics/index.js';
import {
  BINARY_BIGINT_RULE_DB_COMMIT,
  BINARY_BIGINT_RULES,
  proveBinaryBigIntRule,
  validateBinaryBigIntRuleContract,
} from '../../compiler/rules/binary-bigint-contract.js';

const index = await createCompiler();

test('binary/BigInt runtime contract is connected to canonical pinned j2cs rules', () => {
  assert.equal(BINARY_BIGINT_RULE_DB_COMMIT, '35ca8d859f9352e90ee2497f4ac8f6edb9c19ed1');
  assert.deepEqual(validateBinaryBigIntRuleContract(index.database), []);
  assert.equal(BINARY_BIGINT_RULES.length, 16);
  for (const contract of BINARY_BIGINT_RULES) {
    const loaded = index.database.byId.get(contract.id);
    assert.ok(loaded, `missing ${contract.id}`);
    assert.equal(loaded.rule.category, contract.category);
    assert.equal(loaded.rule.strategy, contract.strategy);
    if (contract.helper !== undefined) assert.equal(loaded.rule.target.helper, contract.helper);
  }
});

test('binary/BigInt proof facts are three-valued and fail closed', () => {
  assert.equal(proveBinaryBigIntRule('bigint.literal', {
    'ast.kind': 'BigIntLiteral',
    'literal.parsedExactly': true,
  }), 'proven');
  assert.equal(proveBinaryBigIntRule('bigint.literal', {
    'ast.kind': 'BigIntLiteral',
  }), 'unknown');
  assert.equal(proveBinaryBigIntRule('bigint.literal', {
    'ast.kind': 'NumericLiteral',
    'literal.parsedExactly': true,
  }), 'disproven');

  assert.equal(proveBinaryBigIntRule('coercion.bigint-function.primitive', {
    'binding.intrinsic': '%BigInt%',
    'builtin.pristine': true,
    'argument.domain': 'primitive',
  }), 'proven');

  assert.equal(proveBinaryBigIntRule('binary.typedarray.indexed-write-bigint', {
    'receiver.content': 'BigInt',
    'receiver.proxyIntercepted': false,
    'index.canonicalNumeric': true,
  }), 'proven');
  assert.equal(proveBinaryBigIntRule('binary.typedarray.indexed-write-bigint', {
    'receiver.content': 'BigInt',
    'receiver.proxyIntercepted': false,
  }), 'unknown');
  assert.equal(proveBinaryBigIntRule('unknown.rule', {}), 'unknown');
});

test('unmerged parser/value-lattice integration remains fail-closed', () => {
  assert.throws(() => compile('const x = 1n;', index, 'bigint.js'), (error: unknown) => {
    assert.ok(error instanceof CompileError);
    assert.equal(error.diagnostic.code, 'E_UNSUPPORTED_SYNTAX');
    return true;
  });
});
