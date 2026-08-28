# W2-S2b report — New DNA short fix round

Date: 2026-08-29  
Worktree: `C:\Users\olimt\.t3\worktrees\openjammer\t3code-2faff191`

## Outcome by requested item

1. **Custom-property correctness — fixed and verified.**
   - `.ladle/components.tsx:69` now uses `border: 1px solid var(--border-subtle)`.
   - Added `plans/redesign-new-dna/.scratch/w2b/check-css-vars.mjs`. It scans `src/`,
     `packages/`, `.ladle/`, and `index.html`, strips comments, collects declarations from
     generated token CSS and local declarations/`setProperty` calls, then checks every
     `var(--x)` use.
   - The first run exposed 21 pre-existing fallback-only aliases. Their CSS consumers were
     moved to declared semantic tokens in `AppErrorBoundary.css`, `BundlePortGroup.css`,
     `CollabControl.css`, `CommandBar.css`, `EngineHealthDot.css`, `MIDIConnectionToast.css`,
     `MIDINode.css`, `MIDIVisualNode.css`, `SamplerVisual.css`, `SchematicNodes.css`, and
     `Breadcrumbs.css`.
   - Final script output:

     ```text
     Scanned 709 files; 129 declared custom properties; 96 used custom properties.
     Undeclared custom properties: none.
     ```

   - `rg -- "--border-subtle-width" src packages .ladle index.html` is empty.
   - The CSS-only scan for `--transition-fast` is empty. The sole remaining source-text
     occurrence is the invariant test assertion that rejects future CSS consumers.

2. **Per-theme scrims — fixed and browser-verified.**
   - `src/components/Settings/SettingsPanel.css:10`,
     `src/components/Settings/KeybindingsPanel.css:173`, and
     `src/components/CommandBar/CommandBar.css:17` now use
     `background: var(--overlay-scrim)`.
   - A real screenshot pixel at `(24, 480)` measured `rgb(22,21,16)` on the unobscured dark
     studio and `rgb(21,21,16)` behind both Settings and Ctrl+K. Relative luminance fell from
     `0.00744314` to `0.00733171`; both overlays make the studio darker, never lighter.

3. **`colorjs.io` dependency — fixed and verified.**
   - `package.json:91` pins `colorjs.io` exactly to `0.5.2`; `bun.lock:43,1010` contains the
     direct resolution and integrity entry.
   - `bun install --frozen-lockfile` passed with `no changes` across 1,302 installs.
   - The lockfile is present as a working-tree change. No git add/commit operation was run,
     per the lane rules.

4. **Settings theme-picker regression test — added and passing.**
   - `src/components/Settings/__tests__/SettingsPanel.test.tsx:18` covers the named
     radiogroup, two radio roles, roving `aria-checked`, ArrowRight selection/focus, Space
     activation, persistence, and an external `openjammer:theme-change` update.
   - The Settings-focused run passed: 5 files / 63 tests. The final requested focused run
     passed: 44 files / 337 tests, including all six updated CSS invariant assertions.

5. **Contrast and motion tokens — fixed and verified.**
   - `packages/oj-tokens/tokens/themes/dark.json:53`: `dangerInk` is now
     `oklch(0.69 0.21 25)`.
   - `packages/oj-tokens/tokens/themes/light.json:15`: `borderControl` is `#89867C`;
     `packages/oj-tokens/tokens/themes/dark.json:15`: it is `#807C6F`.
   - `src/components/Arrangement/__tests__/contrast.test.ts:47-59` asserts danger ink at
     4.5:1 on inset/canvas/surface/header and control borders at 3:1 on
     inset/canvas/surface in both themes.
   - Measured danger minima: light `4.693`, dark `4.707`. Measured border minima: light
     `3.028`, dark `3.530`.
   - `packages/oj-tokens/tokens/primitive.json:39-42` now has only `motion.fast` and
     `motion.spring` for the fast path; `transition.normal`/`transition.slow` remain.
     All 37 CSS consumer files now use `--motion-fast`; no `--transition-fast` consumer or
     declaration remains after generation.
   - `bun run tokens` was run twice. Snapshot-to-second-run `git diff --no-index --exit-code`
     returned `0,0,0` for `dist/variables.css`, `src/generated/themes.ts`, and
     `packages/oj-ui/oj-tokens.css`. The literal requested HEAD-relative
     `git diff --exit-code -- <generated paths>` cannot be an idempotency signal in this
     deliberately uncommitted worktree because the generated token swap already differs
     from HEAD.

6. **Theme-aware Sonner toaster — fixed and browser-verified.**
   - `src/App.tsx:123,167-174,745` derives `light | dark` from the saved theme, follows
     `openjammer:theme-change` and storage events, and passes it to `<Toaster>`.
   - `richColors` was removed. `src/styles/global.css:339-349` gives Sonner the semantic
     `--bg-secondary`, `--border-subtle`, `--text-primary`, and `--text-secondary` values
     with sufficient priority over Sonner's runtime-inserted theme sheet.
   - Browser result: `data-sonner-theme="dark"`, background `rgb(36,34,25)`, text
     `rgb(241,239,232)`, border `rgb(51,49,42)`, contrast `13.85:1`.

7. **Dark boot hairlines — fixed and browser-verified.**
   - `index.html:17-18,55,95,135` introduces `--oj-boot-line` and
     `--oj-boot-line-strong`; the pre-paint dark branch assigns `#33312A` and `#4B473D`.
   - The node harness delayed `/src/main.tsx` so `dark-cold-start.png` captures the actual
     inline boot card. Runtime assertions read both exact dark values and body
     `rgb(22,21,16)`.

8. **Stale CSS comments — fixed and verified.**
   - Removed only comment blocks containing the retired standalone terms `2px`, `hard`,
     `offset`, `sketch`, `ink`, `Caveat`, or `hand-drawn`; production rules were not removed.
     A block-comment-aware rescan returns zero matches.
   - Files cleaned (41):
     - `src/components/Clips/AudioClipVisual.css`
     - `src/components/CommandBar/CommandBar.css`
     - `src/components/common/ResizeHandles.css`
     - `src/components/EngineHealthDot/EngineHealthDot.css`
     - `src/components/Nodes/BaseNode.css`
     - `src/components/Nodes/InstrumentVisualNode.css`
     - `src/components/Nodes/SchematicNodes.css`
     - `src/components/Nodes/SongNode.css`
     - `src/components/Settings/SettingsPanel.css`
     - `src/components/Settings/UpdatesPanel.css`
     - `src/components/Toolbar/DropdownMenu.css`
     - `src/components/Toolbar/Toolbar.css`
     - `src/styles/global.css`
     - `packages/oj-ui/src/components/Banner/Banner.css`
     - `packages/oj-ui/src/components/Button/Button.css`
     - `packages/oj-ui/src/components/Callout/Callout.css`
     - `packages/oj-ui/src/components/Chip/Chip.css`
     - `packages/oj-ui/src/components/DeviceSelect/DeviceSelect.css`
     - `packages/oj-ui/src/components/EditableLabel/EditableLabel.css`
     - `packages/oj-ui/src/components/Field/Field.css`
     - `packages/oj-ui/src/components/KeyTile/KeyTile.css`
     - `packages/oj-ui/src/components/ListRow/ListRow.css`
     - `packages/oj-ui/src/components/Menu/Menu.css`
     - `packages/oj-ui/src/components/Modal/Modal.css`
     - `packages/oj-ui/src/components/NodeShell/NodeShell.css`
     - `packages/oj-ui/src/components/OffscreenPointer/OffscreenPointer.css`
     - `packages/oj-ui/src/components/PanelHeader/PanelHeader.css`
     - `packages/oj-ui/src/components/Port/Port.css`
     - `packages/oj-ui/src/components/PortRow/PortRow.css`
     - `packages/oj-ui/src/components/SegmentedControl/SegmentedControl.css`
     - `packages/oj-ui/src/components/Select/Select.css`
     - `packages/oj-ui/src/components/Slider/Slider.css`
     - `packages/oj-ui/src/components/Spinner/Spinner.css`
     - `packages/oj-ui/src/components/StatusDot/StatusDot.css`
     - `packages/oj-ui/src/components/Surface/Surface.css`
     - `packages/oj-ui/src/components/Swatch/Swatch.css`
     - `packages/oj-ui/src/components/Textarea/Textarea.css`
     - `packages/oj-ui/src/components/Toggle/Toggle.css`
     - `packages/oj-ui/src/components/ValueScrubber/ValueScrubber.css`
     - `packages/oj-ui/src/components/Waveform/Waveform.css`
     - `packages/oj-ui/src/components/WaveformView/WaveformView.css`

9. **Pure CSS visual mistakes — fixed and regression-guarded.**
   - `packages/oj-ui/src/components/Port/Port.css:25-55` removes every connected/active
     `box-shadow`; ports never glow. The later recessed-well redesign remains S3 work.
   - `src/components/Nodes/SchematicNodes.css:124-134` resets the Speaker range input's
     inherited outer input background/border/padding, leaving one native range track.
   - `src/components/Arrangement/__tests__/tokenLiteralGate.test.ts:42-61` asserts no
     `box-shadow` in Port CSS, the Speaker outer-track reset, and the single fast-motion
     token. All 6 assertions pass.

## Verification summary

| Gate | Result |
|---|---|
| `bun install --frozen-lockfile` | PASS — no changes |
| `bun run tokens` twice | PASS — three artifact comparisons `0,0,0` |
| undeclared custom-property script | PASS — 709 files, none undeclared |
| stale-comment block scan | PASS — zero matching blocks |
| `git diff --check` | PASS |
| requested focused Vitest command | PASS — 44 files / 337 tests |
| updated `tokenLiteralGate.test.ts` | PASS — 6/6 within the requested run |
| scoped ESLint over S2b TS/TSX and package sources | PASS |
| `bunx tsc --noEmit -p tsconfig.app.json` | PASS |
| `bun run lint` | PASS — exit 0; one pre-existing PianoRoll hook-dependency warning |
| `bun run build` | PASS — 1,655 modules, PWA service worker generated |
| node Playwright, one Chromium, port 5200 | PASS — zero final console/page errors; port free afterward |

Browser artifacts:

- `plans/redesign-new-dna/.scratch/w2b/dark-cold-start.png`
- `plans/redesign-new-dna/.scratch/w2b/dark-settings-scrim.png`
- `plans/redesign-new-dna/.scratch/w2b/dark-commandbar-scrim.png`
- `plans/redesign-new-dna/.scratch/w2b/dark-toast.png`
- `plans/redesign-new-dna/.scratch/w2b/browser-results.json`

## Remaining taste-wave visual list

These review items were intentionally left for their assigned taste waves:

- V3: ink-filled topbar active states (`Canvas`/`Arrangement`, `Collaborate`).
- V4: 2px section-chip outlines in `ArrangementSurface.css`.
- V7: the Keys instrument Pedal label/rule/spinner composition.
- V8: clipped ruler bar numbers.
- V9: arrangement lanes ending above the viewport floor (recheck after the concurrent lane).
- V10: latency banner/transport collision.
- V11: clipped CommandBar placeholder edge.
- V12: pill radius not yet applied to the intended arrangement chips.
- V13: remaining literal 2px constructions assigned to W3-W5.
- V14: welcome copy still says “A sketchbook you can play.”

## UNVERIFIED / external limits

- Audio feel (clicks/dropouts/latency) was not human-auditioned in headless Chromium. S2b changes
  are control-plane CSS/tokens/tests only and do not touch the audio path.
- Full lint exits successfully but still reports the concurrent lane's pre-existing
  `react-hooks/exhaustive-deps` warning at `src/components/PianoRoll/PianoRoll.tsx:534`; this lane
  was explicitly forbidden from editing PianoRoll.
- The Impeccable hook re-reported the existing `rgba(0,0,0,0.06)` canvas-dot value at
  `src/styles/global.css:107`. It is the existing intentional dot-grid material, not introduced
  by S2b; no suppression or palette change was made without user approval.
