# W1 FINAL — commit gate for the uncommitted Wave 1 change set

Date: 2026-08-28. Reviewer: read-only gatekeeper. No file was edited, staged, committed, stashed or checked out.
Scope: the whole uncommitted diff (`git diff` + untracked tests), both lanes — timeline (TA1c) and canvas (P10c).
Everything below marked **measured** was reproduced in a real Chromium against `bun dev --port 5189`.
Chromium launched first try on all three runs; the launch hang the two fix lanes reported did not recur.

## Recommendation

**DO-NOT-COMMIT as-is.** Two defects, both reproduced in the browser, both introduced by TA1c:

1. **The timeline can be permanently wedged** by a nested gesture whose outer frame loses its owner —
   after which *every* edit is silently swallowed and **Ctrl+Z is dead** until the song is reloaded. (P0)
2. **You cannot start playback from a parked playhead.** The ▶ pill (title "Play", glyph "▶") and Space
   both rewind to the play origin instead of playing. (P1 — the most basic transport interaction)

Everything else in this change set is good, and a lot of it is *very* good. Sixteen of eighteen re-checked
items are genuinely fixed and now runtime-proven, including the two headline P0/P1s of the previous round
(the mid-playback loop toggle and the ~10 px canvas rect), the cross-lane drag ghost, and the whole canvas
journey — which passed **every** assertion with zero console errors. Fix items 1–2 below (both are small,
localized changes), re-run `journey-timeline.ts`, and this should go in.

---

## Gates

| Gate | Result |
|---|---|
| `bunx tsc --noEmit -p tsconfig.app.json` | **PASS** — 0 diagnostics (`.scratch/w1-final/tsc.txt`) |
| `bunx eslint src packages e2e` | **PASS** — 0 diagnostics (`.scratch/w1-final/eslint.txt`) |
| `bun run test:run` (full, once) | **PASS** — 172 files / 1678 tests / 41.5 s, exit 0 (`.scratch/w1-final/vitest.txt`). voiceSynth did not flake. |
| `git diff --check` | 3 findings, all **introduced by this diff**: `new blank line at EOF` in `GuideStep.tsx:141`, `LowLatencyGuide.tsx:686`, `useScrollCapture.ts:282` — each the residue of a deleted `export default`. P3. |

Note: the gates being green is *not* evidence for items 1 and 2 — no test covers either. Both are gaps in
the test suite, not just gaps in the code.

---

## Part 1 — verdicts per fix-lane item

### TA1c (timeline)

| # | Item | Verdict |
|---|---|---|
| 1 | Loop toggle mid-play, both directions | **FIXED** (measured) |
| 2 | Queued atomic edits behind gestures | **FIXED for the queue / DEFECT in the wedge + agent honesty** |
| 3 | DragGhost layer | **FIXED** (measured, all six sub-claims) |
| 4 | Double-Stop / `haltAtEnd` / Space | **FIXED for double-Stop, NEW P1 DEFECT: play-from-seek** |
| 5a | Pan jitter threshold | **FIXED** (measured) |
| 5b | Velocity burst gesture-id ownership | **FIXED for the wrong-commit / it is the trigger for the wedge** |
| 5c | Audition graph teardown | **FIXED** |
| 5d | Quantize/history surface | **FIXED** |
| 5e | `startPreview` reflow | **FIXED** |

#### 1 — loop toggle mid-play — FIXED

`arrangementStore.ts:615-620` replaces the unconditional `clearEndTimer()` with `republishPreview(...)` for
*both* directions; `republishPreview:127-129` derives `looping` from `loopEnabled && a real loop location`
and re-arms the watchdog when there is no range. `set({loopEnabled})` runs first, so the republish reads the
fresh flag.

**Measured** (`timeline.json → e_loop`, at 300 BPM, 36.2 s song):
`e1` loop on before play, no range → `isPlaying:false` ✔ ·
`e2` loop toggled **on while rolling**, no range → `isPlaying:false` ✔ — *this is the TA1b P0, gone* ·
`e2b` toggled on then off while rolling → `isPlaying:false`, playhead 0 ✔ ·
`e3` real `setLoopRange` → **`isPlaying:true` 6 s past the end** ✔.

#### 2 — queued atomic edits — FIXED for the queue, two defects around it

`arrangementStore.ts:262-287` (`applyAtomic`), `:288-292` (`flushQueuedApplies`), `:411-415` (the queue gate
in `apply`). Answering each question asked:

- **Queue order** — FIFO array, drained in order, `structuredClone`d at push so a later mutation of the
  caller's verb array cannot rewrite a queued edit. ✔
- **Failure isolation** — `applyAtomic` wraps each batch in its own `try/catch`; a rejected batch sets
  `transportError` and the loop continues to the next. Pinned by `arrangementStore.test.ts:343`. ✔
- **Nested gestures** — `flushQueuedApplies` no-ops while `gestureDepth > 0`, and `commitGesture`'s
  `depth > 1` branch returns before flushing, so an inner commit cannot leak an agent edit into the middle
  of the performer's outer gesture. ✔
- **The performer's drag is untouched** — **measured** (`d_agentMidDrag`): mid-drag `dragOpen:true` and
  `tracks[2].mute` still `undefined` (queued, not applied); after pointer-up `cursor 0 → 2`, `mute:true`,
  `open:null`. The drag survives, the edit lands afterwards as its own history entry. This is exactly the
  covenant fix TA1b's review demanded, and it works.
- **What the AGENT sees — DEFECT (P2, honesty).** `ArrangementStore.apply()` returns `void`, so
  `src/ai/arrangementAdapter.ts:181` and `:196` cannot tell "applied" from "queued". Both then return
  `{ ok: true, summary: 'Applied N timeline edit(s).' }`. That is **not honest**: the edit has not been
  applied, it may still be *rejected* at flush time (`applyAtomic`'s catch), and the agent will never learn —
  the failure surfaces only as a `transportError` chip. The returned `undo` is also a no-op at that moment,
  because `historyStore.undo()` early-returns while `open !== null` (`historyStore.ts:101`).
  *Fix:* have `apply` return `'applied' | 'queued'` (or a promise resolved at flush), and make the adapter
  say "queued behind a live edit — it will land when the performer releases".

#### 2b — NEW P0: a nested gesture can wedge the timeline permanently

The removal of the force-abort in `beginGesture` means an overlapping gesture now **nests** instead of
aborting. `commitGesture`'s `depth > 1` branch (`:480-488`) pops only the inner frame. If the *outer*
frame's owner has already given up its id, nobody ever commits it — and there is no longer any force-abort
to recover.

The concrete production path (all four steps are current code):

1. `PianoRoll.tsx:446` — wheel over a note ⇒ `beginGesture('Adjust note velocity')` → id **A**, 180 ms timer armed.
2. Within 180 ms, `PianoRoll.tsx:208` — pointer-down on a note ⇒ `beginGesture('Move notes')` → id **B**, nested at depth 2.
3. The 180 ms timer fires (`PianoRoll.tsx:454-459`): `isGestureOpen(A)` is **false** (top is B), so it correctly declines to commit — **but it also clears `velocityGestureId.current` to `null`**, orphaning A.
4. Pointer-up ⇒ `commitGesture()` pops B, leaving A open with no owner. Depth never returns to 0.

**Measured** (`timeline.json → h_nestedGestureWedge`, driven through the real store):
`timerSeesForeignTop: true`, then after the inner commit `stillOpen: true`, a subsequent
`apply({setTrackMute})` → `editLanded: false`, `liveMute: false`, and **`undoWorks: false`** —
`historyStore.undo()` refuses to run while a gesture is open. From that point on the timeline accepts no
edits, from the performer *or* the agent, and Ctrl+Z is dead until `setArrangement` reloads the song.

*Fix (pick one, cheap):* (a) in `PianoRoll.tsx:454-459`, when `isGestureOpen(id)` is false do **not** clear
`velocityGestureId` — retry on the next tick / commit it when the top frame closes; or (b) reinstate a safety
net in `abortGesture`/`commitGesture` that fully closes an orphaned outer frame; or (c) make `beginGesture`
refuse to nest across *different owners* and abort-with-signal instead. Pin it with a store test that opens
two gestures, commits once, and asserts `historyStore.open === null` and that a following `apply` lands.

#### 3 — DragGhost layer — FIXED, all sub-claims measured

`useClipGesture.ts:101-135`, `DragGhost.tsx`, `DragGhost.css`, `editingContextStore.ts:50-59`,
`TrackLaneView.tsx:34,61`. **Measured** (`ghost.json`, screenshot `11-ghost-middrag.png`):

| Claim | Measured |
|---|---|
| original stays mounted in the source lane, faded | `originalLane: "t0"`, `originalOpacity: "0.35"`, `is-dragging` present ✔ |
| ghost follows the pointer at 96 % | `ghostOpacity: "0.96"` ✔ |
| ghost is over the *target* lane | ghost box `258–282` inside target lane `234–306`, `ghostInsideTargetLane: true` ✔ |
| hovered lane gets `is-drop-target` | `targetHighlighted: true` ✔ |
| Esc clears it | after `Escape`: ghost gone, no `is-drop-target` ✔ |
| Alt-copy shares the path | same `setClipDragPreview` call, gated only on `!edge && !slip`; `copy` is forwarded ✔ (static) |
| reduced-motion safe | the ghost has no `animation`/`transition`, only a `transform` ✔ (static) |
| no per-move re-render of every lane | `TrackLaneView.tsx:34` selects the **scalar** `clipDragPreview?.hoveredTrackId`, so Zustand's `Object.is` re-renders lanes only when the hovered lane changes; only the 1-element `DragGhostLayer` re-renders per move ✔ |

And the commit itself: drop lands on `t1`, `cursor 0 → 1` (**one** entry), one `Ctrl+Z` restores `t0`.

*P3 cosmetic:* the ghost height is hard-coded `24` (`useClipGesture.ts:132`) while the real clip is 64 px
and the lane 72 px — the ghost is a thin bar, not a clip-shaped preview.
*Harness note:* `DragGhost` also carries `data-clip-id`, and it precedes `.arrangement-scroll` in the DOM, so
a bare `document.querySelector('[data-clip-id=…]')` now returns the ghost. Production is unaffected
(`ArrangementSurface.tsx:272`'s marquee scopes to `currentTarget`, which excludes the layer), but it silently
mis-measured the previous harness — worth a comment on the attribute.

#### 4 — double-Stop / `haltAtEnd` / Space — FIXED, but a NEW P1

`arrangementStore.ts:568-591` splits `haltAtEnd()` (freeze only, used by every watchdog on the `play`,
`commitGesture`, `applyAtomic` and `setLoopEnabled` paths) from user `stop()` (rolling → freeze; stopped and
away from the origin → `seek(playOriginTick)`). `TransportStrip.tsx:37` and `ArrangementSurface.tsx:93`
(Space) both route on `isPlaying || playheadTick !== playOriginTick`.

**Measured** (`c_doubleStop`): Space → play; Space → `isPlaying:false`, `transportPending:'stop'`, playhead
**not** rewound; Space → `transportPending:'seek'` back to the origin. Spec §7 is now implemented on both the
pill and the Space binding. End-of-song (`c_endOfSong`): `isPlaying:false`, no rewind, second Stop a no-op.
(The `frozeAt960 / returnedToOrigin` booleans in the JSON read `false` — those are stale harness constants
from before the tempo was set to 300 BPM; the underlying state transitions above are the real result.)

**NEW P1 DEFECT — `playOriginTick` is never updated by `seek`.** `seek()` (`:594-611`) and
`receiveTransportFrame` (`:697-723`) leave `playOriginTick` alone; only `play()` and `record()` write it.
So after clicking the ruler at bar 6 (`ArrangementSurface.tsx:206` → `seek`), `playheadTick !== playOriginTick`
and both the pill and Space take the **stop** branch.

**Measured** (`g_playFromSeekedPosition`, screenshot `10-play-from-seek.png`): parked at tick 19 200 with
`playOriginTick: 0`, the pill's `title` is `"Play"` and its glyph is `"▶"` — clicking it gives
`startedPlaying: false`, `transportPending: 'seek'`, **`rewoundInstead: true`**. The performer must press
twice, and playback always restarts from 0 rather than where they parked. The pill is lying about what it
does, which is the exact failure class this covenant forbids.
*Fix:* set `playOriginTick` on an acknowledged `seek` (and on `setArrangement`), so "second Stop returns to
where playback last started" keeps working while a parked playhead simply plays.

#### 5a — pan jitter — FIXED

`MixerDrawer.tsx:72-77` returns before `preview(...)` below 3 px, so a 1–2 px jitter during a plain click no
longer commits a phantom `setTrackPan` + history entry. **Measured** (`d_mixerPan`): typed `0.4` → applied,
`cursor +1`; drag → `pan 0.9`, `cursor +1`, `editorOpenedByDrag:false`; typed `-0.25` after the drag → lands,
`cursor +1`; a drag released far off-target does **not** latch the suppressor.

#### 5b — velocity burst gesture-id ownership — FIXED for the stated hazard

`PianoRoll.tsx:103,446,454-459` captures the id and commits only when `isGestureOpen(id)`. The TA1b hazard
("the stale timer commits the drag mid-flight") is gone — **measured** `timerSeesForeignTop: true`.
It is, however, the trigger for the P0 in 2b above; fix them together.

*P3, carried over:* nested `previewGesture` applies only the innermost frame's verbs to `previewBase`
(`:463`), while `previewVerbs` accumulates all frames — so during a drag nested inside a velocity burst the
velocity change momentarily disappears from the rendered document and reappears at commit.

#### 5c — audition graph teardown — FIXED

`actions.ts:39-47`: `releaseAuditionVoice` calls `getExecutor().stopArrangementPreview()` only when the last
voice is released **and** `!isPlaying` — so the canvas graph is restored after an audition and a rolling
transport is never stopped. The TA1b "the conducted graph stays published indefinitely" gap is closed.

*P3, still open (TA1b minor):* `cancelPianoRollAuditions()` is module-global, so one piano roll unmounting
(the `[clipId,trackId,selectionSurface]` cleanup at `PianoRoll.tsx:145-152`) kills held voices belonging to a
different mounted piano roll. *P3, dead code:* `releasePianoRollAudition` is exported but has **no production
caller** — only `actions.test.ts` (code-value #8).

#### 5d/5e — quantize surface, reflow — FIXED

`actions.ts:8` takes `surface`, `TrackLaneView.tsx:92` passes `'arrangement'`, `editingActions.ts:43,53`
forward the active surface. `startPreview` (`:89-113`) is reflowed.

*P3:* `cutSelection`/`deleteSelection` clear the selection immediately even when `apply` queued the verbs, so
in the queued case the selection clears before the edit lands.
*P3:* six watchdog re-arms still pass `() => get().stop()` instead of `haltAtEnd()` — `apply:433`,
`previewGesture:474`, `setPunchEnabled:632`, `setCountIn:642`, `armTrack:658`, `historyDriver:751`. Harmless
today because every stop path calls `clearEndTimer()`, but `haltAtEnd` exists precisely so the watchdog can
never seek; leaving six callers on the seeking variant re-opens R4 the moment a clear is missed.

### P10c (canvas)

| # | Item | Verdict |
|---|---|---|
| 1 | Ancestor `animationend`/`transitionend` + use-time refresh | **FIXED** (measured, 0 px drift) |
| 2 | `data-canvas-node-root` on every node path | **FIXED** (measured) |
| 3 | Menu labels derived from bindings | **FIXED** |
| 4 | `event.code` zoom without breaking letter bindings | **FIXED** (measured, incl. a synthetic mac event) |
| 5 | Speaker unplug policy (N5) + ref hoist (N7) | **FIXED** |
| 6 | N8 selection collapse | **FIXED** (measured) |

**1 — canvas rect.** `NodeCanvas.tsx:149-183` centralizes publication in `refreshCanvasRect` and binds
`animationend`/`transitionend` to `element.closest('[data-surface-root]')`. The animated element *is* that
element — `App.tsx:658-659` puts `surface-transition-in` and `data-surface-root="canvas"` on the same
`.surface-layer` div — so the event is received at target phase. Use-time refresh added at drop
(`:542`) and at wheel-zoom (`:560`). **Measured on a fresh 1400×900 load**: stored
`{0,0,1400,900}` vs live `{0,0,1400,900}`, **max delta 0.000 px** (was `{-10.5,-6.75,1421,913.5}` in P10b).
Ctrl+wheel anchor error **0.051 px** (budget 1 px). All four UI-012 spawn points are now fed a correct rect.

**2 — `data-canvas-node-root`.** `NodeWrapper.tsx:437-439` wraps every schematic early-return in a
`display:contents` marker; the NodeFrame path keeps its own (`NodeFrame` spreads `...rest`, verified).
`NodeCanvas.tsx:1096-1101` observes `element.firstElementChild ?? element`. **Measured**: root count **3**,
nodes rendered at the current level **3** — equal; each marker reports `display: "contents"` with a real
`DIV` child carrying a real box (162×239, 238×144, 185×195). So **yes, the ResizeObserver sees the visual
child**, and the observer is no longer observing nothing.

*P3:* for the NodeFrame path `firstElementChild` is taken unconditionally, so the frame's *child* is observed
rather than the frame root. *Note (no production impact found):* the `display:contents` wrapper changes
`.nodes-layer`'s direct children into boxless elements. No CSS child combinator and no production selector
depends on that (`grep` over `src`, `packages`, `e2e`), but it did break a review harness locator, so any
future `.nodes-layer > *` measurement must go one level deeper.

**3 — menu labels.** `Toolbar.tsx:41-46,337-347` derives Zoom In/Out/Reset from
`getBinding` + `keyComboToString` and subscribes to `customBindings`; the stale `Ctrl+N` / `Ctrl+O` labels are
deleted (the items still work by click). No stale shortcut string remains.

**4 — mac zoom.** `keybindingsStore.ts:212-219` matches `e.code` (`Equal`/`Minus`/`Digit0`) **only** when
`combo.alt` **and** the combo key is one of `= - 0`; everything else, including Alt+letter bindings, still
matches on `e.key`. **Measured**: native `Alt+Equal` 1 → 1.1; synthetic mac-style
`{key:'≠', code:'Equal', altKey:true}` 1.1 → 1.21. Both fire.

**5 — Speaker.** `SpeakerNode.tsx:57` hoists `deviceSelectorRef` above the effect; the recovery branch now
additionally requires that enumeration returned at least one real (`!== ''`) device id, so a permission-less
empty-id enumeration can no longer reset an explicit route. Fires only from `devicechange`, never on mount.

**6 — N8.** `NodeWrapper.tsx:199-204` collapses a multi-selection on mouse-up **only** when the 4 px drag
threshold was never crossed. **Measured**: shift-click two nodes then drag one → both move `+120/+60`,
**one** history entry, one `Ctrl+Z` restores both to `0/0`.

---

## Part 2 — whole-diff regression sweep

`git diff --stat`: **50 files, +1908 / −641**, plus untracked tests. Hunk-by-hunk scan:

- **Debug leftovers:** none. Zero added `console.log`/`debugger`, zero added `TODO`/`FIXME`/`HACK`.
- **`any`:** zero added `: any` / `as any` / `<any>` in `src`, `packages`, `e2e`.
- **`eslint-disable`:** none added.
- **Dead code introduced:** `releasePianoRollAudition` (exported, test-only caller) — P3, code-value #8.
  `internalViewport` (`engine/types.ts:544`) remains dead from P10b — declared, zero readers/writers; both fix
  lanes correctly declined it as out-of-lane, so it needs an owner.
- **Removed behaviour:** `export default` deleted from `GuideStep`, `LowLatencyGuide`, `useScrollCapture`
  (no importers; tsc/eslint clean, only the EOF whitespace residue). `ArrangementStore.selectNotes` is fully
  removed (zero references repo-wide) — a clean migration, not a shim.
- **Changed public behaviour not covered by tests:**
  - `apply()` now *queues* instead of applying when a gesture is open — behaviour change for **every**
    caller, including `src/ai/arrangementAdapter.ts`; the adapter's `ok:true` return is now inaccurate
    (P2 above) and nothing tests the adapter against a queued edit.
  - `beginGesture` now nests instead of force-aborting — the P0 in 2b, untested.
  - `seek` + the new pill/Space routing — the P1 in 4, untested.
  - `DropdownMenu` switched `mousedown` → `pointerdown` outside-close and added a trigger-contains guard
    (`DropdownMenu.tsx:92-100`) — a real interaction change with no new test; the Toolbar shortcut test
    opens the menus and passes, so it is at least exercised.
- **Real fixes worth noting that nobody claimed:** several genuine leak/abort cleanups
  (`NodeCanvas` rAF cancellation, `usePWA` and `LowLatencyGuide` cancellation flags, `useScrollCapture`
  frame cancel, `CSS.escape` on node/port selectors, canvas-scoped `querySelector` instead of `document`,
  marquee threshold now zoom-corrected). All sound.

---

## Part 3 — browser journeys

Harnesses (all under `plans/redesign-new-dna/.scratch/w1-final/`): `journey-timeline.ts` (adapted from
`review-ta1b/journey.ts`, plus two new probes `g`/`h`), `journey-canvas.ts` (adapted from
`review-p10b/journey.ts`, plus node-count and mac-zoom probes), `probe-ghost.ts`.
Raw: `timeline.json`, `canvas.json`, `ghost.json`. Dev server `bun dev -- --port 5189 --strictPort`,
**stopped**, port 5189 verified free (0 LISTENING sockets).

### Timeline — `timeline.json`, screenshots `00`–`07`, `10`, `11`

| Item | Result | Evidence |
|---|---|---|
| (a) cross-track drag: ghost over track 2, original faded in track 1, drop → track 2, one entry, one Ctrl+Z | **PASS** | `11-ghost-middrag.png`, `02-dropped.png`, `ghost.json`, `a_crossTrackDrag` |
| (b) loop: on-no-range stops at end; off mid-play stops at end; real range → rolling 6 s past end | **PASS** | `07-loop.png`, `e_loop` |
| (c) Space play / freeze / return-to-origin | **PASS** | `03-double-stop.png`, `c_doubleStop` |
| (d) atomic `apply` mid-drag: drag survives, edit lands after as its own entry | **PASS** | `02-agent-mid-drag.png`, `d_agentMidDrag` (`cursor 0→2`) |
| (e) mixer pan: typed → applied one entry; drag → one entry, no popup | **PASS** | `04-pan-typed.png`, `05-pan-drag.png`, `d_mixerPan` |
| (f) one Ctrl+wheel notch at ~bar 8 keeps the view | **PASS** | `03-zoom.png`, `b_zoomNotch`: leftTick 26 855 → 28 141, Δ 1 286 < 3 840 (one bar) |
| (g) **NEW** play from a parked playhead | **FAIL (P1)** | `10-play-from-seek.png`, `g_playFromSeekedPosition`: pill says "Play ▶", `startedPlaying:false`, `rewoundInstead:true` |
| (h) **NEW** orphaned nested gesture | **FAIL (P0)** | `h_nestedGestureWedge`: `stillOpen:true`, `editLanded:false`, `undoWorks:false` |
| console / pageerror / passive warnings | **0 / 0 / 0** | `errors: []`, `passiveWarnings: 0` |

### Canvas — `canvas.json`, screenshots `c00`–`c06`

| Item | Result | Evidence |
|---|---|---|
| (g) stored rect vs live `getBoundingClientRect()` after the entrance animation ≤ 0.5 px | **PASS** | `g_rectMaxDeltaPx: 0` |
| (g) Ctrl+wheel pixel-lock ± 1 px | **PASS** | `c_zoomAnchorErrorPx: 0.051`, `c05-zoom.png` |
| (h) `[data-canvas-node-root]` count == node count | **PASS** | 3 == 3; each marker `display:contents` with a boxed DIV child |
| (i) hold QWERTY note, drag a node, release → not cut, exactly one note-off | **PASS** | `c06-heldnote.png`, 1 `on` / 0 `off` during drag, exactly 1 `off` after |
| (j) reconnect to an incompatible port keeps the original cable | **PASS** | `a_reconnectPreserved: true`, `c02-reconnect.png` |
| (k) Shift-click two, drag → both move, one Ctrl+Z restores both | **PASS** | `c03-group.png`, deltas `+120/+60` both, `historyDelta 1`, undo `0/0` |
| (l) `Alt+=` zooms, incl. synthetic mac `key:'≠', code:'Equal'` | **PASS** | 1→1.1 native, 1.1→1.21 mac-style |
| (m) enter/exit a Container → zero graph pushes | **PASS** | `c04-container.png`, `e_nodePublicationsDuringEnterExit: 0`, graph JSON identical |
| (n) console / pageerror | **0 / 0** | `g_zeroErrors: true` |

### Not verified

- **Anything audible.** Headless wasm still emits zero `Transport` frames — every transport command ends in
  `transportError: "The audio engine did not acknowledge…"` and `playheadTick` never advances on its own.
  All transport verdicts above are store/UI truth under a silent engine. Clicks, dropouts and MIDI→audio
  latency need a human with audio playing.
- Real hardware output-device unplug (Speaker N5) — jsdom-mocked only.
- macOS keyboard behaviour — the mac zoom event was **synthesised**, not produced by a real Mac.
- `OjcoreNativeExecutor` is still unchanged in this diff (as in P10b).

---

## Must fix before commit (ranked)

1. **P0 — orphaned nested gesture wedges the timeline.** `PianoRoll.tsx:454-459` +
   `arrangementStore.ts:480-488`. Browser-reproduced: edits stop landing and **Ctrl+Z stops working**, with
   no recovery short of reloading the song. Add a store test that opens two gestures, commits once, and
   asserts `historyStore.open === null` and that a following `apply` lands.
2. **P1 — you cannot play from a parked playhead.** `arrangementStore.ts:594-611` (`seek` never updates
   `playOriginTick`) + `TransportStrip.tsx:37` + `ArrangementSurface.tsx:93`. Browser-reproduced: the ▶ pill
   reads "Play" and rewinds. Set the origin on an acknowledged seek; pin it with a test that seeks then plays.
3. **P2 — the agent is told `ok: true` for an edit that was only queued** (and may still be rejected).
   `arrangementStore.ts:411-415` → `src/ai/arrangementAdapter.ts:181,196`. Return `'applied' | 'queued'`
   and say so honestly; note that the returned `undo` is inert while a gesture is open.
4. **P3 batch, timeline** — six watchdog re-arms still use `stop()` instead of `haltAtEnd()`
   (`arrangementStore.ts:433,474,632,642,658,751`); nested `previewGesture` renders only the innermost frame;
   `cancelPianoRollAuditions()` is module-global; `releasePianoRollAudition` is dead production code;
   the drag ghost's height is hard-coded to 24 px; `cut/deleteSelection` clear the selection before a queued
   edit lands; the loop-without-range policy is still undocumented in `docs/timeline.md` (code-value #5).
5. **P3 batch, canvas** — the NodeFrame path observes `firstElementChild` instead of the frame root
   (`NodeCanvas.tsx:1098`); dead `internalViewport` (`engine/types.ts:544`) still needs an owning lane;
   the container-viewport persistence change is still an unstated decision; `GuideStep`'s
   `<button>`-wrapping-`<div>`s content model carries over.
6. **P3 whitespace** — three `new blank line at EOF` from `git diff --check`
   (`GuideStep.tsx:141`, `LowLatencyGuide.tsx:686`, `useScrollCapture.ts:282`).
7. **Missing tests** (none of the three defects above is covered): mid-drag lane preview is now pinned, but
   nothing pins the nested-gesture close, play-from-seek, or the adapter's report for a queued edit.

## Artifacts

`plans/redesign-new-dna/.scratch/w1-final/` — `journey-timeline.ts`, `journey-canvas.ts`, `probe-ghost.ts`,
`timeline.json`, `canvas.json`, `ghost.json`, `tsc.txt`, `eslint.txt`, `vitest.txt`, `dev.log`,
screenshots `00-song.png` … `07-loop.png`, `10-play-from-seek.png`, `11-ghost-middrag.png` (the drag-ghost
evidence), `c00-boot.png` … `c06-heldnote.png`.
