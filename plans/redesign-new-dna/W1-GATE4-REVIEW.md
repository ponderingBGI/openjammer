# W1 GATE 4 — final commit gate for the uncommitted timeline change set

Date: 2026-08-28. Reviewer: read-only gatekeeper. Nothing was edited, staged, committed, stashed or checked out
in the repo's source tree; the only files written are this report and the gate's own artifacts under
`plans/redesign-new-dna/.scratch/w1-gate4/`. Dev server `bun dev -- --port 5195 --strictPort` started twice and
**stopped both times**; port 5195 verified free (0 LISTENING sockets). One Chromium at a time, all Playwright runs
under `node --experimental-strip-types`.

## Recommendation

**COMMIT.**

The gate-3 P0 is genuinely fixed and independently browser-proven, including the two cases gate 3 could not
reach: a drag whose clip crosses the horizontal tick window, and a drag whose **source lane is virtualized out
vertically mid-gesture**. All three gates are green, the whole-diff sweep is clean, and there are **zero console
errors / pageerrors** across four independent browser runs. No blocker remains in this change set.

One severe defect *was* found in the clip-move path — the preview accumulates instead of recomputing from the
gesture base, so a drag travels ~12× further than the pointer — but it is **statically identical to `HEAD`** and
therefore **pre-existing, not introduced here**. It is finding 1 below and the #1 Wave-3 must-fix. Holding this
commit would not fix it; it would only keep the gate-3 regression (which *this* diff introduced and *this* diff
removes) sitting in the tree.

---

## Gates

| Gate | Result |
|---|---|
| `bunx tsc --noEmit -p tsconfig.app.json` | **PASS** — exit 0, 0 diagnostics (`.scratch/w1-gate4/tsc.txt`) |
| `bunx eslint src packages e2e` | **PASS** — exit 0, 0 diagnostics (`.scratch/w1-gate4/eslint.txt`) |
| `bun run test:run` (full, once) | **PASS** — 173 files / 1691 tests / 40.9 s, exit 0 (`.scratch/w1-gate4/vitest.txt`). voiceSynth did not flake. |
| `git diff --check` | **CLEAN** — exit 0, only informational LF→CRLF notices |

## Whole-diff sweep

23 modified + 12 untracked. Added lines contain **zero** `console.*`, `debugger`, `TODO`/`FIXME`/`HACK`/`XXX`,
zero `: any` / `as any` / `<any>`, zero `eslint-disable` / `@ts-ignore` / `@ts-expect-error` — in both tracked
diffs and untracked files. Gate 3's sweep of the unchanged remainder still holds.

---

## Part 1 — static verification of the TA1f change

| Claim | Verdict |
|---|---|
| `editingContextStore.activeClipDragIds` + `setActiveClipDragIds` | ✔ `editingContextStore.ts:148,158,217`. Plain `string[]`, serializable, defaults `[]`. |
| `useClipGesture` no longer aborts on ClipView unmount | ✔ The unmount effect is now only `mounted.current = false` (`useClipGesture.ts:65-68`). The `finishRef.current(false)` call gate 3 flagged is gone. |
| No setState after unmount | ✔ `finish` guards the only React setter: `if (mounted.current) setDragging(false)` (`:52`). Every other write is a Zustand `getState()` call, safe post-unmount. |
| Records selected + Alt-copy template ids | ✔ `:85` sets `[...g.selectedIds, ...copyTemplates.map(v => v.clip.id)]`, filtered for `undefined`. **Measured**: an Alt-copy drag pins `["t0.c0","clip-3"]` (`probe-g4.json → f_altCopy.mid`). |
| Cleared on finish | ✔ `:54`, on the single `finish()` funnel — so commit, abort, Escape, `pointercancel`, `blur` and surface teardown all clear it. |
| `TrackLaneView` renders active-drag ids regardless of the tick window, **only** while `dragActive` | ✔ `TrackLaneView.tsx:54` — `(dragActive && clip.id !== undefined && activeClipDragIds.includes(clip.id)) \|\| (…tick window…)`. `dragActive` gates it, so normal clips stay virtualized. |
| `pointerGestureLifetime` owned-abort registry + surface-teardown abort | ✔ `pointerGestureLifetime.ts:7-11,20,26`. Registry entry added at `ownPointerGesture`, deleted in the returned disposer. `abortOwnedPointerGestures` iterates a **copy** (`[...set]`), so deleting during iteration is safe. |
| `ArrangementSurface` aborts owned gestures on unmount | ✔ `ArrangementSurface.tsx:162`, before the timer/rAF cleanup. |

### Directed checks the task asked for

**Registry / listener leak — CLEAN, measured, not just reasoned.** The probe wraps
`window.addEventListener`/`removeEventListener` and keeps net counts for `pointermove` / `pointerup` /
`pointercancel` / `blur`. Across **six** consecutive gestures (long drag, vertical-scroll drag, Escape,
`pointercancel`, `blur`, Alt-copy) the counts are **flat**: `{pointermove:0, pointerup:2, pointercancel:1,
blur:1}` after every single one, and `{…:1, :3, :2, :2}` *during* an open gesture — exactly +1 of each while
open, exactly −1 of each on close. **Nothing accumulates** (`probe-g4.json → *.afterListeners`,
`finalListeners`). The `pointerup:2` vs the `baselineListeners` snapshot's `1` is one app listener attached
between the baseline read and the first gesture; it is constant, not per-gesture.

Statically this holds because every terminal path in `useClipGesture` funnels through `finish()`, which calls
`gesture.current?.cleanup?.()` (= the `ownPointerGesture` disposer) *before* nulling `gesture.current`, so the
guard `if (gesture.current)` in the registered `abort` can never skip a live disposer. The four PianoRoll
surfaces have the same shape (`PianoRoll.tsx:236,367,379,631`) and their unmount effect calls each `cleanup()`.

**StrictMode double-mount of the surface — SAFE.** `main.tsx:42` wraps the app in `StrictMode`, so
`ArrangementSurface`'s `useEffect(() => () => { abortOwnedPointerGestures(); … }, [])` does mount → cleanup →
mount synchronously at first commit. The registry is empty at that moment (no pointer has gone down), so the
extra cleanup aborts nothing, and nothing re-registers a stale handler. `useClipGesture`'s `mounted` ref is set
in the effect **body** (`:66`) rather than at `useRef(true)` alone, so the StrictMode cleanup that sets it
`false` is immediately corrected back to `true` — that detail is load-bearing and it is right.
`ArrangementSurface` is also rendered **unconditionally** in `App.tsx:668` (hidden via `visible`/`inert`, never
unmounted on surface switch), so surface teardown is effectively app teardown today.

**Source lane virtualized out *vertically* mid-drag — the drag SURVIVES. Measured.** `activeClipDragIds` only
widens the *horizontal* filter; the vertical window (`ArrangementSurface.tsx` `arrangement.tracks.slice(firstLane,
lastLane)`) still unmounts the whole `TrackLaneView`. With lanes grown to 480 px and the lane stack wheeled down
1400 px mid-drag, lane `t0` was **fully unmounted** (`lanesRendered: ["t1","t2"]`, `clipMounted: false`) and the
gesture stayed open, kept previewing (tick 38 400 → 155 520 while evicted), and committed **one** entry at the
final preview on the source track, undone by **one** Ctrl+Z (`probe-g4.json → b_verticalScrollMidDrag`,
`g4-b-01-scrolled-mid-drag.png`). This works because removing the unmount-abort — not because of
`activeClipDragIds`. The residual cost is cosmetic: while the lane is evicted the only feedback is the drag
ghost, and that ghost is still the hard-coded 24 px bar over a 480 px lane (very visible in the screenshot).
Wave-3 polish, not a blocker.

**`activeClipDragIds` cleared on Escape / `pointercancel` / `blur` — all three measured `[]`**, with exact tick
restore, `dragActive:false`, `clipDragPreview:null`, gesture closed, **zero** history entries, and no commit on
the subsequent physical pointer release (`probe-g4.json → c_escapeMidDrag`, `d_pointerCancel`, `e_windowBlur`).

---

## Part 2 — browser journeys (independent; the lane's JSON was not taken on trust)

Four separate Chromium runs, all on a dev server this gate started and stopped. **0 console errors and 0
pageerrors in every run.**

| Item | Result | Evidence |
|---|---|---|
| **(a)** continuous +60 → +150 → +300 → +450 px drag → one entry, one undo | **PASS** — open at all four stages, ClipView stayed mounted throughout, committed at the exact final preview (748 800), 1 entry, Ctrl+Z → tick 0 | `probe-g4.json → a_longDrag`, `g4-a-01/02.png` |
| **(b)** drag + mid-gesture vertical wheel scroll (source lane leaves the vertical window) → one entry, right place | **PASS** — lane evicted, gesture alive, preview kept moving while evicted, 1 entry at final preview on `t0`, one undo restores | `probe-g4.json → b_verticalScrollMidDrag`, `g4-b-01/02.png` |
| **(c)** Escape mid-drag after crossing the window → exact restore, 0 entries, `activeClipDragIds` empty | **PASS** — all four sub-assertions | `probe-g4.json → c_escapeMidDrag`, `g4-c-01.png` |
| `pointercancel` mid-drag | **PASS** — exact restore, 0 entries, ids cleared | `probe-g4.json → d_pointerCancel` |
| window `blur` mid-drag | **PASS** — exact restore, 0 entries, ids cleared | `probe-g4.json → e_windowBlur` |
| Alt-copy drag across the window | **PASS** — 1 clip created, 1 entry, 1 undo, template id pinned in `activeClipDragIds` | `probe-g4.json → f_altCopy`, `g4-f-01.png` |
| cross-track ghost + drop + undo **on a clean page**, after first crossing the horizontal window | **PASS** — ghost over `t1` at 0.96, original at 0.35 still in `t0`, `is-drop-target` on `t1`, drop → `t1`, 1 entry, one undo → `t0` @ tick 0 | `probe-g4b.json`, `g4-x-01/02.png` |
| **(d)** gate-3 regression set via the lane's own journey harness | **PASS** on every real assertion — see the three explained non-assertions below | `journey.json` |
| **(e)** console / page errors | **0 / 0** across all four runs | `errors: []` in every JSON |

Gate-3 journey highlights, all still green: `a_burstThenDrag` (stack empty, two undos), `b_heldDragSurvives
Watchdog` (7 s, one entry), `b2_wheelBurstOver5s` (`watchdogCutTheBurst`), `c1 playingFromSeek`,
`c2 secondStopReturned`, `c3 playedFromSeekNotOrigin`, `c4 endHaltDidNotArmRewind`, `d_agentQueuedEdit`
(queued→applied, drag survived, two entries), `d_agentQueuedRejection`, `e2_loopToggle`, `e3_mixerPan`
(typed + drag one entry each), `e4_zoomNotch`, `g3d_wheelBurst60` (exact cumulative 90 → 30, `velAtNotch30: 60`,
one entry), `f_timelineStillAlive`.

**Three journey fields read as `false` and are *not* failures:**

- `e3_mixerPan.editorOpenedByDrag: false` — that is the **desired** value; the name is descriptive, not an
  assertion. The pan drag correctly does not open the typed editor (`editorOnClick: true` still passes).
- `c2_doubleStop.frozeNotRewound: false` — the harness hard-codes `firstStop.playheadTick === 960`
  (`journey-gate3.ts:212`). This run parked at **2400** and stopped there without rewinding, which is the
  behaviour under test. Stale literal in the harness, correct product behaviour.
- `e1_crossTrackGhost.ghostOverTarget: false` and `g3a_longClipDrag.landedAtFinalPreview: false` — both are
  artifacts of the monolithic journey running on heavily mutated page state (auto-scroll continues between its
  last sample and release; the earlier stages leave the clip 195 bars out and the viewport scrolled). Both were
  re-run **clean and in isolation** by this gate and **both PASS** (`probe-g4.json → a_longDrag.landedAtFinal
  Preview: true`; `probe-g4b.json → ghostOverTarget: true, droppedOnTarget: true`). TA1f's read on this was
  correct.

`g3b_noteGesture` skipped its two browser sub-cases again: **0 of 156** lane piano-roll notes were hit-testable
this run (gate 3 measured 12/156, gate 2 measured 60/128 — it keeps getting worse). Carried follow-up, unowned.

---

## Finding 1 — P0, **pre-existing (not this diff)**: a clip move accumulates its preview, so the clip travels ~12× the pointer

**Measured on a clean page at default zoom** (`probe-g4c.json`; `pxPerTick` 0.010091 and `scrollLeft` 0 for the
whole gesture, so `dx` is exactly the pointer travel):

| pointer dx | expected tick (dx ÷ pxPerTick) | actual tick | actual bar | amplification |
|---:|---:|---:|---:|---:|
| 20 px | 1 982 | 7 680 | 3 | 3.9× |
| 60 px | 5 946 | 57 600 | 16 | 9.7× |
| 100 px | 9 910 | 105 600 | 28.5 | 10.7× |
| 450 px | 44 593 | **552 960** | **145** | **12.4×** |

**Root cause.** `useClipGesture.ts:72` reads `useArrangementStore.getState().arrangement` — which, mid-gesture,
is the **previewed** arrangement, not the gesture base — and hands it to `moveClips` at `:115/:120`.
`moveClips` (`song/ops.ts:242`) emits an **absolute** verb, `startTick: clip.startTick + clampedDelta`, computed
from *that* arrangement. `previewGesture` (`arrangementStore.ts:533`) then applies it to `previewBase`. So each
`pointermove` lands at `previewed + delta` instead of `base + delta`. **Total travel is proportional to the
number of pointer events, not to the distance moved** — it is a function of the mouse's report rate, so a
1000 Hz mouse is far worse than this 6-step-per-move harness. `rawDelta` itself is computed correctly from the
pointerdown-render `clip.startTick`; only the target is wrong.

**Not introduced here.** `git show HEAD:src/components/Arrangement/useClipGesture.ts` has the byte-identical
`const arrangement = useArrangementStore.getState().arrangement;` → `moveClips(arrangement, …)` pair, HEAD's
`previewGesture` has the same `applyVerbs(previewBase, verbs)` body, and `song/ops.ts` is not in the diff at all.
Verified by code identity, not by running HEAD (this gate cannot check out).

**Why nobody caught it in four rounds:** it is also the upstream cause of gate 3's P0 *symptom*. At the honest
99 ticks/px a 120 px drag is 11 880 ticks, comfortably inside a ~138 000-tick viewport; it only escaped
`visibleEndTick` at 110 px **because of this 12× amplification**. Gates 2 and 3 both recorded the inflated tick
numbers in their tables (`+20 px → 5 760`, `+60 px → 40 320`) without flagging the ratio.

**Fix shape (Wave 3).** Feed the ops the base, not the preview: capture `previewBase`/the pointerdown arrangement
in the `Gesture` record and pass that to `moveClips`. `slipClips` (`:99`) has the same shape and almost certainly
the same bug. `trimClip` (`:102`) and the Alt-copy branch (`:107-112`) are **correct** — both compute an absolute
target from a base captured once, and the Alt-copy path was measured clean.

**Not a commit blocker**, because it is not in this change set, blocking does not fix it, and this diff strictly
improves the same file (it removes the regression that was hiding it).

---

## Must fix before commit (ranked)

*(empty — no blocker in this change set)*

## Follow-ups for Wave 3 TA2 (consolidated: carried from gate 3 + new)

Ranked, highest first.

1. **P0 (new, pre-existing) — the clip move accumulates its preview: ~12× over-travel, rate-dependent.**
   `useClipGesture.ts:72,115,120` pass the live previewed arrangement to `moveClips`, which emits an absolute
   `startTick`. Pass the gesture base instead. Check `slipClips` (`:99`) for the same defect. Pin it with a test
   that fires **N** pointermoves to the same coordinate and asserts the tick is unchanged after the first.
   (Finding 1.)
2. **P2 — `MixerDrawer` pan/fader (`MixerDrawer.tsx:65-90`) and `AutomationLaneView` point/range
   (`AutomationLaneView.tsx:82-119`) are still not on `ownPointerGesture`.** They commit solely through the
   element's own `onPointerUp` with `setPointerCapture` and no window fallback — the exact shape that made the
   piano-roll note leak. Finish the migration so pointer ownership is uniform. (Carried, gate 3 finding 2.)
3. **P2 — the piano roll has no Escape abort.** Clips have one (`useClipGesture.ts:196`); note move/resize,
   draw, marquee and the velocity lollipop have none. One gesture, one escape hatch. (Carried.)
4. **P2 — vertical virtualization still unmounts the dragged clip.** The gesture now survives it (proven), but
   the clip vanishes from its lane and the only feedback left is the 24 px ghost. Either widen the lane window
   while `dragActive` the way `activeClipDragIds` widens the tick window, or make the ghost carry the clip's real
   height. (New.)
5. **P3 — the drag ghost's height is still hard-coded to 24 px** (`useClipGesture.ts:133`). Measured `24px`
   against a 64 px clip and again against a 480 px lane. (Carried; now more visible because of item 4.)
6. **P3 — `abortOwnedPointerGestures()` is a module-global sledgehammer.** `ArrangementSurface`'s unmount aborts
   *every* owned gesture, including the four PianoRoll ones. Inert today only because `ArrangementSurface` is
   mounted unconditionally in `App.tsx:668`; it becomes a real cross-surface bug the moment the surface is
   conditionally mounted. Scope the registry per surface. (New.)
7. **P3 — `finish()` calls `setActiveClipDragIds([])` unconditionally**, allocating a fresh array on every
   pointer-up including a plain click that never became a drag. Every `TrackLaneView` re-renders. Skip the write
   when the array is already empty. (New.)
8. **P3 — unbounded `while (gestureDepth > 0) get().commitGesture();`** (`arrangementStore.ts:302`).
   `beginGesture` increments `gestureDepth` even when `arrangement` is `null`, and `commitGesture` then returns
   at `if (!previewBase) return;` without decrementing — spins the main thread forever. Not reachable from
   today's UI; a tab-hang one refactor away. Bound the loop. (Carried from gate 2.)
9. **P3 — the watchdog can be held open indefinitely by previews.** `previewGesture` refreshes liveness and
   `useClipGesture`'s auto-scroll rAF loop previews on its own, so an orphan parked at a scroll edge would never
   time out. Gate the refresh on an owned pointer, or bound total gesture age. (Carried.)
10. **P3 — only 0 of 156 lane piano-roll notes were hit-testable this run** (gate 3: 12/156; gate 2: 60/128).
    It is regressing round over round and it silently skips two journey cases every gate. This needs an owner.
    (Carried, worse.)
11. **P3 — `playOriginTick` is fractional at non-default tempos** (≤ 0.017 tick). Inert — the sample published
    to the engine is exact — but round it if anything ever compares origins for equality. (Carried.)
12. **P3 — the agent's non-queued `undo` still undoes the newest entry**, not its own. Pre-existing. (Carried.)
13. **P3 — `ClipView.tsx:107` wires `onLostPointerCapture={gesture.onLostPointerCapture}` to a `() => undefined`;
    same at `PianoRoll.tsx:549,631`.** Attaching a no-op handler is a dead line (code-value #8); the comment
    belongs in the source, not in the JSX. (Carried.)
14. **P3 — `startPreview`'s leftover 8-space indentation** (`arrangementStore.ts:97-119`). (Carried from gate 2.)
15. **P3 — `is-drop-target` outlines the source lane on every plain move drag**, because `clipDragPreview`
    always sets `hoveredTrackId: hoveredTrackId ?? trackId` (`useClipGesture.ts:129`). Visible in
    `g4-a-01-mid-drag.png`. Only outline when the hovered track differs from the source. (New, cosmetic.)
16. **Harness hygiene — two stale assertions in `journey-gate3.ts`.** `frozeNotRewound` hard-codes
    `playheadTick === 960` (`:212`), and `e1_crossTrackGhost` / `g3a_longClipDrag` run on mutated page state so
    they report false negatives. Fix or split the journey before the next gate trusts it.
17. **Tooling — record durably that Playwright must be launched with `node`, not `bun`, on this box.** Confirmed
    again this round: `node --experimental-strip-types` launches Chromium in ~2 s; bun hangs the pipe.

## Not verified

- **Anything audible.** The headless wasm engine emits no `Transport` frames; acks are injected via
  `receiveTransportFrame`, so every transport verdict is store/UI truth under a silent engine. Clicks, dropouts
  and MIDI→audio latency still need a human with audio actually playing.
- Native executor, real device loss, macOS.
- The piano-roll browser note sub-cases (0 hittable notes). Covered only by the passing component tests.
- Finding 1 was not re-measured against a checked-out `HEAD` — this gate is read-only. Its pre-existence rests on
  byte-identical source at `HEAD` for all three files in the chain.

## Artifacts

`plans/redesign-new-dna/.scratch/w1-gate4/` —
harnesses `probe-g4.ts` (main + listener-leak counters), `probe-g4b.ts` (clean cross-track),
`probe-g4c.ts` (over-travel diagnostic), `journey-gate3.ts` (lane's, re-pointed at 5195);
raw `probe-g4.json`, `probe-g4b.json`, `probe-g4c.json`, `journey.json`;
gates `tsc.txt`, `eslint.txt`, `vitest.txt`; `dev.log`, `dev2.log`;
screenshots `g4-a-01-mid-drag.png`, `g4-a-02-committed.png`, `g4-b-01-scrolled-mid-drag.png`,
`g4-b-02-committed.png`, `g4-c-01-escape-restored.png`, `g4-f-01-alt-copy-mid.png`,
`g4-x-01-cross-track-ghost.png`, `g4-x-02-cross-track-dropped.png`, plus the journey's `00`–`11` and `g3-*` set.
