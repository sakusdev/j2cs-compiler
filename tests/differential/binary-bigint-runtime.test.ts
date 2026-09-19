import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run } from './harness.js';

function xmlEscape(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
}

const nodeSource = String.raw`
const b = new ArrayBuffer(16);
const u16 = new Uint16Array(b, 0, 4);
console.log(b.byteLength, u16.length, u16[0], u16[99] === undefined);
u16[0] = 0x1234;
console.log(u16[0]);

const clamp = new Uint8ClampedArray(2);
clamp[0] = 2.5; clamp[1] = 3.5;
console.log(clamp[0], clamp[1]);

const dv = new DataView(b);
dv.setUint32(8, 0x01020304);
console.log(dv.getUint32(8), dv.getUint32(8, true));
dv.setUint16(12, 0x1122, true);
console.log(dv.getUint16(12, true), dv.getUint16(12));

console.log(123456789012345678901234567890n + 10n);
console.log(-7n / 3n, -7n % 3n, 2n ** 20n);
console.log(BigInt(42), BigInt(true), BigInt('0x10'));

for (const f of [() => BigInt(1.5), () => BigInt('1.5')]) {
  try { f(); } catch (e) { console.log(e.name); }
}

const bi = new BigUint64Array(1);
bi[0] = (1n << 64n) + 3n;
console.log(bi[0]);
try { bi[0] = 1; } catch (e) { console.log(e.name); }

try { dv.getUint32(14); } catch (e) { console.log(e.name); }

const detached = new ArrayBuffer(8);
const detachedView = new Uint8Array(detached);
const detachedData = new DataView(detached);
structuredClone(detached, { transfer: [detached] });
console.log(detached.byteLength, detachedView.length, detachedView[0] === undefined);
try { detachedData.getUint8(0); } catch (e) { console.log(e.name); }
`;

const csharpSource = String.raw`using J2cs.Runtime;

static string B(bool value) => value ? "true" : "false";
static string S(JsBinaryValue value) => value.ToDisplayString();

var b = JsBinary.NewArrayBuffer(JsBinaryValue.FromNumber(16));
var u16 = JsBinary.NewTypedArrayView(JsTypedArrayKind.Uint16, b, JsBinaryValue.FromNumber(0), JsBinaryValue.FromNumber(4));
Console.WriteLine($"{b.ByteLength} {u16.Length} {S(JsBinary.TypedArrayGet(u16, JsBinaryValue.FromNumber(0)))} {B(JsBinary.TypedArrayGet(u16, JsBinaryValue.FromNumber(99)).Kind == JsBinaryValueKind.Undefined)}");
JsBinary.TypedArraySetNumber(u16, JsBinaryValue.FromNumber(0), JsBinaryValue.FromNumber(0x1234));
Console.WriteLine(S(JsBinary.TypedArrayGet(u16, JsBinaryValue.FromNumber(0))));

var clampBuffer = JsBinary.NewArrayBuffer(JsBinaryValue.FromNumber(2));
var clamp = JsBinary.NewTypedArrayView(JsTypedArrayKind.Uint8Clamped, clampBuffer, JsBinaryValue.FromNumber(0), JsBinaryValue.FromNumber(2));
JsBinary.TypedArraySetNumber(clamp, JsBinaryValue.FromNumber(0), JsBinaryValue.FromNumber(2.5));
JsBinary.TypedArraySetNumber(clamp, JsBinaryValue.FromNumber(1), JsBinaryValue.FromNumber(3.5));
Console.WriteLine($"{S(JsBinary.TypedArrayGet(clamp, JsBinaryValue.FromNumber(0)))} {S(JsBinary.TypedArrayGet(clamp, JsBinaryValue.FromNumber(1)))}");

var dv = JsBinary.NewDataView(b, JsBinaryValue.FromNumber(0));
JsBinary.DataViewSet(dv, JsDataViewKind.Uint32, JsBinaryValue.FromNumber(8), JsBinaryValue.FromNumber(0x01020304));
Console.WriteLine($"{S(JsBinary.DataViewGet(dv, JsDataViewKind.Uint32, JsBinaryValue.FromNumber(8)))} {S(JsBinary.DataViewGet(dv, JsDataViewKind.Uint32, JsBinaryValue.FromNumber(8), true))}");
JsBinary.DataViewSet(dv, JsDataViewKind.Uint16, JsBinaryValue.FromNumber(12), JsBinaryValue.FromNumber(0x1122), true);
Console.WriteLine($"{S(JsBinary.DataViewGet(dv, JsDataViewKind.Uint16, JsBinaryValue.FromNumber(12), true))} {S(JsBinary.DataViewGet(dv, JsDataViewKind.Uint16, JsBinaryValue.FromNumber(12)))}");

Console.WriteLine((JsBigInt.ParseLiteral("123456789012345678901234567890").Value + JsBigInt.ParseLiteral("10").Value).ToString(System.Globalization.CultureInfo.InvariantCulture) + "n");
Console.WriteLine($"{JsBigInt.Divide(JsBigInt.ParseLiteral("-7"), JsBigInt.ParseLiteral("3"))}n {JsBigInt.Remainder(JsBigInt.ParseLiteral("-7"), JsBigInt.ParseLiteral("3"))}n {JsBigInt.Exponentiate(JsBigInt.ParseLiteral("2"), JsBigInt.ParseLiteral("20"))}n");
Console.WriteLine($"{JsCoercion.BigIntFunctionPrimitive(JsBinaryValue.FromNumber(42))}n {JsCoercion.BigIntFunctionPrimitive(JsBinaryValue.FromBoolean(true))}n {JsCoercion.BigIntFunctionPrimitive(JsBinaryValue.FromString("0x10"))}n");

foreach (var f in new Func<JsBigInt>[] {
    () => JsCoercion.BigIntFunctionPrimitive(JsBinaryValue.FromNumber(1.5)),
    () => JsCoercion.BigIntFunctionPrimitive(JsBinaryValue.FromString("1.5")),
}) {
    try { _ = f(); } catch (JsBinaryBigIntException e) { Console.WriteLine(e.Name); }
}

var biBuffer = JsBinary.NewArrayBuffer(JsBinaryValue.FromNumber(8));
var bi = JsBinary.NewTypedArrayView(JsTypedArrayKind.BigUint64, biBuffer, JsBinaryValue.FromNumber(0), JsBinaryValue.FromNumber(1));
var huge = JsBigInt.Add(JsBigInt.Exponentiate(JsBigInt.ParseLiteral("2"), JsBigInt.ParseLiteral("64")), JsBigInt.ParseLiteral("3"));
JsBinary.TypedArraySetBigInt(bi, JsBinaryValue.FromNumber(0), JsBinaryValue.FromBigInt(huge));
Console.WriteLine(S(JsBinary.TypedArrayGet(bi, JsBinaryValue.FromNumber(0))));
try { JsBinary.TypedArraySetBigInt(bi, JsBinaryValue.FromNumber(0), JsBinaryValue.FromNumber(1)); } catch (JsBinaryBigIntException e) { Console.WriteLine(e.Name); }

try { _ = JsBinary.DataViewGet(dv, JsDataViewKind.Uint32, JsBinaryValue.FromNumber(14)); } catch (JsBinaryBigIntException e) { Console.WriteLine(e.Name); }

var detached = JsBinary.NewArrayBuffer(JsBinaryValue.FromNumber(8));
var detachedView = JsBinary.NewTypedArrayView(JsTypedArrayKind.Uint8, detached, JsBinaryValue.FromNumber(0));
var detachedData = JsBinary.NewDataView(detached, JsBinaryValue.FromNumber(0));
detached.Detach();
Console.WriteLine($"{detached.ByteLength} {detachedView.Length} {B(JsBinary.TypedArrayGet(detachedView, JsBinaryValue.FromNumber(0)).Kind == JsBinaryValueKind.Undefined)}");
try { _ = JsBinary.DataViewGet(detachedData, JsDataViewKind.Uint8, JsBinaryValue.FromNumber(0)); } catch (JsBinaryBigIntException e) { Console.WriteLine(e.Name); }
`;

test('Node vs J2cs.Runtime: ArrayBuffer/TypedArray/DataView/BigInt contract', { timeout: 90_000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'j2cs-binary-bigint-'));
  const runtimeProject = path.resolve('runtime/J2cs.Runtime/J2cs.Runtime.csproj');
  const project = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
  </PropertyGroup>
  <ItemGroup>
    <ProjectReference Include="${xmlEscape(runtimeProject)}" />
  </ItemGroup>
</Project>
`;
  try {
    await writeFile(path.join(dir, 'input.cjs'), nodeSource);
    await writeFile(path.join(dir, 'Runner.csproj'), project);
    await writeFile(path.join(dir, 'Program.cs'), csharpSource);

    const build = await run(process.env.DOTNET ?? 'dotnet', ['build', 'Runner.csproj', '--nologo', '-v', 'quiet'], dir, 60_000);
    assert.equal(build.exit, 0, `dotnet build failed:\n${build.stdout}\n${build.stderr}`);

    const node = await run(process.execPath, ['input.cjs'], dir);
    const csharp = await run(process.env.DOTNET ?? 'dotnet', [path.join(dir, 'bin/Debug/net8.0/Runner.dll')], dir);
    assert.deepEqual(csharp, node, 'Binary/BigInt runtime behavior differs from Node');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
