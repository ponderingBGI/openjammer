# W6-SHIP — the final fix lane before the `canari` PR

Every item in `FINAL-REVIEW.md`'s work order, plus W6-BASE's B1–B3. Each behavioural
change is pinned by a test that **fails on the pre-fix code**; the red output for every one
is in `plans/redesign-new-dna/.scratch/w6-ship/red-*.txt` and quoted below.

Base: `8809c77`. Nothing committed — this is a working-tree report.

## Gates — all six green, this working tree

```
bun run test:run                           238/238 files, 2711/2711 tests   exit 0
bunx tsc --noEmit -p tsconfig.app.json                                      exit 0
bun run lint                               $ eslint .                       exit 0
bun run build                              built in 4.22s · PWA 87 precache exit 0
bun run test:cli                           52 pass, 0 fail, 163 expect()    exit 0
bunx figma connect parse (packages/oj-ui)  parsed OK                        exit 0
git diff --check                           clean                            exit 0
```

The KeybindingsPanel flake is gone (item 8). **The suite is fully green with no known
flake** — the first time on this branch. Raw output: `.scratch/w6-ship/gate-test.txt`.

---

## 1. B1–B4 — undo spending itself on bookkeeping

`graphStore`'s `set` wrapper diffs and records **every** graph mutation that is not a
history replay. Four sites were written in the belief that staying outside
`begin/endGesture` kept a write out of history, and each said so in a comment.
`pluginLoadError.ts:16-22` already documents that belief as false.

| # | file:line | change |
|---|---|---|
| B1 | `src/audio/executor/voiceLoadError.ts:39` | `{ record: false }` + the file header rewritten (it asserted the gesture rule) |
| B2 | `src/audio/executor/faultPipe.ts:138` | `{ record: false }` — its sibling one line up was fixed in `a28f710`, this one was missed, so one crash minted **two** undo entries |
| B3 | `src/audio/executor/OjcoreNativeExecutor.ts:530` | `{ record: false }` + comment. Runs once per hosted plugin on **every save** |
| B4 | `src/components/Nodes/SamplerNode.tsx:88` | `{ record: false }` + comment ("set outside any gesture, so it is correctly non-undoable") |

### A test that had enshrined the bug

`voiceLoadError.test.ts` stated invariant 2 as *"It does NOT create an undo-history
entry"* and, three lines down, asserted `entries.length` grew by **exactly 2**. Both could
not be true. The test was the honest half; the doc comment is now the true one, and the
test asserts grows-by-**zero** in both directions.

### The Z4 sweep — every `updateNodeData` / `updateNodePorts` / `updateNodePosition` caller

`updateNodePosition` has no callers outside `graphStore` itself. Full classification:

| Caller | Driven by | Verdict |
|---|---|---|
| `voiceLoadError.ts:39` | engine — built-in voice failed | **FIXED (B1)** |
| `faultPipe.ts:138` | engine — hosted plugin crashed | **FIXED (B2)** |
| `OjcoreNativeExecutor.ts:530` | engine — state blob on save | **FIXED (B3)** |
| `SamplerNode.tsx:88` | environment — sample will not re-resolve, on mount | **FIXED (B4)** |
| `MIDINode.tsx:95` | effect — re-propagate deviceId to the internal child on reload | **FIXED (Z4)** |
| `MiniLab3Node.tsx:75` | same effect, same card family | **FIXED (Z4)** |
| `MicrophoneNode.tsx:160` | OS — input device unplugged, recover to `default` | **FIXED (Z4)** |
| `SpeakerNode.tsx:139` | OS — output device gone, recover to `default` | **FIXED (Z4)** |
| `MIDIIntegration.tsx:130` | bus — controller reappeared, re-arm an existing card | **FIXED (Z4)** |
| `midiStore.ts:498,509` | bus — device plugged in, auto-connect an existing card | **FIXED (Z4)** |
| `pluginLoadError.ts:56` | engine | already `{ record: false }` (W6-Z) |
| `LibraryNode.tsx:211` | effect — auto-bind to the project library | already `{ record: false }` (W6-Z) |
| `MIDIIntegration.tsx:254,261` | **player** — picked a device in the browser | records, correct |
| `AudioSettingsPanel.tsx:179` | **player** — chose an output in Settings | records, correct |
| `LibraryNode.tsx:417,433,495,535` | **player** — resize, separator drag, add library | records, correct |
| `EffectNode`, `InstrumentNode`, `LooperNode`, `MultiplierNode`, `SamplerNode` (params), `SpeakerNode` (volume/mute), `MicrophoneNode` (mute/device), `CanvasIONode`, `ContainerNode`, `MIDINode` (rename/channel), `AutoParamPanel` | **player** — knobs, pickers, renames | record, correct |
| `NodeWrapper.tsx:340,378` (`updateNodePorts`) | **player** — dropping a cable on a ghost port, inside `beginGesture` | records, correct |
| `PortPanelNode.tsx:138`, `PluginsPanel.tsx:100` (`updateNodePorts`) | **player** | record, correct |
| `ai/tools.ts:642` | **agent**, reversible by design (`undo: once(...)`) | records, **must** |

I **disagree with FINAL-REVIEW §1(c)** on `MIDIIntegration.tsx:128` and
`midiStore.ts:494,503`, which it cleared as "they create/rename a node the player then sees
and owns". They do not create anything — they flip `isConnected`/`deviceId` on a card that
already exists, when a device appears on the bus. Undoing that would disconnect a
controller that is physically plugged in. The node-CREATING path (`addNode`, further down
`MIDIIntegration`) is untouched and still records, which is right.

**Pins** — `entries.length` grows by zero on each path, and each also asserts the write
still LANDS (silent is not a no-op) and that the player's own last edit survives:

- `src/audio/executor/__tests__/voiceLoadError.test.ts` (rewritten assertion + a new one)
- `src/audio/executor/__tests__/routeRuntimeFaults.test.ts` (2 new)
- `src/audio/executor/__tests__/capturePluginStatesHistory.test.ts` (**new file**, boots a
  real `OjcoreNativeExecutor` over a mocked Tauri bridge and reads the real reverse index)
- `src/components/Nodes/__tests__/environmentWritesOffHistory.test.tsx` (**new file** — B4,
  the MIDI child re-propagation, the bus auto-connect)
- `src/components/Nodes/__tests__/SpeakerNode.test.tsx` (1 new)

**Red on the old code** (`.scratch/w6-ship/red-b1b2b3.txt`, `red-b4-z4.txt`) — 10 failures:

```
× grows the undo history by ZERO — the engine is not the player
× grows the undo history by ZERO — a crash is not an edit
× lands the blob and grows the undo history by ZERO
    AssertionError: expected [ { verbs: [ … ] } ] to have a length of +0 but got 1
× leaves the player their own last edit to undo across a save
    AssertionError: expected [ …, …(1) ] to have a length of 1 but got 2
× sets sampleLoadError on mount and grows the history by ZERO
× recovers WITHOUT growing the undo history — an unplugged cable is not an edit
× reaches the internal visual child and grows the history by ZERO
× re-arms an existing card and grows the history by ZERO
```

---

## 2. The retired blue — and why the gate missed it

`TrackLaneView.tsx:107` fed the retired hex to the track-colour `<input type="color">` as
its fallback value. `AGENTS.md`, `DESIGN.md` and this branch's own `5b412f5` all declare it
stale. **Why it escaped:** `tokenLiteralGate.test.ts` only ever opened `.css` files — a
colour written in TSX was outside the glob. (`webSurfaces.test.ts:245` only scans the
download-page HTML.)

A token cannot be handed to a native colour input, so the fix resolves the real thing:
`trackTintHex()` (`src/components/Arrangement/trackTint.ts:52-92`) reads the **computed**
`--track-tint` off the lane — already token-substituted for whatever theme is live — paints
one pixel with it and reads the sRGB bytes back. I verified in Chromium that this is the
only route: `oklch()` survives both `getComputedStyle().color` and `canvas.fillStyle`
serialization untouched (`.scratch/w6-ship/probe-oklch.mjs`), and only `getImageData`
returns bytes (`probe-oklch2.mjs` → `--universal-connection` resolves to `#a671f3`). The
picker now opens on the colour the lane is actually wearing.

The one remaining literal is `UNSET_SWATCH_HEX = '#000000'` — the HTML **spec default** for
`<input type="color">`, reachable only when there is no DOM to resolve against, and named
in the gate's `SANCTIONED_LITERALS` so a second exception has to be a deliberate edit.

**Gate extended** (`tokenLiteralGate.test.ts`): a new `sourceFiles()` walker scans `.ts`
and `.tsx` across Arrangement/Export/Plugins/Bench, plus a repo-wide test that the retired
hex appears in **no** `.css`/`.ts`/`.tsx` under `src` or `packages/oj-ui/src`.

**Red** (`red-item2.txt`):

```
× authors no colour literal in TS/TSX either — the glob follows the surface
    + [ "src/components/Arrangement/TrackLaneView.tsx" ]
```

---

## 3. Palette adds stacked on one point

`useCommandSources.ts` computed `viewportCenter()` — a pure function of pan/zoom/rect — for
every palette add, so Looper → Library → Sampler landed on one coordinate with the first
two ~90% occluded.

There was **no existing free-space logic to reuse**: `addNodeFromCtx` is the single add
path for *both* the palette and the right-click menu (the menu is a projection of the same
registry), and it only ever used `ctx.point`. So the rule went in one place,
`src/utils/spawnPlacement.ts` → `freeSpawnPoint(desired, occupied)`, and **both** surfaces
get it — right-click needs it too, since two right-clicks on the same pixel stacked
identically.

A cascade (+28,+28, wrapping sideways after 8) rather than a scatter: a cascade is legible,
the player can see the run they just made and drag the top one off the pile.

**Pin:** `src/components/CommandBar/__tests__/paletteSpawnPlacement.test.tsx` — the rule at
unit level, plus three real registered palette actions run end to end through the registry;
asserts three distinct coordinates AND at least one cascade step of separation on some axis
(distinctness alone would pass a 1px offset, which is still an occlusion).

**Red** (`red-item3.txt`): `three adds, three coordinates: expected 1 to be 3`.

---

## 4. Port-label vocabulary

DESIGN.md's faceplate section is **silent** on port wording, so per the brief I chose the
tersest consistent pair and documented it: **`IN` / `OUT`**.

The reasoning is DESIGN's own port legend: colour already carries the type (teal audio,
grey control, violet universal), so a label spelling "AUDIO" spends the card's tightest
9.5px run on information the eye already has — and it was spelling it three different ways
(`IN`/`AUDIO`, `AUDIO IN`/`AUDIO OUT`, `INPUT`/`AUDIO`) on cards visible at once.

- `src/engine/registry.ts` — `audioOutput.name` `Audio Out`→`Out`, `audioInput.name`
  `Audio In`→`In`, `instrument-visual`'s `Audio`→`Out`, and `Output`→`Out` on
  strings/keys/winds/instrument (7 port names).
- `src/components/Nodes/InstrumentNode.tsx:529`, `InstrumentVisualNode.tsx:167` — the
  hard-coded `'AUDIO'` → `'OUT'`. These bypassed the registry entirely, which is why
  unifying the registry alone would not have closed it.
- `src/store/graphStore.ts:57-95` — a **migration**, because saved projects persist their
  ports and a returning player would otherwise keep the old vocabulary forever
  (code-value #7). Scoped to the four generic port ids (`audio-in`/`audio-out`/`in`/`out`)
  so a port a player named "Output" by hand on a panel node is left alone.
- Accessible names stay verbose: `socket(outputPort, 'OUT', 'Audio output')`.
- One line added to DESIGN.md's wiring legend and to AGENTS.md's port law.

**Pin:** `src/components/Nodes/__tests__/portVocabulary.test.tsx` — on the **source**, not a
render, because a variant can enter through the registry, a faceplate literal or a saved
project, and a DOM test only sees the cards it mounted.

**Red** (`red-item4.txt`): 3 failures, incl.
`[ "microphone.audio-out = \"Audio Out\"", "looper.audio-out = …", … ]`.

---

## 5. Drum-mode heuristic

`pitches.size <= 16 && every pitch in [35,81]` is **most tonal music**. The shipped
starter's "Nylon Chords" matched, so the first clip a new player opens rendered as
duration-less diamonds beside a gutter reading `D5 · C♯5 · … · Low bongo · Ride · Cowbell`.

**The signal it keys on**, written into the code comment
(`src/components/PianoRoll/geometry.ts:60-145`), in descending order of what the system
actually knows:

1. **`instrumentIsPercussion`** — the bound instrument's registry `category`. A fact.
2. **A kit word** in the track or instrument name (`drum|kit|perc|percussion|beat|groove`).
3. **Shape, and only shape:** ≤16 distinct pitches, every one **named in `GM_DRUM_NAMES`**
   (not merely inside a 47-semitone window), and **no note longer than a sixteenth**.

There is **no channel** on an `ArrangementNote` (`{ id, tick, durTick, pitch, vel }`), so
"channel 10" is not a signal available here and I did not pretend otherwise — that is
stated in the `DrumDetectionContext` doc comment.

`GM_DRUM_NAMES` moved from `PianoRoll.tsx` into `geometry.ts` so the map the gutter reads
and the map the predicate tests are the same one — they were not, which is how the roll
labelled a pitch `Ride` while the predicate had never looked at the map.

Both callers now pass the full context. `TrackLaneView.tsx` was calling the bare predicate
while `PianoRoll.tsx` OR'd in `instrumentDrums` — so the **inline** roll, the one a player
meets first, was deciding on the weakest evidence in the system. That fork is closed.

Ties go to melodic on purpose: opening a kit melodic costs one click of the `Drums` toggle;
opening a song as drums misnames every row and discards every duration on screen.

**Pin:** 5 tests in `geometry.test.ts`, the first built from the **real shipped starter**
via `buildPaperSketch()` rather than an approximating fixture.

**Red** (`red-item5.txt`): 4 failures, incl.
`opens the shipped starter melodic — expected true to be false`.

---

## 6. The roll's 128-note tab trap

`PianoRoll.tsx` rendered every note as `tabIndex 0`; the starter's first clip has 128, so
tabbing in cost 128 presses to get out. Worse in practice than the unreachable canvas
ports, because the notes invite the keyboard and then hold it.

Roving tabindex (`PianoRoll.tsx:145-163, 640-676, 768`): one tabbable note, the rest `-1`,
arrows move the roving focus and take focus with them. The target is chosen from
`renderedNotes` — notes clipped or out of pitch range render `null`, so choosing from the
raw list could put the tab stop on nothing.

**Selection semantics are untouched.** The arrow handler on the note returns immediately
when `selectedNoteIds.length` is non-zero — which is *exactly* the guard the surface handler
already uses — so the two are complementary: with a selection the arrows nudge, transpose
and set velocity as before; with none they walk the notes. That complementarity is itself
pinned.

**Pin:** 4 tests in `PianoRoll.test.tsx`. The tab-stop test samples 6 spread indices rather
than all 128: focusing every note re-rendered the roll 128 times and took over 5s under a
full parallel run — it would have become the next KeybindingsPanel flake for no extra
proof, since the invariant is identical at every index.

**Red** (`red-item6.txt`):

```
× renders many notes and exactly ONE of them tabbable
    expected [ <button …(7)></button>, …(127) ] to have a length of 1 but got 128
× leaves the roll in ONE press of Tab, from anywhere in the note field
```

---

## 7. `returnArmed` coverage

`packages/oj-ui/src/components/TransportPill/`:

- **`TransportPill.test.tsx`** — 4 tests in a `the second Stop` block. The glyph is
  identified by *geometry* (1 path = play, 1 rect = stop, path + rect = rewind) rather than
  by the `is-return-armed` class, which carries no styling and would prove nothing a player
  can see. Covers: the glyph swaps; both marks stay solid (the hairline `ReturnGlyph` sits
  40px away and means a different tick); the accessible name and title become `returnLabel`;
  `returnArmed` is ignored while `playing`; and the unarmed default is unchanged.
- **`TransportPill.stories.tsx`** — `ReturnArmed` ("Second Stop armed"), a stopped transport
  with the mark live, in the shape of the existing five.

**Red** (`red-item7.txt`, produced by stubbing `const rewind = false`): 3 failures,
`expected 'play' to be 'rewind'`.

**Theme coverage — honest limit:** the story renders in whatever theme Ladle is set to; it
is one story, not two, matching how the other five work. A light/dark *capture* of the armed
glyph belongs to W6-BASE's snapshot pass, which I did not touch.

---

## 8. Small honesty items

| Item | File | What |
|---|---|---|
| Cross-domain apply order | `src/store/historyStore.ts:73-92` | A doc block above `dispatch`: apply order is per-**driver**, not per-verb. A `graph` verb sequenced after a `document` verb is still applied first. Harmless today (the domains are disjoint); the note says what to do instead of hoping the `drivers` Set is ordered right. |
| `entries` tiebreaker | `src/keymap/types.ts:23-40` | `runSets` returns on the first match, so order is the **only** tiebreaker. Names the live dependency: the canvas set puts `levelActions` (`e`, `q`) before `noteActions` (29 letter keys), so a new action appended at the end is silently dead when `currentMode > 1`. |
| Empty `@media` block | — | **Already gone.** I scanned all 198 `.css` files (incl. `dist`, `apps/docs`) for both an empty `@media` and *any* empty rule: zero hits. Resolved by another lane before I arrived — measured, not assumed, and now gated so it cannot return. |
| `Slider.css` re-adds a transition under `reduce` | `packages/oj-ui/src/components/Slider/Slider.css:130-152` | → `transition: none`, with the reasoning: `global.css` had already clamped it to `.01ms`, so the rule bought nothing and read as an exemption. |
| KeybindingsPanel timeout | `src/components/Settings/__tests__/KeybindingsPanel.test.tsx:47-72` | `15000`, with a comment naming the parallel-load history (169 rows, ~3.2s alone, a real 1.6× margin that only crossed under load) and stating that a failure *at* 15s would be a genuine regression. |

**New gate:** `src/components/__tests__/reducedMotionContract.test.ts` closes both CSS items
as *classes* — no empty rule anywhere, and no `reduce` block may re-add a transition or
animation (durations ≤1ms allowed, since `global.css`'s `.01ms` clamp **is** the rule being
protected). It also pins the two deliberate exemptions (`.oj-cable`, `.oj-meter`).

**Red** (`red-item8.txt`):

```
× never RE-ADDS a transition or an animation under reduce
    + [ "packages/oj-ui/src/components/Slider/Slider.css: transition: box-shadow var(--motion-fast)" ]
```

---

## 9. Docs truth

**`AGENTS.md`** (loaded every session, so both errors were being taught):

- `type: 'technical'` → **`type: 'control'`**. `'technical'` is a retired type name; the
  shipping union is `'audio' | 'control' | 'universal'` and `graphStore` migrates it away.
  The two examples at the end of the section propagated the dead name — fixed.
- `--universal-port` → **`--universal-connection`**.
- The `audioUtils.ts` camelCase exemplar is a **ghost** (no such file anywhere in the repo).
  Replaced with `spawnPlacement.ts`, which this lane added.
- Added: the retired hex is now mechanically enforced, and a note that a timeline mark
  wanting violet takes `--timeline-automation-line` or `--accent-two-ink`, never a wiring
  token.

**The dormant token — removed.** `--universal-port` had **zero** consumers in `src` or
`packages/oj-ui/src`; only its own declaration. Deleted from `light.json`/`dark.json` and
from the hand-written `packages/oj-tokens/src/types.ts`, then `bun run tokens` regenerated
`themes.ts`, `packages/oj-ui/oj-tokens.css`, `public/download/oj-tokens.css` and
`apps/docs/src/styles/oj-tokens.css`. `webSurfaceTokens.test.ts` (byte-for-byte) stays green.

**`DESIGN.md`**:

- The token count is **53 and now correct**: it passed through 54 (`accentTwoInk` landed,
  +1) and back (`universalPort` removed, −1). The arithmetic is written into the section
  rather than just the number, so the next reader can check it.
- The `--universal-port` row is gone from the legend and from both front-matter palettes.
- **The reduced-motion claim is restated, not patched.** "No component ships its own
  `prefers-reduced-motion` block" is broken by 13+ stylesheets, so it was simply false. The
  rule as it actually holds: the blanket rule owns turning motion *off*; a component block
  may only **substitute a static equivalent** for meaning the clamp would destroy, and may
  never **re-add** a transition. The "Don't" list is updated to match, and both halves are
  now gated.

**`docs/timeline.md`**:

- `M` is the **metronome** (`arrangement.metronome`), not the mixer; the mixer has no key
  and opens from the sky band's **Mix** button. Fixed at `:115`.
- Zoom keys are bare **`=`/`-`**, not `+`/`-`, at both `:65` and `:262` — with the reason
  (`matchesKeyCombo` is strict on shift, so `Shift+=` does not match `=`).
- The `--accent-two-ink` "honest gap" **shipped**: removed from the gap list, and the
  note-ink paragraph now describes the real token instead of the retired inline derivation.
- The drum false-positive gap is removed — item 5 closed it.
- The bare-arrow gap is re-verified as still true and marked so.

**`docs/shell.md`**:

- Ports-not-tabbable recorded as an **open P1 product decision**, with the measurement
  (0 of 84), the pointer to `03-canvas-app-reliability-audit.md:41` (UI-017), and both
  branches spelled out — including that shipping it as settled is what is not acceptable.
  It also contrasts the roll's now-single tab stop as the failure mode a naive "make ports
  tabbable" fix would reproduce on the canvas.
- Corrected `arbiter.ts`'s claim that a backwards `Tab` from the stage floor reaches the
  chrome: it takes **two** presses, the first landing on `document.body`.
- Record-disabled reason quoted in full: *"Arm a track first — open the arrangement with
  Tab"*.

---

## 11–13 — W6-BASE's B1–B3 (done in this lane)

### 11 · the 13px sans floor — nine reported, **eleven** fixed

The gate (`typeFloor.test.ts`) had **two** blind spots, and that is why all nine survived:
it matched only `font-size:` (never the `font:` **shorthand**, which is how the whole
timeline writes type), and it scanned only the four surfaces W6-CAP happened to measure.
Both are widened. Widening it surfaced **two more** live breaks nobody had reported.

Buckets — prose and actionable labels **lift** to `--text-sm`; name and marker runs move
**into** the micro mono voice:

| Rule | Bucket | Why |
|---|---|---|
| `.arrangement-section-chip` | lift | a name the *player* typed; uppercase mono would mangle it. Its stale "11px/600 label" comment fixed too |
| `.arrangement-instrument-chip button` | lift | instrument name, and it opens the picker |
| `.arrangement-track__lane-menu` | lift | prose ("Drum rows" / "Pitched notes") |
| `.arrangement-track__lane-menu button` | lift | actionable |
| `.arrangement-automation__interp .oj-seg__btn` | lift | restores `SegmentedControl`'s **own** `--text-sm` |
| `.arrangement-time-prompt label` | lift | form labels |
| `.piano-roll__mode-note` | lift | prose |
| `.piano-roll.is-drums .piano-roll__key` | **mono** | the base `.piano-roll__key` was *already* mono/xs — the drum override was switching it to sans, breaking a rule that was right |
| `.oj-waveform-view__crop` | **mono** | one-word status stamp; its own sibling `__duration` was already mono at the same size |
| `.arrangement-bars-row .oj-time-ruler` **(new find)** | mono | bar numbers; the face is now named rather than inherited |
| `.arrangement-clip__fault` **(new find)** | mono | badge glyph, same run as the node plugin-error badge |

Also: `.arrangement-instrument-chip__swap` was `font-size: 10px !important` — off the scale
entirely, and `!important` only because it was fighting the rule above it. It is a chevron
**glyph**, so it takes `var(--text-xs)/1 var(--font-mono)`. And `font-size: 0` is now
explicitly allowed by the scale gate, with the reason: it is how a control that draws its
mark in a `::before` says "there is no text here", and a zero-height run cannot break a
legibility floor.

### 12 + 13 · the scroomer map, and wiring tokens on timeline marks

These overlapped on `PianoRoll.css:200` and are resolved together. Both marks were painted
with `--universal-connection`, which is **two faults in one declaration**: the port/cable
violet spent on something that is not a cable (AGENTS.md's port-colour law), *and* an accent
tuned for a socket core used where an **ink** was needed.

Measured composited against the real ground (`colorjs.io`, same method as `contrast.test.ts`):

| Mark | Ground | Before | After | Floor |
|---|---|---:|---:|---:|
| Scroomer note map — light | `--bg-tertiary` | **2.25** | **7.76** | 3 |
| Scroomer note map — dark | `--bg-tertiary` | 4.01 | 7.01 | 3 |
| Record-ghost captured notes — light | `--accent-danger` 7% over lane | **2.57** | **8.23** | 3 |
| Record-ghost captured notes — dark | same | 4.31 | 7.20 | 3 |

(W6-BASE's browser sweep read 2.78 and 3.01 for these against its own sampled grounds; my
model reads them lower. Every one of those four numbers is at or under the floor — 3.01 is
not a pass, it is a queue position.)

- **Scroomer ticks** → `--piano-roll-note-ink`. The ticks are a mini-map *of the notes*, so
  they wear the note ink. Fixes contrast **and** the naming law in one move.
- **Record-ghost marks** → `--accent-two-ink`, the token this system minted for exactly this
  ("the readable ink of the SECOND accent").
- **Draw ghost** (`:287`) and **step cursor** (`:303-304`) → `--timeline-automation-line`.
  **Verified byte-identical to `--universal-connection` in both themes before renaming**
  (`oklch(0.66 0.19 300)` light / `oklch(0.72 0.19 300)` dark), so these are renames with
  zero visual change; both are carried by a solid border or ring, not by their wash.

**Deviation, stated:** the brief asked for `--timeline-automation-line` on all three. I used
it on the two that only needed the *name*, and the **ink** tokens on the two that had to be
**read** — because `--timeline-automation-line` reaches only 3.07 on the ghost ground even
at full opacity, which is the same razor margin again. The naming law is satisfied either
way (neither ink is a wiring token); the legibility floor is only satisfied one way.

**Pins:** 5 new tests in `contrast.test.ts`. They read the **token name** out of the
stylesheet as well as the opacity, so swapping the ink back turns them red — a gate that
measured only its own intended value would agree with itself. Plus a law test: neither
`PianoRoll.css` nor `ArrangementSurface.css` may name `--universal-connection` or
`--control-connection` at all (comments stripped), and a test that the two violets are still
identical, since the two renames would otherwise change colour silently.

**Red** (`red-item11-13.txt`):

```
× sets no sub-13px size without declaring the mono face beside it
× the scroomer note map, in both themes
    the ticks wear the note ink: expected '--universal-connection' to be '--piano-roll-note-ink'
× the record ghost captured-note marks, in both themes
    the marks wear the second accent INK, not the accent: expected '--universal-connection' to be '--accent-two-ink'
× spends no wiring token on a timeline mark
```

---

## Browser verification — items 3, 5, 6, both themes

One headless Chromium (node + Playwright) at 1440×900 against
`bun dev --port 5238 --strictPort`; onboarding skipped via "Skip, take me in"; the **real
shipped starter** loaded from the arrangement's own "Start from 'Paper Sketch'" offer.
Script and captures: `plans/redesign-new-dna/.scratch/w6-ship/verify.mjs`, `verify.json`,
`item3-palette-adds-{light,dark}.png`, `item5-6-roll-{light,dark}.png`.

**Console errors: 0**, both themes.

| Check | light | dark |
|---|---|---|
| 3 · three palette adds → distinct positions | yes | yes |
| 3 · minimum separation between any two cards | 26px | 26px |
| 5 · roll opens **melodic** on the starter (`is-drums`) | `false` | `false` |
| 5 · mode note | `Pitched notes` | `Pitched notes` |
| 5 · GM drum names in the key gutter | **none** | **none** |
| 5 · gutter actually reads | `D♯5 · D5 · C♯5 · C5 · B4 · A♯4` | same |
| 6 · notes rendered / tabbable / `-1` | 128 / **1** / 127 | 128 / **1** / 127 |
| 6 · Tab from a note leaves the note field | yes → `piano-roll__lollipop` | yes |

**The browser pass earned its keep.** It caught a real crash the unit tests missed:
`ReferenceError: note is not defined` in `PianoRoll`. My red-capture restore had
string-matched the *first* `tabIndex={0}` in the file, which was the `<section>` root's, not
the note button's — so the roving expression ended up on the surface root and the button got
a bare `0`. `tsc`, `lint` and the full vitest suite all passed with it. Repaired
(`PianoRoll.tsx:700` back to `tabIndex={0}`, `:768` carries the roving expression), the file
re-diffed against HEAD to confirm the root's line is untouched, and the full suite plus the
browser pass re-run clean.

---

## 10 — accepted follow-ups, not attempted

- **The beat rig's step sequencer card** — an uncarded strip welded to the viewport bottom,
  clipping the `SONG` card it belongs to, with accent-orange content cells wearing the state
  colour. Needs a design decision, not a patch.
- **Keyboard wiring for ports** — open P1 (UI-017). Now *recorded* in `docs/shell.md` as an
  open decision (item 9), which was the reviewable part of it.
- **`abort()` vs `undo()` selection-reset asymmetry** (`historyStore.ts:143-148`) — an
  aborted gesture leaves the selection-history and paste-depth cursors where the reverted
  edit put them. A behavioural decision.

---

## What I could NOT verify

- **Anything a performer hears.** No audio device in this environment; every finding above
  is structural or measured in a headless browser. FINAL-REVIEW §7's founder checklist is
  untouched and still owed — especially double-Stop *timing*, looper undo feel, and a
  listening pass with audio actually playing.
- **The armed-glyph appearance in both themes.** Asserted by geometry in jsdom and by one
  Ladle story; the light/dark *capture* belongs to W6-BASE's snapshot pass.
- **The native tier.** Everything here is the browser tier.
- **Visual baselines.** My changes to type sizes and two mark colours **will move pixels** in
  the arrangement, the roll and the waveform view. `e2e/visual-baselines.spec.ts`, its
  snapshots and `COVERAGE.md` are W6-BASE's and I did not touch them — **the baselines must
  be re-captured before merge.** W6-BASE-REPORT §4 flags exactly this for its B1.

## Risks

1. **Baseline churn** (above) — the one thing that must not be forgotten.
2. **The port-name migration** rewrites persisted port names on load. Scoped to four generic
   ids and covered by `migrateNodePorts`'s existing tests, but it does touch saved projects.
3. **`trackTintHex` uses canvas pixel readback.** It runs once per lane per tint change,
   never per frame, and degrades to the spec-default black where there is no canvas — but it
   is a new DOM dependency in a render path.
4. **The Z4 reclassification of the MIDI bus paths** contradicts FINAL-REVIEW's own clearing
   of them. My reasoning is in §1; if the reviewer disagrees, those four call sites revert
   independently of everything else.


---

# Fix round — W6-SHIP-REVIEW F1–F11

All eleven findings addressed in one pass. Everything below was measured on the
same rig the review used: headless Chromium (node + Playwright) at 1440x900
against `bun dev --port 5238 --strictPort`, both themes, dev server stopped after.
Scripts and JSON: `.scratch/w6-ship/verify-fix.mjs` / `verify-fix.json`,
`verify-f5f6.mjs` / `verify-f5f6.json`, captures `fix-*.png`.

**The ruling on the MIDI-bus disagreement is accepted** — the review confirmed the
lane's reading against the code, so risk #4 in the first report is closed and those
four call sites stay as they are.

## Gates, re-run after the fix round

```
bunx tsc --noEmit -p tsconfig.app.json                              exit 0
bun run lint                       $ eslint .                       exit 0
bun run test:run                   3101 / 3102 tests                see below
bun run build                      built in 3.50s                   exit 0
bun run test:cli                   52 pass, 0 fail, 163 expect()    exit 0
bunx figma connect parse (oj-ui)   parsed OK                        exit 0
git diff --check                   clean                            exit 0
```

Test count rose 2711 -> 3102 (+391), almost all of it the widened gates.

**The one failure is not this lane's.** `src/audio/worklets/__tests__/wasmExportParity.test.ts`
reports `drain_transport` and two siblings missing from the committed wasm glue.
That test reads only `src/audio/wasm/pkg/*` and `src/audio/worklets/*`, both of
which the **Rust lane** is editing live in this worktree (`crates/ojcore-wasm/src/lib.rs`,
`src/audio/wasm/pkg/ojcore_wasm.js`, `src/audio/worklets/ojcore-processor.ts` are all
in `git status` and none is in the W6-SHIP change set). It is their in-flight
rebuild — `bash src/audio/wasm/build-wasm.sh --release` is owed on that side. I did
not touch it, and per the review's own closing note it must not be swept into this PR.

---

## F1 + F2 + F9 — the vocabulary pass, at every source

The review's core point: the gate agreed the vocabulary was unified while the
screen said otherwise, because port names come from **four** places and the gate
read one. All four now speak `In` / `Out`:

| source | change |
|---|---|
| `src/utils/nodeInternals.ts:452,1226` | the instrument- and sampler-visual `audio-out` — `'Audio'` -> `'Out'` |
| `src/utils/nodeInternals.ts:473,1247` | the output-panel's receiving side (`id: audio-out`, `direction: input`) — `'Audio'` -> `'Out'`, and its `portLabels` entry with it |
| `src/utils/portSync.ts:145,165,203,207` | the `\|\| 'Input'` / `\|\| 'Output'` fallbacks -> `'In'` / `'Out'` |
| `src/utils/portSync.ts:344,353,359,364` | **four more the review did not list** — `getBundleSizeFromSourcePort`'s `label: 'Input'` fallbacks, found by the rewritten gate |
| `src/engine/dynamicRegistry.ts:142,145,190,191` | hosted VST3/AU/CLAP + AI-authored effect ports |
| `src/engine/nodeStandards.ts:113,122` | the node-authoring standard (F9) |
| `docs/node-standards.md:223,232`, `docs/creating-nodes.md:154` | both authoring guides (F9) |

**`portVocabulary.test.tsx` is rewritten, not extended.** It no longer reads
`nodeDefinitions` at all. It now:

- ADDS every user-facing node type through the real `useGraphStore.addNode` —
  which runs the internals builder and the port sync — and asserts on the ports
  every resulting node carries, internal children included;
- RENDERS each of those types through the real `NodeWrapper` and asserts on the
  live `.oj-port-row__label` text;
- exercises `migrateNodePorts` directly (see F8), including the direction case and
  the "a port the player named is left alone" case;
- asserts the hosted definition and the AI-authored pair, the latter by checking
  `EFFECT_DYNAMIC_PORTS` really does mirror the static `effect` ports — its own
  comment claimed that and nothing checked it, which is how they drifted;
- greps the five name-MINTING modules for the retired spellings, so a new one
  cannot enter from any of them.

52 tests. `migrateNodePorts` had to be exported from `graphStore` to be tested as
itself; `persist.rehydrate()` does not restore under jsdom, and a test that
re-implemented the rename would only agree with itself.

**Measured in the live DOM, both themes** (`verify-fix.json -> portLabels`), after
adding Sampler, Instrument, Effect and Speaker to one canvas:

```
instrument: IN, OUT     effect: In, Out     speaker: In     sampler: In, Out
retiredLabelsOnScreen: []          (was: Sampler "Input"/"Audio")
```

The MIDI card still reads its own real names (`ROW 1..3`, `PEDAL`) — untouched, as
intended.

## F3 — the agent's wire contract

`resolvePlanPort` matched names with `===`, so the rename broke every plan an agent
had already learned, including the worked example in its own contract doc.

The alias list is **not a second list**: `src/engine/portVocabulary.ts` is a new
leaf module holding the vocabulary once, and it is read by both

- `graphStore.migrateNodePorts` (what a saved project comes back as), and
- `planAdapter.resolvePlanPort` **and** `planValidator.findPortByName` (what an
  agent may say).

The validator was the half the review's line numbers pointed at and the half that
actually reported `UNKNOWN_PORT`; lowering and validation now share one predicate,
so they cannot disagree about what a name means.

**One deliberate asymmetry, documented in the module:** `Audio` is accepted by the
migration and REFUSED on the agent path. A plan endpoint carries a `ref` and a port
name and no direction, so `Audio` would match a node's input and its output equally
and `find()` would take whichever the registry lists first — a cable wired backwards
from a name the agent thought was precise. The loader has the direction and can
honour it. The ambiguous set is computed from the map rather than listed, so it
cannot drift.

**A pre-existing doc bug found while pinning this:** the worked example wires a
multiplier's `"Audio In"`, and the multiplier's ports are `In 1` / `In 2` / `Out` —
that port has never existed under any spelling, so the example was already broken
before the rename. `docs/agent-tools.md` is corrected to `In 1`, with a line
teaching the new names, the aliases, and that a port with a name of its own has no
alias. `plan.ts`'s two doc comments follow.

Pinned by a new `describe` in `src/ai/__tests__/plan.test.ts` running the doc's
example against the **real registry** (`createPlanLookups` + `resolvePlanPort`):
current names validate, both retired spellings validate, every spelling lowers to
the *same* real port ids (`audio-out->in-1`, `out->audio-in`), and a typo is still
rejected. The file's local `PORTS` fixture — which had been taught the old names
and so kept the suite green through the break — now speaks the shipping vocabulary,
with a comment saying why a drifting fake is worse than no fake.

## F4 — the roll's second tab trap

The velocity lane's 128 lollipops were the trap after the notes were fixed. They
are now `tabIndex={-1}` to a card, and the lane shares the notes' roving index
rather than owning a second one: `moveRovingFocus(delta, row)` moves the same index
and lands focus on whichever ROW the player is on.

`Shift+ArrowDown` drops from a note onto its own velocity handle; `Shift+ArrowUp`
or `Escape` returns. No entry in `pianoRollBindings` pairs Shift with a vertical
arrow, so nothing is shadowed, and the handler `stopPropagation`s because the
surface's raw arrow handler does not test Shift.

**Measured on the shipped starter, both themes** (`verify-fix.json -> roll`):

| | before (review) | after |
|---|---:|---:|
| tab stops in the roll | **139** | **11** |
| `.piano-roll__lollipop` tabbable | 128 | **0** |
| `.piano-roll-note` tabbable | 1 | 1 |
| `Tab` presses to leave the roll | **>40** | **1** |

`Shift+ArrowDown` from the tabbable note lands on `piano-roll__lollipop`;
`Shift+ArrowUp` returns to `piano-roll-note`. Identical in both themes. Four unit
tests in `PianoRoll.test.tsx` cover the note half; the lane half is measured in the
browser above.

## F5 — the swatch across a theme swap

Resolved **lazily** — on `pointerdown`/`focus` of the `<input type="color">` —
instead of eagerly in an effect keyed on `[track, tint]`, neither of which changes
when the theme does. Lazy is the root fix rather than another dependency: "correct
when the dialog opens" is the actual requirement, and no dependency list can be
wrong about that. It also removes a `getComputedStyle` and a canvas allocation from
every lane's mount.

**Measured, toggling through the app's own theme control** (`verify-f5f6.json`):

| | lane computes | swatch value | matches |
|---|---|---|---|
| before the swap | `oklch(0.72 0.15 80)` = `#d59800` | `#d59800` | yes |
| after the swap | `oklch(0.78 0.15 80)` = `#e9ab2b` | `#e9ab2b` | **yes** |

That second row is the review's failing case.

## F6 — the cascade, and a root cause underneath it (also closes HA-17)

Four changes in `src/utils/spawnPlacement.ts` + `useCommandSources.ts`:

1. **Rectangles, not points.** Occupancy was "another node's ORIGIN within 14px",
   so a 380px Library and a 90px Multiplier counted the same. Now real box overlap,
   using each existing card's **measured** size where it is on screen.
2. **The wish centres the card.** `viewportCenter()` returned the viewport centre
   unadjusted and `addNode` takes a top-left, so a tall card hung off the bottom
   before any cascade ran. It now subtracts half the card.
3. **Wrap into the viewport, not clamp or reject.** A cascade only steps
   down-right; clamping saturates every candidate onto one edge and never looks at
   the space ABOVE the wish, which is usually where the room is.
4. **Laps walk a grid.** Lap offset was x-only, so every candidate the rule would
   ever consider sat in a 196px band — barely one card tall.

The fallback now returns the **most visible** uncovered spot rather than the first,
because on a full canvas "two thirds on screen" beats "just past the fold", and
both beat "on top of the player's work".

**Measured, three palette adds onto a canvas that already holds the beat rig:**

| | before this round | after |
|---|---:|---:|
| added cards overlapping each other | **3** | **0** |
| distinct positions | yes | yes |
| cards fully inside the viewport | 1 of 3 | 1 of 3 |
| visible fraction of the other two | — | **58% and 44%** |

**The residual has a different root cause, and I measured it rather than papering
over it: the registry's `dimensions` are stale.** At zoom 1.0 on the shipping
build, a Looper declares `height: 120` and renders **267**; a Sampler declares
`140` and renders **378**. Those numbers date from the fixed-height cards the New
DNA faceplates replaced and nothing re-declared them when the bodies became
content-driven — so a containment test that trusts them passes a card that then
hangs off the screen. The spawn path now measures the surface instead (a card of
the same type if one is mounted, else the tallest card that is), which is exact
when knowable and honest when not.

With that in place the algorithm is behaving correctly: on a 1440x900 viewport
whose middle is spanned by a 564x294 rig, there is **no** free rectangle for a
~380px faceplate at all, so it returns the most visible clear spot. **Re-declaring
all fourteen faceplates' real dimensions is the actual repair and it is not this
lane's** — filed, with the two measurements above as the evidence.

Six unit tests pin the rule, including "measures overlap by the CARD, not by a
point radius", "never places a card where it would leave the visible canvas", and
a 12-add run asserting no placement ever covers a sibling.

## F7 — the type floor, all 115 sheets

`SHEETS` is now the same recursive walker `reducedMotionContract.test.ts` uses:
**8 sheets -> 115**, 16 tests -> 345.

That turned up the 39 the review predicted. Rather than change 25 unmeasured files
at the end of a fix round, they are **enumerated in two explicit lists**, each entry
individually reasoned:

- **`NOT_TEXT` (13 entries)** — runs the floor is not about, e.g. a 48px back-arrow
  glyph in `NodeCanvas.css`, a 26px device emoji, the legends printed on the
  *depictions* of hardware in `MiniLab3Visual.css` and `KeyboardVisualNode.css`,
  `HintBubble`'s 13.5px (above the floor, merely off the scale), CommandBar's two
  relative `em` sizes inside markdown output, the transport pill's 9px `space`
  keycap, and `Field`'s 12px label — DESIGN.md's own documented exception.
- **`KNOWN_FLOOR_DEBT` (24 files, ~35 selectors)** — real breaks, named as debt
  rather than waived: `CommandBar`'s footer/hint/ask/chip/slash rows,
  `MIDIDeviceBrowser`'s section headings and footer, `Guide`'s latency label,
  `ExportDialog`, `PluginsPanel`, `KeybindingsPanel`, `Collab`, `Clips`,
  `AppErrorBoundary`, `BundlePortGroup`, `LooperNode`, `PortPanelNode`, and six
  oj-ui parts.

**The list cannot rot.** A third test fails if a listed selector is no longer an
offender ("fixed or renamed — remove from `KNOWN_FLOOR_DEBT`"), and any *new*
offender in any of the 115 sheets fails outright. The debt is frozen at exactly its
current size and visible in one place, which is what the review asked for as the
alternative to landing it.

## F8 — the migration is direction-aware

`RETIRED_PORT_NAMES` was keyed on name alone, so a saved `{ id: 'audio-in', name: 'Audio' }`
migrated to **`Out`**. The map now lives in `engine/portVocabulary.ts` keyed by
`(direction, name)` — and the shape the review said "exists in the tree" is exactly
the one `nodeInternals` produces, so this was a live bug, not a tidiness point.
Pinned by "reads `Audio` by DIRECTION, not by name alone" and "leaves a port the
PLAYER named alone".

## F10 — the design-sync docs

- `.design-sync/conventions.md:32` — `--universal-port` -> `--universal-connection`
  in the wiring token list.
- `.design-sync/NOTES.md:77` — the "rainbow-until-typed gradient, not solid violet"
  note is **inverted**, not patched: the flat violet is what ships, the gradient is
  retired, there is one token, and the dormant one it described as "defined but
  consumed by no component" was deleted for exactly that reason.

## F11 — the three unpinned Z4 sites

The first report's "grows by zero on EACH path" was broader than its coverage.
Three tests added to `environmentWritesOffHistory.test.tsx`, one per gap:
`MicrophoneNode` (device-gone recovery under a mocked `mediaDevices`),
`MiniLab3Node` (the child device fan-out, written straight into the map so the
effect is not a no-op), and `MIDIIntegration` (a controller reappearing on the bus
re-arming an existing card). 7 tests in that file now; the sentence is true.

---

## Still not verified, after this round

- **Anything a performer hears.** Unchanged: no audio device. FINAL-REVIEW §7's
  founder checklist is owed in full.
- **Visual baselines.** F1/F2/F4/F5 and the F6 placement change all move pixels, on
  top of the first round's type and mark changes. **The 18 baselines must be
  re-captured before merge and the diff looked at, not accepted.** W6-BASE owns them.
- **The 39-site type-floor debt** is enumerated and frozen, not fixed.
- **The registry's stale `dimensions`** are measured and reported, not corrected.
- **The Rust lane's wasm rebuild** — one red test that is theirs, and `cargo test` /
  `cargo clippy` were not run by this lane either.
