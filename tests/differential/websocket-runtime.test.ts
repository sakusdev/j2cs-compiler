import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT } from '../../compiler/index.js';
import { run } from './harness.js';

const nodeOracle = String.raw`
class ContractError extends Error { constructor(name, message) { super(message); this.name = name; } }
class Model {
  constructor(url, protocols = []) {
    const u = new URL(url);
    if (u.hash) throw new ContractError('SyntaxError', 'fragment');
    if (u.protocol === 'http:') u.protocol = 'ws:';
    else if (u.protocol === 'https:') u.protocol = 'wss:';
    else if (u.protocol !== 'ws:' && u.protocol !== 'wss:') throw new ContractError('SyntaxError', 'scheme');
    const sep = '()<>@,;:\\"/[]?={} \t';
    const seen = new Set();
    for (const p of protocols) {
      if (!p || [...p].some(c => c.charCodeAt(0) < 0x21 || c.charCodeAt(0) > 0x7e || sep.includes(c)) || seen.has(p))
        throw new ContractError('SyntaxError', 'protocol');
      seen.add(p);
    }
    this.url = u;
    this.protocols = protocols;
    this.state = 0;
    this.buffered = 0;
    this.queue = [];
    this.trace = ['Constructed'];
  }
  open(protocol = '') { if (this.state !== 0) throw Error('state'); this.state = 1; this.protocol = protocol; this.trace.push('Open'); }
  send(text) {
    if (this.state === 0) throw new ContractError('InvalidStateError', 'connecting');
    const bytes = Buffer.byteLength(text, 'utf8');
    this.buffered += bytes;
    if (this.state === 1) { this.queue.push([text, bytes]); this.trace.push('SendQueued'); }
    else this.trace.push('SendDiscarded');
  }
  transmit() {
    if (this.state === 3 || !this.queue.length) throw Error('transmit');
    const [text, bytes] = this.queue.shift();
    this.buffered -= bytes;
    this.trace.push('Transmitted');
    return text;
  }
  close(code, reason = '') {
    if (code !== undefined && code !== 1000 && (code < 3000 || code > 4999))
      throw new ContractError('InvalidAccessError', 'code');
    if (Buffer.byteLength(reason, 'utf8') > 123) throw new ContractError('SyntaxError', 'reason');
    if (this.state === 2 || this.state === 3) return;
    this.state = 2; this.trace.push('CloseRequested');
  }
  closed(code = 1000, reason = '', clean = true) { if (this.state === 3) return; this.state = 3; this.trace.push('Close'); }
  fail() { if (this.state === 3) return; this.trace.push('Error'); this.closed(1006, '', false); }
  networkChanged() { this.trace.push('NetworkChanged'); }
}
function err(fn) { try { fn(); return 'none'; } catch (e) { return e.name; } }

const s = new Model('http://example.com/socket', ['chat','superchat']);
console.log(s.state, s.url.protocol.slice(0,-1), s.protocols.join(','));
console.log(err(() => new Model('ftp://example.com')));
console.log(err(() => new Model('ws://example.com', ['chat','chat'])));
console.log(err(() => s.send('x')), s.buffered);
s.open('chat');
s.send('✓');
console.log(s.state, s.buffered, s.queue.length);
s.close(1000, 'bye');
console.log(s.state, s.buffered, s.queue.length);
console.log(s.transmit(), s.buffered, s.queue.length);
s.closed(1000, 'bye', true);
console.log(s.state, s.buffered);
s.send('x');
console.log(s.state, s.buffered, s.queue.length);

const invalidCode = new Model('wss://example.com'); invalidCode.open();
console.log(err(() => invalidCode.close(2000)));
const invalidReason = new Model('wss://example.com'); invalidReason.open();
console.log(err(() => invalidReason.close(1000, 'x'.repeat(124))));

const failed = new Model('wss://example.com'); failed.fail();
console.log(failed.trace.slice(-2).join(','), failed.state);
const changed = new Model('wss://example.com'); changed.open(); changed.networkChanged();
console.log(changed.state, changed.trace.at(-1));

const delays = [0,1,2,3,4,5].map(i => Math.min(1000, 100 * 2 ** i));
console.log(delays.join(',') + ',none');
console.log('heartbeat', 5000, 'ping');
`;

const csharpProgram = String.raw`
using J2cs.Runtime.WebCompat;
using J2cs.Runtime.ElectronCompat.Network;
using System.Globalization;
using System.Text;

static string ErrorName(Action action)
{
    try { action(); return "none"; }
    catch (WebSocketContractException ex) { return ex.Name; }
}

var socket = new BrowserWebSocketState("http://example.com/socket", new[] { "chat", "superchat" });
Console.WriteLine($"{(int)socket.ReadyState} {socket.Url.Scheme} {string.Join(",", socket.Protocols)}");
Console.WriteLine(ErrorName(() => _ = new BrowserWebSocketState("ftp://example.com")));
Console.WriteLine(ErrorName(() => _ = new BrowserWebSocketState("ws://example.com", new[] { "chat", "chat" })));
Console.WriteLine($"{ErrorName(() => socket.SendText("x"))} {socket.BufferedAmount}");
socket.HostOpened("chat");
socket.SendText("✓");
Console.WriteLine($"{(int)socket.ReadyState} {socket.BufferedAmount} {socket.PendingApplicationMessages}");
socket.Close(1000, "bye");
Console.WriteLine($"{(int)socket.ReadyState} {socket.BufferedAmount} {socket.PendingApplicationMessages}");
var frame = socket.HostTransmitNext();
Console.WriteLine($"{Encoding.UTF8.GetString(frame.Payload)} {socket.BufferedAmount} {socket.PendingApplicationMessages}");
socket.HostClosed(new WebSocketCloseInfo(1000, "bye", true));
Console.WriteLine($"{(int)socket.ReadyState} {socket.BufferedAmount}");
socket.SendText("x");
Console.WriteLine($"{(int)socket.ReadyState} {socket.BufferedAmount} {socket.PendingApplicationMessages}");

var invalidCode = new BrowserWebSocketState("wss://example.com"); invalidCode.HostOpened();
Console.WriteLine(ErrorName(() => invalidCode.Close(2000)));
var invalidReason = new BrowserWebSocketState("wss://example.com"); invalidReason.HostOpened();
Console.WriteLine(ErrorName(() => invalidReason.Close(1000, new string('x', 124))));

var failed = new BrowserWebSocketState("wss://example.com"); failed.HostNetworkError();
Console.WriteLine($"{string.Join(",", failed.Trace.TakeLast(2).Select(x => x.Kind.ToString()))} {(int)failed.ReadyState}");
var changed = new BrowserWebSocketState("wss://example.com"); changed.HostOpened(); changed.NetworkChanged(WebSocketNetworkChange.InterfaceChanged);
Console.WriteLine($"{(int)changed.ReadyState} {changed.Trace[^1].Kind}");

var retry = new WebSocketReconnectPolicy(TimeSpan.FromMilliseconds(100), TimeSpan.FromMilliseconds(1000), 6);
Console.WriteLine(string.Join(",", Enumerable.Range(0, 6).Select(i => retry.DelayForAttempt(i)!.Value.TotalMilliseconds.ToString("0", CultureInfo.InvariantCulture))) + ",none");
var heartbeat = new WebSocketHeartbeatPolicy(TimeSpan.FromSeconds(5), "ping").Validate();
Console.WriteLine($"heartbeat {heartbeat.Interval.TotalMilliseconds.ToString("0", CultureInfo.InvariantCulture)} {heartbeat.TextPayload}");
`;

function xml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

test('Node vs generated C#: deterministic WebSocket lifecycle/runtime contract', { timeout: 90_000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'j2cs-websocket-diff-'));
  try {
    const runtime = path.join(ROOT, 'runtime/J2cs.Runtime/J2cs.Runtime.csproj');
    const project = path.join(dir, 'Generated.csproj');
    await writeFile(path.join(dir, 'input.cjs'), nodeOracle);
    await writeFile(path.join(dir, 'Program.cs'), csharpProgram);
    await writeFile(project, `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <AssemblyName>J2cs.WebSocketDiff</AssemblyName>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>
  <ItemGroup><ProjectReference Include="${xml(runtime)}" /></ItemGroup>
</Project>
`);
    await writeFile(path.join(dir, 'NuGet.Config'), '<configuration><packageSources><clear /></packageSources></configuration>\n');

    const build = await run(process.env.DOTNET ?? 'dotnet', ['build', project, '--nologo', '-v', 'quiet'], dir, 60_000);
    assert.equal(build.exit, 0, `dotnet build failed:\n${build.stdout}\n${build.stderr}`);
    const node = await run(process.execPath, ['input.cjs'], dir);
    const csharp = await run(process.env.DOTNET ?? 'dotnet', [path.join(dir, 'bin/Debug/net8.0/J2cs.WebSocketDiff.dll')], dir);
    assert.equal(node.exit, 0, `Node oracle failed:\n${node.stdout}\n${node.stderr}`);
    assert.deepEqual(
      { ...csharp, stdout: csharp.stdout.replaceAll('\r\n', '\n'), stderr: csharp.stderr.replaceAll('\r\n', '\n') },
      { ...node, stdout: node.stdout.replaceAll('\r\n', '\n'), stderr: node.stderr.replaceAll('\r\n', '\n') },
      'WebSocket runtime trace differs from Node oracle'
    );
  } catch (error) {
    throw new Error(`WebSocket differential failed; artifacts: ${dir}: ${String(error)}`, { cause: error });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
