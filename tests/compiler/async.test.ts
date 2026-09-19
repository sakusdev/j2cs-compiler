import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, createCompiler } from '../../compiler/index.js';
import { CompileError } from '../../compiler/diagnostics/index.js';

const index = await createCompiler();

function rejects(source: string, code: string): void {
  assert.throws(() => compile(source, index, 'async-case.js'), (e: unknown) => {
    assert.ok(e instanceof CompileError);
    assert.equal(e.diagnostic.code, code);
    return true;
  });
}

test('primitive await selects the pinned canonical rule and never emits CLR Task await', () => {
  const result = compile(`
    async function f() {
      console.log('before');
      const x = await 1;
      console.log(x);
      await null;
      console.log('after');
    }
    f();
    console.log('sync');
  `, index);
  assert.ok(result.trace.some(t => t.ruleId === 'async.await.non-promise-yield'
    && t.strategy === 'helper' && t.requirements.verdict === 'proven'));
  assert.match(result.source, /JsAsync\.AwaitValue/);
  assert.match(result.source, /JsMicrotaskQueue\.Drain/);
  assert.ok(!/\bTask\b|Task\.Run|Task\.Yield/.test(result.source));
});

test('queueMicrotask selects the canonical helper with a statically resolved callback', () => {
  const result = compile(`
    function callback() { console.log('microtask'); }
    queueMicrotask(callback);
    console.log('sync');
  `, index);
  assert.ok(result.trace.some(t => t.ruleId === 'async.queue-microtask'
    && t.strategy === 'helper' && t.requirements.verdict === 'proven'));
  assert.match(result.source, /JsMicrotaskQueue\.Enqueue\(F\d+\)/);
});

test('Promise-dependent and structurally unsafe async entry paths fail closed', () => {
  rejects('async function f(){ return 1; } const p = f();', 'E_ASYNC_PROMISE_DEPENDENCY');
  rejects('async function f(){ console.log(await 1); } f();', 'E_ASYNC_AWAIT_SHAPE');
  rejects('async function f(){ if (true) { await 1; } } f();', 'E_ASYNC_CONTROL_FLOW');
  rejects('async function f(){ await 1; } queueMicrotask(f);', 'E_MICROTASK_ASYNC_CALLBACK');
});

test('queueMicrotask callback contract does not widen general function-value support', () => {
  rejects('function f(){} const x=f;', 'E_FUNCTION_VALUE');
  rejects('queueMicrotask(() => console.log(1));', 'E_UNSUPPORTED_SYNTAX');
});
