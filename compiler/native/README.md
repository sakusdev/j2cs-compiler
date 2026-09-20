# Native module migration boundary

This directory owns the compiler-side contract for migrating resolved Node native modules.
It does not treat a `.node` filename as proof that a module can be loaded safely.

## Canonical rule proof

Every plan requires the pinned j2cs rule `modules.cjs.require-resolution` to match
its reviewed SHA-256 and to prove these facts:

- host is Node.js;
- the module system is CommonJS;
- the request is not a compile-time intrinsic.

The upstream database currently has no dedicated N-API/native-addon rule. This lane
therefore does not invent one. Native-addon semantics remain explicit compatibility
contracts layered after canonical Node-compatible resolution.

## Routing

A resolver-proven native module is considered in this order:

1. reviewed known-module adapter;
2. reviewed native wrapper contract;
3. reviewed sidecar bridge;
4. explicit unsupported result.

RID and ABI family/major, lifetime ownership, and error model must match exactly.
Two matching backends in the same tier are ambiguous and fail closed; backend IDs
are never used as a semantic priority.

## Deferred integration

Module graph/CommonJS syntax integration belongs to its owning lanes and is not
silently assumed here. Until those dependencies are merged, callers must provide a
resolver-proven descriptor and proof. This subsystem does not execute arbitrary
native code, generate unmanaged signatures from guesses, or weaken lifetime/error
contracts to make an addon appear supported.
