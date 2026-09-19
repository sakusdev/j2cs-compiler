const { EventEmitter } = require('node:events');
const { Readable, Writable } = require('node:stream');

const emitter = new EventEmitter();
const log = [];
function c(v) { log.push('c' + v); }
function a(v) { log.push('a' + v); emitter.on('x', c); }
function b(v) { log.push('b' + v); }
emitter.on('x', a);
emitter.once('x', b);
emitter.emit('x', 1);
emitter.emit('x', 2);
console.log(log.join(','));
console.log(emitter.emit('none'));
try { emitter.emit('error', 'boom'); } catch (error) { console.log(error.code); }

const buffer = Buffer.from('68656c6c6f', 'hex');
const view = buffer.slice(1, 4);
view[0] = 0x61;
console.log(buffer.toString('utf8'), view.toString('hex'), Buffer.byteLength('é', 'utf8'), Buffer.alloc(3, 65).toString('utf8'));
const copy = Buffer.from(buffer);
copy[0] = 0x7a;
console.log(buffer[0], copy[0]);
console.log(Buffer.from([257, -1, 3.9]).toString('hex'));
console.log(Buffer.byteLength('é', 'not-an-encoding'));
const arrayBuffer = new ArrayBuffer(3);
const bytes = new Uint8Array(arrayBuffer);
bytes.set([1, 2, 3]);
const shared = Buffer.from(arrayBuffer);
shared[0] = 9;
console.log(bytes[0]);

const readable = new Readable({ highWaterMark: 1, read() {} });
readable.on('end', () => console.log('end'));
console.log(readable.push(Buffer.from([1])));
console.log(readable.read().toString('hex'));
readable.push(null);
readable.read();

const writable = new Writable({
  highWaterMark: 1,
  write(chunk, encoding, callback) { setImmediate(callback); }
});
writable.on('drain', () => { console.log('drain'); writable.end(); });
writable.on('finish', () => console.log('finish'));
console.log(writable.write(Buffer.from([2])));
