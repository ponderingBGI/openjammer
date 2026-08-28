# Wave 1 S0+S1 report

## What changed

### S0 — test preparation and reduced motion

- Loosened exact `className` equality assertions to primary-class containment in 22 files:
  `Button.test.tsx`, `Callout.test.tsx`, `Chip.test.tsx`, `CodeBlock.test.tsx`,
  `Input.test.tsx`, `Kbd.test.tsx`, `ListRow.test.tsx`, `Marquee.test.tsx`,
  `NodeFrame.test.tsx`, `OffscreenPointer.test.tsx`, `ProgressBar.test.tsx`,
  `SegmentedControl.test.tsx`, `Select.test.tsx`, `Slider.test.tsx`,
  `Spinner.test.tsx`, `StatusDot.test.tsx`, `Surface.test.tsx`, `Swatch.test.tsx`,
  `Textarea.test.tsx`, `Toggle.test.tsx`, `Waveform.test.tsx`, and
  `WaveformView.test.tsx`, all under `packages/oj-ui/src/components/`.
- Added the blanket reduced-motion rule at `src/styles/global.css:67`, with `.oj-cable`
  and `.oj-meter` exemptions exactly as specified.
- Deleted duration/animation-only reduced-motion blocks (locations before deletion):
  - `src/styles/global.css:67` (old surface-transition block; replaced by blanket rule)
  - `src/components/Bench/Bench.css:9`
  - `src/components/CommandBar/CommandBar.css:65`, `:372`, `:1012`
  - `src/components/Export/ExportDialog.css:130`
  - `src/components/PianoRoll/PianoRoll.css:92`
  - `src/components/Plugins/PluginsPanel.css:34`
  - `src/components/Settings/AudioSettingsPanel.css:235`
  - `src/components/Settings/UpdatesPanel.css:152`
  - `packages/oj-ui/src/components/NodeShell/NodeShell.css:51`
  - `packages/oj-ui/src/components/Port/Port.css:78`, `:112`
- Kept meaningful reduced-motion blocks at their current lines:
  - `packages/oj-ui/src/components/Cable/Cable.css:108` — cable semantic animation exception
  - `packages/oj-ui/src/components/LaneButton/LaneButton.css:18` — resets transform
  - `packages/oj-ui/src/components/Spinner/Spinner.css:30` — holds the status arc in a static state
  - `src/components/Arrangement/ArrangementSurface.css:374` — resets transforms and supplies static recording/scrollbar states
  - `src/components/CommandBar/CommandBar.css:306` — resets hover transform
  - `src/components/EngineHealthDot/EngineHealthDot.css:53` — resets lift/press transform
  - `src/styles/global.css:327` — resets welcome-option hover transform

### S1 — Outfit font migration

- Added self-hosted latin Outfit 400/500/600/700 files to `public/fonts/` and
  `apps/docs/public/fonts/`; each is a valid 32,292-byte `wOF2` file. Removed Caveat and
  Inter WOFF2 files from both locations. JetBrains Mono files are unchanged.
- Replaced Caveat/Inter faces with four Outfit faces in `src/styles/fonts.css`,
  `.design-sync/fonts.css`, and `apps/docs/src/fonts.css`.
- Changed `font.sans` and deleted `font.sketch` in
  `packages/oj-tokens/tokens/primitive.json`; regenerated
  `packages/oj-tokens/dist/variables.css`,
  `packages/oj-tokens/src/generated/themes.ts`, and `packages/oj-ui/oj-tokens.css`.
- Replaced every `--font-sketch` consumer with `--font-sans` across app CSS, oj-ui CSS
  and stories, `.ladle/components.tsx`, and `src/components/Nodes/MultiplierNode.tsx`.
  Also migrated hard-coded shipped font consumers in `index.html`,
  `public/download/download.css`, `src/components/Nodes/InstrumentVisualNode.css`, and
  `src/components/Nodes/SongNode.css` so removed assets cannot be requested.
- Added all four Outfit preloads and the Outfit boot stack in `index.html`.
- Replaced `extraFonts` entries in `.design-sync/config.json`.
- Removed the two dead Google Fonts runtime caches from `vite.config.ts`; its precache
  glob already includes `woff2` at `vite.config.ts:198`.
- Deleted only the Caveat ascender guard test from
  `src/components/Arrangement/__tests__/ArrangementSurface.test.tsx`.
- Updated shipped-font references in `apps/docs/`, `docs/README.md`, and
  `docs/design-system-migration-plan.md`; `DESIGN.md` was intentionally untouched.
- Added the Outfit notice at `THIRD-PARTY-LICENSES.md:36`:
  copyright `The Outfit Project Authors`, `SIL Open Font License 1.1 (OFL-1.1)`.

## Verification

- `bun run tokens` — pass; generated all three token artifacts.
- Font binary check — pass; all four files have `wOF2` magic and are 32,292 bytes.
- `rg -n "font-sketch" src packages .ladle index.html` — no matches, including generated output.
- Targeted tests — pass: 38 files, 251 tests.
- `bunx tsc --noEmit -p tsconfig.app.json` — pass (exit 0).
- `bun run lint` — fail (exit 1), rerun once with the same result. The 11 errors are
  outside this lane: ten `no-explicit-any` findings in
  `plans/redesign-new-dna/.scratch/timeline-audit.ts` and one
  `react-refresh/only-export-components` finding in
  `src/components/Guides/GuideStep.tsx`. Four existing `NodeCanvas.tsx` hook warnings
  were also reported. These files were not fixed under the ownership rule.
- `bun run test:run` — pass: 165 files, 1,632 tests. The known-flaky
  `src/audio/__tests__/voiceSynth.test.ts` passed in the full run, so no isolated rerun was needed.
- Browser verification at `http://localhost:5177` — pass after clicking “Play here in
  your browser”: `document.fonts.check('600 15px Outfit') === true`; body font was
  `Outfit, system-ui, "Segoe UI", -apple-system, sans-serif`; zero console errors and
  zero page errors. Screenshot: `plans/redesign-new-dna/.scratch/w1/canvas-outfit.png`.
  The script is `plans/redesign-new-dna/.scratch/w1/verify-outfit.mjs` and was run with
  Node because `bunx playwright <script>` is not a valid Playwright CLI command in this install.
- `bun run build` — pass; Vite built 1,650 modules and PWA precached 87 entries.
- `rg -n -o "outfit-[a-z]+\\.woff2" dist/sw.js` — pass; bold, medium, regular, and
  semibold are all present in the generated service-worker precache manifest.
- `git diff --stat` at handoff (shared worktree, therefore includes the concurrent
  timeline lane) — 148 tracked files changed, 1,154 insertions, 832 deletions. Untracked
  Outfit binaries, screenshot/script, and this report are not counted by `git diff --stat`.

## Could not verify

- The full lint gate could not be made green without editing files outside this lane.
- No human audio-playing or performer-feel test was performed. The change is font/motion
  plumbing only; automated browser verification does not establish live audio feel.
- Arrangement and populated-node typography were not visually exercised in the captured
  empty-canvas screenshot.

## Risks and follow-ups

- `src/styles/global.css:202` still has a line-height comment explicitly tuned for Caveat
  apostrophe/descender metrics. It was left unchanged because Wave 2 owns size/metric work.
- `src/components/Arrangement/ArrangementSurface.css:191` retains the former Caveat guard's
  `18px/26px` track-name metrics and `overflow-clip-margin: 6px`; inspect with populated tracks.
- `src/components/Arrangement/ArrangementSurface.css:284` retains `18px/24px` mixer-name
  metrics; inspect long names and truncation in Wave 2.
- Impeccable reports Outfit as outside the current `DESIGN.md` and flags the one-family
  hierarchy. This is intentional under D3; D15 reserves the `DESIGN.md` replacement for Wave 6.
  No persistent hook ignore was added.
