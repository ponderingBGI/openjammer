# OpenJammer Agent Tools — quickstart for Pi

This is the carefully-crafted, Pi-style quickstart for the tool surface the
OpenJammer Ctrl/Cmd+K AI agent exposes (the deliverable of MILESTONE M7, D5 of
the Ctrl+K / AI plan). It documents **every** verb the agent may call, the
**reuse-first** workflow that produces good graphs, and the **founder-gated**
boundary that separates what ships green today from what needs a live
provider / a real Pi / a real audio device.

> **The agent is an UNTRUSTED GENERATOR, never a trusted runner.** It only ever
> EMITS tool calls; OpenJammer turns each into the SAME reversible graph-store
> verb the user already drives by hand and applies it live, so the user watches
> the graph build. There is **no Approve/Reject gate**: every edit is recorded in
> the graph's undo history, so the player reverts anything with plain **Ctrl+Z**
> (each edit its own step). The worst an agent can do is the worst a user clicking
> around the canvas can do — and every step is undoable. Reversibility plus the
> OS/Pi sandbox (jail + env allowlist) is the boundary, not a modal.
>
> The chat is **persistent and session-aware**: it auto-reattaches to your last
> Pi session (so you can return days later and continue), `/new` starts a fresh
> session, and `/resume` moves between past sessions.

---

## The reuse-first workflow

The graph is a living document. Before adding anything, GROUND your plan in what
is already there and what the registry offers — then build whole workflows in one
reversible frame, and only fall back to authoring new DSP when nothing fits:

1. **Read before you write.** Call `get_graph` to see the whole canvas and
   `find_nodes` to locate a specific node (e.g. *the* speaker). Call
   `list_node_types` so you only ever reference real types. These are
   side-effect-free.
2. **Reuse existing nodes.** If a speaker / instrument / effect already exists,
   wire INTO it instead of adding a duplicate. `find_nodes` is how you avoid a
   second speaker.
3. **Build whole workflows atomically.** Prefer `emit_plan` (describe nodes by a
   symbolic `ref` and wires by port NAME) or `batch_apply` (an ordered list of
   raw verbs) so a connected workflow lands — and reverts — as ONE frame. Run
   `validate_plan` first to catch unknown types/ports, bad directions,
   incompatible ports, feedback cycles, and "produces no sound" BEFORE you
   commit.
4. **Author a code node only as a fallback.** When no built-in or existing node
   does the job, `author_code_node` authors a brand-new DSP node from source.
   This is the last resort, not the first move — see
   [`docs/code-node-abi.md`](./code-node-abi.md) for the `.wasm` ABI + the
   host-side validation contract.

### Why a plan?

A `WorkflowPlan` lets you describe a connected graph at a HIGHER altitude — nodes
addressed by a model-chosen `ref` ("osc1", "out"), wires by the human port NAME
("Audio Out" → "Audio In"), exactly as a person reads them off the canvas.
`emit_plan` LOWERS that to `add_node` / `update_node_data` / `add_connection` and
applies them through the same atomic `batch_apply` path, so it is never a new
trust path — just a friendlier way to author one reversible frame. The validator
guarantees the plan is sound (refs resolve, ports exist, no illegal cycles, the
signal reaches a speaker) before a single node is created.

---

## The full tool surface

> The list below is **generated from `TOOL_CATALOGUE`** (`src/ai/tools.ts`) via
> `catalogueToMarkdown()`. A test
> (`src/ai/__tests__/agentToolsDoc.test.ts`) asserts every catalogue entry
> appears here, so this section cannot silently drift from the code.

### v1 graph verbs (each a reversible store mutation)

- **add_node** — Add a node of the given registry `type` to the canvas (e.g. "looper", "multiplier", "sampler", "speaker"). Mirrors the UI add-node action.
- **remove_node** — Remove the node with the given `nodeId` (and its dangling connections).
- **update_node_data** — Shallow-merge `data` into an existing node's data (e.g. set a gain, duration, or effect param). Mirrors the UI parameter edits.
- **add_connection** — Connect `sourceNodeId:sourcePortId` -> `targetNodeId:targetPortId`. Ports must exist and connection rules apply (see registry.canConnect).
- **remove_connection** — Remove the connection with the given `connectionId`.

### DSP-node authoring

- **author_code_node** — author a brand-new DSP node from Faust source — PREFER reusing/stitching existing nodes first. On desktop this compiles the source to a .wasm + a validated manifest and registers a first-class node with its real params; in the browser the source is stored. Reversible by deleting the node.

### Reads / introspection (side-effect-free)

> Every read returns each node's **ports** — `{ name, direction, type }` (audio =
> blue, control/technical = grey). Wire by the port NAME you see here, never a
> guessed one — that ends the guess→reject→retry loop. `list_node_types` returns
> each type's default ports plus a `dynamicPorts` flag: when it is true the type
> generates its ports only once added, so add the node first and re-read to see
> them. An `UNKNOWN_PORT` validation error also lists the node's real port names.

- **get_graph** — Read the WHOLE current graph (every node + connection, all levels) as a compact summary. Side-effect-free. Prefer get_graph + find_nodes to REUSE existing nodes before adding new ones.
- **list_node_types** — List the node types the user can ADD, with names + descriptions, from the registry. Side-effect-free. Call this first so you only ever reference real node types.
- **find_nodes** — Find nodes in the live graph, optionally filtered by `type` (omit for all). Side-effect-free. Use it to REUSE an existing node (e.g. the single speaker) instead of adding a duplicate.

### Whole-workflow tools (one reversible frame)

- **batch_apply** — Apply an ORDERED list of mutation sub-calls as ONE atomic frame. batch_apply builds a whole connected workflow atomically — all-or-nothing: if any sub-call fails the entire frame is reverted. Applied edits are live and undoable with Ctrl+Z. Cannot be nested.
- **validate_plan** — Pre-flight a whole WorkflowPlan (nodes by ref, wires by port NAME) WITHOUT applying it. Side-effect-free: returns the structured errors (unknown type/port, bad direction, incompatible ports, feedback cycle, no path to a speaker). Prefer get_graph + find_nodes first to REUSE existing nodes, then validate_plan to repair before emit_plan.
- **emit_plan** — Build a whole WorkflowPlan in ONE reversible frame: describe nodes by a symbolic ref and wires by port NAME, and emit_plan lowers it to add_node/update_node_data/add_connection applied atomically (each edit undoable with Ctrl+Z). PREFER this for whole workflows; reuse existing nodes via get_graph/find_nodes first, and validate_plan to repair before emitting.

### Diagnostics & settings (the "help me get it working" surface)

The agent is also a **second pair of hands on the controls**: it can read the
on-device logs and the live environment, and read/write a **safe allowlist** of
settings — so "there's no sound" becomes a question it can answer from evidence
and then *fix*. The reads are side-effect-free; `update_settings` goes through the
exact store verbs the Settings panel uses and is **reversible** (Ctrl+Z restores
the previous values). It can never reach past what a user clicking the Settings
panel can do.

- **get_logs** — Read the on-device DevLog tail (newest first), optionally filtered by `levels`, `scope`, `search`, and `limit`. Side-effect-free. This is how you SEE engine xruns, node faults, MIDI, asset/plugin events, and every console line — diagnose "no sound" from evidence, not guesses.
- **get_diagnostics** — Read the environment + live audio snapshot: app version/channel/executor, cross-origin isolation, platform, whether the AudioContext is running, the measured round-trip latency, sample rate, and the selected output device. Pass a `nodeId` to instead get a NODE-scoped debug snapshot (identity, ports, data keys, a degraded flag, and the logs that mention the node) — the "why is this node silent?" facet. Side-effect-free. Call it first when the user says something is broken.
- **get_signal** — Probe a node's LIVE output level by `nodeId`: returns an instantaneous peak (0–1) or null when nothing is metered / audio is stopped. Side-effect-free. This is the one live read that catches a node which compiles and wires correctly yet outputs pure silence — if it reads ~0, probe again (a note may be between transients).
- **get_settings** — Read the user-facing settings you may change: audio sample rate, latency hint, low-latency mode, input/output device, theme, and default velocity. Side-effect-free.
- **update_settings** — Change settings via a `patch` over the safe allowlist (sampleRate, latencyHint, lowLatencyMode, outputDeviceId, inputDeviceId, themeId, defaultVelocity). Unknown keys are ignored; the change is REVERSIBLE (Ctrl+Z restores the previous values). Use it to FIX a setup — e.g. select the USB interface or switch to the interactive latency hint.
- **describe_arrangement** — Read the current SONG TIMELINE as a readable summary — tracks (by stable id), clips, addressable note details (id/pitch/tick/duration/velocity, capped per clip), sections, tempo, and automation, selection, grid, edit mode, armed tracks, click, count-in, punch and record state, all at bar.beat. Side-effect-free. GROUND yourself with this before editing the timeline (the "read the song first" twin of get_graph for the node graph).
- **edit_timeline** — Author the SONG TIMELINE with reversible primitive `verbs` or shared high-level `ops` — the SAME operation layer a human GUI drag emits — applied live and undoable with Ctrl+Z. Verb kinds: setTempo; setTrackMute/setTrackSolo/setTrackName/setTrackGain/setTrackPan; addTrack/removeTrack; addSource/removeSource; addClip/removeClip/moveClip/setClipWindow/splitClip; setClipGain/setClipFades; addNote/removeNote/editNote; addLocation/removeLocation/moveLocation/setLoopRange/setPunchRange; rippleTracks/insertTime/removeTime; stretchClip; compound; addAutomationLane/removeAutomationLane; setAutomationPoint/removeAutomationPoint/setAutomationRange/setAutomationLaneState/setAutomationLaneInterp. Ids for ADDED entities are minted for you (omit them). Record operations: armTrack, setClick, setCountIn, record (start/stop). Timeline operations include moveClips, trimClip, splitAt, duplicateClips, deleteClips, setGrid, nudge, drawNote, note edits, automation edits, and range edits. Times are PPQN ticks — read ppq + bar positions from describe_arrangement first.
- **export_song** — Export the current arrangement in the desktop app. Pass `outPath` plus the native BounceSpec fields: sampleRate (44100/48000/88200/96000), bitDepth (16/24/32f), format (wav/flac), and an auto or fixed-seconds tail. Native-only; returns path, peak/clipping stats, frames, sample rate, and channels.

**Authoring the timeline.** `describe_arrangement` + `edit_timeline` drive the on-canvas
DAW — the same shared `Arrangement` a human drags by hand, with one shared Ctrl+Z. Read the
song first, then author it. See **[timeline.md](timeline.md)** for the feature, the full verb
vocabulary, and the roadmap of what the timeline will grow into.

**A worked "get sound back" loop.** When a player says *"I hear nothing"*: call
`get_diagnostics` (is the AudioContext even running? is the round-trip latency
sane? is a USB interface selected?), then `get_logs` with
`{ "levels": ["Warn","Error"] }` to surface xruns / node faults, then either
`update_settings` to repair the obvious cause (e.g. select the interface,
`{ "patch": { "lowLatencyMode": true } }`) or `find_nodes` + `emit_plan` to wire
the missing path to the speaker. Every step is visible in the chat and undoable.

---

## WorkflowPlan shape (for `validate_plan` / `emit_plan`)

```jsonc
{
  "nodes": [
    { "ref": "lp",  "type": "looper" },
    { "ref": "amp", "type": "multiplier", "params": { "factor": 2 } },
    { "ref": "out", "type": "speaker" }
  ],
  "wires": [
    { "from": { "ref": "lp",  "port": "Audio Out" }, "to": { "ref": "amp", "port": "Audio In" } },
    { "from": { "ref": "amp", "port": "Audio Out" }, "to": { "ref": "out", "port": "Audio In" } }
  ]
}
```

- `ref` is YOUR symbolic id — wires point at refs, never at real node ids.
- `type` is a built-in `NodeType` OR a registered dynamic plugin id.
- `port` is the human NAME shown on the canvas; the lowering resolves it to the
  real port id.
- `params` become the node's initial `data` (and a follow-up `update_node_data`).

The validator (`validatePlan`) checks: every wire ref resolves; each type is
known; each port NAME resolves; `from` is an output and `to` is an input; the
connection is allowed (`registry.canConnect`); there is no feedback cycle
(**looper feedback is allowed** — a `looper` output→input edge is intentional and
not treated as a cycle); and at least one node reaches a `speaker`/output sink
("produces sound"). `emit_plan` runs the validator for diagnostics but the
RUNTIME is authoritative: if the validator passed yet a sub-call still fails, the
whole frame reverts and the divergence is reported, never swallowed.

---

## Auth resolves only WHO PAYS

Before the first run, the user picks a provider in the **AuthChooser** (Ctrl+K →
"Configure AI provider", or the first Tab when nothing is configured). This sets
WHO PAYS — it grants the agent no new power. OpenJammer NEVER persists the
provider key: it lives in the OS keychain (founder-gated) and is forwarded
transiently to Pi under the provider's env var (`anthropic` → `ANTHROPIC_API_KEY`,
`openai` → `OPENAI_API_KEY`, `opencode` → `OPENCODE_API_KEY`). When Pi's own
`~/.pi/agent/auth.json` would already resolve a working key, OpenJammer detects
the **conflict by outcome** and defers to Pi rather than double-injecting.

The default provider is **opencode Zen** (a free key). A non-dismissible notice
warns that, during its free period, collected data may be used to improve the
model — do not submit personal or confidential data. Claude Pro/Max
**subscription** OAuth is intentionally NOT offered (Anthropic prohibits it in
third-party tools since 2026-01-09); the Anthropic option is an **API key —
billed per token, NOT your Pro/Max plan**.

---

## Founder-gated next steps (NOT in this build)

These each need a live provider, a real Pi, or a real device, so they cannot be
verified in CI / the dev sandbox and are deliberately out of scope. The
**signatures + pure logic ship green today**; the live bodies are the founder
build's job:

1. **OS keychain storage** of the provider key (`auth_store_key` / `auth_get_key`
   / `auth_clear` via `tauri-plugin-keyring`). Today these return a typed
   `notConfigured` result; no heavy dep is added.
2. **Live OAuth loopback (Codex)** — `auth_begin_oauth` via `tauri-plugin-oauth`.
   The pure `pkce_challenge` (SHA-256 + base64url, RFC 7636-tested) is ready for
   it; no HTTP/OAuth dep is added.
3. **HTTP key validation** — `auth_validate_key` round-trips to the provider.
   Stubbed; needs an HTTP client.
4. **Persistent Pi subprocess across Tabs + a warm model cache** — today Pi is
   spawned per run (clean teardown, no hang). Keeping it warm needs a real Pi.
5. **Workspace split** — a stable `HOME` (so `~/.pi` config persists) + a
   disposable `cwd` worktree (already isolated per run).
6. **Persistent-intelligence runtime + real Pi-memory seed** — `caps.learning ===
   'pi-memory'` may seed/boost the local frecency floor via
   `paletteLearningStore.applySeedBoosts`. The seed SOURCE is a documented
   founder-gated stub today (no real Pi-memory read); the additive merge NEVER
   lowers a live local score (the local frecency floor is unconditional).
7. **Codex system-prompt-preamble CI assert** — verifying the exact preamble Pi
   sends needs a live Pi handshake.
8. **wasm RT execution host** for `author_code_node` — see
   [`docs/code-node-abi.md`](./code-node-abi.md) § "Founder-gated next steps".

See also the **`pi-openjammer-graph/`** bundled skeleton, which registers these
graph verbs as Pi tools whose `execute` round-trips post-state (D5). Mounting it
into a real Pi worktree + the persistent-intelligence install is founder-gated;
its README says so.
