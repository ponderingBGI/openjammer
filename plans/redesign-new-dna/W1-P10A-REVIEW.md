# W1 P10a — adversarial review of the canvas / app-shell change set

Date: 2026-08-28. Reviewer: read-only. Scope: the uncommitted P10a diff only
(`src/store/{graphStore,canvasStore,keybindingsStore}.ts`, `src/components/{Canvas,Nodes,Guides}`,
`src/components/Toolbar/DropdownMenu.tsx`, `src/hooks`, `src/audio/executor/Ojcore{Wasm,Native}Executor.ts`,
`src/store/__tests__/graphStore.test.ts`). Timeline-lane files were ignored.

## Gates re-run by the reviewer

| Command | Result |
|---|---|
| `bunx tsc --noEmit -p tsconfig.app.json` | PASS (exit 0, 0 diagnostics) |
| `bun run test:run -- src/store src/components/Canvas src/components/Nodes src/keymap src/hooks src/ai` | PASS — 35 files / 331 tests |
| `OjcoreNativeExecutor.ts` | **no diff** — the report's UI-014 claim "native already had accepted-graph dedupe" was not re-verified by a change; the file is untouched. |
| Browser (Chromium + Playwright, `bun dev --port 5181`) | boot clean, **zero console errors / page errors**; scripts + shots in `plans/redesign-new-dna/.scratch/review-p10a/` |

Runtime results obtained (see per-item verdicts): group drag moves every selected node and produces
**exactly one** history entry; Shift-click toggles a node out of the selection and it then stops moving;
Ctrl+wheel anchor is **wrong by ~10 px on a fresh load and exact after a window resize** (root cause below).

---

## Verdict per audit ID

| ID | Verdict | Evidence |
|---|---|---|
| UI-001 (reconnect atomicity) | **CORRECT with caveats** | `graphStore.ts:1198`, `NodeWrapper.tsx:335-368`. Order is right: `addConnection` runs first, the original is removed only on a non-null, non-identical id. Same-port drop returns the existing id and is correctly skipped. Caveats D5, D6, D7 below. |
| UI-002 (held notes) | **DEFECT (D1)** | `NodeCanvas.tsx:578,999-1012`. The key-up ordering fix is correct, but `flushActiveNotes()` is placed in the cleanup of an effect that depends on `allNodes` — so it fires on *every* graph mutation. |
| UI-005 (dispatch by action id) | **CORRECT / INCOMPLETE** | `NodeCanvas.tsx:583-960`. Dispatch is now by `actionId`; `matchesKeyCombo` (`keybindingsStore.ts:212`) is strict on modifiers so `a` / `Ctrl+A` cannot cross-fire. Incomplete: `file.new` and `file.import` still have **zero consumers** (enumerated below); `view.zoomIn/Out/resetView`, `canvas.selectAll`, `canvas.duplicate` are gated behind `currentMode === 1`. |
| UI-006 (group drag) | **CORRECT** (runtime-proven) | `NodeWrapper.tsx:152-210`. 4 px threshold is in **client** px (zoom-independent) ✓; one `beginGesture`/`endGesture` pair, only after the threshold ✓; `blur` + `dragCleanupRef` cleanup ✓; Shift-click toggles ✓. Browser: both selected nodes moved +120/+60, history entries 3 → 4 (one frame). Perf defect D3 and crash risk D9 below. |
| UI-007 (Ctrl+A / Ctrl+D) | **INCOMPLETE (D8)** | `keybindingsStore.ts:135-136`. Bindings and consumers exist and do not collide. But `canvas.duplicate` is implemented as `copySelected(); pasteClipboard()` — it destroys the user's clipboard, and the zoom trio binds `Ctrl+=/-/0`, which Chrome does not let a page cancel. |
| UI-008 (measured geometry) | **DEFECT (D2)** — geometry itself improved | `graphStore.ts:59-77`. Registry dimensions are real (keyboard-visual 660×280, library 500×400, instrument-visual 650×400) and `registry.get()` never throws, so this is a genuine improvement over the deleted table. But `data.width` is an **overloaded key**: the `width` node's stereo-width DSP param lives there. Marquee threshold `Math.abs(w * zoom) > 5` is correct client px. |
| UI-009 (one Ctrl+Z) | **CORRECT (store) / UNVERIFIED (UI)** | `graphStore.test.ts:461` pins one-undo at the store level. The NodeWrapper call site — the place the P0 actually lived — has **no test**, and my browser attempt to confirm one-Ctrl+Z-restores-both was contaminated by a welcome-modal binding-set artifact in the harness. Needs a real check. |
| UI-010 (deep clone containers) | **DEFECT (D10)** | `graphStore.ts:1560-1676`. `structuredClone` + descendant walk + parent/child/special remap is right, and node data is JSON-only so the clone is safe. Two holes: `remap = id => oldToNewIds.get(id) ?? id` can re-point a pasted container at an **original** child id; and `parentId` is force-nulled, so paste inside a container silently lands the copy at root level. |
| UI-011 (zoom anchor) | **DEFECT (D4)** — the math is right, the input is stale | `NodeCanvas.tsx:543-550`. `zoomTo` arithmetic verified correct. The anchor is off by exactly `(-10.5, -6.75)` px on a fresh load and **exact after forcing a window resize**, because `canvasRect` is captured once during an entrance transform and never republished. Also: `useScrollCapture.ts:229` silently inverts `scrollingUp/Down` for 8 unrelated consumers (D11). |
| UI-012 (canvas rect) | **INCOMPLETE + DEFECT (D4)** | `NodeCanvas.tsx:147-163` publishes the rect, but `canvasNavigationStore.ts:120,123` — named explicitly in the audit — still uses `window.innerWidth/innerHeight`, and three `viewportCenter()` helpers (`ai/graphAdapter.ts:150`, `CommandBar/useCommandSources.ts:52`, `store/agentSessionStore.ts:308`) still feed a *window* centre into the now-rect-relative `screenToCanvas`. |
| UI-013 (cable geometry cache) | **INCOMPLETE** (self-declared) | Port lookups are correctly canvas-scoped + `CSS.escape`d (`NodeCanvas.tsx:208,1071`). Font-load / node-resize invalidation not done. |
| UI-014 (container enter/exit) | **PARTIAL + DEFECT (D6)** | `OjcoreWasmExecutor.ts:499`. The dedupe masks the symptom; the root cause (nav state mutating `graphStore.nodes`) is untouched, as the report admits. The dedupe also costs a full `JSON.stringify` of the graph IR inside a store subscriber on **every** mutation. |
| UI-015 (gesture close) | **PARTIAL** (self-declared) | Speaker volume + group drag close on blur/unmount. `ParamRow.tsx` and the other slider families were not migrated. |
| UI-018 (per-instance dropdowns) | **CORRECT, one behaviour change** | Speaker/Mic/DropdownMenu now use instance refs + direct `pointerdown` — the `setTimeout(0)` removal is safe because `useEffect` runs after the opening click has finished dispatching. `InstrumentNode.tsx:301` widened the containment test to the **whole node**, so clicking the node body no longer closes the instrument picker. |
| UI-019 (device policy) | **DEFECT (D5b)** | `SpeakerNode.tsx:69-96`. Auto-select + auto-low-latency + executor dispose correctly removed. But the **unplug → fall back to default** branch was deleted with them. |
| UI-020 (library last-good) | **NOT DONE** (self-declared) | — |
| UI-025 (PWA cancel guard) | **CORRECT** | `usePWA.ts:166-204`. Guard covers registration, all three callbacks, the interval and `setUpdateSW`. |
| UI-026 (guide state class) | **CORRECT, needs CSS follow-up** | `GuideStep.tsx:15,44`. `in_progress → in-progress` mapped for root and indicator. The header became a `<button>` wrapping `<div>` children — invalid content model and unstyled by the existing `.guide-step-header` rules, so it will render with default button chrome until the CSS lane catches up. No `aria-controls`. |
| UI-032 (atomic rename) | **CORRECT** | `graphStore.ts:1183`. One `set` → one `diffGraph` → one history entry. Both panels migrated. |
| UI-034 (temp cable kind) | **CORRECT** | `NodeCanvas.tsx:1152`. |

---

## Defects (with fixes)

### D1 — P0. Every graph edit releases held notes (`NodeCanvas.tsx:578`, cleanup at `:1005`, deps at `:1012`)

`flushActiveNotes()` was added to the cleanup of the keyboard effect. That effect's dependency array
contains `allNodes` (`NodeCanvas.tsx:104` = `useGraphStore(s => s.nodes)`), `currentViewNodeId` and
`selectedClipIds`. `updateNodePosition` (`graphStore.ts:506`) and `updateNodeData` both build a **new
Map** on every call, so the effect tears down and re-runs on every graph mutation — and the teardown
releases every active note and clears `activeKeyboardKeys`.

Reachable on stage: hold a chord and drag a node, scrub the Speaker volume (one `updateNodeData` per
input event), let the AI agent land a verb, or press undo — the held notes are cut. Worse, after the
flush the map is empty, so the real key-up falls through to the `currentMode > 1` branch instead of
`releaseKeyboardSignal`, leaving the visual/sustain state inconsistent.

**Fix:** move the lifecycle flush out of the churny effect. Keep `flushActiveNotes` in a ref and add
`useEffect(() => () => flushRef.current(), [])` plus the `blur`/`visibilitychange` listeners in their own
`[]`-dep effect. Do not let it ride the graph-dependent effect.

### D2 — P0. `getNodeDimensions` collides with the `width` DSP param (`graphStore.ts:66-77`)

`data.width` is not a UI dimension for every node. The `width` node (stereo width, `manifest.ts:218`,
range `[0,2]`, default `1`) stores its **parameter** there. Runtime-proven:

```
addNode('width') → data {"width":1} → getNodeDimensions → {"width":1,"height":90}
after the player sets width to 1.5 → {"width":1.5,"height":90}
```

Consequences: `getNodesBounds()` (zoom-to-fit), `selectNodesInRect` (marquee, `graphStore.ts:1431`) and
the port-position fallback (`NodeCanvas.tsx:225-235`) all treat a Width node as 1 px wide. Setting width
to `0` (mono) flips it back to 150 px because of the `> 0` guard — silently inconsistent.

Only `LibraryNode.tsx:196` ever persists real pixel dimensions, so the "measured data" path serves
exactly one node while poisoning another.

**Fix:** namespace the UI geometry — read `data.uiWidth`/`data.uiHeight` (and change `useResize`'s
`onDimensionsChange` contract + LibraryNode accordingly), or gate the measured branch on
`resolveNodeDefinition(node).resizable === true`. Do not read a bare `data.width`.

### D3 — P1. Group drag fires N store writes → N full engine reconciles per mouse move (`NodeWrapper.tsx:180-185`)

The move loop calls `updateNodePosition(id, …)` once per selected node. Each call is a separate
`graphStore` `set`, and the wrapped `set` (`graphStore.ts:239-253`) runs a whole-graph `diffGraph` on
every one. Each also flips the `nodes` Map identity, which the App-level subscriber
(`App.tsx:203-212`) turns into a synchronous `executor.pushGraph()` — `emitWithIndex` +
`remapForBackend` + (now) `JSON.stringify` of the whole IR (D6). Dragging 10 nodes at 120 Hz is
10× that per frame, on the main thread, inside a store listener.

**Fix:** add a `updateNodePositions(entries: [string, Position][])` bulk verb that mutates the Map once,
and have the drag loop call it. One `set`, one diff, one reconcile per frame.

### D4 — P1. `canvasRect` is captured once during an entrance transform and never republished (`NodeCanvas.tsx:147-163`)

`ResizeObserver` fires on **border-box size** changes only. It does not fire when the element's
*position* changes (sidebar toggle, page scroll), and `getBoundingClientRect()` on an element under an
animating ancestor transform returns the **transform-polluted** rect.

Runtime-proven on a fresh load at 1400×900: dispatching a synthetic `ctrl+wheel` at exactly the node's
top-left corner `(120,120)` moved the node to `(118.95, 119.32)` — pan became `-13.05 / -12.675` instead
of the correct `-12 / -12`. Solving back, the stored rect is `left = -10.5, top = -6.75`, i.e. exactly a
`scale(1.015)` entrance on a 1400×900 box. After forcing a real viewport resize, the same test is
**exact**: node corner stays at `(120,120)`, pan `-12 / -12`.

Because `screenToCanvas`/`canvasToScreen` (`canvasStore.ts:170-186`) now subtract this rect, the ~10 px
error propagates to right-click node placement, marquee rects, library/clip drops, collab cursors and
zoom anchoring — permanently, until the window happens to be resized.

**Fix:** don't cache. Either read `canvasRef.current.getBoundingClientRect()` at the point of use (it is
one layout read per gesture, not per frame), or republish on `animationend`/`transitionend`, on a
post-mount `requestAnimationFrame`, and on `scroll` (capture) in addition to `ResizeObserver`. Also add
an equality check inside `updateRect` before `setCanvasRect` — right now every observer tick allocates a
new object and re-renders the whole canvas, which is a per-frame setState storm during any panel
transition.

### D5 — P1. `reconnectConnection` is atomic for history, not for the store or the engine (`graphStore.ts:1198-1208`)

Three distinct problems:

1. **No `try/finally` around the open transaction.** If `addConnection` throws (bundle expansion,
   `expandTargetForBackend`, a plugin path), `commit()` is never reached and `historyStore.open` stays
   non-null forever — at which point `undo()`/`redo()` early-return (`historyStore.ts:104`) and **undo is
   dead for the rest of the session**. That is precisely the UI-015 failure mode this lane was meant to
   close. Wrap it: `try { … } finally { useHistoryStore.getState().commit(); }`.
2. **Two `set` calls, so two `version` bumps and two engine reconciles.** Between them the engine sees a
   graph in which both the old and the new cable exist. For `control`/`technical` targets (no fan-in
   limit) that is a real, if brief, double-connection on the audio path. The audit asked for "one
   validated atomic graph verb"; this is add-then-remove wearing a transaction.
3. **The old edge is still present during validation.** `addConnection` (`graphStore.ts:708-760`) has
   no cycle check today, so this is latent rather than live — but the moment one is added, moving the
   *source* end of a cable will be falsely rejected because the edge being replaced still closes the loop.
   Validate against `connections minus connectionId`.

### D5b — P1. Speaker unplug fallback was deleted with the auto-select policy (`SpeakerNode.tsx:69-96`)

The removed block also contained:

```ts
if (currentDeviceId !== 'default') {
  const deviceStillExists = sorted.some(d => d.deviceId === currentDeviceId);
  if (!deviceStillExists) { updateNodeData({ deviceId: 'default' }); getExecutor().setSpeakerDevice(node.id, 'default'); }
}
```

Nothing replaced it. `useUsbLowLatencyDefault` sets defaults; it does not recover from a device
disappearing. After an unplug the node keeps a dead `deviceId`, the executor keeps a dead sink, and the
UI still shows the old label. Compare the microphone path, which explicitly keeps this behaviour and
cites the rule: `OjcoreWasmExecutor.ts:1063` — *"when the OS track ends (unplugged), re-acquire the
default device — a held note beats a glitch."* Output now has no equivalent.

**Fix:** keep a *recovery-only* branch (unplug → default) and drop only the *preference* branch
(auto-select best low-latency + auto-enable low-latency mode + executor dispose). Recovery is not a
policy change; it is the Live Performance Rule.

### D6 — P1. Executor dedupe records the push before it happens (`OjcoreWasmExecutor.ts:495-503`)

`this.lastPushedGraph = serialized` is assigned **before** `this.ready` is checked and before
`sendGraph` runs. `pushGraph()` deliberately swallows lowering errors ("keeping last good audio … let
the next edit retry") — but the retry is now suppressed for any edit that reproduces the same IR.

`dispose()` and `resync()` both reset the field, and the only engine-restart path
(`AudioSettingsPanel.tsx:202-207`) calls `dispose()` first, so today there is no total-silence hole.
It is one refactor away from one.

**Fix:** set `lastPushedGraph` only on the success branch, immediately after `sendGraph(wasmGraph)` (and
after the `pendingGraph` flush in the `ready` handler). Also consider hashing rather than keeping a full
IR JSON string alive per push.

### D7 — P1. Ghost-port creation escapes the reconnect transaction (`NodeWrapper.tsx:305-330`)

`updateNodePorts(node.id, newPorts)` runs before `reconnectConnection` opens its transaction, so
dropping a reconnect onto a ghost port produces **two** history entries — one Ctrl+Z removes the cable
and leaves the invented port. Bracket the whole mouse-up in one `beginGesture`/`endGesture`.

### D8 — P1. `canvas.duplicate` clobbers the clipboard (`NodeCanvas.tsx:706-711`)

`copySelected(); pasteClipboard();` means Ctrl+D destroys whatever the player had copied. Every editor
convention duplicates without touching the clipboard. Extract the clone/offset body of `pasteClipboard`
into a `duplicateSelected()` verb that reads the live selection.

Related: `view.zoomIn/Out/resetView` default to `Ctrl+=`, `Ctrl+-`, `Ctrl+0`, which Chrome does not
allow a page to cancel — those consumers will never fire in the browser tier. Rebind (or accept that
they are native-tier only and say so).

### D9 — P2. Non-null assertion on a possibly-stale selection (`NodeWrapper.tsx:166-168`)

`Array.from(dragIds, id => [id, { ...graph.nodes.get(id)!.position }])` throws on mousedown if
`selectedNodeIds` ever contains an id that is not in `nodes`. Hydration now intersects
(`graphStore.ts:1834`), but collab/agent/undo paths do not. Filter instead of asserting.

### D10 — P2. Paste id-remap holes (`graphStore.ts:1636-1644`)

- `remap = id => oldToNewIds.get(id) ?? id` — a `childIds`/`specialNodes` entry that was not cloned
  keeps the **original** id, so the pasted container claims a node that belongs to the original.
  Filter: `node.childIds.map(remap).filter(id => oldToNewIds.has(...))`.
- `parentId` is forced to `null` for anything whose parent is not in the clipboard, and the id is then
  appended to `rootNodeIds`. Pasting (or Ctrl+D-ing) inside a container now silently drops the copy at
  the top level. The pre-existing behaviour was equally broken (the copy was orphaned because
  `getNodesAtLevel` reads `parent.childIds`), so this is not strictly a regression — but the correct
  fix is to parent the paste to `canvasNavigationStore.currentViewNodeId` **and** append to that
  container's `childIds`.

### D11 — P1 regression. `scrollingUp` / `scrollingDown` were inverted for 8 untouched consumers (`useScrollCapture.ts:229-230`)

The flip (`scrollingUp = e.deltaY < 0`) fixes the *naming*, and NodeCanvas's zoom was updated with it.
Nothing else was. Every one of these now scrubs in the **opposite direction** from before, with no
mention in the report and no test:

- `WaveformEditorModal.tsx:464` (waveform zoom)
- `InstrumentNode.tsx:129`, `InstrumentVisualNode.tsx:85` (value scrub)
- `LooperNode.tsx:434,437,441` (loop duration, including the infinite/60 s clamps)
- `MultiplierNode.tsx:56`, `SamplerNode.tsx:105`, `SamplerVisualNode.tsx:52`

The new direction is the conventional one (wheel-up increases), so this is probably the behaviour we
want — but it must be a declared, tested decision, not a side effect of a rename. The comment two lines
above (`"scroll up" (deltaY > 0 …)`) now contradicts the code.

### D12 — P2. `data-port-type` has no production reader

Nothing under `src/` reads `data-port-type`; only `oj-ui`'s own tests assert it. The audit's
"load-bearing" framing is not supported. The additions are harmless, but `LooperNode.tsx` and
`MicrophoneNode.tsx:319` hardcode string literals rather than deriving from the port, and
`CanvasIONode.tsx` uses `node.ports[0]?.type` regardless of which port renders — a latent lie with no
consumer to catch it.

---

## Regressions found

1. **Held notes are cut on every graph edit** (D1). Stage-critical.
2. **All eight scroll-scrub controls reverse direction** (D11).
3. **Speaker unplug no longer falls back to the default device** (D5b).
4. **Every screen↔canvas transform is ~10 px off on a fresh load** (D4) — including three
   `viewportCenter()` spawn points that were not migrated, so AI/palette/agent node placement is now
   offset by `canvasRect.left` whenever the canvas is not at the viewport origin.
5. **The `width` node is 1 px wide to the marquee and zoom-to-fit** (D2).
6. **Ctrl+D destroys the clipboard** (D8).
7. Instrument picker no longer closes on a click elsewhere in the same node (`InstrumentNode.tsx:301`).
8. Clicking one node of a multi-selection no longer collapses the selection to that node
   (`NodeWrapper.tsx:160-161`) — you can add and toggle, but not isolate.
9. `GuideStep` header is a `<button>` containing `<div>`s, styled by rules written for a `div`
   (`GuideStep.tsx:44`) — visual regression until the CSS lane lands.
10. `canvasNavigationStore.ts:120,123` still uses `window.innerWidth/Height` **and** now feeds a window
    centre into a rect-relative `setPan` — double-wrong once the shell offsets the canvas.

---

## Must fix before commit (ranked)

1. **D1** — take `flushActiveNotes` off the graph-dependent effect. A note that dies because someone
   moved a node is the exact failure the covenant forbids.
2. **D2** — stop reading a bare `data.width`/`data.height`; namespace the UI geometry.
3. **D11** — decide the scroll direction explicitly, update all 8 consumers to match, fix the stale
   comment, and pin it with one test.
4. **D5.1** — `try/finally` around `reconnectConnection`'s transaction. One throw currently kills undo
   for the session.
5. **D4** — republish (or stop caching) `canvasRect`; add the equality guard; migrate the three
   `viewportCenter()` helpers and `canvasNavigationStore:120,123`.
6. **D5b** — restore the unplug→default recovery on Speaker (recovery only, not preference).
7. **D3** — bulk `updateNodePositions` verb so a group drag is one store write per frame.
8. **D6** — assign `lastPushedGraph` only after a successful `sendGraph`.
9. **D8** — real `duplicateSelected()`; re-home the browser-uncancellable zoom bindings.
10. **D7 / D9 / D10** — bracket the ghost-port path, filter instead of `!`, filter the id remap.

---

## Must add tests

The lane added **three** tests, all store-level, all in `graphStore.test.ts`. Nothing under
`src/components/Canvas` or `src/components/Nodes` gained coverage, so none of the P0 *call sites* are
pinned. Note also that two of the three cannot fail on the old code, because they exercise a method
that did not exist — the UI-001 bug lived in `NodeWrapper.handlePortMouseUp`, which is still untested.

Required, roughly in priority order:

1. **Held-note lifecycle** (`NodeCanvas`): hold → mutate the graph → note must still sound; hold →
   focus an input → key-up → exactly one note-off; hold → `blur` / `visibilitychange:hidden` /
   unmount → exactly one note-off per active source, never two.
2. **`getNodeDimensions`**: a `width` node must not report a 1 px width; a `library` node with persisted
   dimensions must report them; an unknown/plugin type must fall back without throwing.
3. **`reconnectConnection`**: rejection leaves the original *and* leaves `historyStore.open === null`;
   `addConnection` throwing must still close the transaction; reconnecting the **source** end of an
   audio cable (fan-in 1) must not lose the cable; same-port drop is a no-op with no history entry.
4. **Scroll direction**: one test per `ScrollData` consumer family asserting the value moves the
   intended way for `deltaY < 0`.
5. **NodeWrapper interaction** (jsdom): sub-threshold click creates no history entry; group drag of N
   nodes creates exactly one; Shift-click toggles; blur mid-drag closes the gesture; unmount mid-drag
   closes the gesture.
6. **Canvas rect**: `screenToCanvas` round-trips against a non-zero rect; the rect is republished after
   a transform/position change (this is the test that would have caught D4).
7. **Executor dedupe**: a failed `sendGraph` must not suppress the next identical push; `resync()` and
   `dispose()` must clear the marker.
8. **Keymap coverage gate**: one test that asserts *every* `keybindingActions` id has a registered
   consumer — it fails today on `file.new` and `file.import`.
9. **Paste/duplicate**: pasting a container with an external connection; pasting inside a container;
   Ctrl+D must not mutate the clipboard.
10. **Speaker policy**: mounting must not change routing; `devicechange` removing the selected device
    must fall back to default.

---

## Not verified

- Anything audible. No monitored-audio test was possible; D1's *audible* consequence, click/dropout
  behaviour and latency all need a human with sound playing.
- One-Ctrl+Z-restores-both **through the UI**. My browser runs hit a harness artifact (removing the
  `.oj-welcome` DOM node leaves its modal binding set registered, and `resolveKeydown` never falls
  through a modal set), so keyboard routing was unreliable across runs. The store-level test passes;
  the UI path is unproven.
- Native executor behaviour (`OjcoreNativeExecutor.ts` is unchanged in this diff).
- Real device enumeration / unplug on hardware.
