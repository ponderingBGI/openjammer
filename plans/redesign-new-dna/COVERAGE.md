# COVERAGE — the Wave 6 completeness gate

One row per item in MASTER-PLAN § "Scope = everything". The gate: **every row needs a lane
owner, a light screenshot and a dark screenshot.** A row without both is a defect, not a
follow-up.

- All screenshot paths are relative to `plans/redesign-new-dna/.scratch/`.
- **MISSING** means no capture exists anywhere in `.scratch/`. Every MISSING is listed
  again in § "The MISSING list" at the bottom so a capture lane can work straight down it.
- *(incidental)* means the item is visible inside a wider capture but has no dedicated
  shot. It counts as evidence the item was redesigned; it does **not** count as a gate
  screenshot for a row whose whole job is that item.
- Status: **DONE** (committed + gated) · **IN-FLIGHT** (built, not yet committed or gate
  still running) · **NOT STARTED**.

Commit map for the "Lane / commit" column:

| Lane | Commit | Subject |
|---|---|---|
| W1-S0S1 | `82ed464` | Outfit replaces Caveat + Inter; one reduced-motion rule |
| W1-P10A | `9f9d862` | canvas: cable reconnect, held-note safety, geometry |
| W1-TA1 | `007060b`, `9c25393` | timeline reliability TL-01…28 |
| W2-S2 | `a0ac294` | New DNA tokens — light + dark |
| W3-P1 | `3473001` | oj-ui controls + the Knob |
| W3-S3 | `41060df` | socket ports, node card, teal cables |
| W3-P2 | `02dfc9b` | oj-ui surfaces and feedback |
| W3-TA2 | `7781c5e` | timeline gesture controller, snap, bindings |
| W4-P3 | `99afb72` | oj-ui canvas and media |
| W4-P5 | `041ff72` | command bar, AI panel, context menu |
| W4-S4 | `ae92021` | topbar, transport pill, onboarding, preset rigs |
| W4-P9 | `a554c99` | panels: settings, guides, dev log, plugins, MIDI, collab |
| W5 prep | `87ad93f` | split `SchematicNodes.css` per family |
| W5-P6 | `79c71b4` | node faceplates: speaker, mic, math, panels, container, song, effect, recorder |
| **W4-TB** | *uncommitted* | arrangement + piano roll redesign (working tree) |
| **W5-P7** | *not started* | Looper / Sampler / Library |
| **W5-P8** | `ab23a31` | keyboard / instrument / MIDI / MiniLab family |
| **W5-P10** | *not started* | canvas/app defects + dead code |
| **W6-E2E** | *not started* | acceptance tests + visual-regression baselines |
| **W6-CAP** | *this pass* | capture + judge every MISSING cell outside TB/P7 — [W6-CAP-REPORT.md](W6-CAP-REPORT.md) |

---

## 1. Shell

| Item | Lane / commit | Light | Dark | Status |
|---|---|---|---|---|
| Topbar | W4-S4 `ae92021` + W6-CAP | `w6-cap/topbar-light.png` | `w6-cap/topbar-dark.png` | DONE |
| Transport pill | W4-S4 `ae92021` + W6-CAP | `w6-cap/transport-pill-light.png` | `w6-cap/transport-pill-dark.png` | DONE |
| Breadcrumbs | W4-S4 `ae92021` | `w5-p6-gate/01-container-inside-light.png` *(incidental)* | `w5-p6-gate/01-container-inside-dark.png` *(incidental)* | DONE |
| Surface switcher / sky band | W4-S4 `ae92021` + W4-TB | `w4-tb/light-1280-05-selected-clip.png` | `w4-tb/dark-1280-05-selected-clip.png` | IN-FLIGHT (TB) |
| Onboarding — step 1 (experience) | W4-S4 `ae92021` | `w4-s4-gate/g-01-onboarding-light.png` | `w4-s4-gate/g-13-onboarding-dark.png` | DONE |
| Onboarding — step 2 (goal) | W4-S4 `ae92021` | `w4-s4-gate/g-02-onboarding-goal.png` | `w4-s4-gate/g-17-onboarding-dark.png` | DONE |
| Onboarding — step 3 (theme) | W4-S4 `ae92021` | `w4-s4-gate/g-03-onboarding-theme.png` | `w4-s4-gate/g-16-native-theme-step.png` | DONE |
| Onboarding — reduced motion | W4-S4 `ae92021` + W6-CAP | `w6-cap/onboarding-reduced-motion-light.png` | `w6-cap/onboarding-reduced-motion-dark.png` | DONE |
| Help panel | W4-P9 `a554c99` + W6-CAP | `w6-cap/help-panel-light.png` | `w6-cap/help-panel-dark.png` | DEFECT → P10 (D4: `.oj-help__mode` is 11px sans) |
| Toasts (Sonner) | W4-P9 `a554c99` + W6-CAP | `w6-cap/toast-light.png` | `w6-cap/toast-dark.png` | DONE |
| PWA update prompt | W4-P9 `a554c99` + W6-CAP | `w6-cap/pwa-update-prompt-light.png` | `w6-cap/pwa-update-prompt-dark.png` | DONE |
| Latency chip + popover | W4-S4 `ae92021` + W6-CAP | `w6-cap/latency-chip-light.png`, `latency-popover-light.png` | `w6-cap/latency-chip-dark.png`, `latency-popover-dark.png` | DONE |
| Engine-health dot | W4-S4 `ae92021` | `w4-s4-gate/g-14-topbar-light.png` *(incidental)* | `w5-p6-gate/00-canvas-dark.png` *(incidental)* | DONE |
| Offline chip | W4-S4 `ae92021` + W6-CAP | `w6-cap/offline-chip-light.png` | `w6-cap/offline-chip-dark.png` | DONE |
| Project chip | W4-S4 `ae92021` | `w4-tb/light-1280-05-selected-clip.png` *(incidental)* | `w4-tb/dark-1280-05-selected-clip.png` *(incidental)* | DONE |
| Collab control + presence overlay | W4-P9 `a554c99` | `w4-p9-gate/light-collab.png` | `w4-p9-gate/dark-collab.png` | DONE |
| Error boundary | W4-P9 `a554c99` + W6-CAP | `w6-cap/error-boundary-light.png` | `w6-cap/error-boundary-dark.png` | DEFECT → P10 (D7: dark title `#F84B4B` is not the dark `--danger-ink` `#FF7771`) |
| Safe-mode screen | W4-P9 `a554c99` + W6-CAP | `w6-cap/safe-mode-light.png` | `w6-cap/safe-mode-dark.png` | DEFECT → P10 (D4: `.oj-fullscreen__link` is 11px sans) |
| Plugin window shell | W4-P9 `a554c99` + W6-CAP | `w6-cap/plugin-window-shell-light.png` | `w6-cap/plugin-window-shell-dark.png` | DEFECT → P10 (D4: two 11px sans runs) |

## 2. Canvas

| Item | Lane / commit | Light | Dark | Status |
|---|---|---|---|---|
| Dot grid / stage | W2-S2 `a0ac294` | `w5-p6-gate/00-canvas-light.png` | `w5-p6-gate/00-canvas-dark.png` | DONE |
| Marquee | W4-P3 `99afb72` | `w4-p3-gate/primitives--marquee--default--light.png` | `w4-p3-gate/primitives--marquee--default--dark.png` | DONE |
| Offscreen pointer | W4-P3 `99afb72` | `w4-p3-gate/primitives--offscreenpointer--directions--light.png` | `w4-p3-gate/primitives--offscreenpointer--directions--dark.png` | DONE |
| Cables — audio / control | W3-S3 `41060df` | `w3-s3-gate/light-12-cables.png` | `w3-s3-gate/dark-01-rig.png` *(incidental)* | DONE |
| Cables — selected | W3-S3 `41060df` | `w3-s3-gate/light-07-selected-cable.png` | `w3-s3-gate/dark-07-selected-cable.png` | DONE |
| Cables — temp (drag) | W3-S3 `41060df` | `w3-s3-gate/light-06-temp-cable.png` | `w3-s3-gate/dark-06-temp-cable.png` | DONE |
| Cables — bundled | W3-S3 `41060df` | `w3-s3-gate/light-14-bundle-close.png` | `w3-s3-gate/dark-10-bundle-closeup.png` | DONE |
| Cables — universal | W3-S3 `41060df` + W6-CAP | `w6-cap/cable-universal-light.png` | `w6-cap/cable-universal-dark.png` | DONE — flat violet, 2.5px, `filter: none` at rest (`w6-cap/verify-ports.json`) |
| Ghost mode | W3-S3 `41060df` | `w3-s3-gate/light-08-ghost.png` | `w3-s3-gate/dark-08-ghost.png` | DONE |
| Context menu (→ oj-ui Menu) | W4-P5 `041ff72` | `w4-p5-gate/c01-menu-root--light.png` | `w4-p5-gate/c01-menu-root--dark.png` | DONE |
| Context menu — submenu / edge flips | W4-P5 `041ff72` | `w4-p5-gate/c02-menu-submenu--light.png`, `c03-menu-corner-*--light.png` | `w4-p5-gate/c02-menu-submenu--dark.png`, `c03-menu-corner-*--dark.png` | DONE |
| Node frame — selection | W3-S3 `41060df` | `w3-s3-gate/light-04-selected.png` | `w3-s3-gate/dark-04-selected.png` | DONE |
| Node frame — dragging | W3-S3 `41060df` | `w3-s3-gate/light-05-dragging.png` | `w3-s3-gate/dark-05-dragging.png` | DONE |
| Node frame — agent-pending | W3-S3 `41060df` + W6-CAP | `w6-cap/node-agent-pending-light.png` | `w6-cap/node-agent-pending-dark.png` | DEFECT → P10 (D3: 10 node components never pass `agentPending`, so the state is dead on them) |
| Resize handles | **W5-P7** — re-attributed: `LibraryNode.tsx:1728` is the only call site | `w3-s3-gate/light-11-after-resize.png` *(incidental)* | MISSING | **NOT STARTED** (P7) |
| Bundle port groups | W3-S3 `41060df` | `w3-s3-gate/light-09-bundle-inside.png`, `light-13-bundle-panel.png` | `w3-s3-gate/dark-09-bundle-inside.png` | DONE |

## 3. Node faceplates

The registry declares **36** node types (`NodeType` in `src/engine/types.ts`). The
MASTER-PLAN inventory said "40" and listed `audio-in` / `audio-out`, which are **port
ids**, not node types — corrected here.

| Node type | Lane / commit | Light | Dark | Status |
|---|---|---|---|---|
| `speaker` | W5-P6 `79c71b4` | `w5-p6-gate/speaker-light.png`, `closeup-speaker-light.png` | `w5-p6-gate/speaker-dark.png`, `closeup-speaker-dark.png` | DONE |
| `microphone` | W5-P6 `79c71b4` | `w5-p6-gate/microphone-light.png` | `w5-p6-gate/microphone-dark.png` | DONE |
| `effect` | W5-P6 `79c71b4` | `w5-p6-gate/effect-light.png` | `w5-p6-gate/effect-dark.png` | DONE |
| `multiplier` | W5-P6 `79c71b4` | `w5-p6-gate/multiplier-light.png` | `w5-p6-gate/multiplier-dark.png` | DONE |
| `add` | W5-P6 `79c71b4` | `w5-p6-gate/math-add-light.png` | `w5-p6-gate/math-add-dark.png` | DONE |
| `subtract` | W5-P6 `79c71b4` | `w5-p6-gate/math-subtract-light.png` | `w5-p6-gate/math-subtract-dark.png` | DONE |
| `recorder` | W5-P6 `79c71b4` | `w5-p6-gate/recorder-light.png` | `w5-p6-gate/recorder-dark.png` | DONE |
| `container` | W5-P6 `79c71b4` | `w5-p6-gate/container-light.png` | `w5-p6-gate/container-dark.png` | DONE |
| `song` | W5-P6 `79c71b4` | `w5-p6-gate/song-light.png` | `w5-p6-gate/song-dark.png` | DONE |
| `input-panel` | W5-P6 `79c71b4` | `w5-p6/input-panel-light.png` | `w5-p6/input-panel-dark.png` | DONE |
| `output-panel` | W5-P6 `79c71b4` | `w5-p6/output-panel-light.png` | `w5-p6/output-panel-dark.png` | DONE |
| `canvas-input` | W5-P6 `79c71b4` + W6-CAP | `w6-cap/canvas-io-light.png` | `w6-cap/canvas-io-dark.png` | DONE |
| `canvas-output` | W5-P6 `79c71b4` + W6-CAP | `w6-cap/canvas-io-light.png` | `w6-cap/canvas-io-dark.png` | DONE |
| `keyboard` | W5-P8 `ab23a31` | `w5-p8-gate/g-d1-keyboard-light.png` | `w5-p8-gate/g-d1-keyboard-dark.png` | DONE |
| `keyboard-visual` | W5-P8 `ab23a31` | `w5-p8-gate/g-d1-keyboard-visual-light.png` | `w5-p8-gate/g-d1-keyboard-visual-dark.png` | DONE |
| `instrument` | W5-P8 `ab23a31` | `w5-p8-gate/g-d1-instrument-light.png` | `w5-p8-gate/g-d1-instrument-dark.png` | DONE |
| `instrument-visual` | W5-P8 `ab23a31` | `w5-p8-gate/g-i3-instrument-visual-light.png` | `w5-p8-gate/g-i3-instrument-visual-dark.png` | DONE |
| `midi` | W5-P8 `ab23a31` | `w5-p8-gate/g-i1-midi-light.png` | `w5-p8-gate/g-i1-midi-dark.png` | DONE |
| `midi-visual` | W5-P8 `ab23a31` | `w5-p8-gate/g-i3-midi-visual-light.png` | `w5-p8-gate/g-i3-midi-visual-dark.png` | DONE |
| `minilab-3` | W5-P8 `ab23a31` | `w5-p8-gate/g-i1-minilab-3-light.png` | `w5-p8-gate/g-i1-minilab-3-dark.png` | DONE |
| `minilab3-visual` | W5-P8 `ab23a31` | `w5-p8-gate/g-j1-minilab3-body-light.png`, `g-j1-minilab3-panel-light.png` | `w5-p8-gate/g-j1-minilab3-body-dark.png`, `g-j1-minilab3-panel-dark.png` | DONE |
| `looper` | W5-P7 | MISSING | MISSING | **NOT STARTED** (P7) |
| `sampler` | W5-P7 | MISSING | MISSING | **NOT STARTED** (P7) |
| `sampler-visual` | W5-P7 | MISSING | MISSING | **NOT STARTED** (P7) |
| `library` (two-panel browser) | W5-P7 | MISSING | MISSING | **NOT STARTED** (P7) |
| `pan` | W6-CAP | `w6-cap/faceplate-pan-light.png` | `w6-cap/faceplate-pan-dark.png` | DONE — and **placeable**: `registry.ts` now lists it under Effects |
| `width` | W6-CAP | `w6-cap/faceplate-width-light.png` | `w6-cap/faceplate-width-dark.png` | DONE — placeable under Effects |
| `strings` | W5-P8 `ab23a31` + W6-CAP | `w6-cap/faceplate-strings-light.png` | `w6-cap/faceplate-strings-dark.png` | DONE |
| `keys` | W5-P8 `ab23a31` + W6-CAP | `w6-cap/faceplate-keys-light.png` | `w6-cap/faceplate-keys-dark.png` | DONE |
| `winds` | W5-P8 `ab23a31` + W6-CAP | `w6-cap/faceplate-winds-light.png` | `w6-cap/faceplate-winds-dark.png` | DONE |
| `AutoParamPanel` (in-node Knob rack) | W5-P6 `79c71b4` | `w5-p6/07-autoparam-light.png` | `w5-p6/07-autoparam-dark.png` | DONE |
| Node states — selected / refusal / hover-connect | W5-P6 `79c71b4` | `w5-p6-gate/state-selected-speaker-light.png`, `state-refusal-math-light.png`, `w5-p6/state-hover-connecting-math-light.png` | `w5-p6-gate/state-selected-speaker-dark.png`, `state-refusal-math-dark.png`, `w5-p6/state-hover-connecting-math-dark.png` | DONE |

> **Decided and executed (W6-P11).** Six of those rows are gone from this table because the
> types are gone from the registry: `keyboard-key` (nothing ever minted one — a keyboard's
> interior is ONE `keyboard-visual` carrying 31 per-key PORTS) was **deleted outright**, and
> the five fixed voices `piano` / `cello` / `electricCello` / `violin` / `saxophone` were
> **deleted and migrated on load** — every seam that reads a saved document rewrites them to
> `instrument` and seeds the catalogue `instrumentId` that reproduces the same voice
> (`src/engine/nodeTypeMigrations.ts`). Covenant #7/#8.
>
> **Settled (W6-CAP).** `strings` / `keys` / `winds` are LIVE — the three Instruments menu
> rows and the three targets Ctrl+←/→ cycles between — and all three now have dedicated
> captures in both themes, added from the real context menu. `pan` and `width` are captured
> too, and the "unplaceable" note above them was stale: `src/engine/registry.ts` lists both
> under the **Effects** menu bucket in the current tree. The only faceplates still without
> an image are P7's four (`looper`, `sampler`, `sampler-visual`, `library`).

## 4. Timeline

All W4-TB, **uncommitted** — `src/components/Arrangement/**` and `src/components/PianoRoll/**`
are dirty in the working tree.

| Item | Lane | Light | Dark | Status |
|---|---|---|---|---|
| Arrangement — empty state | W4-TB | `w4-tb/light-1280-01-empty.png` | `w4-tb/dark-1280-01-empty.png` | IN-FLIGHT: TB (running) |
| Arrangement — ruler, headers, field, clips | W4-TB | `w4-tb/light-1280-02-paper-sketch.png` | `w4-tb/dark-1280-02-paper-sketch.png` | IN-FLIGHT: TB (running) |
| Arrangement — 24-bar demo (in/out) | W4-TB | `w4-tb/light-1280-03-first-light-out.png`, `-04-first-light-in.png` | `w4-tb/dark-1280-03-first-light-out.png`, `-04-first-light-in.png` | IN-FLIGHT: TB |
| Clip selection + edge handles | W4-TB | `w4-tb/light-1280-05-selected-clip.png` | `w4-tb/dark-1280-05-selected-clip.png` | IN-FLIGHT: TB |
| Time-range selection | W4-TB | `w4-tb/light-1280-06-range.png` | `w4-tb/dark-1280-06-range.png` | IN-FLIGHT: TB |
| Drag ghost | W4-TB | `w4-tb/light-1280-07-drag-ghost.png` | `w4-tb/dark-1280-07-drag-ghost.png` | IN-FLIGHT: TB |
| Mixer drawer | W4-TB | `w4-tb/light-1280-08-mixer.png` | `w4-tb/dark-1280-08-mixer.png` | IN-FLIGHT: TB |
| Automation lane | W4-TB | `w4-tb/light-1280-09-automation.png` | `w4-tb/dark-1280-09-automation.png` | IN-FLIGHT: TB |
| Piano roll — inline | W4-TB | `w4-tb/light-1280-10-inline-roll.png` | `w4-tb/dark-1280-10-inline-roll.png` | IN-FLIGHT: TB |
| Piano roll — full surface | W4-TB | `w4-tb/light-1280-11-roll-surface.png` | `w4-tb/dark-1280-11-roll-surface.png` | IN-FLIGHT: TB |
| Piano roll — quantize popover | W4-TB | `w4-tb/light-1280-12-roll-quantize.png` | `w4-tb/dark-1280-12-roll-quantize.png` | IN-FLIGHT: TB |
| Reduced motion (arrangement) | W4-TB | `w4-tb/light-reduced-01..05-*.png` | MISSING | IN-FLIGHT: TB |
| 1920×1080 pass | W4-TB | `w4-tb/light-1920-01..12-*.png` | `w4-tb/dark-1920-01..05-*.png` — **06–12 MISSING** | IN-FLIGHT: TB |
| Playhead, loop / punch brace | W4-TB | *(inside the ruler captures)* | *(inside the ruler captures)* | IN-FLIGHT — no dedicated capture |
| Section markers | W4-TB | `w4-tb/light-1280-03-first-light-out.png` *(incidental)* | `w4-tb/dark-1280-03-first-light-out.png` *(incidental)* | IN-FLIGHT |
| Velocity lane / scroomer | W4-TB | MISSING | MISSING | IN-FLIGHT: TB |
| Record ghost | W4-TB | MISSING | MISSING | IN-FLIGHT: TB |
| Export dialog | W4-P9 `a554c99` + W6-CAP | `w6-cap/export-dialog-light.png` | `w6-cap/export-dialog-dark.png` | DONE |
| Waveform editor modal + clip visual | W4-P9 `a554c99` + W6-CAP | `w6-cap/waveform-editor-light.png`, `audio-clip-visual-light.png` | `w6-cap/waveform-editor-dark.png`, `audio-clip-visual-dark.png` | DONE |
| Step grid (beat rig) | W4-S4 `ae92021` | `w4-s4-gate/g-10-beat-first-light.png` | `w4-s4-gate/g-18-beat-dark.png` | DONE |

## 5. Command bar

| Item | Lane / commit | Light | Dark | Status |
|---|---|---|---|---|
| Palette — open | W4-P5 `041ff72` | `w4-p5-gate/p01-palette-open--light.png` | `w4-p5-gate/p01-palette-open--dark.png` | DONE |
| Palette — hover / selection | W4-P5 `041ff72` | `w4-p5-gate/p05-palette-hover--light.png` | `w4-p5-gate/p05-palette-hover--dark.png` | DONE |
| Palette — empty state | W4-P5 `041ff72` | `w4-p5-gate/p04-palette-empty--light.png` | `w4-p5-gate/p04-palette-empty--dark.png` | DONE |
| Palette — learned vs exact rows | W4-P5 `041ff72` | `w4-p5-gate/p03-palette-learned-vs-exact--light.png` | `w4-p5-gate/p03-palette-learned-vs-exact--dark.png` | DONE |
| Palette — speak / agent row | W4-P5 `041ff72` | `w4-p5-gate/p02-palette-speak--light.png` | `w4-p5-gate/p02-palette-speak--dark.png` | DONE |
| AI panel / composer (desktop) | W4-P5 `041ff72` | `w4-p5-gate/g2-ai-desktop--light.png` | `w4-p5-gate/g2-ai-desktop--dark.png` | DONE |
| AI panel (browser tier) | W4-P5 `041ff72` | `w4-p5-gate/a01-ai-browser--light.png` | `w4-p5-gate/a01-ai-browser--dark.png` | DONE |
| AI panel — empty / disabled | W4-P5 `041ff72` | `w4-p5-gate/g2-empty-desktop--light.png`, `g2-disabled--light.png` | `w4-p5-gate/g2-empty-desktop--dark.png`, `g2-disabled--dark.png` | DONE |
| Auth chooser + detail | W4-P5 `041ff72` | `w4-p5-gate/g3-auth-chooser--light.png`, `g3-auth-detail--light.png` | `w4-p5-gate/g3-auth-chooser--dark.png`, `g3-auth-detail--dark.png` | DONE |
| Model picker | W4-P5 `041ff72` + W6-CAP | `w6-cap/cmdbar-model-picker-light.png` | `w6-cap/cmdbar-model-picker-dark.png` | DEFECT → P10 (D5: `Chip tone="success"` means "selected" — `ModelPicker.tsx:312`) |
| Sessions list | W4-P5 `041ff72` + W6-CAP | `w6-cap/cmdbar-sessions-light.png` | `w6-cap/cmdbar-sessions-dark.png` | DEFECT → P10 (D8, low: the filter field does not match the palette search) |
| Slash items | W4-P5 `041ff72` + W6-CAP | `w6-cap/cmdbar-slash-items-light.png` | `w6-cap/cmdbar-slash-items-dark.png` | DONE |
| Rewind rows | W4-P5 `041ff72` + W6-CAP | `w6-cap/cmdbar-rewind-light.png` | `w6-cap/cmdbar-rewind-dark.png` | DONE |
| Reduced motion | W4-P5 `041ff72` + W6-CAP | `w6-cap/cmdbar-reduced-motion-light.png` | `w6-cap/cmdbar-reduced-motion-dark.png` | DONE |

## 6. Settings & panels

| Item | Lane / commit | Light | Dark | Status |
|---|---|---|---|---|
| Settings — audio | W4-P9 `a554c99` | `w4-p9-gate/light-settings-audio.png` | `w4-p9-gate/dark-settings-audio.png` | DONE |
| Settings — audio advanced | W4-P9 `a554c99` | `w4-p9-gate/light-settings-audio-advanced.png` | `w4-p9-gate/dark-settings-audio-advanced.png` | DONE |
| Settings — keybindings | W4-P9 `a554c99` | `w4-p9-gate/light-settings-keybindings.png` | `w4-p9-gate/dark-settings-keybindings.png` | DONE |
| Keybindings — capture / conflict / custom / reset | W4-P9 `a554c99` | `w4-p9-gate/light-kb-capturing.png`, `light-kb-conflict.png`, `light-kb-custom.png`, `light-kb-reset-confirm.png` | `w4-p9-gate/dark-kb-*.png` (same four) | DONE |
| Settings — updates / channels | W4-P9 `a554c99` | `w4-p9-gate/light-settings-updates.png` | `w4-p9-gate/dark-settings-updates.png` | DONE |
| Settings — about | W4-P9 `a554c99` | `w4-p9-gate/light-settings-about.png` | `w4-p9-gate/dark-settings-about.png` | DONE |
| Settings — appearance / theme picker | W4-P9 `a554c99` | `w4-p9-gate/light-settings-appearance.png` | `w4-p9-gate/dark-settings-appearance.png` | DONE |
| Settings — first-run entry point | W4-S4 `ae92021` + W6-CAP | `w6-cap/settings-firstrun-light.png` | `w6-cap/settings-firstrun-dark.png` | DEFECT → P10 (D4: `.oj-set-section__title` is 11px sans) |
| Guides (LowLatencyGuide + steps) | W4-P9 `a554c99` | `w4-p9-gate/light-guide.png` | `w4-p9-gate/dark-guide.png` | DONE |
| DevLog | W4-P9 `a554c99` | `w4-p9-gate/light-devlog.png` | `w4-p9-gate/dark-devlog.png` | DONE |
| Plugins panel | W4-P9 `a554c99` | `w4-p9-gate/light-plugins.png` | `w4-p9-gate/dark-plugins.png` | DONE |
| Audio health | W4-P9 `a554c99` | `w4-p9-gate/light-audiohealth.png` | `w4-p9-gate/dark-audiohealth.png` | DONE |
| Issue reporter | W4-P9 `a554c99` | `w4-p9-gate/light-issuereporter.png` | `w4-p9-gate/dark-issuereporter.png` | DONE |
| Panels — reduced motion | W4-P9 `a554c99` + W6-CAP | `w6-cap/panels-reduced-motion-devlog-light.png`, `panels-reduced-motion-keybindings-light.png` | `w6-cap/panels-reduced-motion-devlog-dark.png`, `panels-reduced-motion-keybindings-dark.png` | DONE |
| MIDI device browser | W5-P8 `ab23a31` + W6-CAP | `w6-cap/midi-browser-light.png` | `w6-cap/midi-browser-dark.png` | DONE |
| MIDI device card + connection toast | W5-P8 `ab23a31` + W6-CAP | `w6-cap/midi-device-card-light.png`, `midi-connection-toast-light.png` | `w6-cap/midi-device-card-dark.png`, `midi-connection-toast-dark.png` | DONE |
| Bench | W4-P9 `a554c99` + W6-CAP | `w6-cap/bench-light.png` | `w6-cap/bench-dark.png` | DONE |
| Relink-samples dialog | W4-P9 `a554c99` | UNREACHABLE | UNREACHABLE | **UNREACHABLE** — `RelinkSamplesDialog.tsx` is imported by nothing (dead code). Wire it or delete it (covenant #8), then capture. → P10 |

## 7. Design system (`packages/oj-ui`)

44 folders → 60 exported React components. Component-level gates captured both themes.

| Component | Lane / commit | Light | Dark | Status |
|---|---|---|---|---|
| Button (variants / states / loading / hover) | W3-P1 `3473001` | `w3-p1-gate/button-variants--light.png`, `button-states--light.png`, `button-loading--light.png`, `button-primary--hover--light.png` | same four `--dark.png` | DONE |
| IconButton | W3-P1 `3473001` | `w3-p1-gate/iconbutton-variants--light.png`, `iconbutton-disabled--light.png` | same `--dark.png` | DONE |
| Input (+ mono) | W3-P1 `3473001` | `w3-p1-gate/input-states--light.png`, `input-mono--light.png` | same `--dark.png` | DONE |
| Select | W3-P1 `3473001` | `w3-p1-gate/select-states--light.png` | `select-states--dark.png` | DONE |
| Textarea | W3-P1 `3473001` | `w3-p1-gate/textarea-states--light.png` | `textarea-states--dark.png` | DONE |
| Field | W3-P1 `3473001` | `w3-p1-gate/field-states--light.png` | `field-states--dark.png` | DONE |
| Slider | W3-P1 `3473001` | `w3-p1-gate/slider-states--light.png`, `slider-rest/hover/focus--light.png` | same `--dark.png` | DONE |
| Toggle | W3-P1 `3473001` | `w3-p1-gate/toggle-states--light.png`, `toggle--hover--light.png` | same `--dark.png` | DONE |
| SegmentedControl / Tabs | W3-P1 `3473001` | `w3-p1-gate/segmented-horizontal--light.png`, `segmented-vertical--light.png` | same `--dark.png` | DONE |
| **Knob** | W3-P1 `3473001` | `w3-p1-gate/knob-states--light.png`, `knob-sizes--light.png`, `knob-sweep--light.png`, `knob-linear-vs-log--light.png` | same four `--dark.png` | DONE |
| ValueScrubber | W3-P1 `3473001` | `w3-p1-gate/valuescrubber-editable--light.png`, `valuescrubber-readonly--light.png` | same `--dark.png` | DONE |
| Focus rings (button/input/knob/seg/slider/toggle) | W3-P1 `3473001` | `w3-p1-gate/focus-*--light.png` | `w3-p1-gate/focus-*--dark.png` | DONE |
| Surface | W3-P2 `02dfc9b` | `w3-p2-gate/surface--elevations--light.png` | `surface--elevations--dark.png` | DONE |
| Modal | W3-P2 `02dfc9b` | `w3-p2-gate/modal--default--light.png` | `modal--default--dark.png` | DONE |
| Menu (dropdown + context) | W3-P2 `02dfc9b` | `w3-p2-gate/menu--dropdown--light.png`, `menu--context-menu--light.png` | same `--dark.png` | DONE |
| Callout | W3-P2 `02dfc9b` | `w3-p2-gate/callout--variants--light.png` | `callout--variants--dark.png` | DONE |
| Banner | W3-P2 `02dfc9b` | `w3-p2-gate/banner--tones--light.png` | `banner--tones--dark.png` | DONE |
| Chip (no dot) | W3-P2 `02dfc9b` | `w3-p2-gate/chip--tones--light.png`, `chip--filter-chips--light.png`, `chip--with-glyph-and-count--light.png` | same three `--dark.png` | DONE |
| StatusDot | W3-P2 `02dfc9b` | `w3-p2-gate/status-dot--statuses--light.png` | `status-dot--statuses--dark.png` | DONE |
| Kbd | W3-P2 `02dfc9b` | `w3-p2-gate/kbd--variants--light.png` | `kbd--variants--dark.png` | DONE |
| Spinner | W3-P2 `02dfc9b` | `w3-p2-gate/spinner--sizes--light.png` | `spinner--sizes--dark.png` | DONE |
| ProgressBar | W3-P2 `02dfc9b` | `w3-p2-gate/progress-bar--tones--light.png`, `--indeterminate--light.png` | same `--dark.png` | DONE |
| PanelHeader | W3-P2 `02dfc9b` | `w3-p2-gate/panel-header--everything--light.png` | `panel-header--everything--dark.png` | DONE |
| List / ListRow | W3-P2 `02dfc9b`, W4-P3 `99afb72` | `w3-p2-gate/list-row--states--light.png`, `w4-p3-gate/primitives--listrow--with-actions--light.png` | same `--dark.png` | DONE |
| CodeBlock | W3-P2 `02dfc9b` | `w3-p2-gate/code-block--variants--light.png` | `code-block--variants--dark.png` | DONE |
| Swatch | W3-P2 `02dfc9b` | `w3-p2-gate/swatch--states--light.png`, `swatch--states-focus--light.png` | same `--dark.png` | DONE |
| NodeShell | W3-S3 `41060df` | `w3-s3-gate/light-03-nodeshell.png` | `w3-s3-gate/dark-03-nodeshell.png` | DONE |
| Port / PortRow (socket wells) | W3-S3 `41060df` | `w3-s3-gate/light-02-node-closeup.png`, `w5-p6-gate/ui017-port-ring.png` | `w3-s3-gate/dark-02-node-closeup.png` | DONE |
| NodeFrame | W3-S3 `41060df` | `w3-s3-gate/light-05-dragging.png` | `w3-s3-gate/dark-05-dragging.png` | DONE |
| Cable | W3-S3 `41060df` | `w3-s3-gate/light-12-cables.png` | `w3-s3-gate/dark-07-selected-cable.png` | DONE |
| KeyTile | W4-P3 `99afb72` | `w4-p3-gate/composites--keytile--variants--light.png`, `--states--light.png`, `--pad-grid--light.png`, `--piano-octave--light.png` | same four `--dark.png` | DONE |
| Waveform | W4-P3 `99afb72` | `w4-p3-gate/composites--waveform--default--light.png`, `--heights--light.png`, `--empty--light.png` | same `--dark.png` | DONE |
| WaveformView | W4-P3 `99afb72` | `w4-p3-gate/composites--waveformview--states--light.png`, `--single--light.png` | same `--dark.png` | DONE |
| WaveformCanvas | W4-P3 `99afb72` | `w4-p3-gate/waveform-canvas--peaks--light.png`, `--missing--light.png` | same `--dark.png` | DONE |
| Marquee | W4-P3 `99afb72` | `w4-p3-gate/primitives--marquee--sizes--light.png` | same `--dark.png` | DONE |
| OffscreenPointer | W4-P3 `99afb72` | `w4-p3-gate/primitives--offscreenpointer--directions--light.png` | same `--dark.png` | DONE |
| TimeRuler | W4-P3 `99afb72` | `w4-p3-gate/time-ruler--bars--light.png` | `time-ruler--bars--dark.png` | DONE |
| LaneButton | W4-P3 `99afb72` | `w4-p3-gate/lane-button--state-matrix--light.png`, `rm-lanebutton--light.png` | same `--dark.png` | DONE |
| DeviceSelect | W4-P3 `99afb72` | `w4-p3-gate/composites--deviceselect--*--light.png` (4) | same four `--dark.png` | DONE |
| EditableLabel | W4-P3 `99afb72` | `w4-p3-gate/composites--editablelabel--*--light.png` (4) | same four `--dark.png` | DONE |
| **Meter** | W4-S4 `ae92021` + W6-CAP | `w6-cap/meter-light.png`, `meter-clipping-light.png` | `w6-cap/meter-dark.png`, `meter-clipping-dark.png` | DONE |
| **TransportPill** | W4-S4 `ae92021` + W6-CAP | `w6-cap/transportpill-light.png`, `transportpill-recording-light.png` | `w6-cap/transportpill-dark.png`, `transportpill-recording-dark.png` | DEFECT → P10 (D6: 2px `--accent-danger` record-dot border, `TransportPill.css:138`) |
| **ParamRow** | W4-P3 `99afb72` + W6-CAP | `w6-cap/paramrow-light.png`, `designsync-paramrow-light.png` | `w6-cap/paramrow-dark.png`, `designsync-paramrow-dark.png` | DONE |
| Icons (12) | W3-P2 `02dfc9b` + W6-CAP | `w6-cap/icons-light.png` | `w6-cap/icons-dark.png` | DONE |
| Ladle catalog + theme switcher | W1-S0S1 `82ed464`, W2-S2 `a0ac294` + W6-CAP | `w6-cap/ladle-catalog-light.png`, `ladle-theme-switcher-light.png` | `w6-cap/ladle-catalog-dark.png`, `ladle-theme-switcher-dark.png` | DONE — Ladle's own sidebar/addon chrome is third-party and does not read our tokens (expected) |
| Figma Code Connect examples | W3/W4 lanes | n/a (source artifacts) | n/a | **PARTIAL — 7 of 44 folders unmapped**: `Knob`, `Meter`, `TransportPill`, `ParamRow`, `LaneButton`, `TimeRuler`, `WaveformCanvas` |
| `component-map.json` regen | W6-DOCS | n/a | n/a | **NOT DONE** — stale by 7 folders; needs `bun run gen:component-map` (a full `ladle build`) |

## 8. Outside `src/`

| Item | Lane / commit | Light | Dark | Status |
|---|---|---|---|---|
| `index.html` boot shell | W2-S2 `a0ac294` | `w2-gate/light-00-boot.png` | `w2-gate/dark-00-boot.png` | DONE |
| `public/download` page | W6-CAP (captured, not fixed) | `w6-cap/download-page-light.png` | `w6-cap/download-page-dark.png` | **DEFECT (high) → web-surfaces fix lane** — still the retired Living Sketchbook: 2px ink borders, `2px 3px 0`/`3px 4px 0`/`2px 2px 0` offset shadows, literal `#4A90C2`, three text runs at 3.04–3.45:1, and `<meta color-scheme="light">` so there is **no dark theme** |
| `apps/docs` site (fonts, hero, custom.css) | W1-S0S1 `82ed464` + W6-DOCS + W6-CAP | `w6-cap/docs-site-hero-light.png`, `docs-site-page-light.png` | `w6-cap/docs-site-hero-dark.png`, `docs-site-page-dark.png` | **DEFECT (high) → web-surfaces fix lane** — `apps/docs/src/styles/custom.css` still carries the retired palette + the three zero-blur shadows, wired into `--sl-shadow-*`; 2px borders and four 3.04:1 runs measured |
| `.design-sync` previews | W1-S0S1 `82ed464` + W6-CAP | `w6-cap/designsync-{button,chip,cable,port,paramrow,index}-light.png` | the same six `-dark.png` | DONE — rendered with `ladle serve --stories '.design-sync/previews/**/*.tsx'`; no DNA or contrast findings |
| `.impeccable/design.json` | W6-DOCS | n/a | n/a | DONE — regenerated from the new `DESIGN.md` |
| `DESIGN.md` | W6-DOCS | n/a | n/a | DONE — replaced wholesale |
| `PRODUCT.md` (brand, anti-references, a11y) | W6-DOCS | n/a | n/a | DONE |
| `README.md` (the look, first run) | W6-DOCS | n/a | n/a | DONE |
| `docs/design-figma-handoff.md` | W6-DOCS | n/a | n/a | DONE |
| `docs/design-system-migration-plan.md` | W6-DOCS | n/a | n/a | DONE — "New DNA status" appended |
| `docs/node-standards.md`, `docs/creating-nodes.md` | W6-DOCS | n/a | n/a | DONE — visual sections rewritten |
| `packages/oj-ui/README.md`, `packages/oj-tokens/README.md` | W6-DOCS | n/a | n/a | DONE |
| `THIRD-PARTY-LICENSES.md` / `NOTICE` (Outfit OFL) | W1-S0S1 `82ed464` | n/a | n/a | DONE |
| Visual-regression baselines (both themes) | W6-E2E | MISSING | MISSING | **NOT STARTED** |

---
## The MISSING list

Rewritten by **W6-CAP** (2026-08-29). Everything reachable outside the two lanes still
running has been captured in both themes — 52 rows, 104 images, under
`.scratch/w6-cap/`; the judgements are in [W6-CAP-REPORT.md](W6-CAP-REPORT.md).
**13 rows remain**, and 11 of them belong to lanes that have not landed yet.

### Still owed — a capture (11 rows, all owned by a running lane)

1. `looper` faceplate — light + dark *(P7)*
2. `sampler` faceplate — light + dark *(P7)*
3. `sampler-visual` faceplate — light + dark *(P7)*
4. `library` faceplate incl. the two-panel file browser — light + dark *(P7)*
5. Resize handles — **dark** *(P7 — `LibraryNode.tsx:1728` is the only `ResizeHandles` call
   site, so this row was mis-attributed to W4-P9)*
6. Piano-roll velocity lane + scroomer — light + dark *(TB)*
7. Timeline record ghost — light + dark *(TB)*
8. Timeline playhead + loop/punch brace — dedicated, light + dark *(TB)*
9. Section markers — dedicated, light + dark *(TB)*
10. Timeline 1920×1080 — **dark** frames 06–12 (7 captures) *(TB)*
11. Timeline reduced motion — **dark** *(TB)*

### Unreachable until code moves (1 row)

12. **Relink-samples dialog.** `src/components/Dialogs/RelinkSamplesDialog.tsx` is imported
    by nothing — `grep -rn RelinkSamplesDialog src/` returns only the file itself. There is
    no app state that renders it, so there is nothing to photograph. Wire it or delete it
    (covenant #8: every production line is used), then capture. → **P10**

### Not a screenshot — still blocks the gate (1 row + 5 carried items)

13. Visual-regression baselines, both themes *(W6-E2E)*

Carried unchanged from the previous pass:

- **`component-map.json` (repo root) is stale and was NOT regenerated.** It reports
  `coverage: { components: 53, withStory: 48, withFigma: 53 }` and is missing exactly seven
  folders — `Knob`, `LaneButton`, `Meter`, `ParamRow`, `TimeRuler`, `TransportPill`,
  `WaveformCanvas`. Regenerating runs `bun run gen:component-map`, which shells out to a
  full `ladle build`. **Run it on a quiet machine before the gate closes.**
- **7 Code Connect mappings** missing: `Knob`, `Meter`, `TransportPill`, `ParamRow`,
  `LaneButton`, `TimeRuler`, `WaveformCanvas`. *(W6-CAP confirms the same seven are absent
  from `.design-sync/previews/`, which is why they could not be captured from there.)*
- **Figma masters** were built against the retired sketchbook construction and need a
  Tokens Studio re-pull plus rebuilds where construction changed (flat Button, socket Port,
  dotless Chip, barless Callout/Banner, hairline borders).
- **Two stale-prose sites**, both harmless at runtime, both advertising the retired
  language: `packages/oj-ui/src/components/IconButton/IconButton.tsx` JSDoc ("hand-drawn ink
  border, hard offset feel") and `src/components/EngineHealthDot/EngineHealthDot.tsx` JSDoc
  ("a Caveat label").
- **One surviving port-glow declaration**: `src/components/Nodes/SamplerVisual.css`
  (`.sampler-key-port.connected { box-shadow: 0 0 4px … }`, plus a hover `scale(1.3)` +
  `brightness(1.2)`). Dead CSS, but it violates the Nothing-Glows rule and sits in **P7's**
  files. Delete it with the Sampler pass.

### Defects W6-CAP opened (captured, judged, NOT fixed — this lane makes no source edits)

Full detail, with file:line and measured numbers, in
[W6-CAP-REPORT.md](W6-CAP-REPORT.md) § 2.

| # | Sev | What | Owner |
|---|---|---|---|
| D1 | **high** | `public/download/download.css` is still the retired Living Sketchbook — 2px ink borders, three zero-blur offset shadows, the retired `#4A90C2`, three text runs at 3.04–3.45:1, and **no dark theme** (`<meta color-scheme="light">`) | web-surfaces fix lane |
| D2 | **high** | `apps/docs/src/styles/custom.css` — the same retired palette and the same three zero-blur shadows, wired into `--sl-shadow-*`; 2px borders + four 3.04:1 runs measured on the hero and a docs page | web-surfaces fix lane |
| D3 | med | `.is-agent-pending` is dead on **10 of 20** node components — every one that renders its own `NodeShell` omits `agentPending` (`MathNode`, `SpeakerNode`, `MicrophoneNode`, `ContainerNode`, `SongNode`, `CanvasIONode`, `PortPanelNode`, + P7's `LibraryNode` / `LooperNode` / `SamplerNode` / `SamplerVisualNode`) | P10 (+ P7 for four files) |
| D4 | med | The 13px sans floor is broken in four shipped surfaces (11px `--text-xs` in `var(--font-sans)`): `SettingsPanel.css:105`, `SafeModeScreen.css:143`, `HelpPanel.css:43`, `PluginWindowShell.css:46,:66` | P10 |
| D5 | med | `ModelPicker.tsx:312` uses `<Chip tone="success">current</Chip>` — `--accent-success` meaning "selected", which the Signal-Not-Brand Rule forbids | P10 |
| D6 | low | `TransportPill.css:138` — `border: 2px solid var(--accent-danger)` on the record dot (1.5px is the maximum) | P10 / oj-ui |
| D7 | low | `AppErrorBoundary.css:145` — dark `.app-error-title` is `#F84B4B`, not the dark `--danger-ink` `#FF7771` (4.80:1 vs 6.39:1); the file's contract is a hand-kept transcription of the token palette. Also an 18px size that is not in the scale | P10 |
| D8 | low | The Resume-a-session filter field is a narrow left-aligned box where every other palette surface uses a full-bleed input | P10 |
| D9 | doc | DESIGN.md contradicts itself: §3 calls Field labels "the one 12px sans exception", §5 specifies `Chip` at 12px/600, and `.oj-chip__label` measures 12px sans everywhere | W6-DOCS |

---

## Gate verdict as of 2026-08-29 (after W6-CAP)

**The coverage gate still cannot close, but the hole is now small and named.** Two capture
lanes are open — **P7** (not started) and **TB** (built, uncommitted) — and they own 11 of
the 13 remaining rows. **W6-E2E** owns the twelfth (visual-regression baselines); the
thirteenth is unreachable until dead code is resolved.

What changed: the node registry is no longer the biggest hole. `strings`, `keys`, `winds`,
`pan`, `width`, `canvas-input` and `canvas-output` are captured in both themes, so **32 of
36 node types** now have an image and the four that do not are all P7's. Every shell,
command-bar, panel, dialog and design-system row outside those two lanes has a light and a
dark capture.

What replaced it: **the retired Living Sketchbook is still shipping on the two public web
surfaces** (`public/download` and `apps/docs`). Those are the loudest remaining defects and
they are outside `src/`, which is exactly why five waves of redesign never touched them.
Inside `src/` and `packages/oj-ui`, 104 captures found **zero** Caveat faces, **zero**
glows outside `.oj-cable`, **zero** zero-blur offset shadows and **one** ≥2px border (D6).
