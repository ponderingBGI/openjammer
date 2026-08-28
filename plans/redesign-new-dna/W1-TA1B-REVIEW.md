# W1-TA1b — second-round adversarial review of the timeline change set

Reviewer: principal-DAW-engineer pass, read-only. Date: 2026-08-28.
Scope: the uncommitted diff over `src/store/{arrangement,editingContext,history,trackLaneView}Store.ts`,
`src/components/Arrangement/*`, `src/components/PianoRoll/*`, `src/song/__tests__`,
plus the untracked tests. Canvas-lane files untouched.
Baseline note: TA1's tree no longer exists on disk (TA1b overwrote it in place), so
"fails on old code" claims below are **analytic**, against `HEAD` and against the
defect mechanism the predecessor measured — not re-executed mutation tests.

## Gates

| Gate | Result |
|---|---|
| `bunx tsc --noEmit -p tsconfig.app.json` | **PASS** — 0 diagnostics |
| `bunx eslint src packages e2e` | **PASS** — 0 diagnostics |
| `bun run test:run -- src/song src/components/Arrangement src/components/PianoRoll src/store` | **PASS** — 46 files / 408 tests, 13.6 s |
| Browser journey, one Chromium, `bun dev --port 5186` | **RAN in full** — Chromium launched first try; the report's launch hang did not recur. Two harnesses, 10 screenshots. Dev server stopped, port 5186 verified free. |

**Environment caveat, unchanged from round 1:** headless wasm emits **zero** `Transport`
frames. `playheadTick` never moved and every transport command ended in
`transportError: "The audio engine did not acknowledge…"`. So nothing below verifies *heard*
audio or engine-side loop continuity; what it verifies is store/UI truth under a silent engine,
which is the TL-15 failure mode itself.

---

## Verdict per predecessor finding

| # | Item | Verdict |
|---|---|---|
| R1 | Cross-track clip drag | **FIXED functionally / NEW-DEFECT in feel (P1)** |
| R2 | Pan typed + drag, click suppression | **FIXED** (one P2 residue) |
| R3 | Ctrl+wheel zoom notch | **FIXED** |
| R4 | End-of-song freeze / no rewind | **FIXED** (spec §7 double-Stop now **unimplemented**, P1) |
| R5 | Loop enabled with no loop range | **STILL-DEFECTIVE (P0)** on the mid-playback path |
| R6 | `ClipView` hot path / `timebase` prop | **FIXED**; all callers updated |
| R7 | `play()` failure teardown, count-in ack, `transportError` UI | **FIXED** |
| — | Transport callers (`returnToStart` / clamped `setTempo`) | **FIXED** |
| — | Overlapping-transaction force-abort | **CORRECT for stores / NEW-DEFECT in the UI (P0)** |
| — | TL-24 audition tokens | **FIXED in wiring / one carried-over gap (P2)** |
| — | Selection history per surface + `pianoroll` scope | **FIXED**; document `Ctrl+Z` stays global (P3 mis-route) |
| — | Velocity burst lifecycle | **FIXED / one cross-gesture timer hazard (P2)** |

### R1 — cross-track drag — FIXED functionally, NEW-DEFECT in feel (P1)

`useClipGesture.ts:110-121`. `finalVerbs` (with `toTrackId: hoveredTrackId`) is stashed and
applied once in `finish(true)`; the *previewed* verbs deliberately pin the clip to `trackId`
so the source `ClipView` never unmounts. The unmount-abort regression is gone.

**Measured (`journey.ts` → `run.json`):** `t0 → t1`, `cursor 0 → 1`, one `Ctrl+Z` → back on
`t0`. The gesture works.

**But the preview no longer crosses lanes.** Mid-drag, with the pointer at y≈270 inside the
Bass lane (`234–306`), the dragged clip element is still parented to `[data-track-id="t0"]`
with box `top 166 / bottom 230` — `previewVisiblyCrossedLanes: false`. `01-middrag.png` shows
it plainly: the clip has moved only horizontally, there is no ghost on the target lane and no
drop-target highlight anywhere. The performer gets **zero** feedback about which lane a release
will land on; the clip teleports at pointer-up. That is a straight regression against spec §1.1
("every gesture previews at 60 fps") and §4/§8 feedback, and against normal DAW muscle memory.
The new pinning test asserts only the committed `trackId`, so it cannot see this.
*Fix:* keep the atomic commit, but render the vertical offset — either translate the dragged
`ClipView` by `dy` (`transform`, purely visual, no verb) and outline the hovered lane, or
lift a lightweight drag ghost into `ArrangementSurface`. Add a mid-drag assertion to the test.

### R2 — pan typed / drag — FIXED (P2 residue)

`MixerDrawer.tsx:17,28,74-84`. `suppressPanCommit` is gone; movement past 3 px sets
`moved`, `finish()` latches `suppressPanClick`, and `onClickCapture` eats exactly the
post-drag click. The latch is a `TrackStrip`-local ref attached to that strip's pan scrubber
only, so **it cannot swallow a click on a different scrubber** (the gain `Slider` is a separate
control with no capture handler) — the question asked is answered *no*.

**Measured:** clean click → editor → `0.4` applied, `cursor +1`. Drag → `pan 0.9`, exactly one
entry, `editorOpenedByDrag: false`. Click after the drag → editor opens, `-0.25` applied,
`cursor 3`. Drag released far off the readout, then click → editor still opens
(`editorAfterOffTargetRelease: true`), so the latch does not persist.

*P2 residue:* `onPointerMove` (`:73-76`) previews on **every** move, but `moved` needs ≥3 px.
1–2 px of mouse jitter during a plain click therefore commits a real `setTrackPan`
(±0.0125) plus a history entry *and* still opens the editor. Move the `preview(...)` call
inside the `moved` branch.

### R3 — zoom notch — FIXED

`ArrangementSurface.tsx:59-83, 134-148`. `leftTick` is written from the store's own `zoomAt`
result; the DOM `scrollLeft` write is deferred to a nested `requestAnimationFrame` and re-read
from the canonical store value, and the scroll-only path is the only one that derives
`leftTick` from `scrollLeft`. The wheel handler is now a real non-passive
`addEventListener('wheel', …, { passive: false })`.

**Measured at a genuine bar 8** (`journey2.ts`, 6 real Ctrl+wheel notches in first so the field
actually overflows): `leftTick 26 883 (bar 7.00) → 27 888 (bar 7.26)` on one notch —
Δ 1 005 ticks, well inside one bar (3 840). Tick-under-cursor drift **3.1 ticks**. A second
notch: bar 7.47, Δ 790. **Zero** `Unable to preventDefault inside passive event listener`
warnings and no browser page zoom across both runs — the predecessor's `28 910 → 0` collapse
is gone.

(Note: journey 1's zoom probe ran at the default fit-to-window scale where the field cannot
scroll at all — `leftTick 0`. Journey 2 is the load-bearing measurement.)

### R4 — end-of-song freeze — FIXED; but spec §7 double-Stop is now unimplemented (P1)

`arrangementStore.ts:497-505, 619-643`. `stop()` early-returns when `!isPlaying`, so the
watchdog can no longer seek; `receiveTransportFrame` calls `clearEndTimer()` on `motion === 0`,
so the engine's own stop cancels the later watchdog. The store test advances 60 s past the
watchdog and pins `seekArrangement` not called and `playheadTick` unmoved — it fails on TA1 by
construction (TA1 took the `!isPlaying` seek branch).

**Measured:** 13.8 s song, played to the end → `isPlaying: false`, `playheadTick` unchanged, no
seek. (Weak evidence only, because with zero engine frames the playhead never moved from 0.)

**Double-Stop semantics.** Spec §7: *"A second Stop returns it to the tick where playback last
started."* TA1b removed the dangerous implementation and **did not implement the safe one**.
Measured: a second `stop()` is a no-op, and the pill's title when stopped is `"Play"` — a second
press starts playback. So the documented behaviour is now absent from every path.
`playOriginTick` is written but read by nobody. *Fix:* implement the double-tap in
`TransportStrip` / the `Space` binding with a short window (call `returnToStart()` inside it),
or delete `playOriginTick` and amend §7. Interaction with record/loop is clean: `stop()` routes
to `finishRecording()` first (`:499-502`), and loop is untouched.

### R5 — loop without a loop range — STILL-DEFECTIVE (P0)

`startPreview` (`:99, :111`) and `republishPreview` (`:128-129`) correctly gate on a real
`loop` location. **`setLoopEnabled` does not** — `arrangementStore.ts:536-540`:

```ts
if (get().isPlaying) {
    if (on) clearEndTimer();          // ← unconditional: no loop-range check
    else if (arr) republishPreview(...);
}
```

Enabling loop **while rolling** on a document with no loop range (Paper Sketch, the shipped
starter, has none) disarms the only end-of-song truth. Nothing re-arms it.

**Measured (`run.json` → `e_loop`):**
- `e1` loop on *before* play, no range → after `songSeconds + 3 s`: `isPlaying: false` ✔ policy holds.
- `e2` loop toggled on **during** playback, no range → after `songSeconds + 4 s`: **`isPlaying: true`** ✘.
- `e3` real `loop` range (`setLoopRange` verb) → still rolling 6 s past the end ✔.

`e1` is the control that proves the watchdog works; `e2` is the live regression. This is exactly
the lie TL-01 was raised to remove, and the pinning test only covers the `e1` ordering.
*Fix:* in `setLoopEnabled`, compute `looping` the same way `startPreview` does and
`republishPreview(...)` (re-arming the timer) when the flag is on but the range is missing.
Also: the policy itself is stated only in the TA1b report — put it in `docs/timeline.md`
next to line 36 ("Loop range is absent unless the document contains a `loop` location").

### R6 — `ClipView` hot path — FIXED

`ClipView.tsx:74` takes `timebase: Timebase` as a prop and no longer subscribes to
`state.arrangement`; `TrackLaneView.tsx:109` passes it. Only caller in the repo — `RecordGhost`
does not render `ClipView`, there is no Ladle story, and `ClipView.test.ts` passes it
explicitly. `tsc` would have caught a miss (it is a required prop) and is clean.

### R7 / TL-15 — play failure, count-in, `transportError` — FIXED

- `play()`'s catch calls `stopPreview()` first (`:489`); pinned by *tears down a partially
  started preview when play publication throws*, which fails on TA1 (no `stopPreview`).
- `receiveTransportFrame:619` accepts `isRollingMotion(frame.motion) || motion === 5`, so
  count-in / declick no longer raise a false failure; pinned.
- `transportError` is rendered — `TransportStrip.tsx:20, 81`, `role="status"`.
- `startPreview`'s doc comment is corrected to the fail-closed behaviour (`:60-65`).

*Cosmetic leftover:* the de-indented block inside `startPreview` (`:90-108`, 8-space body in a
4-space function) was never reflowed.

### Transport callers — FIXED

`TransportStrip.tsx:39` uses `returnToStart()`; `:64` uses `setTempo()` with the 20–300 clamp
in the store (`:526-529`). Pinned end-to-end by *clamps a typed tempo through the production
TransportStrip path* (999 → 300) — fails on TA1, which applied `setTempo` unclamped.
*Unfixed carry-over:* the tempo scrub still goes through `apply` (one `republishPreview` per
commit), not `beginGesture/previewGesture/commitGesture`, so spec §7's "≤20 Hz republish while
rolling" is met only because `ValueScrubber` commits once on release. P3.

### Overlapping transactions — correct in the store, NEW-DEFECT in the UI (P0)

`arrangementStore.ts:369` (`apply`) and `:402` (`beginGesture`) force-abort an open gesture.
Deterministic, tested, and it fixes the dangling-`historyStore.open` hole.

**But nothing tells the gesture's *owner*.** An agent `edit_timeline` arriving mid-drag rips
the drag out from under the performer with no signal.

**Measured (`run2.json` → `agentEditMidDrag`), the exact covenant case:**

| moment | clip `startTick` | DOM `style.left` | class |
|---|---|---|---|
| mid-drag | 40 320 | `657.54px` | `… is-dragging` |
| agent `apply(setTrackMute)` lands | **0** | **`0px`** | `… is-dragging` |
| performer drags 120 px further | 0 | `0px` | — |
| pointer-up | 0 | — | `cursor: 1`, history `["setTrackMute"]` |

The clip snaps home under a still-pressed pointer, the component keeps claiming
`is-dragging`, every subsequent `previewGesture` no-ops (`previewBase === null`), and the
release commits nothing. Spec §1.1 says an abort "restores the pre-gesture document exactly" —
it does — but the performer is given no abort signal and the drag UI lies until they let go.
*Fix (minimum):* when `abortGesture()` fires from a force-abort, publish it — e.g. set
`editingContextStore.dragActive = false` and a one-shot `gestureInterrupted` flag the surfaces
read to end the local gesture and show the §8 chip ("the agent edited the timeline; your drag
was released"). Better: queue an agent `apply` until the open gesture commits, per the
predecessor's suggestion; the performer should win the race, not lose it silently.

### TL-24 audition ownership — FIXED in wiring, one carried-over gap (P2)

`PianoRoll.tsx:97, 169-180` now keeps a per-pitch token queue and passes the token on release;
`TrackLaneView.tsx:106` forwards it to `auditionPianoRollNote`. The token API is live production
code, so the three `actions.test.ts` cases now prove a property the app actually exercises.
Terminal cancel is wired to clip/track/surface teardown (`:144-152`).

*Carried over, still open:* removing `stopArrangementPreview()` from the off path removed the
only teardown of the audition's `updateArrangementPreview` publication — after an audition the
conducted arrangement graph stays published over the canvas graph indefinitely. The report
marks this UNVERIFIED; it is simply still absent. Needs an executor-level
`releaseAuditionGraph()` (or a `resync()`).
*Minor:* `cancelPianoRollAuditions()` is module-global, so one inline piano roll changing clip
kills held voices belonging to a *different* mounted piano roll.

### Selection history / `pianoroll` scope — FIXED (P3 mis-route)

`historyStore.ts:61` maps `graph→canvas`, `pianoroll→pianoroll`, else `arrangement`, and every
`begin/commit/undo/redo` routes the baseline reset to the originating surface.
`editingContextStore.ts:43-48, 185-250` stores per-surface `{entries,index,depth,before}`.
PianoRoll binds `Ctrl+Alt+Z/Y` to its own `selectionSurface` (`:369-378`).

**Answering the question asked:** `historyStore.undo()` is scope-agnostic — it pops the last
entry whatever its scope — so **`Ctrl+Z` from the arrangement still undoes a piano-roll edit and
vice versa**. Only the *selection* baseline is per-surface. The document history stays one
timeline, one Ctrl+Z. Confirmed by reading `undo`/`redo` (`:100-119`) and by
`ArrangementSurface.tsx:92-93` calling `useHistoryStore.undo()` unfiltered.

*P3:* `actions.ts:25` hard-codes `{ surface: 'pianoroll' }`, but `applyPianoRollQuantize` is also
called from the inline lane menu (`TrackLaneView.tsx:91`) whose `selectionSurface` is
`'arrangement'` — an inline quantize resets the wrong surface's selection baseline. Take the
surface as an argument. `editingActions.ts:139` still hard-codes `'arrangement'` too.

### Velocity burst lifecycle — FIXED, one cross-gesture hazard (P2)

`PianoRoll.tsx:144-152` commits and clears the burst when `clipId`/`trackId`/`selectionSurface`
change or the component unmounts — the predecessor's hole 1 is closed. Hole 2 is closed by the
force-abort rule.

*P2 hazard, new:* the 180 ms timer calls the store's `commitGesture()` unconditionally. Wheel a
velocity, then start a note drag inside 180 ms: `startNoteDrag`'s `beginGesture` force-aborts
the velocity gesture and opens "Move notes"; the stale velocity timer then fires and **commits
the drag mid-flight**, after which the note freezes under the cursor and the release no-ops.
*Fix:* capture a burst id and only commit if the store's open gesture is still that burst's.

---

## Test quality

All new tests were read for discriminating power. None is vacuous; the `MixerDrawer.test.tsx`
failure mode the predecessor found (never firing a click, never reaching `onCommit`) is gone —
both cases now `fireEvent.click` the real `ValueScrubber`, get the `spinbutton`, and press Enter,
so they exercise the exact path TA1 swallowed.

| Test | Discriminates against TA1? |
|---|---|
| `MixerDrawer` typed pan / drag-then-type | **Yes** — TA1's `suppressPanCommit` latch swallowed the Enter commit; both assert `pan` *and* `cursor` |
| `ArrangementSurface` cross-track move | **Yes** for the abort regression (TA1: cursor 0). **Blind** to the missing lane preview — asserts only the committed `trackId` |
| `ArrangementSurface` zoom "even when DOM scroll reads stale" | **Yes** — stubs `scrollLeft` to 0, which is precisely what reset TA1 to bar 1 |
| `ArrangementSurface` tempo clamp | **Yes** — TA1's `TransportStrip` applied 999 unclamped |
| store: freeze at engine end + cancel watchdog | **Yes** — asserts `seekArrangement` not called |
| store: play-publication teardown | **Yes** — asserts `stopArrangementPreview` called |
| store: count-in ack | **Yes** — TA1 rejected `motion 5` |
| store: force-abort ×2 | **Yes** — TA1 left `historyStore.open` dangling |
| store: Stop idempotent + `returnToStart` | **Yes**, and it *pins the removal* of spec §7's double-Stop — worth a decision, not just a green tick |
| store: loop with / without range | **Partial** — both call `setLoopEnabled` *before* `play()`. Neither covers the mid-playback toggle, which is where the P0 lives |
| `ClipView` 3/4 label | Yes (`timebase` is a required prop; the render case pins the wiring) |
| `trackLaneViewStore` ×2 | Yes — TA1/HEAD overwrote the remembered height on a clip switch |
| `editingContextStore` per-surface | Yes — impossible under the single shared `selectionHistory` |
| `actions.test.ts` ×3 | Yes for the token API; still mocks the store, so it does not cross `PianoRoll.tsx` |

**Still missing** (all predecessor items 9–13 that TA1b marked UNVERIFIED, plus new):
mid-drag cross-lane preview assertion; `setLoopEnabled(true)` while rolling with no range;
velocity-burst component timing (and the burst-timer-vs-drag interleave);
audition through `PianoRoll`'s own call shape + pointercancel; a repeated-step-entry DOM test.

---

## Browser journey results

Harnesses: `plans/redesign-new-dna/.scratch/review-ta1b/journey.ts`, `journey2.ts`.
Raw: `run.json`, `run2.json`. Screenshots `00`–`09`.

| Item | Result |
|---|---|
| (a) cross-track drag | Lands on track 2, **one** history entry, one `Ctrl+Z` restores — **PASS**. Mid-drag preview stays on track 1 (`01-middrag.png`) — **FAIL** |
| (b) bar 8 + one Ctrl+wheel notch | bar 7.00 → 7.26, Δ 1 005 ticks < 1 bar, cursor-anchor drift 3.1 ticks — **PASS** |
| (c) play to end | `isPlaying: false`, playhead did not rewind — **PASS** (weak: playhead never moved, no engine frames). Second Stop → no-op; pill reads "Play" — **FAIL vs spec §7** |
| (d) mixer pan | typed → applied, +1 entry; drag → +1 entry, no editor popup; typing after a drag still lands — **PASS** |
| (e) loop | no range + enabled before play → stops at end **PASS**; **enabled mid-playback → never stops FAIL**; real loop range → still rolling 6 s past the end **PASS** |
| (f) console | **0** console errors, **0** pageerrors, **0** passive-listener warnings across both runs — **PASS** |

Dev server stopped; port 5186 verified free.

---

## Must fix before commit (ranked)

1. **R5 — `setLoopEnabled` while rolling disarms the end watchdog with no loop range.**
   P0, browser-reproduced, one click from the shipped starter's happy path.
   `arrangementStore.ts:536-540`.
2. **Force-abort must not silently kill a live performer gesture.** P0 covenant.
   `arrangementStore.ts:369, 402` + the surfaces: signal the abort, end the local gesture,
   show the §8 chip — or queue the agent edit behind the open gesture.
3. **R1 — restore a visible cross-lane preview.** P1. Translate the dragged `ClipView` by `dy`
   and outline the hovered lane; keep the atomic commit. Add the mid-drag assertion.
4. **Spec §7 double-Stop: implement it in the pill/`Space`, or delete `playOriginTick` and
   amend the spec.** P1 — right now the documented behaviour exists nowhere.
5. **Velocity-burst timer can commit an unrelated gesture.** P2. `PianoRoll.tsx:449-455`.
6. **Pan preview before the 3 px threshold makes a phantom edit + history entry.** P2.
   `MixerDrawer.tsx:73-76`.
7. **Audition graph teardown** (`releaseAuditionGraph()` / resync) — still absent. P2 + code-value #8.
8. **Document the loop-without-range policy** in `docs/timeline.md`. P3 + code-value #5.
9. `applyPianoRollQuantize` should take the calling surface, not hard-code `'pianoroll'`;
   `editingActions.ts:139` likewise. P3.
10. Reflow the de-indented block in `startPreview` (`arrangementStore.ts:90-108`). P3.

## Recommendation

**DO-NOT-COMMIT** as-is. Items 1 and 2 are P0 — one is a live "the transport lies about playing"
regression reproduced in the browser, the other is the performer losing a gesture to the agent
with no feedback, which the covenant forbids. Item 3 is the difference between a DAW gesture
that works and one that feels broken. Everything else is landable as follow-ups.

TA1b is nonetheless a large, real improvement: R2, R3, R4, R6, R7, the transport callers, the
per-surface selection history and the audition tokens are genuinely fixed, verified in a real
browser, with tests that would have caught the originals. Fix 1–3, add the two missing pins
(mid-playback loop toggle; mid-drag lane preview), re-run this journey, and it should go in.

## Artifacts

`plans/redesign-new-dna/.scratch/review-ta1b/` — `journey.ts`, `journey2.ts`, `run.json`,
`run2.json`, `run.err`, `run2.err`, `dev.log`, screenshots `00-song.png` … `09-agent-mid-drag.png`
(`01-middrag.png` is the cross-lane preview evidence).
