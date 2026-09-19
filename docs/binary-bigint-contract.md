# BUILTINS_BINARY_BIGINT runtime contract

This lane implements independently testable runtime infrastructure for canonical
`j2cs` binary-data and BigInt semantics. The reviewed rule database is pinned to
`35ca8d859f9352e90ee2497f4ac8f6edb9c19ed1`. The executable proof contract in
`compiler/rules/binary-bigint-contract.ts` verifies that the expected canonical
rule IDs, strategies, helper names, and requirement vocabulary still match that
checkout. Missing proof facts remain `unknown`; they never authorize lowering.

## Implemented runtime surface

- fixed-length, zero-initialized `ArrayBuffer` backing stores;
- fixed `TypedArray` views over existing buffers, with alignment/range checks,
  shared backing storage, canonical numeric indexed reads, numeric writes,
  `Uint8Clamped` ties-to-even conversion, BigInt64/BigUint64 modulo conversion,
  out-of-bounds behavior, and detached-buffer observations;
- fixed `DataView` views with `ToIndex`-style offsets, explicit bounds checks,
  big-endian default behavior, little-endian override, integer/float access, and
  BigInt64/BigUint64 access;
- exact arbitrary-precision `JsBigInt` values, canonical-decimal literal loading,
  String/Number/Boolean conversion boundaries, `ToBigInt64`/`ToBigUint64`,
  arithmetic, truncating division/remainder, exponentiation, and distinct
  TypeError/RangeError/SyntaxError categories.

TypedArray writes preserve the observable ECMAScript ordering in which RHS
coercion occurs before an invalid, out-of-bounds, or detached integer index turns
storage into a no-op.

## Deliberately fail-closed

This lane does **not** add BigInt to the shared `JsValue` lattice or edit the
shared parser, semantic IR, lowering dispatcher, emitter, or adapter registry.
Those are concurrency-heavy integration surfaces owned by other lanes. Therefore
source syntax such as `1n` remains rejected by the current compiler rather than
claiming support without a complete proof path.

The runtime contract likewise does not approximate resizable/growable buffers,
`SharedArrayBuffer`, Proxy interception, arbitrary object property semantics,
object `ToPrimitive`, or dynamic Number/BigInt operator dispatch. Fixed-buffer
helpers accept explicit typed proof boundaries; unavailable integration stays
unsupported.

## Validation

`tests/compiler/binary-bigint-contract.test.ts` checks the exact pinned rule DB,
canonical helper contracts, three-valued proof behavior, and the fail-closed
BigInt syntax boundary.

`tests/differential/binary-bigint-runtime.test.ts` runs equivalent Node.js and
C# programs and compares stdout/stderr/exit/signal for normal and edge behavior,
including endianness, clamping, out-of-bounds writes, BigInt coercion failures,
64-bit wrapping, bounds errors, and detached buffers. The repository's existing
CI still runs the complete compiler/differential suite on Linux and Windows plus
the unmodified upstream validator and Coverage Gap Analyzer.
