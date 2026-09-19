import test from 'node:test';
import assert from 'node:assert/strict';
import { createCompiler } from '../../compiler/index.js';
import { differential, type Fixture } from './harness.js';

const index = await createCompiler();
const fixtures: Fixture[] = [
  {
    name: 'class-static-method-and-eager-field',
    source: `
      class C {
        static before = console.log('init');
        static x = 3;
        static value(){ return C.x; }
      }
      console.log(C.value());
      console.log(C.before);
    `,
    stdout: 'init\n3\nundefined\n',
  },
  {
    name: 'class-static-inheritance-shadow',
    source: `
      class A { static x = 1; }
      class B extends A {}
      console.log(B.x);
      B.x = 2;
      console.log(A.x);
      console.log(B.x);
    `,
    stdout: '1\n1\n2\n',
  },
  {
    name: 'class-expression-static-surface',
    source: `
      const C = class Inner { static x = 4; static value(){ return C.x; } };
      console.log(C.x);
      console.log(C.value());
    `,
    stdout: '4\n4\n',
  },
];

for (const fixture of fixtures) {
  test(`Node vs generated C#: ${fixture.name}`, { timeout: 90_000 }, async () => {
    const result = await differential(index, fixture);
    assert.equal(result.node.exit, 0);
    assert.ok(result.result.trace.some(t => t.ruleId.startsWith('classes.')));
  });
}
