# U23 — Real-time collaboration (collaborative STATE plane)

This module lets multiple people **jam on the same patch together**: they edit
the same node graph live, and see each other's cursors and selections.

## Two planes, strictly separate

Collaboration in OpenJammer is split into **two independent planes** with very
different reliability and timing requirements. This unit implements only the
first; the second is deliberately a documented stub.

| | **Collaborative STATE plane** (this unit) | **Realtime AUDIO plane** (deferred) |
|---|---|---|
| Carries | Node graph + presence | Live audio streams |
| Consistency | Eventually-consistent, lossless | Loss-tolerant, real-time |
| Mechanism | Loro CRDT + EphemeralStore | (future) Opus over UDP/WebRTC media |
| Transport | BroadcastChannel / manual-WebRTC DataChannel | (future) own media transport |
| Status | **Implemented** | **Deferred — founder-network-gated** |

The audio plane is intentionally NOT implemented here (no UDP, no Opus). It has
the opposite reliability profile from the state plane, so mixing the two over
one transport would be an architectural mistake. See [`audioPlane.ts`](./audioPlane.ts)
for the interface the future audio plane will satisfy. The realtime audio
ENGINE (`src/audio/**`) is also untouched by this unit.

## Architecture

```
 graphStore (Zustand, mutation VERBS)
      │  version++ on every verb
      ▼
 GraphStoreBridge ───────────────► CrdtGraphProjection (LoroDoc)
      ▲   diff store→CRDT (origin)        │  local update bytes
      │   reconcile CRDT→store            ▼
      │   (applyingRemote guard)     subscribeLocalUpdates
      │                                   │
 CollabSession ◄──── PresenceManager (EphemeralStore: cursors/selection/peers)
      │                                   │
      ▼                                   ▼
   Transport  (BroadcastChannel  |  ManualWebRTCTransport  |  future relay/WS)
```

- **`CrdtGraphProjection`** maps the flat node/connection model into a `LoroDoc`.
  Each node/connection is its own nested `LoroMap`, so concurrent edits to
  *different fields of the same node* merge field-by-field instead of clobbering.
  Local mutations commit with `origin: "oj-local"` so they apply synchronously
  and the bridge can ignore the echo.
- **`GraphStoreBridge`** is the read-through view: it observes the store's
  monotonic `version` counter and diffs the result into the CRDT (so the verbs
  themselves are untouched and single-user behavior is unchanged), and applies
  remote ops back into the store under an `applyingRemote` guard so they never
  echo back out.
- **`PresenceManager`** keeps presence (peer id, name, color, cursor, selection,
  view level) in Loro's **EphemeralStore** — it auto-evicts stale peers and is
  **never persisted into the document**, so the saved patch stays clean.
- **`CollabSession`** wires the projection + presence + bridge + transport,
  multiplexing doc updates, doc snapshots, and presence over one tagged-frame
  channel.
- **Transports** all implement one `Transport` interface:
  - `BroadcastChannelTransport` — zero-infra default; same-origin tabs/windows.
  - `ManualWebRTCTransport` — true LAN/peer link via copy-paste SDP signaling
    (no signaling server). A relay/WebSocket transport can slot in later.

## Single-user safety

When no session is started, the bridge is simply **not installed** and presence
is never published — the app behaves exactly as before. The existing graphStore
tests remain green.

## Tests

`src/collab/__tests__/convergence.test.ts` proves:
- two docs applying each other's ops **converge** (incl. concurrent same-node
  field edits and delete-vs-edit),
- a remote op applies into graphStore **without re-emitting** (origin tagging),
- presence **add / update / remove**, and that presence stays out of the doc.

## Founder setup (to enable the deferred realtime AUDIO plane)

The state plane needs no infrastructure. The future audio plane (and a
zero-paste WAN state link) will need founder-provided network infra:

1. **STUN/TURN servers** for NAT traversal of WebRTC media (and for a
   trickle-ICE state link). Provide TURN credentials and plug them into
   `ManualWebRTCTransport`'s `iceServers` (and the audio plane's `iceServers`).
2. **A signaling relay (WebSocket)** so peers exchange SDP without copy-paste.
   Implement a `RelayTransport implements Transport` and a tiny signaling
   endpoint; the session code becomes the room id. No session-logic changes.
3. **Audio codec + jitter strategy** decisions (e.g. Opus, target latency,
   jitter buffer depth) — see `AudioPlaneConfig` in `audioPlane.ts`.
4. **Implement the audio plane** in its OWN module satisfying the `AudioPlane`
   interface, negotiating its OWN media transport. Do **not** route audio frames
   through the CRDT/presence transport.
