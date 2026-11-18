# UX-INV — root-cause report on FH-1's five worst frictions

Investigation lane, 2026-09-02. **Root-cause only — nothing was fixed.** No file outside
`.scratch/ux-inv/` and this report was touched; no git state was changed.

**Build under test:** frozen production build (`bun run build` → `bunx vite preview --port 5244
--strictPort`), browser tier (`VITE_OJ_EXECUTOR` default = `ojcore-wasm`), Chromium launched with
`--autoplay-policy=no-user-gesture-required`, Playwright driven under **node**. Every script lives
in `.scratch/ux-inv/`. Q1 was additionally re-run **headed** on this box's real audio device.

## The five verdicts

| # | Friction | Verdict |
|---|---|---|
| Q1 | F1 — chord faults the starter rig | **Product bug (S1, engine).** Not a chord and not headless: **one** key press does it, on real hardware. It is a denormal flush mis-reported as `NonFinite`. |
| Q2 | F11 — Play never starts | **Product bug (S1).** The browser tier has **no transport return path at all** — `drain_transport` does not exist in `ojcore-wasm`, so no transport command can ever be acknowledged. The unbound-track warning is a *second*, independent bug. |
| Q3 | F13 — arrangement lost on tab close | **Product bug (S1, data loss).** The song *is* on disk in the emergency backup; the restore is gated on the previous session having **crashed**. A clean goodbye throws it away. |
| Q4 | F12 — Ctrl+S does nothing | **Product bug.** `file.save` dispatches `openjammer:new-project`, an event **no listener anywhere subscribes to**. Settings advertises the shortcut. |
| Q5 | F7 — a cable vanished | **Product bug (real fan-out loss).** Not the one-input rule: mousedown on an **output** that already has a cable arms a pending-disconnect, so grabbing an output always *moves* its cable. No gesture in this build fans an output out. |

---

## Q1 — F1: the starter "jam" rig faults on a single note

### Verdict: product bug in the engine. Reproduced headed and headless, identically.

FH-1 blamed the chord and blamed themselves. Both are wrong, and the bug is worse than reported:
**one key, held and released, is enough**, and the fault the UI shows (`NonFinite` — "sending noise
we can't play") is not what actually happened.

### Evidence

Scripts (all under `.scratch/ux-inv/`): `q1-chord-fault.mjs`, `q1b-tap.mjs`, `q1c-narrow.mjs`,
`q1d-pcm.mjs`, `q1e-long.mjs` (log `q1e-long.log`), `q1f-attrib.mjs`, `q1g-headed.mjs`.
Screenshots: `q1c-jam-after-key.png`, `q1e-chord-long.png`, `q1f-attrib.png`,
`q1f-attrib-HEADED.png`.

`q1b-tap.mjs` / `q1c-narrow.mjs` tap the worklet→main `MessagePort` and print the raw engine
`Event` batches plus the exact `OjGraph` that was pushed:

```
### rig = jam — slots(in graph order): [slot0 id=0 Sampler] [slot1 id=1 Delay] [slot2 id=2 SpeakerOut]
before key:        Sound live     0 batches
key held 1.5s:     Sound live     0 batches
  release +200ms:  Sound live     0 batches
  release +300ms:  Sound degraded 1 batches
EVENTS:
  +7693ms [{"seq":1,"severity":"Error","kind":{"NodeFault":{"node":0,"fault":"NonFinite"}},"source":"Wasm"}]
```

**A single `a` keypress degrades the engine ~300 ms after key-up, on the Sampler (the Electric
Piano), not on the delay and not because of polyphony.**

`q1e-long.mjs` (chord + 24 s observation) shows the second, worse half:

```
  +7708ms  NodeFault{node:0, NonFinite}      <- the instrument, once
  +22708ms NodeFault{node:2, NonFinite}      <- then ~10/s, forever
  ... 75 more, one per 100 ms drain window ...
BODY TEXT: … "Effect is sending noise we can't play." | "Bypass it" | "Effect bypassed — audio continues."
```

`q1f-attrib.mjs` repeats it and lands the storm on `node 1` (the Delay) — matching FH-1's DevLog
line `wasm NodeFault: NonFinite (node 1)` verbatim. Which of Delay / master storms varies per run;
both do. The card's attribution is *correct* (engine `NodeIdx` → visual id via
`OjcoreWasmExecutor.reverseIndex`, built at `OjcoreWasmExecutor.ts:494-495`).

**Not a headless artifact.** `AudioContext` in the harness is real: `{state:"running",
sampleRate:48000, baseLatency:0.01, outputLatency:0.048}` with `currentTime` advancing. The
**headed** run (`q1g-headed.mjs`, real window, real WASAPI device) reproduces byte-for-byte:
`fault node histogram: {"node":0":1, "node":1":65}`, same card text.

### The code path

1. `src/rigs/presets.ts:86` — the jam rig's effect is a delay, `feedback: 0.34, time: 0.3, mix: 0.28`.
   The instrument (`gm-electric-piano-1`) lowers to `builtin.sampler` fed by a 1.8 s procedural
   one-shot from `src/audio/voiceSynth.ts` (measured by `q1d-pcm.mjs`: 43 200 samples @ 24 kHz,
   `maxAbs 0.9`, **zero** denormals, **zero** non-finite — the PCM itself is clean).
2. `crates/ojinstrument/src/sampler.rs:264-265` — each voice runs a per-channel one-pole
   `v.lp_l += v.lp_coef * (l - v.lp_l)` and writes `v.lp_l * g * v.amp * gain` to the output.
3. `crates/ojinstrument/src/sampler.rs:273` — the voice keeps rendering **past the end of the PCM**
   (`if v.pos >= n as f32 { v.env.gate_off(); }`), and `sample_at` (`sampler.rs:111-119`) returns
   `0.0` there. With input pinned at 0 the one-pole state decays multiplicatively **with no
   denormal floor**, passing through the subnormal band on its way to zero. The ADSR is innocent:
   it floors at `SILENCE = 1.0e-4` (`crates/ojinstrument/src/adsr.rs:62`).
4. `crates/ojcore-dsp/src/lib.rs:267` — `DelayLine::process` does
   `self.buf[self.write] = x + delayed * self.feedback;` with **no denormal guard**. At
   `feedback = 0.34` / `time = 0.3 s` the tail needs ≈ ln(2e28)/ln(1/0.34) ≈ 60 repeats ≈ **18 s**
   to reach 1e-30 — which is exactly when the storm starts in `q1e-long.log` (+15 s … +22 s).
5. `crates/ojcore/src/resilience.rs:33-48` — **the actual defect.** `sanitize()` returns one
   boolean for three unrelated conditions:
   `let flush = !s.is_finite() || (*s != 0.0 && s.abs() < DENORMAL_FLOOR);` plus a `|x| > 4.0`
   hard clamp. A denormal flush is indistinguishable from a NaN.
6. `crates/ojcore/src/exec.rs:1612-1624` (`sanitize_node`) and `exec.rs:1338/1357` (master out)
   raise `budget.non_finite[node]` from that one boolean.
7. `crates/ojcore-wasm/src/lib.rs:940-947` — `drain_events` turns the flag into
   `NodeFault{NonFinite}`.
8. `src/audio/executor/faultPipe.ts:125,130` — `routeRuntimeFaults` treats `NonFinite` as a
   reportable plugin fault → `reportPluginFault`.
9. `src/store/pluginFaultStore.ts:22` — the card appears once **8 NonFinite land within 10 s** for
   one node. That is why the single instrument fault only flips the pill to "Sound degraded" while
   the delay/master storm raises the permanent card (`src/components/Bench/Bench.tsx:9` owns the
   copy "…is sending noise we can't play").

**Aggravating factor — the shipped wasm binary is stale.** `src/audio/wasm/pkg/` was last rebuilt at
commit `3b047a9`; `crates/ojcore` has had 17 commits since, including `86132bd`
("hosted-only guards"), which introduced `if self.program.kinds[node] == PrimitiveKind::PluginHost`
around `sanitize_node` (`exec.rs:1217`). The running binary predates that, so it still sanitizes
**every** built-in — which is why the Sampler and the Delay are flagged at all. Note that a rebuild
does **not** make the bug go away: the master-out `sanitize` at `exec.rs:1338` is ungated, so the
delay's denormal tail would still storm `NonFinite` on the Speaker node forever.

### Minimal fix proposal (not implemented)

The engine is not wrong to flush denormals; it is wrong to *call them NonFinite*. Split `sanitize`'s
return into the three things it actually detects — non-finite, denormal, clamped — and only let the
non-finite bit raise `budget.non_finite` (the other two are hygiene, not faults; at most a
rate-limited `OverBudget`-style diagnostic). One extra `bool` in
`crates/ojcore/src/resilience.rs:30-50` and one extra field read in `exec.rs:1616-1623` and
`exec.rs:1338`; `drain_events` (`ojcore-wasm/src/lib.rs:940`) then emits nothing for a tail. In
parallel, stop *creating* the denormals: add `scrub_denormals_and_nan` (it already exists,
`crates/ojcore-dsp/src/guards.rs:48`) to the two recursive states that have no floor — the sampler
voice one-pole (`sampler.rs:264,268`) and the delay feedback write (`ojcore-dsp/src/lib.rs:267`) —
which is also the CPU-spike fix those guards were written for. Then rebuild
`src/audio/wasm/pkg/`, which is two engine releases behind. Nothing here touches the UI; once the
engine stops lying the card, the pill and the red meter are all correct again.

### What I could not verify

- Whether the tail is *audible* (no ears in the harness); and whether the master soft-limiter would
  have masked it anyway.
- The native tier — everything above is `ojcore-wasm`. The `sanitize()` conflation is shared code,
  so native should behave the same for the master path, but I did not run `bun native`.
- Whether the `|x| > 4.0` clamp branch ever fires here (the measured PCM peaks at 0.9 and a triad
  through a 0.28-mix delay should not reach 4.0), so I attribute the fault to the denormal branch
  by elimination and by the 18 s timing match, not by instrumenting the Rust directly.

---

## Q2 — F11: Play never starts, and the chip blames the engine

### Verdict: product bug. Two independent causes; the one the UI hints at is the *lesser* one.

### Cause 1 (the blocker) — the browser tier has no transport return path at all

`src/audio/worklets/ojcore-processor.ts:504-506` reads the transport snapshot through a soft probe:

```ts
const transportDrain = Reflect.get(wasm as object, 'drain_transport') as (() => Uint8Array) | undefined;
if (typeof transportDrain === 'function') { … this.port.postMessage({ type: 'transport', frame: … }) }
```

**`drain_transport` does not exist.** Not in the shipped glue (`src/audio/wasm/pkg/ojcore_wasm.js`
exports 30 functions; it is not among them), not in the built binary
(`dist/assets/ojcore_wasm_bg-*.wasm` contains `drain_events` and no `drain_transport`), **and not in
the Rust source either** — `crates/ojcore-wasm/src/lib.rs` has no `pub fn drain_transport`. The only
producer of `EngineFrame::Transport` is `Engine::publish_levels`
(`crates/ojcore/src/exec.rs:524-534`), which is `#[cfg(feature = "std")]` and pushes onto the
native-only meter ring. So the guard is always false and **no `transport` message is ever posted to
the main thread.**

Downstream, that is fatal by construction:
- `src/store/arrangementStore.ts:71-77` — `armPendingTransportTimeout` fires after 1500 ms and sets
  `transportError: 'The audio engine did not acknowledge the transport command…'`.
- `src/store/arrangementStore.ts:850-877` — `receiveTransportFrame` is the *only* thing that clears
  `transportPending`; it is never called.
- `src/store/arrangementStore.ts:~889` — `currentTick()` returns the static `playheadTick` unless
  `transportFrameAtMs !== null && transportMotion === 1`, so the playhead is frozen at 1.1 forever.

The same `Reflect.get` pattern silently drops the timeline itself:
`ojcore-processor.ts:221-224` `callOptionalLoader` no-ops because `load_tempo_map` / `load_timeline`
— which **do** exist in `crates/ojcore-wasm/src/lib.rs:397,411` — are absent from the checked-in
generated glue (last rebuilt at `3b047a9`, before `9ace70a`/`f1fd45a` landed them). So even with a
perfectly bound song, the browser engine never receives the notes.

### Evidence — the failing AND the working path fail identically

Script `.scratch/ux-inv/q2-transport.mjs` taps both directions of the worklet port.

**Path A — the persona's steps** (Draw a clip → drag a clip → double-click → draw notes → Play).
`aria-label` confirmed `Track 1 piano roll, 2 notes`. Screenshots `q2-A-01…04`.

```
OUT (main->worklet):  graph 1 nodes | load_tempo_map 191B | load_timeline 119B
                      TransportSet×5 | "TransportPlay"
IN  (worklet->main):  graph-ack          <- and nothing else, ever
TRANSPORT frames ever received: 0
console: [song] timeline preview skipped tracks with unresolved refs (the rest plays) {detail: track-1}
UI: playhead 1.1
```

**Path B — a fully bound song** ("Start from 'Paper Sketch'": a 14-node graph, a 23 301-byte
timeline, **no** skipped tracks, **no** console warning). Screenshots `q2-B-01…04`.

```
OUT: graph 14 nodes | load_tempo_map 189B | load_timeline 23301B | TransportSet×5 | "TransportPlay"
IN : graph-ack
TRANSPORT frames ever received: 0
UI TEXT: "The audio engine did not acknowledge the transport command. The last confirmed position
          was preserved."   /  playhead 1.1
```

So: **the engine does not ack whether or not a track is bound.** `startArrangementPreview`
(`OjcoreWasmExecutor.ts:822-836`) is *not* silently returning — the tap proves the graph, the tempo
map, the timeline and `TransportPlay` all reach the worklet. The silent
`if (!this.node || !this.ready) return;` is a red herring here.

### Cause 2 (why a fresh track could never sound anyway) — a track ref that points at nothing

- `src/components/Arrangement/ArrangementSurface.tsx:49` —
  `EMPTY_TRACK_ARRANGEMENT = { … graph: { nodes: [], connections: [] }, tracks: [{ id: 'track-1', name: 'Track 1', ref: 'track-1', clips: [] }] }`.
  A brand-new track's `ref` is the **literal string `'track-1'`**, and the arrangement carries an
  **empty graph**.
- `src/song/conduct.ts:94` lowers `specToGraph(arr.graph)` — the *arrangement's own* graph, not the
  canvas graph. `conduct.ts:169-176` therefore cannot resolve `'track-1'`; in `lenient` mode it goes
  into `skipped` (`conduct.ts:193-194`), which is the console line FH-1 saw.
- Both empty-state buttons that create a real track — "Draw a clip" and "Add an empty track"
  (`ArrangementSurface.tsx:279-284`) — install exactly that unbindable arrangement.
- **There is no way to bind it.** The "Choose instrument for Track 1 ⌄" chip
  (`src/components/Arrangement/TrackLaneView.tsx:160`) dispatches
  `openjammer:open-browser` with `detail: { context: 'pick', trackId }`, but every listener drops
  the `trackId`: `src/App.tsx:97-101` reads only `detail.context`, and
  `src/components/Plugins/PluginsPanel.tsx:78-89` likewise. Its `choose()`
  (`PluginsPanel.tsx:91-105`) calls `addNode(type, { x: 80, y: 80 })` — it adds a node to the
  **canvas** graph, never writes `track.ref`, never touches `arr.graph`, and then toasts
  "Picked …". The chip is decorative.

### Minimal fix proposal (not implemented)

Two separable fixes, in this order. (1) **Give the browser tier a transport return path**: add
`#[wasm_bindgen] pub fn drain_transport() -> Vec<u8>` to `crates/ojcore-wasm/src/lib.rs`
alongside `drain_events` (`:921`), serialising `engine.transport()` +
`transport.position_at(...)` into the existing `EngineFrame::Transport` JSON shape the worklet
already parses at `ojcore-processor.ts:510-514`; then **rebuild `src/audio/wasm/pkg/`**, which also
restores the already-written `load_tempo_map` / `load_timeline` exports so the clip's notes actually
reach the engine. While the export is missing, the two `Reflect.get`/`typeof === 'function'` soft
probes should log once at `Warn` instead of being invisible — an optional seam that silently
disables the whole transport is exactly the "two owners of one invariant" smell the covenant
forbids. (2) **Make a new track bindable**: have `PluginsPanel.choose()` honour the `trackId` it is
already handed in `pick` context — write the new node into `arr.graph` and set `track.ref` to it
through a `setTrackRef` verb — and, until then, have `TrackLaneView` render the track as *unbound*
(the chip already knows: `typeof instrument === 'string'` is false) with the sentence FH-1 asked
for, on the track, before Play. Cause 2 alone would not have unblocked her; cause 1 alone would
have produced a moving playhead over silence.

### What I could not verify

- Whether, with `drain_transport` and the rebuilt glue in place, the timeline actually *sounds* —
  that needs a rebuild, which is outside this lane's write scope.
- The native tier's transport (it has the meter ring and `publish_levels`, so it presumably acks;
  untested here).
- Whether `TransportSet{flag:2}` / count-in interact with the fix.

---

## Q3 — F13: closing the tab keeps the canvas and deletes the song

### Verdict: product bug, S1 data loss. The song is on disk; the restore refuses to read it.

Script `.scratch/ux-inv/q34-persist.mjs`, log `q34-persist.log`. Persistent Chromium profile,
frozen build. Run A: build a song, wait out the 2 s autosave debounce, navigate away (a genuine
`pagehide`), close the browser. Run B: relaunch the same profile.

```
canvas graph nodes          | before=13 | after=13 | PASS restored
canvas connections          | before=6  | after=6  | PASS restored
arrangement clips           | before=3  | after=0  | FAIL — LOST
"An empty page." shown      | false     | true     | FAIL
emergency backup on disk    | present   | present  | STILL THERE, UNREAD (23 759 bytes,
                              ^ tracks=3, clips=3 — the whole song)
Undo button disabled        |           | true     | unrecoverable
marker AFTER: {"open":true,"bootSeq":1,"crashes":[]}   -> dirty=false -> mode 'clean'
```

Control run C, same content, killed via `chrome://crash` (no `pagehide`):
`[recovery] restored work after an unclean shutdown {mode: restore}` → `clips=3 tracks=3`.
Screenshots `q34-b2-arrangement-reopened.png` (empty) vs `q34-c-after-crash-reopen.png` (restored).

### The code path

- **(a) graph persisted:** `src/store/graphStore.ts:306-307` `persist(...)`, key
  `openjammer-graph-v2` at `:1968`, hand-rolled storage adapter `:1970-2098`, **no `partialize`**
  (`:2045-2046`). Live keys: `clipboard, connections, connectionsByNode, nodes, rootNodeIds,
  selectedConnectionIds, selectedNodeIds, version` — no arrangement.
- **(b) arrangement NOT persisted:** `src/store/arrangementStore.ts:12` never imports `persist`;
  `:320` is a bare `create(...)`; `:433` initial `arrangement: null`. No `localStorage` /
  IndexedDB / OPFS anywhere in the store or in `src/song/`. None of the 14 `setArrangement`
  callers is a boot hydration.
- **(c) backup written:** `src/App.tsx:397-433` ("Default-on crash backup"), `flush()` at `:401-409`
  → `writeEmergencyBackup({...collectSaveData(), projectName})` at `:405`, debounced 2000 ms
  (`:416`), subscribed to both stores (`:418-419`), final `flush()` on `pagehide` (`:424-425`).
  The payload **does** include the song: `src/persistence/collectSaveData.ts:19,29`.
  Storage: `src/persistence/recovery/webPayloads.ts:178-194` (`openjammer-emergency-backup`).
- **(d) clean-exit marker:** `src/persistence/recovery/useCrashRecovery.ts:152,156` —
  `pagehide → markCleanExit(markerStore)`; `src/persistence/recovery/recover.ts:224-228` writes
  `{...m, open: false}`; store `src/persistence/recovery/markerStore.ts:23-24`.
- **(e) the gate — the one line:** `src/persistence/recovery/recover.ts:96`
  `const dirty = prev?.open === true;` → **`src/persistence/recovery/breaker.ts:68`
  `if (!i.dirty) return 'clean';`** → `recover.ts:164-167` returns `restored: null` →
  `useCrashRecovery.ts:80-83`'s `setArrangement` is never reached.

**Bonus:** `src/persistence/journal/` (CRC-framed append log, `OpfsJournalStore`,
`LoroPersistence`, unit-tested) has **zero importers outside its own directory** and the live OPFS
root is empty. The durable tier is built and unwired; `localStorage` is the whole story today
(against code-value #8).

### Minimal fix proposal (not implemented)

Separate "is this snapshot *safe* to restore?" (the breaker's job — keep gating on `dirty` and the
crash count) from "should I reload the last document?" (nobody's job today for the song half). In
`useCrashRecovery.ts` (~`:80`), when `outcome.mode === 'clean'` and a non-quarantined backup exists,
validate it and apply **only** `setArrangement(arrangement)` — leave the graph to `zustand/persist`,
which already restored it — silently, with no "Recovered your work" toast (that stays exclusive to
`dirty === true`), and stop clearing the backup on the clean path.

**Risks.** (1) *Graph/song skew*: the graph is written synchronously on every mutation, the backup on
a 2 s debounce, so a tab closed inside that window reopens with a newer canvas than song — mitigate
by taking only the arrangement from the backup and by forcing `flush()` before `markCleanExit`
(today `App.tsx:425` and `useCrashRecovery.ts:156` both register `pagehide` and the ordering is
incidental, not enforced). (2) *Undo pollution*: the write must stay inside the boot effect
(`useCrashRecovery.ts:65-113`, before the autosave effects engage) and must not go through
`apply()`, or the player's first Ctrl+Z deletes their song. (3) *Multi-tab / collab*: `localStorage`
is origin-wide, last-writer-wins; two tabs already stomp `openjammer-graph-v2` and this widens the
blast radius from "my patch" to "my song" — `marker.instanceId` (`markerStore.ts:110`) exists and a
`BroadcastChannel` leader election is the real answer, out of scope for the minimal fix. (4)
*Quarantine*: keep the `WebPayloadSource.list()` filter (`webPayloads.ts:146`) on the clean path or
a song that reliably crashes the app gets re-loaded on every boot.

### What I could not verify

A literal OS-level tab close (a same-origin navigation-away plus a full browser restart was used;
both fire `pagehide`, and the marker state confirms the clean path was taken). Native tier untested.

---

## Q4 — F12: Ctrl+S "does nothing"

### Verdict: product bug — a keybinding the app advertises, wired to an event with no listener.

### The chain

1. `src/store/keybindingsStore.ts:55-61` — action `file.save`, label **"Save Project"**,
   `{ key: 's', ctrl: true }`, `scope: 'global'`. Rendered verbatim by
   `src/components/Settings/KeybindingsPanel.tsx:124`, so **Settings → Keybindings tells the user
   Ctrl+S saves.** The keymap's own comment at `keybindingsStore.ts:53-54` says "Do not advertise
   shortcuts that silently do nothing".
2. `src/App.tsx:439-455` binds it; `src/App.tsx:442-445`:
   `if (!projectName || !projectHandleKey) { window.dispatchEvent(new CustomEvent('openjammer:new-project')); return true; }`
   — and it returns `true` ("handled"), so nothing else, not even the browser's own Save, gets a turn.
3. **Dead end.** `grep -rn "openjammer:new-project" src/ e2e/` → three hits, `src/App.tsx:443`,
   `src/components/CommandBar/useCommandSources.ts:290`,
   `src/components/SafeMode/SafeModeScreen.tsx:102` — **all three `dispatchEvent`; no
   `addEventListener` exists anywhere.** Every sibling `openjammer:*` event has a listener. No
   Tauri gate is involved (`window.__TAURI__ === false` in the probe); the listener is missing in
   both tiers. `handleNewProject` lives as a component-local `useCallback` in
   `src/components/Shell/AppMenuBar.tsx:169-189` and is never subscribed. The Ctrl+K palette's
   "New Project" and Safe Mode's "Start Fresh" are broken by the same omission.

### The File menu

`src/components/Shell/AppMenuBar.tsx:293-347`. `Save Project` exists at `:308-321` but inside
`...(projectName ? [...] : [])` — it renders **only when a project folder is already open**. Live
capture with no project (`q34-q4-d-file-menu.png`):

```
["New Project...Ctrl+Shift+N","Open Project Folder...Ctrl+Shift+O","Recent Projects",
 "New Canvas","Import Workflow...","Export Workflow..."]
```

Exactly FH-1's `39-file-menu.png`. Note `AppMenuBar.tsx:344`: in a non-Chromium browser the menu
labels **Export Workflow… as Ctrl+S**, which is still false — `file.save` fires and still dispatches
the dead event.

### Reproduction

`.scratch/ux-inv/q34-ctrls.mjs`, log `q34-ctrls.log`, screenshot `q34-q4-a-after-ctrl-s.png`:

```
DOM byte delta: 0 | new toasts: [] | new dialogs: [] | console during Ctrl+S: []
manual dispatch of openjammer:new-project -> {domDelta:0, dialogs:0}
capabilities: showDirectoryPicker:true showSaveFilePicker:true getDirectory:true __TAURI__:false
```

### The browser tier's intended durability story

Three mechanisms, none reachable from Ctrl+S: **File System Access project folder**
(`src/utils/fileSystemAccess.ts:74`, `src/store/projectStore.ts:489,509,599,715`; `saveProject`
*does* write the arrangement at `projectStore.ts:756-759`) — the real save, only reachable through
an OS dialog; **Export Workflow… / Export Song (Ctrl+Shift+E)**, download-based
(`ExportDialog.tsx:74-75`); and **OPFS**, which exists only in
`src/persistence/journal/opfsStore.ts:86` and has no importers. `showSaveFilePicker` is never called
in `src/`.

### Minimal fix proposal (not implemented)

Two edits. (1) Register the missing listener — `AppMenuBar` should
`window.addEventListener('openjammer:new-project', …)` in a `useEffect`; one hook also repairs the
palette entry and Safe Mode. **Caveat:** `handleNewProject` (`AppMenuBar.tsx:169-189`) calls
`clearGraph()` + `resetView()` after the picker resolves, so wiring it naively makes **Ctrl+S wipe
the canvas** — the handler has to be split so the event path creates the folder and saves the
*current* document into it. (2) Make the no-project branch honest instead of silent: a toast
("Your work is kept in this browser — File → New Project… to save it to a folder you own") plus a
permanent "saved · just now / kept in this browser" line beside "Untitled song", and render
`Save Project` unconditionally (disabled with a reason) so the affordance is discoverable before it
is usable.

### What I could not verify

The with-a-project branch (`App.tsx:446-452` → `saveProject` → `toast.success('Project saved')`) —
`showDirectoryPicker` needs a real OS dialog headless Chromium cannot satisfy, so it is code-read
only. Whether the Ctrl+S keydown is `preventDefault`ed (the probe for that was written wrong; the
handler demonstrably ran and produced nothing, so it does not change the finding). Native tier
untested.

---

## Q5 — F7: connecting an output somewhere new removes its previous cable

### Verdict: product bug — a real fan-out loss in the drag gesture. The one-input rule is innocent.

`src/store/graphStore.ts:818-832` keys its replacement **purely on the target**:
`if (targetPort.type === 'audio' && targetPort.direction === 'input')` then find a conn with the
same `targetNodeId`/`targetPortId`. **No source-side rule exists anywhere in the store** — it will
happily hold N cables from one output. FH-1's target (the Reverb's empty IN) never triggered it.

### What actually removed Delay→Speaker

`src/components/Nodes/NodeWrapper.tsx:249-280`, `handlePortMouseDown`. Mousedown on **any** port that
already carries a cable arms a pending disconnect, and the lookup is **symmetric**:

```
264:  if (port.direction === 'output') {
265:      return conn.sourceNodeId === node.id && conn.sourcePortId === portId;
266:  } else { … }
273:  pendingDisconnectId = existingConnection.id;
278:  startConnecting(node.id, portId, pendingDisconnectId);
```

Stored at `src/store/canvasStore.ts:123-145`; on drop `NodeWrapper.tsx:386,399-402` unconditionally
takes the reconnect branch → `reconnectConnection` (`graphStore.ts:1292-1317`) →
`addConnection(..., replacingConnectionId)` which deletes the old edge in the same `set()`
(`graphStore.ts:847-856`). **Grabbing an output that has a cable always MOVES it; it never adds a
second one, and there is no modifier to opt out.** No React Flow is involved —
`onReconnect`/`onEdgeUpdate`/`onConnectStart`/`onConnectEnd`/`edgeUpdaterRadius` have **zero**
matches in `src/`; this is OpenJammer's own gesture.

### Evidence

**Path A — FH-1's exact steps** (`.scratch/ux-inv/q5-repro.mjs`, log `q5-repro.log`, screenshots
`q5-A-01-before-drag.png` → `q5-A-02-after-drag.png`, a pixel match for FH-1's `22-after-wire1.png`):

```
LOST edges:   ["effect:delay/audio-out -> speaker/audio-in"]
GAINED edges: ["effect:delay/audio-out -> effect:distortion/audio-in"]
SPEAKER STILL FED? false
total connections: 6 before, 6 after      <- a MOVE, not an ADD
```

**Path B — the isolated fan-out control** (`q5-diag2.mjs`, repeated in `q5-diag3.mjs` T4b): wire
A.out→B.in, then drag A.out to an empty D.in. Result `cables leaving A.audio-out: 1`, the A→B edge
removed. **An audio output cannot fan out in this build.**

### Secondary bug found on the way (worth its own item)

`src/components/Canvas/NodeCanvas.css:34-36` raises `.connections-layer` to `z-index: 100` for the
whole duration of a drag, above `.nodes-layer` (10). Each cable carries a 14 px transparent
`pointer-events: stroke` hit path (`packages/oj-ui/src/components/Cable/Cable.css:59-67`) that
terminates dead-centre on its port, so **dropping a cable onto a port that already has one silently
hits the cable, not the port** (`hit@target mid-drag: NOT-A-PORT(path)` in `q5-diag3.log`, zero
graph change). Consequences: the deliberate one-input replacement rule is largely unreachable by
mouse, and the obvious human workaround for fan-out (drag from the empty input to the occupied
output) also fails silently.

### Minimal fix proposal (not implemented)

Make the pending-disconnect **asymmetric**: a cable is uniquely identified by its *input* end, so
only an input port should arm the reconnect. Gate `NodeWrapper.tsx:261-275` on
`port.direction === 'input'` and delete the output branch (`:264-266`); grabbing an output then
always starts a *new* cable, and `addConnection`'s existing one-cable-per-audio-input rule
(`graphStore.ts:822`) still handles a drop onto an occupied input, so no store change is needed.
Separately, set `pointer-events: none` on `.oj-cable__hit` while `.node-canvas.is-connecting` (one
rule in `NodeCanvas.css`, mirroring the existing `.oj-cable-group.is-temp` precedent at
`Cable.css:114-116`) so a drop can always reach the port underneath. Neither touches the audio path.
Whatever the fix, F7's other half stands on its own: a cable that disappears without a word breaks
the model the cables teach — the replacement needs a flash or a toast either way.

### What I could not verify

The one-input replacement rule through the real UI (blocked by the cable-hit-path bug; verified by
reading `graphStore.ts:818-832` only). Whether the same output-side pending-disconnect bites
`technical`/`universal` ports (the code is type-agnostic, so almost certainly, but only `audio` was
tested). The multi-source path (`sources.length > 1`, `NodeCanvas.tsx:437-449`) — only `index === 0`
gets the reconnect. Proven on a Distortion effect, not a Reverb (identical port topology). No audio
was heard; this is a graph-topology finding.

---

## Cross-cutting observation

Three of the five (Q1, Q2, Q3) share one shape: **a seam designed to fail quietly, failing quietly
for a reason nobody intended.** `sanitize()` returns one boolean for three conditions;
`Reflect.get(wasm, 'drain_transport')` no-ops a missing export "so the committed pre-W3 glue stays
usable"; the crash breaker treats "no crash" as "nothing to restore". Each is defensible in
isolation. Together they are why the app tells a first-time player that *its own engine* is at
fault, three separate times in nine minutes, and is wrong every time.
