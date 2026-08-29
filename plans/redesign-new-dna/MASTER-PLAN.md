# New DNA redesign + timeline rebuild — master plan

Orchestrator: Fable 5 (judgment/review only — never writes code). Builders: Opus 5 (taste,
perception-facing) and gpt-5.6-sol via `codex exec` (bounded grind, bug hunting, second-opinion
review). Every builder report is a claim until verified against code, tests, or a real render.

Branch `t3code/openjammer-redesign-timeline` (from `origin/canari` 42682a6). PR target: `canari`.
Baseline 2026-08-28: tsc ✅ · eslint ✅ · vitest 161 files / 1613 tests ✅. **Every wave ends green.**

Inputs (read these before building anything):
- `00-design-gap-audit.md` — the execution map for the retheme (token map §1, fonts §2, 41 oj-ui
  components §3, 46 app CSS files §4, shell §5, risks §6, order §7).
- `01-timeline-reliability-audit.md` — 29 findings TL-01…TL-29 + 10 cross-cutting repairs.
- `02-timeline-interaction-spec.md` — the target timeline (gestures §3, keys §4, states §8, tests §11,
  deviations §12).
- `03-canvas-app-reliability-audit.md` — canvas/app/node/command-bar defects + dead code (pending).
- Handoff: `C:\Users\olimt\Downloads\design_handoff_new_dna` (`new-dna.css` = source of truth).

## Decisions (settled — do not relitigate in prompts)

| # | Decision | Why |
|---|---|---|
| D1 | Keep every existing CSS custom-property NAME; change VALUES. Never adopt `--t1`/`--acc`. | one vocabulary, no parallel path (audit §1.1) |
| D2 | Retire `cream`/`cyberpunk`/`midnight`; ship `light` + `dark`. Default `light`. | migrate fully, remove legacy; handoff offers exactly two |
| D3 | Retire Caveat AND Inter; self-host Outfit 400/500/600/700 (latin woff2, OFL notice added); `--font-sans` VALUE → Outfit; `--font-sketch` deleted; JetBrains Mono unchanged. | offline stage, no third-party requests |
| D4 | Shadows, focus ring, scrim become per-theme tokens named `shadowRaised`/`shadowOverlay`/`shadowInset`/`shadowPressed`/`focusRing`/`overlayScrim` (no digits — `camelToKebab` can't hyphenate digits). | audit §0.3 |
| D5 | a11y corrections to the handoff, hue preserved: light `--text-on-accent` = `#1D1C18` (white on accent is 3.36:1); light `--text-muted` = `#6C695F`, dark `#928E83`; add the `*-ink` pair (`accentInk/successInk/warningInk/dangerInk/audioInk`) for tinted TEXT; add `--border-control` used ONLY where there is no fill delta (socket well ring, slider thumb ring, knob ring) — inputs/toggles keep `--border-strong` + focus ring. | impeccable contrast rule; audit §6.4 |
| D6 | Motion: `--motion-fast 120ms cubic-bezier(.2,.8,.3,1)` (color/bg/border), `--motion-spring 260ms cubic-bezier(.34,1.56,.64,1)` (transform only). One blanket `prefers-reduced-motion` rule in `global.css`, exempting `.oj-cable`/`.oj-meter` (they are meters, not decoration). | handoff; audit §6.4 |
| D7 | Ports: recessed 18px socket wells INSIDE the node body as labeled rows (inputs left, outputs right, first body row). No glow on ports ever. Directional port-color tokens retired. `data-node-id/data-port-id/data-port-type` stay on `.oj-port`. `Port.direction` prop stays (Code Connect gate). | handoff; audit §3.3 |
| D8 | NEW oj-ui components: `Knob` (role=slider, keyboard stepping), `Meter` (rAF-written `--oj-meter-signal`, never React state), `TransportPill`. No `Grip`, no `SocketRow`. | audit §3.2 |
| D9 | ONE floating transport pill (top-center, shared by canvas/arrangement/piano roll) replaces `TransportStrip`, the toolbar play button and `SharedSurfaceChrome`'s readout. Undo/redo live in the topbar right cluster (all surfaces); ruled surfaces add a 56px sky band with grid/mix/export utilities. Attention pulse: browser tier only, pre-first-gesture only, never while rolling. | spec §2.2; audit §5.3 |
| D10 | App shell: a real topbar (`--bg-node-header`, 1px `--border-subtle` rule): left = brand dot+name, File/Edit/View as ghost buttons, breadcrumbs; right = undo/redo, engine-health dot, project chip, collab, theme toggle, settings. The pill floats below it over the stage. | handoff topbar + what the real app needs |
| D11 | Onboarding: 3-step overlay over the blurred REAL studio; step buttons are the audio-unlock gesture (browser); Esc/"Skip, take me in" keeps given answers; native shows it too (persona/goal/theme) without the autoplay pretext; `localStorage['oj-onboarding-v1']`; "Redo setup" in Settings. Blur only the surface layers; no blur under reduced-motion. Replaces `.oj-welcome` + the first-run toast. e2e boot helper updated in the same wave. | handoff; audit §5.4 |
| D12 | Preset rigs are REAL graph nodes built through the same reversible verbs (`docs/agent-tools.md`), pre-wired and playing on finish: jam = keyboard-visual → instrument → effect(space/delay) → speaker; beat = keyboard-visual(pads) → sampler/instrument(percussive) → speaker + a Song with a looping 8-step drum clip, and the bottom step grid is a THIN VIEW over that clip's notes (existing note verbs) shown only for looped rigs; sound design = instrument → effect → speaker with `Knob`s via `AutoParamPanel` (no oscillator/filter node type exists — NOT adding DSP node types in this effort; flagged to owner). | honesty; audit §5.6 |
| D13 | Timeline: implement spec §2–§10 in full, including deviations D1–D22, the three new verbs (`setTrackColor`, `moveTrack`, `createClip` op), snap radius 12/18px, `E`/`Q` level grammar, `Ctrl+Q` quantize, piano-roll keys as a real `surface:'pianoroll'` binding set, one shared rAF loop, sticky ruler/header inside one scroller. `docs/timeline.md` + BC-06 contract test updated in the same wave. | spec |
| D14 | Stop semantics: freeze-in-place; second Stop returns to play origin; no "return on stop" preference. Follow-playhead: page mode, on by default, auto-disarms. No minimap. | spec §7/§6 |
| D15 | `DESIGN.md` is REPLACED (not edited); `PRODUCT.md` brand section updated; `docs/design-figma-handoff.md`, `.impeccable/design.json`, `.design-sync/config.json`, `.ladle/components.tsx`, `README.md`, `THIRD-PARTY-LICENSES.md`/`NOTICE` (Outfit OFL) updated. Docs are part of the feature. | covenant #5 |
| D16 | Same worktree, disjoint file ownership per parallel lane; shared files (`global.css`, tokens, `App.tsx`, `SchematicNodes.css` until split) are serialized. Builders never commit/stash/checkout; the orchestrator commits after review + green gate. | disk (2 GB free) forbids per-lane worktrees |

## Waves

Legend: **[C]** codex gpt-5.6-sol · **[O]** Opus 5 · **[R]** review gate (Opus reviewer + orchestrator read + full gate: `bunx tsc --noEmit -p tsconfig.app.json && bun run lint && bun run test:run`, plus targeted Playwright where UI changed).

### Wave 1 — prep (parallel, disjoint)
- **W1-S0S1 [C]** — S0: convert every `expect(x.className).toBe(...)` in `packages/oj-ui/src/components/*/*.test.tsx` to `toContain`; add the blanket reduced-motion rule to `global.css` and delete the 10 bespoke per-file blocks (keep `.oj-cable`/`.oj-meter` exempt). S1: fonts (audit §2 in full: `fonts.css`, `public/fonts`, `primitive.json` `font.sans` value + delete `font.sketch`, `bun run tokens`, mechanical `--font-sketch`→`--font-sans` across all 62 files, `index.html` body font + 4 preloads, `.design-sync/config.json`, delete `ArrangementSurface.test.tsx` Caveat guard, delete the two Google-Fonts `runtimeCaching` rules, OFL notice). Same layout, new face. Green.
- **W1-TA1 [C]** — timeline logic, no CSS: TL-01, TL-05/06 (transaction-local ids), TL-12, TL-13, TL-14, TL-15, TL-16, TL-17, TL-18, TL-22, TL-24, TL-26, TL-28 + cross-cutting repairs 2 (editing-context selection authoritative), 3 (selection history per surface), 4 (ids in the transaction), 5 (coalesced viewport writes), 7 (audition/playback/recording ownership). Unit tests for each. Files: `src/store/{arrangementStore,editingContextStore,historyStore,trackLaneViewStore,transportStore}.ts`, `src/components/Arrangement/{useClipGesture,dragController,ArrangementSurface,MixerDrawer,AutomationLaneView,ClipView}.tsx|ts`, `src/components/PianoRoll/{PianoRoll,actions}.ts(x)`, `src/song/*.ts`, their tests. NOT: any `.css`, `RulerStack`, `PlayheadLayer`, keymap defaults (Wave 3).
- **[R]** → commit `chore(ui): loosen class assertions + reduced-motion rule`, `feat(design): Outfit replaces Caveat/Inter`, `fix(timeline): transport/ids/selection reliability (TL-…)`.

### Wave 2 — the atomic token swap (serialized)
- **W2-S2 [C, then O review]** — audit §1 in full: `light.json`/`dark.json`, delete the three themes, `$metadata`/`$themes`, `build.mjs` THEMES + snapshot theme, `types.ts` (`ThemeValues`), `DEFAULT_THEME_ID`, `.ladle/components.tsx`, `envTools.test.ts`, `ai/types.ts`, rewrite `contrast.test.ts` (oklch parser, both themes, new floors incl. clip border ≥ 3:1), `bun run tokens`, then the mechanical `--sketch-*`/`--shadow-*`/`--border-sketch*`/`--bg-canvas-alt`/directional-port-color rewrite across all 46 app CSS + 38 oj-ui CSS files per the §1.2/§1.3 map, `index.html` boot shell reads the saved theme inline (no cream flash), `SettingsPanel` theme picker → 2-up radio using `Swatch` (a11y fixed). Target: coherent-but-unrefined app in the new palette, green. No polish here.
- **[R]** → commit `feat(design): New DNA tokens — light + dark replace the sketchbook themes`.

### Wave 3 — sockets + timeline rebuild + controls (parallel where disjoint)
- **W3-S3 [O]** — NodeShell/Port/PortRow socket redesign + `portPositions.ts` + `registry.ts` port positions + `NodeCanvas` fallback + `_sockets.css` extraction from `SchematicNodes.css` + `BundlePortGroup.css` + tests. Cable retheme (teal, signal formulas, no idle glow).
- **W3-P1 [O]** — oj-ui controls: Button, IconButton, Slider, Toggle, SegmentedControl/Tabs, Input(+`mono`), Select, Textarea, Field, ValueScrubber, **Knob (new)**, Ladle stories + tests + `.figma.tsx`.
- **W3-P2 [C]** — oj-ui surfaces & feedback: Surface (elevation rename), Modal, Menu, Callout, Banner, Chip (drop glyph dot), StatusDot, Kbd, Spinner, ProgressBar, PanelHeader, ListRow, CodeBlock, Swatch.
- **W3-TA2 [C]** — timeline gesture lifecycle (cross-cutting repair 1): one `useGesture` controller (pointer id, capture, cancel/lost-capture/blur/Esc/unmount), applied to clip, marquee/range, automation, ruler scrub (TL-09), piano-roll notes (TL-20/21/23), piano-roll scroll model (TL-03), shortcut isolation + `pianoroll` binding set (TL-02/04/25), ResizeObserver host (TL-19), followPlayhead honoured (spec D6), coalesced single rAF loop (spec D16). Unit + component tests.
- **[R]** → commits per lane.

### Wave 4 — the surfaces (parallel)
- **W4-TB [O]** — arrangement + piano roll REDESIGN per spec §2/§3/§5/§8/§9: sticky ruler/header in one scroller, 64px ruler with brace row (loop/punch drag), markers lifecycle + `sectionIds`, track header (color swatch, rename, M/S/R, level bead, reorder drag, lane resize), clip visuals + edge handles + fades, empty-lane time-range vs Alt-marquee, draw-a-clip (`createClip`), readout chip + snap hairline, mixer drawer, automation lane, piano-roll layout/tools `V B X K T`/velocity paint & ramp/quantize popover, empty state, new verbs `setTrackColor`/`moveTrack`/`createClip` + agent `EDIT_OPS` parity + `docs/timeline.md` + BC-06 update. Owns `Arrangement/**`, `PianoRoll/**`, `Clips/*.css`, `src/song/**`, `src/ai/arrangementAdapter.ts`.
- **W4-S4 [O]** — app shell: topbar, **TransportPill + Meter** (master RMS selector, rAF), onboarding overlay (3 steps, personas, preset rigs via verbs, step-grid view for looped rigs, "Redo setup"), `HelpPanel` persona default, delete `.oj-welcome` + first-run toast, `index.html` boot shell, e2e boot helper + the PR-lane specs. Owns `App.tsx`, `Toolbar/**`, `global.css` (welcome section), new `src/components/Shell/**`, `Onboarding/**`, `e2e/journeys/support.ts`.
- **W4-P5 [O]** — CommandBar (1127 lines) + AiPanel redesign to `.nj-menu`/`.nj-input`/`.nj-chip` physics.
- **W4-P3 [C]** — oj-ui canvas & media: KeyTile, Waveform, WaveformView, Marquee, OffscreenPointer, TimeRuler, LaneButton, DeviceSelect, EditableLabel, ParamRow.
- **W4-P9 [O, C assist]** — panels REDESIGN (not a token swap): Settings (all tabs: audio, keybindings, updates, about, theme), Guides (LowLatencyGuide + GuideStep family), DevLog, Plugins panel + PluginWindowShell, Export dialog, Dialogs (RelinkSamples), MIDI (device browser, device card, connection toast), Collab (control, presence overlay), AudioHealth, IssueReporter, Bench, LatencyWarningBanner, PwaUpdatePrompt, AppErrorBoundary + SafeModeScreen, HelpPanel, Sonner toasts, WaveformEditorModal + AudioClipVisual + ClipDragLayer, common (PanelSeparator, ResizeHandles, ScrollContainer). Each gets a taste pass to the New DNA physics (surface cards, hairlines, inset controls, spring press, one focus ring) and a light+dark screenshot. Literal-color cleanup is a by-product, not the goal.
- **[R]**.

### Wave 5 — node faceplates (after S3 splits `SchematicNodes.css`)
- **W5-P6/P7/P8 [O ×3, C assist]** — Speaker/Microphone/Math/CanvasIO/Container/Song/MIDI · Looper/Sampler/Library · Keyboard/KeyboardVisual/Instrument/InstrumentVisual/MIDIVisual/MiniLab3. Built from wells, chips, knobs, hairlines; coherence over consistency. `AutoParamPanel` → Knob.
- **W5-P10 [C]** — canvas/app defects + dead code from `03-canvas-app-reliability-audit.md` (keep-on-doubt).
- **[R]**.

### Wave 6 — proof, docs, second opinion
- **W6-E2E [C]** — spec §11 acceptance tests T1–T44 + onboarding journey + visual-regression baselines (both themes) as the LAST increment.
- **W6-DOCS [O]** — D15 docs; `component-map.json` regen; README node list.
- **W6-REVIEW [C + O]** — independent full-diff review (codex second opinion + Opus taste critique with screenshots in both themes at 1280×800 and 1920×1080, reduced-motion, keyboard-only); founder listening pass with audio playing is required before merge (codex never signs off on feel).
- Open PR → `canari`; babysit per the stewardship rules.

## Scope = everything (owner clarification 2026-08-28)

The redesign covers **every surface, every node, every setting, everything** in the new language. Nothing ships as "rethemed but not redesigned". The completeness inventory — each row needs a taste-pass owner, a light screenshot and a dark screenshot before Wave 6 closes:

| Area | Items |
|---|---|
| Shell | topbar, transport pill, breadcrumbs, surface switcher/sky band, onboarding (3 steps), help panel, toasts, PWA update prompt, latency banner, engine-health dot, offline chip, project chip, collab control + presence overlay, error boundary, safe-mode screen, plugin window shell |
| Canvas | dot grid, marquee, offscreen pointer, cables (audio/control/universal/temp/bundled), ghost mode, context menu (→ oj-ui Menu), node frames/selection/agent-pending, resize handles, bundle port groups |
| Every node faceplate (40 registered types) | keyboard, keyboard-key, keyboard-visual, instrument, instrument-visual, microphone, midi, midi-visual, minilab-3, minilab3-visual, piano, cello, electricCello, violin, saxophone, strings, keys, winds, looper, effect, pan, width, multiplier, speaker, recorder, canvas-input, canvas-output, output-panel, input-panel, container, add, subtract, library (incl. the two-panel file browser), sampler, sampler-visual, song, audio-in, audio-out — plus `AutoParamPanel` (Knob) and every in-node control |
| Timeline | arrangement (ruler, headers, field, clips, playhead, loop/punch, markers, selection, readouts), mixer drawer, automation lanes, piano roll (toolbar, key bed, field, velocity lane, scroomer), record ghost, empty states, export dialog |
| Command bar | palette, AI panel/composer, model picker, sessions, slash items, rewind rows, auth chooser |
| Settings | panel shell + sidebar tabs, audio settings (devices, latency, guide), keybindings (editor, conflicts), updates/channels, about, theme picker, MIDI device browser |
| Design system | all 41 oj-ui components + Knob/Meter/TransportPill, Ladle catalog + theme switcher, stories, Figma Code Connect examples, component-map |
| Outside `src/` | `index.html` boot shell, `public/download` page, `apps/docs` site (fonts, hero, custom.css), `.design-sync` previews, `.impeccable/design.json`, DESIGN.md/PRODUCT.md/README |

Gate (Wave 6): a coverage matrix `plans/redesign-new-dna/COVERAGE.md` listing every row above with owner + screenshot paths; any row without both screenshots or still carrying a retired token/literal/2px-ink/hard-shadow/Caveat rule is a defect, not a follow-up.

## Owner flags (do not block; noted for the recap)
1. Third rig has no oscillator/filter node — built from instrument+effect (D12). Adding DSP node types is plugin-territory follow-up.
2. `--text-on-accent` becomes ink in light (D5) — deviates from the handoff's `#FFF` to meet AA.
3. Disk: C: had 0.9 GB free; freed to ~2.2 GB (stale VS temp, bun cache). WSL (159 GB) / Docker (30 GB) / `.codex/plugins` (12.7 GB) are the real consumers — owner's call.
4. Spec open questions taken as: attention pulse pre-first-gesture only (never on arrangement while rolling); three new verbs approved for implementation; no return-on-stop preference; page follow default.

## Follow-ups (appended by later reviews — do not reorder)

1. **W5-P8 — the beginner's rig must show something to press.** *(High priority; opened by
   the W4-S4 review, recorded in `docs/shell.md` and `W4-S4B-REPORT.md`.)* All three preset
   rigs install the bundle `keyboard`, not `keyboard-visual` as D12 names, because
   `keyboard-visual` is an internal, undeletable, non-playable **mirror**: only
   `KeyboardNode` calls `registerKeyboard()`, which is what `audioStore.activeKeyboardId`
   and the entire typing path resolve against, so a top-level one lights up when some
   *other* keyboard is played and emits nothing itself. Its 31 outputs are per-key
   `control` ports with no row bundling, and it is 660 × 280 px. The result today: a
   first-run beginner is told "press the keys" while looking at a card showing four sockets
   (`ROW 1 / ROW 2 / ROW 3 / PEDAL`) and no keys, and the beat rig shows no pads at all.
   **P8 owns the fix**: make `keyboard-visual` a first-class playable node with its own
   `registerKeyboard` + row bundling, or give the `keyboard` faceplate keys of its own.
   Until then D12's intent is unmet and the first run under-delivers at exactly the moment
   it promises the most.
2. **W5-P8 — retire the Keyboard node's green active-mode ring and badge.** Old faceplate
   styling; in the New DNA green (`--success`) means *healthy*, not *selected*.
