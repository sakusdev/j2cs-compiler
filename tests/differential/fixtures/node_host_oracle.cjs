const { spawnSync } = require('node:child_process');
const { Worker } = require('node:worker_threads');

(async () => {
  let timer;
  await new Promise(resolve => {
    timer = setTimeout(function(arg) {
      console.log('timer:' + arg + ':' + (this === timer));
      resolve();
    }, 1, 'arg');
    process.stdout.write('timer-ref:' + timer.hasRef() + ',');
    timer.unref();
    console.log(timer.hasRef());
    timer.ref();
    const cancelled = setTimeout(() => console.log('bad-timeout'), 1);
    clearTimeout(cancelled);
  });

  let intervalCount = 0;
  await new Promise(resolve => {
    const interval = setInterval(function() {
      intervalCount++;
      if (intervalCount === 2) {
        clearInterval(interval);
        console.log('interval:' + intervalCount + ':' + (this === interval));
        resolve();
      }
    }, 1);
  });

  await new Promise(resolve => {
    const values = [];
    const done = value => {
      values.push(value);
      if (values.length === 2) {
        console.log('immediate:' + values.join(','));
        resolve();
      }
    };
    setImmediate(() => done('a'));
    setImmediate(() => done('b'));
  });

  const child = spawnSync(process.execPath, [
    '-e',
    "process.stdout.write((process.env.J2CS_TEST || '') + '@' + process.cwd())"
  ], {
    cwd: process.cwd(),
    env: { J2CS_TEST: 'v' },
    encoding: 'utf8'
  });
  console.log('child:' + child.status + ':' + child.stdout);

  await new Promise((resolve, reject) => {
    const values = [];
    const worker = new Worker(
      "const {parentPort}=require('node:worker_threads');parentPort.postMessage(1);parentPort.postMessage('x')",
      { eval: true }
    );
    worker.on('message', value => values.push(typeof value + ':' + value));
    worker.on('error', reject);
    worker.on('exit', exitCode => {
      values.push('exit:' + exitCode);
      console.log('worker:' + values.join(','));
      resolve();
    });
  });
})().catch(error => {
  console.error(error && error.stack || String(error));
  process.exitCode = 1;
});
