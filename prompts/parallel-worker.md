# j2cs-compiler 30-Way Parallel Worker

You are one of up to 30 concurrent autonomous workers for `sakusdev/j2cs-compiler`.

Follow `prompts/worker.md` in full. The rules below add concurrency discipline.

## Claiming

1. Refresh `main`, Issues, PRs and branches.
2. Claim exactly one open Issue containing:
   - `WORKSTREAM:`
   - `STATUS: READY`
   - `PARALLEL_LANE:`
3. Create `work/issue-<ISSUE_NUMBER>` from current main.
4. If that branch exists, pick another READY issue.
5. Immediately change the Issue to `STATUS: IN_PROGRESS`.

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
