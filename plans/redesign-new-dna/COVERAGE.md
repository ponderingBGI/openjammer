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
| **W5-P8** | *uncommitted* | keyboard / instrument / MIDI / MiniLab family (working tree) |
| **W5-P10** | *not started* | canvas/app defects + dead code |
| **W6-E2E** | *not started* | acceptance tests + visual-regression baselines |

---

## 1. Shell

| Item | Lane / commit | Light | Dark | Status |
|---|---|---|---|---|
| Topbar | W4-S4 `ae92021` | `w4-s4-gate/g-14-topbar-light.png` | `w5-p6-gate/00-canvas-dark.png` *(incidental)* | DONE |
| Transport pill | W4-S4 `ae92021` | `w5-p6-gate/00-canvas-light.png` *(incidental)* | `w5-p6-gate/00-canvas-dark.png` *(incidental)* | DONE — no dedicated capture |
| Breadcrumbs | W4-S4 `ae92021` | `w5-p6-gate/01-container-inside-light.png` *(incidental)* | `w5-p6-gate/01-container-inside-dark.png` *(incidental)* | DONE |
| Surface switcher / sky band | W4-S4 `ae92021` + W4-TB | `w4-tb/light-1280-05-selected-clip.png` | `w4-tb/dark-1280-05-selected-clip.png` | IN-FLIGHT (TB) |
| Onboarding — step 1 (experience) | W4-S4 `ae92021` | `w4-s4-gate/g-01-onboarding-light.png` | `w4-s4-gate/g-13-onboarding-dark.png` | DONE |
| Onboarding — step 2 (goal) | W4-S4 `ae92021` | `w4-s4-gate/g-02-onboarding-goal.png` | `w4-s4-gate/g-17-onboarding-dark.png` | DONE |
| Onboarding — step 3 (theme) | W4-S4 `ae92021` | `w4-s4-gate/g-03-onboarding-theme.png` | `w4-s4-gate/g-16-native-theme-step.png` | DONE |
| Onboarding — reduced motion | W4-S4 `ae92021` | `w4-s4-gate/g-12-reduced-motion.png` | MISSING | DONE |
| Help panel | W4-P9 `a554c99` | `w2-gate/light-01-canvas-help.png` *(pre-P9)* | `w2-gate/dark-01-canvas-help.png` *(pre-P9)* | DONE — **no post-redesign capture** |
| Toasts (Sonner) | W4-P9 `a554c99` | `w4-s4-gate/g-22-toast-vs-palette.png` | MISSING | DONE |
| PWA update prompt | W4-P9 `a554c99` | MISSING | MISSING | DONE — unverified |
| Latency chip + popover | W4-S4 `ae92021` | MISSING | `w4-tb/dark-1280-05-selected-clip.png` *(incidental)* | DONE |
| Engine-health dot | W4-S4 `ae92021` | `w4-s4-gate/g-14-topbar-light.png` *(incidental)* | `w5-p6-gate/00-canvas-dark.png` *(incidental)* | DONE |
| Offline chip | W4-S4 `ae92021` | MISSING | MISSING | DONE — unverified |
| Project chip | W4-S4 `ae92021` | `w4-tb/light-1280-05-selected-clip.png` *(incidental)* | `w4-tb/dark-1280-05-selected-clip.png` *(incidental)* | DONE |
| Collab control + presence overlay | W4-P9 `a554c99` | `w4-p9-gate/light-collab.png` | `w4-p9-gate/dark-collab.png` | DONE |
| Error boundary | W4-P9 `a554c99` | MISSING | MISSING | DONE — unverified |
| Safe-mode screen | W4-P9 `a554c99` | MISSING | MISSING | DONE — unverified |
| Plugin window shell | W4-P9 `a554c99` | MISSING | MISSING | DONE — unverified |

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
| Cables — universal | W3-S3 `41060df` | MISSING | MISSING | DONE — unverified |
| Ghost mode | W3-S3 `41060df` | `w3-s3-gate/light-08-ghost.png` | `w3-s3-gate/dark-08-ghost.png` | DONE |
| Context menu (→ oj-ui Menu) | W4-P5 `041ff72` | `w4-p5-gate/c01-menu-root--light.png` | `w4-p5-gate/c01-menu-root--dark.png` | DONE |
| Context menu — submenu / edge flips | W4-P5 `041ff72` | `w4-p5-gate/c02-menu-submenu--light.png`, `c03-menu-corner-*--light.png` | `w4-p5-gate/c02-menu-submenu--dark.png`, `c03-menu-corner-*--dark.png` | DONE |
| Node frame — selection | W3-S3 `41060df` | `w3-s3-gate/light-04-selected.png` | `w3-s3-gate/dark-04-selected.png` | DONE |
| Node frame — dragging | W3-S3 `41060df` | `w3-s3-gate/light-05-dragging.png` | `w3-s3-gate/dark-05-dragging.png` | DONE |
| Node frame — agent-pending | W3-S3 `41060df` | MISSING | MISSING | DONE — unverified |
| Resize handles | W4-P9 `a554c99` | `w3-s3-gate/light-11-after-resize.png` *(incidental)* | MISSING | DONE |
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
| `canvas-input` | W5-P6 `79c71b4` | `w5-p6-gate/01-container-inside-light.png` *(incidental)* | `w5-p6-gate/01-container-inside-dark.png` *(incidental)* | DONE — no dedicated capture |
| `canvas-output` | W5-P6 `79c71b4` | `w5-p6-gate/01-container-inside-light.png` *(incidental)* | `w5-p6-gate/01-container-inside-dark.png` *(incidental)* | DONE — no dedicated capture |
| `keyboard` | W5-P8 *(uncommitted)* | `w5-p8-gate/g-d1-keyboard-light.png` | `w5-p8-gate/g-d1-keyboard-dark.png` | IN-FLIGHT: P8 (gate running) |
| `keyboard-visual` | W5-P8 *(uncommitted)* | `w5-p8-gate/g-d1-keyboard-visual-light.png` | `w5-p8-gate/g-d1-keyboard-visual-dark.png` | IN-FLIGHT: P8 (gate running) |
| `keyboard-key` | W5-P8 *(uncommitted)* | `w5-p8-gate/g-d2-keys-2x-light.png` *(incidental)* | `w5-p8-gate/g-d2-keys-2x-dark.png` *(incidental)* | IN-FLIGHT: P8 |
| `instrument` | W5-P8 *(uncommitted)* | `w5-p8-gate/g-d1-instrument-light.png` | `w5-p8-gate/g-d1-instrument-dark.png` | IN-FLIGHT: P8 (gate running) |
| `instrument-visual` | W5-P8 *(uncommitted)* | `w5-p8-gate/g-i3-instrument-visual-light.png` | `w5-p8-gate/g-i3-instrument-visual-dark.png` | IN-FLIGHT: P8 (gate running) |
| `midi` | W5-P8 *(uncommitted)* | `w5-p8-gate/g-i1-midi-light.png` | `w5-p8-gate/g-i1-midi-dark.png` | IN-FLIGHT: P8 (gate running) |
| `midi-visual` | W5-P8 *(uncommitted)* | `w5-p8-gate/g-i3-midi-visual-light.png` | `w5-p8-gate/g-i3-midi-visual-dark.png` | IN-FLIGHT: P8 (gate running) |
| `minilab-3` | W5-P8 *(uncommitted)* | `w5-p8-gate/g-i1-minilab-3-light.png` | `w5-p8-gate/g-i1-minilab-3-dark.png` | IN-FLIGHT: P8 (gate running) |
| `minilab3-visual` | W5-P8 *(uncommitted)* | `w5-p8-gate/g-j1-minilab3-body-light.png`, `g-j1-minilab3-panel-light.png` | `w5-p8-gate/g-j1-minilab3-body-dark.png`, `g-j1-minilab3-panel-dark.png` | IN-FLIGHT: P8 (gate running) |
| `looper` | W5-P7 | MISSING | MISSING | **NOT STARTED** (P7) |
| `sampler` | W5-P7 | MISSING | MISSING | **NOT STARTED** (P7) |
| `sampler-visual` | W5-P7 | MISSING | MISSING | **NOT STARTED** (P7) |
| `library` (two-panel browser) | W5-P7 | MISSING | MISSING | **NOT STARTED** (P7) |
| `pan` | — | MISSING | MISSING | **NOT STARTED** — and unplaceable: in no `nodeCategories` entry (MASTER-PLAN follow-up, P10 scope) |
| `width` | — | MISSING | MISSING | **NOT STARTED** — same registry gap as `pan` |
| `piano` | — | MISSING | MISSING | **NOT STARTED** — legacy fixed-instrument type |
| `cello` | — | MISSING | MISSING | **NOT STARTED** — legacy fixed-instrument type |
| `electricCello` | — | MISSING | MISSING | **NOT STARTED** — legacy fixed-instrument type |
| `violin` | — | MISSING | MISSING | **NOT STARTED** — legacy fixed-instrument type |
| `saxophone` | — | MISSING | MISSING | **NOT STARTED** — legacy fixed-instrument type |
| `strings` | — | MISSING | MISSING | **NOT STARTED** — legacy fixed-instrument type |
| `keys` | — | MISSING | MISSING | **NOT STARTED** — legacy fixed-instrument type |
| `winds` | — | MISSING | MISSING | **NOT STARTED** — legacy fixed-instrument type |
| `AutoParamPanel` (in-node Knob rack) | W5-P6 `79c71b4` | `w5-p6/07-autoparam-light.png` | `w5-p6/07-autoparam-dark.png` | DONE |
| Node states — selected / refusal / hover-connect | W5-P6 `79c71b4` | `w5-p6-gate/state-selected-speaker-light.png`, `state-refusal-math-light.png`, `w5-p6/state-hover-connecting-math-light.png` | `w5-p6-gate/state-selected-speaker-dark.png`, `state-refusal-math-dark.png`, `w5-p6/state-hover-connecting-math-dark.png` | DONE |

> **The eight legacy fixed-instrument types** (`piano` … `winds`) plus `keyboard-key` were
> never assigned a taste-pass owner in any wave. They are either live surfaces that must be
> redesigned, or dead types that covenant #8 says to delete. **Decide before the gate
> closes; do not let them pass by omission.**

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
| Export dialog | W4-P9 `a554c99` | MISSING | MISSING | DONE — unverified |
| Waveform editor modal + clip visual | W4-P9 `a554c99` | MISSING | MISSING | DONE — unverified |
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
| Model picker | W4-P5 `041ff72` | MISSING | MISSING | DONE — unverified |
| Sessions list | W4-P5 `041ff72` | MISSING | MISSING | DONE — unverified |
| Slash items | W4-P5 `041ff72` | MISSING | MISSING | DONE — unverified |
| Rewind rows | W4-P5 `041ff72` | MISSING | MISSING | DONE — unverified |
| Reduced motion | W4-P5 `041ff72` | `w4-p5-gate/r01-reduced-motion.png` | MISSING | DONE |

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
| Settings — first-run entry point | W4-S4 `ae92021` | `w4-s4-gate/g-20-settings-firstrun.png` | MISSING | DONE |
| Guides (LowLatencyGuide + steps) | W4-P9 `a554c99` | `w4-p9-gate/light-guide.png` | `w4-p9-gate/dark-guide.png` | DONE |
| DevLog | W4-P9 `a554c99` | `w4-p9-gate/light-devlog.png` | `w4-p9-gate/dark-devlog.png` | DONE |
| Plugins panel | W4-P9 `a554c99` | `w4-p9-gate/light-plugins.png` | `w4-p9-gate/dark-plugins.png` | DONE |
| Audio health | W4-P9 `a554c99` | `w4-p9-gate/light-audiohealth.png` | `w4-p9-gate/dark-audiohealth.png` | DONE |
| Issue reporter | W4-P9 `a554c99` | `w4-p9-gate/light-issuereporter.png` | `w4-p9-gate/dark-issuereporter.png` | DONE |
| Panels — reduced motion | W4-P9 `a554c99` | `w4-p9-gate/reduced-motion-devlog.png`, `reduced-motion-keybindings.png` | MISSING | DONE |
| MIDI device browser | W5-P8 *(uncommitted)* | `w5-p8-gate/g-h1-midi-browser.png` | MISSING | IN-FLIGHT: P8 (gate running) |
| MIDI device card + connection toast | W5-P8 *(uncommitted)* | `w5-p8-gate/g-h2-after-card-click.png`, `g-h1-add-midi-nowebmidi.png` | MISSING | IN-FLIGHT: P8 |
| Bench | W4-P9 `a554c99` | MISSING | MISSING | DONE — unverified |
| Relink-samples dialog | W4-P9 `a554c99` | MISSING | MISSING | DONE — unverified |

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
| **Meter** | W4-S4 `ae92021` | `w5-p6-gate/speaker-playing-light.png` *(incidental)* | MISSING | DONE — **no dedicated capture** |
| **TransportPill** | W4-S4 `ae92021` | `w5-p6-gate/00-canvas-light.png` *(incidental)* | `w5-p6-gate/00-canvas-dark.png` *(incidental)* | DONE — **no dedicated capture** |
| **ParamRow** | W4-P3 `99afb72` | `w5-p6/07-autoparam-light.png` *(incidental)* | `w5-p6/07-autoparam-dark.png` *(incidental)* | DONE — **no dedicated capture** |
| Icons (12) | W3-P2 `02dfc9b` | MISSING | MISSING | DONE — unverified |
| Ladle catalog + theme switcher | W1-S0S1 `82ed464`, W2-S2 `a0ac294` | MISSING | MISSING | DONE — unverified |
| Figma Code Connect examples | W3/W4 lanes | n/a (source artifacts) | n/a | **PARTIAL — 7 of 44 folders unmapped**: `Knob`, `Meter`, `TransportPill`, `ParamRow`, `LaneButton`, `TimeRuler`, `WaveformCanvas` |
| `component-map.json` regen | W6-DOCS | n/a | n/a | **NOT DONE** — stale by 7 folders; needs `bun run gen:component-map` (a full `ladle build`) |

## 8. Outside `src/`

| Item | Lane / commit | Light | Dark | Status |
|---|---|---|---|---|
| `index.html` boot shell | W2-S2 `a0ac294` | `w2-gate/light-00-boot.png` | `w2-gate/dark-00-boot.png` | DONE |
| `public/download` page | — | MISSING | MISSING | **NOT STARTED** |
| `apps/docs` site (fonts, hero, custom.css) | W1-S0S1 `82ed464` + W6-DOCS | MISSING | MISSING | **NOT STARTED** (copy updated by W6-DOCS; no render captured) |
| `.design-sync` previews | W1-S0S1 `82ed464` | MISSING | MISSING | **NOT STARTED** |
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

Work straight down this list. Each line is one capture (or one decision).

### Blocking — the row's whole subject has no image in either theme

1. `looper` faceplate — light + dark *(P7 not started)*
2. `sampler` faceplate — light + dark *(P7)*
3. `sampler-visual` faceplate — light + dark *(P7)*
4. `library` faceplate incl. the two-panel file browser — light + dark *(P7)*
5. `pan` faceplate — light + dark *(also unplaceable; registry fix first)*
6. `width` faceplate — light + dark *(same)*
7. `piano`, `cello`, `electricCello`, `violin`, `saxophone`, `strings`, `keys`, `winds` —
   **8 node types, 16 captures**, no owner in any wave. **Decide first: redesign or delete.**
8. `keyboard-key` faceplate — light + dark *(only visible inside a keys grid today)*
9. Universal-kind cable — light + dark
10. Node frame `.is-agent-pending` — light + dark
11. Export dialog — light + dark
12. Waveform editor modal + `AudioClipVisual` + `ClipDragLayer` — light + dark
13. Piano-roll velocity lane + scroomer — light + dark
14. Timeline record ghost — light + dark
15. Bench panel — light + dark
16. Relink-samples dialog — light + dark
17. Command bar: model picker — light + dark
18. Command bar: sessions list — light + dark
19. Command bar: slash items — light + dark
20. Command bar: rewind rows — light + dark
21. PWA update prompt — light + dark
22. Offline chip — light + dark
23. `AppErrorBoundary` — light + dark
24. Safe-mode screen — light + dark
25. Plugin window shell — light + dark
26. Icons (all 12, one sheet) — light + dark
27. Ladle catalog + its theme switcher — light + dark
28. `public/download` page — light + dark
29. `apps/docs` site (hero + a docs page) — light + dark
30. `.design-sync` preview cards — light + dark
31. Visual-regression baselines, both themes *(W6-E2E)*

### Half-covered — one theme, or only an incidental shot

32. `Meter` — dedicated component capture, light + dark
33. `TransportPill` — dedicated component capture, light + dark
34. `ParamRow` — dedicated component capture, light + dark
35. Transport pill in situ — dedicated light + dark
36. Topbar — **dark** dedicated capture
37. Latency chip + popover — **light**
38. Help panel — post-P9 capture, light + dark *(current shots are from the W2 token swap)*
39. Toasts — **dark**
40. Resize handles — **dark**
41. `canvas-input` / `canvas-output` — dedicated faceplate captures, light + dark
42. MIDI device browser / device card / connection toast — **dark** (3 captures)
43. Settings first-run entry point — **dark**
44. Timeline 1920×1080 — **dark** frames 06–12 (7 captures)
45. Timeline reduced motion — **dark**
46. Onboarding reduced motion — **dark**
47. Command bar reduced motion — **dark**
48. Panels reduced motion — **dark**
49. Timeline playhead + loop/punch brace — dedicated captures, light + dark
50. Section markers — dedicated captures, light + dark

### Not a screenshot — still blocks the gate

51. **`component-map.json` (repo root) is stale and was NOT regenerated.** It reports
    `coverage: { components: 53, withStory: 48, withFigma: 53 }` and is missing exactly
    seven folders — `Knob`, `LaneButton`, `Meter`, `ParamRow`, `TimeRuler`,
    `TransportPill`, `WaveformCanvas`. Regenerating it runs `bun run gen:component-map`,
    which shells out to a full `ladle build`; that was deliberately not run here because
    the host is memory-constrained and four other lanes were building at the time. **Run
    it on a quiet machine before the gate closes.**
52. **7 Code Connect mappings** missing: `Knob`, `Meter`, `TransportPill`, `ParamRow`,
    `LaneButton`, `TimeRuler`, `WaveformCanvas`.
53. **Figma masters** were built against the retired sketchbook construction and need a
    Tokens Studio re-pull plus rebuilds where construction changed (flat Button, socket
    Port, dotless Chip, barless Callout/Banner, hairline borders).
54. **Two stale-prose sites** found while writing the docs, both harmless at runtime but
    both advertising the retired language:
    `packages/oj-ui/src/components/IconButton/IconButton.tsx` JSDoc ("hand-drawn ink
    border, hard offset feel") and `src/components/EngineHealthDot/EngineHealthDot.tsx`
    JSDoc ("a Caveat label").
55. **One surviving port-glow declaration**: `src/components/Nodes/SamplerVisual.css`
    (`.sampler-key-port.connected { box-shadow: 0 0 4px … }`, plus a hover `scale(1.3)` +
    `brightness(1.2)`). The class appears in no `.tsx` — it is dead CSS — but it violates
    the Nothing-Glows rule and sits in **P7's** files. Delete it with the Sampler pass.

---

## Gate verdict as of 2026-08-29

**The coverage gate cannot close yet.** Four lanes are still open — **P7** (not started),
**P8** and **TB** (built, uncommitted, gates running), **P10** and **W6-E2E** (not
started) — and 55 items above are unresolved. The token layer, the component library, the
shell, the command bar, the panels and the committed node families are covered in both
themes and can be considered gate-complete; **the node registry is the biggest hole**:
**14 of 36 node types have no capture in either theme, and 10 of those have no taste-pass
owner in any wave** (`pan`, `width`, and the eight legacy fixed-instrument types).
