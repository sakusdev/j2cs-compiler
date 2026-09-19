import test from 'node:test';
import { createCompiler } from '../../compiler/index.js';
import { differential, type Fixture } from './harness.js';

const index = await createCompiler();

const fixtures: Fixture[] = [
  {
    name: 'generator-lazy-next-return-completed',
    source: `
      function* g(){
        console.log('run');
        const x = yield 1;
        console.log(x === 9);
        return x;
      }
      const it = g();
      console.log('made');
      let r = it.next(777);
      console.log(r.value === 1, r.done);
      r = it.next(9);
      console.log(r.value === 9, r.done);
      r = it.next(55);
      console.log(r.value === undefined, r.done);
    `,
  },
  {
    name: 'generator-return-before-start',
    source: `
      function* g(){ console.log('must-not-run'); yield 1; }
      const it = g();
      const r = it.return(3);
      console.log(r.value === 3, r.done);
    `,
  },
  {
    name: 'generator-return-suspended',
    source: `
      function* g(){ yield 1; yield 2; }
      const it = g();
      let r = it.next();
      console.log(r.value === 1, r.done);
      r = it.return(8);
      console.log(r.value === 8, r.done);
      r = it.next();
      console.log(r.value === undefined, r.done);
    `,
  },
  {
    name: 'generator-yield-preserves-object-identity',
    source: `
      function* g(){ const value = {}; yield value; return value; }
      const it = g();
      const first = it.next();
      const second = it.next();
      console.log(first.value === second.value, first.done, second.done);
    `,
  },
  {
    name: 'generator-yield-star-array',
    source: `
      function* g(){ yield* [1,2]; return 3; }
      const it = g();
      let r = it.next(); console.log(r.value === 1, r.done);
      r = it.next(99); console.log(r.value === 2, r.done);
      r = it.next(88); console.log(r.value === 3, r.done);
    `,
  },
  {
    name: 'generator-yield-star-generator-completion',
    source: `
      function* inner(){ const x = yield 1; return x; }
      function* outer(){ const x = yield* inner(); return x; }
      const it = outer();
      let r = it.next(); console.log(r.value === 1, r.done);
      r = it.next(7); console.log(r.value === 7, r.done);
    `,
  },
  {
    name: 'generator-yield-star-return-closes-inner',
    source: `
      function* inner(){ yield 1; yield 2; }
      function* outer(){ yield* inner(); return 4; }
      const it = outer();
      let r = it.next(); console.log(r.value === 1, r.done);
      r = it.return(9); console.log(r.value === 9, r.done);
      r = it.next(); console.log(r.value === undefined, r.done);
    `,
  },
];

for (const fixture of fixtures) {
  test('Node vs generated C#: ' + fixture.name, { timeout: 90_000 }, async () => {
    await differential(index, fixture);
  });
}
