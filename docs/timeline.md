# The timeline — OpenJammer's on-canvas DAW

OpenJammer is also a DAW, and the timeline is where a song is arranged. It is built so
that **a human and an AI agent author the same song as first-class citizens**: a human
drags clips and notes; an agent emits the same reversible verbs; both land on one shared
document, undone with one plain **Ctrl+Z**.

This doc is the map of the feature — what it is, how to drive it (by hand and by agent),
and the **honest roadmap** of everything still ahead. For *why* the architecture is shaped
this way, read [BOUNDARY.md §9 — One core, two clocks](BOUNDARY.md#9-one-core-two-clocks--offline-render-is-not-a-third-executor)
first; this doc is where that trajectory landed.

## What it is

- **A `Song` node on the canvas.** Add it from the right-click menu (Utility → Song).
  Press **`E`** to enter it — its interior is not a sub-graph but a hand-drawn timeline
  (the [Living Sketchbook](../DESIGN.md): warm paper, Caveat, sticky ruler + track gutter,
  blue-ink notes, sections, a clock-anchored playhead). One discriminator on the node
  definition (`interior: 'graph' | 'timeline'`) chooses which interior you enter.
- **One shared `Arrangement`.** Tracks reference instrument nodes by ref; clips hold notes
  at PPQN ticks; automation lanes target node params; sections name the song's structure.
  It is the same document a headless agent writes in code and `oj song` renders to a WAV.
- **It plays.** Pressing Play conducts the arrangement to the live wasm engine and a
  look-ahead scheduler dispatches the notes; the playhead tracks `AudioContext.currentTime`
  and **freezes on stop** (the Live Performance Rule), follow-scrolls to stay in view, and
  the transport **auto-stops at the end** so the UI never claims to be playing a finished song.
- **It persists.** The arrangement rides along in a saved project / exported workflow as an
  opaque blob ([STABILITY.md FROZEN-1](STABILITY.md) — "a saved project always opens"); a
  reopened song keeps its whole timeline.

## The shape (one core, two clocks)

The timeline adds **zero lines to `ojcore`**. It is Tier-4 TypeScript that compiles *down*
to the flat `OjGraph` + an off-RT event stream — exactly as `emitOjGraph` lowers the visual
graph (see [BOUNDARY.md §9](BOUNDARY.md#9-one-core-two-clocks--offline-render-is-not-a-third-executor)).

- **`conduct(arrangement, backend)`** (`src/song/conduct.ts`) is the one pure lowering — the
  temporal sibling of `emitOjGraph`. It returns `{ graph, events, seconds, trackIndex }`.
  The *schedule* is backend-independent (a live browser preview and a headless native bounce
  play the same notes at the same ticks); only the graph's per-node mapping differs. A
  headless bounce is therefore **bit-identical to a live take by construction**.
- **Reversible verbs** (`src/song/verbs.ts`) are the one authoring vocabulary — a discriminated
  union of serializable edits, each with an exact structural inverse. `applyVerb` returns
  `{ next, inverse }`; the [`arrangementStore`](../src/store/arrangementStore.ts) command-log
  holds the inverses so human and agent share one undo history.
- **Live preview** lowers `conduct(arr, 'wasm')` into the running engine and a main-thread
  look-ahead scheduler (`src/audio/executor/arrangementScheduler.ts`) dispatches RtCommands
  by the audio clock. The audio thread never allocates or blocks for it; browser-tier timing
  is honestly ~15–25 ms — the bit-identical guarantee belongs to the offline bounce, not the
  preview.

## Driving it by hand

Inside a Song interior the DAW muscle-memory keys drive the **arrangement** (not the node
graph): **Space** = play/stop, **Ctrl+Z / Ctrl+Y** = undo/redo the song, **Delete** = remove
the selected note(s) or clip. Click the ruler to drop the playhead; click a clip or a note
to select it; the transport bar carries play/stop, a live bar.beat readout, the tempo, and
undo/redo.

## Driving it by agent

The agent grounds itself, then authors — the same reuse-first, untrusted-generator workflow
as the node-graph tools ([agent-tools.md](agent-tools.md)):

- **`describe_arrangement`** (read) — a readable summary: tracks by stable id, clips, notes
  (count + pitch range), sections, tempo, automation, all at **bar.beat**. The agent reads
  this *before* editing, exactly as `get_graph` grounds it before a node edit.
- **`edit_timeline`** (write) — an ordered list of reversible `Verb`s, applied live and
  undoable with Ctrl+Z. Ids for added entities are minted for the agent. A bad verb fails the
  call atomically (no partial apply).

The verb vocabulary (the same one a GUI drag emits): `setTempo`, `setTrackMute`/`setTrackName`,
`addTrack`/`removeTrack`, `addClip`/`removeClip`/`moveClip`, `addNote`/`removeNote`/`editNote`,
`addSection`/`removeSection`, `addAutomationLane`/`removeAutomationLane`,
`setAutomationPoint`/`removeAutomationPoint`.

> A host tool only reaches the model once the Pi extension declares it; the
> `piToolParity` test gates that every advertised tool is registered, so "the agent can't
> call a tool we built" cannot recur.

## Roadmap — what is still ahead

The *core* loop is done and verified (author → display → play → persist, by human **and**
agent). What remains, honestly, grouped by intent:

### 1. Pro-parity — the studio a professional won't leave

- **Comping** — Wave 7b records MIDI on both tiers and native audio into stacked clips.
  Loop passes carry ascending `layerIndex` values and the highest layer is the current take;
  the small `×N` badge is the intentionally narrow seam for a future take-lane/comp editor.
  That editor must author the same clip/layer verbs—never create a parallel playlist model.
- **Stems + 24-bit export** — bounce per-track stems and a higher-bit-depth master, not just
  the demo render.
- **The mixer as a Tier-4 view** — faders / pan / sends as a *view over the same graph*, not a
  second engine (extend the pillars, never fork).
- **Plugin delay compensation (PDC)** — align tracks through latent plugins, via the additive
  `ExtId::Latency` hook (no FROZEN-3 hot-path change — [STABILITY.md §4](STABILITY.md)).
- **The at-frame ring** — sample-accurate automation/notes (CLAP-precedented `at_frame`
  scheduling), gated behind a split-determinism proptest. Today automation is block-quantized,
  which is honest and good enough; this is the quality upgrade, not a prerequisite.
- **Freeze** — bounce a track to audio to reclaim CPU on a heavy session, reversibly.
- **An honest ear** — BS.1770 LUFS / true-peak / dropped-voice metering + a stereo master
  meter, so the loudness numbers the player (and the agent's `oj render` report) trust are real.

### 2. Reach every tier

- **Native live preview** — today Play sounds on the browser tier; the native tier's strength
  is the bit-identical **offline bounce** (`oj render` / `oj song`), and native live preview
  (push the conduct graph + schedule over the cpal-owned engine) is the follow-up. Until it
  lands, a calm on-timeline notice should say so rather than move a silent playhead.
- **Browser WAV export** — an in-browser offline render so a song can be exported from the GUI,
  not only headless.

### 3. Deeper authoring

- **Clip drag / resize** and **automation editing in the GUI** (lanes render today; editing
  their points is next).
- **More verbs** the model and a power user will reach for: reorder tracks, split/merge clips,
  quantize, transpose, set time signature, duplicate.
- **Drag-coalescing** — a drag gesture collapses to one undo step (the GUI emits one verb on
  drop; the store's command-log already supports atomic batches).
- **Richer `describe_arrangement`** — surface ppq / ticks-per-bar and automation param *names*
  so the agent never has to guess a tick or a param id.

### 4. The live AI DJ

The agent as a **reactive improviser / conductor**: it schedules events ahead and improvises
within them, so nothing ever waits on the agent's latency — including a "play DJ with my own
library" mode that builds transitions live. See the AI vision in
[CTRL-K-AND-AI-PLAN.md](CTRL-K-AND-AI-PLAN.md).

### 5. Smaller polish

- A non-focus-stealing **"preview is browser-tier" / "couldn't preview" whisper** for the
  native no-op and the all-tracks-skipped case.
- A **zoom control** (the bars-per-pixel scale is a constant today).
- A **`prefers-reduced-motion`** block for any future non-essential motion (the playhead's
  follow-scroll is essential tracking, not decoration).
- A **GUI round-trip persistence test** driving the Toolbar save→open path (the unit round-trip
  already proves `export → import → readArrangement → conduct`-equality).

---

Related reading: [BOUNDARY.md §9](BOUNDARY.md#9-one-core-two-clocks--offline-render-is-not-a-third-executor)
(why the timeline is Tier-4), [STABILITY.md](STABILITY.md) (the frozen surfaces it rides on),
[agent-tools.md](agent-tools.md) (the agent's full tool surface), [DESIGN.md](../DESIGN.md)
(the visual system), and [ARCHITECTURE.md](ARCHITECTURE.md) (the crate map).
