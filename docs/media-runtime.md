# WebRTC / media compatibility boundary

`WEBRTC_MEDIA` provides a typed host contract instead of embedding a partial WebRTC engine in the compiler runtime. A platform adapter is expected to wrap a mature native WebRTC/media implementation through `IMediaCaptureBackend`, `IMediaPermissionPolicy`, and `IRtcPeerConnectionBackend`.

## Supported runtime contract

- `enumerateDevices`-style device identity remains stable while labels/group ids stay redacted until camera or microphone permission is present.
- `getUserMedia` and display capture use explicit permission gates. A denied request fails before the capture backend is invoked.
- capture failures map to web-facing error names (`NotAllowedError`, `NotFoundError`, `OverconstrainedError`, `NotReadableError`, `NotSupportedError`, `InvalidStateError`, `AbortError`) and preserve an offending constraint when supplied.
- `MediaStream` and `MediaStreamTrack` preserve object identity across track queries. `stop()` updates `readyState`; stream activity follows live-track state.
- codec capability data is explicit, including Opus and video codec availability, without substituting arbitrary .NET codecs.
- ICE server configuration passes through `RtcConfiguration` without reinterpretation. ICE/STUN/TURN gathering and connectivity remain backend-owned.
- offer/answer, descriptions, ICE candidates, snapshots, close lifecycle, and typed stats are exposed without CLR `dynamic` or generic `object` payloads.
- a closed `RtcPeerConnection` rejects state-changing operations with `InvalidStateError` and reports closed signaling/ICE/connection state even if a backend snapshot is stale.

## Canonical j2cs proof connection

The rule-db submodule is pinned to j2cs commit `35ca8d859f9352e90ee2497f4ac8f6edb9c19ed1`. That database currently contains no canonical rules for `getUserMedia`, `getDisplayMedia`, `MediaStream`, or `RTCPeerConnection`. The compiler therefore does not synthesize media lowering from browser API spellings or adjacent DOM rules.

`compiler/web/media.ts` pins the complete normalized SHA-256 of canonical `async.promise.resolve` and proves every source requirement from explicit facts. This is a dependency contract for eventual media-Promise integration: JavaScript media promises must reuse canonical Promise resolution/job semantics rather than .NET task identity or continuation scheduling. Missing intrinsic/integrity evidence remains `unknown` and fails closed.

Until upstream j2cs gains reviewed media rules and the renderer/async lanes are integrated, source-level media API lowering remains explicitly fail-closed. This lane does not claim DOM `EventTarget` delivery, JavaScript Promise objects, or renderer-global installation.

## Backend-owned behavior

The native backend remains responsible for device opening, capture pipelines, screen/window picker UX, RTP/RTCP, SRTP/DTLS, SDP negotiation details, ICE/STUN/TURN networking, congestion control, jitter buffering, Opus/video encode-decode, hardware acceleration, and platform media-device change notifications. The compatibility layer must not silently replace these with unrelated host behavior.

The focused differential test compares a deterministic Node oracle trace with the C# host contract for permission redaction, stream/track identity, stop lifecycle, codec reporting, constraint-error translation, denied display capture, RTC stats, and close behavior. Platform-specific native transport is intentionally outside that deterministic fixture.
