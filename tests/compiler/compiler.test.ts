import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, createCompiler } from '../../compiler/index.js';
import { parse } from '../../compiler/parser/index.js';
import { CompileError } from '../../compiler/diagnostics/index.js';
const index = await createCompiler();
function rejects(source: string, code: string): void {
  assert.throws(() => compile(source, index, 'case.js'), (e: unknown) => {
    assert.ok(e instanceof CompileError); assert.equal(e.diagnostic.code, code); assert.ok(e.diagnostic.span); return true;
  });
}
test('parser normalizes JS/TS and preserves source locations', () => {
  const ast = parse('\nconst x: number = 10;', 'input.ts');
  assert.equal(ast.body[0]?.kind, 'variable'); assert.equal(ast.body[0]?.span.line, 2);
  assert.ok(!JSON.stringify(ast).includes('SyntaxKind'));
});
test('rule DB is loaded/indexed and primitive proof gates native addition', () => {
  assert.equal(index.database.byId.size, 2681);
  assert.ok(index.database.byCategory.get('operators')!.length > 50);
  assert.ok(index.database.byStrategy.get('native')!.length > 0);
  const numeric = compile('const x = 10; console.log(x + 20);', index);
  assert.ok(numeric.trace.some(t => t.ruleId === 'operators.addition.number' && t.requirements.verdict === 'proven'));
  const mixed = compile("console.log('x' + 1);", index);
  assert.ok(mixed.trace.some(t => t.ruleId === 'operators.addition.dynamic' && t.strategy === 'helper'));
  assert.ok(!mixed.trace.some(t => t.ruleId === 'operators.addition.number'));
});
test('object/array core selects canonical safe rules and preserves identity in emitted runtime calls', () => {
  const r = compile(`
    const o={a:1}; const alias=o; const a=[1,,undefined];
    a[1]=undefined; a.push(2); console.log(a.length,Object.hasOwn(a,1),o===alias,o==={a:1});
  `, index);
  assert.ok(r.trace.some(t => t.ruleId === 'array.length.read' && t.requirements.verdict === 'proven'));
  assert.ok(r.trace.some(t => t.ruleId === 'array.prototype.push' && t.requirements.verdict === 'proven'));
  assert.ok(r.trace.some(t => t.ruleId === 'object.has-own' && t.requirements.verdict === 'proven'));
  assert.ok(r.trace.some(t => t.ruleId === 'operators.strict-equality.dynamic' && t.requirements.verdict === 'proven'));
  assert.match(r.source, /JsObject\.Create\(\)/); assert.match(r.source, /JsArray\.Create\(3d\)/);
  assert.ok(!/\bdynamic\b|\bobject\b/.test(r.source));
});
test('parser normalizes classic loops and mutation operators', () => {
  const ast = parse('for (let i=0; i<2; i++) { while (false) { break; } }');
  assert.equal(ast.body[0]?.kind, 'for');
  assert.equal(ast.body[0]?.kind === 'for' && ast.body[0].update?.kind, 'update');
});
test('canonical mutation adapters are selected only with proof', () => {
  const r = compile('let x=1; x += 2; x++; --x;', index);
  assert.ok(r.trace.some(t => t.ruleId === 'operators.addition-assignment'));
  assert.ok(r.trace.some(t => t.ruleId === 'operators.postfix-increment'));
  assert.ok(r.trace.some(t => t.ruleId === 'operators.prefix-decrement'));
});
test('loop fixed point widens mutated bindings before lowering following expressions', () => {
  const r = compile("let v=1; let i=0; while(i<1){v='x'; i++;} console.log(v+1);", index);
  assert.ok(r.trace.some(t => t.ruleId === 'operators.addition.dynamic'));
});
test('type annotations are not semantic evidence', () => {
  const r = compile("const x: number = 'a'; console.log(x + 1);", index, 'input.ts');
  assert.ok(r.trace.some(t => t.ruleId === 'operators.addition.dynamic'));
});
test('shadowed intrinsic names stay lexical', () => {
  const r = compile('const NaN = 42; console.log(NaN);', index);
  assert.ok(!r.trace.some(t => t.ruleId === 'values.nan.intrinsic-binding'));
});
test('coercive primitive operators and globals select canonical j2cs adapters', () => {
  const r = compile("console.log('5' == 5, '2' < 10, +' 42 ', isFinite('3'), isNaN('x'), parseFloat('1.5x'), parseInt('10', 2));", index);
  const ids = new Set(r.trace.map(t => t.ruleId));
  for (const id of ['operators.loose-equality', 'operators.less-than.dynamic', 'operators.unary-plus.dynamic',
    'global.is-finite.primitive', 'global.is-nan.primitive', 'global.parse-float.string',
    'global.parse-int.string-known-radix']) assert.ok(ids.has(id), `missing ${id}`);
  const native = compile('console.log(isFinite(3), isNaN(NaN));', index);
  assert.ok(native.trace.some(t => t.ruleId === 'global.is-finite.number' && t.strategy === 'native'));
  assert.ok(native.trace.some(t => t.ruleId === 'global.is-nan.number' && t.strategy === 'native'));
});
const diagnostics: [string, string, string][] = [
  ['parse error', 'const = ;', 'E_PARSE'],
  ['var', 'var x = 1;', 'E_UNSUPPORTED_SYNTAX'],
  ['bigint', 'const x = 1n;', 'E_UNSUPPORTED_SYNTAX'],
  ['for-in', 'for (const k in value) {}', 'E_UNSUPPORTED_SYNTAX'],
  ['for-of', 'for (const x of [1]) {}', 'E_UNSUPPORTED_SYNTAX'],
  ['const update', 'const x=1; x++;', 'E_IMMUTABLE_WRITE'],
  ['unsafe string update', "let x='1'; x++;", 'E_NO_SAFE_RULE'],
  ['unsafe numeric compound coercion', "let x=5; x -= '2';", 'E_NO_SAFE_RULE'],
  ['for lexical scope', 'for (let i=0;i<1;i++) {} console.log(i);', 'E_UNRESOLVED_BINDING'],
  ['object allocation in loop', 'let i=0; while(i<1){ const x={a:1}; i++; }', 'E_OBJECT_LOOP_ALLOCATION'],
  ['dynamic computed property', "const o={x:1}; const k='x'; console.log(o[k]);", 'E_UNSUPPORTED_SYNTAX'],
  ['object proto literal', 'const x={__proto__: null};', 'E_UNSUPPORTED_SYNTAX'],
  ['prototype read', 'const x={}; console.log(x.toString);', 'E_PROTOTYPE_PROPERTY'],
  ['prototype mutation', 'const x={}; x.__proto__={};', 'E_PROTOTYPE_MUTATION'],
  ['array length write', 'const x=[]; x.length=4;', 'E_ARRAY_LENGTH_WRITE'],
  ['array method override', 'const x=[]; x.push=1; x.push(2);', 'E_ARRAY_METHOD_OVERRIDDEN'],
  ['object coercing addition', "const x={}; console.log('x'+x);", 'E_NO_SAFE_RULE'],
  ['console object inspection', 'console.log({a:1});', 'E_CONSOLE_OBJECT'],
  ['object function boundary', 'function f(){ return {}; } f();', 'E_OBJECT_FUNCTION_BOUNDARY'],
  ['optional chain', 'console?.log(1);', 'E_UNSUPPORTED_SYNTAX'],
  ['const without initializer', 'const x;', 'E_CONST_INIT'],
  ['const write', 'const x = 1; x = 2;', 'E_IMMUTABLE_WRITE'],
  ['unresolved', 'console.log(missing);', 'E_UNRESOLVED_BINDING'],
  ['direct TDZ', 'console.log(x); let x = 1;', 'E_TDZ'],
  ['self TDZ', 'let x = x;', 'E_TDZ'],
  ['block shadow TDZ', 'let x = 1; { console.log(x); let x = 2; }', 'E_TDZ'],
  ['duplicate binding', 'const x = 1; let x = 2;', 'E_PARSE'],
  ['duplicate parameter', 'function f(x,x) { return x; }', 'E_DUPLICATE_BINDING'],
  ['parameter redeclaration', 'function f(x) { let x = 2; }', 'E_PARSE'],
  ['console shadow', 'const console = 1; console.log(2);', 'E_INTRINSIC_SHADOWED'],
  ['console future shadow', 'console.log(2); const console = 1;', 'E_INTRINSIC_SHADOWED'],
  ['console reassignment', 'console = 1;', 'E_IMMUTABLE_WRITE'],
  ['console property override', 'console.log = 1;', 'E_INTRINSIC_MUTATION'],
  ['console escape', 'const c = console;', 'E_INTRINSIC_ESCAPE'],
  ['format string', "console.log('%d', 2);", 'E_CONSOLE_FORMAT'],
  ['unknown format string', "const fmt = 'x'; console.log(fmt, 2);", 'E_CONSOLE_FORMAT'],
  ['nested function', 'function f() { function g() {} }', 'E_NESTED_FUNCTION'],
  ['block function', '{ function f() {} }', 'E_NESTED_FUNCTION'],
  ['capture', 'const x=1; function f(){return x;}', 'E_CAPTURE'],
  ['recursion', 'function f(){return f();} f();', 'E_RECURSION'],
  ['missing argument', 'function f(x){return x;} f();', 'E_ARITY'],
  ['extra argument', 'function f(x){return x;} f(1,2);', 'E_ARITY'],
  ['function escape', 'function f(){} const g=f;', 'E_FUNCTION_VALUE'],
  ['function reassignment', 'function f(){} f=1;', 'E_IMMUTABLE_WRITE'],
  ['indirect call', 'const x=1; x();', 'E_INDIRECT_CALL'],
  ['return outside function', 'return 1;', 'E_PARSE'],
  ['unsupported numeric coercion', "console.log('3' - 1);", 'E_NO_SAFE_RULE'],
  ['mixed primitive union intrinsic', "let x=1; if (true) x='1'; console.log(isFinite(x));", 'E_NO_SAFE_RULE'],
  ['eval', "eval('1');", 'E_UNRESOLVED_BINDING'],
  ['this', 'function f(){return this;}', 'E_UNSUPPORTED_SYNTAX'],
  ['argument access', 'function f(){return arguments;}', 'E_UNRESOLVED_BINDING'],
  ['async', 'async function f(){}', 'E_UNSUPPORTED_SYNTAX'],
  ['unbraced lexical declaration', 'if (true) let x=1;', 'E_UNSUPPORTED_SYNTAX'],
  ['TS annotation in JS', 'const x: number = 1;', 'E_UNSUPPORTED_SYNTAX'],
  ['strict reserved binding', '"use strict"; let yield = 1;', 'E_PARSE'],
  ['strict legacy octal', '"use strict"; console.log(010);', 'E_PARSE'],
];
for (const [name, source, code] of diagnostics) test(`explicit diagnostic: ${name}`, () => rejects(source, code));
test('output is deterministic and C# keywords/unicode identifiers are mangled', () => {
  const source = 'const @bad = 1;';
  assert.throws(() => compile(source, index));
  const accepted = 'let className=1; let namespace=2; const 日本語=3; console.log(className+namespace+日本語);';
  assert.equal(compile(accepted, index).source, compile(accepted, index).source);
  assert.ok(!compile(accepted, index).source.includes('日本語'));
});
