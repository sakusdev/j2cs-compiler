# BUILTINS_COLLECTIONS runtime contract

This lane implements the independently testable Map/Set/WeakMap/WeakSet runtime
contract for the pinned j2cs rule database without claiming source-language wiring
that is not yet safe to merge in parallel.

## Canonical-rule connection

`compiler/rules/collections-adapters.json` pins the complete SHA-256 of 31 reviewed
`map_set` rules at j2cs commit `35ca8d859f9352e90ee2497f4ac8f6edb9c19ed1`.
`compiler/rules/collections.ts` proves every upstream `source.requirements`
obligation from the common evidence-bearing `FactModel`. Unknown requirement
keys, missing facts, changed rule hashes, changed strategies, Proxy receivers and
unproven member integrity fail closed. Rule `source.pattern` and
`target.template` are descriptive data and are never executed as translation
text.

The reviewed executable contract covers empty Map/Set/WeakMap/WeakSet
construction and the core Map/Set mutation, lookup, size and iterator helpers.
Weak collections use the canonical `JsRuntime.*` boundary from j2cs.

## Runtime semantics

`JsMap` and `JsSet` use an explicit SameValueZero comparer:

- all NaN Number values compare as the same key/value;
- +0 and -0 compare the same and are stored canonically as +0;
- String comparison is ordinal UTF-16 value comparison;
- Object keys use canonical JavaScript reference identity.

Ordered entries are retained as tombstoned sequence slots rather than compacted.
Updating an existing Map key does not move it. Deleting then re-adding appends a
new slot. Suspended iterators skip deleted entries, observe later additions until
completion, and see Map value updates made before a value is visited. `clear()`
tombstones existing entries so an already-created, not-yet-completed iterator can
still observe subsequently appended entries. Once an iterator has returned
`done: true`, later additions are not observed by that completed iterator.

Map entry and Set entry iterators produce fresh two-element `JsArray` values.
Iterator results are ordinary `JsObject` values with distinct `value` and
`done` data properties.

WeakMap and WeakSet use `ConditionalWeakTable` so Object keys are not strongly
retained by the collection. Lookup/has/delete with a non-weak primitive follow
JavaScript's non-throwing absent behavior; insertion of a primitive raises
`JsWeakCollectionKeyException`, whose JavaScript error-name contract is
`TypeError`.

## Deliberately deferred / fail-closed

The main parser/analysis/lowering pipeline still rejects collection construction.
That is intentional while sibling compiler-core work is unmerged: this lane does
not edit the shared parser, semantic IR, lowering, emitter, standard adapter
registry or fact producers merely to claim syntax support.

Iterable constructors and Map/Set `forEach` are also not enabled. Their canonical
rules require observable iterator-protocol behavior and/or canonical JavaScript
function-call/this-binding behavior. The function implementation is currently an
open sibling PR, so this lane does not create a hidden dependency on it.

The current tagged-value runtime has no Symbol kind. Weak collections therefore
admit Object keys only today; non-registered Symbol weak keys remain deferred to
the Symbol lane. This is a representation boundary, not an approximation.

## Validation

`tests/compiler/collections.test.ts` verifies every adapted rule fingerprint,
strategy and proof obligation and checks missing/conflicting evidence remains
unknown or disproven. It also asserts collection source syntax remains explicitly
unsupported until integration is available.

`tests/differential/collections-runtime.test.ts` executes representative
collection behavior in Node and against the C# runtime and compares complete
stdout/stderr/exit/signal observations. It covers SameValueZero, reference
identity, insertion order, update/delete/re-add behavior, live iterators,
clear-then-add behavior, completed iterators, entry pairs and WeakMap/WeakSet
primitive-key boundaries.
