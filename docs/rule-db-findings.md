# Rule DB integration findings and follow-up candidates

No existing semantic ownership or rule JSON was changed. The compiler references
the upstream database through a pinned submodule and reviewed adapters.

| Finding | MVP treatment | Follow-up owner/scope |
|---|---|---|
| No rule currently owns `console.log` itself | A narrow, explicit primitive Node host contract; format strings are diagnosed | Node host/console workstream: `util.format`, object inspection, output streams and return value |
| Requirements contain heterogeneous keys and prose | Reviewed vocabulary → common facts; unknown obligations stay unknown | Shared rule schema/analysis vocabulary; migrate incrementally with owners |
| Patterns include placeholders, abstract operations and prose | Structural selector sidecars referencing canonical IDs | Optional upstream machine selector format after compiler experience |
| Target snippets are illustrative, not complete executable programs | Typed C# IR builders and canonical helpers; never textual substitution | Separate executable conformance corpus from human examples |
| `Console.WriteLine` examples do not encode all Node formatting behavior | Explicit formatter handles lowercase booleans, null/undefined, invariant numbers, `-0` and UTF-8/LF | Node console tests; do not treat illustrative templates as an output contract |
| Many runtime rules describe helpers that have no executable implementation | Do not advertise those rules as compiled support | Runtime/object model and host-service implementations with differential tests |
| Coverage Gap Analyzer measures rule counts and planning gaps | Original analyzer runs unchanged; output unchanged at the pinned revision | Report executable compiler support separately; do not inflate rule coverage |

The versioned `$j2cs` requirement format is implemented as a compatible extension
inside the existing unconstrained `source.requirements` object. It adds no required
fields to legacy JSON and needs no upstream schema migration for the MVP. Before
standardizing it upstream, agree on fact semantics, schema validation and proof
versioning with the rule owners.

These are documented issue candidates, not newly created issues or claimed rule
workstreams. No compiler workaround attempts to hide an incorrect upstream rule.
