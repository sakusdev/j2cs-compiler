# j2cs-compiler 30-Way Parallel Worker

You are one of up to 30 concurrent autonomous workers for `sakusdev/j2cs-compiler`.

Follow `prompts/worker.md` in full. The rules below add concurrency discipline.

## Claiming

1. Refresh `main`, Issues, PRs and branches.
2. Claim exactly one open Issue containing:
   - `WORKSTREAM:`
   - `STATUS: READY` **or** `STATUS: RECLAIM`
   - `PARALLEL_LANE:`
3. For `STATUS: READY`, create `work/issue-<ISSUE_NUMBER>` from current main. If that branch already exists, another worker owns it; pick another READY Issue.
4. For `STATUS: RECLAIM`, the existing `work/issue-<ISSUE_NUMBER>` branch is the handoff artifact. Reuse it; do **not** create a replacement branch. If an open PR from that branch exists, continue that same PR rather than opening a duplicate.
5. Immediately change the claimed Issue to `STATUS: IN_PROGRESS`.
6. On RECLAIM, inspect the entire existing branch/PR, latest CI, unresolved review threads, and Issue notes before editing. Preserve valid prior work and fix/complete what remains.

## Parallel ownership

- Treat the Issue's **Primary ownership** paths as your preferred write surface.
- Avoid unrelated cleanup and broad formatting.
- Prefer new modules/files and narrow integration points over large shared-file rewrites.
- Do not overwrite or revert sibling-worker work.
- Before every shared-file edit, inspect current main and open PRs touching that file.
- If another open PR owns the same semantic surface, keep your implementation isolated behind a new module/contract and defer shared wiring when possible.
- If a dependency is not merged yet, implement the independently testable compiler/runtime contract and keep unavailable syntax/integration fail-closed. Do not fake support.
- Never duplicate semantics already owned by another READY/IN_PROGRESS workstream.

## Integration safety

Before opening the PR:
- refresh main;
- compare changed files with every open `work/issue-*` PR;
- rebase/reconcile when practical;
- document any intentionally deferred cross-workstream wiring;
- ensure your PR remains semantically fail-closed without sibling PRs.

## Validation

All validation requirements in `prompts/worker.md` remain mandatory. Add focused differential tests for the exact capability implemented by your lane.

## Completion

One Issue → one branch → one validated PR. Do not merge your own PR.


## Reclaim / chat handoff

`STATUS: RECLAIM` explicitly means the previous worker/chat has yielded ownership and a new worker may take over.

- Existing `work/issue-N` is expected and must be reused.
- Existing open PR is expected when present and must be updated in place.
- Do not reset/recreate the branch or discard prior commits.
- Determine the actual remaining work from CI, review threads, tests, and Issue/PR state; do not assume the prior worker's prose is correct.
- If the branch is already complete and green, finish required validation/status bookkeeping instead of rewriting it.
- Before each major push, re-read the Issue. If it has been changed to `RECLAIM` by the coordinator after you claimed it, stop pushing: ownership has been yielded for another chat.
