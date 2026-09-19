# MVP limitations

The compiler handles a closed, single-file Node module with primitive plus compiler-owned Object/Array values. It is not a
complete JavaScript engine, TypeScript type checker, Node implementation, or
Electron application converter. The rule DB's 2,681 entries are knowledge-base coverage; only explicitly reviewed adapters have executable lowering. These are different measures.

## Explicitly unsupported

- `var`, loops, `switch`, destructuring, spread, template literals, optional chains,
  logical/bitwise/compound operators, `++`/`--`, unary `+`, exponentiation and loose
  equality. Number arithmetic and relational comparisons are supported; general
  String-to-Number coercion and String ordering are not.
- Objects, arrays, property/index access except direct `console.log`, classes,
  prototypes, getters, setters, Proxies, Symbols, BigInt and object identity tests.
- Block-level function declarations (Annex B semantics), named function expressions, arrows, callable unions with more than one possible function template, function-object property observation, captured `for (let ...)` per-iteration bindings, rebinding function declarations, default/rest/destructured parameters, `this`, `arguments`, constructors and `new.target`. Ordinary nested declarations, anonymous function expressions, lexical capture, function values/identity, recursion/mutual recursion, and missing/extra arguments are supported when the callable template remains statically proven.
- Imports/exports, CommonJS APIs, multi-file linking, dynamic scope, `eval`, async,
  generators, Promises, exceptions and their completion/stack semantics.
- TypeScript enums/namespaces/decorators, interfaces/type aliases, unions/generics,
  assertions and other syntax outside the documented scalar annotation subset.
- Node APIs other than the admitted console subset; Electron/DOM services.
- `console.log` format substitution and object inspection. With multiple arguments,
  the first argument must be a non-String value or a **literal String without `%`**.
  Computed/variable first strings are conservatively rejected even when a human
  can see they contain no formatting tokens. Single-argument strings are supported.

Unsupported admitted syntax and unproven lowerings emit source diagnostics;
the compiler never inserts a dummy runtime or silently uses CLR `dynamic`/`object`.
TDZ errors and illegal binding writes are compilation diagnostics rather than
runtime ReferenceError/TypeError emulation. Rejected programs do not claim
behavioral equivalence to executable Node programs.

## Analysis and profile bounds

The host starts with pristine intrinsics and no injected preload scripts/globals.
There are no external callers of specialized functions. Internal function-valued callbacks are supported when analysis proves one callable template; external/host callbacks and Electron profile requirements remain outside the implemented profile.
No whole-program facts are imported from TypeScript declarations or assertions.

Uncalled functions are checked for syntax and binding validity but are not
lowered. After an unconditional return, syntax/binding checks still occur and
unreachable code is omitted. Branch analysis is conservative and does not use
constant conditions or predicate narrowing to expand acceptance.

Binary64 operations preserve doubles, NaN, infinities and signed zeros. Number
printing uses .NET 8 shortest round-trip digits and ECMAScript notation thresholds,
with deterministic boundary/random differential coverage. This is not a proof
of conformance for every possible binary64 value; extend the corpus before
changing formatter/runtime versions. Locale-dependent formatting is not allowed.

Differential tests compare successful executions, callable/closure behavior, and explicit admitted-value observations. There is no supported thrown-exception surface yet. The harness
records stderr/exit/signal too, but does not claim cross-runtime stack-trace
normalization, timing, resource-limit, or external-I/O equivalence.
