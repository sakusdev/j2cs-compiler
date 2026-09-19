# COMPILER_CORE architecture

## Repository boundary and provenance

Implementation lives in `sakusdev/j2cs-compiler`. That repository was empty when
this work began; `main` was initialized with a minimal README solely to provide a
PR base. All compiler code is on `feature/compiler-core-mvp`.

The authoritative data source is `sakusdev/j2cs`, pinned as the `rule-db` submodule
to **35ca8d859f9352e90ee2497f4ac8f6edb9c19ed1**, the `main` commit inspected for this
implementation. Its 2,681 rules, schema, README, all worker/reviewer prompts,
workstream ownership conventions, CI, coverage catalog, Coverage Gap Analyzer and
issue generator were inspected before implementation. There was no existing
compiler or executable runtime to extend. No upstream rules or workflows are changed.

This directly requested compiler task is not an autonomous rule-generation queue
claim. It does not create a scratch issue or take another workstream's branch.

## Pipeline and contracts

| Stage | Input → output | Invariant |
|---|---|---|
| Parse | JS/TS text → normalized AST | Mature TypeScript 5.9.3 parser, source spans, explicit whitelist; no regex translation |
| Grammar check | admitted source → validated syntax | V8 `Script` construction validates runtime grammar without executing input; TS annotations are erased for this check |
| Bind | AST → binding IDs | Predeclare whole lexical scope; shadowing includes declarations later in the block; reject escapes and unsupported captures |
| Analyze | bound AST → semantic IR | Sequential evaluation, initialization tracking, finite primitive type sets, branch joins, call-site specialization |
| Load rules | pinned JSON → validated indexes | Upstream Draft 2020-12 schema; duplicate IDs are fatal; ID/category/strategy indexes |
| Match | construct + facts → candidates | Explicit AST selectors indexed by normalized construct kind; reviewed rule-ID adapters |
| Prove/select | candidates + facts → selected lowering | Three-valued requirements; only proven candidates; conservative specificity and ambiguity fallback |
| Lower | semantic IR → C# IR | Typed value/number/string/boolean operations; no raw target templates; ordered operands |
| Emit | C# IR → source/project | Exhaustive structural emitter, deterministic binding names, literal escaping, separate runtime project |
| Verify | Node + generated assembly → observations | Real `dotnet build`; stdout/stderr/exit/signal and expression-probe comparison |

Only `compiler/parser` knows the TypeScript AST. Later passes use discriminated
internal nodes with source spans and stable node IDs. The differential harness
uses TypeScript separately to erase annotations for its Node oracle.

### Lexical binding and temporal dead zones

Each lexical scope is predeclared before resolving references. An identifier
resolves to one binding ID; C# names are generated from that ID, so nested JS
shadowing cannot accidentally select a C# variable, keyword, or intrinsic.
Flow environments mark a lexical binding initialized only after its initializer
has been analyzed. Reads/writes before initialization produce `E_TDZ`. An
uninitialized `let x;` creates a legitimate undefined value at declaration time.
The runtime undefined tag is never used as a substitute for a TDZ state.

`const` writes, function rebinding, duplicate declarations and unresolved names
are rejected. Property mutation, intrinsic escape, imports, eval and indirect
calls are not admitted; this closed-program condition justifies the pristine
intrinsic facts. A lexical `console` is not the Node intrinsic. Identifier text
alone can never select a builtin lowering.

### Flow analysis and function specialization

The value lattice is a finite subset of `{Number, String, Boolean, Null,
Undefined}`. Initializers, assignments, operators and calls produce type sets.
Sequential analysis preserves expression evaluation order. An `if` joins the
reachable successor environments, excluding branches that returned. This is
conservative: constant conditions and condition-based narrowing are not used.

Ordinary top-level functions are specialized by their resolved binding and the
tuple of actual argument type sets. This permits `add(1,2)` and `add('a','b')`
to choose different guarded rules while preserving a tagged calling convention.
Function identity/property observation and escaping are rejected; no JS-visible
function object is silently replaced with a delegate. Forward direct calls work.
Missing/extra arguments, recursion, nested functions, and captures are rejected
rather than approximated. Uncalled functions have their syntax and bindings
validated but are not emitted or specialized. Unreachable statements after a
return are likewise not emitted, after parser/binding validation.

Annotations such as `x: number` are erased, not assumed true. Even deliberately
misannotated input must follow its runtime JS values. This MVP is not a TypeScript
type checker and does not report all TypeScript type errors.

## Rule integration and selection

`source.pattern` remains descriptive data. The compiler never parses it as a
regex and never interpolates `target.template`. `compiler/rules/adapters.json`
contains 45 reviewed mappings from **existing rule IDs** to normalized AST
selectors and implemented lowering opcodes. Each adapter pins the full rule
file's SHA-256 after CRLF-to-LF normalization for cross-platform Git checkouts.
A missing/changed reviewed rule is an error, not an opportunity
to reuse stale assumptions. Review changes before updating fingerprints; do not
blindly regenerate them. Unadapted rules load and index normally but do not
claim executable support.

For a construct, matching checks selector fields (kind, operator, intrinsic).
Every source requirement and additional backend guard is evaluated. Native,
helper, runtime and unsupported candidates are considered in that tier order.
Within a tier, a candidate dominates another only when its normalized conjunct
and selector constraints are a **strict superset**. Equivalent or incomparable
maxima are ambiguous; there is no filename, ID or arbitrary priority tie-break.
Ambiguous native selection tries a proven helper, then runtime, else reports
unsupported. This is deliberately a partial-order algorithm, not a general
logical implication solver. Unknown requirements never authorize any tier.

The current executable adapters provide native and primitive helper lowering.
The selection protocol has a runtime tier, but no general JavaScript object
runtime is present: lack of an implemented/proven fallback is `E_NO_SAFE_RULE`,
not a stub that changes behavior. Extending the registry requires implementing
and testing its lowering, not merely labeling a rule `runtime`.

`compilation.json` records selected IDs, file hashes, strategies, source spans,
requirement proofs with evidence, rejected candidates and ambiguity. Core
structural contracts and the limited Node console host contract are listed
separately; they are not invented duplicate upstream rules.

## Shared semantic facts and requirements

The common fact model includes finite value type sets, singleton type proofs,
binding origin and mutability, intrinsic identity, member integrity, function
signature/observable feature sets, reference kind, analysis completion, and host
profile. Every fact has evidence. Missing facts are unknown. Future callback
identity and platform/Electron facts use the same model; the evaluator supports
them, but the MVP does not pretend to analyze unsupported callbacks or Electron.

Reviewed legacy requirement keys translate into predicates over these facts.
Unknown keys and descriptive prose stay unknown. The versioned `$j2cs` extension
is supported within `source.requirements` without changing its existing schema.
See [requirements.md](requirements.md) for operators, examples, and migration.

## C# representation and runtime boundary

All stored primitive values and call parameters/results use `JsValue`, an explicit
readonly tagged struct. A Number is a `double`, String is a non-null UTF-16
`string`, and Boolean is a `bool`. Null and Undefined are separate tags exposed
by the canonical `JsNull.Value` and `JsUndefined.Value` sentinels. There is no
`dynamic`, CLR `object` fallback, blanket `Convert.ToDouble`, or boxed-object
`.Equals` shortcut.

Proven native Number operators unbox binary64 operands, emit a double operation,
and box the result. No integer inference is introduced. Comparisons preserve
unordered NaN behavior and Number strict equality's signed-zero behavior.
String concatenation/equality uses UTF-16 values with ordinal comparison.
The IR tracks `value`, `number`, `string` and `boolean` representations explicitly.
C# evaluation order matches the admitted operations; helper calls receive
already-evaluated operands left-to-right. Mutable lexical references use
`JsReference.Assign(ref slot, value)` and return the assigned value.

Canonical runtime/helper responsibilities remain separate from the compiler:

- `JsValue.IsTruthy` implements primitive ToBoolean.
- `JsOperators.Add` implements primitive addition, including the String branch.
- `JsOperators.StrictEquals` distinguishes primitive tags and NaN.
- `JsCoercion` handles primitive ToNumber/ToString/ToInt32 conversions, including StringToNumber grammar used by coercive operators.
- `JsGlobals` and `JsNumber` implement the reviewed primitive `isFinite`/`isNaN`/`parseFloat`/`parseInt` paths.
- `JsNumber` supplies invariant shortest binary64 formatting with JS notation
  thresholds; `console.log` inspection preserves `-0` while string coercion does not.
- `JsConsole` implements the documented primitive, non-format-substitution host
  subset and writes UTF-8/LF on every platform.

The compiler project generator copies these files into a separate referenced
`J2cs.Runtime.csproj`. No dependency on the compiler or rule JSON remains at runtime.

### Extension towards Electron/native .NET

Keep this division as the language grows: add module graph/import resolution,
call/effect summaries, CFG fixed points and binding-cell lifetime analysis before
admitting dynamic features. Extend `JsValue` with explicit Object/Symbol/BigInt
payloads only alongside their semantics. Object payloads must reference a
canonical identity-bearing `JsObject`; do not collapse them into dictionaries,
record equality, or CLR null. Lexical cells must track initialization separately.
Arrays/Promises require their own canonical runtime contracts, not placeholder
classes claiming support.

Host services should be profile-specific lowering registries for Node and
Electron main/preload/renderer roles. Platform, intrinsic identity and member
integrity remain proof obligations. Electron adapters can progressively target
native .NET services while unresolved object-model/DOM/IPC semantics select an
implemented runtime service or an explicit diagnostic. This MVP supplies those
analysis/rule/IR boundaries, not an Electron compatibility implementation.
