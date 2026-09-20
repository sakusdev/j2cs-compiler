import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT } from '../../compiler/index.js';
import { run } from './harness.js';

const nodeOracle = String.raw`
class ContractError extends Error { constructor(name, message = name) { super(message); this.name = name; } }
class Area {
  constructor(limit = Infinity) { this.limit = limit; this.map = new Map(); this.mutations = 0; }
  setItem(k, v) {
    k = String(k); v = String(v);
    if (this.map.has(k) && this.map.get(k) === v) return;
    let size = k.length + v.length;
    for (const [ek, ev] of this.map) if (ek !== k) size += ek.length + ev.length;
    if (size > this.limit) throw new ContractError('QuotaExceededError');
    this.map.set(k, v); this.mutations++;
  }
  getItem(k) { return this.map.has(String(k)) ? this.map.get(String(k)) : null; }
  key(i) { return [...this.map.keys()][i] ?? null; }
  get length() { return this.map.size; }
}
class Registry {
  constructor(limit = Infinity) { this.limit = limit; this.local = new Map(); this.session = new Map(); }
  localArea(storageKey, origin) {
    const key = storageKey + '|' + origin;
    if (!this.local.has(key)) this.local.set(key, new Area(this.limit));
    return this.local.get(key);
  }
  sessionArea(storageKey, origin, page) {
    const key = storageKey + '|' + origin + '|' + page;
    if (!this.session.has(key)) this.session.set(key, new Area(this.limit));
    return this.session.get(key);
  }
  snapshot(profileId) {
    return { version: 2, profileId, local: [...this.local].map(([key, area]) => [key, [...area.map]]) };
  }
  restore(snapshot) {
    this.local.clear(); this.session.clear();
    for (const [key, entries] of snapshot.local) { const a = new Area(this.limit); a.map = new Map(entries); this.local.set(key, a); }
  }
}
function err(fn) { try { fn(); return 'none'; } catch (e) { return e.name; } }

const r = new Registry();
const a = r.localArea('tenant-a', 'https://example.test');
const again = r.localArea('tenant-a', 'https://example.test');
const otherSession = r.sessionArea('tenant-a', 'https://example.test', 'page-1');
console.log(a === again, a === otherSession);
a.setItem('a','1'); a.setItem('a','1'); a.setItem('b','2');
console.log(a.length, a.mutations, a.key(0), a.key(1));

const q = new Registry(4).localArea('tenant-a', 'https://example.test');
q.setItem('a','1');
console.log(err(() => q.setItem('bb','22')), q.length, q.getItem('a'));

otherSession.setItem('temp','s');
a.setItem('persist','v');
const snap = r.snapshot('profile-main');
const restarted = new Registry(); restarted.restore(snap);
console.log(restarted.localArea('tenant-a','https://example.test').getItem('persist'), restarted.sessionArea('tenant-a','https://example.test','page-1').getItem('temp'));

function idbOpen(name, version) {
  if (version !== undefined && version <= 0) throw new ContractError('TypeError');
  return { name, version, eventDriven: true, structuredClone: true };
}
console.log(err(() => idbOpen('db',0)), idbOpen('db',2).name, idbOpen('db',2).version, idbOpen('db',2).eventDriven, idbOpen('db',2).structuredClone);

function cacheOpen(secure, storageKey, name) {
  if (!secure) throw new ContractError('SecurityError');
  return { storageKey, name, hostPersistence: true };
}
const cache = cacheOpen(true, 'tenant-a', 'shell');
console.log(err(() => cacheOpen(false,'tenant-a','shell')), cache.storageKey, cache.name, cache.hostPersistence);

class Host { constructor(){ this.storageFlush = 0; this.cookieFlush = 0; } }
class Protection {
  constructor(available = true) { this.available = available; }
  protect(bytes) { if (!this.available) throw new ContractError('NotSupportedError'); return Uint8Array.from(bytes, b => b ^ 0x5a); }
  unprotect(bytes) { return Uint8Array.from(bytes, b => b ^ 0x5a); }
}
class Session {
  constructor(partition, persistent, options, host, protection) {
    this.partition=partition; this.persistent=persistent; this.options=options; this.host=host; this.protection=protection;
    this.cookies=new Map(); this.credentials=new Map();
  }
  setCredential(key, value) {
    if (!this.protection.available) throw new ContractError('NotSupportedError');
    this.credentials.set(key, this.protection.protect(Buffer.from(value)));
  }
  getCredential(key) {
    if (!this.credentials.has(key)) return null;
    if (!this.protection.available) throw new ContractError('NotSupportedError');
    return Buffer.from(this.protection.unprotect(this.credentials.get(key))).toString();
  }
  capture(namespace) {
    if (!this.persistent) throw new ContractError('InvalidStateError');
    this.host.storageFlush++; this.host.cookieFlush++;
    return { version:2, partition:this.partition, persistent:true, namespace, cookies:[...this.cookies], credentials:[...this.credentials] };
  }
}
class Sessions {
  constructor(host, protection){ this.host=host; this.protection=protection; this.map=new Map(); }
  fromPartition(partition, options={cacheEnabled:true}) {
    if (this.map.has(partition)) return this.map.get(partition);
    const s = new Session(partition, partition === '' || partition.startsWith('persist:'), options, this.host, this.protection);
    this.map.set(partition,s); return s;
  }
  restore(snapshot) {
    if (!snapshot.persistent) throw new ContractError('InvalidStateError');
    const s=this.fromPartition(snapshot.partition); s.cookies=new Map(snapshot.cookies); s.credentials=new Map(snapshot.credentials); return s;
  }
}
const host = new Host(), protection = new Protection(), sessions = new Sessions(host, protection);
const s1 = sessions.fromPartition('persist:alpha', {cacheEnabled:false});
const s2 = sessions.fromPartition('persist:alpha', {cacheEnabled:true});
const memory = sessions.fromPartition('temporary');
console.log(s1.persistent, memory.persistent, s1 === s2, s1.options.cacheEnabled);
s1.cookies.set('sid|example.test|/', {name:'sid',value:'a'});
console.log(s2.cookies.get('sid|example.test|/').value, sessions.fromPartition('persist:other').cookies.size === 0);
console.log(true, true);

const unavailable = new Sessions(new Host(), new Protection(false)).fromPartition('persist:x');
console.log(err(() => unavailable.setCredential('api','secret')));
s1.setCredential('api','secret');
console.log(s1.getCredential('api'), Buffer.from(s1.credentials.get('api')).toString('base64') !== Buffer.from('secret').toString('base64'));

const sessionSnap = s1.capture('profile-main');
console.log(host.storageFlush, host.cookieFlush);
const restoredSession = new Sessions(new Host(), protection).restore(sessionSnap);
console.log(restoredSession.cookies.get('sid|example.test|/').value, restoredSession.getCredential('api'), sessionSnap.version, sessionSnap.namespace);
const migrated = { ...sessionSnap, version: 2, namespace: 'default' };
console.log(migrated.version, migrated.namespace);
console.log(err(() => memory.capture('x')));
`;

const csharpProgram = String.raw`
using J2cs.Runtime.WebCompat;
using J2cs.Runtime.ElectronCompat;
using System.Text;

static string B(bool value) => value ? "true" : "false";
static string ErrorName(Action action)
{
    try { action(); return "none"; }
    catch (StorageContractException ex) { return ex.Name; }
    catch (SessionContractException ex) { return ex.Name; }
}

var partition = new BrowserStoragePartition("tenant-a", "https://example.test");
var registry = new WebStorageRegistry();
var local = registry.GetLocalStorage(partition);
var localAgain = registry.GetLocalStorage(partition);
var sessionArea = registry.GetSessionStorage(partition, "page-1");
Console.WriteLine($"{B(ReferenceEquals(local, localAgain))} {B(ReferenceEquals(local, sessionArea))}");
local.SetItem("a", "1"); local.SetItem("a", "1"); local.SetItem("b", "2");
Console.WriteLine($"{local.Length} {local.PendingMutations.Count} {local.Key(0)} {local.Key(1)}");

var quota = new WebStorageRegistry(new CodeUnitStorageQuotaPolicy(4)).GetLocalStorage(partition);
quota.SetItem("a", "1");
Console.WriteLine($"{ErrorName(() => quota.SetItem("bb", "22"))} {quota.Length} {quota.GetItem("a")}");

sessionArea.SetItem("temp", "s");
local.SetItem("persist", "v");
StorageProfileSnapshot snapshot = registry.CapturePersistentProfile("profile-main");
var restarted = new WebStorageRegistry();
restarted.RestorePersistentProfile(snapshot);
Console.WriteLine($"{restarted.GetLocalStorage(partition).GetItem("persist")} {restarted.GetSessionStorage(partition, "page-1").GetItem("temp") ?? "null"}");

Console.WriteLine($"{ErrorName(() => IndexedDbBoundary.Open(partition, "db", 0))} {IndexedDbBoundary.Open(partition, "db", 2).DatabaseName} {IndexedDbBoundary.Open(partition, "db", 2).RequestedVersion} {B(IndexedDbBoundary.Open(partition, "db", 2).EventDrivenRequest)} {B(IndexedDbBoundary.Open(partition, "db", 2).StructuredCloneRequired)}");

var cache = new CacheStorageBoundary(partition, true).Open("shell");
Console.WriteLine($"{ErrorName(() => new CacheStorageBoundary(partition, false).Open("shell"))} {cache.Partition.StorageKey} {cache.CacheName} {B(cache.HostPersistenceRequired)}");

var host = new TestHost();
var protection = new TestProtectionBackend(true);
var sessions = new ElectronSessionRegistry(host, protection);
var s1 = sessions.FromPartition("persist:alpha", new ElectronSessionOptions(false));
var s2 = sessions.FromPartition("persist:alpha", new ElectronSessionOptions(true));
var memory = sessions.FromPartition("temporary");
Console.WriteLine($"{B(s1.IsPersistent)} {B(memory.IsPersistent)} {B(ReferenceEquals(s1, s2))} {B(s1.Options.CacheEnabled)}");
s1.Cookies.Set(new SessionCookie("sid", "a", "example.test", "/"));
Console.WriteLine($"{s2.Cookies.Get("sid").Single().Value} {B(sessions.FromPartition("persist:other").Cookies.Get().Count == 0)}");
Console.WriteLine($"{B(s1.StoragePath is not null)} {B(memory.StoragePath is null)}");

var unavailable = new ElectronSessionRegistry(new TestHost(), new TestProtectionBackend(false)).FromPartition("persist:x");
Console.WriteLine(ErrorName(() => unavailable.Credentials.Set("api", "secret")));
s1.Credentials.Set("api", "secret");
string protectedText = Convert.ToBase64String(s1.Credentials.ExportProtected().Single().ProtectedBytes);
Console.WriteLine($"{s1.Credentials.Get("api")} {B(protectedText != Convert.ToBase64String(Encoding.UTF8.GetBytes("secret")))}");

SessionProfileSnapshot sessionSnapshot = s1.CaptureForRestart("profile-main");
Console.WriteLine($"{host.StorageFlushes} {host.CookieFlushes}");
var restoredSession = new ElectronSessionRegistry(new TestHost(), protection).RestoreForRestart(sessionSnapshot);
Console.WriteLine($"{restoredSession.Cookies.Get("sid").Single().Value} {restoredSession.Credentials.Get("api")} {sessionSnapshot.SchemaVersion} {sessionSnapshot.ProfileNamespace}");

var v1 = new SessionProfileSnapshot(1, "persist:legacy", true, "", Array.Empty<SessionCookie>(), Array.Empty<CredentialEnvelope>());
var migrated = SessionProfileMigrator.Migrate(v1);
Console.WriteLine($"{migrated.SchemaVersion} {migrated.ProfileNamespace}");
Console.WriteLine(ErrorName(() => memory.CaptureForRestart("x")));

sealed class TestHost : IElectronSessionHost
{
    public int StorageFlushes { get; private set; }
    public int CookieFlushes { get; private set; }
    public string StoragePathFor(ElectronSession session) => Path.GetFullPath(Path.Combine("profiles", session.Partition.Replace(':', '_')));
    public void FlushStorageData(ElectronSession session) => StorageFlushes++;
    public void FlushCookieStore(ElectronSession session) => CookieFlushes++;
}

sealed class TestProtectionBackend(bool available) : ISecureCredentialBackend
{
    public bool IsAvailable { get; } = available;
    public byte[] Protect(ReadOnlySpan<byte> clearBytes) => Transform(clearBytes);
    public byte[] Unprotect(ReadOnlySpan<byte> protectedBytes) => Transform(protectedBytes);
    private static byte[] Transform(ReadOnlySpan<byte> input)
    {
        byte[] result = input.ToArray();
        for (int i = 0; i < result.Length; i++) result[i] ^= 0x5a;
        return result;
    }
}
`;

function xml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

test('Node vs C#: storage/profile/session runtime contract', { timeout: 90_000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'j2cs-storage-profile-diff-'));
  try {
    const runtime = path.join(ROOT, 'runtime/J2cs.Runtime/J2cs.Runtime.csproj');
    const project = path.join(dir, 'Generated.csproj');
    await writeFile(path.join(dir, 'input.cjs'), nodeOracle);
    await writeFile(path.join(dir, 'Program.cs'), csharpProgram);
    await writeFile(project, `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <AssemblyName>J2cs.StorageProfileDiff</AssemblyName>
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
    const csharp = await run(process.env.DOTNET ?? 'dotnet', [path.join(dir, 'bin/Debug/net8.0/J2cs.StorageProfileDiff.dll')], dir);
    assert.equal(node.exit, 0);
    const normalized = (execution: typeof node) => ({
      ...execution,
      stdout: execution.stdout.replaceAll('\r\n', '\n'),
      stderr: execution.stderr.replaceAll('\r\n', '\n'),
    });
    assert.deepEqual(normalized(csharp), normalized(node), 'Storage/profile runtime behavior differs from the Node oracle');
  } catch (error) {
    throw new Error(`Storage/profile differential failed; artifacts: ${dir}: ${String(error)}`, { cause: error });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
