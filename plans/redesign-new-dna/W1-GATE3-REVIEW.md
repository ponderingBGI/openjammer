# W1 GATE 3 — final commit gate for the uncommitted timeline change set

Date: 2026-08-28. Reviewer: read-only gatekeeper. Nothing was edited, staged, committed, stashed or checked out
in the repo's source tree; the only files written are the gate's own artifacts under
`plans/redesign-new-dna/.scratch/w1-gate3/` and this report.

Scope: the whole uncommitted tree (23 modified + 10 untracked, +1219 / −231 in tracked files) — timeline stores,
Arrangement, PianoRoll, song, ai adapter/tools, docs, tests, and the new
`src/components/Arrangement/pointerGestureLifetime.ts`.

## Recommendation

**DO-NOT-COMMIT.**

Three of the four gate-2 findings are genuinely fixed and now browser-proven — the piano-roll note lifetime, the
seek→play origin, and the 6-second velocity burst are all clean, and the fixes are well-shaped. But **gate-2's
P0 #1 is still live**: a clip drag still aborts itself mid-flight, the clip still snaps back, still nothing enters
the command log, still no error. TA1e removed one of its two triggers (`onLostPointerCapture`) and left the other
— **the unmount cleanup this same diff introduced** — and that unmount is caused by the drag's own preview. It
fires at roughly **110 px of pointer travel** in the app's default zoom, i.e. on the single most common gesture
on the timeline. Root cause is now located exactly (below) and the fix is small.

---

## Gates

| Gate | Result |
|---|---|
| `bunx tsc --noEmit -p tsconfig.app.json` | **PASS** — exit 0, 0 diagnostics (`.scratch/w1-gate3/tsc.txt`) |
| `bunx eslint src packages e2e` | **PASS** — exit 0, 0 diagnostics (`.scratch/w1-gate3/eslint.txt`) |
| `bun run test:run` (full, once) | **PASS** — 173 files / 1689 tests / 43.1 s, exit 0 (`.scratch/w1-gate3/vitest.txt`). voiceSynth did not flake; no rerun needed. |
| `git diff --check` | **CLEAN** — 0 findings (only informational CRLF notices). |

**Green gates are again not evidence.** The new `ArrangementSurface.test.tsx:82` pin passes because jsdom never
unmounts the clip: `TrackLaneView`'s visible-tick filter is what evicts it in a real browser, and no test drives
that. This is the second gate in a row where the P0 lives precisely in the gap the unit tests cannot see.

---

## Part 1 — the four gate-2 items, verified with the surrounding code open

### (a) `pointerGestureLifetime.ts` — sound helper, but it is **not the whole lifetime**

`src/components/Arrangement/pointerGestureLifetime.ts` (whole file, 23 lines).

| Property | Verdict |
|---|---|
| window-level `pointermove` / `pointerup` / `pointercancel` ownership, filtered by `pointerId` | ✔ |
| `blur` → abort | ✔ present, and **measured not to misfire**: the listener is bubble-phase, so an element `blur` (which does not bubble) never reaches it. A bubble-phase probe listener logged **zero** hits across a full drag (`probe-c.json → log`), while a capture-phase probe listener logged the element's blur. Correct as written; do not "fix" it to capture phase. |
| capture loss non-terminal | ✔ `useClipGesture.ts:202` and `PianoRoll.tsx:549,631` are all `() => undefined`; **measured**: `lostpointercapture` arrives mid-drag and the gesture survives (`probe-c.json → log` t=3095; `journey.json → g3b.b1.aliveAfterCaptureLoss: true`) |
| Escape aborts | ✔ clip only (`useClipGesture.ts:64`). The piano roll has no Escape abort — P3, see follow-ups. |
| unmount aborts | ✔ …and this is exactly the problem. See finding 1. |
| every listener removed on every path | ✔ every terminal path funnels through a `cleanup()` captured at gesture start (`useClipGesture.ts:47`; `PianoRoll.tsx:150,154,156,267,276,319,328,347,354,617,625`), and each of those disposers is the closure returned by `ownPointerGesture`, which removes all four listeners. |
| StrictMode double-invoke safe | ✔ both unmount effects are `useEffect(() => () => {…})` whose bodies no-op when no gesture is open; on a StrictMode remount `gesture.current` / `dragRef.current` / `drawRef.current` / `marqueeRef.current` are all `null`. |
| no duplicate commits when an element `onPointerUp` **and** the window listener both fire | ✔ **by guard, not by luck**. `PianoRoll.tsx:549` still carries `onPointerUp={(e) => endDrag(e.pointerId)}`, `:631` `onPointerUp={(e) => finish(e.pointerId, true)}`, and the field keeps `onPointerUp={onFieldPointerUp}`. Each of `endDrag`, `finish`, `finishFieldDraw`, `finishMarquee` early-returns unless its ref is non-null with a matching `pointerId`, and each nulls the ref before committing. The React handler also runs first and disposes the window listeners mid-dispatch. Measured: no double entry in any note case. |

### (b) PianoRoll surfaces on the helper — **FIXED, measured**

Note move/resize (`:236`), draw (`:367`), marquee (`:379`) and the velocity lollipop (`:631`) all take
`ownPointerGesture`. Abort restores the preview exactly through `abortGesture()`, which re-`set`s
`previewBase`.

**Measured** (`journey.json → g3b_noteGesture`, `g3-02-note-capture-loss.png`):

| Case | Result |
|---|---|
| note drag, synthetic `lostpointercapture` mid-drag, released **outside** the note (`elementFromPoint` at release = `div.piano-roll__content`, not the note) | **PASS** — gesture alive after capture loss, **exactly one** history entry, gesture closed, note moved 56 160 → 67 200 |
| note drag + window `pointercancel` | **PASS** — preview moved 56 160 → 61 440, then restored to **56 160**, **zero** entries, gesture closed |

Gate-2's P0 #2 (the note gesture leaking `open` until the 5 s watchdog) is genuinely gone.

### (c) Play-after-seek origin from `pendingSeekSample` — **FIXED, measured, tempo-map correct**

`arrangementStore.ts:628-631` uses `transportPending === 'seek' && pendingSeekSample !== null ?
sampleToTick(buildTempoMap(arr), pendingSeekSample) : playheadTick` — the `arrangement.split` idiom, as gate 2
asked.

**Measured** (`journey.json → g3c_seekImmediateSpace`, `g3-03-seek-immediate-space.png`): seek to bar 5
(tick 15 360), **no ack** (`transportPending: 'seek'`, `playheadTick: 0`), then a real **Space** keypress →
`playOriginTick: 15360`, `isPlaying: true`, **no rewind**. The gate-2 P2 is closed.

**Tempo-map correctness at non-default tempos** (`journey.json → g3c_tempoRoundTrip`): the round trip is exact at
120 bpm and off by **≤ 0.017 tick** at 137 / 173.7 / 90.5 bpm, because `tickToSample` rounds to an integer sample
and `sampleToTick` returns a fractional tick. This is **musically inert and does not reach the engine**:
`startPreview` immediately re-applies `tickToSample`, which maps the fractional origin back to the *same integer
sample* that `seek` published. Fractional ticks are already the norm in this store (`arrangementStore.ts:792,817`
derive `playheadTick` the same way). P3 cosmetic note only.

### (d) Watchdog liveness on every preview — **FIXED, and it still closes a true orphan**

`arrangementStore.ts:526` `previewGesture` now calls `armGestureWatchdog()`.

- **A true orphan still closes.** "Orphan" here means *no pointer down and no previews arriving*. The watchdog
  only defers on `activePointers.size > 0` (`:295`) and is only refreshed by `beginGesture`/`previewGesture`/a
  nested `commitGesture`. **Measured** (`journey.json → b2_wheelBurstOver5s`): a gesture opened with one preview
  and then left alone was force-closed after 5.6 s (`watchdogCutTheBurst: true`) with no pointer down. The
  backstop is intact.
- **It never cuts a live one.** **Measured** (`journey.json → g3d_wheelBurst60`, `g3-04-wheel-60.png`): 60 real
  wheel notches at 100 ms over 6 s → **exact cumulative velocity 90 → 30**, `velAtNotch30: 60` (no swallowed
  notches at the old 5 s cliff), gesture still open at notch 60, **one** history entry, closed after the 180 ms
  pause. The gate-2 P2 is closed.
- **The "one burst = one undo regardless of duration" policy is acceptable** and nothing else regresses from it:
  the burst is still bounded by the 180 ms pause, `startNoteDrag` still closes it synchronously before a pointer
  gesture (`PianoRoll.tsx:221`), and the unmount effect commits a live burst rather than dropping it (`:159`).
  A 2-minute burst becoming one entry is a reasonable trade.
- **One theoretical hole worth recording:** the refresh is now driven by `previewGesture`, and
  `useClipGesture`'s auto-scroll rAF loop calls `preview()` on its own. A genuinely orphaned clip gesture parked
  near a scroll edge could refresh the watchdog forever. Not reachable today (every orphan path now disposes the
  rAF via `finish`), but it converts the watchdog from "always closes" to "closes unless something is still
  previewing". P3.

---

## Part 2 — whole-diff sweep

- **Debug leftovers:** none. Zero added `console.*`, `debugger`, `TODO`/`FIXME`/`HACK`/`XXX` in tracked or
  untracked files.
- **`any`:** zero added `: any` / `as any` / `<any>`; zero added `eslint-disable` / `@ts-ignore` /
  `@ts-expect-error`.
- **`git diff --check`:** clean.
- **Removed behaviour:** unchanged from gate 2's assessment and still correct — `selectNotes`/`selectedNoteIds`
  fully migrated with no shim (code-value #7); `startPreview` fails closed. One **new** removal in this round:
  `useClipGesture`'s HEAD-era window `pointermove`/`pointerup`/`pointercancel`/`mousemove`/`mouseup` block
  (`HEAD:useClipGesture.ts:158-168`) is replaced by `ownPointerGesture`. That is the right consolidation, but it
  changed one property that nothing noticed: at HEAD those listeners **outlived the component**, so an unmounted
  clip still committed. Now they do not. See finding 1.
- **Docs:** `docs/timeline.md` and `docs/agent-tools.md` + `tools.ts:206-211` catalogue all describe the queued
  agent edit and the honest loop behaviour; the parity/doc tests pass. Docs are part of the feature here and they
  were done.
- **Real improvements nobody claimed:** `clipBarSpan` replaces the hard-coded `/3840`; `historyStore` now routes
  selection restore per surface via `selectionSurface(scope)`; `trackLaneViewStore` restores the *previous* lane
  height instead of forcing 72; the mixer pan drag no longer opens the typed editor on release
  (`suppressPanClick`); the arrangement `Ctrl+wheel` handler is a non-passive native listener with rAF-coalesced
  viewport writes. All sound, all measured working.

---

## Part 3 — browser journey

Dev server `bun dev -- --port 5193 --strictPort`, **stopped**, port 5193 verified free (0 LISTENING sockets).
Zero pageerrors and **zero console errors** across all four browser runs (60 passive-listener warnings from the
wheel notches, benign and pre-existing).

> **Harness note that matters for every future lane.** TA1e's "Chromium hung twice" was **not** the machine and
> **not** a flake: Playwright's Chromium pipe transport **hangs indefinitely under `bun`** on this box and
> launches in **1.8 s under `node`**. Three launch strategies (headless-shell, `channel: 'chromium'`, headed) all
> timed out under bun; the same script under `node` ran the full journey. **Run Playwright harnesses with `node`,
> not `bun`.** (`node` 24 strips the TS annotations natively — no transpile step needed.)

| Item | Result | Evidence |
|---|---|---|
| **(a) one continuous clip drag +60 → +150 → +300 → +450 px, one entry at the final position** | **FAIL (P0)** — aborts at ~110 px, clip snaps to its origin, **zero** entries, no error | `probe-a.json → a_longDrag`, `probe-b.json`, `probe-c.json`, `pa-01/02.png` |
| (b) note drag released outside the note after a synthetic `lostpointercapture` → one entry | **PASS** | `journey.json → g3b.b1`, `g3-02-note-capture-loss.png` |
| (b) note drag + `pointercancel` restores | **PASS** — exact restore, zero entries | `journey.json → g3b.b2` |
| (c) seek bar 5 then IMMEDIATE Space before the ack → `playOriginTick === seek tick`, no rewind | **PASS** | `journey.json → g3c_seekImmediateSpace`, `g3-03-…png` |
| (d) 60 real wheel notches over 6 s → exact cumulative velocity, one entry, no swallowed notches | **PASS** | `journey.json → g3d_wheelBurst60`, `g3-04-wheel-60.png` |
| (e) velocity burst → immediate note drag: stack empty, two undos | **PASS** | `journey.json → a_burstThenDrag` (DOM + store mirror) |
| (e) 7 s held-still clip drag survives the watchdog | **PASS for the watchdog** (`aliveAt7s: true` at 7.2 s) / **then killed by finding 1** on the follow-up +220 px move | `probe-a.json → b_heldDrag`, `pa-05-held-7s.png` |
| (e) double-Stop returns to origin | **PASS** — stop 1 freezes at 2 400, stop 2 → `pendingSeekSample: 0` | `journey.json → c_transport.c2` |
| (e) stop → seek → Space plays from the seek | **PASS** — origin 7 680 | `journey.json → c_transport.c3` |
| (e) end halt does not arm the rewind | **PASS** | `journey.json → c_transport.c4` |
| (e) queued agent edit `queued:true` → applied | **PASS** — all sub-claims, incl. `lastQueuedEditResult` queued→applied and an honest rejection in `transportError` + `describe()` | `journey.json → d_agentQueuedEdit`, `d_agentQueuedRejection`, `06-agent-mid-drag.png` |
| (e) cross-track ghost + one undo | **PASS** — original stays in `t0` at opacity 0.35, ghost 0.96 over `t1`, `is-drop-target` set, drop → `t1`, one entry, one Ctrl+Z restores | `probe-a.json → e1_crossTrackGhost`, `pa-03/04.png` |
| (e) loop toggles mid-play both ways + real loop range keeps rolling | **PASS** — stops honestly without a range, rolls with one | `journey.json → e2_loopToggle`, `08-loop.png` |
| (e) mixer pan typed + drag | **PASS** — typed 0.4 one entry, drag → 0.9 one entry, no popup on release | `journey.json → e3_mixerPan`, `09/10-pan.png` |
| (e) Ctrl+wheel notch stability | **PASS** — leftTick Δ 1 286 < 3 840 (one bar), zoom applied | `journey.json → e4_zoomNotch`, `11-zoom.png` |
| (f) console errors / pageerrors | **0 / 0** across all runs | `errors: []` in every JSON |

### Finding 1 — **P0, introduced by this diff: a clip drag aborts itself as soon as its own preview leaves the visible tick range**

**Measured** (`probe-c.json`, one continuous pointer-down drag of `t0.c0` on a freshly loaded Paper Sketch at the
app's default zoom, `pxPerTick 0.0101`):

| move | clip tick | gesture | `document.activeElement` |
|---|---|---|---|
| +20 px | 5 760 | `open: "Move clips"` ✔ | the clip `<button>` |
| +60 px | 40 320 | open ✔ | the clip `<button>` |
| +100 px | 105 600 | open ✔ | the clip `<button>` |
| **+120 px** | **0 (snapped back)** | **`open: null`, `gestureOpen: false`** ✘ | `BODY` |
| +140 … +450 px | 0 | dead | `BODY` |
| release | 0 | **zero history entries**, no error | — |

**Root cause, isolated by instrumentation** (`probe-c.json → log`):

```
t=3083  win:blur          target = "arrangement-clip is-selected is-dragging"   (capture-phase probe only)
t=3083  win:focusout      target = "arrangement-clip is-selected is-dragging"
t=3084  abortGesture      ← from useClipGesture `finish(false)`
t=3094  DOM-REMOVED-CLIP  t0.c0
t=3095  win:lostpointercapture                                     (now a harmless no-op ✔)
        win:blur(BUBBLE-PHASE)  — NEVER FIRED
```

The bubble-phase `blur` listener never fired, so `ownPointerGesture`'s blur handler is **not** the trigger. The
chain is:

1. `TrackLaneView.tsx:52` virtualises clips by visible tick range —
   `track.clips.filter((clip) => clip.startTick + clip.lengthTick >= visibleStartTick && clip.startTick <= visibleEndTick)`.
2. The drag's **own preview** pushes the clip past `visibleEndTick`, so React unmounts that `ClipView`.
3. `useClipGesture.ts:66-69` — new in this diff — runs `if (gesture.current) finishRef.current(false);` on
   unmount, which calls `abortGesture()`.

At HEAD this could not happen: the unmount cleanup only removed the Escape listener
(`git show HEAD:src/components/Arrangement/useClipGesture.ts:54-57`), and the window
`pointermove`/`pointerup` pair (`HEAD:158-168`) deliberately **outlived the component**, so the drop still landed.
`TrackLaneView.tsx:52` is byte-identical at HEAD — the virtualization is old, the abort is new. **Straight
regression.**

*Impact.* At the default zoom this is ~110 px of pointer travel — an ordinary arranging move. The performer sees
the clip snap home, the command log stays empty, and nothing anywhere says why. Gate 2 called this exact symptom
its #1 must-fix; it is not fixed.

*Fix.* Unmount is not cancellation while the physical pointer is still down. Either (i) do not abort from the
unmount cleanup when the gesture's pointer is still active — let the window `pointerup`/`pointercancel` pair own
the outcome, which is what `ownPointerGesture` exists to guarantee — or (ii) hoist the gesture out of `ClipView`
so the dragged clip cannot be virtualised away (widen `visibleStartTick`/`visibleEndTick` while
`editingContext.dragActive`, the same way the cross-track case already pins `toTrackId: trackId`). Pin it with a
browser-level or jsdom test that **actually unmounts the ClipView mid-drag** and asserts the drop still lands as
one entry — the current pin at `ArrangementSurface.test.tsx:82` cannot catch this because jsdom never evicts the
clip.

### Finding 2 — P2: two gesture surfaces were left off the shared lifetime

`MixerDrawer.tsx:65-90` (pan, and the fader above it) and `AutomationLaneView.tsx:82-119` (move point, adjust
range) still commit solely through the element's own `onPointerUp`, with `setPointerCapture` and no window
fallback — precisely the shape that made the piano-roll note leak. Both measured PASS today (`e3_mixerPan`), and
the 5 s watchdog bounds the damage, but the helper was written to make this uniform and these two were missed.

---

## Must fix before commit (ranked)

1. **P0 — `useClipGesture.ts:66-69` aborts a live clip drag when `TrackLaneView.tsx:52` virtualises the dragged
   clip away.** Browser-reproduced on a clean page at ~110 px of travel: clip snaps back, zero history entries,
   no error. Introduced by this diff; small fix; pin it with a test that unmounts the ClipView mid-drag.
   *(This is the only blocker. Everything else below is a follow-up.)*

## Follow-ups for Wave 3 TA2 (not blocking, do not lose)

- **P2 — `MixerDrawer` pan/fader and `AutomationLaneView` point/range gestures are not on
  `ownPointerGesture`.** Finish the migration so pointer ownership is uniform across every timeline surface
  (finding 2).
- **P2 — the piano roll has no Escape abort.** `useClipGesture.ts:64` gives clips one; note move/resize, draw,
  marquee and the velocity lollipop have none. One gesture, one escape hatch.
- **P3 — unbounded `while (gestureDepth > 0) get().commitGesture();`** (`arrangementStore.ts:302`). `beginGesture`
  increments `gestureDepth` even when `arrangement` is `null`, and `commitGesture` then returns at
  `if (!previewBase) return;` without decrementing — that spins the main thread forever. Not reachable from
  today's UI; it is a tab-hang one refactor away. Bound the loop. (Carried from gate 2, unchanged.)
- **P3 — the watchdog can now be held open indefinitely by previews.** `previewGesture` refreshes liveness and
  `useClipGesture`'s auto-scroll rAF loop previews on its own, so an orphan parked near a scroll edge would never
  time out. Gate the refresh on an owned pointer, or bound the total gesture age.
- **P3 — `playOriginTick` is fractional at non-default tempos** (≤ 0.017 tick). Inert — the sample published to
  the engine is exact — but round it if anything ever compares origins for equality.
- **P3 — the drag ghost's height is still hard-coded to 24 px** (`useClipGesture.ts:134`); measured
  `ghostHeight: "24px"` against a 64 px clip (`probe-a.json → e1.ghost`). (Carried from gate 2.)
- **P3 — only 12 of 156 lane piano-roll notes are hit-testable** (`journey.json → g3b.hitTest`) — 92 % of the
  notes in a lane piano roll cannot be clicked. Gate 2 measured 60/128; it is now worse. Owned by the canvas /
  layout lane, but it needs an owner.
- **P3 — the agent's non-queued `undo` still undoes the newest entry**, not its own. Pre-existing.
- **P3 — `ClipView.tsx:107` wires `onLostPointerCapture={gesture.onLostPointerCapture}` to a `() => undefined`.**
  Same at `PianoRoll.tsx:549,631`. Attaching a no-op handler is a dead line (code-value #8); the comment belongs
  in the source, not in the JSX.
- **P3 — `startPreview`'s leftover 8-space indentation** (`arrangementStore.ts:97-119`). (Carried from gate 2.)
- **Tooling — record it somewhere durable that Playwright must be launched with `node`, not `bun`,** on this box.
  It cost TA1e its entire runtime verification and cost this gate two 3-minute launch timeouts.

## Not verified

- **Anything audible.** The headless wasm engine emits no `Transport` frames; acks were injected via
  `receiveTransportFrame`, so every transport verdict is store/UI truth under a silent engine. Clicks, dropouts
  and MIDI→audio latency still need a human with audio actually playing.
- Native executor, real device loss, macOS.

## Artifacts

`plans/redesign-new-dna/.scratch/w1-gate3/` —
harnesses `journey-gate3.ts`, `probe-a.ts`, `probe-b.ts`, `probe-c.ts`;
raw `journey.json`, `probe-a.json`, `probe-b.json`, `probe-c.json`;
gates `tsc.txt`, `eslint.txt`, `vitest.txt`; `dev.log`;
screenshots `00-song.png` … `11-zoom.png`, `g3-01-long-drag.png`, `g3-02-note-capture-loss.png`,
`g3-03-seek-immediate-space.png`, `g3-04-wheel-60.png`, `pa-01-mid-drag.png`, `pa-02-committed.png`,
`pa-03-ghost.png`, `pa-04-dropped.png`, `pa-05-held-7s.png`.
