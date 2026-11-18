# Wave 1 P10a — canvas and app-shell logic reliability

Date: 2026-08-28

## Outcome

This pass lands the graph/canvas invariants that could be implemented and verified without crossing the two concurrent ownership lanes. It is not a claim that every item in the audit work order is complete. Items without a pinning test or successful runtime proof are explicitly marked **UNVERIFIED** below.

## Findings

| ID | Change and location | Pinning test / verification |
|---|---|---|
| UI-001 / UI-009 | Added validated `reconnectConnection` in `src/store/graphStore.ts`; `NodeWrapper.tsx` removes the old edge only after acceptance and brackets the accepted replacement into one history frame. | `rejects a reconnect without touching the original cable`; `reconnects as one undoable graph gesture`. Targeted gate green. |
| UI-002 | `NodeCanvas.tsx` releases an active physical source before editable-target routing and flushes notes/control on blur, hidden visibility, and unmount. Rebound note actions retain the physical release key. | Typecheck and targeted gate green. Component lifecycle paths and executor swap are **UNVERIFIED** by a dedicated test. |
| UI-005 | `NodeCanvas.tsx` now executes canvas behavior from binding action ids. Added consumers for zoom in/out/reset. | Existing keymap arbiter suite passes; dedicated one-test-per-advertised-binding coverage is **UNVERIFIED**. |
| UI-006 | `NodeWrapper.tsx` captures the selected group, starts after a 4-client-pixel threshold, moves every selected node inside one history gesture, closes on blur/unmount, and Shift-click toggles. | Typecheck and targeted gate green; component interaction test and browser gesture are **UNVERIFIED**. |
| UI-007 | Added explicit `canvas.selectAll` and `canvas.duplicate` actions in `keybindingsStore.ts`. Defaults: Ctrl/Cmd+A selects all; Ctrl/Cmd+D duplicates with the existing +50/+50 paste offset; plain A remains multi-connect. | Store/keymap suites pass; dedicated component consumer tests are **UNVERIFIED**. |
| UI-008 | Removed graphStore's approximation table. `getNodeDimensions` now uses persisted measured `data.width/height`, falling back to the registry definition. NodeCanvas fallback port math uses this source. Marquee threshold is evaluated in client pixels. | Targeted gate and typecheck green; measured resize integration is **UNVERIFIED**. |
| UI-010 | Container copy recursively includes descendants, deep-clones node/connection payloads, remaps parent/child/special IDs, remaps internal edges, and restores root IDs. | `deep-clones a selected container subtree and remaps hierarchy ids`. |
| UI-011 | `ScrollData` now includes wheel client coordinates; direction names match WheelEvent signs; Ctrl/Cmd-wheel anchors to the event point relative to the observed canvas rect. | Typecheck/targeted tests green; pixel-lock browser assertion is **UNVERIFIED**. |
| UI-012 | `NodeCanvas.tsx` publishes its real rect through ResizeObserver plus window resize; coordinate transforms and visibility/fit use that rect rather than window dimensions. | Typecheck/targeted tests green; dedicated ResizeObserver test is **UNVERIFIED**. |
| UI-013 | Port lookup is canvas-scoped and cache invalidation already covers node-map changes and post-paint rAF. ResizeObserver/font-load invalidation was not fully completed. | **UNVERIFIED / PARTIAL**. |
| UI-014 | Added byte-identical audio-IR dedupe to `OjcoreWasmExecutor`; native already had accepted-graph dedupe. Canvas view remains in `canvasNavigationStore`. | Executor/full suites pass. A dedicated view-entry no-reconcile test is **UNVERIFIED**. |
| UI-015 | Group drag and Speaker volume gestures now close on blur/unmount/cancel; Speaker already closes on pointer cancel/blur. Other slider families were not all migrated. | **UNVERIFIED / PARTIAL**. |
| UI-018 | Speaker uses a per-instance selector ref and button entries; Microphone uses a per-instance ref; outside handling is direct pointerdown. | Typecheck/targeted tests green; keyboard/device multi-instance component tests are **UNVERIFIED**. |
| UI-019 | Removed Speaker's auto-device selection, unplug auto-fallback, executor disposal, and AudioContext reinitialization. Enumeration is guarded and display-only; explicit performer selection is the only node-local route change. `useUsbLowLatencyDefault` remains the sole default policy. | Existing `useUsbLowLatencyDefault` tests pass; Speaker policy component test is **UNVERIFIED**. |
| UI-020 | Library last-good commit behavior was not changed in this pass. | **UNVERIFIED / NOT COMPLETED**. |
| UI-025 | `usePWA.ts` has a cancellation guard before registration callbacks, state writes, and interval creation. | Typecheck/targeted gate green; dedicated pending-import unmount test is **UNVERIFIED**. |
| UI-026 | `GuideStep.tsx` maps `in_progress` to `in-progress` for root and indicator; header is a semantic button. | Typecheck/targeted gate green; dedicated state mapping test is **UNVERIFIED**. |
| UI-032 | Added atomic `renamePort` graph action updating port metadata and visible label in one store mutation; both panel nodes use it. | Typecheck/targeted gate green; dedicated undo test is **UNVERIFIED**. |
| UI-034 | Temporary cable kind is derived from its source port type. | Typecheck/targeted gate green; render assertion is **UNVERIFIED**. |

## Code-level defects

- `NodeCanvas.tsx`: port queries are scoped to `.node-canvas` and interpolate IDs with `CSS.escape`.
- `CanvasIONode.tsx`, `InstrumentNode.tsx`, `LooperNode.tsx`, `MicrophoneNode.tsx`, `SamplerVisualNode.tsx`: custom ports now emit `data-port-type`.
- Speaker and Microphone device enumeration have rejection/unmount guards.
- LowLatencyGuide async initialization has an unmount cancellation guard.
- DropdownMenu, Instrument, Microphone, and Speaker use direct `pointerdown` outside handling with instance refs; no `setTimeout(0)` listener registration.
- NodeCanvas and `useScrollCapture` cancel their scheduled animation frames on cleanup.
- Graph hydration intersects selected node IDs with extant nodes.
- Stale Escape state refs and complete font/node-resize port-cache invalidation remain **UNVERIFIED / NOT COMPLETED**.
- `KeybindingsPanelSafe` was left unchanged. Mounting it requires editing SettingsPanel outside the declared owned files; deleting it would remove the intended production error boundary. Decision remains **UNVERIFIED** for the orchestrator.

## Deletions

- Removed redundant default exports from `GuideStep.tsx`, `LowLatencyGuide.tsx`, and `useScrollCapture.ts`; named exports remain.
- `generateNumberedControls`, the remaining redundant default exports, and `RelinkSamplesDialog` were not deleted in this pass. Dynamic/registry reachability was not fully re-proven, so deletion would violate the keep-on-doubt rule.
- No CSS was edited. Audit-confirmed dead CSS remains assigned to the CSS lane: Waveform editor legacy rules, Guide orphan rules, old MiniLab/MIDIVisual rules, old Sampler rules, Toolbar unsaved class, and Looper armed animation.

## Verification

- Targeted: `bun run test:run -- src/store src/components/Canvas src/components/Nodes src/keymap src/hooks src/ai` — **35 files, 331 tests passed**.
- TypeScript: `bunx tsc --noEmit -p tsconfig.app.json` — **passed**.
- Lint: run twice. P10a-owned files have zero errors/warnings. Repository command remains red only for 10 `no-explicit-any` errors in `plans/redesign-new-dna/.scratch/timeline-audit.ts`, owned by the concurrent timeline lane.
- Full suite: **164 files / 1,631 tests passed; one unrelated CommandBar test timed out**. Required single re-run of `src/components/CommandBar/__tests__/CommandBar.test.tsx`: **9/9 passed**.
- Runtime Playwright journey: **UNVERIFIED**. The background-server/log/script shell stopped returning stdout, so no browser assertions or screenshots are claimed. The listener on port 5179 was stopped.

## Risks and could-not-verify

- No human monitored-audio test was possible; audible note release, click/dropout behavior, and latency remain unverified.
- Executor-swap-specific held-note flushing lacks a first-class executor swap event and was not proven.
- Library last-good delivery, every slider family, font-load cache invalidation, complete Escape ref freshness, and requested end-to-end cable/group/zoom/note-off journey still need pinning coverage.
- Impeccable flagged pre-existing CSS findings in `BaseNode.css`, `Guide.css`, and `SchematicNodes.css`. They were not changed because all CSS is owned by the concurrent visual lane.
