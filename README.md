# j2cs-compiler

An AST-first JavaScript / TypeScript → C# compiler MVP consuming the
[j2cs semantics-first rule database](https://github.com/sakusdev/j2cs).
It generates a self-contained .NET 8 project and checks its behavior against Node.js.
It does **not** interpret rule patterns as regexes or substitute C# templates into source text.

## Quick start

Requires Node.js **22+**, npm, Git and the **.NET 8 SDK**. Python 3.12 and
`jsonschema` are needed only for upstream rule validation.

```bash
git clone --recurse-submodules https://github.com/sakusdev/j2cs-compiler.git
cd j2cs-compiler
npm ci
npm run build
npm run compile -- examples/hello.js --out artifacts/hello
dotnet build artifacts/hello/Generated.csproj
dotnet artifacts/hello/bin/Debug/net8.0/J2cs.Generated.dll
```

Output: `30`, matching `node examples/hello.js`.

```js
const x = 10;
const y = x + 20;
console.log(y);
```

For an existing clone, first run `git submodule update --init`.
The output directory must be new or empty. Generated files include `Program.cs`,
`Generated.csproj`, a separate `runtime/J2cs.Runtime` project, `NuGet.Config`, and
`compilation.json` containing the selected rule IDs, tiers and requirement proofs.
The generated project has no NuGet package dependencies and does not need Node to run.

TypeScript example:

```bash
npm run compile -- examples/functions.ts --out artifacts/functions
```

`--rule-db /path/to/j2cs` selects another checkout. Changed reviewed rules are
rejected until their compiler adapters are reviewed. `--diagnostics-json` emits
structured diagnostics including source location and failed rule proofs.

## Supported MVP surface

| Surface | Support |
|---|---|
| Literals | Number (binary64), String (UTF-16), Boolean, null |
| Intrinsic values | Unshadowed `undefined`, `NaN`, `Infinity` |
| Variables | Block-scoped `const` / `let`, binding resolution, local `=`; omitted `let` initializer becomes undefined |
| Arithmetic | Number `+ - * / %`, unary `-`; primitive String concatenation and coercing primitive `+` |
| Comparisons | Number `< <= > >=`; primitive `===` / `!==` |
| Statements | Expression statements, blocks, `if` / `else`, `return`, empty statements |
| Conditions | JavaScript primitive truthiness and `!` |
| Functions | Top-level ordinary declarations; known direct calls, exact arity, primitive parameters/results, hoisting, bare/fallthrough return |
| TypeScript | Erasable scalar variable/parameter/return annotations; annotations are **not** trusted as runtime facts |
| Host output | `console.log` for primitives; multiple arguments when the first is proven non-String or a literal String without `%` |

The supported profile is a **closed single-file Node module with pristine
intrinsics**. No injected globals, preload scripts, or external callable entry
points are modeled. Functions specialize from actual call-site type facts;
function values cannot escape. See [limitations](docs/limitations.md).

## Tests

```bash
npm test
npm run test:unit
npm run test:differential
python -m pip install jsonschema
npm run validate:rules
npm run coverage:gaps
```

Differential tests compile each fixture, run `dotnet build`, execute Node and the
produced assembly, and compare stdout, stderr, exit status and explicit observable
expression probes. They cover signed zero, NaN, infinities, string encodings,
truthiness, scope/shadowing, flow joins, evaluation order, function specialization,
and binary64 number formatting. Missing .NET is a test failure, never a silent skip.
Set `DOTNET` to an SDK executable path if `dotnet` is not on PATH.

CI runs compiler/differential tests on Linux and Windows, plus the original rule
validator and Coverage Gap Analyzer against the pinned database. The original
`j2cs` workflows and rule JSON are unchanged.

## Layout and design

```text
compiler/parser/          TypeScript parser → normalized source AST
compiler/analysis/        lexical binding, flow types, semantic facts
compiler/rules/           schema loader, indexes, AST selectors, proof evaluator
compiler/ir/              semantic IR and typed C# emission IR
compiler/lowering/        guarded rule dispatch and compatibility calls
compiler/diagnostics/     explicit source diagnostics
compiler/emit/            C# emitter and standalone project generation
runtime/J2cs.Runtime/     tagged primitive values and canonical helpers
rule-db/                  pinned j2cs Git submodule; upstream owns the rules
tests/compiler/           binding, diagnostics, rule/proof infrastructure tests
tests/differential/       Node vs generated C# executable comparisons
```

Read the [architecture](docs/architecture.md),
[requirements format](docs/requirements.md), and
[rule DB integration findings](docs/rule-db-findings.md).
