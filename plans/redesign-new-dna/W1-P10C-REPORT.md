# W1 P10c Report

## Outcome

P10c fixes D4/N1, N2, N3, N4 and the remaining in-lane P3 findings N5, N7, and N8. No git staging, commit, stash, checkout, or reset was performed. The dev server was stopped.

## Changes and pinning tests

1. **D4 / N1 — correct canvas geometry after ancestor entrance motion**
   - `src/components/Canvas/NodeCanvas.tsx:149-183` centralizes live rect publication and listens on the closest `[data-surface-root]` for bubbled `animationend` and `transitionend`.
   - `src/components/Canvas/NodeCanvas.tsx:542-577` refreshes the live rect at drop and wheel-zoom use time before coordinate conversion/anchoring.
   - Pin: `src/components/Canvas/__tests__/NodeCanvas.reliability.test.tsx:110` dispatches `animationend` on the ancestor and requires the republished rect. This fails on P10b because listeners were attached only to `.node-canvas`.
   - Pin: the wheel test deliberately overwrites the store with a transformed/stale rect, then requires the live rect to be republished and used. This fails on P10b because wheel anchoring reads the cached stale rect.

2. **N4 — every rendered node path has an observable canvas root**
   - `src/components/Nodes/NodeWrapper.tsx:435-487` gives every schematic early-return path a `data-canvas-node-root` marker; the existing NodeFrame path retains its marker.
   - `src/components/Canvas/NodeCanvas.tsx:1096-1101` observes the schematic marker's actual visual child, so the display-contents marker does not hide Library resizing from `ResizeObserver`.
   - Pin: `src/components/Nodes/__tests__/NodeWrapper.reconnect.test.tsx:43` renders schematic and NodeFrame paths and requires both markers. P10b has none on the schematic path.
   - Pin: `src/components/Canvas/__tests__/NodeCanvas.reliability.test.tsx:45` requires the Library visual root to be observed and a resize callback to republish layout. P10b observes zero schematic roots.

3. **N2 — truthful File/View menu shortcut labels**
   - `src/components/Toolbar/Toolbar.tsx:41-46,337-349` subscribes to custom bindings and derives the zoom trio with `getBinding` plus `keyComboToString`.
   - Removed the nonexistent New Canvas and Import Workflow shortcut labels.
   - Pin: `src/components/Toolbar/__tests__/Toolbar.shortcuts.test.tsx:14` rebinds Zoom In, unbinds Zoom Out, opens the real menus, and checks the visible labels plus absence of stale Ctrl+N/Ctrl+O. P10b hard-codes all five stale labels.

4. **N3 — macOS Option zoom trio**
   - `src/store/keybindingsStore.ts:212-221` matches Alt `=`, `-`, and `0` by physical `event.code`, while preserving `event.key` matching for letter bindings.
   - Pin: `src/store/__tests__/keybindingsStore.test.ts:353` uses `{ key: '≠', code: 'Equal', altKey: true }` and separately protects an Alt-letter binding. P10b compares only `event.key`, so the macOS event fails.

5. **Remaining in-lane must-fix findings**
   - N5/N7: `src/components/Nodes/SpeakerNode.tsx:57,88-89` hoists the selector ref and only treats a missing device as unplugged when enumeration returned at least one real device id. Pin: `src/components/Nodes/__tests__/SpeakerNode.test.tsx:71`; P10b resets an explicit route after permission-less empty-id enumeration.
   - N8: `src/components/Nodes/NodeWrapper.tsx:199-204` collapses a multi-selection on mouse-up only when the click never became a drag. Pin: `src/components/Nodes/__tests__/NodeWrapper.reconnect.test.tsx:91`; P10b leaves the full selection active.
   - ParamRow: `packages/oj-ui/src/components/ParamRow/ParamRow.test.tsx:12-15` follows `pointercancel` with `pointerup` and requires one close, making the cancel assertion observable/idempotent rather than merely checking the already-existing cancel callback.
   - Blur/unmount: the NodeWrapper test continues to assert the observable history transaction, both moved positions, closed gesture, and no extra entry after unmount.

## Verification

- Requested targeted Vitest selection: **PASS**, 43 files / 400 tests.
- `bunx tsc --noEmit -p tsconfig.app.json`: **PASS**.
- `bunx eslint src packages e2e`: **PASS**.
- Full `bun run test:run` (one final full run): **PASS**, 172 files / 1678 tests.
- After the final N8 micro-fix: its targeted component test, TypeScript, and focused ESLint were rerun and passed.

Expected test stderr remains from intentional fault-path tests, jsdom's absent IndexedDB in project-store initialization, and pre-existing React `act` warnings.

## Journey evidence

- Started `bun dev -- --port 5188 --strictPort`; Vite reported ready on port 5188.
- Created the focused one-Chromium journey at `plans/redesign-new-dna/.scratch/w1-p10c/journey.ts`, reusing the P10b bridge/import patterns and targeting rect drift, wheel pixel-lock, node-root count, native and synthetic mac-style Alt+=, errors, and screenshot output.
- Chromium hung without producing journey output. Per instruction it was killed, allowed to settle for 90 seconds, and retried once. The retry also hung without output and was killed.
- The Vite server was stopped. No successful journey screenshot or `results.json` was produced.

## Unverified

- Browser journey assertions: fresh-load stored/live rect delta <= 0.5 px, Ctrl+wheel <= 1 px, DOM root count equals graph node count, native/synthetic Alt+= zoom, and zero console/page errors. Chromium hung twice, so these are not claimed.
- Audible behavior and real hardware output-device unplug remain unverified.
- N6 dead `internalViewport` is outside the user's owned canvas-lane file list (`src/engine/types.ts`) and was not changed. Container viewport persistence remains the explicitly noted product decision from P10b.
- The Impeccable hook reported existing 3px radii in `src/components/Nodes/BaseNode.css`; CSS is explicitly out of lane and those values were neither introduced nor changed here.
