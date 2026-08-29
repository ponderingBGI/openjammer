# Wave 3 TA2c — timeline gesture controller fix report

Date: 2026-08-29  
Worktree: `C:\Users\olimt\.t3\worktrees\openjammer\t3code-2faff191`

## Outcome

All eight TA2b review findings and the documentation follow-up are fixed and pinned. The
shared timeline still uses one `Arrangement`/Verb/history path; no parallel editor or core
DSP path was introduced. The only new stylesheet is
`src/components/Arrangement/gestureHandles.css`, and it contains structural geometry only.

## Findings 1–8 and documentation

### 1. Nested keymap fallback and document history

- `src/keymap/arbiter.ts:51` resolves inside-out: focused set, enclosing DOM surfaces,
  active app surface when absent from that ancestry, then global. Modals remain exclusive.
- `src/components/PianoRoll/PianoRoll.tsx:569` registers shared document undo/redo in the
  piano-roll set; arrangement history remains at `ArrangementSurface.tsx:101`.
- Pins: `src/keymap/__tests__/arbiter.test.ts:57` and
  `src/components/PianoRoll/__tests__/PianoRoll.test.tsx:129`. They fail on the reviewed
  code because a focused child surface walls off the arrangement set and the piano-roll
  set has no history actions.
- Browser: `probe-ta2c.json.inlineUndoRedo` records `57 → 58 → 57 → 58`; full-roll undo
  records `58 → 57 → 58`.

### 2. Reachable lane/header handles

- `src/components/Arrangement/gestureHandles.css:10` gives the lane divider an absolute
  5 px bottom hit box and `ns-resize`; `gestureHandles.css:19` gives the header edge a
  6 px absolute column and `col-resize`.
- `src/components/Arrangement/TrackLaneView.tsx:143` implements single-lane drag,
  Alt-all-lanes, Escape restoration, and double-click content fit. Header resize is at
  `src/components/Arrangement/ArrangementSurface.tsx:245`.
- Pin: `src/components/Arrangement/__tests__/ArrangementSurface.test.tsx:331` reads the
  shipped structural stylesheet and asserts both dimensions/cursors. It fails on the
  reviewed code's static, zero-height boxes.
- Browser: `probe-g5.json.resizeHandles` records 5 px/6 px boxes and passes lane change,
  header change, Alt-all-lanes, and double-click fit.

### 3. Positioned ruler loop bracket

- `src/components/Arrangement/RulerStack.tsx:117` positions the bracket from loop ticks,
  `pxPerTick`, and `scrollLeft`; brace create/move/resize remains intact.
- Structural bracket geometry is in `gestureHandles.css:80`.
- Pin: `ArrangementSurface.test.tsx:346` asserts start 3840 at 0.1 px/tick with 96 px
  scroll produces x=288 and width=384. It fails when the positioned bracket is absent and
  the brace glyphs paint at a fixed x.
- Browser: `probe-ta2c.json.loopBracket` records actual x 488, expected x 488, canonical
  scroll 96, drift 0.

### 4. Reachable marker creation and parity

- `src/components/Arrangement/RulerStack.tsx:119-125` creates a marker from the uncovered
  marks row or a section chip's empty band while preserving label double-click rename.
- `src/components/Arrangement/ArrangementSurface.tsx:145` registers Ctrl+M at the
  playhead. `src/song/ops.ts:9,19,93`, `src/ai/arrangementAdapter.ts:118`, and
  `pi-openjammer-graph/index.ts:493` carry `addMarker` through EDIT_OPS, adapter, and Pi
  schema parity.
- Pins: `ArrangementSurface.test.tsx:358`, `src/song/__tests__/addMarker.test.ts:12`, and
  `src/ai/__tests__/arrangementTools.test.ts`. They fail on the reviewed code because chips
  consume the double-click and no marker op/action exists.
- Browser: `probe-ta2c.json.markerDoubleClick` records 4→5 locations;
  `markerKeyboard` records 4→5→4 across Ctrl+M and Ctrl+Z.

### 5. Dead forks removed

- `src/components/Arrangement/dragController.ts:1` now contains only the production
  `DragAxis` type and `autoScrollDelta`; the threshold helpers and duplicate
  `COPY_DRAG_X_THRESHOLD_PX` are gone.
- `src/components/Arrangement/pointerGestureLifetime.ts:63-74` is the sole threshold owner.
  `scrollVelocityEditing` is removed from `src/store/editingContextStore.ts` and its tests.
- Pins: `src/components/Arrangement/__tests__/pointerGestureLifetime.test.ts:47` and
  `src/song/__tests__/editingContracts.test.ts:51` exercise the one surviving threshold
  implementation. The reviewed duplicate path would leave two independently changeable
  owners, while the deleted state had no production reader.

### 6. Non-vacuous snap-unification proof

- `src/store/__tests__/editingContextStore.test.ts:41-52` feeds hand-computed clip-edge,
  note, and ruler inputs through `snapTimeline`: grid=100, anchor wins the 6-tick tie at
  112, sub-3px/unit grid is disabled while anchor 17 remains, and no-grid keeps anchor 48.
- This fails on the reviewed test because that test only compared three identical argument
  objects and established no expected timeline law.

### 7. Stable playhead subscription and non-passive wheel paths

- `src/components/PianoRoll/PianoRoll.tsx:665-672` uses a ref-based playhead writer with
  one shared-frame registration while playing and one store subscription while stopped.
- Wheel handlers that call `preventDefault` are native non-passive listeners at
  `PianoRoll.tsx:265` and `PianoRollSurfaceHost.tsx:52`.
- Pins: `PianoRoll.test.tsx:146` counts shared-frame registrations across published ticks;
  `PianoRoll.test.tsx:159` asserts `{ passive:false }` and no jsdom console error. They fail
  on the reviewed code's tick-dependent effect and passive React wheel handlers.
- Browser: the focused probe drives plain and Ctrl-wheel paths; all final browser JSON has
  zero console/page errors.

### 8. Automation gestures

- Production gestures continue through the shared `setAutomationPoint`,
  `moveAutomationPoints`, and `setAutomationRange` path in
  `src/components/Arrangement/AutomationLaneView.tsx`.
- Pin: `src/components/Arrangement/__tests__/AutomationLaneView.test.tsx:37-76` verifies
  double-click add is one entry, point drag is one entry, Escape restores exactly with no
  entry, and Shift-select plus range drag is one `setAutomationRange` entry. These browser
  reachability/history assertions were absent in the reviewed code.
- Browser: `probe-g5.json.automation` passes with add=1, drag=1, Escape=0/restored, and
  range=1.

### 9. Documentation

- `docs/timeline.md:88-99` documents marker paths and physical handles/bracket.
- `docs/timeline.md:119-125` documents the exact nested resolution order and shared
  history behavior.
- `docs/timeline.md:216-229` names only shipped honest gaps; reachable brace/handle work is
  no longer listed as missing.

## Browser evidence

All Playwright probes ran through `node --experimental-strip-types` against one Chromium
at `http://localhost:5209`; the Vite server and its child listener were stopped afterward.

- `plans/redesign-new-dna/.scratch/w3-ta2c/probe-ta2c.json` — items 1, 3, 4, 7 plus pan
  and double-stop; every asserted field passes, zero console/page errors.
- `plans/redesign-new-dna/.scratch/w3-ta2c/probe-g5.json` — automation, piano gestures,
  5/6 px resize handles, Alt-all, double-click fit, cross-track ghost, the +450 px drag
  continuation/edge-scroll lifetime, loop policy, and queued agent edit; all in-scope
  assertions pass, zero console/page errors.
- `plans/redesign-new-dna/.scratch/w3-ta2c/ta2c-targeted.png` and `g5-final.png` are the
  final screenshots. The copied G1/G2 JSON/screenshots are retained as diagnostic evidence;
  their old broad selectors predate the concurrently mounted transition surfaces and are
  not used as the TA2c verdict.

Wave 1 regression evidence: the cross-track gesture kept two ghosts, all three source lanes,
and one drop target alive through the +450 px continuation; edge scrolling stopped after
pointer release. The queued edit returned `status: queued`, left `Bass` unchanged during the
gesture, then applied `Agent` afterward. Loop creation/play policy passed, double-stop passed,
and typed pan changed Bass from 0 to 0.5 in one history entry.

## Verification

- `bun run test:run -- src/song src/components/Arrangement src/components/PianoRoll src/store src/keymap src/ai` — **63 files, 630 tests passed**.
- `bunx tsc --noEmit -p tsconfig.app.json` — passed.
- `bunx eslint src` — passed.
- `git diff --check` — passed (line-ending warnings only).
- Final `bun run test:run` — **194 files, 2097 tests passed**; no retry required.
- Port 5209 after teardown — no listener.

## UNVERIFIED

- Human-perceived audio feel (clicks, dropouts, or added latency) is not verifiable in
  headless Chromium. Browser/audio code paths and the full automated suite are green, but a
  musician listening on real hardware remains the final authority.
- TB's later visual styling is intentionally not judged here. TA2c verifies only reachable
  structural geometry; no colour or aesthetic CSS was added.

