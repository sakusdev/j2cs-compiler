# Storage, profile and Session compatibility contract

This lane is intentionally an isolated host/runtime contract. It does not wire new
source syntax into the parser or lowering while the renderer/module/Electron host
lanes are still open. Unsupported integration therefore remains fail-closed.

## Canonical j2cs proof boundary

`compiler/rules/storage-profile-proof.ts` pins the complete normalized SHA-256,
strategy, target kind/helper and complete reviewed requirement object for 15 rules
from the pinned j2cs commit `35ca8d859f9352e90ee2497f4ac8f6edb9c19ed1`.

The reviewed rules cover:

- local/session Web Storage acquisition and get/set/remove/clear;
- Electron Session partition identity, persistence, storage path and flush;
- Electron cookie-store isolation and flush;
- the IndexedDB open boundary;
- CacheStorage storage-key isolation and secure-context open.

The proof bridge accepts evidence-bearing host facts. Missing evidence is
`unknown`; incompatible evidence is `disproven`. It never interprets
`source.pattern` or `target.template` as executable rewrite text.

The pinned rule database does not contain a dedicated Electron secure-at-rest
credential-store rule. This lane therefore does not invent one. Secure credential
persistence is exposed only as an explicit host contract and source-level access
stays unsupported until canonical ownership exists.

## Web storage and browser persistence

`WebStorageRegistry` keys local storage by storage key + origin and session
storage by storage key + origin + page-session identity. Repeated acquisition of
the same area preserves identity. A persistent profile snapshot contains only
local storage; session storage is deliberately discarded across restart.

`StorageArea` preserves string values, insertion/key order, missing-as-null,
no-op same-value writes, no-op missing removal and no-op empty clear. Quota policy
is explicit. Rejection occurs before mutation and reports `QuotaExceededError`.
The included code-unit quota is a deterministic embedding/test policy, not a
browser-vendor quota claim.

Mutations are queued as typed records for a host to dispatch. The runtime does
not fake browser storage-event task scheduling with synchronous CLR callbacks.

## IndexedDB and CacheStorage

`IndexedDbBoundary.Open` validates the version boundary and returns a descriptor
that explicitly requires the host's event-driven request lifecycle and structured
clone semantics. It is not replaced by a dictionary, synchronous API or Promise.

`CacheStorageBoundary` carries the complete storage partition and rejects an
unproven/insecure context. Cache persistence remains host-owned; cross-storage-key
visibility is not provided.

## Electron Session and cookies

`ElectronSessionRegistry.FromPartition` preserves identity per exact partition.
The default partition and `persist:` partitions are persistent; plain named
partitions are in-memory. Creation options are fixed by the first creation.
Persistent storage paths and flush operations are delegated to
`IElectronSessionHost`.

Each Session owns a cookie store. Same-partition Session reuse shares it and
different partitions do not. Cookie persistence is flushed through the host
boundary rather than mapped to an unrelated .NET cookie container.

## Secure credentials

`SecureCredentialStore` accepts only an `ISecureCredentialBackend`. When that
backend is unavailable, writes/reads that require protection fail with
`NotSupportedError`; there is no clear-text fallback. Persistent snapshots carry
only protected byte envelopes. The concrete OS/keychain implementation belongs to
the platform adapter lane.

## Profile migration and restart

Browser storage and Electron Session snapshots use versioned runtime-owned schemas.
Version 1 migrates to version 2 by supplying the deterministic `default` profile
namespace/identity. Unknown future versions fail closed with `VersionError`.

Electron restart snapshots are allowed only for persistent Sessions, flush host
storage/cookies before capture, and retain cookies plus already-protected
credential envelopes. In-memory Sessions cannot be promoted to persistent state
during restore.

## Deferred integration

Source-level `localStorage`, `sessionStorage`, IndexedDB, CacheStorage, Electron
Session and secure credential APIs remain unsupported on this branch. Their
parser/module/renderer wiring must consume these contracts only after the owning
sibling lanes are merged and can prove the required host facts.
