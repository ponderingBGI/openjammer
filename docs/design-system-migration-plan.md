<!-- Master migration plan — synthesized by the oj-ui-migration-audit workflow (8 Opus agents, 7 area audits). This is the execution contract for the @openjammer/oj-ui rebuild. Keep it the source of truth; update as increments land. -->

# OpenJammer oj-ui Master Migration Plan
**Lead Design-System Architect — ground-up rebuild, zero legacy, no parallel paths**

This plan extracts every reusable UI element into `@openjammer/oj-ui` as theme-agnostic, presentational, prop-driven components, and rewires the app to consume them while deleting every twin. It honors the covenant: **minimal core, infinite edges; every line used; migrate fully, remove legacy; the audio path is sacred.** It honors DESIGN.md's named rules (Hard-Shadow, Press-Is-Physical, No-Surprise, Port-Color-Is-Meaning, Signal-Not-Brand, Caveat-Is-the-Voice, Mono-Means-Exact).

The non-negotiable invariant for every increment: **GREEN (typecheck + lint + test + build) and a VISUAL NO-OP** — today's look is preserved exactly, captured as the `sketchbook` theme, until the designer's new default theme lands in Phases 4–6.

---

## STATUS (updated as increments land)

**DONE + committed + green** (oj-ui typecheck, app build, lint, 1091 tests, e2e PWA smoke, Ladle build — each slice also live-verified in-browser):
- **Phase 0–2** — tokens unified (`@openjammer/oj-tokens`, DTCG → Style Dictionary, no-op), 37-component `@openjammer/oj-ui` (each story + test), Ladle catalog with theme switcher.
- **Phase 3.1** — dead code removed. **3.2** — all overlays → `Modal`/`PanelHeader`/`Banner`.
- **Phase 3.3** — standard node → `NodeFrame`/`NodeShell`/`Port`/`PortRow`; cables → `Cable`.
- **Phase 3.4** — **the whole node system is now 0-legacy.** Every schematic family's ports → `Port`/`PortRow`/`KeyTile` (incl. the rainbow-universal treatment taught to `Port`); in-node controls → `Slider`/`Button`/`Select`/`ValueScrubber`; the control-active highlight is a real `Port active` state (`.oj-port.is-active`). Reaper #9a–#9d removed **every** dead legacy node class — `.port-dot`/`.node-btn`/`.port*` twins, 21 faceplate port-markers, `.port-circle-marker`/`.control-active`, and 46 dead node-content classes (`SchematicNodes.css` 4138 → 2923 lines). The canvas hit-test union lists only mounted classes. No deleted class is referenced by any CSS or tsx. Method: quote-agnostic "appears-nowhere" scan + parallel-Opus hunt-then-adversarial-refute workflow (KEEP-on-doubt) + brace-aware parser (drop a rule only when every comma-segment involves a dead class) + diff review + live smoke.

**REMAINING — human/designer-gated only** (held deliberately; doing them now would violate the no-op rule or create parallel paths):
- **3.5 / 3.6 leaf rewires** of bespoke chrome buttons (Settings/Toolbar/Guides, ~81 raw `<button>`): oj-ui `Button` imposes the `.oj-btn` look, which *differs* from each feature's bespoke CSS — so a swap is a visual **redesign**, not a no-op. That decision (what a chrome button looks like in the new language) is the designer's, in Phase 4's new theme. `AppErrorBoundary`/`KeybindingsErrorBoundary` stay self-contained (panic-safe) by design.
- **`SchematicNodes.css` literal-color/animation tokenization** — choosing each color's semantic role affects all themes; Phase 4 designer work, not a mechanical no-op.
- **Phases 4–6** (below): the new default theme, Figma Variables/Tokens Studio sync, Code Connect (needs Figma node IDs), and the `claude.ai/design` `/design-sync` run (external auth + publishing — needs the user's go-ahead). Designer arrives ~2026-06-22.
- **On-hardware live-audio acceptance** — incl. the MIDIVisual port (needs a MIDI device to instantiate; static-verified only).

---

## 1. COMPONENT TAXONOMY

### 1.0 Existing primitives (extend, never fork)

| Component | Extension needed |
|---|---|
| **Button** | Add `variant: 'ghost' \| 'link'`; add `iconOnly?: boolean` (square min-width, centered glyph). Fix any consumer literal `color: white` → tokenized `--text-on-accent`. |
| **Input** | Add `type='search'` styling pass-through (already HTMLAttributes). No structural change. |
| **Field** | Add `description?: ReactNode` help-text slot. |
| **Select** | No change (native). |
| **Port** | Add `kind: 'universal'` (violet/rainbow-until-typed) + `resolvedKind?: PortKind`; add `placeholder?: boolean` (muted add-slot). Already spreads `...rest`, so `data-node-id`/`data-port-id`/`data-port-type` forward as-is — **this is the load-bearing DOM contract; keep it.** |
| **NodeShell** | Add `agentPending?: boolean` (the AI live-build ring + reduced-motion keyframes from `.node.agent-pending`). |

### 1.1 New primitives

| Component | Replaces (app components / CSS) | Prop API sketch |
|---|---|---|
| **Surface** | `.dropdown-content`/`.dropdown-submenu`, `.help-panel`, `.command-bar-container`, the 4 panel-card chromes (`.ah-panel`, `.devlog-panel`, `.issue-panel`, `.app-error-card`) | `elevation?: 'rest'\|'menu'\|'lifted'`, `radius?: 'md'\|'lg'\|'xl'`, `className?`, `children`. Pure inked-lifted card; hard `--shadow-*` only. |
| **Modal** | The ~13 hand-rolled overlay shells (CommandBar, Settings `.minimal-settings-*`, Plugins, IssueReporter, WaveformEditor, AudioHealth, DevLog, RelinkSamples, MIDIDeviceBrowser, Guide, AppError, Keybindings-conflict) | `open`, `onClose`, `ariaLabel`, `align?: 'top'\|'center'\|'bottom'`, `size?`, `closeOnScrim?`, `children`. Owns portal + single `--overlay-scrim` token + focus-trap + Escape + `role=dialog`. **No backdrop-blur.** Composes `Surface`. |
| **PanelHeader** | `.command-bar-ai-header`/`-back`/`-badge`, `.minimal-settings-header`, `.midi-browser-header`, `.*-header` title strips, schematic headers' close clusters | `title?`, `subtitle?`, `onBack?`, `backLabel?`, `badge?`, `onClose?`, `actions?` (right slot), `children?`. Back = `Button variant='ghost'`. |
| **IconButton** | `.toolbar-btn-icon`, every `*-close`/`✕` button, `.ah-btn(✕)`, `.devlog-btn(✕)`, `.issue-btn(✕)`, copy/rescan icon buttons | `icon`/`children`, `label` (a11y, required), `variant?: 'ghost'\|'node'`, `active?`. Thin wrapper over `Button iconOnly`. |
| **Menu / MenuItem / MenuCategory / MenuSeparator** | `DropdownMenu.css` item/submenu/separator + `ContextMenu.css` item/category/submenu (two near-identical engines) | `Menu: { children, ariaLabel }`; `MenuItem: { label: ReactNode, shortcut?, leadingIcon?, disabled?, submenu?, onSelect }`; `MenuCategory: { label, icon? }`; `MenuSeparator`. Pure presentation; keyboard-nav + click-outside owned here. Fix hover `white` → `--text-on-accent`. |
| **DropdownMenu** | `src/components/Toolbar/DropdownMenu.{tsx,css}` + test (lift-and-move, already pure) | `label: ReactNode`, `items: MenuItemOrSeparator[]`, `disabled?`, `align?: 'start'\|'end'`. Relax `label`/`shortcut` to `ReactNode`. Trigger becomes `Button variant='ghost'`. **Keep DOM exactly (`▾`, `role='menu'`) so its test passes.** |
| **ListRow** | `.command-bar-rewind-row`/`-slash-item`/`-model-row`/`-session`, `.looper-loop-item`, Recorder `.loop-item`/`.loop-actions`, `.loop-list` rows | `selected?`, `current?`, `disabled?`, `role?`, `actions?` (trailing slot), `onMouseEnter?`, `onClick?`, `className?`, `children`. Owns the one selected/hover/current ruleset. **Identity-based selection stays in parents** (ModelPicker `rowKey`). |
| **List** | `.loop-list` wrapper (uses global scrollbar, not a re-declared one) | `ariaLabel?`, `children`. |
| **Chip** | `ActionChip` + `.command-bar-ai-runtime`/`-notice`, `.command-bar-model-meta`, `.toolbar-status(+offline)`, `.plugins-tag`, `.oj-upd-chip`, `.about-version`, `.collab-peer-count`, `.devlog-chip`, `.file-tag-badge` | `tone?: 'neutral'\|'success'\|'warning'\|'danger'`, `glyph?`, `title?`, `pressed?` (filter-chip), `count?`, `children`. **Signal-Not-Brand**: tone always carries label/glyph. |
| **Kbd** | `.command-bar-kbd`, `.help-panel kbd`/`.help-mode-value kbd`, `.dropdown-item-shortcut`, `.keybindings-shortcut` | `children`. Renders `<kbd>`, `--font-mono`. Optional `editing?`/`custom?` for keybindings display. |
| **Callout** | `GuideInfoBox`, `.audio-info-banner`/`.bluetooth-warning`/`.latency-suggestions`, `.plugins-note`/`.plugins-error`, `.relink-error/-success/-info`, `.collab-error`, `.guide-test-result` | `variant: 'info'\|'success'\|'warning'\|'danger'\|'tip'`, `title?`, `icon?`, `children`. Replaces hardcoded `#4285f4`/`#9c27b0` with tokens. |
| **Banner** | `LatencyWarningBanner` surface (full rewrite) | `tone: 'warning'\|'danger'\|'info'`, `icon?`, `title`, `message`, `actions?`. Surface = `bg-node` + sketch border + hard `--shadow-menu`; accent on **icon/border only** (Signal-Not-Brand). |
| **Slider** | `EffectNode`/`AmplifierNode`/`AutoParamPanel` raw `<input type=range>`, WaveformEditor zoom | `value`, `min`, `max`, `step`, `onChange`, `onPointerDown?`, `disabled?`, `aria-label`. Token-driven track + thumb; stateless. |
| **ParamRow** | `AutoParamPanel.ParamRow`, `EffectNode` param map | `label`, `value`, `displayValue` (mono), `min`, `max`, `step`, `onChange`. Composes `Field` + `Kbd`-voice readout + `Slider`. |
| **Toggle** | `.toggle-label`, `.oj-upd-toggle` checkboxes | `checked`, `onChange`, `label`, `description?`, `disabled?`. |
| **SegmentedControl** | `.oj-upd-seg`, `.minimal-tab-btn` (Settings sidebar tabs) | `options`, `value`, `onChange`, `orientation?`, `ariaLabel`. |
| **Tabs / TabBar** | Settings sidebar (alias of SegmentedControl `orientation='vertical'`; ship as one component, `Tabs` = thin re-export to avoid a second impl) | `tabs`, `activeId`, `onChange`. |
| **Textarea** | `.issue-textarea`, `.collab-field textarea` (WebRTCSignaling) | `value`, `onChange`, `rows`, `readOnly?`, `placeholder?`. Input's multiline sibling, same tokens. |
| **ProgressBar** | `.node-progress`, `.guide-progress-fill` (drop the gradient — Signal-Not-Brand) | `value`, `max?`, `tone?`, `ariaLabel`. |
| **Spinner** | inline spinners in Guide* + AudioSettings | `size?`. Indeterminate; respects `prefers-reduced-motion`. |
| **StatusDot** | `.ah-dot`, MIDIDeviceCard connected dot, DevLog level dot | `status: 'ok'\|'warn'\|'bad'\|'idle'\|'info'`. (`pulse` deliberately omitted — No-Surprise.) |
| **Breadcrumbs** | `src/components/Toolbar/Breadcrumbs.{tsx,css}` | `segments: {label, onClick?}[]`, `currentId`. Fix orphan `--text-tertiary` → `--text-muted`. |
| **CodeBlock** | `.issue-preview` `<pre>` | `children`/`text`, `maxHeight?`, `selectable?`. Mono, faint fill, hairline. |
| **Marquee** | `renderSelectionBox()` + `.selection-box` | `x`, `y`, `width`, `height`. |
| **OffscreenPointer** | `.back-to-action` | `rotation`, `label`, `onClick`. Wraps `Button`. |
| **Swatch** | Settings theme preview swatches (inline px) | `bg`, `node`, `name`, `selected`, `onSelect`. |
| **Icon set** | 3× mute SVG, 2× X SVG, every Guide/AudioSettings/Collab inline SVG, platform glyphs | Named exports (`IconClose`, `IconChevron`, `IconMute`, `IconSpeaker`, `IconDownload`, `IconBolt`, `IconWindows/Apple/Linux`, status glyphs). Pure `size?`/`title?`. |

### 1.2 New composites

| Component | Replaces | Prop API sketch |
|---|---|---|
| **PortRow** | NodeWrapper input/output map bodies, schematic `.port-row*`, Keyboard/MIDI/MiniLab3/Container/Input/OutputPanel port lists | `label: ReactNode`, `side: 'input'\|'output'`, port props (`kind`/`direction`/`connected` + `data-*` + handlers via `...rest`), `editableLabel?` slot, `placeholder?`, `hideLabel?`. Composes `Port`. |
| **NodeFrame** | NodeWrapper absolute-positioned `.node`/`.schematic-node` outer container | `position: {x,y}`, `selected`, `dragging`, `agentPending`, `className`, `children`. Positioning wrapper around (but distinct from) `NodeShell` chrome. |
| **EditableLabel** | CanvasIO/Container/MIDI/Input/OutputPanel inline rename | `value`, `editing` (controlled) **or** `defaultEditing`, `placeholder?`, `align?`, `onCommit`, `onCancel`. Caveat span ↔ `Input`. |
| **ValueScrubber** | `ScrollableRowValue`/`ScrollableControl`/`ScrollableValue`/`EditableValue` + Looper inline duration (4–5 copies) | `value`, `display` (pre-formatted), `label?`, `editable?`, `disabled?`, `title?`, `onChange`, `onCommit`. Span ↔ `Input`. **No scroll-capture import** — the wheel hook stays app-side (see §2). |
| **Cable** | `ConnectionPath` + `renderTempConnection()` (duplicated bezier math) | `start`, `end`, `kind`, `selected?`, `bundled?`, `bundleCount?`, `signalLevel`, `temp?`, `onSelect?`. Owns path-string math. **Must keep the existing memo comparator** (skip re-render on <1% signal change). |
| **Waveform** | Looper/Sampler/Microphone SVG polyline | `data: number[]`, `playhead?`, `recording?`, `showCenterLine?`. Pure SVG from props. |
| **DeviceSelect** | Microphone/Speaker device dropdowns | `items: {id,label,lowLatency?}[]`, `value`, `open`, `onToggle`, `onSelect`. (Custom-menu variant only needed for the ⚡ badge; else use `Select`.) |
| **KeyTile** | KeyboardVisual keys + MIDIVisual keys/pads (tile-that-is-a-port) | `label?`, `active?`, `connected?`, `variant: 'key'\|'pad'\|'black'\|'white'`, port handlers via `...rest`. Composes `Port`. |
| **WaveformView** | `AudioClipVisual` presentation | `peaks`, `durationLabel`, `cropped?`, `name`, `selected?`, `dragging?`, `dropTarget?`, `draggable?`, `onPointerDown?`, `onDoubleClick?`, `onDragStart?`. |
| **PanelSeparator** | `src/components/common/PanelSeparator.tsx` (port as-is) | `direction`, `onMouseDown`, `isDragging`. Define `SeparatorDirection` locally in oj-ui. |
| **ResizeHandles** | `src/components/common/ResizeHandles.tsx` (port as-is) | `handles`, `onResizeStart`, `isResizing`, `activeHandle`. Define `ResizeHandle` union locally in oj-ui. |
| **Guide family (GuideStep / GuideSection / GuideTester / GuideProgress)** | the Guide composites, built on Callout/Button/Spinner/Chip/ProgressBar | as audited; remove dead `onStatusChange`; extract `GuideSection` out of LowLatencyGuide. |

### 1.3 Explicitly **NOT** in oj-ui (stay app-side)

- **ScrollContainer** — behavior (native wheel + `preventDefault` to shield NodeCanvas), not presentation. Stays in `src/components/common`. oj-ui primitives expose `className`/`style` and let the app wrap them.
- **MiniLab3Visual** — device-faceplate art, already prop-driven. App-side.
- **PortMarker / MIDIControls (PianoKey/Knob/Fader/Pad/TouchStrip/Button)** — **deleted entirely** (dead code, see §3), not migrated.
- **Hooks**: `useScrollCapture`, `useResize`, `usePanelResize`, `useCommandSources`, `useMIDIConnectionToast` — app logic.
- **Screens/orchestrators**: NodeCanvas, NodeWrapper, all `*Node` store/audio wiring, CommandBar/AiPanel ranking + session + auth, SettingsPanel theme-apply, MIDIIntegration, LatencyWarningBanner visibility, all `App.tsx` logic.

---

## 2. DECOUPLING STRATEGY

**General pattern — "dumb shell, smart parent."** Every oj-ui component is pure: props in, callbacks out, zero imports from `store/`, `audio/`, `engine/`, `midi/`, or any stateful hook. The app screen keeps all store reads, audio/executor wiring, and side effects, computes booleans + pre-formatted strings, and passes them down with handlers. **What moves to oj-ui is rendering only; what stays in the app is every read and every effect.**

### Concrete resolutions

**(a) The `MIDIControls` `Button` name collision.**
`controls/MIDIControls.tsx` exports a `Button` that collides with oj-ui `Button`. The whole file (`MIDIControls.tsx` + `.css`) and `PortMarker.{tsx,css}` are **dead code** (verified zero importers outside the controls barrel; shipping `MiniLab3Visual` hand-rolls its own controls). **Resolution: delete both files**; rewrite `controls/index.ts` to export only the live `MIDIDeviceConfig` items. Deletion resolves the collision — no rename, no revival. If any control is ever revived it must be authored as a token-driven oj-ui primitive (`KeyTile`/`Slider`), never re-export the name `Button`.

**(b) ScrollContainer / ResizeHandles / PanelSeparator shared-hook entanglement.**
These are presentational shells bound to **stateful app hooks** (`useScrollCapture` → native wheel + `preventDefault`; `useResize` → imports `useCanvasStore` for zoom-aware deltas; `usePanelResize` → pointer math). Clean split:
- **Hook stays in the app** (it touches the canvas/zoom/native events — app/engine concern).
- **The dumb shell moves to oj-ui** with its handle/direction **type unions redefined locally** so oj-ui never imports an app hook (`SeparatorDirection`, `ResizeHandle` become oj-ui-local types).
- **ScrollContainer does NOT move** — it is behavior, not chrome. It stays in `src/components/common`; the app wraps oj-ui content in it. oj-ui scrollable surfaces just expose `className`. This keeps the 9 consumers working unchanged and keeps `preventDefault`/wheel-capture (which shields the live canvas) out of the theme-agnostic layer.

**(c) Store/audio-coupled surfaces.** State explicitly what stays in the app:
- **NodeWrapper / all `*Node`**: keep `useGraphStore`/`useCanvasStore`/`useAudioStore`/`useUIFeedbackStore`/`useIsAgentPending`, drag math, port-connect logic, ghost-port creation, `SCHEMATIC_TYPES` dispatch. Pass `title`/`selected`/`dragging`/`agentPending` booleans, `position`, `connected` booleans, and the 5 `handlePort*` handlers into `NodeFrame`/`NodeShell`/`PortRow`/`Port`.
- **NodeCanvas**: keep `getExecutor().subscribeSignalLevels` rAF throttle, the port-position cache + invalidation, the memo comparator, and DOM hit-testing. `Cable` receives **resolved** `start`/`end`/`signalLevel` as props — it does not read the executor. **DOM contract preserved**: every port forwards `data-node-id`/`data-port-id`/`data-port-type` via `...rest`; canvas hit-testing class selectors (`.port`, `.node`, etc.) are updated to the `oj-*` classes **in lockstep** with each migration increment.
- **CommandBar/AiPanel**: keep `commandRegistry`/`actionContext`/`paletteScore`/`agentSessionStore`/`authStore`/`piSessions`/`bridgeListener` and `Ctrl/Cmd+K`. The **cmdk `Command.Input` is NOT replaced by oj-ui Input** — it stays a styled cmdk slot reading the same tokens (replacing it breaks keyboard nav). Only the scrim shell → `Modal`, leaf chrome → `PanelHeader`/`ListRow`/`Chip`/`Kbd`/`Button(ghost)`, and AuthChooser key/baseUrl + ModelPicker filter inputs → `Input`.
- **WaveformEditorModal**: only chrome + footer → `Modal`/`Button`. The Canvas-2D DSP render + `getAudioContext`/`decodeAudioData`/`createBufferSource` audio preview are **untouched** (audio path is sacred). Each screen keeps its own Space/Enter/Esc key handling.
- **LatencyWarningBanner**: a thin app container keeps `useAudioStore`, `diagnoseLatency`, localStorage dismissal, the `ask-ai` CustomEvent, and `onOpenSettings`; renders `<Banner>` with `<Button>` actions.
- **AutoParamPanel / EffectNode / AmplifierNode**: keep `updateNodeData` store writes; `Slider`/`ParamRow` emit `onChange(number)`.
- **AudioClipVisual**: drop the `useAudioClipStore.openEditor` default — caller passes `onDoubleClick`. Then `WaveformView` is pure.
- **PortMarker→Port DOM contract**: before deleting PortMarker, `MiniLab3Visual` renders `<Port kind='control' data-node-id data-port-id data-port-type='control' .../>` and the connection lookup (`engine/registry` + NodeCanvas math) is verified to still resolve.

**z-index** is currently ad-hoc literals (1000/2000/3000/10000). Promote to `--z-*` tokens in oj-tokens and have `Modal` read them, so topmost-surface guarantees (palette above settings, devlog topmost) survive.

---

## 3. CONSOLIDATION & SIMPLIFICATION (fix the right way, now)

**Delete entirely (dead code — covenant #8):**
- `src/App.css` (Vite scaffold, zero imports, literal colors + blurred drop-shadow).
- `src/styles/sketch-effects.css` (353 lines, zero usages — a parallel hand-drawn vocabulary oj-ui supersedes) and its `@import` in `global.css`.
- `src/components/controls/MIDIControls.{tsx,css}` and `PortMarker.{tsx,css}` (dead; rewrite `controls/index.ts` to export only `MIDIDeviceConfig`).
- Unused utility classes in `global.css` (`.flex`, `.flex-col`, `.items-center`, `.justify-*`, `.gap-*` — zero refs).
- `Toolbar.css` `.toolbar-btn-active`/`:hover` and `.toolbar-unsaved` (dead; their literal `color: white` violation dies with them).
- Empty CSS rules: `SchematicNodes.css` `.bundle-expand-button.expanded .bundle-triangle`, `.library-separator`.
- Dead `onStatusChange` prop in `GuideStep.tsx`.
- After migration: `BaseNode.css` node/port/button/input/select twins (keep nothing — `.agent-pending`→NodeShell prop, `.node-progress`→ProgressBar, `.loop-*`→List); the ~15 bespoke schematic port classes; the schematic-vs-`.node` chrome duplication.

**Collapse duplicated files into one:**
- `InputPanelNode` + `OutputPanelNode` → one `PortPanel` with `side` prop.
- `MiniLab3Node` ≈ `MIDINode` outer view → parameterize by preset after `PortRow`/`MidiConnectHeader` extraction.
- Two MINILAB3 configs → single source in `MIDIDeviceConfig.ts`; `MiniLab3Visual` imports it.
- `DropdownMenu` + `ContextMenu` menu engines → one `Menu` family.
- 4–5 scroll-value components → one `ValueScrubber`.
- ~13 overlay implementations → one `Modal`.

**Fix the right way (do not port forward):**
- **Hard-Shadow Rule violations** — remove every blurred `box-shadow`/`backdrop-filter: blur` in: Guide.css, RelinkSamplesDialog.css, MIDIDeviceBrowser.css, MIDIConnectionToast.css, CollabControl.css, WaveformEditorModal.css, DevLogPanel.css, IssueReporter.css, MIDIVisualNode.css, SchematicNodes.css, AppErrorBoundary.css fallback, LatencyWarningBanner.css. Replace with hard `--shadow-node`/`--shadow-menu`.
- **Orphan tokens** (defined in no theme) → real roles: `--text-tertiary`→`--text-muted`; `--port-bg/--port-border/--port-connected-bg/--audio-port-color/--control-port-color`→`--audio-output`/`--control-output`/etc.; `--pad-color`/`--accent-primary,#3B82F6`→`--audio-*`/`--accent`. Highest priority: BundlePortGroup.css, Breadcrumbs.css.
- **Literal `color: white`** → `--text-on-accent` (BaseNode, Toolbar, ContextMenu, DropdownMenu, `::selection`).
- **Signal-Not-Brand**: LatencyWarningBanner's full clay/red surface fill → tokenized `Banner` (accent on icon/border only); GuideProgress gradient → single accent fill.
- **Inline px / inline `<style>`**: RecorderNode `<style>@keyframes pulse</style>` + 11 inline blocks, AmplifierNode/EffectNode/AutoParamPanel/LibraryNode inline `fontSize`/`px` → primitives + token spacing.
- **Off-palette fallbacks**: AppErrorBoundary `#e53935`/`#fdfcf7`, AudioSettings `var(--x,#hex)` masks → real tokens.
- **Native `alert()`/`confirm()`/`window.confirm()`** (AudioSettings, Keybindings, Toolbar) → in-UI `Callout`/confirm affordance (flagged for app layer; out of oj-ui scope but fix during migration).
- Confirm with owner: legacy File-menu workflow ops (`projectIsSupported` branch); InstrumentNode legacy label aliases; `KeybindingsPanelSafe` vs bare mount.

---

## 4. ORDERED EXECUTION SEQUENCE

Each step ends GREEN + VISUAL NO-OP. **Step 0 is the keystone:** before any migration, snapshot today's CSS-variable values into a `sketchbook` theme in oj-tokens and make it the active theme, so every subsequent "swap class for primitive" is provably no-op. `[P]` = parallelizable in an isolated worktree (no shared-file edits); `[S]` = sequential / shared-file (must serialize).

**Phase 0 — Foundation (sequential)**
0.1 `[S]` Capture current look as `sketchbook` theme JSON (DTCG → Style Dictionary); add `--z-*` tokens; add `--overlay-scrim`, `--universal-port`/`--universal-connection`, `--text-on-accent` if missing. Set `sketchbook` default. Gate: visual diff = 0.
0.2 `[S]` Extend `Button` (`ghost`/`link`/`iconOnly`), `Port` (`universal`/`resolvedKind`/`placeholder`), `NodeShell` (`agentPending`). Add to index + Ladle stories + tests. No app consumer yet.

**Phase 1 — Leaf primitives (mostly parallel; new files only)**
1.1 `[P]` Icon set + `Spinner`. 1.2 `[P]` `Kbd`, `Chip`, `StatusDot`, `Tag`(=Chip). 1.3 `[P]` `Surface`. 1.4 `[P]` `Callout`. 1.5 `[P]` `Textarea`, `CodeBlock`. 1.6 `[P]` `Slider`, `ProgressBar`. 1.7 `[P]` `Toggle`, `SegmentedControl`/`Tabs`. 1.8 `[P]` `Marquee`, `OffscreenPointer`, `Swatch`. 1.9 `[P]` Port `ListRow`/`List`. Each: pure component + story + test; no app wiring. Gate: oj-ui builds + Ladle renders.

**Phase 2 — Composites (parallel where independent)**
2.1 `[P]` `Surface`+focus-trap+portal → `Modal`; `PanelHeader`; `IconButton`. 2.2 `[P]` `Menu` family; move `DropdownMenu` into oj-ui **with its test** (DOM-exact). 2.3 `[P]` `PortRow`, `NodeFrame`, `KeyTile`, `EditableLabel`, `ValueScrubber`, `ParamRow`. 2.4 `[P]` `Cable`, `Waveform`, `WaveformView`, `DeviceSelect`, `Banner`, `Breadcrumbs`. 2.5 `[P]` move `PanelSeparator`/`ResizeHandles` (local type unions). 2.6 `[P]` Guide family + extract `GuideSection`.

**Phase 3 — App migration + legacy deletion (largely sequential per shared file; delete twins as each lands)**
3.1 `[S]` Delete dead code (`App.css`, `sketch-effects.css`, `MIDIControls`+`PortMarker`, unused utils/CSS). Lowest risk, biggest deletion.
3.2 `[S]` **Overlay family → `Modal`/`Panel`/`PanelHeader`/`IconButton`** across all ~13 surfaces (CommandBar scrim, Settings, Plugins, IssueReporter, AudioHealth, DevLog, RelinkSamples, WaveformEditor, MIDIDeviceBrowser, Guide, AppError, Keybindings-conflict). Migrate the 3 test files in the same commits. Deletes the most code + most Hard-Shadow violations in one pass. Split per-surface commits where files don't overlap (`[P]` within).
3.3 `[S]` **Standard NodeWrapper branch → `NodeFrame`+`NodeShell`+`Port`+`PortRow`** (lowest-risk exact twin). Update NodeCanvas hit-test selectors + Cable to `oj-*` in the same commit. Delete `BaseNode.css` node/port twins once green.
3.4 `[S]` **Schematic nodes, one family at a time**, each commit deleting its bespoke SchematicNodes.css block: (a) Keyboard/MIDI/MiniLab3/Container/Input+OutputPanel (PortRow + collapse InputPanel/OutputPanel→PortPanel + collapse MiniLab3Node→MIDINode); (b) Looper/Sampler/Microphone/Speaker (Waveform/DeviceSelect/Icon/ValueScrubber); (c) Instrument/InstrumentVisual/SamplerVisual/KeyboardVisual/MIDIVisual (ValueScrubber/KeyTile); (d) Math universal Port; (e) Effect/Amplifier/Recorder/AutoParamPanel (Slider/ParamRow/Button/List/ProgressBar; kill inline `<style>`/px). BundlePortGroup → Port + real tokens.
3.5 `[S]` Toolbar/Breadcrumbs/HelpPanel/CommandBar leaf rewire (Button ghost, Chip, Kbd, ListRow, DropdownMenu, Breadcrumbs, Surface). HelpPanel CSS co-located.
3.6 `[S]` Settings/Guides/Collab/MIDI/Clips/Misc leaf rewire (Field/Input/Textarea/Toggle/SegmentedControl/Callout/Banner/Slider/Tabs/Swatch). Fix orphan tokens, blurs, literals, `alert/confirm`.
3.7 `[S]` Final sweep: delete the last of BaseNode.css/SchematicNodes.css twins; verify zero `.node-btn`/`.port-dot`/`.schematic-*`/`backdrop-blur`/literal-hex/orphan-token references remain (CI grep gate). Split SchematicNodes.css chrome out so only per-instrument visuals remain.

**Parallelization note:** Phases 1–2 are heavily `[P]` (new files). Phase 3 is `[S]` per shared CSS file (`BaseNode.css`, `SchematicNodes.css`, `CommandBar.css` are edited by many steps — serialize edits to each). Within 3.2 and 3.4, surfaces that touch disjoint files can run as parallel worktree tasks; the shared-file deletions (3.3/3.7) must serialize.

---

## 5. VERIFICATION (per-increment gates)

Every commit must pass all of:
1. **Static**: `bun typecheck`, `bun lint`, `bun test` (incl. migrated `DropdownMenu`/`PluginsPanel`/`Keybindings`/`Updates`/`AutoParamPanel` tests in the same commit), `bun run build`. oj-ui builds standalone.
2. **Visual no-op**: pixel-diff the migrated surface against the pre-commit `sketchbook` render (Ladle snapshot + an app screenshot of the touched view). Diff must be ~0 until Phase 4.
3. **Live-audio test** (covenant #6, the only test that matters): with audio actually playing — switch all three themes (Cream/Cyberpunk/Midnight), drag nodes, connect/disconnect cables, scrub a value, record a loop. **No clicks, no dropouts, no added latency.** Headphones for mic tests. Watch the rAF signal-level path (Cable memo, Waveform) for added per-frame re-renders.
4. **Interaction integrity**: port connect via DOM `data-*` still resolves (cables anchor correctly); box-select/pan/zoom hit-testing works after each selector rename; keyboard nav intact (cmdk Command.Input untouched; Menu/ListRow arrow nav).
5. **Undo/redo**: connect, delete, rename, scrub — all reversible with plain Ctrl+Z; agent-emitted verbs still revert.
6. **Grep gates (CI, enforce "no parallel paths")**: zero `backdrop-filter: blur`, zero blurred `box-shadow` (blur radius ≠ 0), zero literal `color: white`/hex in token-managed spots, zero orphan-token names, zero references to deleted classes/files.
7. **Adversarial review**: a second pass (e.g. `/code-review`) per phase confirms no dead twin survived, no store/audio import leaked into oj-ui, no logic moved into a primitive.

---

## 6. DESIGNER-GATED (Phases 4–6 — wait for Figma / Code Connect / new default theme)

The migration above is a **visual no-op on the `sketchbook` theme**. The following are explicitly **deferred** until the designer delivers:

- **Phase 4 — New default theme**: the designer's new token values become the default theme JSON. Because every component reads only semantic tokens, this is a values-only change — no component edits. Re-run the full §5 gate suite with the **new theme active** (the only point where the visual diff is intentionally non-zero), across all three themes with audio playing.
- **Phase 5 — Figma + Code Connect**: bind each oj-ui primitive/composite to its Figma component via Code Connect. Requires the designer's Figma library and final prop names locked. Until then, prop APIs in §1 are the contract; do not churn them.
- **Phase 6 — New-component / visual-language additions** the designer introduces that have no current app counterpart (e.g. a redesigned Meter, motion specs, new elevation steps). These add to oj-ui; they do not block Phases 0–3.

**Do not** invent the universal-violet rainbow treatment, new elevation values, or any net-new visual decision ahead of the designer — Phase 0 only *captures today's look*. Net-new visuals are designer-gated to avoid a parallel design that the new theme must later undo.

---

**Files of record:** plan grounds in `/home/wsl/projects/openjammer/DESIGN.md`, `/home/wsl/projects/openjammer/agents.md`, existing primitives in `/home/wsl/projects/openjammer/packages/oj-ui/src/components/` (Button, Input, Field, Select, Port, NodeShell) and tokens in `/home/wsl/projects/openjammer/packages/oj-tokens/`. The load-bearing contracts that must not break: the DOM `data-node-id`/`data-port-id`/`data-port-type` port-lookup used by NodeCanvas connection math; the cmdk `Command.Input` keyboard nav; the rAF signal-level memo comparator on the live canvas; and undo/redo reversibility of every graph verb.