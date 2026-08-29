# W6-CAP — capture + judgement report

**Lane:** W6-CAP (design-QA capture of every MISSING coverage cell that is not owned by
the two lanes still running).
**Date:** 2026-08-29 · **Branch:** `t3code/openjammer-redesign-timeline` (worktree
`t3code-2faff191`) · **No source files were edited.** The only repo files this lane
touched are `plans/redesign-new-dna/COVERAGE.md`, this report, and the harness under
`plans/redesign-new-dna/.scratch/w6-cap/`.

**Method.** One Chromium (Playwright under `node`; `bun` hangs it). App on
`http://localhost:5231` (`bun dev --port 5231 --strictPort`), oj-ui + `.design-sync`
catalogs on Ladle `61009` / `61010`, `apps/docs` on Astro `4331`. Every capture is
1280×800, `deviceScaleFactor: 1`, theme set the way the app sets it — `localStorage
openjammer-theme` before boot, which `main.tsx` feeds to `applyTheme()` — and onboarding
skipped with the real "Skip, take me in" button (except where onboarding *is* the target).
Each capture also runs a computed-style audit in-page: a WCAG sweep of every text run
against its composited background, plus a DNA sweep for Caveat/cursive faces, zero-blur
offset shadows, coloured no-offset glows, `filter: drop-shadow` outside `.oj-cable`,
borders ≥2px, and sans text below 13px. Raw results:
`.scratch/w6-cap/cap{A,B,C,D,E,F,G}-results.json`.

**Scope excluded by instruction:** every timeline / piano-roll row (lane TB-c) and every
`looper` / `sampler` / `sampler-visual` / `library` row (lane P7b).

---

## 1. What was captured — 52 rows × light + dark = 104 captures

All paths are relative to `plans/redesign-new-dna/.scratch/`. Rows marked `+frame` also
have a full 1280×800 context frame at `<slug>-<theme>-frame.png`.

| # | Row | Light | Dark | How the state was reached | Verdict |
|---|---|---|---|---|---|
| 1 | Topbar (dedicated) | `w6-cap/topbar-light.png` | `w6-cap/topbar-dark.png` | element clip of `.oj-topbar` `+frame` | **PASS** |
| 2 | Transport pill in situ | `w6-cap/transport-pill-light.png` | `w6-cap/transport-pill-dark.png` | element clip of `.oj-transport` `+frame` | **PASS** |
| 3 | Offline chip | `w6-cap/offline-chip-light.png` | `w6-cap/offline-chip-dark.png` | `context.setOffline(true)` + the browser `offline` event `+frame` | **PASS** |
| 4 | Toasts (Sonner) | `w6-cap/toast-light.png` | `w6-cap/toast-dark.png` | `openjammer:export-song` with no song → the real "there isn't a song on the page yet" toast `+frame` | **PASS** |
| 5 | PWA update prompt | `w6-cap/pwa-update-prompt-light.png` | `w6-cap/pwa-update-prompt-dark.png` | `usePWA.ts` `needRefresh` forced true by a dev-module route rewrite + `audioStore.isAudioContextReady = true`, so the real component takes the "audio is live, offer it" branch `+frame` | **PASS** |
| 6 | Latency chip | `w6-cap/latency-chip-light.png` | `w6-cap/latency-chip-dark.png` | `audioMetrics.classification` driven to `'bad'` on the live store `+frame` | **PASS** |
| 7 | Latency popover | `w6-cap/latency-popover-light.png` | `w6-cap/latency-popover-dark.png` | same, then the real chip trigger clicked `+frame` | **PASS** |
| 8 | Help panel (post-P9) | `w6-cap/help-panel-light.png` | `w6-cap/help-panel-dark.png` | `openjammer:toggle-help` | **DEFECT D4** (11px sans `.oj-help__mode`) |
| 9 | Error boundary | `w6-cap/error-boundary-light.png` | `w6-cap/error-boundary-dark.png` | `graphStore.nodes` driven to `null` → a real React render throw → the real `AppErrorBoundary`; dark is `colorScheme: 'dark'` because this surface answers `prefers-color-scheme`, not `applyTheme` `+frame` | **DEFECT D7** (dark title drifted off `--danger-ink`) |
| 10 | Safe-mode screen | `w6-cap/safe-mode-light.png` | `w6-cap/safe-mode-dark.png` | crash-breaker marker seeded via `addInitScript` with a 3-boot crash streak + an emergency backup, so the app's own `runRecovery` decides `safe-mode` | **PASS** |
| 11 | Plugin window shell | `w6-cap/plugin-window-shell-light.png` | `w6-cap/plugin-window-shell-dark.png` | `main.tsx` `?plugin-window=<label>` route + a stubbed Tauri `invoke` for `plugin_window_shell_info` | **DEFECT D4** (two 11px sans runs) |
| 12 | Settings — first-run entry point | `w6-cap/settings-firstrun-light.png` | `w6-cap/settings-firstrun-dark.png` | `openjammer:toggle-settings` → About tab | **DEFECT D4** (`.oj-set-section__title` 11px sans) |
| 13 | Bench (plugin fault cards) | `w6-cap/bench-light.png` | `w6-cap/bench-dark.png` | `__openjammerE2E.pluginFault()` → the real fault store `+frame` | **PASS** |
| 14 | Cables — universal | `w6-cap/cable-universal-light.png` | `w6-cap/cable-universal-dark.png` | Add → Multiplier universal connection dragged by hand `+frame` | **PASS** — flat violet, `stroke-width: 2.5px`, `filter: none` at rest (`w6-cap/verify-ports.json`) |
| 15 | Node frame — agent-pending | `w6-cap/node-agent-pending-light.png` | `w6-cap/node-agent-pending-dark.png` | `agentSessionStore` `phase:'running'` + empty `runBaseline` — the real agent-run path `+frame` | **DEFECT D3** (works only on NodeWrapper nodes) |
| 16 | `strings` faceplate | `w6-cap/faceplate-strings-light.png` | `w6-cap/faceplate-strings-dark.png` | right-click → Instruments → Add Strings `+frame` | **PASS** |
| 17 | `keys` faceplate | `w6-cap/faceplate-keys-light.png` | `w6-cap/faceplate-keys-dark.png` | right-click → Instruments → Add Keys `+frame` | **PASS** |
| 18 | `winds` faceplate | `w6-cap/faceplate-winds-light.png` | `w6-cap/faceplate-winds-dark.png` | right-click → Instruments → Add Winds `+frame` | **PASS** |
| 19 | `pan` faceplate | `w6-cap/faceplate-pan-light.png` | `w6-cap/faceplate-pan-dark.png` | right-click → Effects → Add Pan `+frame` | **PASS** |
| 20 | `width` faceplate | `w6-cap/faceplate-width-light.png` | `w6-cap/faceplate-width-dark.png` | right-click → Effects → Add Width `+frame` | **PASS** |
| 21 | `canvas-input` / `canvas-output` | `w6-cap/canvas-io-light.png` | `w6-cap/canvas-io-dark.png` | Add Empty Node → select → `E` to enter `+frame` | **PASS** |
| 22 | ParamRow (dedicated, in app) | `w6-cap/paramrow-light.png` | `w6-cap/paramrow-dark.png` | `AutoParamPanel`'s `KNOB_LIMIT` lowered to 0 by a dev-module rewrite so the real table mode renders real `ParamRow`s on `pan` `+frame` | **PASS** |
| 23 | ParamRow (design-system) | `w6-cap/designsync-paramrow-light.png` | `w6-cap/designsync-paramrow-dark.png` | `.design-sync` preview `param-row--states` through Ladle | **PASS** |
| 24 | Export dialog | `w6-cap/export-dialog-light.png` | `w6-cap/export-dialog-dark.png` | E2E `setFixture('firstLight')` + the real `openjammer:export-song` | **PASS** |
| 25 | `AudioClipVisual` on the canvas | `w6-cap/audio-clip-visual-light.png` | `w6-cap/audio-clip-visual-dark.png` | `audioClipStore.addClip()` + `setClipBuffer()` with a synthesised 2 s buffer `+frame` | **PASS** |
| 26 | Waveform editor modal | `w6-cap/waveform-editor-light.png` | `w6-cap/waveform-editor-dark.png` | `openEditor()` on the seeded clip — the real Canvas-2D painter reading the live theme | **PASS** |
| 27 | MIDI device browser | `w6-cap/midi-browser-light.png` | `w6-cap/midi-browser-dark.png` | right-click → Input → Add MIDI (opens the browser by design) | **PASS** |
| 28 | MIDI device card | `w6-cap/midi-device-card-light.png` | `w6-cap/midi-device-card-dark.png` | same, hovered `+frame` | **PASS** |
| 29 | MIDI connection toast | `w6-cap/midi-connection-toast-light.png` | `w6-cap/midi-connection-toast-dark.png` | `midiStore.addPendingDevice()` — the same store call the real Web-MIDI watcher makes (headless Chromium has no Web MIDI) `+frame` | **PASS** |
| 30 | Command bar — model picker | `w6-cap/cmdbar-model-picker-light.png` | `w6-cap/cmdbar-model-picker-dark.png` | desktop caps via route rewrite + an in-memory provider key + the model-catalog SWR cache seeded, then the real header model chip | **DEFECT D5** |
| 31 | Command bar — slash items | `w6-cap/cmdbar-slash-items-light.png` | `w6-cap/cmdbar-slash-items-dark.png` | typed `/` in the real composer | **PASS** |
| 32 | Command bar — sessions list | `w6-cap/cmdbar-sessions-light.png` | `w6-cap/cmdbar-sessions-dark.png` | `listSessions()` stubbed on the live store, reached through the real `/resume` slash command | **DEFECT D8** (low) |
| 33 | Command bar — rewind rows | `w6-cap/cmdbar-rewind-light.png` | `w6-cap/cmdbar-rewind-dark.png` | a two-turn transcript on the live session store + the real Rewind button | **PASS** |
| 34 | Command bar — reduced motion | `w6-cap/cmdbar-reduced-motion-light.png` | `w6-cap/cmdbar-reduced-motion-dark.png` | `reducedMotion: 'reduce'` context | **PASS** |
| 35 | Onboarding — reduced motion | `w6-cap/onboarding-reduced-motion-light.png` | `w6-cap/onboarding-reduced-motion-dark.png` | fresh first run under `reducedMotion: 'reduce'` | **PASS** |
| 36 | Panels — reduced motion (DevLog) | `w6-cap/panels-reduced-motion-devlog-light.png` | `w6-cap/panels-reduced-motion-devlog-dark.png` | `openjammer:toggle-devlog` under reduce | **PASS** |
| 37 | Panels — reduced motion (Keybindings) | `w6-cap/panels-reduced-motion-keybindings-light.png` | `w6-cap/panels-reduced-motion-keybindings-dark.png` | Settings → Keybindings under reduce | **PASS** |
| 38 | `Meter` (dedicated) | `w6-cap/meter-light.png` | `w6-cap/meter-dark.png` | Ladle `canvas--meter--live-level` | **PASS** |
| 39 | `Meter` — clipping | `w6-cap/meter-clipping-light.png` | `w6-cap/meter-clipping-dark.png` | Ladle `canvas--meter--clipping` | **PASS** |
| 40 | `TransportPill` (dedicated) | `w6-cap/transportpill-light.png` | `w6-cap/transportpill-dark.png` | Ladle `composites--transportpill--song` | **DEFECT D6** (2px record-dot border) |
| 41 | `TransportPill` — recording | `w6-cap/transportpill-recording-light.png` | `w6-cap/transportpill-recording-dark.png` | Ladle `composites--transportpill--recording` | **DEFECT D6** |
| 42 | Icons (all 12, one sheet) | `w6-cap/icons-light.png` | `w6-cap/icons-dark.png` | Ladle `primitives--icons--grid` | **PASS** |
| 43 | Ladle catalog | `w6-cap/ladle-catalog-light.png` | `w6-cap/ladle-catalog-dark.png` | Ladle, non-preview mode | **PASS** (see note N1) |
| 44 | Ladle theme switcher | `w6-cap/ladle-theme-switcher-light.png` | `w6-cap/ladle-theme-switcher-dark.png` | the real `ojTheme` control in Ladle's controls addon | **PASS** (see note N1) |
| 45 | `.design-sync` preview — Button | `w6-cap/designsync-button-light.png` | `w6-cap/designsync-button-dark.png` | Ladle `--stories '.design-sync/previews/**/*.tsx'` on port 61010 | **PASS** |
| 46 | `.design-sync` preview — Chip | `w6-cap/designsync-chip-light.png` | `w6-cap/designsync-chip-dark.png` | same | **PASS** |
| 47 | `.design-sync` preview — Cable | `w6-cap/designsync-cable-light.png` | `w6-cap/designsync-cable-dark.png` | same | **PASS** |
| 48 | `.design-sync` preview — Port | `w6-cap/designsync-port-light.png` | `w6-cap/designsync-port-dark.png` | same | **PASS** |
| 49 | `.design-sync` preview index | `w6-cap/designsync-index-light.png` | `w6-cap/designsync-index-dark.png` | same, catalog shell | **PASS** |
| 50 | `public/download` page | `w6-cap/download-page-light.png` | `w6-cap/download-page-dark.png` | `http://localhost:5231/download/` at both OS colour schemes | **DEFECT D1 (high)** |
| 51 | `apps/docs` — hero | `w6-cap/docs-site-hero-light.png` | `w6-cap/docs-site-hero-dark.png` | `bun --cwd apps/docs run dev` + Starlight's own `data-theme` | **DEFECT D2 (high)** |
| 52 | `apps/docs` — a docs page | `w6-cap/docs-site-page-light.png` | `w6-cap/docs-site-page-dark.png` | `/openjammer/design-system/components/` | **DEFECT D2 (high)** |

---

## 2. DEFECTS, ranked

### D1 — HIGH — `public/download` still ships the retired Living Sketchbook

The public download page was never migrated. Its stylesheet says so out loud.

- `public/download/download.css:1–16` — the header comment reads *"The Living Sketchbook,
  hand-authored … Warm paper + dot grid, ink line, Outfit voice, **hard blur-free offset
  shadows**"*.
- `public/download/download.css:38–56` — a private literal palette, including
  `--oj-blue: #4A90C2`, the exact value DESIGN.md §2 names as stale, and
  `--oj-shadow-rest: 2px 3px 0`, `--oj-shadow-lift: 3px 4px 0`,
  `--oj-shadow-ink: 2px 2px 0 var(--oj-ink)` — three zero-blur offset shadows.
- Measured in the render (`capE-results.json`): `.oj-card` and `.oj-btn` carry **2px
  `rgb(26,26,26)` borders on all four sides**; `.oj-card` `3px 4px 0`, `.oj-btn`
  `2px 2px 0` / `2px 3px 0`.
- **Three text runs below AA:** `.oj-version-line` **3.04:1**, `.oj-plat-title`
  ("macOS", "Linux") **3.45:1** at 16px/700 (large-text exemption does not apply — 16px is
  not large).
- `public/download/index.html:10` pins `<meta name="color-scheme" content="light">`, so
  the light and dark captures are **the same image**: the page has no dark theme, breaking
  "exactly two themes".

Breaks: Don't-write-a-hard-offset-shadow · Don't-draw-a-2px-ink-border · tokens-only ·
two themes · the AA floor. **Owner: a web-surfaces fix lane (P10 scope).**

### D2 — HIGH — `apps/docs` (the Starlight site) is the same retired language

W6-DOCS rewrote the copy; the CSS was never migrated.

- `apps/docs/src/styles/custom.css:3–16` — the same literal palette
  (`--oj-blue:#4A90C2`, `--oj-pine:#4A7C59`, `--oj-paper:#F5F0E8`) and the same three
  zero-blur shadows, then wired straight into Starlight's own scale:
  `--sl-shadow-sm: var(--oj-shadow-rest)`, `--sl-shadow-md`, `--sl-shadow-lg`.
- `apps/docs/src/styles/custom.css:64–66` — the dark block re-declares the same
  `2px 3px 0` / `3px 4px 0` / `2px 2px 0`.
- Measured: `.oj-hero-grid` and `.sl-link-button` carry **2px** borders
  (`rgb(26,26,26)` light, `rgb(237,232,224)` dark), `starlight-aside--tip` a **2px**
  `rgb(74,124,89)` pine border, and **four light-theme text runs at 3.04:1**
  ("Components (53)", two `.description` runs, "Edit page").

**Owner: same web-surfaces fix lane.**

### D3 — MEDIUM — `.is-agent-pending` is dead on 10 of the 20 node components

Every node component that renders its own `NodeShell` instead of going through
`NodeWrapper` omits the `agentPending` prop, so the breathing violet ring — which
DESIGN.md §5 calls *"the only thing that borrows the universal violet outside a port"* —
never appears on them.

Verified live: with `agentSessionStore` at `phase:'running'` and an empty `runBaseline`,
a `pan` node (which renders through `NodeWrapper`) gets `.oj-node.is-agent-pending`; an
`add` node renders `oj-node schematic-node math-node add` with no such class.

Missing the prop:

| File | `NodeShell` at |
|---|---|
| `src/components/Nodes/MathNode.tsx` | `:97` |
| `src/components/Nodes/SpeakerNode.tsx` | own shell |
| `src/components/Nodes/MicrophoneNode.tsx` | `:237` |
| `src/components/Nodes/ContainerNode.tsx` | `:115` |
| `src/components/Nodes/SongNode.tsx` | own shell |
| `src/components/Nodes/CanvasIONode.tsx` | `:96` |
| `src/components/Nodes/PortPanelNode.tsx` | `:171` |
| `src/components/Nodes/LibraryNode.tsx` | `:1372` *(P7 file)* |
| `src/components/Nodes/LooperNode.tsx` | `:912` *(P7 file)* |
| `src/components/Nodes/SamplerNode.tsx` | `:517` *(P7 file)* |
| `src/components/Nodes/SamplerVisualNode.tsx` | `:153` *(P7 file)* |

An agent that mints a Speaker, a Looper or a Math node shows the player nothing.
**Owner: P10 (canvas defects); coordinate the four P7 files with P7b.**

### D4 — MEDIUM — the 13px sans floor is broken in four shipped surfaces

`--text-xs` is **11px** and DESIGN.md §3 assigns it to **JetBrains Mono only**; the sans
floor is 13px, with Field labels (12px) as the single documented exception. Four shipped
sites set 11px in the sans:

| File:line | Class | What it is |
|---|---|---|
| `src/components/Settings/SettingsPanel.css:105` | `.oj-set-section__title` | every Settings section caption (About, Diagnostics, Source, First run) |
| `src/components/SafeMode/SafeModeScreen.css:143` | `.oj-fullscreen__link` | Safe Mode's "Open a different project" / "Send a report", and the onboarding footer's "Skip, take me in" |
| `src/components/Toolbar/HelpPanel.css:43` | `.oj-help__mode` | the Help panel's mode chip |
| `src/components/Plugins/PluginWindowShell.css:46, :66` | `.plugin-window-identity span`, `.plugin-window-dirty-label` | "on <node>" and "Unsaved" in the plugin window strip |

All four clear AA on colour; the failure is the type floor, and it is exactly the kind of
text a performer reads in peripheral vision. **Owner: P10.**

(Informational, not counted: `.engine-health-dot__glyph` is 11px sans but renders a single
`aria-hidden` `●`/`○` glyph next to a full-size label, not text.)

### D5 — MEDIUM — `--accent-success` used to mean "selected"

`src/components/CommandBar/ModelPicker.tsx:312`

```tsx
{isCurrent && <Chip tone="success">current</Chip>}
```

DESIGN.md §2, the Signal-Not-Brand Rule: *"never use `--accent-success` to mean 'selected'
(green means healthy, not chosen)."* The row already carries "this is the one" twice — the
`ListRow current` accent-ink dot and the accent-ink label — so the green chip is both
redundant and the wrong hue. Visible in `w6-cap/cmdbar-model-picker-{light,dark}.png`.
**Owner: P10 / command-bar fix.**

### D6 — LOW — a 2px border on the transport record dot

`packages/oj-ui/src/components/TransportPill/TransportPill.css:135–139`

```css
.oj-transport__record-dot { width: 16px; height: 16px; border-radius: 50%;
    border: 2px solid var(--accent-danger); background: transparent; }
```

DESIGN.md §6: *"Borders are 1px hairlines; 1.5px is the maximum, and only on an
interactive outline."* Measured in both themes on every TransportPill capture.
**Owner: P10 / oj-ui.**

### D7 — LOW — the error boundary's dark title drifted off the token it transcribes

`src/components/AppErrorBoundary.css:145` sets dark `.app-error-title { color: #F84B4B }`.
The shipped dark `--danger-ink` is `oklch(0.785 0.21 25)` = **`#FF7771`**. The light block
transcribes `--danger-ink` correctly (`#BB0015`, 6.72:1 on white); the dark one does not
(`#F84B4B` measures **4.80:1** on `#201F19`, vs **6.39:1** for the real ink). The file's own
contract is *"The values ARE the New DNA palette, transcribed … If the palette moves, this
file must be updated BY HAND"* — this is that drift.

Secondary, same file: `.app-error-title` is `font-size: 18px`, a step that is not in the
type scale (30 / 22 / 15 / 14 / 13). **Owner: P10.**

*Not a defect, recorded so a future reviewer does not re-flag it:* this file ships its own
`@media (prefers-reduced-motion: reduce)` block (`:181`), which DESIGN.md §4 normally
forbids. It is justified by the same reasoning as the literals — `main.tsx` imports this
stylesheet directly and the boundary renders when the app tree (and therefore
`global.css`) may have failed. Worth one sentence in the file header, which it currently
lacks.

### D8 — LOW — the Resume-a-session filter field does not match the palette's own search

`w6-cap/cmdbar-sessions-{light,dark}.png`: the filter input is a ~210px box floating at the
left under the header, where the palette search and the model picker's filter are both
full-bleed. Cosmetic, but it makes the same surface look like two surfaces.
`src/components/CommandBar/SessionPicker.tsx` + `CommandBar.css`. **Owner: P10.**

### D9 — DOC — DESIGN.md contradicts itself about 12px sans

§3 ("The 13px Floor") says Field labels are *"the one 12px sans exception"*, but §5
specifies `Chip` at *"12px/600"*, and the shipped `.oj-chip__label` measures 12px sans
everywhere it appears (topbar project chip, Offline chip, the latency "160 ms" chip, the
About panel's version/licence chips). Either the floor gets a second documented exception
or `Chip` moves to 13px. **Owner: W6-DOCS.**

---

## 3. UNREACHABLE

| Item | Why |
|---|---|
| **Relink-samples dialog** | `src/components/Dialogs/RelinkSamplesDialog.tsx` is imported by **nothing**. `grep -rn RelinkSamplesDialog src/` returns only the file itself, so there is no app state that renders it. This is also a covenant #8 violation ("Every production line is used") — it should be wired or deleted, and only then captured. **Owner: P10.** |
| **Resize handles — dark** | Not unreachable in principle; `ResizeHandles` has exactly one call site, `src/components/Nodes/LibraryNode.tsx:1728`, which is P7b's file and out of this lane's scope. The COVERAGE row is attributed to W4-P9 but the component is Library's. **Re-attribute to P7b and capture with the Library pass.** |
| **The hosted plugin's own GUI** | `plugin-window-shell-*` captures the OpenJammer chrome; the middle of that window is the third-party plugin's native view and cannot exist in a browser. The chrome is the design surface and it is fully captured. |

---

## 4. Console / page errors, per capture

The requirement is zero. Observed:

| Capture | Errors | Assessment |
|---|---|---|
| `pwa-update-prompt` (light + dark) | 1 × `[OjcoreWasmExecutor] worklet setup failed: Error: no AudioContext` | **Harness artefact.** My harness sets `isAudioContextReady: true` without a user gesture having created an `AudioContext`, which is the only way to reach the "audio is live, offer the update" branch. Not reproducible by a player. |
| `latency-chip`, `latency-popover` (light + dark) | 1 × the same `no AudioContext` line | Same harness artefact, same cause. |
| `error-boundary` (light + dark) | 2 × — React's own render-error console log, and `[ui] Render crash: Cannot read properties of null (reading 'values')` | **Expected and correct**: the second line is `AppErrorBoundary.componentDidCatch` routing the crash into the DevLog, which is exactly what that capture is testing. |
| **Every other capture (46 rows × 2 themes)** | **0** | Clean. |

No `pageerror` was raised anywhere except inside the deliberate error-boundary capture.

---

## 5. Notes worth carrying forward

- **N1 — Ladle's own chrome is not ours.** In `ladle-catalog-*` and `ladle-theme-switcher-*`
  the sidebar, search and addon bar are Ladle's third-party UI and do not follow our
  tokens (the story area does). One measured 3.61:1 run is a `.ladle-badge`. Nothing to
  fix in `oj-ui`; recorded so the row is not re-opened.
- **N2 — `pan` and `width` are placeable now.** COVERAGE said both were "unplaceable: in no
  `nodeCategories` entry". In the current working tree `src/engine/registry.ts:791–795`
  lists them under **Effects**, and both were added from the real context menu for this
  lane. That MISSING note is stale and is corrected in COVERAGE.
- **N3 — the container's menu label is "Empty Node"**, not "Container"; anyone scripting
  the context menu should know.
- **N4 — universal wiring verified numerically**, not just visually
  (`w6-cap/verify-ports.json`): `.oj-cable--universal.is-quiet` resolves to
  `oklch(0.66 0.19 300)` / `oklch(0.72 0.19 300)` at `stroke-width: 2.5px` with
  `filter: none` — flat violet, no rainbow, no rest glow.
- **N5 — no Caveat, no glow, no hard shadow anywhere inside `src/` or `packages/oj-ui`.**
  Across all 104 captures the DNA sweep found zero cursive/Caveat faces, zero
  `filter: drop-shadow` outside `.oj-cable`, zero zero-blur offset shadows and zero ≥2px
  borders — **except** the two web surfaces (D1, D2) and the one record dot (D6). The
  retired language survives only outside `src/`.
- **N6 — every in-app capture resolved to `Outfit` + `JetBrains Mono` only.**

---

## 6. Remaining MISSING after this lane

**13 rows** (down from 55 items). Eleven belong to the two lanes still running, one is
unreachable until dead code is resolved, one belongs to W6-E2E. The five non-screenshot
gate items from the old list are unchanged and restated in COVERAGE.

1. `looper` faceplate — light + dark *(P7b)*
2. `sampler` faceplate — light + dark *(P7b)*
3. `sampler-visual` faceplate — light + dark *(P7b)*
4. `library` faceplate incl. the two-panel browser — light + dark *(P7b)*
5. Resize handles — dark *(P7b: `LibraryNode` is the only call site)*
6. Piano-roll velocity lane + scroomer — light + dark *(TB-c)*
7. Timeline record ghost — light + dark *(TB-c)*
8. Timeline playhead + loop/punch brace — dedicated, light + dark *(TB-c)*
9. Section markers — dedicated, light + dark *(TB-c)*
10. Timeline 1920×1080 — dark frames 06–12 *(TB-c)*
11. Timeline reduced motion — dark *(TB-c)*
12. Relink-samples dialog — **UNREACHABLE** until it is wired or deleted *(P10)*
13. Visual-regression baselines, both themes *(W6-E2E)*
