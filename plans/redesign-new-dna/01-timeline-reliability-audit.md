# OpenJammer timeline reliability audit

Date: 2026-08-28  
Scope: arrangement, piano roll, transport, mixer, automation, recording, timeline playback, focus/keymap, and the requested tests.  
Method: read-only source/test inspection, targeted Vitest run, attempted Playwright production E2E, and attempted system-Chrome interaction harness. No files under `src/`, `packages/`, `crates/`, or `e2e/` were changed.

## Executive assessment

The pure editing model is substantially better tested than the interaction shell: all 367 requested unit tests pass, and BC-05/06/09/10/12/14/17/19–21/23/25–37 have pure-operation coverage. The live interaction layer is not release-reliable yet. Two piano-roll basics are broken (full-surface undo/redo and scrolling), loop playback is guaranteed to stop incorrectly, and many pointer gestures lack a complete cancel/lost-capture/unmount lifecycle. Several documented interactions are simply not implemented (ruler scrub, editable loop braces, track rename/reorder/add/remove/resize).

Runtime browser sign-off is unavailable from this machine because the configured Chromium revision is absent and the C: drive ran out of space while Playwright attempted to install/build it. System Chrome also could not complete launch through Playwright under the remaining disk pressure. Therefore findings marked **verified** below are source-reachable defects, not claims that a full user journey was successfully reproduced. No screenshots were produced; that absence is evidence-bound, not a silent omission.

## A. Test results

### Unit timeline scope

Exact command:

```powershell
bun run test:run -- src/song src/components/Arrangement src/components/PianoRoll src/store
```

Result: **PASS**, exit code 0.

- 41 test files passed, 0 failed.
- 367 tests passed, 0 failed.
- Vitest duration: 36.33s.
- No failing test existed to rerun for flake classification.
- Expected stderr came only from passing negative-path graph-store tests for corrupt/missing localStorage state.

### Existing arrangement E2E

Exact command:

```powershell
bunx playwright test e2e/arrangement-editing.spec.ts --project=chromium
```

Result: **NOT EXECUTED (infrastructure failure)**, exit code 1 after approximately 52.7s.

- Playwright ran the configured production build and started preview on port 4173.
- Before test discovery/execution completed it failed with `ENOSPC: no space left on device, write`, then `No tests found`.
- 0 tests executed; 0 product passes/failures can be inferred.
- C: had 277,680,128 bytes free immediately afterward.
- Port 4173 was no longer listening after exit.

### Requested live interaction exercise

`bun dev` started Vite successfully at `http://localhost:5173`. A custom harness was written at `plans/redesign-new-dna/.scratch/timeline-audit.ts` to run both Paper Sketch and First Light and capture state, console/page errors, undo equality, and screenshots. Playwright's expected Chromium binary was absent. The permitted repair command:

```powershell
bunx playwright install chromium
```

downloaded the 183.6 MiB archive but repeatedly failed at extraction/write with `ENOSPC`. A fallback launch against installed system Chrome (`C:\Program Files\Google\Chrome\Application\chrome.exe`) also failed to complete under disk pressure. Consequently **0 custom browser interactions completed and 0 screenshots were generated**. The Vite server started for the audit was stopped at the end (see verification in §E).

## B. Findings

Severity: **P0** broken fundamental workflow; **P1** unreliable/janky or data/history risk; **P2** polish/discoverability/accessibility.

| ID | Severity | Status | Interaction and repro | Expected vs actual | Root cause | Suggested fix | Screenshot |
|---|---|---|---|---|---|---|---|
| TL-01 | P0 | Verified | Enable loop and play through the authored end. | Loop continues; actual end watchdog always stops it. | `src/store/arrangementStore.ts:81-94,103-116` arms the end timer regardless of loop state. | Do not arm the non-loop end watchdog while looping; reconcile from authoritative engine frames. | None; browser blocked |
| TL-02 | P0 | Verified | Full piano roll: edit a note, press Ctrl+Z/Ctrl+Shift+Z. | Shared song history undoes/redoes; actual piano-roll surface has no binding and arrangement bindings are filtered. | `src/components/Arrangement/ArrangementSurface.tsx:58-90`; `src/keymap/arbiter.ts:49-53`; `src/components/PianoRoll/PianoRoll.tsx:314-385`. | Register a complete piano-roll binding set over the unified history store and test each gesture with exact undo. | None |
| TL-03 | P0 | Verified | Full piano roll: wheel/trackpad to later bars or pitches. | Field/ruler/velocity/keys scroll in sync; actual field is `overflow:hidden`, and host handles only Ctrl/Meta-wheel zoom. | `src/components/PianoRoll/PianoRoll.css:51,82`; `PianoRollSurfaceHost.tsx:39-43`. | Add one authoritative horizontal/vertical scroll model and synchronized rendering. | None |
| TL-04 | P0 | Verified | Focus Strength/Swing/select in piano-roll toolbar with notes selected; press arrows/Delete/Q. | Input owns editing keys; actual bubbled local shortcuts can transpose/delete/quantize notes. | `PianoRoll.tsx:314-385,422-424`; editable protection exists only in later window arbiter at `keymap/arbiter.ts:22-25`. | Early-return for editable targets and centralize shortcuts in the surface keymap. | None |
| TL-05 | P1 | Verified | Alt-copy-drag then save/reopen and create more entities. | IDs remain unique and counter persists; actual gesture can overwrite the newly advanced `idCounter` with a stale preview base. | `useClipGesture.ts:72`; `arrangementStore.ts:364-375,387-410,431-435`. Same pattern for note copy at `PianoRoll.tsx:182-185`. | Make allocation transaction-local and atomically persist counter with commit; regression-test consecutive copy gestures across reload. | None |
| TL-06 | P1 | Verified | Alt-copy a clip vertically to another track. | Copy lands on hovered track; actual copy previews rewrite only `startTick`. | `useClipGesture.ts:72,80,92-97`. | Apply the normal track-delta mapping to stable pre-minted copy verbs. | None |
| TL-07 | P1 | Verified | Begin arrangement marquee/range then cause pointercancel/lost capture. | Gesture aborts/commits exactly once; actual selection transaction can remain open. | `ArrangementSurface.tsx:194-247` has down/move/up but no cancel/lost-capture cleanup. | Add cancel/lost-capture/blur/unmount terminal handling and `abortSelectionOp`. | None |
| TL-08 | P1 | Verified | Shift or Alt+Shift drag a clip into edge autoscroll. | Axis lock/relative snap remain stable; actual RAF fabricates `shiftKey:false, altKey:false`. | `useClipGesture.ts:77-86,100-112`. | Freeze gesture mode or retain real modifier state for RAF previews. | None |
| TL-09 | P1 | Verified | Press and drag on ruler. | Continuous scrub with capture/cancel; actual only initial pointer-down seeks. | `RulerStack.tsx:38`. | Implement captured down/move/up/cancel scrub with throttled visual seek and defined rolling policy. | None |
| TL-10 | P1 | Verified | Create or adjust loop from ruler braces. | Accessible range handles edit one reversible location; actual bracket is display-only. | `ArrangementSurface.css:155`; `RulerStack.tsx:9-39`. | Add semantic start/end handles and range-create gesture with snapping and compound verb. | None |
| TL-11 | P1 | Verified | Shift-drag an automation range, release/cancel, then move again. | Range finalizes or aborts; actual state has no up/cancel terminal path and can remain stale. | `AutomationLaneView.tsx:58-66`. | Handle pointerup/cancel/lost-capture, release capture, and explicitly commit/abort. | None |
| TL-12 | P1 | Verified | Edit mixer pan with pointer; undo once. | One gesture is one undo; actual `onPointerUp` gesture commit and `onCommit` can each write history. | `MixerDrawer.tsx:64-76`. | Give `ValueScrubber` one transaction owner; add exact one-undo browser test. | None |
| TL-13 | P1 | Verified | Burst Ctrl-wheel zoom while horizontally scrolled. | Grid/ruler/clips stay locked; actual unbounded RAFs and stale `pxPerTick` closures can overwrite viewport state. | `ArrangementSurface.tsx:168-188`. | Coalesce into one RAF, read current scale from store, cancel RAF on unmount, preserve cursor anchor. | None |
| TL-14 | P1 | Verified | Start clip drag, switch surface/unmount before release. | Gesture aborts and listeners/history close; actual global listeners/RAF survive unless `finish` runs. | `useClipGesture.ts:54-58,152-169`. | Stable unmount cleanup calling `finish(false)`; prefer capture + lost-capture over duplicate pointer/mouse listeners. | None |
| TL-15 | P1 | Verified | Executor seek/play publication fails or acknowledgement differs by a block. | Pending clears with honest error/recovery; actual pending can wedge and later frames are rejected. | `arrangementStore.ts:458-468,542-548`. | Catch failure, use tagged acknowledgements/tolerance, bounded timeout, and preserve last-good state. | None |
| TL-16 | P1 | Verified | Armed track: make conduct/executor start fail, then Record. | Recording fails closed; actual UI can claim play/record with no valid bindings. | `arrangementStore.ts:69-100,523-526`. | Begin recording only after successful lowering/start; restore state and journal an actionable failure. | None |
| TL-17 | P1 | Verified | Stop recording, immediately switch/load another song. | Capture binds to originating document; actual async completion applies to latest arrangement. | `arrangementStore.ts:240-265`. | Carry document/session generation across await; reject or recover mismatched capture explicitly. | None |
| TL-18 | P1 | Verified | Open/close inline piano roll after a custom lane height. | Previous height returns; actual close hard-resets to 72px. | `trackLaneViewStore.ts:55-69`. | Persist collapsed/previous height separately. | None |
| TL-19 | P1 | Verified | Resize window with full piano roll open. | Layout updates immediately; actual host reads `window` during render without resize subscription. | `PianoRollSurfaceHost.tsx:23-24,33-35,43`. | Measure host with `ResizeObserver`. | None |
| TL-20 | P1 | Verified | Cancel/lose capture while dragging a note. | Gesture closes and audition always sends off; actual cancel can leave held audition/history state. | `PianoRoll.tsx:174-214,447`. | Shared terminal controller for up/cancel/lost-capture/blur/unmount; always note-off exactly once. | None |
| TL-21 | P1 | Verified | Inline piano roll: select notes then Ctrl+C/X/V. | Clipboard acts on inline selection; actual actions are hard-coded to `pianoroll` while selection lives under `arrangement`. | `PianoRoll.tsx:79-80,158-172,349-351`. | Pass `selectionSurface` consistently. | None |
| TL-22 | P1 | Verified | Wheel velocity edit over selected notes. | One intentional wheel burst is one undo; actual every wheel event records and republishes. | `PianoRoll.tsx:405-412`; `arrangementStore.ts:332-357`. | Begin/preview/debounced single commit with cancellation cleanup. | None |
| TL-23 | P1 | Verified | Draw/step-enter beyond MIDI clip end. | Extend/clamp/reject visibly; actual invisible source notes may be committed beyond the clip window. | `PianoRoll.tsx:222-229,249-258,317-339`; clipping at `PianoRoll/geometry.ts:47-60`. | Choose explicit product rule, enforce before commit, keep cursor/result visible. | None |
| TL-24 | P1 | Verified | Rapid audition, close surface, or start playback before delayed off. | Every note-on has matched off without stopping new transport; actual global single audition state/timers race and `off` stops preview. | `PianoRoll/actions.ts:28-53`; `PianoRoll.tsx:233-235,337-338`. | Tokenize audition voices, cancel timers, exact-pitch release, separate audition from transport ownership. | None |
| TL-25 | P1 | Verified | Tab through timeline/piano controls. | Normal focus traversal and surface navigation have a clear non-colliding rule; actual global bare Tab changes surface outside dialogs. | `src/App.tsx:454-464`; `keymap/arbiter.ts:22-31`. | Reserve bare Tab on surface root only or use another chord; retain normal control traversal and restore focus. | None |
| TL-26 | P1 | Verified | Hold a key in step-entry mode. | One physical press inserts once; actual OS repeat sprays notes/advances. | `PianoRoll.tsx:314-340`. | Reject `event.repeat` unless repeat-entry is an explicit mode. | None |
| TL-27 | P2 | Verified | Hover clip/note trim edges. | Cursor and target expose resize; actual clip zones are 4–12px and note zones up to 8px but cursor remains grab/default. | `useClipGesture.ts:129-131`; `ArrangementSurface.css:307-338`; `PianoRoll/geometry.ts:39-45`; `PianoRoll.css:61`. | Render semantic edge handles matching hit math with `ew-resize` and short-object keyboard fallback. | None |
| TL-28 | P2 | Verified | Read clip bar labels in non-4/4 or at exact boundary. | Time-signature-correct inclusive/exclusive label; actual 3840 ticks is hard-coded and boundary is overstated. | `ClipView.tsx:95-109`. | Use `timebase`/`tickToBarBeat` and define end-label policy. | None |
| TL-29 | P2 | Verified | Rename/reorder/add/remove/resize a track. | Documented DAW interactions are available/reversible; actual header is static and grab is decorative, with no callers for lane resize. | `TrackLaneView.tsx:60-63`; `trackLaneViewStore.ts:30,51-53`. | Add reversible controls and captured reorder/resize lifecycles; test undo and focus. | None |

## C. Code-level defects and concrete remediation

The table above contains the actionable defects. The following cross-cutting repairs should be treated as architecture work, not one-off patches:

1. **Adopt one pointer-gesture lifecycle.** Arrangement marquee, clip gestures, automation points/ranges, piano notes/marquee, and pitch scroomer should share down → threshold → preview → commit/abort with pointer ID, capture, `pointercancel`, `lostpointercapture`, blur, Escape, and unmount. Current gaps are at `ArrangementSurface.tsx:194-247`, `useClipGesture.ts:54-58,152-169`, `AutomationLaneView.tsx:58-66`, and `PianoRoll.tsx:174-214,245-312,447,491-499`.
2. **Make editing-context selection authoritative.** Piano roll writes both editing-context and arrangement stores in separate synchronous calls (`PianoRoll.tsx:170-172,308-310,345-346,360-361,457`), while some paths update only one. Remove/derive the duplicate selection state or expose one atomic action to prevent tearing.
3. **Key selection history by surface.** A single global selection history/depth is shared across arrangement and piano roll (`editingContextStore.ts:127-130,181-189,208-226`), and history actions default/reset arrangement selection (`historyStore.ts:79,93,107,115`). Store depth/before/undo/redo per `SurfaceId`.
4. **Make IDs part of the transaction.** Clip and note copy mint against live state but preview from a captured older document. Reserve IDs and resulting counter in the gesture transaction or mint inside deterministic verbs.
5. **Coalesce viewport writes.** Scroll and zoom currently enqueue separate RAF writes with stale render closures (`ArrangementSurface.tsx:168-188`). Use a single controller/RAF and canonical pixel↔tick anchor. Cancel it on unmount.
6. **Avoid full-document work on hot paths.** Automation preview rebuilds arrangements and, while rolling, republishes graph/timeline every 50ms (`AutomationLaneView.tsx:86-94`; `arrangementStore.ts:376-384`). History commit stringifies the entire document synchronously (`arrangementStore.ts:403-408`). Use RT parameter preview and touched-entity/no-op tracking; publish authored state once at commit.
7. **Separate audition, playback, and recording ownership.** Pending transport acknowledgements, global audition timers, recording journals, and song changes currently lack tokens. Use session/document generations and explicit command acknowledgements.
8. **Fix virtualization boundary coverage before rebuilding around it.** `geometry.ts:36-38` uses opaque `findIndex`/`+1 ||` boundary math. No definite wrong result was proven, but add cases for zero tracks, viewport below all lanes, exact boundaries, mixed automation heights, and resize-during-scroll. Track headers also rely on `content-visibility:auto` plus custom slicing, so validate no blank/duplicate lanes after fast scroll.
9. **Respect reduced motion in behavior, not only CSS.** CSS disables transitions, but playhead follow still writes scroll every RAF (`PlayheadLayer.tsx:9-23`) and can fight manual interaction. Under reduced motion, jump only when necessary and never animate scroll; coalesce with the main viewport controller.
10. **Use one scroll path in piano roll.** `xToTick` reads `field.scrollLeft` (`PianoRoll.tsx:148-152`) even though the field is non-scrollable. Eliminate the dead dual-coordinate path and drive all layers from stored origins.

## D. Coverage gaps

### BC contracts

Named unit coverage exists for:

- BC-05/06/09/10/12/14/17/20/21 in `src/song/__tests__/editingContracts.test.ts`.
- BC-19/23/25/26/27/28/29 in `src/song/__tests__/wave4bEditing.test.ts`.
- BC-30–37 in `src/song/__tests__/pianoRollContracts.test.ts`.
- BC-32 edge geometry in `src/components/PianoRoll/__tests__/geometry.test.ts`.
- BC-39/40 pure automation behavior is exercised in `automationContracts.test.ts`, although tests are not named with the BC identifiers.
- BC-01 has history transaction substrate coverage, but not component cancellation or mixer/automation callback ordering.

No named evidence was found in the requested unit directories for **BC-02–04, BC-07–08, BC-11, BC-13, BC-15–16, BC-18, BC-22, BC-24, or BC-38**. `docs/timeline.md` describes only a subset of the BC catalog, so these absences are also a documentation-drift problem: the contract index should say whether each number is active, superseded, or intentionally reserved.

Pure-operation tests do not prove the UI path. Missing component/e2e coverage includes:

- all pointercancel/lost-capture/blur/unmount cases;
- snap modifier preservation during autoscroll and dominant-axis behavior through the actual DOM;
- vertical copy-drag and persisted `idCounter` after clip/note copies;
- exact trim/slip source-window behavior from edge hit zones and cursor affordance;
- marquee object/range selection and exact selection-history recovery;
- ruler scrub and loop brace create/resize;
- song growth and grid snapping after long beyond-end autoscroll;
- scroll/zoom synchronization, sticky headers, virtualization at late positions, window resize, and reduced motion;
- rename/reorder/add/remove/resize track workflows;
- pan one-undo behavior, meters during real audio, automation range lifecycle;
- failed seek/play/record recovery and recording-stop/song-switch race;
- every BC-30–37 component gesture (draw, reverse draw, copy/move, resize, velocity, erase, transpose, step entry, quantize), including inline versus full-surface selection routing;
- piano-roll scroll, focus landing/restoration, Tab/Escape navigation, shortcut isolation, editable-field safety, and held-key repeat;
- tempo text editing isolation, count-in timing, bar.beat correctness across meters/tempo changes, honest stop at release tail, and export dialog options;
- physical audio quality: clicks, dropouts, audition release, meter truth, and latency.

The supplied `timeline-preview.spec.ts` does cover engine-confirmed playhead motion, immutable publication, stop command shape, automation lowering, an inline piano draw/quantize/undo path, and console/page errors. `J1` covers play/mix/export audio assertions; `J2` covers record/loop takes/undo; `J3` covers many arrangement edit families and verb replay. Those are valuable, but none could be executed in this run because of the Playwright/disk blocker.

## E. What could not be verified

- No browser interaction or screenshots completed: missing Playwright Chromium plus `ENOSPC` prevented both install and configured E2E; system-Chrome fallback could not complete launch under the same disk pressure.
- Therefore DOM/store equality, Ctrl+Z exactness, console/page errors, cursor rendering, snapping feel, scrubbing smoothness, sticky/header/grid synchronization, virtualization visuals, responsive behavior, reduced-motion behavior, meters, and both starter journeys remain unverified at runtime.
- No audio was heard. Browser/native latency, clicks/dropouts, held audition notes, loop continuity, stop-at-tail honesty, recording sound, and exported audio quality require a rerun with audio actually playing (and native/hardware where applicable).
- Unsupported versus broken could not always be distinguished from UI at runtime. Source confirms ruler scrub, loop handle editing, and track rename/reorder/add/remove/resize are unwired; other discoverability judgments need the live pass.
- The exact E2E command ran within the requested 15-minute ceiling but executed zero specs; it must be rerun after freeing enough disk for the build/browser cache.

### Recommended rerun gate

Free at least 2–3 GiB on C:, then run:

```powershell
bunx playwright install chromium
bun plans/redesign-new-dna/.scratch/timeline-audit.ts
bunx playwright test e2e/arrangement-editing.spec.ts --project=chromium
```

Treat the custom harness as audit scaffolding, not production coverage: convert each confirmed defect into focused Playwright specs with state snapshots and exact one-step undo assertions.
