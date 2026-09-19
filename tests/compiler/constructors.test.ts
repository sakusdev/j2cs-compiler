import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, createCompiler } from '../../compiler/index.js';
import { parse } from '../../compiler/parser/index.js';
import { CompileError } from '../../compiler/diagnostics/index.js';

const index = await createCompiler();

function rejects(source: string, code: string): void {
  assert.throws(() => compile(source, index, 'constructor-case.js'), (error: unknown) => {
    assert.ok(error instanceof CompileError);
    assert.equal(error.diagnostic.code, code);
    return true;
  });
}

test('parser normalizes new, this and new.target without leaking TypeScript AST nodes', () => {
  const ast = parse('function C(x){ this.x = new.target; } const value = new C(1);');
  assert.equal(ast.body[0]?.kind, 'function');
  const fn = ast.body[0]!;
  assert.equal(fn.kind === 'function' && fn.body.body[0]?.kind, 'expression');
  assert.equal(ast.body[1]?.kind === 'variable' && ast.body[1].initializer?.kind, 'construct');
  assert.ok(!JSON.stringify(ast).includes('SyntaxKind'));
});

test('ordinary construction is connected to canonical j2cs rules and explicit runtime identity', () => {
  const result = compile(`
    function C(x) { this.x = x; this.constructed = new.target !== undefined; }
    const c = new C(3);
    console.log(c.x, c.constructed);
    function Override() { this.x = 1; return {x: 9}; }
    const replacement = new Override();
    console.log(replacement.x);
    function Called() { return new.target === undefined; }
    console.log(Called());
  `, index);
  const ids = new Set(result.trace.map(item => item.ruleId));
  assert.ok(ids.has('function.constructor.new-ordinary'));
  assert.ok(ids.has('function.constructor.object-return-overrides-this'));
  assert.ok(ids.has('function.new-target'));
  assert.match(result.source, /JsConstructor\.CreateReceiver/);
  assert.match(result.source, /JsConstructor\.Identity/);
  assert.match(result.source, /JsConstructor\.SelectResult/);
  assert.match(result.source, /private static JsValue K\d+/);
  assert.ok(!/\bdynamic\b|\bobject\b/.test(result.source));
});

test('constructor lane fails closed for adjacent unsupported call and target cases', () => {
  rejects('const x = 1; new x();', 'E_CONSTRUCT_TARGET');
  rejects('new (1)();', 'E_CONSTRUCT_TARGET');
  rejects('function C(x){}; new C();', 'E_ARITY');
  rejects('function C(){ return this; } C();', 'E_THIS_CALL_UNSUPPORTED');
  rejects('this.x = 1;', 'E_THIS_CONTEXT');
  rejects('function C(){}; console.log(C.prototype);', 'E_FUNCTION_VALUE');
});
