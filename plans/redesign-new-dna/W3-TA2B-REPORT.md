# Wave 3 TA2b fix report

Date: 2026-08-29  
Worktree: `C:\Users\olimt\.t3\worktrees\openjammer\t3code-2faff191`

## Outcome

TA2b's blocking regressions and requested TypeScript-owned timeline behavior are implemented. The focused gate is 60/60 files and 593/593 tests after the ruler regression pin; the one final full run is 181/181 files and 1923/1923 tests. TypeScript, configured-tree ESLint, and `git diff --check` pass. The exact requested ESLint invocation remains a repository-configuration failure because the `pi-openjammer-graph` directory argument is globally ignored; the source trees lint clean and TypeScript plus the parity test cover its `index.ts` change.

The clean Node/Playwright run used one Chromium at a time on port 5201, produced zero console/page errors, and stopped the server. Its authoritative evidence is `plans/redesign-new-dna/.scratch/w3-ta2b/probe-d.json` plus `d-draw-ghost.png`, `d-snap-hairline.png`, and `d-final.png`.

## Must-fix contract

| Review item | Change | Pinning test and pre-fix failure | Browser evidence |
|---|---|---|---|
| 1. Inline piano-roll keyboard | One memoized `surface: 'pianoroll'` set is selected by the focused roll rather than UI mode (`src/components/PianoRoll/PianoRoll.tsx:500-538`, `src/keymap/arbiter.ts:27-57`). | `PianoRoll.test.tsx:116` failed before because inline mode registered no usable piano-roll set. | `probe-d.json:inlineRollKeyboard`: `[57,60,64]` → `[58,61,65]`, pass. |
| 2. Step entry | Added letters, Space, Backspace and Z/Shift+Z; T arms Step; V/B/X/K guards yield while armed (`PianoRoll.tsx:525-533`). | `PianoRoll.test.tsx:129` failed because the binding set never routed the step grammar and tool bindings consumed keys first. | `stepPriority`: T armed `t0`, three notes inserted, cursor advanced, tool remained `select`, pass. |
| 3. Follow-playhead | Clip press disarms follow and release no longer restores it (`useClipGesture.ts:199`). Starting playback explicitly re-arms it (`ArrangementSurface.tsx:99`). | `ArrangementSurface.test.tsx:205` failed because release restored the press-time snapshot. | `followAndSnap.followAfterRelease=false`, pass. |
| 4. Escape cascade | Piano-roll binding now clears selection, then calls close; editable controls blur first (`PianoRoll.tsx:530`, `PianoRollSurfaceHost.tsx:49`). | `PianoRoll.test.tsx:149` failed because Escape had no surface binding. | First Escape retained piano roll and cleared notes; second changed surface to arrangement with zero visible rolls. |
| 5. Truthful timeline docs | Replaced aspirational D2/Draw/keyboard claims with shipped behavior and an explicit honest-gaps list (`docs/timeline.md:70-127`, `:200-213`). | Documentation behavior is pinned indirectly by the feature tests below; false brace/hairline styling claims were removed after browser inspection. | Clean probe records the interactions the document claims; CSS and RT gaps are named below. |
| 6. Draw hint | B selects Draw; empty-lane pointer ownership renders `data-draw-ghost`, then commits `createClip`; click/double-click is one bar (`ArrangementSurface.tsx:147`, `:259-353`, `:373`). | `ArrangementSurface.test.tsx:249` failed before because B/Draw had no caller and the hint advertised nothing real. | `drawClip`: ghost=1, clips/sources +1, one history entry, one undo restores both counts. |
| 7. Pi parity | Added `createClip {trackId,startTick,lengthTick,name?}` to the root Pi schema (`pi-openjammer-graph/index.ts:488-492`) and tool docs (`src/ai/tools.ts:211-217`, `docs/agent-tools.md:117`). | `piToolParity.test.ts` was the sole baseline red test because UI advertised an op absent from Pi. | Parity test passes in focused and full suites. |
| 8. Snap indicator | Every owned snapping family writes/clears the indicator; Arrangement subscribes reactively and renders the tick transform (`editingContextStore.ts:109-134`, `ArrangementSurface.tsx:45`, `:370`, `useClipGesture.ts:101-103`, `RulerStack.tsx:43-54`, `AutomationLaneView.tsx:29-33`, `PianoRoll.tsx:175-178`). | `ArrangementSurface.test.tsx:205` failed because the setter had no caller; `editingContextStore.test.ts:28-44` pins displacement/radii/unification. | `followAndSnap`: element=1, indicator=3840 during drag, null on release; screenshot `d-snap-hairline.png`. |
| 9. Empty-lane controller | Removed the vertical-half switch. Press-time Alt selects marquee; plain selects range; Ctrl toggle/Shift extend; cancellation uses the shared lifetime and selection abort (`ArrangementSurface.tsx:259-353`, `pointerGestureLifetime.ts:16-61`). | `ArrangementSurface.test.tsx:228` failed because Alt was ignored and pointer cancellation leaked the selection operation. | `emptyLaneModes`: plain range/no clips; Alt clips/no range, pass. |

## TA2b punch list

### Gestures

- Done — empty-lane selection uses `ownPointerGesture`; Escape stops immediate propagation (`pointerGestureLifetime.ts:38-44`); cancel/blur/unmount abort exact state. Pins: `ArrangementSurface.test.tsx:122-179`, `pointerGestureLifetime.test.ts`.
- Done — piano-roll note paint, velocity paint/Alt-ramp, key-bed and scroomer use the controller (`PianoRoll.tsx:245-343`, `:608`, `:666-721`). Capture-loss note tests at `PianoRoll.test.tsx:51-78` pin the shared ownership rule. Velocity paint/ramp and key-bed/scroomer do not yet have dedicated DOM pinning tests; they remain listed under UNVERIFIED.
- Done — timeline-owned `setPointerCapture` calls are guarded in clip, ruler, track, mixer, automation and piano-roll code. The capture-loss and window-up tests pin why this matters.
- Done — brace creation/move uses a 4 px activation threshold (`RulerStack.tsx:57-83`). Its row is not visually reachable because CSS is outside this lane; see Left undone.
- Partial — ruler scrub owns the complete pointer stream and the cleared-`currentTarget` regression is pinned at `ArrangementSurface.test.tsx:311`; there is no separate stopped-only audible scrub command to verify.
- Done — explicitly unbound local defaults no longer fall back (`arbiter.ts:17-24`); `arbiter.test.ts:57` failed on old fallback behavior.

### Snap

- Done — removed `snapTick`/`snapTimelineTick`; `snapTimeline` is the only implementation (`editingContextStore.ts:109-134`). `editingContextStore.test.ts:41` sends the former clip/note/ruler cases through the same function; grid `none` still permits anchors.
- Done in TypeScript — indicator state, reactive element and transform ship; visual CSS is explicitly assigned to the CSS lane and is not present in this worktree.
- Partial — loop/punch edges are included because all location edges are candidates (`useClipGesture.ts:184-187`), but multi-selection group-edge candidate projection is not implemented.

### Selection and navigation

- Done — D2 and Ctrl/Shift semantics (`ArrangementSurface.tsx:259-353`).
- Done — Ctrl+Alt arrows with Shift extension, Ctrl+Left/Right markers, brackets, clip Up/Down, Alt bar nudge and V/B/X/K/T (`ArrangementSurface.tsx:147-153`). `ArrangementSurface.test.tsx:278` pins the combined navigation contract; each action had no prior binding/caller.
- Done — header width comes from `trackLaneViewStore` in playhead and clip auto-scroll (`PlayheadLayer.tsx:9-18`, `useClipGesture.ts:154-165`).
- Unverified with live audio — Home/End, L and double-stop T27 need native/wasm transport frames, not a headless mocked AudioContext.
- Left undone by ownership — the new local action ids are not in the Settings catalogue/conflict UI because `src/store/keybindingsStore.ts` and Settings were outside the user-owned paths.

### Piano roll

- Done — inline/full-surface bindings, Step and Escape are covered above.
- Done — plain wheel leaves velocity untouched; Alt+wheel edits it; Ctrl+Shift+wheel changes pitch scale (`PianoRoll.tsx:559-580`). Pins: `PianoRoll.test.tsx:79-114`.
- Done — binding set is memoized (`PianoRoll.tsx:500-538`); piano playhead uses shared rAF (`:653-663`); beyond-clip edits emit visible status (`:301`, `:635`); erase is restricted to right-click or left+Erase (`:347-366`).
- Done in code, not dedicated DOM-pinned — key-bed/scroomer and velocity paint/Alt-ramp (`:608`, `:666-721`).

### Ruler and markers

- Done — marker double-click/create, inline rename and drag use the shared verbs; `aria-hidden` was removed; section selection is a reactive subscription; async ruler callbacks retain their element (`RulerStack.tsx:34`, `:86-119`). The current-target pin fails on the old code because React clears `currentTarget` before the window move callback.
- Left undone by CSS ownership — `.arrangement-braces-row` still has computed height 0; the visible 64 px split/T10 cannot ship from this lane. The TypeScript controller exists but docs call the interaction unavailable.

### Vocabulary, agent and track headers

- Done — Pi createClip parity, Draw caller and agent documentation as above.
- Done — native colour input calls `setTrackColor` (`TrackLaneView.tsx:72`); `ArrangementSurface.test.tsx:301` failed before because there was no caller.
- Done — unchanged rename blur is history-neutral (`TrackLaneView.tsx:72`).

### Hot paths and hygiene

- Done — meter and track-level DOM writers share one executor level subscription and shared rAF (`timelineSignalLevels.ts:1-21`, `MixerDrawer.tsx:8-16`, `TrackLaneView.tsx:63`). `sharedAnimationFrame.test.ts:7` pins one scheduled frame for all writers.
- Done — piano and arrangement playheads do not resubscribe per tick (`PianoRoll.tsx:653-663`, `PlayheadLayer.tsx:9-28`).
- Done — bounded gesture unwinding, structural nested-verb equality, dead lost-capture handlers removed, source lane is not a drop target, and edge auto-scroll stops after 400 ms (`arrangementStore.ts:92-115`, `:570-615`, `useClipGesture.ts:150`, `:154-169`).
- Left undone — automation preview remains authored-document re-conduction at a bounded 20 Hz (`AutomationLaneView.tsx:29-36`). A direct RT parameter-preview command requires an executor/audio protocol seam outside the owned files; no unsafe parallel path was invented.

### Harness

- Clean authoritative TA2b probe: `probe-d.json`, all six result groups pass, `consoleErrorCount=0`.
- The copied legacy A/B/C gate harnesses were run under Node and retained as diagnostics. They are not accepted as green evidence: they assume stale geometry/state isolation, use synthetic touch, and some runs were interrupted by concurrent HMR edits in the shared CSS/package lane. Their JSON records the failures rather than hiding them.
- Real CDP touch T39, native audio T27/Home/End, and a clean full legacy T-list/Wave-1 browser replay remain UNVERIFIED.

## Verification pasted

```text
bun run test:run -- src/song src/components/Arrangement src/components/PianoRoll src/store src/keymap src/ai
PASS — 60 files, 592 tests (then 593 focused tests after adding the ruler currentTarget pin).

bunx tsc --noEmit -p tsconfig.app.json
PASS — exit 0.

bunx eslint src packages e2e pi-openjammer-graph
FAIL (configuration) — ESLint 10.8.1 reports the entire `pi-openjammer-graph` argument is ignored.

bunx eslint src packages e2e
PASS — exit 0, no warnings.

git diff --check
PASS — exit 0; only CRLF conversion warnings.

bun run test:run
PASS — 181 files, 1923 tests.

node --experimental-strip-types plans/redesign-new-dna/.scratch/w3-ta2b/probe-d.ts
PASS — inline roll, Step priority, Escape cascade, Draw/undo, D2, snap/follow; zero console/page errors.
```

## Left undone

1. Direct RT automation parameter preview — executor/audio protocol is outside lane ownership; current preview is bounded authored re-conduction.
2. Settings catalogue/conflict entries for new local timeline actions — Settings and `keybindingsStore.ts` were outside ownership.
3. CSS-only visible ruler brace row, snap hairline and level bead styling — `.css` was explicitly outside ownership.
4. Multi-clip group-edge magnetic anchor projection.
5. Dedicated DOM pinning for key-bed/scroomer and velocity paint/Alt-ramp.

## UNVERIFIED

- Real audio feel: no-click/no-dropout latency judgment, stopped-only audible ruler scrub, Home/End and T27 against delivered engine frames.
- T39 through real CDP `Input.dispatchTouchEvent`.
- A clean full legacy gate T-list and Wave-1 browser replay after the concurrent lane settles. The authoritative TA2b-specific browser probe is green, but it is not a substitute for those broader journeys.
- Visual judgment for CSS-owned brace/hairline/level-bead presentation.

No git add, commit, stash, checkout, or reset was performed.
