# Machine requirements, version 1

Upstream `source.requirements` is an extensible object of mostly hand-authored
keys. Compatibility is preserved: no existing rule JSON or schema was rewritten.
The compiler maps a reviewed vocabulary to a common fact model. Unknown keys,
unknown facts, unsupported predicate versions, and prose are **unknown**, not true.
All rule tiers require `proven`, including helpers and runtime candidates.

## Existing vocabulary

| Requirement family | Fact evidence |
|---|---|
| `left_type`, `right_type`, `operand_type`, `static_type` | Singleton primitive type from flow analysis |
| no ToPrimitive / ToNumeric required | Primitive domain and finite operand type sets |
| non-null primitive strings | Both complete type sets contain only String |
| intrinsic global binding / not shadowed | Lexical binder ID, origin and intrinsic identity |
| builtin/member not overridden | Closed-profile effect restrictions and pristine member evidence |
| callback identity known | Resolved identity fact; unknown unless a producer provides it |
| known target / arity / simple parameters | Resolved declaration and actual call signature |
| function identity/properties/this/arguments unused | Complete syntax and reference-use checks |
| `host`, `platform`, `node_profile`, `electron_profile` | Explicit compilation profile facts |

This is a vocabulary adapter, not a per-rule dictionary of arbitrary booleans.
New rules should reuse shared facts and add a producer only for a genuine new
analysis concept. The current compiler produces primitive Node facts; future
callback/Electron facts are not presumed merely because an evaluator key exists.

## Optional structured form

The existing rule schema already permits `$j2cs` within `source.requirements`.
The following is a backwards-compatible proposal with an implemented consumer:

```json
{
  "source": {
    "pattern": "$left + $right",
    "requirements": {
      "left_type": "Number",
      "$j2cs": {
        "version": 1,
        "predicate": {
          "all": [
            { "fact": "right.type", "equals": "Number" },
            { "fact": "profile.host", "equals": "Node.js" }
          ]
        }
      }
    }
  }
}
```

Legacy requirements and the structured predicate are conjunctive. `$j2cs` never
replaces or bypasses unrecognized legacy obligations. Existing upstream tools
still validate the object, though they do not execute predicates. The additional
compiler-side schema is `compiler/rules/requirements.schema.json`.

Supported forms (objects accept only their documented keys):

| Predicate | Meaning |
|---|---|
| `{ "fact": "left.type", "equals": "Number" }` | Exact fact value |
| `{ "fact": "function.observes", "contains": "this" }` | Membership in a complete string-set fact |
| `{ "fact": "left.types", "subsetOf": ["Number", "Null"] }` | Nonempty complete type set is contained in the allowed set |
| `{ "fact": "callback.identity", "exists": true }` | Producer supplied identity evidence |
| `{ "equalFacts": ["call.argumentCount", "function.parameterCount"] }` | Both facts exist and are equal |
| `{ "all": [ ... ] }`, `{ "any": [ ... ] }`, `{ "not": ... }` | Three-valued Boolean composition |

`not unknown` remains unknown. `all` is disproven if any child is disproven;
otherwise it is unknown if any child is unknown. `any` is proven if any child is
proven; otherwise it is unknown if any child is unknown. Empty `all` is true and
empty `any` is false. Negation must not be used as a shortcut for missing analysis.
For complete finite type-set facts, `subsetOf` can prove that a native singleton
specialization is unavailable and enable a primitive helper without assuming
which member of the union occurs at runtime.

The selector's specificity comparison uses normalized explicit conjunctions,
not predicate counts. It does not prove all implications between `any`/`not`
formulas; incomparable candidates safely remain ambiguous.

## Adding executable support

1. Identify the canonical upstream owner and rule ID. Do not duplicate it.
2. Review every source requirement, semantic note and caveat against the supported
   value/profile domain. Define additional backend guards for partial helpers.
3. Add a structural AST selector and implemented lowering opcode, pinning the
   reviewed full rule hash. Neither `pattern` nor `template` is executable text.
4. Ensure every predicate has an analysis producer or stays unknown.
5. Add Node/C# differential cases and negative cases where evidence is absent,
   shadowed, mutated, ambiguous, or outside the implemented helper domain.
