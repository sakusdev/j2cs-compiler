import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT } from '../../compiler/index.js';
import { run } from './harness.js';

const nodeSource = `
const m = new Map();
console.log(m.set('a',1)===m,m.set('b',2)===m,m.set('a',3)===m,m.size,m.get('a'));
m.set(NaN,4);m.set(NaN,5);m.set(-0,6);m.set(+0,7);
console.log(m.size,m.get(NaN),m.get(-0),m.has(+0));
const obj={},obj2={};m.set(obj,8);m.set(obj2,9);m.set(obj,10);
console.log(m.size,m.get(obj),m.get(obj2),obj===obj2);

const mi=new Map([['a',1],['b',2]]);const kit=mi.keys();
console.log(kit.next().value);mi.delete('b');mi.set('b',3);
console.log(kit.next().value,kit.next().done);mi.set('c',4);console.log(kit.next().done);

const mc=new Map([['a',1],['b',2]]);const ci=mc.keys();ci.next();mc.clear();mc.set('c',3);
console.log(ci.next().value,ci.next().done,mc.size);

const mv=new Map([['a',1],['b',2]]);const vi=mv.values();
console.log(vi.next().value);mv.set('b',9);console.log(vi.next().value);
const me=new Map([['x',4]]);const ep=me.entries().next().value;
console.log(ep[0],ep[1],ep.length);

const s=new Set();
console.log(s.add(NaN)===s,s.add(NaN)===s,s.add(-0)===s,s.add(+0)===s,s.size,s.has(NaN),s.has(0));
const so=new Set([obj,obj,obj2]);console.log(so.size,so.has(obj));
const si=new Set([1,2]);const sit=si.values();
console.log(sit.next().value);si.delete(2);si.add(2);
console.log(sit.next().value,sit.next().done);si.add(3);console.log(sit.next().done);
const sc=new Set([1,2]);const sci=sc.values();sci.next();sc.clear();sc.add(3);
console.log(sci.next().value,sci.next().done,sc.size);
const sep=new Set(['x']).entries().next().value;console.log(sep[0],sep[1],sep.length);

const wk={},wk2={};const wm=new WeakMap();
console.log(wm.set(wk,1)===wm,wm.get(wk),wm.has(wk),wm.has(wk2),wm.get(1)===undefined,wm.has(1),wm.delete(1));
wm.set(wk,2);console.log(wm.get(wk),wm.delete(wk),wm.has(wk));
try{wm.set(1,3)}catch(e){console.log(e.name)}

const ws=new WeakSet();
console.log(ws.add(wk)===ws,ws.has(wk),ws.has(wk2),ws.has(1),ws.delete(1));
console.log(ws.delete(wk),ws.has(wk));
try{ws.add(1)}catch(e){console.log(e.name)}
`;

const csharpSource = `using J2cs.Runtime;

static class Probe
{
    static JsValue N(double value) => JsValue.FromNumber(value);
    static JsValue T(string value) => JsValue.FromString(value);
    static string B(bool value) => value ? "true" : "false";
    static string D(double value) => JsNumber.Format(value);
    static string V(JsValue value) => value.Kind switch
    {
        JsKind.Undefined => "undefined",
        JsKind.Null => "null",
        JsKind.Number => D(value.Number),
        JsKind.String => value.String,
        JsKind.Boolean => B(value.Boolean),
        JsKind.Object => "[object]",
        _ => throw new InvalidOperationException("Unknown value tag")
    };
    static void Log(params string[] values) => Console.WriteLine(string.Join(" ", values));
    static JsValue Next(JsValue iterator) => JsCollectionIterator.Next(iterator);
    static JsValue IteratorValue(JsValue result) => JsObject.GetProperty(result, "value");
    static bool IteratorDone(JsValue result) => JsObject.GetProperty(result, "done").Boolean;

    public static void Main()
    {
        var m = JsMap.Create();
        Log(
            B(JsOperators.StrictEquals(JsMap.Set(m, T("a"), N(1)), m)),
            B(JsOperators.StrictEquals(JsMap.Set(m, T("b"), N(2)), m)),
            B(JsOperators.StrictEquals(JsMap.Set(m, T("a"), N(3)), m)),
            D(JsMap.Size(m)),
            V(JsMap.Get(m, T("a"))));
        JsMap.Set(m, N(double.NaN), N(4));
        JsMap.Set(m, N(double.NaN), N(5));
        JsMap.Set(m, N(-0.0d), N(6));
        JsMap.Set(m, N(+0.0d), N(7));
        Log(D(JsMap.Size(m)), V(JsMap.Get(m, N(double.NaN))), V(JsMap.Get(m, N(-0.0d))), B(JsMap.Has(m, N(+0.0d))));
        var obj = JsObject.Create();
        var obj2 = JsObject.Create();
        JsMap.Set(m, obj, N(8));
        JsMap.Set(m, obj2, N(9));
        JsMap.Set(m, obj, N(10));
        Log(D(JsMap.Size(m)), V(JsMap.Get(m, obj)), V(JsMap.Get(m, obj2)), B(JsOperators.StrictEquals(obj, obj2)));

        var mi = JsMap.Create();
        JsMap.Set(mi, T("a"), N(1)); JsMap.Set(mi, T("b"), N(2));
        var kit = JsMap.Keys(mi);
        Log(V(IteratorValue(Next(kit))));
        JsMap.Delete(mi, T("b")); JsMap.Set(mi, T("b"), N(3));
        var kitSecond = Next(kit);
        var kitDone = Next(kit);
        Log(V(IteratorValue(kitSecond)), B(IteratorDone(kitDone)));
        JsMap.Set(mi, T("c"), N(4));
        Log(B(IteratorDone(Next(kit))));

        var mc = JsMap.Create();
        JsMap.Set(mc, T("a"), N(1)); JsMap.Set(mc, T("b"), N(2));
        var ci = JsMap.Keys(mc); Next(ci); JsMap.Clear(mc); JsMap.Set(mc, T("c"), N(3));
        var ciValue = Next(ci); var ciDone = Next(ci);
        Log(V(IteratorValue(ciValue)), B(IteratorDone(ciDone)), D(JsMap.Size(mc)));

        var mv = JsMap.Create();
        JsMap.Set(mv, T("a"), N(1)); JsMap.Set(mv, T("b"), N(2));
        var vi = JsMap.Values(mv);
        Log(V(IteratorValue(Next(vi))));
        JsMap.Set(mv, T("b"), N(9));
        Log(V(IteratorValue(Next(vi))));
        var me = JsMap.Create(); JsMap.Set(me, T("x"), N(4));
        var ep = IteratorValue(Next(JsMap.Entries(me)));
        Log(V(JsObject.GetProperty(ep, "0")), V(JsObject.GetProperty(ep, "1")), D(JsArray.Length(ep)));

        var s = JsSet.Create();
        Log(
            B(JsOperators.StrictEquals(JsSet.Add(s, N(double.NaN)), s)),
            B(JsOperators.StrictEquals(JsSet.Add(s, N(double.NaN)), s)),
            B(JsOperators.StrictEquals(JsSet.Add(s, N(-0.0d)), s)),
            B(JsOperators.StrictEquals(JsSet.Add(s, N(+0.0d)), s)),
            D(JsSet.Size(s)), B(JsSet.Has(s, N(double.NaN))), B(JsSet.Has(s, N(0))));
        var so = JsSet.Create(); JsSet.Add(so, obj); JsSet.Add(so, obj); JsSet.Add(so, obj2);
        Log(D(JsSet.Size(so)), B(JsSet.Has(so, obj)));

        var si = JsSet.Create(); JsSet.Add(si, N(1)); JsSet.Add(si, N(2));
        var sit = JsSet.Values(si);
        Log(V(IteratorValue(Next(sit))));
        JsSet.Delete(si, N(2)); JsSet.Add(si, N(2));
        var sitSecond = Next(sit); var sitDone = Next(sit);
        Log(V(IteratorValue(sitSecond)), B(IteratorDone(sitDone)));
        JsSet.Add(si, N(3));
        Log(B(IteratorDone(Next(sit))));

        var sc = JsSet.Create(); JsSet.Add(sc, N(1)); JsSet.Add(sc, N(2));
        var sci = JsSet.Values(sc); Next(sci); JsSet.Clear(sc); JsSet.Add(sc, N(3));
        var sciValue = Next(sci); var sciDone = Next(sci);
        Log(V(IteratorValue(sciValue)), B(IteratorDone(sciDone)), D(JsSet.Size(sc)));
        var se = JsSet.Create(); JsSet.Add(se, T("x"));
        var sep = IteratorValue(Next(JsSet.Entries(se)));
        Log(V(JsObject.GetProperty(sep, "0")), V(JsObject.GetProperty(sep, "1")), D(JsArray.Length(sep)));

        var wk = JsObject.Create(); var wk2 = JsObject.Create(); var wm = JsRuntime.CreateWeakMap();
        Log(
            B(JsOperators.StrictEquals(JsRuntime.WeakMapSet(wm, wk, N(1)), wm)),
            V(JsRuntime.WeakMapGet(wm, wk)),
            B(JsRuntime.WeakMapHas(wm, wk)),
            B(JsRuntime.WeakMapHas(wm, wk2)),
            B(JsRuntime.WeakMapGet(wm, N(1)).Kind == JsKind.Undefined),
            B(JsRuntime.WeakMapHas(wm, N(1))),
            B(JsRuntime.WeakMapDelete(wm, N(1))));
        JsRuntime.WeakMapSet(wm, wk, N(2));
        Log(V(JsRuntime.WeakMapGet(wm, wk)), B(JsRuntime.WeakMapDelete(wm, wk)), B(JsRuntime.WeakMapHas(wm, wk)));
        try { JsRuntime.WeakMapSet(wm, N(1), N(3)); }
        catch (JsWeakCollectionKeyException) { Log(JsWeakCollectionKeyException.JavaScriptName); }

        var ws = JsRuntime.CreateWeakSet();
        Log(
            B(JsOperators.StrictEquals(JsRuntime.WeakSetAdd(ws, wk), ws)),
            B(JsRuntime.WeakSetHas(ws, wk)),
            B(JsRuntime.WeakSetHas(ws, wk2)),
            B(JsRuntime.WeakSetHas(ws, N(1))),
            B(JsRuntime.WeakSetDelete(ws, N(1))));
        Log(B(JsRuntime.WeakSetDelete(ws, wk)), B(JsRuntime.WeakSetHas(ws, wk)));
        try { JsRuntime.WeakSetAdd(ws, N(1)); }
        catch (JsWeakCollectionKeyException) { Log(JsWeakCollectionKeyException.JavaScriptName); }
    }
}
`;

function xmlAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

test('Node vs C# collection runtime: SameValueZero, ordering, mutation and weak boundaries', { timeout: 90_000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'j2cs-collections-'));
  const dotnet = process.env.DOTNET ?? 'dotnet';
  try {
    await writeFile(path.join(dir, 'input.cjs'), nodeSource);
    await writeFile(path.join(dir, 'Program.cs'), csharpSource);
    const runtimeProject = path.join(ROOT, 'runtime/J2cs.Runtime/J2cs.Runtime.csproj');
    await writeFile(path.join(dir, 'Probe.csproj'), `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
  </PropertyGroup>
  <ItemGroup>
    <ProjectReference Include="${xmlAttribute(runtimeProject)}" />
  </ItemGroup>
</Project>
`);

    const build = await run(dotnet, ['build', 'Probe.csproj', '--nologo', '-v', 'quiet'], dir, 60_000);
    assert.equal(build.exit, 0, `dotnet build failed:\n${build.stdout}\n${build.stderr}`);
    const node = await run(process.execPath, ['input.cjs'], dir);
    const csharp = await run(dotnet, [path.join(dir, 'bin/Debug/net8.0/Probe.dll')], dir);
    assert.equal(node.exit, 0, node.stderr);
    assert.deepEqual(csharp, node, 'Collection runtime differs from Node (stdout/stderr/exit/signal)');
    await rm(dir, { recursive: true, force: true });
  } catch (error) {
    throw new Error(`collections-runtime: ${String(error)}\nReproduction artifacts: ${dir}`, { cause: error });
  }
});
