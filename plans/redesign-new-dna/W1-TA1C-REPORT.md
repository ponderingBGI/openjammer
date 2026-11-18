# Wave 1 TA1c — timeline logic reliability report

Date: 2026-08-28

## Outcome

TA1c source, TypeScript, ESLint, the required targeted test gate, and the single final full Vitest run are green. The runtime journey is **UNVERIFIED**: both permitted Chromium launches timed out inside `chromium.launch()` before a page was created, including the retry after the required 90-second cooldown. Vite was stopped and port 5187 was confirmed free.

## Required items

1. **Loop toggles while rolling without a range** — `src/store/arrangementStore.ts:615-620` now republishes for either toggle. `republishPreview` derives effective looping from both the flag and a valid loop location, so a missing range always re-arms the end watchdog from the current tick; disabling loop does the same. Pin: `src/store/__tests__/arrangementStore.test.ts:219`, covering both ON and OFF during playback. Previous code unconditionally called `clearEndTimer()` for ON, so the first half fails on TA1b.

2. **Atomic edits queue behind performer gestures** — `src/store/arrangementStore.ts:260-287,411-415,443-538` keeps the UI preview and pointer ownership intact, queues non-preview atomic edits in arrival order, flushes only after the outer gesture commits or aborts, and applies each queued batch as its own history entry. Apply-time failures are caught, logged, surfaced as `transportError`, and never publish a partial document. Nested UI gestures use stacked preview frames and nested history depth. Pins: `src/store/__tests__/arrangementStore.test.ts:312,326,343`. The TA1b force-abort test expected the exact old failure: the preview vanished and only the atomic edit entered history.

3. **Cross-track drag ghost** — `src/store/editingContextStore.ts:50-59,147,204,214`, `src/components/Arrangement/useClipGesture.ts:91-136`, `src/components/Arrangement/DragGhost.tsx:1-21`, `src/components/Arrangement/DragGhost.css:1-29`, `src/components/Arrangement/ArrangementSurface.tsx:22,212`, and `src/components/Arrangement/TrackLaneView.tsx:34,61` add a surface-owned lightweight ghost. The original remains mounted in the source lane at 35% opacity; the ghost follows the pointer at 96% opacity; the hovered lane gets `is-drop-target`; move and Alt-copy share the path; commit and Esc clear it. Pin: `src/components/Arrangement/__tests__/ArrangementSurface.test.tsx:50-88` asserts the mid-drag ghost target, original source parent, dragging state, lane highlight, disappearance, one history entry, and one-undo restoration. TA1b had no ghost or drop-target state, so the new mid-drag assertions fail there. This lane used the explicitly permitted new `DragGhost.css` file.

4. **Double-Stop and end halt** — `src/store/arrangementStore.ts:550-591` separates `haltAtEnd()` from user `stop()`: rolling Stop freezes; stopped-away-from-origin Stop seeks `playOriginTick`; watchdog callbacks use `haltAtEnd()`. `src/components/Arrangement/TransportStrip.tsx:35-38` and `src/components/Arrangement/ArrangementSurface.tsx:93` route the pill and Space based on play state and origin. Pins: `src/store/__tests__/arrangementStore.test.ts:354,367`, including end halt and loop retention. TA1b's stopped `stop()` returned immediately and could not seek the origin.

5. **Remaining TA1b must-fix source items**:
   - Pan jitter: `src/components/Arrangement/MixerDrawer.tsx:72-77` does not preview below 3 px, preventing phantom edits.
   - Velocity burst ownership: `src/components/PianoRoll/PianoRoll.tsx:103,147-151,446,454-459` captures the gesture id and commits only if that exact gesture is still topmost; a later note drag cannot be committed by the stale timer.
   - Audition graph teardown: `src/components/PianoRoll/actions.ts:42-47` restores the canvas graph through `stopArrangementPreview()` after the final stopped audition voice is released; it never stops rolling transport.
   - Quantize/history surface: `src/components/PianoRoll/actions.ts:8-25` accepts the calling surface and `src/components/Arrangement/TrackLaneView.tsx:92` identifies inline quantize as arrangement-originated. `src/song/editingActions.ts:43,53` forwards the active surface for cut/delete.
   - The de-indented `startPreview` block was reflowed in `src/store/arrangementStore.ts:89-113`.

## Verification

```text
bun run test:run -- src/song src/components/Arrangement src/components/PianoRoll src/store
Test Files  46 passed (46)
Tests       412 passed (412)

bunx tsc --noEmit -p tsconfig.app.json
PASS (zero diagnostics)

bunx eslint src packages e2e
PASS (zero diagnostics)

bun run test:run
Test Files  172 passed (172)
Tests       1678 passed (1678)
```

The full suite was run exactly once at the end. Expected negative-path stderr and existing React `act(...)` warnings appeared; the command exited 0. `git diff --check` reported only pre-existing whitespace errors in out-of-scope Guide/scroll files, not TA1c-owned files.

## Runtime journey

Adapted harness: `plans/redesign-new-dna/.scratch/review-ta1b/journey.ts`; requested output directory: `plans/redesign-new-dna/.scratch/w1-ta1c/`.

- First launch: `chromium.launch()` timed out after 180 seconds before page creation; evidence in `journey.err.log`.
- Cooldown: 90 seconds completed.
- Retry: `chromium.launch()` again timed out after 180 seconds before page creation; evidence in `journey-retry.err.log`.
- Cross-track ghost/original screenshot, commit/undo, loop cases, Space double-Stop, queued agent edit, and console/pageerror assertions: **UNVERIFIED** because no browser page existed.
- Screenshots: **none produced**.
- Vite: stopped; port 5187 confirmed free.

## Public API changes

- `ArrangementStore.beginGesture(...)` now returns a numeric gesture id.
- `ArrangementStore.isGestureOpen(id?)` reports whether a gesture, or a specific topmost nested gesture, remains open.
- `ArrangementStore.haltAtEnd()` is the internal freeze-only end-of-song action.
- `EditingContextState.clipDragPreview` and `setClipDragPreview(...)` expose ephemeral cross-lane drag presentation state.
- `applyPianoRollQuantize(noteIds, surface?)` accepts the originating arrangement/piano-roll surface.

## UNVERIFIED items and risks

- The complete Chromium journey and all requested screenshots are unverified due to the two launch timeouts. Tests do not substitute for perceived drag feel or audible transport/loop behavior.
- Physical audio playback, clicks/dropouts, MIDI-to-audio latency, and hardware record behavior remain human/audio-hardware verification items.
- The loop-without-range policy was not added to `docs/timeline.md`: that file is outside the user's authorized ownership list. The behavior and pinning test are complete, but the documentation must be landed by a docs-owning lane.
- The requested predecessor gaps beyond the two named TA1c gaps—full PianoRoll DOM audition/pointercancel, velocity interleave DOM timing, and repeated step-entry DOM coverage—remain unverified; the must-fix source hazards are repaired and the targeted/full suites pass.
- Impeccable flagged pre-existing rules in `ArrangementSurface.css` and `PianoRoll.css`; both files are explicitly outside TA1c ownership. They were classified as out of scope and left unchanged. The new `DragGhost.css` uses the existing token/shadow vocabulary and produced no hook finding.
