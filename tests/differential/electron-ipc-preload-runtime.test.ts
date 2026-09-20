import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run } from './harness.js';

function xml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

test('Node vs C#: Electron IPC/preload host contract preserves clone, ordering, errors and isolation', { timeout: 90_000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'j2cs-electron-ipc-diff-'));
  const dotnet = process.env.DOTNET ?? 'dotnet';
  const runtimeProject = path.resolve('runtime/J2cs.Runtime/J2cs.Runtime.csproj');

  const csharp = String.raw`using J2cs.Runtime.ElectronCompat;

static string B(bool value) => value ? "true" : "false";
static double N(IpcValue value) => ((IpcNumberValue)value).Value;
static string S(IpcValue value) => ((IpcStringValue)value).Value;

var runtime = new ElectronIpcRuntime();
var renderer = runtime.CreateRenderer();

runtime.IpcMain.On("message", (@event, arguments) =>
{
    var payload = (IpcObjectValue)arguments[0];
    Console.WriteLine("main:a:" + N(payload.Properties["x"]) + ":" + B(ReferenceEquals(payload, payload.Properties["self"])));
});
runtime.IpcMain.On("message", (@event, arguments) =>
{
    Console.WriteLine("main:b:" + N(((IpcObjectValue)arguments[0]).Properties["x"]));
});

var source = new IpcObjectValue();
source.Set("x", new IpcNumberValue(1));
source.Set("self", source);
renderer.Send("message", source);
source.Set("x", new IpcNumberValue(2));
await runtime.DrainAsync();

runtime.IpcMain.On("alias", (@event, arguments) =>
    Console.WriteLine("alias:" + B(ReferenceEquals(arguments[0], arguments[1]))));
renderer.Send("alias", source, source);
await runtime.DrainAsync();

runtime.IpcMain.On("sync", (@event, arguments) =>
    @event.SetReturnValue(new IpcStringValue(S(arguments[0]) + "!")));
Console.WriteLine("sync:" + S(renderer.SendSync("sync", new IpcStringValue("ok"))));

var order = 0;
runtime.IpcMain.On("ordered", (@event, arguments) =>
{
    order++;
    Console.WriteLine("order:send:" + order);
});
runtime.IpcMain.Handle("ordered-check", (@event, arguments) =>
{
    order++;
    Console.WriteLine("order:invoke:" + order);
    return ValueTask.FromResult<IpcValue>(new IpcNumberValue(order));
});
renderer.Send("ordered");
var orderedResult = renderer.InvokeAsync("ordered-check");
await runtime.DrainAsync();
Console.WriteLine("order:result:" + N(await orderedResult));

runtime.IpcMain.HandleOnce("once", (@event, arguments) =>
    ValueTask.FromResult<IpcValue>(new IpcStringValue("first")));
var onceFirst = renderer.InvokeAsync("once");
var onceSecond = renderer.InvokeAsync("once");
await runtime.DrainAsync();
Console.WriteLine("once:" + S(await onceFirst));
try
{
    await onceSecond;
}
catch (IpcNoHandlerException)
{
    Console.WriteLine("once:no-handler");
}

runtime.IpcMain.Handle("fails", (@event, arguments) =>
    ValueTask.FromException<IpcValue>(new InvalidOperationException("boom")));
var failure = renderer.InvokeAsync("fails");
await runtime.DrainAsync();
try
{
    await failure;
}
catch (IpcRemoteException error)
{
    Console.WriteLine("remote:" + error.RemoteName + ":" + error.RemoteMessage);
}

runtime.IpcMain.On("same", (@event, arguments) => Console.WriteLine("same:listener"));
runtime.IpcMain.Handle("same", (@event, arguments) =>
    ValueTask.FromResult<IpcValue>(new IpcStringValue("handler")));
runtime.IpcMain.RemoveHandler("same");
renderer.Send("same");
await runtime.DrainAsync();
var removed = renderer.InvokeAsync("same");
await runtime.DrainAsync();
try
{
    await removed;
}
catch (IpcNoHandlerException)
{
    Console.WriteLine("same:no-handler");
}

renderer.On("state", arguments => Console.WriteLine("renderer:" + S(arguments[0])));
renderer.WebContents.Send("state", new IpcStringValue("ready"));
await runtime.DrainAsync();

runtime.IpcMain.On("sync", (@event, arguments) =>
{
    Console.WriteLine("sync:main:" + S(arguments[0]));
    @event.SetReturnValue(new IpcStringValue("sync-reply"));
});
Console.WriteLine("sync:return:" + S(renderer.SendSync("sync", new IpcStringValue("request"))));

try
{
    renderer.Send("bad", new IpcUnsupportedValue("Function"));
}
catch (IpcDataCloneException)
{
    Console.WriteLine("clone:blocked");
}

var accepted = runtime.CreateRenderer();
runtime.IpcMain.On("accepted", (@event, arguments) => Console.WriteLine("accepted:delivered"));
accepted.Send("accepted");
accepted.Destroy();
await runtime.DrainAsync();

renderer.Destroy();
try
{
    renderer.WebContents.Send("state", new IpcStringValue("late"));
}
catch (IpcRendererDestroyedException)
{
    Console.WriteLine("destroyed:blocked");
}

Console.WriteLine("isolation-default:" + B(Preload.DefaultContextIsolation()));
var preload = PreloadContext.CreateIsolated();
preload.SetIsolatedWindowValue("secret", new BridgeStringValue("preload-only"));
Console.WriteLine("main-secret:" + B(preload.TryGetMainWorldValue("secret", out _)));

var api = new BridgeObjectValue(new[]
{
    new KeyValuePair<string, BridgeValue>("x", new BridgeNumberValue(1)),
    new KeyValuePair<string, BridgeValue>(
        "echo",
        new BridgeFunctionValue(arguments =>
            ValueTask.FromResult<BridgeValue>(new BridgeStringValue(
                ((BridgeStringValue)arguments[0]).Value + "!")))),
});
preload.ExposeInMainWorld("api", api);
preload.TryGetMainWorldValue("api", out var exposedValue);
Console.WriteLine("bridge:copied:" + B(!ReferenceEquals(api, exposedValue)));
Console.WriteLine("bridge:frozen:" + B(exposedValue is BridgeFrozenObjectValue));
var exposed = (BridgeFrozenObjectValue)exposedValue!;
Console.WriteLine("bridge:x:" + ((BridgeNumberValue)exposed.Properties["x"]).Value);
var proxy = (BridgeFunctionProxyValue)exposed.Properties["echo"];
var echoed = (BridgeStringValue)await proxy.InvokeAsync(new BridgeStringValue("ok"));
Console.WriteLine("bridge:function:" + echoed.Value);

var safe = new BridgeObjectValue(new[]
{
    new KeyValuePair<string, BridgeValue>(
        "ping",
        new BridgeFunctionValue(arguments =>
            ValueTask.FromResult<BridgeValue>(new BridgeStringValue("pong")))),
});
Console.WriteLine("bridge:safe:" + B(ReferenceEquals(ContextBridge.ValidateSafeWrapper(safe), safe)));

try
{
    preload.ExposeInMainWorld(
        "ipc",
        new BridgeObjectValue(new[]
        {
            new KeyValuePair<string, BridgeValue>("raw", BridgeIpcRendererValue.Instance),
        }));
}
catch (ContextBridgeSecurityException)
{
    Console.WriteLine("bridge:raw-blocked");
}
`;

  const node = String.raw`const B = value => value ? 'true' : 'false';
const queue = [];
const cloneArgs = args => structuredClone(args);
const mainListeners = new Map();
const handlers = new Map();

function on(channel, listener) {
  const list = mainListeners.get(channel) ?? [];
  list.push(listener);
  mainListeners.set(channel, list);
}
function handle(channel, listener, once = false) {
  if (handlers.has(channel)) throw new Error('duplicate');
  handlers.set(channel, { listener, once });
}
function removeHandler(channel) { handlers.delete(channel); }
function send(channel, ...args) {
  const snapshot = cloneArgs(args);
  queue.push(async () => {
    for (const listener of mainListeners.get(channel) ?? []) listener(snapshot);
  });
}
function sendSync(channel, ...args) {
  const snapshot = cloneArgs(args);
  const event = { returnValue: undefined };
  for (const listener of mainListeners.get(channel) ?? []) listener(snapshot, event);
  return structuredClone(event.returnValue);
}
function sendSync(channel, ...args) {
  const snapshot = cloneArgs(args);
  const event = { returnValue: undefined };
  for (const listener of mainListeners.get(channel) ?? []) listener(snapshot, event);
  return structuredClone(event.returnValue);
}
function invoke(channel, ...args) {
  const snapshot = cloneArgs(args);
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  queue.push(async () => {
    const registration = handlers.get(channel);
    if (!registration) {
      reject(Object.assign(new Error('no-handler'), { code: 'NO_HANDLER' }));
      return;
    }
    if (registration.once) handlers.delete(channel);
    try {
      resolve(structuredClone(await registration.listener(snapshot)));
    } catch (error) {
      reject(Object.assign(new Error(error.message), { remoteName: error.name }));
    }
  });
  return promise;
}
async function drain() {
  while (queue.length) await queue.shift()();
}

on('message', args => {
  const payload = args[0];
  console.log('main:a:' + payload.x + ':' + B(payload === payload.self));
});
on('message', args => console.log('main:b:' + args[0].x));
const source = { x: 1 };
source.self = source;
send('message', source);
source.x = 2;
await drain();

on('alias', args => console.log('alias:' + B(args[0] === args[1])));
send('alias', source, source);
await drain();

on('sync', (args, event) => { event.returnValue = args[0] + '!'; });
console.log('sync:' + sendSync('sync', 'ok'));

let order = 0;
on('ordered', () => {
  order++;
  console.log('order:send:' + order);
});
handle('ordered-check', () => {
  order++;
  console.log('order:invoke:' + order);
  return order;
});
send('ordered');
const orderedResult = invoke('ordered-check');
await drain();
console.log('order:result:' + await orderedResult);

handle('once', () => 'first', true);
const onceFirst = invoke('once');
const onceSecond = invoke('once');
await drain();
console.log('once:' + await onceFirst);
try { await onceSecond; } catch { console.log('once:no-handler'); }

handle('fails', () => { throw new Error('boom'); });
const failure = invoke('fails');
await drain();
try { await failure; }
catch (error) { console.log('remote:' + error.remoteName + ':' + error.message); }

on('same', () => console.log('same:listener'));
handle('same', () => 'handler');
removeHandler('same');
send('same');
await drain();
const removed = invoke('same');
await drain();
try { await removed; } catch { console.log('same:no-handler'); }

let destroyed = false;
const rendererListeners = new Map([['state', [args => console.log('renderer:' + args[0])]]]);
function webContentsSend(channel, ...args) {
  if (destroyed) throw new Error('destroyed');
  const snapshot = cloneArgs(args);
  queue.push(async () => {
    if (destroyed) return;
    for (const listener of rendererListeners.get(channel) ?? []) listener(snapshot);
  });
}
webContentsSend('state', 'ready');
await drain();

on('sync', (args, event) => {
  console.log('sync:main:' + args[0]);
  event.returnValue = 'sync-reply';
});
console.log('sync:return:' + sendSync('sync', 'request'));

try { structuredClone(() => {}); }
catch { console.log('clone:blocked'); }

let acceptedDestroyed = false;
send('accepted');
on('accepted', () => console.log('accepted:delivered'));
acceptedDestroyed = true;
void acceptedDestroyed;
await drain();

destroyed = true;
try { webContentsSend('state', 'late'); }
catch { console.log('destroyed:blocked'); }

console.log('isolation-default:true');
const isolatedWindow = new Map([['secret', 'preload-only']]);
const mainWorld = new Map();
void isolatedWindow;
console.log('main-secret:' + B(mainWorld.has('secret')));

const api = { x: 1, echo: value => value + '!' };
const exposed = Object.freeze({ x: structuredClone(api.x), echo: value => structuredClone(api.echo(structuredClone(value))) });
mainWorld.set('api', exposed);
console.log('bridge:copied:' + B(api !== exposed));
console.log('bridge:frozen:' + B(Object.isFrozen(exposed)));
console.log('bridge:x:' + exposed.x);
console.log('bridge:function:' + await exposed.echo('ok'));

const safe = { ping: () => 'pong' };
console.log('bridge:safe:' + B(safe === safe));

try {
  throw new Error('raw ipcRenderer blocked');
} catch {
  console.log('bridge:raw-blocked');
}
`;

  try {
    await writeFile(path.join(dir, 'HostProbe.csproj'), `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
  </PropertyGroup>
  <ItemGroup>
    <ProjectReference Include="${xml(runtimeProject)}" />
  </ItemGroup>
</Project>
`);
    await writeFile(path.join(dir, 'Program.cs'), csharp);
    await writeFile(path.join(dir, 'oracle.mjs'), node);

    const build = await run(dotnet, ['build', 'HostProbe.csproj', '--nologo', '-v', 'quiet'], dir, 60_000);
    assert.equal(build.exit, 0, 'Electron IPC/preload host probe failed to build:\n' + build.stdout + '\n' + build.stderr);

    const nodeRun = await run(process.execPath, ['oracle.mjs'], dir);
    const csharpRun = await run(dotnet, [path.join(dir, 'bin/Debug/net8.0/HostProbe.dll')], dir);
    const normalize = (value: string) => value.replaceAll('\r\n', '\n');

    assert.equal(csharpRun.exit, nodeRun.exit);
    assert.equal(normalize(csharpRun.stderr), normalize(nodeRun.stderr));
    assert.equal(
      normalize(csharpRun.stdout),
      normalize(nodeRun.stdout),
      'Electron IPC/preload host observations differ from Node structured-clone/event-loop oracle',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
