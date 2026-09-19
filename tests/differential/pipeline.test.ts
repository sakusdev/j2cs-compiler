import test from 'node:test';
import assert from 'node:assert/strict';
import { createCompiler } from '../../compiler/index.js';
import { differential, type Fixture } from './harness.js';
const index = await createCompiler();
const fixtures: Fixture[] = [
  { name: 'required-mvp', source: 'const x = 10; const y = x + 20; console.log(y);', stdout: '30\n' },
  { name: 'literals-and-bindings', source: `
    const n = null; let uninitialized; const flag = true; const text = 'こんにちは';
    console.log(10, 'text', flag, false, n, uninitialized); console.log(text);
    { const text = 'inner'; console.log(text); } console.log(text);
    let x = 1; console.log(x = 2, x); x = 'changed'; console.log(x); 1 + 2;
  ` },
  { name: 'binary64-arithmetic', source: `
    console.log(7 / 2, 7 - 2, 3 * 4, -5 % 2, 5 % -2);
    console.log(0.1 + 0.2, 9007199254740992 + 1, 1 / 0, 0 / 0, 1 / -0);
    console.log(-0, -(-0), -Infinity, Infinity - Infinity, 1e308 * 10);
    console.log(NaN < 1, NaN <= 1, NaN > 1, NaN >= 1, NaN === NaN, 0 === -0);
    console.log(2 < 3, 2 <= 2, 5 > 3, 5 >= 5, 2 !== 3, 2 === 2);
  ` },
  { name: 'strings-and-coercing-addition', source: `
    console.log('ab' + 'cd'); console.log('5' + 1); console.log(1 + '5');
    console.log(true + 1, null + 1, undefined + 1);
    console.log('x' + null); console.log('x' + undefined); console.log('x' + false); console.log('x' + -0);
    console.log('é' === 'e\\u0301', 'x' === 'x', true === false, null === null);
    console.log(null === undefined, 1 === '1', NaN !== NaN, undefined === undefined);
    console.log('\\ud83d' + '\\ude00'); console.log('\\ud800'); console.log('a\\u0000b');
    console.log('%s'); console.log(); console.log('plain', 1, null, true);
  ` },
  { name: 'truthiness-and-flow-joins', source: `
    if (0) console.log('bad'); else console.log('zero');
    if (-0) console.log('bad'); else console.log('negative-zero');
    if (NaN) console.log('bad'); else console.log('nan');
    if ('') console.log('bad'); else console.log('empty');
    if (null) console.log('bad'); else console.log('null');
    if (undefined) console.log('bad'); else console.log('undefined');
    if ('hello') console.log('truthy'); if (1) { console.log('one'); }
    if (false) console.log('bad'); else if (true) console.log('bool');
    console.log(!0, !1, !'', !'x', !null, !undefined, !NaN, !true);
    let v; if (true) v = 5; else v = 's'; console.log(v + 1);
    if (v) console.log('joined-truthy'); console.log(v === 5);
    let w = 1; if (false) w = 's'; console.log(w + 1);
  ` },
  { name: 'primitive-coercion-equality-globals', source: `
    console.log(null == undefined, null == 0, false == 0, true == 1);
    console.log('' == 0, '   ' == 0, '0x10' == 16, Infinity == 'Infinity');
    console.log(NaN == NaN, NaN != NaN, undefined != null);
    console.log(+'', +'   ', +'0x10', +'0b11', +'0o10', +true, +null, +undefined);
    console.log(+'Infinity', +'-Infinity', +'not-a-number', 1 / +'-0');
    console.log('2' < 10, '20' < '3', '2' >= 2, null <= 0, undefined < 1, 'x' > 0);
    console.log(isFinite(''), isFinite('3'), isFinite(undefined), isFinite(Infinity));
    console.log(isNaN('x'), isNaN(''), isNaN(undefined), isNaN(NaN));
    console.log(parseFloat('  -1.25e2px'), parseFloat('0x10'), parseFloat(undefined));
    console.log(parseInt('  -12px'), parseInt('0x10'), parseInt('1012', 2), parseInt(15.9, 10));
  ` },
  { name: 'objects-arrays-own-data', source: `
    let tick=0;
    const o={a:(tick=1),a:(tick=2),b:3}; const alias=o;
    console.log(tick,o.a,o.b);
    console.log(o===alias,o==={a:2},Object.hasOwn(o,'a'),Object.hasOwn(o,'missing'));
    o.c=4; console.log(o.c);
    const a=[1,,undefined];
    console.log(a.length,Object.hasOwn(a,0),Object.hasOwn(a,1),Object.hasOwn(a,2));
    console.log(a[1]===undefined,a[2]===undefined);
    a[1]=undefined; console.log(Object.hasOwn(a,1),a.length);
    a[4]=5; console.log(a.length,Object.hasOwn(a,3),a[4]);
    console.log(a.push(6,undefined),a.length,Object.hasOwn(a,6),a[5],a[6]===undefined);
    console.log(a===a,a===[]); console.log(!a); if(a) console.log('array-truthy');
  ` },
  { name: 'array-string-builtins', source: `
    const a=[NaN,,undefined,3];
    console.log(a.length,a.at(-1),a.at(1)===undefined,a.includes(NaN),a.includes(undefined),a.indexOf(undefined));
    console.log([1,2,1].includes(1,-1),[1,2,1].indexOf(1,-1),[10,20].at(1.9));
    console.log(a.pop(),a.length,Object.hasOwn(a,3));
    const o={}; const refs=[o]; console.log(refs.includes(o),refs.indexOf(o));
    const s='A\\ud83d\\ude00B';
    console.log(s.length,s.at(1)==='\\ud83d',s.at(-2)==='\\ude00',s.charAt(2)==='\\ude00',s.charAt(99)==='');
    console.log(s.includes('\\ud83d'),s.indexOf('B'),s.includes('',99));
    console.log(s.slice(1,-1)==='\\ud83d\\ude00',s.substring(3,1)==='\\ud83d\\ude00');
    console.log('abcabc'.indexOf('bc',2),'abcabc'.includes('bc',4));
  ` },
  { name: 'functions-and-returns', source: `
    console.log(add(10, 20));
    function add(a, b) { return a + b; }
    console.log(add('a', 'b')); console.log(add(true, 1));
    function arithmetic(a,b) { let x = a; x = x * b; return x / 2 - 1; }
    console.log(arithmetic(3,4));
    function choose(x) { if (x) return 'yes'; return null; }
    function partial(x) { if (x) return 42; }
    function empty() { return; }
    function fallthrough() { const x = 1; }
    function nestedCall(x) { return add(x, 1); }
    console.log(choose(true)); console.log(choose(false));
    console.log(partial(false), partial(true), empty(), fallthrough(), nestedCall(4));
  ` },
  { name: 'evaluation-order', source: `
    function mark(x) { console.log(x); return x; }
    function combine(a,b) { return a*10+b; }
    console.log(combine(mark(1), mark(2)));
    console.log(mark(3) + mark(4));
    let x = 1; console.log(x, x = 2, x); console.log(x + (x = 3));
    let y = 1; console.log(y + (y = 'x')); console.log(y);
    if (x = 0) console.log('bad'); else console.log(x);
  ` },
  { name: 'intrinsic-shadowing', source: `
    const NaN = 5; const Infinity = 10; let undefined = 'local';
    console.log(NaN, Infinity, undefined);
    function f(NaN, Infinity, undefined) { return NaN + Infinity + undefined; }
    console.log(f(1, 2, 3));
  ` },
  { name: 'typescript-erasure', extension: 'ts', source: `
    const x: number = 10; let y: number = x + 20;
    function twice(v: number): number { return v * 2; } console.log(twice(y));
    const misleading: number = 'string'; console.log(misleading + 1);
  ` },
  { name: 'loops-control-flow', source: `
    let untouched = 0;
    while (false) { untouched = 1; }
    console.log(untouched);

    let i = 0; let total = 0;
    while (i < 6) {
      i++;
      if (i === 2) continue;
      if (i === 5) break;
      total += i;
    }
    console.log(i, total);

    let d = 0;
    do { d++; } while (d < 2);
    console.log(d);

    let outer = 7;
    for (let outer = 0; outer < 2; outer++) { console.log(outer); }
    console.log(outer);

    let nested = 0;
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) {
        if (b === 1) continue;
        if (a === 2) break;
        nested += a * 10 + b;
      }
    }
    console.log(nested);
  ` },
  { name: 'mutation-order-and-number-edges', source: `
    let x = 1;
    console.log(x += (x = 5), x);
    let y = 5;
    console.log(y -= 2, y); console.log(y *= 3, y); console.log(y /= 2, y); console.log(y %= 4, y);

    let p = 1;
    console.log(p++, p, ++p, p--, p, --p);

    let z = -0;
    console.log(z++, z);

    let q = NaN; let count = 0;
    while (count < 1) { q += 0; count++; }
    console.log(q);

    let s = 'a'; s += 1; console.log(s);
    let v = 1; let once = 0;
    while (once < 1) { v = 'x'; once++; }
    console.log(v + 1);
  ` },
  { name: 'observable-results', source: 'function calculate(a,b) { return a / b; } const result = calculate(7, 2);',
    observe: ['result', 'result === 3.5', '1 / -0', 'null === undefined', "'a' + 1"] },
];
for (const fixture of fixtures) {
  test(`Node vs generated C#: ${fixture.name}`, { timeout: 90_000 }, async () => {
    const r = await differential(index, fixture);
    assert.equal(r.node.exit, 0);
    if (fixture.name === 'required-mvp') {
      assert.ok(r.result.trace.some(t => t.ruleId === 'operators.addition.number' && t.strategy === 'native'));
      assert.ok(!/\bdynamic\b|\bobject\b/.test(r.result.source));
    }
    if (fixture.name === 'objects-arrays-own-data') {
      assert.ok(r.result.trace.some(t => t.ruleId === 'array.length.read'));
      assert.ok(r.result.trace.some(t => t.ruleId === 'array.prototype.push'));
      assert.ok(r.result.trace.some(t => t.ruleId === 'object.has-own'));
    }
    if (fixture.name === 'array-string-builtins') {
      for (const id of ['array.prototype.at', 'array.prototype.includes', 'array.prototype.indexof', 'array.prototype.pop',
        'string.length', 'string.prototype.at', 'string.prototype.charat', 'string.prototype.includes',
        'string.prototype.indexof', 'string.prototype.slice', 'string.prototype.substring'])
        assert.ok(r.result.trace.some(t => t.ruleId === id && t.requirements.verdict === 'proven'), `missing proven ${id}`);
    }
  });
}
// One project exercises many binary64 decimal boundaries and random bit patterns.
// This catches Node-vs-.NET formatting differences that ordinary integer samples miss.
test('Node vs generated C#: binary64 formatting corpus', { timeout: 90_000 }, async () => {
  const numbers = [1e-7, 1e-6, 1e-5, 1e20, 1e21, 1e23, 1.0000000000000001e18,
    Number.MIN_VALUE, Number.MAX_VALUE, 2.2250738585072014e-308, 100.00000000000001];
  let state = 0x123456789abcdef0n;
  const bytes = new ArrayBuffer(8), view = new DataView(bytes);
  for (let i = 0; i < 256; i++) {
    state = BigInt.asUintN(64, state * 6364136223846793005n + 1442695040888963407n);
    view.setBigUint64(0, state);
    const n = view.getFloat64(0); if (Number.isFinite(n)) numbers.push(n);
  }
  await differential(index, { name: 'number-formatting', source: numbers.map(n => `console.log(${n});`).join('\n') });
});
