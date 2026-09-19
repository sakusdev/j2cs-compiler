WORKSTREAM: <NAME>
STATUS: READY

## Goal

<compiler capability to add>

## Required scope

- ...

## Semantic constraints

- Consume canonical j2cs rules.
- Preserve observable JavaScript behavior.
- Unknown rule requirements fail closed.
- Do not use dynamic/object as a semantic shortcut.

## Validation

- compiler unit tests
- Node/C# differential tests
- runtime dotnet build
- npm test
- upstream j2cs validator + coverage analyzer
- Linux/Windows CI

## Completion

Follow `prompts/worker.md`, claim `work/issue-<ISSUE_NUMBER>`, implement, validate, and open a PR with `Closes #<ISSUE_NUMBER>`.
