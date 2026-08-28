# W1 P10b — second-round adversarial review of the canvas / app-shell change set

Date: 2026-08-28. Reviewer: read-only (no source file was modified).
Scope: the uncommitted P10b diff over `src/store/{graphStore,canvasStore,canvasNavigationStore,keybindingsStore,agentSessionStore}.ts`,
`src/components/{Canvas,Nodes,Guides,Toolbar}`, `src/components/CommandBar/useCommandSources.ts`,
`src/components/Settings/SettingsPanel.tsx`, `src/ai/graphAdapter.ts`, `src/hooks`,
`src/audio/executor/Ojcore{Wasm,Native}Executor.ts`, `packages/oj-ui/src/components/ParamRow`, `src/test`,
plus the untracked tests under those directories. Timeline-lane files were ignored.

## Gates re-run by this review

| Command | Result |
|---|---|
| `bunx eslint src packages e2e` | **PASS** — zero diagnostics (`.scratch/eslint-p10b.txt`, 0 bytes) |
| `bun run test:run -- src/store src/components/Canvas src/components/Nodes src/keymap src/hooks src/ai packages/oj-ui/src/components/ParamRow src/test` | **PASS** — 41 files / 363 tests (`.scratch/vitest-p10b-review.txt`) |
| Playwright journey, one Chromium, `bun dev --port 5185 --strictPort` | **COMPLETED** (first lane to finish it). Chromium launched first try. Script + JSON + 7 screenshots in `plans/redesign-new-dna/.scratch/review-p10b/` |

`OjcoreNativeExecutor.ts` is still **unchanged** in this diff, despite being listed in the review scope.

---

## Browser journey results (`.scratch/review-p10b/results.json`)

Chromium 1400×900, dev server on 5185, `localStorage` cleared on first load only.
Nodes created through the real right-click menu (Input▸Keyboard, Instruments▸Keys, Output▸Speaker,
Utility▸Empty Node), cables dragged between `[data-node-id][data-port-id]` centres.

| Assertion | Result |
|---|---|
| (a) reconnect a cable end onto an incompatible port keeps the original cable | **PASS** — `a_reconnectPreserved: true` |
| (b) Shift-click two nodes + drag one → both move, exactly one history entry, ONE Ctrl+Z restores both | **PASS** — selection 2, deltas `+120/+60` on *both*, `historyDelta 1`, undo deltas `0/0` |
| (c) Ctrl+wheel on a FRESH load keeps the node under the cursor (±2 px) | **PASS on the tolerance (1.214 px)** — but see D4: the *cause* is still live, this is the residual it produces |
| (d) hold a QWERTY note, drag a node while holding, release | **PASS** — 1 `on`, **zero `off` during the drag**, exactly one `off` after key-up |
| (e) enter a Container (select + `e`) and exit (`q`) | **PASS** — entered and exited; **0 `nodes`-Map publications** (the exact condition `App.tsx:202` turns into `executor.pushGraph()`); graph JSON byte-identical |
| (f) `Alt+=` zooms | **PASS** — zoom 1 → 1.1 |
| (g) zero console errors / pageerrors | **PASS** — both arrays empty across the whole journey including a reload |

Extra probe added by this review, and the two things it caught:

| Probe | Result |
|---|---|
| stored `canvasStore.canvasRect` vs live `.node-canvas.getBoundingClientRect()` on a fresh load | **`{-10.5, -6.75, 1421, 913.5}` vs `{0, 0, 1400, 900}`** — the D4 stale rect is **still there, byte-for-byte the P10a value** |
| `document.querySelectorAll('[data-canvas-node-root]').length` with nodes on canvas | **0** — UI-013's node ResizeObserver observes nothing |

---

## Verdicts

### Review defects D1–D12

| ID | Verdict | Evidence |
|---|---|---|
| **D1** held notes cut on every graph edit | **FIXED** | `NodeCanvas.tsx:587-601` holds `flushActiveNotesRef` and puts the `blur`/`visibilitychange`/unmount flush in its own `[]`-dep effect; `:615` only *assigns* the ref inside the graph-dependent effect, whose cleanup (`:1029-1032`) is now `unregister()` + `removeEventListener('keyup')` only. Key-up releases the physical source *before* the `isEditableTarget` early-return (`:958-970`), and the map is now keyed by `e.key.toLowerCase()` at press time (`:948`) so an action-id/`e.key` mismatch can't strand a note. Adversarial checks: no other `flush`/all-notes-off path exists on a graph mutation; `window.addEventListener('blur', …)` without capture cannot be reached by non-bubbling element `blur`; StrictMode **is** on (`main.tsx:42`) and its extra `[]`-cleanup flushes an empty map. Runtime-proven by journey (d). |
| **D2** `getNodeDimensions` collides with the `width` DSP param | **FIXED** | `graphStore.ts:70` gates persisted pixels on `node.type === 'library'`. The adversarial question — do other resizable nodes lose their measured size? — is **no**: `useResize` has exactly one call site in the whole repo (`LibraryNode.tsx:196`); `usePanelResize` is an internal separator, not node geometry; `container`, the panels and `sampler` never write `data.width`. Every other node now reads `registry.dimensions`, which is populated for all of them. |
| **D3** N store writes per group-drag frame | **FIXED** | `graphStore.ts:1201 moveNodes(Map)` mutates once and bumps `version` once (and returns `state` unchanged when nothing moved); `NodeWrapper.tsx:191` publishes the whole group per mousemove. Store test counts exactly 1 publication; journey (b) shows one history entry for a 12-step drag. |
| **D4** `canvasRect` captured under an entrance transform | **STILL-DEFECTIVE (P1)** | See below. Runtime-proven: stored `{-10.5,-6.75,1421,913.5}` vs live `{0,0,1400,900}` on a fresh load. |
| **D5** reconnect atomicity / `try/finally` / no double publication | **FIXED** | `graphStore.ts:1231-1257` — identity check first (no-op returns the same id, no history), `begin()` then `try { addConnection(..., connectionId) } finally { commit() }`. Atomicity is real, not cosmetic: `addConnection` filters the replaced edge out of the duplicate check (`:747`), the audio fan-in check (`:764`) and the instrument free-port search (`:729`), and deletes it inside the **same** `set` that installs the replacement (`:788-793`). The store test subscribes and observes exactly **one** publication that already contains the new id and not the old. `historyStore.begin/commit` are depth-counted (`historyStore.ts:66,82`), so the nested bracket in NodeWrapper is safe. |
| **D5b** speaker unplug fallback | **FIXED** | `SpeakerNode.tsx:71-106`. Adversarial question — does it fire only on real removal, never on enumeration churn? **Yes**: `updateDevices(false)` on mount, `updateDevices(true)` only from the `devicechange` listener, and the recovery branch additionally requires an *explicit* (`!== 'default'`) selection that is absent from the fresh list. Pinned by `SpeakerNode.test.tsx`. Residual P2 below (permission-less enumeration). |
| **D6** dedupe records the push before it happens | **FIXED** | `OjcoreWasmExecutor.ts:497-515` — `sendGraph` returns `boolean`, `lastPushedGraph` is assigned only on the success branch and in the ready-queue flush (`:305-310`); `dispose()`/`resync()` clear it. The not-ready path still queues into `pendingGraph` and leaves the marker alone. Pinned by a test that makes the first `postMessage` throw. |
| **D7** ghost-port creation escapes the reconnect transaction | **FIXED** | `NodeWrapper.tsx:274-379` brackets invention + reconnect in one `beginGesture`/`try`/`finally endGesture`. Pinned by a real call-site component test (`NodeWrapper.reconnect.test.tsx`) that asserts one history step and that undo restores *both* the cable and the original port list. |
| **D8** Ctrl+D clobbers the clipboard; browser-uncancellable zoom | **PARTIALLY FIXED** | `duplicateSelected` (`graphStore.ts:1749`) is clipboard-neutral and pinned (a subscriber proves `clipboard` never changes identity). Zoom moved to `Alt+=`/`Alt+-`/`Alt+0` and `Alt+=` is runtime-proven to zoom. **Two open items**: (i) `matchesKeyCombo` compares `e.key`, and on **macOS** `Alt+=`/`Alt+-`/`Alt+0` produce `≠`/`–`/`º`, so the whole zoom trio is dead on Mac (NEW-DEFECT N3); (ii) the View menu still advertises `Ctrl/⌘+=`, `+-`, `+0` (NEW-DEFECT N2). |
| **D9** non-null assertion on a stale selection | **FIXED** | `NodeWrapper.tsx:164-171` uses `flatMap` and drops ids missing from `nodes`. |
| **D10** paste id-remap holes | **FIXED** | `graphStore.ts:1681-1722` — `remapOwned` `flatMap`s away uncloned ids, `parentId` falls back to `canvasNavigationStore.currentViewNodeId`, the destination container's `childIds` is extended, and only genuinely root-level pastes are appended to `rootNodeIds`. `copySelected` now walks descendants and `structuredClone`s. Pinned by two tests including the `external-not-copied` case. |
| **D11** scroll semantics inverted for 8 consumers | **FIXED** | `useScrollCapture.ts:230` restores `scrollingUp = deltaY > 0`; the stale comment is replaced by one that names the contract and the eight consumers; NodeCanvas's `data.scrollingDown ? 0.9 : 1.1` reverts to its pre-P10a form, so all 8 untouched consumers (`WaveformEditorModal`, `InstrumentNode`, `InstrumentVisualNode`, `LooperNode`×3, `MultiplierNode`, `SamplerNode`, `SamplerVisualNode`) are back to their shipped direction — no behaviour change to review. Pinned by `useScrollCapture.test.tsx` driving a ValueScrubber. |
| **D12** `data-port-type` has no production reader | **FIXED (as scoped)** | `CanvasIONode.tsx:75` resolves the *rendered* port by direction; `LooperNode`/`MicrophoneNode`/`InstrumentNode`/`SamplerVisualNode` derive from the real port (SamplerVisual's two placeholder ports are legitimately `'control'`). No fake production reader was invented. |

### Incomplete items

| Item | Verdict | Evidence |
|---|---|---|
| **UI-005** dispatch by action id | **FIXED, with a stale-UI regression** | `file.new`/`file.import` are gone from `keybindingActions` and from every consumer/test. Adversarial questions: (i) *do the File menu items still work by click?* **Yes** — `Toolbar.tsx:294-306` still wires `onClick: handleNew` / `handleImport`. (ii) *were they documented and now stale?* **Yes** — `Toolbar.tsx:297,303` still print `⌘/Ctrl+N` and `⌘/Ctrl+O` next to them (NEW-DEFECT N2). `HelpPanel.tsx` never listed them, so it is clean. `KeybindingsPanel` renders `keybindingActions` dynamically, so it self-updates. Note the lane's own comment at `keybindingsStore.ts:44` says "Do not advertise shortcuts that silently do nothing" — the menus now do exactly that. |
| **UI-012** canvas rect everywhere | **FIXED in wiring, DEFECTIVE in value** | All four window-centre call sites migrated correctly (`canvasNavigationStore.ts:111,114`, `graphAdapter.ts:151`, `useCommandSources.ts:53`, `agentSessionStore.ts:309`) and the algebra round-trips with `screenToCanvas`. But because D4 leaves the rect at `{-10.5,-6.75,1421,913.5}`, every one of those spawn points is now off by ~10 px — the migration made the *fix* correct and the *input* wrong. |
| **UI-013** cable geometry cache invalidation | **STILL-DEFECTIVE (P2)** | `NodeCanvas.tsx:1084-1097` observes `[data-canvas-node-root]`, but the attribute is only on the **NodeFrame fallback** path (`NodeWrapper.tsx:614`). Every user-facing node type is in `SCHEMATIC_TYPES` (`NodeWrapper.tsx:47-71`) and returns at `:434` *before* NodeFrame — including `library`, the one resizable node this was for. Runtime-proven: `[data-canvas-node-root]` count is **0** with nodes on canvas. Only the `document.fonts.ready` half works. This is dormant production code (code-value #8). |
| **UI-014** container view state out of `graphStore.nodes` | **FIXED at the root** | `canvasNavigationStore.ts:29-184` owns `viewStates`; every `useGraphStore.setState({ nodes })` in that file is gone. Subscription trace: `App.tsx:200-213` pushes to the executor **only** when `state.nodes !== prevNodes`; enter/exit now touches only `canvasStore` and `canvasNavigationStore`, and `clearSelection` does not replace `nodes`. Runtime-proven: **0 nodes publications** across enter + exit, graph JSON identical. Store test asserts `nodes` object identity. |
| **UI-015** gesture close | **FIXED for the migrated families** | `ParamRow.tsx:23-40` and `EffectNode.tsx:42-62` both use a `gestureOpenRef` guard + `window blur` + unmount cleanup, so a close is idempotent. Checked the re-render-churn trap: `closeGesture`'s dep is stable at both call sites (`AutoParamPanel.tsx:63` passes the Zustand `beginGesture`/`endGesture` actions; EffectNode selects them from the store), so the effect does not re-run per render and cannot end a gesture mid-scrub. `SpeakerNode.tsx:184` adds the unmount close. Not migrated (and not claimed): Looper's range writes, `Slider` outside ParamRow/EffectNode. |
| **UI-020** library last-good selection | **FIXED (untested at the call site)** | `LibraryNode.tsx:295-325` decodes and delivers to the executor *before* committing `currentItemId`/`itemRefs`; a failed decode/delivery leaves the last-good selection. Still no dedicated component test — the lane's own "UNVERIFIED" stands. |
| **UI-026** guide state class | **FIXED for the class; the `<button>` regression carries over** | `GuideStep.tsx:16` maps `in_progress → in-progress` for root and indicator and adds `aria-expanded`. The header is still a `<button>` wrapping `<div>`s — invalid content model, unstyled by `.guide-step-header` rules written for a div. The report declares the CSS follow-up out of lane; flagging it so it is not lost. |
| **KeybindingsPanelSafe** | **FIXED** | `SettingsPanel.tsx:4,96` mounts the error-boundary wrapper (`KeybindingsPanel.tsx:260`). |

---

## New defects found in P10b

### N1 — P1. D4 is not fixed: the canvas rect is still captured under the entrance animation

`NodeCanvas.tsx:148-177` publishes on mount, on one `requestAnimationFrame`, on `ResizeObserver`, on
`window resize`, on captured `window scroll`, and on `transitionend`/`animationend` **bound to the canvas
element**. None of those can see the actual polluter:

- The transform lives on an **ancestor**: `App.tsx:658` puts `.surface-transition-in` on `.surface-layer`,
  and `ArrangementSurface.css:15-24` animates it `scale(1.015) → scale(1)` over `180ms` with a `60ms`
  delay and `both` fill. `animationend` fires on `.surface-layer` and **bubbles upward**, so a listener on
  the descendant `.node-canvas` never receives it.
- `ResizeObserver` reports border-box size, which an ancestor transform does not change — so it never fires.
- The one `requestAnimationFrame` lands at ~16 ms, inside the `both`-filled `from` keyframe.

Runtime-proven on a fresh 1400×900 load: stored `{left: -10.5, top: -6.75, width: 1421, height: 913.5}`
against a live `{0, 0, 1400, 900}` — *exactly* the `scale(1.015)` values the P10a review computed. It never
self-corrects; only a real window resize fixes it. Journey (c) passes its ±2 px tolerance only because the
resulting anchor error is `hypot(10.5, 6.75) × (1 − 1/1.1) ≈ 1.2 px` — and the measured value was 1.214 px.

Blast radius is now *larger* than in P10a, because UI-012 routed four more consumers through this rect:
right-click node placement, marquee rects, library/clip drops, collab cursors, `zoomTo` anchoring, and all
three `viewportCenter()` spawn points (AI, command palette, agent) plus `canvasNavigationStore`'s
fit/centre, which additionally use the 1.5 %-inflated `width`/`height`.

**Fix (pick one):**
1. Stop caching for the transforms. `screenToCanvas`/`canvasToScreen` read
   `canvasRef.current.getBoundingClientRect()` at the point of use — one layout read per gesture, not per frame.
2. Or keep the cache and republish from where the animation actually is: listen for `animationend`/
   `transitionend` on `document` in the **capture** phase (or on the `.surface-layer` element), and add a
   `getAnimations()`-aware settle (`element.getAnimations({subtree:true})` → `Promise.allSettled(finished)` → `updateRect`).
   A plain `setTimeout(updateRect, 300)` after mount would also close it, but capture-phase is the honest fix.
3. Cheapest correct guard regardless: read the rect *and* compare against `offsetWidth`/`offsetHeight`;
   a mismatch means a transform is active — retry next frame.

Pin it with a test that mounts under a scaled ancestor and asserts the rect equals the untransformed box.

### N2 — P2. The File and View menus advertise shortcuts this lane deleted or moved

`Toolbar.tsx:297` (`New Canvas` → `Ctrl/⌘+N`), `:303` (`Import Workflow…` → `Ctrl/⌘+O`) — both action ids
were removed from `keybindingActions` in this diff, so those keys now do nothing. `Toolbar.tsx:332,338,344`
(`Zoom In/Out/Reset View` → `Ctrl/⌘+=`, `+-`, `+0`) — the defaults are now `Alt+=`, `Alt+-`, `Alt+0`.
The menu items themselves still work by click; only the labels lie.
**Fix:** either drop the `shortcut` strings for `new`/`import`, or derive all five from
`useKeybindingsStore.getBinding(actionId)` so the menu can never drift from the keymap again.

### N3 — P2. `Alt+=` / `Alt+-` / `Alt+0` cannot fire on macOS

`matchesKeyCombo` (`keybindingsStore.ts:210-213`) compares `e.key.toLowerCase()`. On macOS, Option+`=`
yields `≠`, Option+`-` yields `–`, Option+`0` yields `º`. The zoom trio is therefore unreachable on the Mac
tier — the platform this repo signs and notarizes for. Windows/Linux/Chromium are fine (verified: journey (f)).
**Fix:** match `e.code` (`Equal`/`Minus`/`Digit0`) when `combo.alt` is set, or add explicit macOS default
bindings. A cross-platform keymap test would have caught it.

### N4 — P2. `data-canvas-node-root` never reaches the DOM (UI-013 is dead code)

Detailed under UI-013 above. `[data-canvas-node-root]` count is 0 at runtime.
**Fix:** put the attribute in `schematicProps` (`NodeWrapper.tsx:399`) so every schematic node root carries
it, or observe `.nodes-layer`'s children directly (`canvasRef.current.querySelectorAll('.nodes-layer > *')`).

### N5 — P3. Speaker recovery can fire when the OS simply withholds device labels

`SpeakerNode.tsx:88-95` treats "selected deviceId not in `enumerateDevices()`" as an unplug. Without
microphone permission Chromium returns output devices with empty `deviceId`s, so a persisted explicit
selection would be reset to `default` on the first unrelated `devicechange`. Downgrade-only, so it does not
violate the live-performance rule — but worth a `sorted.length > 0 && sorted.some(d => d.deviceId)` guard.

### N6 — P3. Dead field and a lost persistence behaviour from the UI-014 move

`internalViewport` (`engine/types.ts:544`) now has **zero** readers and writers — remove it (code-values #7/#8).
Also note the behaviour change nobody documented: per-container pan/zoom used to ride the persisted graph;
`canvasNavigationStore.viewStates` is not persisted, so container viewports are lost on reload. Probably
acceptable, but it should be a stated decision.

### N7 — P3. `SpeakerNode.tsx:125` declares `deviceSelectorRef` *after* the effect that closes over it

Legal at runtime and lint-clean, but it reads as a bug. Move the `useRef` above the effect.

### N8 — P3 (carried from P10a, unaddressed). Clicking one node of a multi-selection cannot isolate it

`NodeWrapper.tsx:157-162`: a plain click on an already-selected node keeps the whole selection (needed for
group drag) and never collapses on a click that does not become a drag. Standard editors collapse on
*mouse-up without movement*. Cheap fix inside the existing `gestureStarted` flag.

---

## Test quality

Every new test was checked against the P10a code. Non-vacuous, i.e. it fails pre-fix:

- `NodeCanvas.reliability` "keeps a held note alive across a graph mutation…" — P10a's flush rode the
  `allNodes`-dep cleanup, so `addNode` released; and P10a's key-up returned early on an editable target. **Fails pre-fix twice.**
- `…"republishes a changed canvas position after a transition"` — no `transitionend` listener existed. **Fails pre-fix.**
- `…"keeps the canvas point under a ctrl-wheel anchor pixel-locked"` — P10a anchored on `mousePosRef`, never
  written in this test. **Fails pre-fix.** *Weak spot:* the rect is constant in this test, so it cannot detect
  N1 (a stale-but-consistent rect satisfies it). It pins the *arithmetic*, not the *input*.
- `useScrollCapture` "positive-delta scrollingUp" — **fails pre-fix** (P10a inverted it).
- `canvasNavigationStore` "enters and exits without mutating audio graph nodes" (`nodes` **identity**) — **fails pre-fix.**
- `graphStore` width/library/unknown-plugin geometry, `moveNodes` single publication, the five reconnect
  cases (reject / throw / atomic single publication / same-port no-op / one-undo), deep container clone,
  paste-into-container with an uncloned child, clipboard-neutral duplicate — **all fail pre-fix.**
- `NodeWrapper.reconnect` three cases (ghost-port + reconnect in one undo, click-is-history-neutral +
  Shift-toggle + blur closes one group gesture, unmount closes the gesture) — **all fail pre-fix**; these are
  the first tests to pin the P0 *call site*, which the P10a review demanded.
- `SpeakerNode` "no routing change on mount, falls back on devicechange" — **fails pre-fix** (P10a auto-selected on mount).
- `ojcoreExecutors` dedupe retry — **fails pre-fix** (marker was set before the post).

Partly vacuous / weak (still worth keeping, but they do not earn their headline):

- `NodeCanvas.reliability` `it.each(['blur','visibilitychange','unmount'])` — P10a's cleanup also flushed
  once on unmount and it also had blur/visibility listeners, so at least the `unmount` and `blur` cases
  **pass on P10a**. Regression guards, not proofs.
- `ParamRow` `it.each([...])` — the `cancel` case passes on P10a (`onPointerCancel={onGestureEnd}` already
  existed). `blur`/`window-blur`/`unmount` are the real new coverage.

Missing, given the findings above:

1. A canvas-rect test that mounts under a **scaled ancestor** — the only test that would catch N1.
2. A keymap-coverage gate asserting every `keybindingActions` id has a registered consumer (the lane
   removed the two known orphans instead of adding the gate, and immediately grew two stale menu labels).
3. A cross-platform combo test for the `Alt` trio (N3).
4. A test that `[data-canvas-node-root]` exists on a rendered schematic node (N4).
5. The LibraryNode last-good delivery test the lane already flags as UNVERIFIED (UI-020).

---

## Must fix before commit (ranked)

1. **N1 / D4** — republish (or stop caching) `canvasRect` from where the ancestor entrance animation
   actually ends. Runtime-proven wrong by 10.5 px on every fresh load, and UI-012 just widened its blast
   radius to node placement, marquee, drops, collab cursors and all three AI/palette spawn points. This is
   the one item that is *worse* after P10b than before it.
2. **N4** — move `data-canvas-node-root` into `schematicProps` (or observe `.nodes-layer > *`). Right now
   UI-013 ships an observer with nothing to observe; `library`, the only resizable node, is not covered.
3. **N2** — stop advertising `Ctrl+N` / `Ctrl+O` / `Ctrl+=` / `Ctrl+-` / `Ctrl+0` in the File and View
   menus; derive the labels from the keymap.
4. **N3** — make the `Alt` zoom trio match on macOS (`e.code` when `combo.alt`), or the whole D8 fix is
   Windows-only.
5. **N5 / N6 / N7 / N8** — the P3s: enumeration guard, delete the dead `internalViewport` (and state the
   container-viewport persistence decision), hoist the ref, decide the click-to-isolate behaviour.
6. Add the five missing tests above, starting with the scaled-ancestor rect test.

Not required before commit, but still open from P10a: the `GuideStep` `<button>`-wrapping-`<div>`s content
model + the CSS that no longer matches it (declared out of lane).

---

## Recommendation

**DO-NOT-COMMIT as-is** — commit after item 1 (and preferably 2–4).

This is a genuinely strong lane: eleven of twelve review defects are fixed, several with the first real
call-site tests this change set has ever had, and the browser journey nobody had completed now passes every
single behavioural assertion including the stage-critical held-note case. Nothing here is unsafe to the
audio path. But the headline P1 of the previous round — the ~10 px canvas rect — is reported as fixed and
**is not**, and this round widened its reach; and one of the completed items (UI-013) ships an observer that
observes zero elements. Both are one-file changes. Fix those and this is a clean commit.

## Not verified

- Anything audible: no monitored-audio test was possible. Note continuity is proven at the *event* level via
  the E2E bridge, not at the ear.
- Real hardware output-device unplug (D5b) — jsdom-mocked only.
- `OjcoreNativeExecutor` behaviour (the file is unchanged in this diff).
- macOS keyboard behaviour (N3 is derived from `e.key` semantics, not measured on a Mac).
- `bunx tsc --noEmit` was not claimed clean by either lane; the concurrent timeline lane's
  `src/store/__tests__/arrangementStore.test.ts` fixture blocks it, per instruction.
