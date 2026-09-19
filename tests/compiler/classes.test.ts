import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, createCompiler } from '../../compiler/index.js';
import { CompileError } from '../../compiler/diagnostics/index.js';
import { parseClassProgram } from '../../compiler/parser/classes.js';

const index = await createCompiler();

test('class parser normalizes declarations and class expressions without leaking TypeScript AST', () => {
  const parsed = parseClassProgram(`
    class A { static x = 1; static value(){ return A.x; } }
    const B = class Inner { static y = 2; };
  `, 'classes.js');
  assert.ok(parsed);
  assert.equal(parsed.classes.length, 2);
  assert.equal(parsed.classes[0]!.bindingName, 'A');
  assert.equal(parsed.classes[1]!.bindingName, 'B');
  assert.equal(parsed.classes[1]!.expression, true);
  assert.equal(parsed.classes[1]!.displayName, 'Inner');
});

test('class compiler pins canonical static method and eager initialization proofs', () => {
  const result = compile(`
    class C { static x = 3; static value(){ return C.x; } }
    console.log(C.value());
  `, index, 'classes.js');
  const ids = new Set(result.trace.map(t => t.ruleId));
  assert.ok(ids.has('classes.static.initialization_order'));
  assert.ok(ids.has('classes.static.method_direct'));
  assert.match(result.source, /JsClass\.Initialize\(C0/);
  assert.match(result.source, /private static JsValue M0_0\(\)/);
});

test('subclass static field access selects constructor-object inheritance runtime proof', () => {
  const result = compile(`
    class A { static x = 1; }
    class B extends A {}
    console.log(B.x);
    B.x = 2;
    console.log(A.x);
    console.log(B.x);
  `, index, 'classes.js');
  assert.ok(result.trace.some(t => t.ruleId === 'classes.static.field_inheritance' && t.strategy === 'runtime'));
  assert.match(result.source, /JsClass\.CreateDerived/);
  assert.match(result.source, /JsClass\.SetStatic\(C1, "x"/);
});

test('instance construction paths are explicit fail-closed dependencies', () => {
  assert.throws(() => compile('class C { x = 1; }', index, 'instance.js'), error =>
    error instanceof CompileError
      && error.diagnostic.code === 'E_CLASS_DEPENDENCY'
      && error.diagnostic.message.includes('LANGUAGE_CONSTRUCTORS_NEW_TARGET'));
  assert.throws(() => compile('class B {} class D extends B { constructor(){ super(); } }', index, 'derived.js'), error =>
    error instanceof CompileError && error.diagnostic.code === 'E_CLASS_DEPENDENCY');
});

test('static method replacement invalidates direct-method proof', () => {
  assert.throws(() => compile(`
    class C { static value(){ return 1; } }
    C.value = 2;
  `, index, 'replace.js'), error =>
    error instanceof CompileError && error.diagnostic.code === 'E_CLASS_METHOD_REPLACEMENT');
});
