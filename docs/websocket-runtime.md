# WebSocket runtime contract

Issue #48 owns an isolated browser/host WebSocket contract under
`runtime/J2cs.Runtime/WebCompat` plus application/host retry and heartbeat policy
under `runtime/J2cs.Runtime/ElectronCompat/Network`.

The implementation deliberately does **not** map browser WebSocket directly to a
raw TCP socket or `.NET ClientWebSocket`. The canonical j2cs rule
`web.websocket.network-runtime-boundary` says DNS, proxy, TLS, HTTP upgrade,
framing, browser policy, and scheduling remain host/runtime responsibilities.
`WebSocketHostProfile.RequireBrowserSemantics()` therefore rejects an incomplete
host profile instead of silently approximating browser behavior.

## Canonical proof connection

`compiler/rules/websocket-proof.ts` pins the complete normalized SHA-256 of 16
rules from the j2cs submodule commit
`35ca8d859f9352e90ee2497f4ac8f6edb9c19ed1`. It covers constructor URL and
protocol validation, HTTP(S) scheme normalization, readyState, text send,
CONNECTING send failure, bufferedAmount (including after close), close validation
and queued-message ordering, open/message/error/close dispatch, and the network
runtime boundary.

The proof adds conservative backend obligations:

- the WebSocket builtin must be proven pristine;
- networking must be proven to use the browser-host boundary, never a raw-socket
  substitution;
- event rules additionally require event-loop/task dispatch evidence.

Missing facts remain `unknown`; raw-socket or synchronous-event substitutions are
`disproven`. A changed upstream rule hash fails the contract rather than reusing
stale assumptions.

The generic source compiler is intentionally **not** wired to `new WebSocket(...)`
yet. The active function/reference workstreams edit shared parser, analysis,
lowering, and rule-registry files. This lane stays independently mergeable and
source-level WebSocket syntax remains fail-closed until those dependencies merge.

## Runtime behavior

`BrowserWebSocketState` models the observable state/queue boundary:

- `CONNECTING=0`, `OPEN=1`, `CLOSING=2`, `CLOSED=3`;
- HTTP/HTTPS constructor URLs normalize to ws/wss and URL fragments are rejected;
- subprotocol order is preserved and invalid/duplicate protocol tokens are rejected;
- send during CONNECTING raises an `InvalidStateError` contract exception;
- text `bufferedAmount` uses UTF-8 bytes, not JavaScript UTF-16 length;
- queued application messages survive a subsequent `close()` request;
- sends after closing/closed are not transmitted but still increase
  `bufferedAmount`;
- script close codes are limited to 1000 or 3000..4999 and close reasons to 123
  UTF-8 bytes;
- error precedes abnormal close in the trace;
- network-change observation never auto-reconnects an existing browser WebSocket.

The trace is monotonic and records state plus buffered amount at each observable
boundary so ordering can be tested deterministically.

## Reconnect, heartbeat, proxy and TLS boundaries

Browser WebSocket has no automatic reconnect feature and exposes no protocol-level
Ping API. `WebSocketReconnectPolicy` and `WebSocketHeartbeatPolicy` are therefore
separate application/host policies. A heartbeat is explicitly modeled as
application text; transport Ping/Pong stays inside the host.

Proxy routing, TLS validation, DNS, upgrades, and network-change integration are
host obligations represented by `WebSocketHostProfile`. This lane does not
fabricate browser security/error details from platform-specific socket errors.

## Validation

`tests/compiler/websocket-proof.test.ts` verifies all pinned upstream contracts,
fail-closed facts, changed-rule rejection, and the intentionally unsupported
source-level syntax.

`tests/differential/websocket-runtime.test.ts` generates and builds a C# harness
against `J2cs.Runtime`, runs a deterministic JavaScript oracle under Node, and
compares stdout/stderr/exit behavior for lifecycle, UTF-8 buffering, close
ordering/validation, error-close ordering, network changes, retry backoff, and
application heartbeat policy.

The existing compiler workflow builds the runtime and runs `npm test` on both
Linux and Windows. The separate compatibility job runs the unmodified upstream
validator and Coverage Gap Analyzer and verifies the j2cs submodule remains clean.
