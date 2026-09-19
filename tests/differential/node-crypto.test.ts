import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT } from '../../compiler/index.js';
import { run } from './harness.js';

test('Node crypto runtime core matches Node 22 observable crypto behavior', { timeout: 90_000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'j2cs-node-crypto-'));
  const dotnet = process.env.DOTNET ?? 'dotnet';
  const runtimeProject = path.join(ROOT, 'runtime/J2cs.Runtime/J2cs.Runtime.csproj').replaceAll('\\', '/');
  try {
    await writeFile(path.join(dir, 'NodeCryptoProbe.csproj'), `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <AssemblyName>NodeCryptoProbe</AssemblyName>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>
  <ItemGroup>
    <ProjectReference Include="${runtimeProject}" />
  </ItemGroup>
</Project>
`);
    await writeFile(path.join(dir, 'NuGet.Config'), '<configuration><packageSources><clear /></packageSources></configuration>\n');

    await writeFile(path.join(dir, 'oracle.cjs'), `
const crypto = require('node:crypto');
(async () => {
  const hash = crypto.createHash('sha256');
  console.log('hash-update-self=' + (hash.update('abc') === hash));
  console.log('hash=' + hash.digest('hex'));
  let hashTwice = false; try { hash.digest('hex'); } catch { hashTwice = true; }
  console.log('hash-digest-twice-throws=' + hashTwice);

  const hmac = crypto.createHmac('sha256', 'key');
  console.log('hmac-update-self=' + (hmac.update('abc') === hmac));
  console.log('hmac=' + hmac.digest('hex'));
  console.log('hmac-second=' + hmac.digest('hex'));

  const n = crypto.randomInt(5, 10);
  console.log('random-range=' + (n >= 5 && n < 10));
  console.log('random-bytes-len=' + (crypto.randomBytes(7).length === 7));
  console.log('uuid-v4=' + (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(crypto.randomUUID())));

  console.log('timing=' + crypto.timingSafeEqual(Buffer.from('aa'), Buffer.from('aa')));
  let timingLength = false;
  try { crypto.timingSafeEqual(Buffer.from('a'), Buffer.from('aa')); } catch { timingLength = true; }
  console.log('timing-length-throws=' + timingLength);

  const source = Buffer.from([1, 2]);
  const key = crypto.createSecretKey(source);
  source[0] = 9;
  console.log('secret-type=' + key.type);
  console.log('secret=' + key.export().toString('hex'));
  const exported = key.export(); exported[0] = 7;
  console.log('secret-clone=' + key.export().toString('hex'));

  const web = Buffer.from(await crypto.webcrypto.subtle.digest('SHA-256', Buffer.from('abc')));
  console.log('web-sha256=' + web.toString('hex'));
})().catch(error => { console.error(error); process.exitCode = 1; });
`);

    await writeFile(path.join(dir, 'Program.cs'), `
using J2cs.Runtime.NodeCompat;
using System.Text;
using System.Text.RegularExpressions;

static string B(bool value) => value ? "true" : "false";

using (var hash = NodeCrypto.CreateHash("sha256"))
{
    Console.WriteLine("hash-update-self=" + B(ReferenceEquals(hash, NodeCrypto.HashUpdate(hash, "abc"))));
    Console.WriteLine("hash=" + NodeCrypto.HashDigest(hash, "hex").String);
    var threw = false;
    try { NodeCrypto.HashDigest(hash, "hex"); } catch (InvalidOperationException) { threw = true; }
    Console.WriteLine("hash-digest-twice-throws=" + B(threw));
}

using (var hmac = NodeCrypto.CreateHmac("sha256", "key"))
{
    Console.WriteLine("hmac-update-self=" + B(ReferenceEquals(hmac, NodeCrypto.HmacUpdate(hmac, "abc"))));
    Console.WriteLine("hmac=" + NodeCrypto.HmacDigest(hmac, "hex").String);
    Console.WriteLine("hmac-second=" + NodeCrypto.HmacDigest(hmac, "hex").String);
}

var n = NodeCrypto.RandomInt(5, 10);
Console.WriteLine("random-range=" + B(n >= 5 && n < 10));
Console.WriteLine("random-bytes-len=" + B(NodeCrypto.RandomBytes(7).Length == 7));
Console.WriteLine("uuid-v4=" + B(Regex.IsMatch(NodeCrypto.RandomUuid(),
    "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")));

var aa = new NodeCryptoBytes(Encoding.UTF8.GetBytes("aa"));
Console.WriteLine("timing=" + B(NodeCrypto.TimingSafeEqual(aa, aa)));
var timingLength = false;
try
{
    NodeCrypto.TimingSafeEqual(new NodeCryptoBytes(Encoding.UTF8.GetBytes("a")), aa);
}
catch (ArgumentException)
{
    timingLength = true;
}
Console.WriteLine("timing-length-throws=" + B(timingLength));

var sourceArray = new byte[] { 1, 2 };
var source = new NodeCryptoBytes(sourceArray);
using (var key = NodeCrypto.CreateSecretKey(source))
{
    sourceArray[0] = 9;
    Console.WriteLine("secret-type=" + key.Type);
    Console.WriteLine("secret=" + NodeCrypto.ExportSecretKey(key).ToHex());
    var exported = NodeCrypto.ExportSecretKey(key).ToArray();
    exported[0] = 7;
    Console.WriteLine("secret-clone=" + NodeCrypto.ExportSecretKey(key).ToHex());
}

var web = NodeCrypto.WebCryptoDigestCore("SHA-256", new NodeCryptoBytes(Encoding.UTF8.GetBytes("abc")));
Console.WriteLine("web-sha256=" + web.ToHex());
`);

    const build = await run(dotnet, ['build', 'NodeCryptoProbe.csproj', '--nologo', '-v', 'quiet'], dir, 60_000);
    assert.equal(build.exit, 0, `dotnet build failed:\n${build.stdout}\n${build.stderr}`);
    const node = await run(process.execPath, ['oracle.cjs'], dir, 20_000);
    const csharp = await run(dotnet, [path.join(dir, 'bin/Debug/net8.0/NodeCryptoProbe.dll')], dir, 20_000);
    assert.deepEqual(csharp, node);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
