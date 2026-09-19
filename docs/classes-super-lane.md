# LANGUAGE_CLASSES_SUPER lane

Issue #23 is intentionally implemented as an isolated AST-first class lane so it does not
consume unmerged work from the `this`/method-call, constructor/`new.target`, function-object,
or prototype/descriptor lanes.

## Executable surface

The compiler currently executes the following closed class surface end to end:

- named class declarations;
- `const X = class ...` class expressions;
- eager public static data-field initialization in source order;
- zero-argument direct static methods whose body is a single proven return expression;
- statically resolved `extends` between already-evaluated translated classes;
- inherited static data reads and subclass shadow-on-write;
- direct static field reads/writes and `console.log` observation.

The parser normalizes TypeScript AST nodes into `compiler/parser/classes.ts`. Later class
analysis does not consume TypeScript nodes and no source-text rewriting is used.

`JsClass` is a narrow constructor-object compatibility boundary. It models static own-data
properties and constructor-object base linkage only. It is not a JavaScript function object,
instance prototype, descriptor table, accessor runtime, private-name runtime, or construction
escape hatch.

## Canonical proof connections

Class-specific proof adapters are local to `compiler/analysis/class.ts` and pin both rule IDs
and normalized SHA-256 fingerprints from the repository's pinned `rule-db` commit. A changed
rule, missing rule, or unrecognized requirement fails closed.

Executable lowering is connected to:

- `classes.static.method_direct`;
- `classes.static.initialization_order`;
- `classes.static.field_inheritance`.

The analyzer also verifies the pinned contracts for deferred adjacent semantics when those
syntax forms are encountered:

- `classes.field.public_base_initializer_order`;
- `classes.field.public_derived_initializer_order`;
- `classes.constructor.derived_super_first`;
- `classes.super.instance_property`;
- `classes.super.static_property`.

## Deliberate fail-closed boundaries

Instance fields, instance methods, explicit constructors, construction, dynamic class bases,
accessors, private/computed names, static blocks, inherited static method calls, dynamic
constructor-object `this`, and descriptor-observable `super` remain rejected with explicit
diagnostics.

This is required by the parallel-worker contract: Issue #23 must not silently copy or depend on
unmerged Issue #19/#20 work. Once those contracts merge, the deferred class edges can be wired to
their reviewed semantics instead of replacing them with CLR behavior that only looks similar.

Class evaluation order is checked explicitly. Reads/writes before an evaluated class binding are
rejected rather than being translated into a different .NET exception. JavaScript runtime grammar
is also validated so class strict-mode syntax failures are not weakened by translation.

## Validation

`tests/compiler/classes.test.ts` covers normalization, canonical proof selection, static
inheritance, class TDZ behavior, method-replacement invalidation, and explicit dependency
diagnostics. `tests/differential/classes.test.ts` compares Node with generated C# for eager
static initialization, direct static methods, static inheritance/shadowing, and class
expressions.

The repository workflow runs the same tests on Linux and Windows, builds `J2cs.Runtime`, and
runs the unmodified upstream validator plus Coverage Gap Analyzer against the pinned rule DB.
