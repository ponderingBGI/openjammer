# Wave 3 TA2 report

Date: 2026-08-28. Worktree: `t3code-2faff191`. No git mutation and no CSS/package edit was performed. One read-only `git status --short` was run during initial inspection; no add/commit/stash/checkout/reset occurred.

## 1. Unified gestures

- `pointerGestureLifetime.ts:1-100` owns pointer id, window move/up/cancel, blur, Escape, surface-scoped teardown, coarse thresholds, frozen axis and one-rAF preview. Lost capture is deliberately non-terminal.
- `useClipGesture.ts:40-225` migrates move/copy/trim/slip, fixes pointer-rate preview accumulation by using the pointer-down document, stops stationary edge scrolling after 400 ms and carries real ghost height.
- `MixerDrawer.tsx`, `AutomationLaneView.tsx`, `RulerStack.tsx` and PianoRoll note/draw/marquee/velocity gestures use the controller. Pinning: `pointerGestureLifetime.test.ts`, `useClipGesture.previewBase.test.tsx`, `MixerDrawer.test.tsx`, `PianoRoll.test.tsx`; these fail on the previous element-only/lost-capture and accumulating-preview paths.
- Surface isolation is pinned directly: arrangement abort cannot cancel piano roll.

## 2. Snap

- `editingContextStore.ts:93-138` implements 12 px grid / 18 px anchor radii, anchor tie priority, sub-3-px disabling, live inversion, relative offset and `snapIndicatorTick`.
- `ArrangementSurface.tsx` renders `.arrangement-snap-indicator`; CSS styling remains with the CSS lane.
- BC-06 is amended in `editingContracts.test.ts`; store tests pin every radius/tie/inversion rule.

## 3. Selection

- `ArrangementSurface.tsx` makes empty drag a range and Alt-drag an object marquee; the editing store now has exact `abortSelectionOp` rollback.
- `RulerStack.tsx` writes `sectionIds`; Delete emits `removeLocation` in the arrangement BindingSet.
- Track selection implements Ctrl toggle and Shift range. Keyboard spatial selection is UNVERIFIED/not completed.

## 4. Piano roll

- `PianoRoll.tsx:480-535` registers the piano-roll BindingSet: Space, Q/Ctrl+Q, V/B/X/K/T and editing keys, with repeat/editable-field protection through the arbiter.
- `PianoRoll.tsx` uses a 6 px minimum row and rejects draw/step beyond the clip. `PianoRollSurfaceHost.tsx` uses ResizeObserver. Plain wheel remains navigation; Alt edits velocity; Ctrl zoom and Ctrl+Shift row height share stored viewport coordinates.
- Pinning tests cover note commit/cancel, velocity coalescing and row height. The prior DOM-only keyboard path and 3 px row fail these tests.
- UNVERIFIED: knife/time tool behavior beyond tool selection, paint/ramp gestures, and key-bed/scroomer lifecycle migration.

## 5. Navigation/keymap

- `ArrangementSurface.tsx:90-145` adds rebindable local defaults for E/Q, Shift+Space, Shift+Z, Ctrl+0, +/-, Alt+G, Home/End, L/I/O/P/M/F/0, Ctrl+E, Ctrl+Shift+Backspace and Ctrl+A.
- `PlayheadLayer.tsx` honors `followPlayhead`, using page mode at the right 15% and placing the clock at 1/6. Manual wheel/zoom/field down disarms; F and play-from-selection re-arm.
- UNVERIFIED/not completed: Ctrl marker traversal, grid `[`/`]`, clip cross-track keyboard movement, Alt bar nudge, and Ctrl+Alt spatial selection.

## 6. Shared animation frame

- `sharedAnimationFrame.ts` provides one scheduler. `PlayheadLayer.tsx`, `RecordGhost.tsx`, and `SharedSurfaceChrome.tsx` subscribe rather than owning loops. `sharedAnimationFrame.test.ts` pins one scheduled frame for multiple writers and cancellation at zero subscribers.
- Reduced motion never suppresses the clock; follow is a page jump, not smooth animation.
- UNVERIFIED: all meter/level-bead writers are not yet migrated.

## 7. Track headers and vocabulary

- `TrackLaneView.tsx` implements inline rename, exact-abort lane resize (28–480, Alt all, double-click fit), and pointer-owned reorder. `ArrangementSurface.tsx` adds the 160–320 header divider.
- `verbs.ts` adds exact-inverse `moveTrack` and `setTrackColor`; `ops.ts` adds atomic `createClip` (empty MIDI source + clip), and `arrangementAdapter.ts` exposes it. Tests pin inverse replay and one-step undo.
- Public API changes: `Verb.moveTrack`, `Verb.setTrackColor`, `TimelineOp.createClip`, `EDIT_OPS += createClip`, local BindingEntry defaults, `snapIndicatorTick`.
- BLOCKED by explicit ownership: `packages/pi-openjammer-graph/index.ts` does not advertise `createClip`. `piToolParity.test.ts` intentionally fails until the package lane adds `Type.Literal('createClip')` with `trackId/startTick/lengthTick`.
- UNVERIFIED/not completed: empty-lane B/double-click UI caller and track-colour picker caller.

## 8. Hot paths/virtualization

- `arrangementStore.ts` removes synchronous full-document `JSON.stringify` from gesture commit.
- `geometry.ts` uses explicit half-open lane boundaries; tests cover zero tracks, below-all, exact/mixed heights and resize during scroll.
- `ArrangementSurface.tsx` keeps every active dragged clip lane mounted; drag ghost uses the real height.
- UNVERIFIED: automation preview still creates authored preview documents; a direct RT-parameter preview path was not completed.

## 9. Documentation

- `docs/timeline.md` records D1/D2/D3/D4/D5/D6/D7/D8/D11/D12/D18, surface gesture ownership, loop-without-range, queued edits, piano-roll beyond-end rejection and playing-edit publication policy.

## Browser evidence

- Harness: `.scratch/w3-ta2/journey.ts`, run with `node --experimental-strip-types`, one Chromium, server `5197` stopped afterward.
- Result: `.scratch/w3-ta2/journey.json`; screenshot: `.scratch/w3-ta2/ta2-arrangement.png`. Assertions passed for three tracks, the three ruler rows, snap toggle, real-height ghost, Escape restoration and zero console/page errors.
- UNVERIFIED: requested T1-T39 catalogue and full Wave 1 browser regression were not fully automated in this run; audible behavior, native executor and physical latency remain human/audio checks.

## Verification

- `bunx tsc --noEmit -p tsconfig.app.json`: PASS.
- `bunx eslint src packages e2e`: PASS.
- Owned targeted suite: 59 files pass, 562 tests pass; only the two intentional package-schema parity failures remain.
- Full suite (once): 176 files pass, 1731 tests pass; only the same two `piToolParity.test.ts` failures remain.
- Impeccable hook findings are in concurrently owned CSS (`ArrangementSurface.css` and `PianoRoll.css`); this lane did not alter or suppress them.

## Risks

This is not a complete TA2 acceptance sign-off. The package schema, remaining gesture families, several arrangement bindings, RT automation preview, meter writers, and the full browser matrix above remain actionable. Claims here are deliberately bounded to passing tests and recorded browser evidence.
