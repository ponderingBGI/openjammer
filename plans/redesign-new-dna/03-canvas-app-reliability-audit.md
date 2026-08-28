# OpenJammer canvas and app-shell reliability audit

Date: 2026-08-28. Scope: non-timeline UI only. `src/components/Arrangement`, `src/components/PianoRoll`, and `src/song` were excluded. Source was read-only; audit scripts and screenshots live under `.scratch/canvas/`.

The audit found two P0 live-performance risks, 27 P1 reliability/accessibility defects, and 20 P2 defects or redesign obligations. The most urgent are destructive cable reconnection, stuck keyboard notes, broken custom bindings, non-atomic graph operations, inaccurate node geometry, and view-only container navigation reaching the audio graph. No browser console errors or page errors occurred in the completed Playwright pass.

## A. Baseline results

| Command | Result |
|---|---|
| `bun run test:run` | PASS: 161/161 files, 1,613/1,613 tests, 0 failures; 58.91s. Known-flaky `voiceSynth.test.ts` passed 30/30, so no rerun was required. One React `act(...)` warning came from `AiPanel.test.tsx`. |
| `bunx tsc --noEmit -p tsconfig.app.json` | PASS: 0 diagnostics. |
| `bun run lint` | FAIL: 10 errors, 0 warnings, all in concurrently-created untracked `plans/redesign-new-dna/.scratch/timeline-audit.ts`; no production-source error. |
| `bunx eslint src packages e2e` | PASS: 0 diagnostics; this isolates the source from the concurrent scratch artifact but does not replace the red required lint command. |
| `bunx playwright test --config plans/redesign-new-dna/.scratch/canvas/playwright.config.ts` | PASS on final run: 1 test, 7.8s. System Chrome channel was required because Playwright's bundled headless shell was absent. |

Live artifacts: `.scratch/canvas/live-results.json` and `.scratch/canvas/shots/00-launch.png` through `08-narrow.png`.

## B. Interaction findings

Severity: P0 broken/destructive or live-performance unsafe; P1 unreliable/janky or a major accessibility failure; P2 polish/minor reliability.

| ID | Sev | Surface | Repro; expected vs actual | Root cause / suggested fix | Screenshot |
|---|---|---|---|---|---|
| UI-001 | P0 | Cable reconnect | Reconnect an existing cable to an incompatible target. Expected: original remains. Actual: rejection returns `null`, then original is deleted. | `NodeWrapper.tsx:192-224,319-342`; `graphStore.ts:755-783`. Make reconnect one validated atomic graph verb; remove old only after full success. | `02-nodes-added.png` (canvas context; destructive branch static-confirmed) |
| UI-002 | P0 | Keyboard notes | Hold a QWERTY note, focus a rename/input before key-up, then release or hide the tab. Expected: note-off always. Actual: editable-target early return can strand the note; no blur/visibility cleanup. | `NodeCanvas.tsx:545-547,862-875`. Release active sources before focus suppression; flush all active notes on blur, hidden, unmount, and executor swap. | `02-nodes-added.png` |
| UI-003 | P1 | Context menu | Right-click; focus an item; press ArrowDown. Expected: next item focused. Actual: focus did not move. Categories are hover-only and inaccessible by touch/keyboard. Esc did close. | `ContextMenu.tsx:167-172,205-227`; `ContextMenu.css:61-73`. Reuse `oj-ui/Menu` or implement roving focus, Home/End, typeahead, Left/Right submenu disclosure and focus restore. | `01-context-menu.png` |
| UI-004 | P1 | Context menu | Open near right/bottom edge. Parent clamps once; submenus always open right and can clip. | `ContextMenu.tsx:134-147`; `ContextMenu.css:61-68`. Measure/flip/clamp each submenu and recompute on resize. | `01-context-menu.png` |
| UI-005 | P1 | Custom keybindings | Rebind delete/copy/paste/container/note actions. Expected: rebound chord executes action. Actual: arbiter calls a generic handler that rechecks the old physical key. Zoom bindings have no consumer. | `NodeCanvas.tsx:555-681,804-857,895-930`; `keybindingsStore.ts:99-118`. Dispatch by action ID and add consumers/tests for every advertised binding. | `04-settings.png` |
| UI-006 | P1 | Multi-select drag | Select several nodes and drag one. Expected: group moves as one gesture. Actual: only grabbed node moves. Shift-click adds but cannot toggle off; node-body click does not select; no drag threshold/snap. | `NodeWrapper.tsx:150-190,576-584`; `graphStore.ts:1395-1405`. Central selection controller with screen-pixel threshold and one history gesture. | `02-nodes-added.png` |
| UI-007 | P1 | Selection shortcuts | Try Ctrl/Cmd+A and Ctrl/Cmd+D. Expected per requested/editor convention: select all/duplicate. Actual: no handlers; `A` is multi-connect. | `NodeCanvas.tsx:555-681`; keymap registry. Add explicit actions and conflict-safe defaults. | `02-nodes-added.png` |
| UI-008 | P1 | Marquee / fit | Marquee or zoom-to-fit around Library/Keyboard/resized nodes. Expected: actual bounds. Actual: duplicate approximation tables treat 500x400/600px nodes as about 200x150; marquee threshold changes with zoom. | `graphStore.ts:92-131,1437-1475`; `NodeCanvas.tsx:204-213,329-375,1088-1111`. Store measured/registry geometry once; thresholds in client pixels. | `02-nodes-added.png` |
| UI-009 | P1 | Undo reconnect | Reconnect then Ctrl+Z once. Expected: exact previous cable. Actual: add and remove are separate history entries and can leave both. | `NodeWrapper.tsx:319-342`. Atomic reconnect verb with explicit connection ID. | `02-nodes-added.png` |
| UI-010 | P1 | Hierarchical paste | Copy/paste a container. Expected: independent cloned hierarchy. Actual: shallow data retains `childIds`/`specialNodes`/internal references. | `graphStore.ts:1580-1667`. Deep-copy and remap the subgraph or explicitly block unsupported duplication. | `02-nodes-added.png` |
| UI-011 | P1 | Zoom | Ctrl/Cmd+wheel without a preceding canvas mousemove. Expected: point under wheel cursor remains fixed. Actual: anchor comes from last mousemove and can jump around `(0,0)`; delta direction naming is inverted. | `NodeCanvas.tsx:178-180,515-536`; `useScrollCapture.ts:224-227`. Pass wheel client coordinates and test pixel lock. | `02-nodes-added.png` |
| UI-012 | P1 | Window resize / fit | Resize shell/window. Expected: visibility and fit use canvas rect. Actual: calculations use `window.innerWidth/Height` without resize dependency. | `NodeCanvas.tsx:1113-1167`; `canvasNavigationStore.ts:120-123`. `ResizeObserver` on actual canvas. | `08-narrow.png` (700px wide; no document overflow) |
| UI-013 | P1 | Cable geometry | Resize node/change theme/font/window. Expected: ports and cables remain pixel-locked. Actual: cache invalidation misses these sources; Library commits size only on mouse-up. | `NodeCanvas.tsx:952-1021`. Observe nodes/ports and invalidate affected cache entries during resize rAF. | `05-theme-last.png` |
| UI-014 | P1 | Container enter/exit | Enter/exit container. Expected: view-only state, no audio reconciliation. Actual: replaces graph `nodes` Map; browser executor sends unchanged graph to worklet. | `canvasNavigationStore.ts:71-84,157-167,199-211`; `OjcoreWasmExecutor.ts:258-266,468-503`. Remove viewport state from graph/audio subscriptions; dedupe defensively. | `02-nodes-added.png` |
| UI-015 | P1 | History gestures | Start slider/volume drag and unmount node before pointer-up. Expected: gesture closes. Actual: history can remain open; undo/redo refuse to run. | `SpeakerNode.tsx:231-249,330-332`; `ParamRow.tsx:28`; `historyStore.ts:101-113`. Shared pointer-gesture hook with capture, blur/cancel/unmount cleanup. | `02-nodes-added.png` |
| UI-016 | P1 | Resize handles | North/west handles are advertised but only dimensions change; node position does not. Listener churn can commit penultimate size. | `ResizeHandles.tsx:2-25`; `useResize.ts:179-234`; `usePanelResize.ts:114-157`. Update position+dims atomically or stop advertising those handles; stabilize callbacks. | `02-nodes-added.png` |
| UI-017 | P1 | Port keyboard access | Focus/activate panel ports with Enter/Space. Expected: start connection. Actual: keyboard event cast to mouse event fails `button===0`; most ports/handles are not focusable. | `InputPanelNode.tsx`, `OutputPanelNode.tsx:178-183,240-244`; `NodeWrapper.tsx:192-195`. Pointer-agnostic endpoint actions and semantic focusable controls. | `02-nodes-added.png` |
| UI-018 | P1 | Device menus | Use two microphone/speaker nodes. Expected: each dropdown owns its outside-click and focus. Actual: global `querySelector` inspects first matching instance; entries are click-only. | `MicrophoneNode.tsx:141-159,281-308`; `SpeakerNode.tsx:157-178,357-384`. Per-instance refs + shared accessible `DeviceSelect`. | `02-nodes-added.png` |
| UI-019 | P1 | Device/audio policy | Mount Speaker and enumerate devices. Expected: no disruption without performer choice. Actual: node can auto-select low-latency output and dispose/reinitialize executor; global default hook duplicates ownership. | `SpeakerNode.tsx:83-131`; `useUsbLowLatencyDefault`. Centralize policy and stage disruptive changes. | `02-nodes-added.png` |
| UI-020 | P1 | Library loading | Select file that fails decode/delivery. Expected: preserve last-good selection. Actual: graph/UI selection commits before success. | `LibraryNode.tsx:299-329`. Pending state; commit only after successful delivery. | `02-nodes-added.png` |
| UI-021 | P1 | Blocking dialogs | Clear workflow, conflict keybinding, or delete Library content. Expected: themed, focus-safe reversible/inline confirmation. Actual: native `confirm()` steals focus. | `Toolbar.tsx:118,174`; `KeybindingsPanel.tsx:144`; `LibraryNode.tsx:980,1155,1367`. Replace with one accessible app confirmation pattern. | `04-settings.png` |
| UI-022 | P1 | Cable hit area | Hover/select a cable. Expected: forgiving 12–16px hit path and keyboard route. Actual: visible 3px path is hit target; width grows only after hitting it. | `oj-ui/Cable.tsx:78-84`; `Cable.css:14-25`. Invisible hit path + focus semantics. | `02-nodes-added.png` |
| UI-023 | P1 | Signal meters | Larger graph at 60/120Hz. Expected: ~30fps localized meters. Actual: every rAF sets NodeCanvas state; inline cable callbacks defeat memo; per-node subscriptions amplify renders. | `NodeCanvas.tsx:77-90,1051`; `Cable.tsx:100-114`; Speaker/Microphone/NodeWrapper subscriptions. Throttle by elapsed time and isolate/imperatively update meters. | `02-nodes-added.png` |
| UI-024 | P1 | Settings theme cards | Tab through theme choices. Expected: radio semantics and keyboard selection. Actual: clickable `div`s with no role/tab/checked state. | `SettingsPanel.tsx:70-94`. Radiogroup/buttons, ideally via an accessible `Swatch`. | `04-settings.png`, `05-theme-last.png` |
| UI-025 | P1 | PWA update lifecycle | Unmount while registration dynamic import is pending. Expected: no later polling. Actual: promise may create interval after cleanup. | `usePWA.ts:166-200`. Cancellation guard before state/interval creation. | — |
| UI-026 | P1 | Guide state | Open Low Latency guide active step. Expected: active border/fill/pulse. Actual: TS emits `in_progress`, CSS targets `in-progress`. | `GuideStep.tsx:4,34,42,77,87`; `Guide.css:200-203,241-245`. Map enum to class and test each state. | — |
| UI-027 | P2 | Settings modal | Escape was exercised while Settings was present; overlay remained during the scripted flow and later intercepted canvas clicks. Expected: Esc closes/focus returns. | Settings panel lacks a verified global/modal Escape contract. Add dialog semantics, escape handler, focus trap/return, and direct e2e. | `04-settings.png` |
| UI-028 | P2 | Menu/command automation | Real menu and palette command execution was inconsistent: only Speaker, Looper, Multiplier, Library were added through fuzzy queries; several searches fell through to disabled “Ask AI”. Expected: deterministic exact action targeting. | Command result matching exposes a disabled AI pseudo-item alongside results. Ensure exact action ranks first and disabled entries are never default-selected. | `03-command-bar.png` |
| UI-029 | P2 | Feedback classes | Trigger protected delete/container-enter failures. Expected: visible reduced-motion-safe feedback. Actual: several emitted `.flashing`/`.deletion-attempted` classes have no CSS. | `ContainerNode.tsx:80`, `MathNode.tsx:71`, panel/keyboard nodes; only one matching rule in `SchematicNodes.css`. Shared wrapper feedback + aria-live. | `02-nodes-added.png` |
| UI-030 | P2 | Offline/reload | After load, `context.setOffline(true)` left canvas visible; reload preserved four added nodes in DOM/local backup. Expected continued operation. Actual verified only at visibility/persistence level, not audio/network-request or SW cold-start behavior. | Preserve current backup/SW architecture; add full offline journey. | `08-narrow.png` |
| UI-031 | P2 | Reduced motion | Emulation matched `reduce`, but context menu CSS still has unconditional entrance/submenu transitions. | `ContextMenu.css:1-73`. Add reduced-motion overrides. | `01-context-menu.png` |
| UI-032 | P2 | Rename undo | Rename panel port then undo once. Expected: label+metadata revert together. Actual: separate operations can split visible name from port name. | `InputPanelNode.tsx:121-144`; `OutputPanelNode.tsx:95-118`. Atomic rename-port verb. | `02-nodes-added.png` |
| UI-033 | P2 | Pan affordance | Help says Alt+drag and scroll; code supports middle, Alt+left, right-drag. Space+drag is absent despite space control-mode binding. | `NodeCanvas.tsx:244-319,645-650`. Decide and document one convention; avoid right-drag conflict with context menu. | `00-launch.png` |
| UI-034 | P2 | Temporary cable semantics | Drag audio/universal connection. Expected: preview has signal type color. Actual: temporary cable always renders `kind="control"`. | `NodeCanvas.tsx:1057-1081`. Derive preview kind from source/compatible target. | `02-nodes-added.png` |

Live matrix boundaries: right-click/open/Esc, category/item inventory, command palette, settings/themes presence, toolbar attempts, narrow viewport, reduced-motion media query, post-load offline visibility, reload persistence, console/page errors were automated. Physical audio feel, MIDI hardware, cable drag feel, HiDPI at OS scaling, browser zoom 90/125, tab-hidden project-folder writes, and every node category addition were not successfully proven; see section G.

## C. Code-level defects found by reading

- Unsafe selector interpolation and global lookup can throw or bind wrong DOM: `NodeCanvas.tsx:996-998`. Scope to canvas and use `CSS.escape` or keyed refs.
- Custom port renderers omit load-bearing `data-port-type`: `CanvasIONode.tsx:87-93`; `InstrumentNode.tsx:563-570,588-596,644-652,665-673`; `LooperNode.tsx:586-593,625-632`; `MicrophoneNode.tsx:313-321`; `SamplerVisualNode.tsx:173-181,283-293`. Route all through `oj-ui Port` or a typed DOM-props helper.
- Async device enumeration lacks rejection/unmount guards: `SpeakerNode.tsx:109-154`; `MicrophoneNode.tsx:90-135`. Microphone local selection can drift after undo/load/collab.
- LowLatencyGuide async init can write after unmount: `LowLatencyGuide.tsx:47-89`. Add cancellation.
- Outside-click logic uses `setTimeout(0)` and can miss a click: `DropdownMenu.tsx:88-107`; `InstrumentNode.tsx:296-317`; `MicrophoneNode.tsx:137-159`; `SpeakerNode.tsx:156-178`. Use direct `pointerdown` with refs.
- NodeCanvas Escape handler intentionally omits transient state deps and can see stale marquee/menu values: `NodeCanvas.tsx:571-580,936-937`. Use refs or store current state.
- rAF cleanup gaps: `NodeCanvas.tsx:77-90,280-295`; `useScrollCapture.ts:257-258`. Cancel scheduled callbacks.
- Hydration does not intersect selected IDs with extant nodes: `graphStore.ts:1822-1835`.
- Fixed 10,000×10,000 canvas plus negative graph positions and transform helpers assuming screen origin `(0,0)` make the redesign shell/sidebar a latent coordinate-breaker: `NodeCanvas.css:18-24`; `canvasStore.ts:165-179`. Use the element rect.
- Cable glow uses `currentColor` while signal classes set `stroke`, so glow may inherit text color: `Cable.css:23,29-39`.
- `KeybindingsPanelSafe` claims production protection but `SettingsPanel` renders the bare panel: `KeybindingsPanel.tsx:255-265`; `SettingsPanel.tsx:7,104`.
- Guide header is a mouse-only clickable `div`: `GuideStep.tsx:42-61`. Use a button with `aria-expanded`/`aria-controls`.
- No in-scope `any`, `TODO/FIXME/HACK`, or `console.log` was found. Other audited listeners had matching cleanup. The non-passive wheel listener is necessary because it prevents default and is cleaned up.

## D. Dead / duplicated code inventory

Keep-on-doubt rule: HIGH means no current in-repo production consumer; UNSURE is not a deletion recommendation.

### High-confidence dead code

| Item | Evidence |
|---|---|
| `RelinkSamplesDialog` + CSS | No TS/TSX importer; `RelinkSamplesDialog.tsx:36`, CSS only self-imported. Decide whether recovery must be wired before removal. |
| `generateNumberedControls` | Only declaration at `MIDIDeviceConfig.ts:210-230`. |
| `GuideStepProps.onStatusChange` | Declared `GuideStep.tsx:13`, never consumed. |
| `KeybindingsPanelSafe` | `KeybindingsPanel.tsx:260-265`, no importer (also a reliability decision, not blind delete). |
| Waveform editor legacy CSS | `WaveformEditorModal.css:107-184`: `info*`, `highlight`, `btn-small`, `hint`, `spacer`; no markup references. |
| Guide orphan CSS | `Guide.css:571-575,605-625`: latency-unit/code/code-block. |
| Old MiniLab CSS in MIDIVisual | `MIDIVisualNode.css:287-315,328-351,354-387`; current MiniLab markup emits none. |
| Old sampler CSS | `SamplerVisual.css:83-94,167-186,207-231`; current component uses different classes/oj-ui Port. |
| Toolbar unsaved class | `Toolbar.css:218-221`, no emitter. |
| Looper armed animation | `SchematicNodes.css:970-983`; current button emits only `recording`. |
| Redundant default exports | AudioClipVisual, ClipDragLayer, WaveformEditorModal, Guide components, ScrollContainer/useScrollCapture, MiniLab components, Sampler components; all consumers use named exports. |

### UNSURE / public or excluded consumers

- `oj-ui` `Marquee`, `OffscreenPointer`, `Swatch`, `EditableLabel`, `WaveformView`, `DeviceSelect` have stories/tests/public exports but no current production consumer. Treat as consolidation targets, not dead API.
- `LaneButton`, `TimeRuler`, `WaveformCanvas` are used by excluded timeline surfaces.
- Eight-handle `ResizeHandles` API is dormant for current callers but may be public/plugin-facing.
- MiniLab fixed hardware palette may be a deliberate themed-island; document the exception before keeping it.

### Duplicated implementations

- Four app scroll/edit value controls duplicate `oj-ui ValueScrubber`: `SamplerVisualNode.tsx:41-76`, `SamplerNode.tsx:86-123`, `InstrumentVisualNode.tsx:45-150`, `InstrumentNode.tsx:107-164` versus `ValueScrubber.tsx:41-125`.
- InputPanel and OutputPanel mirror most logic (`InputPanelNode.tsx:35-299`, `OutputPanelNode.tsx:33-257`). Consolidate a directional `PortPanelNode`.
- Microphone/Speaker duplicate enumeration, unplug fallback, and dropdown engines; `DeviceSelect` is unused.
- Three separate menu engines: Canvas ContextMenu, Toolbar DropdownMenu, and `oj-ui Menu`.
- Duration formatter duplicated in `AudioClipVisual.tsx:30-35` and `SamplerNode.tsx:55-58`.
- MIDI note-name mapping duplicated in `SamplerNode.tsx:45-51`, `MiniLab3Visual.tsx:84-89`, `MIDIDeviceConfig.ts:234-239`.
- Rename editors duplicate public `EditableLabel` across panel/CanvasIO/Container nodes.
- Node dimension tables are duplicated in graphStore, NodeCanvas, and CSS/component defaults.
- Reconnect hand-composes add/remove instead of using one graph verb.

## E. Theming leaks

### Whole surfaces

- `InstrumentVisualNode.css:6-40,51-119,139-233`: complete fixed paper/ink/blue palette plus hard-coded fonts (`12,97,104,115,173,198`). It will remain visually cream in Cyberpunk/Midnight.
- `SongNode.css:4-79`: fixed surface, ink, selection, playing ochre, text, and `Caveat` at line 10.
- `MiniLab3Visual.css:26-554,615-617` and `MiniLab3Visual.tsx:78-82`: extensive device-fixed palette (UNSURE sanctioned hardware skin).
- `MIDIVisualNode.css:6-443` and `MIDINode.css:47,54,73-74`: undefined legacy aliases (`--sketch-paper`, `--sketch-gray`, `--bg-overlay`, `--color-primary`) make hex fallbacks permanent.

### Literal colors / fonts by element

- Waveform Canvas2D drawing: `WaveformEditorModal.tsx:119,123,162,179,189,201,207,221,232,249,292,310,315`; shell scrim/shadow `WaveformEditorModal.css:12,27`.
- Guide/status/info: `Guide.css:12,31,197,202,207,220,243,254,259,360,365,370,402-423,432,436,449,453`.
- Schematic nodes: `SchematicNodes.css:473-479,605,895,901,911,946,1089,1094,1163-1185,1366,1374,1501,1514,1609,1633,1646,1669,1681,1900,1910,2053,2148,2305,2374,2425,2430-2432,2483-2484,2508,2523,2550-2551,2581,2586,2631,2655,2673,2855-2895,3006`.
- Universal port rainbow: `packages/oj-ui/src/components/Port/Port.css:55-58`; semantic treatment is valid, but expose theme-owned spectrum tokens.
- Menus/on-accent: `ContextMenu.css:86`; `Toolbar.css:145`; `DropdownMenu.css:101,106,158`; `KeybindingsPanel.css:135,272`.
- Clips/shadows: `AudioClipVisual.css:30,52`; `ClipDragLayer.css:55,69,87`.
- MIDI chrome: `MIDIConnectionToast.css:17,92` (undefined RGB token); `MIDIDeviceCard.css:23`.
- Common separator/handles undefined aliases/fallbacks: `PanelSeparator.css:10,23,31`; `ResizeHandles.css:62-63,76-77,90-91,104-105,120`.
- Static inline style debt: `HelpPanel.tsx:59,76,78,112`; `Toolbar.tsx:409`; `SettingsPanel.tsx:68,77-91`; `LowLatencyGuide.tsx:388,391,439,442,491,514,517,532,535`; `EffectNode.tsx:93-109`; `RecorderNode.tsx:215-312`; `MultiplierNode.tsx:71,97-103`; repeated literal port sizes across CanvasIO, Keyboard, Instrument, panels, Looper, Sampler, MIDI, MiniLab, Speaker.

Dynamic geometry/progress inline styles in canvas transforms, cables, marquee, node positions, meters, waveform cursors and oj-ui geometry primitives are expected and are not classified as theme leaks.

## F. Coverage gaps

- No direct NodeCanvas/NodeWrapper interaction suite: drag threshold, group movement, snapping, shift-toggle, select all, duplicate, empty deselect, pointer cancellation.
- No end-to-end cable suite: both directions, incompatibility feedback, empty drop, same-port cancel, reconnect identity/rollback/atomic undo, fan-out, ghost ports, universal type, hit area.
- No measured-geometry tests for marquee/fit/resize/theme/font/window/HiDPI/browser zoom.
- No custom-binding integration proving rebound actions run; no zoom shortcut consumer test.
- No held-note cleanup tests for editable focus, blur, visibility, unmount, executor swap.
- ContextMenu tests omit real opening/placement, initial focus, arrows/Home/End/typeahead/submenu/touch/reduced-motion.
- No node UI tests under `src/components/Nodes`: resize, hierarchy, Library, panels, keyboard, microphones, samplers, loopers, MIDI, DOM port contract.
- Toolbar generic dropdown is tested, but real File/Edit/View wiring, switching, breadcrumbs, help and active-container state are not.
- SettingsPanel, AudioSettingsPanel, AboutPanel and live whole-app theme switching have no tests; Keybindings/Updates are partial only.
- Guides, MIDI chrome, Clips, Dialogs, common controls have no direct tests.
- Hooks without direct tests: useNativeUpdater, usePanelResize, usePWA, useResize, useScrollCapture, useKeymap integration.
- `oj-ui` render tests are broad, but `LaneButton`, `ParamRow`, `TimeRuler`, `WaveformCanvas` lack tests; primitives lack canvas-transform/theme/browser-zoom integration.
- No lifecycle UI test for resize, 90/125% browser zoom, reduced-motion rendering, tab visibility save, ordinary local-backup restore, or continuing interactions under `context.setOffline(true)`.
- No performance regression test for signal-level rAF/render counts at large graph size or 120Hz.

## G. Could not verify

- Audible QWERTY/MIDI→audio feel, clicks/dropouts, stuck-note audibility, and latency: headless browser has no trustworthy monitored audio output; covenant requires human/taste-tier judgment with audio actually playing.
- Real MIDI enumeration, MiniLab, microphone permissions/input, speaker device switching, unplug fallback, and hosted plugins: no physical devices/native desktop tier were available.
- Complete requested node-category insertion: live context menu inventory proved 17 actions across all six categories, but command-palette automation successfully added only Speaker, Looper, Multiplier, and Library before disabled AI pseudo-results interfered. Container/panel traversal and every individual node UI were therefore static-audited but not all live-driven.
- Cable drag/reconnect/hover/HiDPI pixel lock and port hover feel: automation did not establish stable semantic locators across every bespoke port; static root causes are high-confidence, feel is unverified.
- Ctrl+C/V/D/A, exact selection positions/connections after undo/redo, and multi-drag: source trace found missing/broken semantics, but a complete live graph fixture was not built.
- Settings keybinding conflict flow and audio-device mutations: would trigger blocking/native confirmation or unavailable devices; covered by unit/static evidence only.
- Browser zoom 90%/125% and OS HiDPI: viewport resize to 700×500 was verified with no document overflow, but Chromium page zoom/device-scale matrix was not completed.
- Tab visibility project-folder autosave: requires File System Access handles/user gesture. Local emergency-backup reload did preserve the four successfully added nodes, but this is not proof of folder save or clean/unclean recovery semantics.
- Cold offline launch/service-worker cache correctness: only post-load offline canvas visibility was verified; no origin outage/cold restart in this run.
- Source lint as one green repository-wide command: concurrent timeline scratch makes `bun run lint` red. Production scope independently passed.
- Exact visual retheming of every leak: theme cards were enumerated and screenshots captured, but the script read `data-theme=null` because themes are applied through CSS variables rather than that attribute; the file-level literal-color inventory is authoritative, not a computed-pixel sweep.

## Recommended redesign order

1. Fix P0 reconnect atomicity and universal note-off cleanup before visual work.
2. Establish one action dispatcher, one graph-gesture/transaction layer, and one measured geometry/port DOM contract.
3. Consolidate Menu, DeviceSelect, ValueScrubber, EditableLabel, and panel-node families in `oj-ui`/shared app adapters.
4. Move navigation state out of audio graph subscriptions and isolate meter rendering.
5. Replace native confirms and mouse-only controls; complete keyboard/focus/reduced-motion behavior.
6. Remove only HIGH-confidence dead code after reachability confirmation; retain every UNSURE item.
7. Tokenize the documented whole-surface and per-element theme leaks, then run a three-theme computed-style screenshot sweep.
8. Add the missing interaction/e2e and performance gates, then repeat the audit with physical audio/MIDI hardware.
