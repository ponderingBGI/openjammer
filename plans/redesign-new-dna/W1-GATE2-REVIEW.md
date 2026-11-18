# W1 GATE 2 — commit gate for the uncommitted timeline/agent change set

Date: 2026-08-28. Reviewer: read-only gatekeeper. Nothing was edited, staged, committed, stashed or checked out.
Scope: the whole uncommitted tree (23 modified + 6 untracked source/test files, +1069 / −182). The canvas lane
is already committed, so everything here is TA1c + TA1d combined.
Everything marked **measured** was reproduced in a real Chromium against `bun dev -- --port 5191 --strictPort`.
Chromium launched first try on all four runs; the hang the TA1d fix lane reported did not recur.

## Recommendation

**DO-NOT-COMMIT as-is.** All three TA1d must-fix items are genuinely fixed and now runtime-proven — the
transport work in particular is excellent. But the browser journey turned up **one new P0 that this diff
introduced**: `onLostPointerCapture → finish(false)`, newly added to `useClipGesture`, **aborts a clip drag
mid-flight** on any medium-to-long move. The clip snaps back to where it started, nothing enters the command
log, and there is no error anywhere — the most common gesture on the timeline silently discards the
performer's work. It is a two-line fix. Fix item 1, re-run `probe5.ts`, and this should go in.

---

## Gates

| Gate | Result |
|---|---|
| `bunx tsc --noEmit -p tsconfig.app.json` | **PASS** — 0 diagnostics (`.scratch/w1-gate2/tsc.txt`) |
| `bunx eslint src packages e2e` | **PASS** — 0 diagnostics (`.scratch/w1-gate2/eslint.txt`) |
| `bun run test:run` (full, once) | **PASS** — 172 files / 1684 tests / 39.5 s, exit 0 (`.scratch/w1-gate2/vitest.txt`). voiceSynth did not flake. |
| `git diff --check` | **CLEAN** — 0 findings on the uncommitted tree. |

The previous gate's three `new blank line at EOF` findings are **not in this change set** — they were in the
canvas lane and are already committed (`src/hooks/useScrollCapture.ts:282`, `src/components/Guides/GuideStep.tsx`,
`src/components/Guides/LowLatencyGuide/LowLatencyGuide.tsx`). Still present in the tree, now out of scope; P3
follow-up for whoever owns the canvas lane.

Note: green gates are again **not** evidence for the P0 below — no test covers a pointer losing capture mid-drag.

---

## Part 1 — the three TA1d items

### (a) Gesture stack — **FIXED**, with two caveats

`arrangementStore.ts:283-303` (watchdog), `:509-523` (`beginGesture` / `isGestureOpen`), `:545-570`
(id-aware `commitGesture`), `PianoRoll.tsx:199-207,221` (`finishVelocityWheelGesture`).

- **Id-aware commit** — `commitGesture(id)` returns early unless `gestureIds.at(-1) === id`, so a stale timer
  can never commit someone else's frame. ✔
- **The burst closes synchronously before a note pointer gesture** — `startNoteDrag` (`PianoRoll.tsx:221`)
  calls `finishVelocityWheelGesture()` *before* `beginGesture`, clearing the 180 ms timer and committing that
  exact id. The nesting that caused the previous P0 is gone at the source. ✔ (**measured**, store path:
  `probe*/A` store mirror — burst and drag become two entries with an empty stack and two working undos;
  also pinned by `arrangementStore.test.ts:328-344`.)
- **Watchdog** — `armGestureWatchdog` fires at 5 s: no-op at depth 0, **defers and re-arms while
  `activePointers.size > 0`**, otherwise logs and closes every frame.

**Can the watchdog close a legitimate long gesture? No — for every pointer-driven gesture.** "Pointer owned"
is tracked by three *capture-phase window* listeners registered at module scope
(`arrangementStore.ts:35-40`) that add on `pointerdown` and delete on `pointerup`/`pointercancel`. Every
`beginGesture` caller in the arrangement store is pointer-initiated — `useClipGesture.ts:203`,
`MixerDrawer.tsx:21,51,69`, `AutomationLaneView.tsx:87,109`, `PianoRoll.tsx:221,571` — so while the button is
held the id is in the set and the watchdog defers indefinitely.

**Measured** (`probe4.json → case2_holdThenMove`): clip pointer-down, move +60 px (preview lands, tick
0 → 26 880), **pointer held perfectly still for 7.9 s**, then move again → preview keeps working (tick →
57 600), release → **committed, one history entry**. `aliveAfter7s: true`, and the instrumented pointer log
shows no stray `pointercancel`/`lostpointercapture` during the hold. A slow drag, a held fader and a long
marquee are all safe. Screenshots `p3-02-held-7s.png`, `p3-03-held-committed.png`.

*Caveat 1 (P2, new): the one gesture that is **not** pointer-owned is the velocity wheel burst.* No
`pointerdown` accompanies a wheel, and `previewGesture` does not re-arm the watchdog — only `beginGesture`
does. So a velocity ramp wheeled continuously for over 5 s gets cut by the watchdog, and because
`velocityWheelBase.current` is still set the code does **not** re-open a gesture: every further notch calls
`previewGesture` with `previewBase === null` and is **silently dropped** until the performer pauses 180 ms.
**Measured** (`journey.json → b2_wheelBurstOver5s`): `watchdogCutTheBurst: true`,
`subsequentNotchSwallowed: true` (the pan stayed at the pre-watchdog 0.11). It self-heals, but for a second
or two the velocity edit stops responding under the performer's hand.

*Caveat 2 (P3): `while (gestureDepth > 0) get().commitGesture();` (`:302`) is unbounded and its termination
depends on an invariant nothing enforces.* `beginGesture` increments `gestureDepth` even when
`get().arrangement` is `null` (`previewBase` then stays `null`), and `commitGesture()` returns at
`if (!previewBase) return;` without decrementing — that state spins the main thread forever. Not reachable
from today's UI (every gesture surface unmounts without a song), but it is a tab-hang one refactor away.
Bound the loop.

### (b) Transport — **FIXED**, one narrow race left

`arrangementStore.ts:622-690`. `play()` sets `playOriginTick = playheadTick`; `seek()` sets
`playOriginTick = clamped` and clears `returnToOriginArmed`; user `stop()` arms it; `haltAtEnd()` explicitly
does not. `TransportStrip.tsx:36-38` and `ArrangementSurface.tsx:93` both route **solely on `isPlaying`** —
both lines are byte-identical to `HEAD`, i.e. TA1c's `isPlaying || playheadTick !== playOriginTick` routing
that caused the previous P1 was correctly reverted rather than patched.

**Measured** (`probe2.json`):

| Case | Result |
|---|---|
| seek to bar 5 (tick 15 360), ack, pill reads "Play ▶" → Space | **`isPlaying: true`, `playOriginTick: 15360`, `playheadTick: 15360`** ✔ the previous P1 is gone (`p2-03-play-from-bar5.png`) |
| play → stop → stop | stop 1 freezes at 2 400 without rewinding; stop 2 → `transportPending:'seek'`, `pendingSeekSample: 0` ✔ |
| play → stop → seek(7 680) → Space | plays from **7 680**, not the origin ✔ |
| `haltAtEnd()` then Stop | no seek issued — the end halt does not arm the rewind ✔ |
| loop | `startPreview`/`republishPreview` arm the end watchdog only `if (!looping)`; loop-on-without-range still stops honestly at the end, a real range keeps rolling (`journey.json → e2_loopToggle`, `08-loop.png`) ✔ |
| record | `record()` sets `playOriginTick = startTick`; agent `seek` goes through the same store `seek` ✔ |

*P2 (new, narrow): `play()` reads `get().playheadTick` and ignores an in-flight seek.* Because `play()` then
writes `playOriginTick = playheadTick`, seeking and immediately pressing Space **overwrites the seek and
plays from the old position**. **Measured** (`probe2.json → C5_seekPlayRace`): `seek(23040)` set
`playOriginTick: 23040`; `play()` in the same tick reset it to `0` and started from tick 0
(`originLostToStalePlayhead: true`). In the browser tier the ack lands within an audio block so the window is
small, but if the engine is slow or the seek errors, Space silently rewinds — the same failure class as the
P1 just fixed. The codebase already has the idiom: `arrangement.split` uses
`transportPending === 'seek' && pendingSeekSample != null ? sampleToTick(...) : playheadTick`.

### (c) Queued agent edits — **FIXED**, fully measured

`arrangementStore.ts:306-339` (`applyAtomic`/`flushQueuedApplies`), `:461-481` (queue gate),
`arrangementAdapter.ts:181-214`, `tools.ts:243-253,499-513,1195-1210`.

**Measured through the real adapter, mid-drag** (`journey.json → d_agentQueuedEdit`, `06-agent-mid-drag.png`):

| Claim | Measured |
|---|---|
| `{ok:true, queued:true, appliedAfterGesture:true}` | exactly that, summary *"Queued 1 timeline edit(s); they will land when the performer's gesture ends."* ✔ |
| nothing blocks on the performer | `apply` returned synchronously; `dragStillOpen: true`, `muteDuringDrag: null` ✔ |
| the queued edit lands afterwards as its own entry | after pointer-up `mute: true`, cursor +2 (drag + agent edit) ✔ |
| `lastQueuedEditResult` transitions | `{id:1,status:'queued'}` → `{id:1,status:'applied'}`, visible in both the store and `describe_arrangement()` ✔ |
| rejection surfaces honestly | `transportError: 'Timeline edit was rejected: verb: no clip "t0.c0"'` **and** `describe().lastQueuedEditResult.status === 'rejected'` ✔ |
| deferred undo | `requestUndo()` sets `undoRequested` while queued and `flushQueuedApplies` runs `undo()` right after that item's entry is recorded ✔ (static) |
| docs | `docs/agent-tools.md:117`, `docs/timeline.md:37-38,51-53`, `tools.ts:206-211` catalogue all updated; the parity/doc tests pass ✔ |

*P3:* the non-queued `undo` is still `useArrangementStore.getState().undo()` — it undoes the newest entry, not
*this* edit, so a late agent undo can revert a performer edit made since. Pre-existing, unchanged by this diff.

---

## Part 2 — whole-diff sweep

- **Debug leftovers:** none. Zero added `console.*`, `debugger`, `TODO`/`FIXME`/`HACK`/`XXX`.
- **`any`:** zero added `: any` / `as any` / `<any>`. Zero added `eslint-disable` / `@ts-ignore` / `@ts-expect-error`.
- **Removed behaviour:** `ArrangementStore.selectNotes` / `selectedNoteIds` fully removed (zero references
  repo-wide; selection now lives per-surface in `editingContextStore.selectionHistoryBySurface`) — a clean
  migration, no shim (code-value #7). `startPreview`'s catch-all try/catch is removed so publication now
  **fails closed**: `play()` catches, tears the preview down and shows an actionable `transportError`. That is
  a deliberate, documented policy change and the right one, but it is a behaviour change for every caller.
- **Style:** `startPreview` (`arrangementStore.ts:95-121`) is left with the *old* try-block indentation after
  the catch was deleted — 8-space body under a 4-space function. Cosmetic (eslint has no indent rule here), P3.
- **Module-level side effect:** `arrangementStore.ts:35-40` registers three permanent capture-phase window
  listeners at import time. Correct and cheap, never removed; note it as a deliberate global.
- **Real improvements nobody claimed:** transport generation counters + a 1.5 s ack timeout with an honest
  error; `documentGeneration`/`recordSessionGeneration` guards so a capture from a previous song can never be
  applied to the current one; `mintId` now also advances `previewBase` (pinned); `clipBarSpan` replaces a
  hard-coded `/3840`; `ClipView` gets a real `Timebase`; per-voice audition tokens replace the two module
  globals. All sound.
- **Changed public behaviour with no test:** `onLostPointerCapture` on `ClipView` (**the P0 below**); the
  `useClipGesture` unmount cleanup now aborts an in-flight drag; the arrangement `Ctrl+wheel` handler moved to
  a non-passive native listener with rAF-coalesced viewport writes.

---

## Part 3 — browser journey

Harnesses under `plans/redesign-new-dna/.scratch/w1-gate2/`: `journey-gate2.ts` (full sweep), then
`probe2.ts` / `probe3.ts` / `probe4.ts` / `probe5.ts` (isolation + instrumented diagnosis; the first full run
was contaminated by a leaked gesture, see finding 2). Raw: `journey.json`, `probe2.json` … `probe5.json`.
Dev server `bun dev -- --port 5191 --strictPort`, **stopped**, port 5191 verified free (0 LISTENING sockets).

| Item | Result | Evidence |
|---|---|---|
| (a) velocity burst → immediate note drag: stack empty, two entries, two Ctrl+Z | **PASS (store path)** / **NOT REACHABLE VIA DOM** | store mirror in `journey.json`/`probe3.json`; see finding 3 |
| (b) clip drag with the pointer held STILL 7 s, then move and release | **PASS** — gesture alive at 7.9 s, preview still tracking, committed, one entry | `probe4.json → case2`, `p3-02/03.png` |
| (c) seek bar 5 → Space plays from bar 5 | **PASS** — `playOriginTick === seekTick === 15360`, `isPlaying` | `probe2.json → C1`, `p2-03-play-from-bar5.png` |
| (c) play → stop → stop → origin | **PASS** | `probe2.json → C2` |
| (c) play → stop → seek → Space plays from the seek point | **PASS** | `probe2.json → C3` |
| (c) seek then Space **before the ack** | **FAIL (P2)** — origin lost, plays from the old tick | `probe2.json → C5` |
| (d) mid-drag agent `apply` → `queued:true`, `lastQueuedEditResult` queued→applied | **PASS** (all 6 sub-claims) | `journey.json → d_agentQueuedEdit`, `06-agent-mid-drag.png` |
| (e) cross-track ghost + one undo | **PASS** — original stays in `t2` at opacity 0.35, ghost 0.96 over `t0`, `is-drop-target` on `t0`, drop → `t0`, one entry, one Ctrl+Z restores | `probe2.json → E1`, `p2-04-ghost.png`, `p2-05-dropped.png` |
| (e) loop toggle mid-play, both directions | **PASS** — stops honestly without a range, rolls past the end with one | `journey.json → e2_loopToggle`, `08-loop.png` |
| (e) mixer pan typed + drag | **PASS** — typed 0.4 one entry, drag → 0.9 one entry, no popup on drag | `journey.json → e3_mixerPan`, `09/10-pan.png` |
| (e) Ctrl+wheel notch stability | **PASS** — leftTick 26 855 → 28 141, Δ 1 286 < 3 840 (one bar), zoom applied | `journey.json → e4_zoomNotch`, `11-zoom.png` |
| **long clip drag (≥ ~300 px)** | **FAIL (P0)** — aborts mid-flight, clip snaps back, nothing committed | `probe5.json → longDrag` |
| console errors / pageerrors / passive warnings | **0 / 0 / 0** across all four runs | `errors: []` in every JSON |

### Finding 1 — **NEW P0: a clip drag aborts itself mid-flight** (introduced by this diff)

**Measured** (`probe5.json → longDrag`), one continuous pointer-down drag of the first clip:

| move | clip tick | gesture |
|---|---|---|
| +60 px | 23 040 | `open: "Move clips"` ✔ |
| +150 px | 90 240 | `open: "Move clips"` ✔ |
| **+300 px** | **0 (snapped back)** | **`open: null`, `gestureOpen: false`** ✘ |
| +500 / +800 / +1100 px | 0 | dead |
| release | 0 | `committed: false`, **zero history entries** |

The pointer was still down and the element was still mounted. The cause is new code:
`useClipGesture.ts:212` `onLostPointerCapture: () => { if (gesture.current) finish(false); }`, plus the new
unmount branch at `:184` `if (gesture.current) finishRef.current(false);`. React replacing or re-parenting the
clip button during the preview fires `lostpointercapture`, which now **aborts** the drag. Before this diff
neither handler existed and the window `pointerup` listener (`:190`, still present) would have called
`finish(true)` and committed the move — so this is a straight regression, not a pre-existing gap. At this
song's default zoom +300 px is roughly an 11-bar move: entirely ordinary arranging.

*Fix:* `lostpointercapture` is not a cancellation. Either drop the handler and let the window
`pointerup`/`pointercancel` pair own the lifecycle (as before), or route it to `finish(true)` when the pointer
is still down. Pin it with a test that fires `lostpointercapture` mid-drag and asserts the drop still lands as
one entry.

### Finding 2 — **P0 (pre-existing, still live): a piano-roll note gesture can leak `open`**

**Measured** (`probe5.json → burstThenDragDom`): a single pointer-down/up on a note in the lane piano roll
left `historyStore.open === "Move notes"` and `isGestureOpen() === true`; a following drag moved the note
(tick 4 320 → 3 840) but pointer-up again did not close it — `entriesAdded: 0`, and **two Ctrl+Z presses did
nothing** (`historyStore.undo()` early-returns while a gesture is open). The note button relies solely on
`onPointerUp={endDrag}` on an element React can replace mid-preview; unlike `ClipView` it has **no** window
`pointerup` fallback and **no** `onLostPointerCapture`. `git show HEAD:src/components/PianoRoll/PianoRoll.tsx`
confirms this teardown is byte-identical before and after the diff — **not a TA1d regression**.

Severity is now bounded rather than permanent: the new watchdog closes the orphan ~5 s after the pointer is
released. **Measured** in run 1 (`journey.json`): a gesture leaked in step (a) wedged every later probe, and
5.6 s later `openAfter: false` with `f_timelineStillAlive` passing again. So the backstop genuinely works —
but the performer still gets up to 5 s where edits do not land and Ctrl+Z is dead, ending in a spurious
force-committed entry. Give the note button the same window-listener lifecycle `useClipGesture` has.

### Finding 3 — piano-roll notes are largely not hit-testable (blocks the (a) DOM path)

**Measured** (`probe5.json → pianoRollHit`): of 128 rendered `.piano-roll-note` elements only **60** return
themselves from `document.elementFromPoint` at their own centre. The piano roll's box is
`y 162 … 382`, yet notes are painted at `y 434`, `y 488` — outside it, where `.arrangement-lane` and
`.arrangement-clip__canvas` sit on top. `pointer-events: auto`, so it is stacking/overflow, not CSS. This is
why the DOM route for item (a) could not be exercised; item (a) rests on the store-level proof plus
`arrangementStore.test.ts:328-344`. Out of the timeline lane's scope but it needs an owner — half the notes in
the lane piano roll cannot be clicked.

### Not verified

- **Anything audible.** Headless wasm emits no `Transport` frames; every transport command ends in
  `transportError: "The audio engine did not acknowledge…"` and the playhead never advances on its own, so
  all transport verdicts are store/UI truth under a silent engine (acks were injected via
  `receiveTransportFrame`). Clicks, dropouts and MIDI→audio latency still need a human with audio playing.
- Native executor, real device loss, macOS.

---

## Must fix before commit (ranked)

1. **P0 — `onLostPointerCapture` aborts a live clip drag.** `useClipGesture.ts:212` (+ the unmount branch at
   `:184`). Browser-reproduced: a ~300 px drag dies mid-flight, the clip snaps back, no history entry, no
   error. Introduced by this diff; two-line fix; pin it.
2. **P0 (pre-existing, in this lane's own territory) — the piano-roll note gesture leaks `open`.**
   `PianoRoll.tsx:504` (`onPointerUp={endDrag}` with no capture-loss or window fallback). Browser-reproduced:
   edits stop landing and Ctrl+Z is dead until the 5 s watchdog force-commits. Give it `useClipGesture`'s
   lifecycle. Declining it is defensible — the watchdog bounds it — but say so explicitly.
3. **P2 — `play()` ignores an in-flight seek** and overwrites `playOriginTick` with the stale playhead
   (`arrangementStore.ts:622-640`). Reuse the `arrangement.split` idiom.
4. **P2 — a velocity wheel burst held over 5 s is cut by the watchdog and every further notch is silently
   swallowed** until a 180 ms pause. Re-arm the watchdog from `previewGesture`, or clear
   `velocityWheelBase` when the gesture closes so the next notch re-opens one.
5. **P3 batch** — unbounded `while (gestureDepth > 0)` in the watchdog (`:302`); half the lane piano roll's
   notes are not hit-testable (finding 3); `startPreview`'s leftover indentation; the drag ghost's height is
   still hard-coded to 24 px (`useClipGesture.ts:225`, measured `ghostHeight: 24` against a 64 px clip); the
   agent's non-queued `undo` still undoes the newest entry rather than its own; the three committed
   `new blank line at EOF` in the canvas lane.
6. **Missing tests** — nothing pins capture-loss mid-drag, the note-drag lifecycle, the seek→play race, or
   the >5 s wheel burst.

## Artifacts

`plans/redesign-new-dna/.scratch/w1-gate2/` — `journey-gate2.ts`, `probe2.ts`, `probe3.ts`, `probe4.ts`,
`probe5.ts`; `journey.json`, `probe2.json`, `probe3.json`, `probe4.json`, `probe5.json`;
`tsc.txt`, `eslint.txt`, `vitest.txt`, `dev.log`; screenshots `00-song.png`, `01-pianoroll.png`,
`02-burst-then-drag.png`, `03-drag-held-7s.png`, `04-drag-committed.png`, `05-play-from-bar5.png`,
`06-agent-mid-drag.png`, `07-ghost-middrag.png`, `08-loop.png`, `09-pan-typed.png`, `10-pan-drag.png`,
`11-zoom.png`, `p2-01…p2-07`, `p3-01…p3-03`, `p5-burst-drag.png`.
