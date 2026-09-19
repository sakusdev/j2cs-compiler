# Async / microtask lane contract

This lane implements the part of async semantics that can be proven independently of the unmerged Promise-core lane.

## Enabled surface

- `async function` declarations are AST-normalized.
- A directly called async function is admitted only when its returned Promise is discarded.
- `await` is admitted only for statically proven primitive/non-thenable values and only as a standalone statement or direct variable initializer in a linear async body.
- `queueMicrotask(callback)` is admitted only for a pristine builtin binding and a statically resolved zero-argument ordinary function declaration.
- Await continuations and `queueMicrotask` callbacks share one explicit FIFO `JsMicrotaskQueue`.
- The generated top-level entry point drains that queue after the current synchronous stack completes. Recursive enqueue appends to the same queue.

The compiler does not emit C# `await`, `Task.Run`, `Task.Yield`, or otherwise delegate ordering to CLR task scheduling.

## Canonical proof connection

The reviewed adapter registry `compiler/rules/async-adapters.json` pins the complete upstream SHA-256 for:

- `async.await.non-promise-yield`
- `async.queue-microtask`

Their source requirements are proven from the normal compiler fact model. Missing or broader async facts remain unknown and fail closed.

## Deferred until prerequisite lanes merge

The following are deliberately rejected rather than approximated:

- observing, assigning, returning, chaining, or awaiting an async function's returned Promise;
- intrinsic Promise fulfillment/rejection and arbitrary thenable adoption;
- async callback Promise rejection from `queueMicrotask`;
- await nested in expressions;
- suspension across branches/loops and other continuation-CFG control flow;
- async generators and top-level await.

Those features require Promise/error/control-flow contracts owned by sibling lanes. No unmerged sibling branch is imported here.
