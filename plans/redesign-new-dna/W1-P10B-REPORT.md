# Wave 1 P10b — canvas and app-shell logic reliability

Date: 2026-08-28

## Outcome

The D1–D12 review defects and the assigned incomplete implementation items are repaired. The combined targeted suite and the single full Vitest suite pass. ESLint passes. TypeScript is blocked by one concurrent timeline-lane test fixture outside this lane. The required Playwright journey is **UNVERIFIED** because Chromium timed out during launch both before and after the prescribed 60-second wait/retry.

## Review defects

| Defect | Change | Pinning evidence |
|---|---|---|
| D1 | `NodeCanvas.tsx:587-615` moves held-note cleanup into a stable lifecycle ref/effect, independent of graph identity. Key-up still releases the physical source before editable-target routing. | `keeps a held note alive across a graph mutation and releases it once from an input`; parameterized blur/visibility/unmount test proves one note-off, never two. These fail pre-fix because every `nodes` Map replacement ran the keyboard-effect cleanup. |
| D2 | `graphStore.ts:65` accepts persisted pixel geometry only for the resizable Library node, so the Width DSP parameter is never interpreted as pixels. | `does not confuse the width DSP parameter with pixel geometry`; Library persisted-size and unknown-plugin fallback tests. Pre-fix Width returned 1 px. |
| D3 | `graphStore.ts:1201` adds `moveNodes(Map<id, position>)`; `NodeWrapper.tsx:191` publishes the selected group once per mousemove. | `moves a selected group in one store publication`; NodeWrapper group-drag component test proves one history frame and both positions. Pre-fix called `set` N times. |
| D4 | `NodeCanvas.tsx:147-175` equality-guards rect publication and republishes after rAF, resize, captured scroll, transition and animation. Rect-derived centers are used in `canvasNavigationStore.ts`, `graphAdapter.ts`, `useCommandSources.ts`, and `agentSessionStore.ts`. | `republishes a changed canvas position after a transition`; `keeps the canvas point under a ctrl-wheel anchor pixel-locked with a non-zero rect`; canvas-store round-trip coverage. Pre-fix retained the entrance-transform rect. |
| D5 | `graphStore.ts:716-803,1231-1257` validates replacement against the graph minus the old edge and publishes delete+add atomically; history commit is in `finally`. | Rejection/open-null, thrown-add/open-null, atomic source-end/fan-in, same-port/no-history, and one-undo tests. Pre-fix exposed two publications and could leave history open. |
| D5b | `SpeakerNode.tsx:69-106` keeps mounting display-only and restores only `devicechange` unplug recovery from a missing explicit device to `default`. | `does not change routing on mount, then falls back when devicechange removes the selected output`. Real hardware unplug/audio is UNVERIFIED. |
| D6 | `OjcoreWasmExecutor.ts:495-510` records `lastPushedGraph` only after a successful post; ready-queue flush follows the same rule. | `retries an identical graph after postMessage fails and clears the marker on resync/dispose`. Pre-fix the failed serialized graph suppressed its retry. |
| D7 | `NodeWrapper.tsx:274-379` brackets ghost-port invention and reconnect inside one nested try/finally gesture. | `undoes ghost-port creation and cable reconnect together with one Ctrl+Z step`. Pre-fix required two undo steps. |
| D8 | `graphStore.ts:1749` duplicates from an isolated deep-cloned selection payload without publishing clipboard state. `keybindingsStore.ts:86-105` documents and uses Chromium-cancellable `Alt+=`, `Alt+-`, `Alt+0`. | Clipboard-neutral duplicate and zoom-default tests. Pre-fix Ctrl+D overwrote clipboard and Ctrl zoom was browser-reserved. |
| D9 | `NodeWrapper.tsx:164-171` filters stale selected IDs instead of asserting node presence. | Covered by NodeWrapper interaction suite; pre-fix dereferenced `undefined.position`. |
| D10 | `graphStore.ts:1678-1722` drops unmapped child/special IDs and parents pasted roots into the current container, updating its `childIds`. | Deep-container clone and paste-inside-container/unmapped-child tests. Pre-fix retained original IDs or orphaned copies at root. |
| D11 | `useScrollCapture.ts:230` restores the established semantics used by the eight untouched consumers: positive `deltaY` is `scrollingUp`, negative is `scrollingDown`. | `preserves the established positive-delta scrollingUp semantics` drives a ValueScrubber consumer. Pre-fix inverted those consumers. |
| D12 | Port metadata is truthful: Canvas IO resolves the rendered port; Looper and Microphone derive `data-port-type` from the actual port instead of literals. | Existing port/component suites plus targeted/full gates. No production reader was invented. |

## Incomplete items completed

- UI-005: removed the advertised `file.new` / `file.import` bindings because their destructive/file-picker flows have no real consumers; the comment in `keybindingsStore.ts:44` documents why. Zoom/select-all/duplicate consumers remain action-id driven. The migrated-shortcut arbiter test passes. A static proof that every future keybinding ID has a production consumer remains **UNVERIFIED**; the two known zero-consumer IDs no longer exist.
- UI-012: canvas navigation centering and all three `viewportCenter()` helpers now use the published canvas rect; rect refresh is covered by component tests.
- UI-013: `NodeWrapper` marks node roots; `NodeCanvas.tsx:1088-1095` invalidates port positions on node ResizeObserver callbacks and `document.fonts.ready`.
- UI-014: per-container pan/zoom lives in `canvasNavigationStore.ts:29-184` (`viewStates`), not `graphStore.nodes`; `enters and exits containers without mutating audio graph nodes` pins the boundary. Executor dedupe remains defence in depth.
- UI-015: `ParamRow.tsx:22-47` and Effect sliders close open gestures on pointer cancel, control blur, window blur, and unmount. ParamRow's four parameterized gesture-lifetime tests pass. Speaker and group drag retain the same closure guarantees; Looper's range changes use immediately closed single-write gestures.
- UI-020: `LibraryNode.tsx:297-318` commits `currentItemId`/`itemRefs` only after decode and executor delivery succeed; failed decode/delivery preserves last-good selection. Targeted/full suites pass; no dedicated Library delivery component test was added, so this item is **UNVERIFIED at its component call site**.
- UI-026: CSS follow-up is intentionally outside P10b ownership and was not touched.
- `KeybindingsPanelSafe`: mounted in `SettingsPanel.tsx:4,96`.

## Additional interaction tests

- NodeWrapper: sub-threshold click creates no history; Shift-click toggles; N-node drag creates one history entry; window blur and unmount close active gestures.
- Reconnect: the production NodeWrapper ghost-port call site is pinned, not only the store method.
- Held-note lifecycle: graph mutation, editable-input key-up, blur, hidden visibility, and unmount are all component-tested.
- Geometry: Width, Library persisted dimensions, unknown plugin fallback, non-zero canvas rect, rect republish, and ctrl-wheel anchor are pinned.

## Runtime journey

Script: `plans/redesign-new-dna/.scratch/w1-p10b/journey.ts`. It contains the requested right-click node creation, DOM-center cable drags, rejected reconnect preservation, group drag/one undo, fresh-load ±2 px zoom anchor, held-note counters via the webdriver-only `src/test/e2eBridge.ts`, console/page-error checks, JSON output and screenshots.

Execution result: **UNVERIFIED**. Playwright started `chrome-headless-shell.exe` but never completed its launch handshake and timed out after 15 seconds. After waiting 60 seconds, the single prescribed retry failed identically. No page was created, therefore no runtime assertions, JSON result, or screenshots are claimed. The Vite server on port 5183 was stopped and zero Playwright Chromium processes remained.

## Verification

- Targeted requested gate: `bun run test:run -- src/store src/components/Canvas src/components/Nodes src/keymap src/hooks src/ai packages/oj-ui/src/components/ParamRow` — **40 files, 352 tests passed**.
- Additional call-site/lifecycle tests added afterward: **3 files, 13 tests passed**.
- TypeScript: `bunx tsc --noEmit -p tsconfig.app.json` — **BLOCKED outside lane** at `src/store/__tests__/arrangementStore.test.ts:204`: concurrent timeline fixture omits required `Location.name`.
- ESLint: `bunx eslint src packages e2e` — **passed, zero diagnostics**.
- Full suite, run once: `bun run test:run` — **170 files, 1,661 tests passed**. The later 13-test targeted run covers the tests added after this one allowed full-suite execution.

## Public API changes

- `GraphStore.moveNodes(positions: Map<string, Position>)` is the bulk movement verb.
- `GraphStore.duplicateSelected()` duplicates without touching clipboard state.
- `GraphStore.pasteClipboard(position?, sourceClipboard?)` has an optional internal source payload.
- `GraphStore.addConnection(..., replacingConnectionId?)` has an optional internal reconnect seam; existing callers are unchanged.
- `canvasNavigationStore` owns `viewStates: Map<string, RootViewState>`.
- The webdriver-only E2E bridge exposes `noteEvents()` and `resetNoteEvents()`.

## Risks / could not verify

- Audible note continuity, clicks/dropouts, latency, and real output-device unplug recovery require a human with audio hardware and remain UNVERIFIED.
- The full Playwright journey is UNVERIFIED because Chromium could not launch.
- UI-020 has passing surrounding suites but lacks a dedicated Library component rejection test.
- The keymap has no architectural production-consumer registry, so a future-proof every-ID-to-production-consumer static gate remains UNVERIFIED; the two review-identified orphan actions were removed.
- TypeScript cannot be claimed green until the concurrent arrangement fixture is corrected by its owning lane.
