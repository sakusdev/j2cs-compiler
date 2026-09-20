import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT } from '../../compiler/index.js';
import { run } from './harness.js';

const nodeOracle = String.raw`
const http = require('node:http');
const net = require('node:net');
const dns = require('node:dns');
const { once } = require('node:events');

(async () => {
  const outgoing = http.request({ host: '127.0.0.1', port: 9 });
  outgoing.on('error', () => {});
  outgoing.setHeader('X-N', 7);
  console.log(outgoing.getHeader('x-n'));
  try {
    outgoing.setHeader('X', 'bad\nvalue');
  } catch (error) {
    console.log(error.code);
  }
  outgoing.destroy();

  const server = http.createServer((request, response) => {
    console.log(request.headers['x-a']);
    console.log(request.headers['set-cookie'].join('|'));
    console.log(request.headersDistinct['x-a'].join('|'));
    console.log(request.headers['cookie']);
    response.end('ok');
  });
  server.on('error', error => { throw error; });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;

  await new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port,
      headers: {
        'X-A': ['one', 'two'],
        'Cookie': ['a=1', 'b=2'],
        'Set-Cookie': ['a=1', 'b=2']
      }
    }, response => {
      response.resume();
      response.on('end', resolve);
    });
    request.on('error', reject);
    request.end();
  });
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));

  const lookup = await new Promise((resolve, reject) => {
    dns.lookup('127.0.0.1', (error, address, family) =>
      error ? reject(error) : resolve({ address, family }));
  });
  console.log(lookup.address + ' ' + lookup.family);

  const tcpServer = net.createServer();
  console.log(tcpServer.address() === null);
  console.log(tcpServer.listen(0, '127.0.0.1') === tcpServer);
  await once(tcpServer, 'listening');
  console.log(tcpServer.address().port > 0);

  const socket = new net.Socket();
  console.log(socket.connect(tcpServer.address().port, '127.0.0.1') === socket);
  await once(socket, 'connect');
  console.log(socket.connecting === false);
  socket.destroy();
  await new Promise((resolve, reject) => tcpServer.close(error => error ? reject(error) : resolve()));
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
`;

const csharpOracle = String.raw`
using J2cs.Runtime.NodeCompat;

static void Print(bool value) => Console.WriteLine(value ? "true" : "false");

var outgoing = new NodeHttpOutgoingHeaders();
outgoing.SetHeader("X-N", NodeHeaderValue.FromNumber(7));
if (!outgoing.TryGetHeader("x-n", out var header))
    throw new InvalidOperationException("missing outgoing header");
Console.WriteLine(header.ToWireString());
try
{
    outgoing.SetHeader("X", NodeHeaderValue.FromString("bad\nvalue"));
}
catch (NodeNetworkException error)
{
    Console.WriteLine(error.Code);
}

var incoming = NodeHttpIncomingHeaders.FromRaw(new[]
{
    new KeyValuePair<string, string>("X-A", "one"),
    new KeyValuePair<string, string>("X-A", "two"),
    new KeyValuePair<string, string>("Cookie", "a=1"),
    new KeyValuePair<string, string>("Cookie", "b=2"),
    new KeyValuePair<string, string>("Set-Cookie", "a=1"),
    new KeyValuePair<string, string>("Set-Cookie", "b=2"),
});
if (!incoming.TryGet("x-a", out var xA)
    || !incoming.TryGet("set-cookie", out var setCookie)
    || !incoming.TryGet("cookie", out var cookie))
    throw new InvalidOperationException("missing incoming header");
Console.WriteLine(xA.Single);
Console.WriteLine(string.Join("|", setCookie.Multiple));
Console.WriteLine(string.Join("|", incoming.GetDistinct("x-a")));
Console.WriteLine(cookie.Single);

var lookup = await NodeDns.LookupAsync("127.0.0.1");
Console.WriteLine(lookup.Address + " " + lookup.Family);

await using var server = new NodeTcpServer();
Print(server.Address is null);
Print(ReferenceEquals(server.Listen(0, "127.0.0.1"), server));
await server.ListenCompletion;
var address = server.Address ?? throw new InvalidOperationException("server has no address");
Print(address.Port > 0);

await using var socket = new NodeTcpSocket();
Print(ReferenceEquals(socket.Connect("127.0.0.1", address.Port), socket));
await socket.ConnectCompletion;
Print(socket.Connecting == false);
socket.Destroy();
server.Close();
`;

test('Node vs C# network compatibility foundation', { timeout: 90_000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'j2cs-network-diff-'));
  const dotnet = process.env.DOTNET ?? 'dotnet';
  try {
    await mkdir(path.join(dir, 'runtime'), { recursive: true });
    await cp(
      path.join(ROOT, 'runtime/J2cs.Runtime'),
      path.join(dir, 'runtime/J2cs.Runtime'),
      { recursive: true },
    );
    await writeFile(path.join(dir, 'oracle.cjs'), nodeOracle);
    await writeFile(path.join(dir, 'Program.cs'), csharpOracle);
    await writeFile(path.join(dir, 'NetworkDiff.csproj'), `
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <AssemblyName>NetworkDiff</AssemblyName>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
  </PropertyGroup>
  <ItemGroup>
    <Compile Remove="runtime/**/*.cs" />
    <ProjectReference Include="runtime/J2cs.Runtime/J2cs.Runtime.csproj" />
  </ItemGroup>
</Project>
`);

    const build = await run(dotnet, ['build', 'NetworkDiff.csproj', '--nologo', '-v', 'quiet'], dir, 60_000);
    assert.equal(build.exit, 0, `dotnet build failed:\n${build.stdout}\n${build.stderr}`);

    const node = await run(process.execPath, ['oracle.cjs'], dir, 30_000);
    const csharp = await run(dotnet, [path.join(dir, 'bin/Debug/net8.0/NetworkDiff.dll')], dir, 30_000);
    assert.deepEqual(csharp, node, 'Node network observables differ from the bounded C# compatibility foundation');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
