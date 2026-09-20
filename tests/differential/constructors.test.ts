import test from 'node:test';
import assert from 'node:assert/strict';
import { createCompiler } from '../../compiler/index.js';
import { differential } from './harness.js';

const index = await createCompiler();

test('Node vs generated C#: ordinary constructors, return override and new.target', { timeout: 90_000 }, async () => {
  const run = await differential(index, {
    name: 'constructors-new-target',
    source: `
      function C(x) { this.x = x; this.fromNew = new.target !== undefined; }
      const a = new C(3); const b = new C(4);
      console.log(a.x, b.x, a === b, a.fromNew, b.fromNew);

      function Primitive() { this.x = 1; return 7; }
      function Nullish() { this.x = 2; return null; }
      console.log(new Primitive().x, new Nullish().x);

      function Override() { this.x = 1; return {x: 9}; }
      console.log(new Override().x);

      function ArrayOverride() { return [7,,9]; }
      const array = new ArrayOverride();
      console.log(array.length, array[0], Object.hasOwn(array, 1), array[2]);

      function Called() { return new.target === undefined; }
      console.log(Called());

      let tick = 0;
      function Order(x, y) { this.sum = x + y; }
      const ordered = new Order((tick = 1), (tick = tick + 1));
      console.log(tick, ordered.sum);
    `,
  });
  const ids = new Set(run.result.trace.map(item => item.ruleId));
  assert.ok(ids.has('function.constructor.new-ordinary'));
  assert.ok(ids.has('function.constructor.object-return-overrides-this'));
  assert.ok(ids.has('function.new-target'));
});
