import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, createCompiler } from '../../compiler/index.js';
import { parse } from '../../compiler/parser/index.js';
import { CompileError } from '../../compiler/diagnostics/index.js';

const index = await createCompiler();

test('parser normalizes throw, catch binding, omitted catch binding, and finally', () => {
  const ast = parse("try { throw 1; } catch (e) { throw e; } finally { console.log('f'); }");
  const statement = ast.body[0];
  assert.equal(statement?.kind, 'try');
  assert.equal(statement?.kind === 'try' && statement.catchClause?.binding?.name, 'e');
  assert.equal(statement?.kind === 'try' && statement.finallyBlock?.kind, 'block');
  const omitted = parse('try { throw 1; } catch { console.log(1); }').body[0];
  assert.equal(omitted?.kind === 'try' && omitted.catchClause?.binding, undefined);
});

test('throw and catch select pinned canonical completion rules', () => {
  const r = compile("const token={x:7}; try { throw token; } catch (e) { console.log(e===token,e.x); }", index);
  const ids = new Set(r.trace.map(t => t.ruleId));
  for (const id of [
    'control.abrupt.completion-kinds',
    'control.throw.value',
    'control.throw.expression-abrupt',
    'control.try.catch-thrown-value',
    'control.try.catch-binding-scope',
    'control.try.catch-only-throw-completion',
  ]) assert.ok(ids.has(id), `missing ${id}`);
  for (const t of r.trace.filter(t => t.ruleId.startsWith('control.'))) assert.equal(t.requirements.verdict, 'proven');
  assert.match(r.source, /throw JsException\.Wrap\(/);
  assert.match(r.source, /catch \(JsException __j2cs_exception\d+\)/);
  assert.match(r.source, /JsException\.Unwrap\(__j2cs_exception\d+\)/);
});

test('omitted catch binding selects its canonical rule without creating a lexical binding', () => {
  const r = compile("try { throw 'x'; } catch { console.log('caught'); }", index);
  assert.ok(r.trace.some(t => t.ruleId === 'control.try.catch-omitted-binding' && t.requirements.verdict === 'proven'));
  assert.match(r.source, /catch \(JsException __j2cs_exception\d+\)/);
  assert.doesNotMatch(r.source, /JsException\.Unwrap/);
});

test('finally proof distinguishes normal preservation from abrupt override', () => {
  const normal = compile("try { throw 'x'; } catch(e) { console.log(e); } finally { console.log('f'); }", index);
  assert.ok(normal.trace.some(t => t.ruleId === 'control.try.finally-normal-preserves-completion'
    && t.requirements.verdict === 'proven'));
  const abrupt = compile("try { throw 'a'; } finally { throw 'b'; }", index);
  assert.ok(abrupt.trace.some(t => t.ruleId === 'control.try.finally-abrupt-overrides'
    && t.requirements.verdict === 'proven'));
});

test('return and loop-control completions cross finally via explicit signals', () => {
  const r = compile(`
    function f(){ try { return 1; } finally { console.log('f'); } }
    let i=0; while(i<2){ i++; try { if(i===1) continue; break; } finally { console.log(i); } }
    console.log(f());
  `, index);
  const ids = new Set(r.trace.map(t => t.ruleId));
  assert.ok(ids.has('control.try.finally-runs-on-return'));
  assert.ok(ids.has('control.try.finally-runs-on-break-continue'));
  assert.match(r.source, /throw JsCompletion\.Return\(/);
  assert.match(r.source, /throw JsCompletion\.Continue\(\)/);
  assert.match(r.source, /throw JsCompletion\.Break\(\)/);
  assert.match(r.source, /JsCompletionKind\.Return/);
  assert.match(r.source, /JsCompletionKind\.Continue/);
  assert.match(r.source, /JsCompletionKind\.Break/);
});

test('ordinary function throw summaries select synchronous propagation rule', () => {
  const r = compile("function boom(){throw 'x';} try { boom(); } catch(e) { console.log(e); }", index);
  assert.ok(r.trace.some(t => t.ruleId === 'control.abrupt.sync-function-propagation'
    && t.requirements.verdict === 'proven'));
});

test('nested finally ordering is connected to canonical proof', () => {
  const r = compile("try { try { throw 'a'; } finally { console.log('i'); } } finally { console.log('o'); }", index);
  assert.ok(r.trace.some(t => t.ruleId === 'control.try.nested-finally-order'
    && t.requirements.verdict === 'proven'));
});

test('catch destructuring remains explicitly fail-closed', () => {
  assert.throws(() => compile('try { throw 1; } catch ({x}) { console.log(x); }', index), (e: unknown) => {
    assert.ok(e instanceof CompileError);
    assert.equal(e.diagnostic.code, 'E_UNSUPPORTED_SYNTAX');
    return true;
  });
});
