import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT } from '../../compiler/index.js';
import { run } from './harness.js';

function xml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

async function promiseDifferential(name: string, nodeSource: string, csharpBody: string): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'j2cs-promise-diff-'));
  const dotnet = process.env.DOTNET ?? 'dotnet';
  const projectReference = path.join(ROOT, 'runtime/J2cs.Runtime/J2cs.Runtime.csproj');
  try {
    await writeFile(path.join(dir, 'input.cjs'), nodeSource);
    await writeFile(path.join(dir, 'PromiseFixture.csproj'), `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <AssemblyName>PromiseFixture</AssemblyName>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>
  <ItemGroup><ProjectReference Include="${xml(projectReference)}" /></ItemGroup>
</Project>
`);
    await writeFile(path.join(dir, 'Program.cs'), `using System.Globalization;
using J2cs.Runtime;

void Log(string text) => Console.Write(text + "\\n");

${csharpBody}
`);

    const build = await run(dotnet, ['build', 'PromiseFixture.csproj', '--nologo', '-v', 'quiet'], dir, 60_000);
    assert.equal(build.exit, 0, `${name}: dotnet build failed:\n${build.stdout}\n${build.stderr}`);

    const node = await run(process.execPath, ['input.cjs'], dir);
    const csharp = await run(dotnet, [path.join(dir, 'bin/Debug/net8.0/PromiseFixture.dll')], dir);
    assert.deepEqual(csharp, node, `${name}: Promise runtime differs from Node`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('Node vs C#: Promise constructor is synchronous and reactions are queued', { timeout: 90_000 }, async () => {
  await promiseDifferential('constructor-order', `
const p = new Promise(resolve => {
  console.log('executor');
  resolve(1);
  console.log('after-resolve');
});
p.then(v => { console.log('then1 ' + v); return v + 1; })
 .then(v => { console.log('then2 ' + v); });
console.log('sync');
`, `
var queue = new JsJobQueue();
var p = JsPromise.Create(queue, (resolve, reject) =>
{
    Log("executor");
    resolve(JsValue.FromNumber(1));
    Log("after-resolve");
});
var next = p.Then(v =>
{
    Log("then1 " + v.Number.ToString("0", CultureInfo.InvariantCulture));
    return JsValue.FromNumber(v.Number + 1);
});
next.Then(v =>
{
    Log("then2 " + v.Number.ToString("0", CultureInfo.InvariantCulture));
    return JsUndefined.Value;
});
Log("sync");
queue.Drain();
`);
});

test('Node vs C#: thenable assimilation is asynchronous and first resolving call wins', { timeout: 90_000 }, async () => {
  await promiseDifferential('thenable', `
const thenable = { then(resolve, reject) {
  console.log('thenable');
  resolve(7);
  reject(9);
}};
Promise.resolve(thenable).then(
  v => console.log('value ' + v),
  e => console.log('bad ' + e)
);
console.log('sync');
`, `
var queue = new JsJobQueue();
var thenable = JsPromise.CreateThenable((resolve, reject) =>
{
    Log("thenable");
    resolve(JsValue.FromNumber(7));
    reject(JsValue.FromNumber(9));
});
JsPromise.Resolve(queue, thenable).Then(
    v => { Log("value " + v.Number.ToString("0", CultureInfo.InvariantCulture)); return JsUndefined.Value; },
    e => { Log("bad " + e.Number.ToString("0", CultureInfo.InvariantCulture)); return JsUndefined.Value; });
Log("sync");
queue.Drain();
`);
});

test('Node vs C#: catch recovers and finally preserves the fulfillment value', { timeout: 90_000 }, async () => {
  await promiseDifferential('catch-finally', `
Promise.reject('x')
  .catch(e => { console.log('catch ' + e); return 'ok'; })
  .finally(() => { console.log('finally'); return 99; })
  .then(v => console.log('value ' + v));
console.log('sync');
`, `
var queue = new JsJobQueue();
JsPromise.Reject(queue, JsValue.FromString("x"))
    .Catch(e =>
    {
        Log("catch " + e.String);
        return JsValue.FromString("ok");
    })
    .Finally(() =>
    {
        Log("finally");
        return JsValue.FromNumber(99);
    })
    .Then(v =>
    {
        Log("value " + v.String);
        return JsUndefined.Value;
    });
Log("sync");
queue.Drain();
`);
});

test('Node vs C#: finally rejection overrides and thrown values reject derived promises', { timeout: 90_000 }, async () => {
  await promiseDifferential('finally-override', `
Promise.resolve(8)
  .finally(() => Promise.reject('boom'))
  .catch(e => console.log('caught ' + e));
Promise.resolve(1)
  .then(() => { throw 'thrown'; })
  .catch(e => console.log('throw ' + e));
console.log('sync');
`, `
var queue = new JsJobQueue();
JsPromise.Resolve(queue, JsValue.FromNumber(8))
    .Finally(() => JsPromise.Reject(queue, JsValue.FromString("boom")).AsValue())
    .Catch(e =>
    {
        Log("caught " + e.String);
        return JsUndefined.Value;
    });
JsPromise.Resolve(queue, JsValue.FromNumber(1))
    .Then(_ => throw new JsThrownValueException(JsValue.FromString("thrown")))
    .Catch(e =>
    {
        Log("throw " + e.String);
        return JsUndefined.Value;
    });
Log("sync");
queue.Drain();
`);
});

test('Node vs C#: Promise.resolve preserves intrinsic promise identity and reject preserves promise reasons', { timeout: 90_000 }, async () => {
  await promiseDifferential('identity-reason', `
const q = Promise.resolve(1);
console.log(Promise.resolve(q) === q);
Promise.reject(q).catch(e => console.log(e === q));
`, `
var queue = new JsJobQueue();
var q = JsPromise.Resolve(queue, JsValue.FromNumber(1));
Log(ReferenceEquals(JsPromise.Resolve(queue, q.AsValue()), q) ? "true" : "false");
JsPromise.Reject(queue, q.AsValue()).Catch(e =>
{
    Log(ReferenceEquals(JsObject.RequireReference(e), q) ? "true" : "false");
    return JsUndefined.Value;
});
queue.Drain();
`);
});
