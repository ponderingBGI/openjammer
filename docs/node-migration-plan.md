<!-- Node-system migration plan — synthesized by the node-system-research workflow (5 agents). Contract-preserving execution plan for the NodeCanvas/NodeWrapper/node-types -> oj-ui migration. -->

# OpenJammer Node-System → oj-ui Migration Plan

**Scope:** Move the node/canvas UI onto `@openjammer/oj-ui` (NodeFrame/NodeShell/Port/PortRow/Cable + leaf primitives) with **zero legacy**, preserving every load-bearing contract so the live canvas never breaks. The audio executor (`subscribeSignalLevels` producer, AudioWorklet/native) is **off the React tree and is not touched** — the canvas only *reads* the level Map and *hit-tests the DOM*.

> **STATUS: COMPLETED.** This migration has shipped — the node/canvas UI composes from
> `@openjammer/oj-ui` and the legacy port classes are gone. Retained as the execution
> record; read the future-tense steps below as history, not pending work.

---

## 1. THE DOM CONTRACT & THE INVARIANT THAT KEEPS IT ALIVE

There are exactly **two ways NodeCanvas reaches into node DOM**, and they have opposite coupling. The whole migration succeeds or fails on understanding which is which.

### Contract A — Port anchoring (ATTRIBUTE-based, CSS-class-AGNOSTIC) — already safe

`NodeCanvas.tsx:225-227` (box-select port center) and `NodeCanvas.tsx:993-995` (cable endpoint render) both do:

```js
document.querySelector(`[data-node-id="${nodeId}"][data-port-id="${portId}"]`)
```

…then take `getBoundingClientRect()` center, reverse the pan/zoom transform, and cache. **This never reads a class.** It is verified safe because:
- `Port.tsx:51` renders `<span {...rest}/>` — `data-node-id`/`data-port-id`/`data-port-type` forward verbatim (the doc comment at `Port.tsx:26-28` explicitly flags this as "load-bearing").
- `PortRow` forwards `...rest` to its inner `Port`; `KeyTile` forwards to its `<button>`.

> **INVARIANT A (the cable anchor rule):** `data-node-id` + `data-port-id` MUST land on the **exact element whose bounding-box center is the visual dot center**. When swapping a marker to `<Port>`, attach the data-attrs to the `<Port>` itself (not a wrapper), and verify the `oj-port` span's box center equals the old dot center. Any node that wraps `<Port>` in extra padding so the data-attr element's center ≠ the dot center will anchor cables off-center. **Verify per node type with audio flowing.**

Positioning model change is safe under this contract: `NodeFrame` positions via `transform: translate(x,y)` (verified `NodeFrame.tsx`), while legacy uses `left/top`. `getBoundingClientRect` is screen-space and transform-agnostic, so the rect path is unaffected. The **math fallbacks** (`NodeCanvas.tsx:243-251` hardcoded 180×120; `calculatePortPosition`) assume `left/top` semantics — they only fire when the port DOM is absent, so keep ports in the **synchronous** node render (no lazy/portal port mount) so the rect path always wins after the first rAF.

### Contract B — Hit-testing (CLASS-based, node-type-specific) — THE #1 BREAK RISK

Two `closest()` calls hardcode legacy classes:

- **Right-click guard** — `NodeCanvas.tsx:275`:
  ```js
  (e.target).closest('.node, .schematic-node')
  ```
  Decides node-vs-empty-canvas for the add-node context menu.

- **Left-click box-select guard** — `NodeCanvas.tsx:290-292` (verified verbatim):
  ```js
  (e.target).closest(
    '.node, .schematic-node, .port, .port-dot, .port-circle-marker, .note-input-port, .output-port, .speaker-input-port'
  )
  ```
  If this returns null on a left-mousedown, the canvas runs `clearSelection(); stopConnecting();` and starts a marquee (`NodeCanvas.tsx:293-296`). A port that swaps `.port-dot`→`.oj-port` **without this list being updated** turns every port mousedown into "clear selection + cancel in-progress connection + start box-select." **HIGH severity, instant, silent in compile.**

> **INVARIANT B (the lockstep rule):** The line 290-292 selector must **always be the UNION of every node-root and port class currently mounted on the canvas.** Add new oj-ui classes *additively* before/with the first emitter; remove a legacy class only after its **last** emitter is migrated. Same union discipline for line 275 (node-root classes only).

**Two ways to satisfy Invariant B — we choose the belt-and-suspenders combination:**

1. **Keep the legacy structural class on the oj-ui root.** NodeShell and NodeFrame both spread `...rest` and merge `className` (verified `NodeShell.tsx:36-46`, `NodeFrame.tsx`). So a migrated standard node renders `<NodeFrame className="node">` → `class="oj-node-frame node ..."`, and a schematic node passes `className="schematic-node"`. This means **line 275 never has to change** and the node-root half of 290-292 stays satisfied for free.
2. **Add `.oj-port` to the line 290-292 union once, up front** (it is class-agnostic which node emits it). Ports are the half that genuinely changes class (`port-dot`→`oj-port`), so the union must learn `.oj-port`.

**The concrete edits (PRE-WORK step 0, pure no-op, ships before any node migrates):**

`NodeCanvas.tsx:290-292` becomes:
```js
const isNodeOrPort = (e.target as HTMLElement).closest(
  '.node, .schematic-node, .oj-node-frame, .oj-node, ' +
  '.port, .oj-port, .oj-port-row, ' +
  '.port-dot, .port-circle-marker, .note-input-port, .output-port, .speaker-input-port'
);
```
`NodeCanvas.tsx:275` — add the oj-ui roots as defense-in-depth even though we also keep `.node`/`.schematic-node`:
```js
(e.target).closest('.node, .schematic-node, .oj-node-frame, .oj-node')
```

This is additive: with no node migrated yet it changes nothing (no element has the new classes). It de-risks every later increment.

### Contract C — Ghost-mode / connecting CSS (CLASS-based, visual) — lockstep with first node

`NodeCanvas.css:180-192` dims `.node, .schematic-node` to opacity 0.1 in AI ghost mode and keeps `.port-dot` glowing (`@keyframes portGlow`). Because we keep `.node`/`.schematic-node` on the oj-ui root (decision 1 above), the **dim** half survives free. The **port-glow** half is tied to `.port-dot` and must gain `.oj-port`. Do this in PRE-WORK too (additive):

`NodeCanvas.css` ghost-mode port selector: `.node-canvas.ghost-mode .port-dot` → `.node-canvas.ghost-mode .port-dot, .node-canvas.ghost-mode .oj-port` (and re-point `@keyframes portGlow` consumer accordingly). The connection-layer z-index rule at `NodeCanvas.css:35-37` is class-agnostic — leave it.

### Contract D — Signal levels (audio read) — pass through VERBATIM, do not "fix"

`NodeCanvas.tsx:121` subscribes once; `signalLevelsRef` is rAF-throttled into `setSignalLevels`. The resolved level at `NodeCanvas.tsx:1045`:
```js
signalLevels.get(audioConnectionKey) ?? signalLevels.get(conn.id) ?? 0
```
The arrow-key (`sourceNodeId->targetNodeId`) is **dead with current ojcore executors** (only `conn.id` resolves, for control). This is an audio-coupled read and an every-line-used concern that belongs in its **own** change, not the UI swap.

> **INVARIANT D:** Pass the *already-resolved number* as `<Cable signalLevel={lvl}/>`. Do NOT touch the key logic, the subscription, the throttle, or move the subscription into per-Cable. Do not "clean up" the dead arrow key during the UI migration.

---

## 2. ORDERED INCREMENTS

Legend: **[SERIAL]** = touches a shared file (`NodeCanvas.tsx`, `NodeCanvas.css`, `BaseNode.css`, `SchematicNodes.css`) and MUST be done on a single branch in sequence — **cannot** run as a parallel worktree task. **[PARALLEL-OK]** = touches only one node's own files and can run as an isolated worktree workflow task once the prerequisite serial step has landed.

Every increment is **green** (compiles, no console errors), a **visual no-op** unless explicitly flagged, and **live-audio-safe**.

---

### Increment 0 — PRE-WORK: selector + ghost-mode unions **[SERIAL — NodeCanvas.tsx + NodeCanvas.css]**
Pure additive no-op (no element carries the new classes yet). Lands Invariant B and C edits above:
- `NodeCanvas.tsx:290-292` union += `.oj-node-frame, .oj-node, .oj-port, .oj-port-row`.
- `NodeCanvas.tsx:275` union += `.oj-node-frame, .oj-node`.
- `NodeCanvas.css` ghost-mode port-glow selector += `.oj-port`.

This unblocks every subsequent step and lets them run with far smaller blast radius.

---

### Increment 1 — Cable swap **[SERIAL — NodeCanvas.tsx + NodeCanvas.css]**
The single oj-ui swap *inside* NodeCanvas. Self-contained, no DOM-query coupling, immediately reversible. Verified drop-in: `cablePath.ts` math === `NodeCanvas.tsx:1027-1033`; `Cable.tsx:113` comparator === `NodeCanvas.tsx:93`; prop surface (`start/end/kind/selected/bundled/bundleCount/signalLevel/temp/onSelect`) covers every current usage.

1a. **Permanent cables** — replace the local `ConnectionPath` memo (`NodeCanvas.tsx:56-94`) and its render at `renderConnection`:
- `kind={conn.type}` (1:1, `ConnectionType` === `CableKind`), `selected={isSelected}`, `bundled={isBundled}`, `bundleCount={...}`, `signalLevel={lvl}` (the resolved number from `:1045`, Invariant D), `onSelect={() => selectConnection(conn.id)}`.
- **Drop `data-connection-id`** (`NodeCanvas.tsx:73`). Cable doesn't emit it; grep confirmed no reader. **Gate:** `grep -rn "data-connection-id" src/ packages/ e2e/ tests/` returns only the (now-removed) self-set before relying on removal.

1b. **Temp cable** — `renderTempConnection` (`NodeCanvas.tsx:1063-1097`) → `<Cable temp kind={...} .../>`. **Explicit perception decision (DESIGN owner sign-off required):** legacy temp is hardcoded `control` color + marching-ants `@keyframes dash`; oj-ui `Cable temp` (`Cable.css:75-80`) is static dashed, true-kind-colored, no animation. **Recommendation:** adopt true-kind color (a correctness win — the temp cable now previews the real wire color) AND **port the `@keyframes dash` marching-ants into `Cable.css .oj-cable.is-temp`** so the live "I'm dragging a wire" motion is preserved. This keeps the perceptible affordance while fixing the wrong-color bug. Preserve the multi-source fan-out (`index*10` Y offset, `:1076`).

1c. **CSS retirement** — once both render sites are Cable: **delete** `NodeCanvas.css:56-137` (`.connection-line` + `.audio/.control/.universal/.selected/.bundled/:hover` + `--signal-level` + `.connection-temp` + `@keyframes dash` if ported to Cable.css). Re-point ghost-mode cable rules `NodeCanvas.css:195-208` from `.connection-line` → `.oj-cable`. The var rename `--signal-level`→`--oj-cable-signal` is internal to Cable; nothing external reads it.

**Verify:** cables render + anchor after pan/zoom (cache bust intact); cables light on live signal (play audio, watch a control cable pulse via `conn.id` fallback); cable click selects; ghost-mode (W) brings cables on top + glows; temp cable shows true color + motion on drag-to-connect; **profiler: confirm no extra React reconciliation per audio frame** (comparator <1% delta holds).

---

### Increment 2 — Standard NodeWrapper branch → NodeFrame/NodeShell/PortRow/Port **[SERIAL — NodeWrapper.tsx + BaseNode.css + NodeCanvas (already done in #0)]**
The pattern-setter. One atomic commit. Standard branch `NodeWrapper.tsx:487-553`:

- Outer: `<NodeFrame position={node.position} dragging={isDragging} className={`node ${node.type}`} onClick={stopProp} onMouseEnter={handleNodeMouseEnter} onMouseLeave={handleNodeMouseLeave}>` — **keep `node` in className** (Invariant B free pass for line 275 + ghost dim). Wire `isDragging` to BOTH NodeFrame (cursor) and NodeShell (visual).
- `<NodeShell title={headerTitle} nodeType={node.category} selected={isSelected} dragging={isDragging} agentPending={isAgentPending} headerProps={{ onMouseDown: handleHeaderMouseDown }}>`.
  - **Drag handle scope:** `handleHeaderMouseDown` goes ONLY on `headerProps` — never on NodeFrame/NodeShell root, or the whole card (incl. ports/params) becomes draggable.
- Port rail: NodeShell provides header+content but **NOT** the left/right rail. **Keep `.node-ports/.node-ports-left/.node-ports-right`** as a thin flex wrapper inside NodeShell's children (this is the one piece of standard chrome with no oj-ui equivalent). Inside each side: `<PortRow side={port.direction} kind={port.type} connected={hasConnection(port.id)} hideLabel={port.hideExternalLabel} data-node-id={node.id} data-port-id={port.id} data-port-type={port.type} onMouseDown={(e)=>handlePortMouseDown(port.id,e)} onMouseUp={...} onMouseEnter={...} onMouseLeave={...} label={port.label}/>`.
  - 1:1 mappings: `port.type`→`kind`, `port.direction`→`side` (verified). `data-port-type` is write-only (zero readers in src) — pass it for schematic parity.
  - **`hideExternalLabel` behavior change:** legacy removes label from DOM; `PortRow.hideLabel` keeps it visually-hidden (a11y win). Verify `oj-port-row__label--hidden` reserves no width (must be `display:none`-equivalent) so the rail doesn't shift.
- Content: `{renderNodeContent()}` → NodeShell children (after the port rail wrapper). EffectNode/AmplifierNode/RecorderNode/AutoParamPanel children still use `.node-row/.node-select/.node-btn` — **untouched here** (follow-on Increment 8).

**BaseNode.css edits (delete ONLY now-dead shell+port blocks):** delete `.node` (8-17), `.node.selected/.dragging` (19-32 — superseded by NodeShell `is-*`), `.node-header/.node-title/.node-type` (62-88), `.node-content` (90-92), `.port/.port-input/.port-output/.port-dot*/.port-label` (121-187). **KEEP:** `.node.agent-pending` + `@keyframes oj-agent-pending` + reduced-motion (34-57) **only if NodeShell.css does not yet carry the audio-blue hard ring + 1.2s pulse + reduced-motion guard** — verify NodeShell reproduces it (DESIGN load-bearing: hard ring, no node movement); if it does, delete here. **KEEP** `.node-ports*` (rail layout, no oj-ui home). **KEEP** child-chrome (`.node-btn*`, `.node-select`, `.node-row`, `.node-label`, `.node-controls`, `loop-*`) for Increment 8.
**Flag dead (verify zero string-built classNames, then delete):** `.node-input` (261-275, 0 consumers), `.node-progress/.node-progress-bar` (311-325, 0 consumers, ProgressBar supersedes).

**Verify (full live-audio suite — this is the gate the whole migration leans on):** drag a standard node by its header (body/ports do NOT drag); connect + disconnect a cable to/from it (anchors on the dot center — eyeball after pan AND zoom); box-select starts on empty canvas, NOT on the node/port; right-click on the node does NOT open the add-menu; ghost-mode dims it + glows its ports; agent-pending ring pulses; undo/redo of a connection; **profiler clean during live signal.**

---

### Increment 3 — Settings CSS exile (no canvas impact) **[SERIAL — SchematicNodes.css, but independent of nodes]**
Pure relocation, can run anytime after #0. `SchematicNodes.css:1052-1226` is a foreign Settings island. **MOVE** `.minimal-*` (1055-1162) + `.about-*` (1164-1226) → new `src/components/Settings/SettingsPanel.css`. Repoint imports: `SettingsPanel.tsx` + `AboutPanel.tsx` (currently `import '../Nodes/SchematicNodes.css'`) → the new file; remove their SchematicNodes.css import. **KEEP** `@flash-red` (2010-2013) + `.canvas-io-node.deletion-attempted` (2015-2017) — those belong to CanvasIONode, not Settings. (`CommandBar.css:2` only name-drops `.minimal-settings-overlay` in a comment — no code coupling.)
**Verify:** open Settings + About panels — chrome intact; canvas untouched.

---

### Increments 4–7 — Schematic node FAMILIES, one node-type per commit
Each commit: (a) swap that node's port markers → `<Port>`/`<PortRow>` keeping `data-node-id`/`data-port-id` on the port element + its **absolute-position wrapper** (Invariant A — side-ports like `.looper-input-port`, `.sampler-side-port`, `.speaker-input-port`, `.library-port` use `position:absolute` + translate; oj-ui Port has none, so the per-node position wrapper around `<Port>` STAYS); (b) extract that node's KEEP body rules into a colocated `NodeName.css`; (c) **delete that node's port-dot visual + schematic-chrome rules from SchematicNodes.css**; (d) if it was the last emitter of a legacy class in the 290-292 union, drop that token. Keep `className="schematic-node"` on each migrated node's NodeFrame (Invariant B free pass).

**Each schematic node touches its own files only → [PARALLEL-OK]** as worktree-isolated workflow tasks — **EXCEPT** the shared-file edits (deleting from `SchematicNodes.css`, dropping a token from `NodeCanvas.tsx:290-292`). Strategy: parallel tasks edit only `NodeName.tsx` + create `NodeName.css`; a **serializing "reaper" commit** per batch deletes the now-dead SchematicNodes.css blocks and prunes the selector union. This keeps SchematicNodes.css single-writer.

**Increment 4 — FAMILY E leaf-first (smallest, no consolidation):** Math (`port-dot universal resolved-{type}` → `<Port kind="universal" resolvedKind={resolved}/>`), Container (`port-dot {type}` rows + EditableLabel name), CanvasIO (single `port-dot`, EditableLabel, **note root is the drag handle** — `CanvasIONode.tsx:82` attaches `handleHeaderMouseDown` to the node root, not a header strip; either give NodeShell a full-card headerProps via a bespoke header or keep its bespoke header — verify drag still works), Speaker (`speaker-input-port`, mute Button, device Select). Each: delete its port-dot block from SchematicNodes.css.

**Increment 5 — FAMILY E executor-seam nodes (re-skin DOM ONLY, never the audio seam):** Microphone (`mic-output-port`; **keep its private `AnalyserNode` + rAF `updateWaveform` + `setMicrophoneOutput`**, `MicrophoneNode.tsx:205-320`), Looper (`looper-input/output-port`; keep `getLooper`/`getAudioContext`; duration→ValueScrubber, record→Button, Waveform+ProgressBar), Sampler (`sampler-side/key/placeholder-port`; keep `getSamplerAdapter`/`waitForSamplerAdapter`; Waveform from `waveformData[]`), Recorder (keep `getRecorder` callbacks). **INVARIANT (agents.md): touch only presentational DOM; never move `getExecutor()` calls or `AudioContext.currentTime` timing into oj-ui.**

**Increment 6 — FAMILY B MIDI/Keyboard (shared `.port-circle-marker`):** Keyboard, MIDINode, MiniLab3Node. MIDINode/MiniLab3Node are near-clones — see consolidation below. Status dot→StatusDot, rename→EditableLabel. Drop `.port-circle-marker` from the union only after the LAST of these + MIDIVisual migrates.

**Increment 7 — FAMILY D visual dive-in nodes:** KeyboardVisual, MIDIVisual, InstrumentVisual, MiniLab3Visual, SamplerVisual. Keys/pads→KeyTile (variant key/pad/white/black). **KeyTile data-attr gotcha:** `KeyTile.tsx:54` forwards `...rest` to the outer `<button>`, and KeyboardVisualNode today already puts data-* on the outer tile div — consistent. But verify per node the data-attr element's center === the dot/key center (Invariant A). Plus the main Instrument node (`bundle-input-port`/`instrument-output-port`→Port; `ScrollableRowValue`→ValueScrubber, see consolidation).

**Per-increment verify (every node, every commit):** connect/disconnect cable to each migrated port (anchor on dot center, post pan+zoom); box-select on empty canvas not on the node; right-click pan vs menu; ghost-mode dim+glow; drag by header; undo/redo; **for FAMILY E: audio actually plays — mic waveform animates, looper records/loops, sampler triggers, recorder captures — with a clean profiler.**

---

### Increment 8 — Standard-node CHILD chrome → leaf primitives **[PARALLEL-OK per child component]**
After Increment 2, migrate the FAMILY A inner-UI: EffectNode (Select + param rows→Slider/ValueScrubber), AmplifierNode (Button presets), RecorderNode (Buttons + list), AutoParamPanel (`ParamRow`→Slider). Each child is its own file → parallel. After all migrate: **delete** `.node-btn*`, `.node-select`, `.node-row`, `.node-label`, `.node-controls` from BaseNode.css.

---

### Consolidations (folded into the increments above, not separate passes)

- **InputPanelNode + OutputPanelNode → one `PortPanel`** (in Increment 4/5 window). They are mirror images: input = label-then-dot, output = dot-then-label — exactly what `PortRow side` gives. EditableLabel for the port name. InputPanel additionally embeds `BundlePortGroup` (keep its disclosure-triangle/tree-connector structure bespoke; map only the `.bundle-port-marker` → Port, keeping data-* on it). Collapse the mirrored `.input-panel-*`/`.output-panel-*` CSS into one block. **Delete dead `.note-input-port` (SchematicNodes.css:694-722, no React producer) AND drop the `.note-input-port` token from the 290-292 union in the same commit.**
- **MIDINode ~ MiniLab3Node → one `MidiDeviceNode` with a preset prop** (Increment 6) — near-clones sharing `.keyboard-node`/`.keyboard-schematic-body`/`.port-circle-marker`.
- **`ScrollableRowValue` (InstrumentNode:117-149) + `ScrollableValue` (SamplerVisualNode:40-75) → ValueScrubber** (Increments 6/7). **CRITICAL (Invariant E):** `ValueScrubber` (`ValueScrubber.tsx:26-39`) does NOT self-scroll — it spreads `onPointerDown`/`onWheel` to the parent. The parent MUST keep wiring `useScrollCapture`'s ref/`onWheel` onto ValueScrubber's spread span, or scroll-to-change on Instrument Note/Octave/Offset + Sampler dies **silently** (no compile error). Verify by scrolling each value with audio.

### Fixes-the-right-way-now (folded in, never a separate "cleanup" PR except the audio-coupled one)
- **Literal colors → theme vars** (DESIGN: colors are theme vars), done as each node is touched: rainbow gradient literals `#FF6B6B/#FFE66D/#4ECB71/#4DB8FF/#9B59B6` (universal-port rules at SchematicNodes.css:2240/2399/2508) — **delete; render universal via `<Port kind="universal"/>` (solid violet token).** **DESIGN owner must confirm universal ports become violet, not rainbow** (`@keyframes rainbow-shift` 2531-2535 retired) — if rainbow must stay it becomes a node-specific KEEP. Other literals (`#888` bundle glow 650-657, `#FFD700` favorite 2991, `rgba(...)` hover fills) → tokenize on the way out.
- **Dead rules deleted as encountered:** empty `.library-separator` (3397-3399); dup `.library-tag cursor` (3289-3292) merge into 3258-3267; dup `.port-circle-marker.note/control` fills (417-425) dedup against 382-390.
- **Do NOT touch** runtime-injected theme tokens (`--audio-connected`, `--control-connected`, `--universal-port`) — they resolve from theme JSON at runtime; both legacy and `Port.css` already depend on them. They are NOT orphans.
- **Dead arrow signal key** (`sourceNodeId->targetNodeId`) — **flag, do NOT fix here.** Audio-coupled read; its own change after the UI is fully migrated (Increment 9b).

---

### Increment 9 — TWIN DELETION + grep gate **[SERIAL — BaseNode.css + SchematicNodes.css + NodeCanvas.tsx]**
After every node uses NodeShell/Port:
- **Delete** `.schematic-node/.schematic-header/.schematic-container/.schematic-title` chrome (SchematicNodes.css:10-64) and any remaining BaseNode.css generic chrome.
- **SchematicNodes.css should now cease to exist** (its bulk — library/sampler/looper/keyboard/instrument bodies — has been relocated to colocated `NodeName.css`). Remove the file + its (now zero) imports.
- **Prune the 290-292 union** down to its final form: `'.node, .schematic-node, .oj-node-frame, .oj-node, .oj-port, .oj-port-row'` — drop every legacy port token (`.port`, `.port-dot`, `.port-circle-marker`, `.note-input-port`, `.output-port`, `.speaker-input-port`) now that no element emits them. (Keep `.node`/`.schematic-node` only if any node still passes them as className for line 275; otherwise drop too and rely on `.oj-node-frame`.)
- **9b (separate, audio-coupled):** review the dead `sourceNodeId->targetNodeId` key (every-line-used) — its own commit, with audio profiling.

**Grep "no parallel paths" gates (CI + manual):**
```
grep -rn "connection-line"            src/        # → 0 (Cable owns cables)
grep -rn "ConnectionPath"             src/        # → 0
grep -rn "port-dot\|port-circle-marker\|note-input-port\|speaker-input-port" src/  # → 0
grep -rn "SchematicNodes.css\|BaseNode.css" src/  # → 0
grep -rn "data-connection-id"         src/ e2e/   # → 0
grep -rn "--signal-level"             src/        # → 0 (oj-cable-signal owns it)
```
Plus the standing CI guards remain green: `assert_no_alloc`, the `RtCommand` size guard, the acyclic-schedule invariant — **none touched** (audio path untouched throughout).

---

## SERIALIZATION SUMMARY (for the orchestrator)
- **MUST serialize (single branch, single writer):** #0, #1, #2, #9 — all touch `NodeCanvas.tsx`/`NodeCanvas.css`/`BaseNode.css`. Order is strict: 0 → 1 → 2 → … → 9.
- **The SchematicNodes.css deletions** in #4–#7 must be single-writer — funnel through a per-batch "reaper" serial commit; the per-node `.tsx`+`NodeName.css` work in those increments is **[PARALLEL-OK]** in isolated worktrees.
- **#3 (Settings exile)** and **#8 (child chrome)** are **[PARALLEL-OK]** against the serial spine, since #3 only relocates Settings rules and #8 touches per-child files.

## THE LIVE-AUDIO ACCEPTANCE TEST (run after EVERY increment, headphones on)
1. Audio playing through a graph; 2. cables anchor to dots after pan **and** zoom (Contract A + two-pass cache-bust); 3. a hot cable's stroke pulses (Contract D), profiler shows **no per-frame React reconciliation** beyond the <1% comparator; 4. drag-to-connect **starts** on a port (Invariant B), box-select starts only on empty canvas; 5. ghost-mode (W) dims nodes + glows ports + raises cables; 6. right-click on a node does NOT open the add menu; 7. connect/disconnect + undo/redo (Ctrl+Z) works; 8. **a held note survives the change — no glitch, no dropout.**

## OFF-LIMITS (untouched all the way through)
The `subscribeSignalLevels` producer (`OjcoreNative/WasmExecutor`, audio thread); the keyboard/Esc/mode-switch window handlers; ContextMenu (registry-driven, no port/cable DOM); the clips layer; `useScrollCapture`'s ref contract; per-node executor seams (mic AnalyserNode, looper/sampler/recorder adapters). The canvas only **reads** the level Map and **hit-tests** the DOM — that boundary is the whole reason this migration is safe.

**Files cited:** `/home/wsl/projects/openjammer/src/components/Canvas/NodeCanvas.tsx` (lines 56-94, 121, 225-227, 275, 290-292, 951-979, 993-995, 1027-1097), `/home/wsl/projects/openjammer/src/components/Canvas/NodeCanvas.css` (35-37, 56-137, 180-220), `/home/wsl/projects/openjammer/src/components/Nodes/NodeWrapper.tsx` (44-66, 182-349, 352-384, 387-437, 487-553), `/home/wsl/projects/openjammer/src/components/Nodes/BaseNode.css`, `/home/wsl/projects/openjammer/src/components/Nodes/SchematicNodes.css` (10-64, 694-722, 1052-1226, 2531-2535, 3289-3292, 3397-3399), `/home/wsl/projects/openjammer/packages/oj-ui/src/components/{Port/Port.tsx,Cable/Cable.tsx,NodeShell/NodeShell.tsx,NodeFrame/NodeFrame.tsx}`.