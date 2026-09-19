import test from 'node:test';
import assert from 'node:assert/strict';
import { createCompiler } from '../../compiler/index.js';
import { differential, type Fixture } from './harness.js';

const index = await createCompiler();

const fixtures: Fixture[] = [
  {
    name: 'async-primitive-await-order',
    source: `
      async function f() {
        console.log('start');
        const x = await 1;
        console.log(x);
        await null;
        console.log('done');
        return console.log('return-eval');
      }
      f();
      console.log('sync');
    `,
    stdout: 'start\nsync\n1\ndone\nreturn-eval\n',
  },
  {
    name: 'queue-microtask-fifo-recursive-enqueue',
    source: `
      function second() { console.log('second'); }
      function first() { console.log('first'); queueMicrotask(second); }
      function peer() { console.log('peer'); }
      queueMicrotask(first);
      queueMicrotask(peer);
      console.log('sync');
    `,
    stdout: 'sync\nfirst\npeer\nsecond\n',
  },
  {
    name: 'await-and-queue-share-fifo',
    source: `
      async function f() {
        console.log('start');
        await 1;
        console.log('one');
        await 2;
        console.log('two');
      }
      function q() { console.log('q'); }
      f();
      queueMicrotask(q);
      console.log('sync');
    `,
    stdout: 'start\nsync\none\nq\ntwo\n',
  },
];

for (const fixture of fixtures) {
  test(`Node vs generated C#: ${fixture.name}`, { timeout: 90_000 }, async () => {
    const result = await differential(index, fixture);
    assert.equal(result.node.exit, 0);
    assert.ok(result.result.trace.some(t => t.ruleId.startsWith('async.')));
  });
}
