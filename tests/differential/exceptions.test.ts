import test from 'node:test';
import { createCompiler } from '../../compiler/index.js';
import { differential } from './harness.js';

const index = await createCompiler();

test('Node vs generated C#: exceptions and completion propagation', { timeout: 90_000 }, async () => {
  await differential(index, { name: 'exceptions-completions', source: `
    const token={x:7};
    try { throw token; } catch(e) { console.log(e===token,e.x); }
    try { throw 17; } catch { console.log('omitted'); }

    let outer='outer';
    try { throw 'inner'; } catch(outer) { console.log(outer); }
    console.log(outer);

    try {
      try { throw 'a'; }
      finally { console.log('inner-finally'); throw 'b'; }
    } catch(e) { console.log('outer-catch',e); }
    finally { console.log('outer-finally'); }

    function preserved(){ try { return 1; } finally { console.log('preserve-finally'); } }
    function overridden(){ try { return 1; } finally { return 2; } }
    function boom(){ throw 'boom'; }
    console.log(preserved(),overridden());
    try { boom(); } catch(e) { console.log(e); }

    let i=0; let seen=0;
    while(i<4){
      i++;
      try {
        if(i===1) continue;
        if(i===3) break;
        seen += i;
      } finally { console.log('loop-finally',i); }
    }
    console.log(i,seen);
  ` });
});
