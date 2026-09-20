# Electron app/window/WebContents host contract

Issue #43 implements an isolated Electron main-process compatibility boundary. It
does not make the current Node-only parser/module pipeline accept Electron source
by itself. That integration remains fail-closed until module/binding and renderer
workstreams provide the required facts.

## Canonical rule connection

`compiler/electron/contracts.ts` reviews and pins the complete normalized
SHA-256 of representative canonical rules from the pinned `sakusdev/j2cs`
submodule. The registry checks rule ID, source path, full file hash and strategy
before returning a proof result.

The reviewed surface covers:

- `electron.app.whenready`, `electron.app.isready`, `electron.app.quit`
- `electron.browserwindow.constructor`, `show`, `hide`, `close`, `loadurl`
- WebContents URL navigation, finish-load observation and current URL
- `electron.webcontents.executejavascript` as an explicit unsupported boundary

Canonical Electron-specific requirement names are adapted only inside this lane.
They are not added to the global legacy requirement vocabulary, because doing so
would accidentally authorize sibling Electron APIs before their analysis exists.
Missing binding/profile/capability evidence stays unknown or disproven.

URL navigation adds an implementation guard requiring a proven renderer backend.
A native-window backend alone is sufficient for outer-window state operations but
never for Chromium/WebContents behavior.

## Runtime boundary

`J2cs.Runtime.ElectronCompat` exposes typed host interfaces rather than replacing
Electron with arbitrary .NET APIs:

- `IElectronApplicationHost` supplies the single application readiness state and
  process termination requests.
- `IBrowserWindowHostFactory` / `IBrowserWindowHost` own native window creation,
  geometry, visibility, focus and destruction.
- `IWebContentsHost` owns renderer navigation and unload capability.

`BrowserWindow` preserves identity and separates hide from destruction. Normal
close emits a cancelable close boundary and asks the renderer whether unload is
allowed before invoking the host close. `Destroy` bypasses those cancellation
points. `App.Quit` is graceful and cancelable; `App.Exit` is deliberately
immediate.

`WebContents` emits deterministic start / finish-or-fail / stop navigation
ordering, commits the URL only on success, and rejects renderer operations when no
renderer backend exists. Arbitrary `executeJavaScript` always rejects; source
strings are never executed, rewritten, or passed to a hidden JavaScript engine.

## Deferred integration

The current compiler has no reviewed Electron module graph/import binding path, so
this branch does not wire these contracts into the ordinary Node compilation
entrypoint and does not alter the shared adapter registry. A future integration
may select this lane only after proving the facts defined by
`electronMainHostFacts` plus the exact module/constructor/receiver identity.

This isolation is intentional for parallel development: the runtime and proof
contracts are independently testable and remain semantically closed without
unmerged sibling branches.
