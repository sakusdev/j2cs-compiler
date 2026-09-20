import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, createCompiler } from '../../compiler/index.js';
import { CompileError } from '../../compiler/diagnostics/index.js';

const index = await createCompiler();

function rejects(source: string, code: string): void {
  assert.throws(() => compile(source, index, 'generator-case.js'), (error: unknown) => {
    assert.ok(error instanceof CompileError);
    assert.equal(error.diagnostic.code, code);
    return true;
  });
}

test('sync generator lane records canonical j2cs proof decisions', () => {
  const result = compile(`
    function* g(){ const x = yield 1; return x; }
    const it = g();
    let r = it.next();
    console.log(r.value === 1, r.done);
    r = it.next(9);
    console.log(r.value === 9, r.done);
    r = it.next();
    console.log(r.value === undefined, r.done);
  `, index);
  const ids = new Set(result.trace.map(t => t.ruleId));
  for (const id of [
    'generator.call-lazy',
    'generator.yield.value',
    'generator.return.statement-value',
    'generator.next.initial-argument-ignored',
    'generator.next.resume-value',
    'generator.completed.next',
  ]) assert.ok(ids.has(id), 'missing proof trace ' + id);
  assert.match(result.source, /G0Machine/);
  assert.match(result.source, /JsGenerator\.Next/);
  assert.ok(!/\bdynamic\b|\bobject\b/.test(result.source));
});

test('return is proven separately for start, suspended yield and completed states', () => {
  const before = compile(`
    function* g(){ console.log('run'); yield 1; }
    const it = g(); const r = it.return(3);
    console.log(r.value === 3, r.done);
  `, index);
  assert.ok(before.trace.some(t => t.ruleId === 'generator.return.before-start'));

  const suspended = compile(`
    function* g(){ yield 1; yield 2; }
    const it = g(); let r = it.next(); r = it.return(8);
    console.log(r.value === 8, r.done);
  `, index);
  assert.ok(suspended.trace.some(t => t.ruleId === 'generator.return.suspended'));

  const completed = compile(`
    function* g(){ return 1; }
    const it = g(); let r = it.next(); r = it.return(8);
    console.log(r.value === 8, r.done);
  `, index);
  assert.ok(completed.trace.some(t => t.ruleId === 'generator.completed.return'));
});

test('yield star generator delegation connects delegate, resume, completion and return-forward rules', () => {
  const result = compile(`
    function* inner(){ yield 1; return 4; }
    function* outer(){ const x = yield* inner(); return x; }
    const it = outer(); let r = it.next(); r = it.next();
    console.log(r.value === 4, r.done);
  `, index);
  const ids = new Set(result.trace.map(t => t.ruleId));
  for (const id of [
    'generator.yield-star.delegate-next',
    'generator.yield-star.resume-forward',
    'generator.yield-star.completion-value',
    'generator.yield-star.return-forward',
  ]) assert.ok(ids.has(id), 'missing yield* proof trace ' + id);
});

test('bare yield and array delegation close use dedicated canonical rules', () => {
  const bare = compile(`
    function* g(){ return yield; }
    const it = g(); let r = it.next(); r = it.next(8);
    console.log(r.value === 8, r.done);
  `, index);
  assert.ok(bare.trace.some(t => t.ruleId === 'generator.yield.undefined'));

  const array = compile(`
    function* g(){ yield* [1, 2]; return 4; }
    const it = g(); let r = it.next(); r = it.return(9);
    console.log(r.value === 9, r.done);
  `, index);
  assert.ok(array.trace.some(t => t.ruleId === 'generator.yield-star.return-missing'));
});

test('adjacent generator features stay fail closed until owning lanes merge', () => {
  rejects('async function* g(){ yield 1; }', 'E_GENERATOR_ASYNC_DEFERRED');
  rejects('function* g(){ try { yield 1; } finally {} }', 'E_GENERATOR_EXCEPTIONS_DEPENDENCY');
  rejects('function* g(){ yield 1; } const it=g(); it.throw(2);', 'E_GENERATOR_EXCEPTIONS_DEPENDENCY');
  rejects('function* g(){ for (const x of [1]) yield x; }', 'E_GENERATOR_FOR_OF_DEFERRED');
  rejects('function* g(){ const x = 1 + (yield 2); return x; }', 'E_GENERATOR_YIELD_CONTEXT');
});
