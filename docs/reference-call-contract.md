# Reference-call and ordinary `this` contract

Issue #19 owns the call/reference boundary without duplicating the callable implementation being developed in the concurrent FUNCTIONS_CLOSURES workstream.

## Implemented independently

- AST-first classification of a call callee as a property Reference or standalone value.
- A property Reference preserves the base object as the ordinary `thisArgument`; a value call supplies `undefined`.
- The callee/reference is evaluated once before arguments, and argument order remains left-to-right.
- `JsCallReference` stores the resolved value separately from its property base, so extracting a method cannot accidentally create a receiver-capturing C# delegate.
- Strict ordinary `this` preserves `undefined`, `null`, primitives and objects exactly.
- Sloppy `undefined`/`null` substitution requires an explicit proven host global object; object receivers remain unchanged.
- Sloppy primitive boxing fails closed until the object-model lanes provide reviewed ToObject/prototype semantics.

## Canonical j2cs proof connection

`compiler/rules/reference-call-proof.ts` consumes the rules from the pinned `rule-db` submodule and recognizes only the reviewed requirement vocabulary for:

- `function.method-call.this-binding`
- `function.method-extraction-loses-this`
- `function.this.strict`
- `function.this.sloppy`
- `function.evaluation-order.call`

Missing semantic facts produce `unknown`; disproven facts produce `disproven`; unexpected upstream requirement or target-shape changes raise `E_RULE_CONTRACT`. Source patterns and target templates are never interpreted as rewrite instructions.

No entries are added to the shared global adapter registry in this lane. The repository submodule already pins the exact canonical j2cs commit; the proof bridge validates the loaded rule object from that pin.

## Deferred shared wiring

The current `main` branch does not contain the open FUNCTIONS_CLOSURES PR's `JsFunction` callable runtime. This lane therefore does not add a second callable representation and does not edit the parser/semantic IR/lowering/emitter files owned by that PR.

After the callable lane is merged, integration can consume `JsCallReference.Callee` and `ThisArgument` at the narrow invocation point. Until then, user-function method calls and `this` syntax remain rejected by the existing compiler pipeline rather than claiming unsupported semantics.
