# W1 TA1f — timeline final precise fix

Date: 2026-08-28

## Result

The Gate 3 P0 is fixed. A clip drag now remains alive after its preview crosses the lane virtualization window, commits exactly one history entry on the window-owned `pointerup`, and restores with one Ctrl+Z. `ArrangementSurface` teardown is the cancellation boundary and restores an in-flight preview without creating history.

No Wave 3 TA2 follow-up was taken on: MixerDrawer/AutomationLaneView pointer lifetime, piano-roll Escape, watchdog loop bounds/total-age policy, or note hit-testing.

## Root cause confirmation

`TrackLaneView` filtered every clip solely through `[visibleStartTick, visibleEndTick]`. A live preview moved the source clip outside that interval at about 110 px, React unmounted `ClipView`, and the hook's unmount cleanup called `finish(false)`. That aborted the arrangement gesture, restored the preview base, and produced no history entry. The gate's observed snap-back was therefore a component-lifetime cancellation of a gesture whose real owner was already the window-level `pointerGestureLifetime`.

## Change

- `src/store/editingContextStore.ts:147,158,206,217` adds the serializable `activeClipDragIds` identity and setter.
- `src/components/Arrangement/useClipGesture.ts:52-67,85` no longer aborts from `ClipView` unmount, avoids state updates after unmount, records every selected source clip plus generated Alt-copy template IDs when the drag activates, and clears them on finish. Escape remains attached for the gesture lifetime and the window disposer still owns pointer completion.
- `src/components/Arrangement/TrackLaneView.tsx:34-35,54` renders active-drag clip IDs regardless of the tick window while `dragActive`; normal clips remain virtualized.
- `src/components/Arrangement/pointerGestureLifetime.ts:7-25` registers owned abort callbacks and exposes one surface-teardown abort path that removes its listeners through the normal gesture finish.
- `src/components/Arrangement/ArrangementSurface.tsx:27,162` aborts owned pointer gestures on surface unmount before its existing timer/rAF cleanup.

The UI design hook also reported three pre-existing CSS-style findings in `ArrangementSurface.css`. They are unrelated to TA1f, that CSS file is explicitly outside the authorized edit scope, and no CSS was changed.

## Pinning tests

- `src/components/Arrangement/__tests__/ArrangementSurface.test.tsx:110` narrows the measured viewport, moves a clip 150 px beyond `visibleEndTick`, asserts the source button remains mounted and the gesture remains open, then asserts window `pointerup` commits one entry at the previewed position. On the pre-fix code, lane filtering unmounts the button, the hook cleanup aborts, the gesture is closed, the tick is restored, and history remains at zero.
- `src/components/Arrangement/__tests__/ArrangementSurface.test.tsx:138` crosses the same virtualization boundary, proves the preview is live, then unmounts `ArrangementSurface` and asserts exact tick restoration, closed gesture, zero history, and cleared drag/preview IDs. On the pre-fix code it fails before surface teardown because the clip eviction has already aborted the gesture; there is no surface-owned lifetime to exercise.
- The implementation includes Alt-copy template IDs in the pinned set (`useClipGesture.ts:85`), so copied preview clips are covered by the same lane rule rather than only the original selection.

## Verification

- Focused component pin: PASS — 9/9.
- `bun run test:run -- src/song src/components/Arrangement src/components/PianoRoll src/store src/ai`: PASS — 55 files, 514 tests.
- `bunx tsc --noEmit -p tsconfig.app.json`: PASS.
- `bunx eslint src packages e2e`: PASS.
- `git diff --check`: PASS; only informational LF→CRLF notices.
- Final full `bun run test:run` (run once): PASS — 173 files, 1691 tests.
- Port 5194 after the journey: FREE. The dev server was stopped.

## Node Playwright journey evidence

All Playwright harnesses ran with `node --experimental-strip-types`, never Bun, against one Chromium at a time on port 5194. Evidence is under `plans/redesign-new-dna/.scratch/w1-ta1f/`.

Primary blocker proof (`probe-a.json`):

- One continuous +60 → +150 → +300 → +450 px drag stayed open at every stage.
- The final preview and committed tick were both 1,040,640; exactly one entry was created.
- One undo restored tick 0.
- The move was not clamped at the prior song end. OpenJammer's derived song length grows to include the moved clip, which is the existing rule.
- Cross-track ghost/drop committed to `t1` with one entry and one undo restored `t0`.
- The 7-second held drag stayed open and committed once after movement resumed.

Full Gate 3 journey (`journey.json`): seek→Space, 60-notch velocity burst, burst-then-drag, 7-second drag, double-Stop, stop→seek→Space, queued agent edit and queued rejection, loop toggles, pan typed/drag, and Ctrl+wheel notch all retained their expected store assertions. The focused probe is authoritative for the clip final-position and cross-track assertions because the monolithic journey continues auto-scroll between its last sampled stage and release and reused mutated page state for its later cross-track target.

Screenshots include:

- `pa-01-mid-drag.png`, `pa-02-committed.png` — continuous long drag and committed result.
- `pa-03-ghost.png`, `pa-04-dropped.png` — cross-track ghost and drop.
- `pa-05-held-7s.png` — watchdog survival.
- `g3-01-long-drag.png`, `g3-03-seek-immediate-space.png`, `g3-04-wheel-60.png`.
- `02-burst-then-drag.png`, `03-drag-held-7s.png`, `04-drag-committed.png`, `06-agent-mid-drag.png`, `08-loop.png`, `09-pan-typed.png`, `10-pan-drag.png`, `11-zoom.png`.

`journey.json`, `probe-a.json`, and `probe-c.json` report zero console errors/pageerrors.

## UNVERIFIED

- The monolithic browser run found zero hit-testable lane piano-roll notes and therefore skipped its browser note release-outside and pointercancel subcases. This is the already-recorded Wave 3 note-hit-testing follow-up and was not changed here. The production gesture paths remain covered by the passing PianoRoll component tests: release on window after capture loss commits once, and pointercancel restores with zero entries.
- Audible behavior, clicks/dropouts, native executor behavior, real audio-device loss, macOS, and a human-performed feel/latency judgment were not verified. The headless browser uses the silent wasm path.
