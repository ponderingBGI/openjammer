# W4-S4 — App shell: topbar, transport pill, first run, preset rigs

Lane: the frame around the instrument. The floating toolbar pill is gone, split into a
real topbar (document + state) and ONE floating transport pill (time). The browser
welcome modal and the first-run toast are gone, replaced by a three-question first run
over the blurred real studio that ends with a REAL rig, wired through the same reversible
verbs a player and the agent use, already making sound.

Screenshots: `plans/redesign-new-dna/.scratch/w4-s4/` (`w4s4-*.png`; the handoff prototype
captured side by side as `proto-*.png`).

---

## 1. What changed

### New oj-ui components

| File | What |
|---|---|
| `packages/oj-ui/src/components/Meter/Meter.tsx` | Ref-driven level meter. `MeterHandle.setSignal(0..1)` writes `--oj-meter-signal` on the root and manages the clip latch. **No value prop, no state** — a meter that re-rendered React 60×/s would put the tree on the audio-visual hot path. Each bar is a static track (`<i>`) with a scaling fill (`<span>`), so silence reads as a quiet meter rather than a dashed rule. |
| `Meter.css / .stories.tsx / .test.tsx` | 6 unit tests: property-not-state, clamping, the 1.2 s clip latch, the `meter` role, per-bar coefficients. |
| `packages/oj-ui/src/components/TransportPill/TransportPill.tsx` | The one transport, purely presentational: play/stop, record, return-to-start, bar.beat readout (click-to-type, `positionRef` for frame writes), tempo scrubber (Δx/3, Shift ÷10, Alt ×5, clamp 20–300, **one** commit on release, double-click/Enter to type, arrow stepping), loop, metronome + long-press/right-click count-in popover, meter slot, keycap hint. Zones it is not given do not render. |
| `TransportPill.css / .stories.tsx / .test.tsx` | 16 unit tests including the tempo grammar, the honest disabled reasons, the pulse suppression while rolling, and the left-to-right tab order of every control. |
| `packages/oj-ui/src/index.ts:167` | Exports both + their prop types. |

### New app shell (`src/components/Shell/`)

| File | What |
|---|---|
| `Topbar.tsx` + `.css` | 46px `--bg-node-header` band, 1px `--border-subtle` rule. Left: brand dot + name (700/15), File/Edit/View, breadcrumbs. Centre: surface switcher. Right: undo/redo (unified history), engine-health dot, latency chip, project + offline chips, collab, theme toggle, settings. Declares `--oj-topbar-height`. |
| `AppMenuBar.tsx` | The File/Edit/View logic lifted out of the deleted `Toolbar.tsx`. Edit gained Undo/Redo rows; View gained **Pause/Resume loopers** (see §2). Every keycap reads the live keymap. |
| `SurfaceSwitcher.tsx` + `.css` | Canvas/Arrangement as an oj-ui `SegmentedControl` + the live `Tab` keycap. |
| `ThemeToggle.tsx` | One icon button, sun/moon, writes the choice back into the onboarding answers. |
| `LatencyChip.tsx` + `.css` | Replaces `LatencyWarningBanner`. A `--warning-ink` chip showing the honest round-trip ms; a popover carries the same diagnosis and the same Fix now / Ask AI / Dismiss over the same store and the same localStorage key. |
| `TransportPillHost.tsx` + `.css` | The wiring. Position `fixed; top: calc(var(--oj-topbar-height) + 6px); left: 50%`. |
| `barBeat.ts` | `parseBarBeat` — `12` / `12.3` / `12.3.240` → ticks, `null` when unreadable. |
| `masterSignal.ts` | The master level: `__master__` while conducting, else the loudest speaker node. Rides `Arrangement/timelineSignalLevels` (the app's ONE rAF + ONE subscription). Publishes on a **dB scale** (`meterScale`, −60…0 dBFS → 0…1). |
| `StepGrid.tsx` + `.css` | 3 × 8 cells over the beat rig's real clip, through `drawNotes`/`eraseNotes`. |
| `HintBubble.tsx` + `.css` | The beginner's one sentence on the canvas; replaces the first-run toast. |

### Onboarding (`src/components/Onboarding/`)

`Onboarding.tsx` (the three steps, focus trap, number keys, Esc/skip), `glyphs.tsx` (mini
pads/keys/dials as token-driven markup builders, `aria-hidden`), `Onboarding.css`,
`OnboardingHost.tsx` (theme → audio → answers → rig → autoplay, in that order).

### Rigs (`src/rigs/`)

`types.ts`, `presets.ts`, `buildRig.ts`, `beatSong.ts`, `index.ts`.

### Stores

- `src/store/onboardingStore.ts` — NEW. `oj-onboarding-v1`, strict parse (a partial blob
  is "never answered"), `complete` / `reset` / `setPersona` / `setTheme` / `dismissHint`.
- `src/store/transportStore.ts:57` — `toggleGlobalPause()` is now the ONE transport
  gesture and routes to the arrangement when a Song exists; `pause`/`resume` stay as the
  raw continuous-source verbs. `transportIsRolling()` added.
- `src/store/uiViewStore.ts` — unchanged (the switcher drives the existing actions).

### Rewritten / retargeted

- `src/App.tsx` — `Toolbar`+`Breadcrumbs`+`SharedSurfaceChrome` wrapper → `<Topbar>` +
  `<TransportPillHost>`; `.oj-welcome` (70 lines of inline modal) and the first-run toast
  deleted; `handleActivate` keeps the same `initAudioContext` path minus the toast;
  `<CollabControl>` moved into the topbar; `HintBubble`/`StepGrid` added on the canvas.
- `src/components/Toolbar/DropdownMenu.tsx` — now renders the oj-ui `Menu` family (one
  menu vocabulary in the app). Arrows/Home/End belong to `Menu`, Enter/Space to the row;
  this component keeps only open/close, anchoring, Escape/Tab and click-outside.
  `DropdownMenu.css` shrank from 176 lines to anchoring only.
- `src/components/Toolbar/HelpPanel.tsx` + NEW `HelpPanel.css` — New DNA card, mono
  keycaps, persona-aware default (open for `first`, collapsed otherwise) and content
  (5 rows for a beginner, 12 otherwise). An explicit choice always beats the default.
- `src/components/Toolbar/Breadcrumbs.css` — topbar-native.
- `src/components/SafeMode/SafeModeScreen.tsx` + NEW `.css` — same full-screen card
  grammar as the first run; a real focus trap replaces the 2-element loop.
- `src/components/params/AutoParamPanel.tsx:57` — ≤ 6 visible params render as real
  `Knob`s (an instrument face); above that the scannable `ParamRow` list is kept, because
  a 60-parameter plugin needs a table, not 60 dials. Log mapping when `max/min ≥ 100`.
- `src/components/Settings/SettingsPanel.tsx` — Graphics tab gains **First run**: the
  persona segmented control + **Redo setup**.
- `src/components/Arrangement/TransportStrip.tsx` — everything about TIME removed (play,
  return, record, loop, click, count-in, tempo, undo/redo, the latency banner). What
  remains is arrangement-only: name, edit mode, punch, Mix, Export, zoom, the record/
  transport error rows.
- `src/components/Arrangement/SharedSurfaceChrome.tsx` — **deleted** (the pill took the
  readout, the topbar took the switcher).
- `src/components/Arrangement/ArrangementSurface.css:1` — `inset: var(--oj-surface-top)`
  (102px) so the pill never covers a bar. The ONLY change in that file.
- `src/styles/global.css` — `.oj-welcome*` (167 lines) and the old shared-surface chrome
  deleted; `.surface-layer` starts below the topbar.
- `index.html:143` — boot copy matches the new first paint.
- Deleted: `src/components/Toolbar/Toolbar.tsx`, `Toolbar.css`,
  `src/components/LatencyWarningBanner.{tsx,css}`.

---

## 2. Decisions on the open questions

**Record on the canvas.** The record button renders **whenever an arrangement exists —
including on the canvas** — and is hidden entirely when there is none. Recording is an
arrangement operation; with no Song there is nothing to record into, and a permanently
dead control on the first-run canvas is chrome that never earns its place (value #8). With
a Song but nothing armed it is disabled with *"Arm a track first — open the arrangement
with Tab"* rather than a shrug.

**BPM with no Song.** `transportStore` holds a pause flag, not a clock — there is no
global tempo in this app. Verified, not assumed. So the scrubber renders **disabled with
`title="Add a Song node to set the tempo"`**, exactly as the brief's honest fallback
prescribes. With a Song it drives `arrangementStore.setTempo`.

**Surface switcher location: the topbar's centre cluster.** *Where you are editing* is a
document-scope choice, the same class of thing as the File menu — not a fact about time,
which is all the pill carries. On the rule it also never occludes the stage and never
competes with the transport for the eye. `Tab` still does it and the keycap says so.

**The step grid: BUILT, as a thin view.** `Shell/StepGrid.tsx` renders 3 rows × 8 cells
over the beat rig's real clip; every toggle is `drawNotes`/`eraseNotes` on the same source
in the same undo history, and the piano roll shows the same notes. It appears only for the
beat rig's own source id, so it is that rig's face rather than a second timeline UI. The
playhead column is a `data-step` attribute the shared frame writes — no React render moves
it.

**One transport gesture.** `transportStore.toggleGlobalPause()` — which `NodeCanvas` calls
on Space and which I could not edit — now routes to the arrangement when a Song exists.
That makes Space and the pill agree on every surface (the covenant's "one place for is-it-
running") and makes the `space` keycap honest. The continuous-source hold it used to be
stays reachable as **View → Pause loopers**, so consolidating the gesture cost no
capability.

**The `space` keycap is conditional.** It shows only where Space really is the transport:
the arrangement always, the canvas only in config mode (modes 2–9 give Space to the
sustain pedal), never on the piano roll (unbound). An advertised key that does nothing is
worse than no hint.

**After a rig lands, the app switches to the rig keyboard's mode** (`focusRig`) so typing
plays immediately. That is the whole promise of "already making sound", and it is why the
`space` hint correctly disappears on a fresh jam canvas.

---

## 3. The rigs — real node mapping, and what assets exist

`installRig` calls `graphStore.addNode` / `addConnection` inside ONE
`beginGesture`/`endGesture`. **Verified: one history entry, and `Ctrl+Z` removes the whole
rig** (`src/rigs/__tests__/rigs.test.ts`).

| Goal | Nodes | Persona delta |
|---|---|---|
| jam | `keyboard` → `instrument{gm-electric-piano-1}` → `effect{delay .30/.34/.28}` → `speaker` | pro adds `width` |
| beat | `keyboard` → `instrument{gm-synth-drum}` → `effect{reverb .22}` → `speaker`, plus `song` | pro adds `width` |
| sound | `keyboard` → `instrument{gm-pad-warm}` → `effect{filter 900Hz/Q2.4}` → [`pan`] → [`width`] → `speaker` | `first` gets neither; `some` gets `pan`; `pro` gets both |

**Assets, honestly:** `src/assets/` contains one SVG. There are **no bundled audio
samples**, which is why no rig uses the `sampler` — `sampler.defaultData.sampleId` is
`null` and the node makes no sound until the player finds a WAV. Every rig voice is an
`instrument` on a catalogue id the engine synthesises (`gm-synth-drum` resolves to the
`percussion` voice family, the same one "First Light"'s drum track uses).

**Port resolution.** Wires resolve against the LIVE node, not the registry. This is
load-bearing and was found empirically: adding a `keyboard` REPLACES its declared ports
with its internal output panel's `Row 1…3`, and an `instrument`'s declared `Bundle`
becomes `Input` on an expanding panel. A registry-name lookup — the agent's `emit_plan`
path — cannot wire a playable keyboard at all. So a port NAME is a hint and the cable's
`signal` (`audio` / `control`) is the fallback. Connecting Row 1/2/3 → the instrument
produces exactly what dragging three cables by hand produces: three named
`Keyboard Row N (n)` bundle inputs (asserted in the tests).

**The beat rig's Song** (`beatSong.ts`) is a real `Arrangement`: one MIDI source, one
track, one 1-bar clip at 96 BPM, a `loop` location, and its own graph spec
(`instrument{gm-synth-drum}` → `speaker`). It is installed with `setArrangement` — the
same call the arrangement's own "Start from 'Paper Sketch'" makes — and `setLoopEnabled(true)`.

**Honest deviation (D12 / owner flag 1):** the handoff's third rig asks for "an oscillator,
a filter, knobs". There is no standalone oscillator or filter NODE in the registry; those
are DSP and DSP is plugin territory. The rig is a sustaining pad through the `filter`
effect with real `Knob`s on `pan`/`width`.

---

## 4. API additions

```ts
// @openjammer/oj-ui
Meter, MeterHandle { setSignal(v: number): void }, MeterProps
TransportPill, TransportPillProps, TransportRecord, TransportPosition,
TransportTempo, TransportLoop, TransportMetronome

// src/store/onboardingStore.ts
useOnboardingStore, OnboardingAnswers, Persona, RigGoal, ThemeChoice,
DEFAULT_ANSWERS, ONBOARDING_STORAGE_KEY, parseAnswers, currentPersona

// src/store/transportStore.ts
transportIsRolling(hasAudio: boolean): boolean          // toggleGlobalPause now routes

// src/rigs
rigFor, RIG_LABEL, installRig, installRigFor, focusRig, InstalledRig,
buildBeatSong, BEAT_ROWS/STEPS/STEP_TICKS/BAR_TICKS/SOURCE_ID/TRACK_ID/CLIP_ID

// src/components/Shell
subscribeMasterSignal, meterScale, parseBarBeat

// e2e/journeys/support.ts
bootApp(page, { skipOnboarding?, firstRun? })           // activateBrowser kept as an alias

// CSS custom properties
--oj-topbar-height (Shell/Topbar.css) · --oj-surface-top (Arrangement/ArrangementSurface.css)
--oj-meter-signal, --oj-meter-k (written by Meter)
```

Renamed (local, no consumers outside the file): `DropdownMenu`'s `MenuItem` /
`MenuSeparator` config types → `MenuItemConfig` / `MenuSeparatorConfig`, to stop colliding
with the oj-ui components of those names. `MenuItemOrSeparator` is unchanged.

---

## 5. Tests

**Added — 89 in the lane's own scope**, plus updates:

- `Meter.test.tsx` (6): writes the property and never re-renders, clamps NaN/out-of-range,
  latches the clip for the full window, `meter` role only with a label, arched coefficients.
- `TransportPill.test.tsx` (16): zone gating, play/stop, pulse never while rolling, the
  honest disabled record reason, pending readout, typed seek, **one `setTempo` per drag at
  3 px/BPM**, Shift/Alt grammar, the 20–300 clamp, no commit without movement, the inert
  no-song tempo, arrow stepping, the count-in popover, loop `aria-pressed`, tab order.
- `onboardingStore.test.ts` (10): strict parse, persistence, reset, `setPersona` before and
  after a run, theme-only writes, hint persistence, storage-failure survival.
- `Onboarding.test.tsx` (11): number keys walk the three steps, **guarded against fields
  and modifiers**, skip from step one, **skip KEEPS the answers already given**, Esc does
  the same, Back preserves, labelled `aria-modal` dialog, focus trap both directions, the
  body peek class, the counter.
- `rigs.test.ts` (30): every goal × persona names real types with unique refs and wires
  that resolve; no beginner starts on distortion; density ordering; each rig builds fully
  wired to a speaker; **ONE history entry, `Ctrl+Z` removes it**; the keyboard wires as
  three control cables producing three bundles; the beat song's shape, on-grid notes and
  audible routing.
- `StepGrid.test.tsx` (6): absent without a song and for a foreign song, 3 × 8 over the
  real clip, writes real undoable notes, erases, parks the playhead outside the grid.
- `TransportPillHost.test.tsx` (13) + `parseBarBeat` (2): zone gating, the honest tempo
  reason, audio unlocked once on the gesture, the pulse, every zone with a song, the
  record reason, the loop reaching the engine, the clamped tempo, and the conditional
  `space` hint on all three surfaces.
- `AppMenuBar.shortcuts.test.tsx` (2): moved from `Toolbar.shortcuts.test.tsx`; adds a
  guard that the looper hold stayed reachable.

**Updated:** `DropdownMenu.test.tsx` — the 8 keyboard cases now fire on the real element
instead of `document` (arrows belong to the `Menu` panel, Enter/Space to the row), plus a
new "arrow navigation never lands on a disabled row"; `AutoParamPanel.test.tsx` — the
small-panel gesture is a knob step, plus a new case pinning the row fallback above the
limit; `ArrangementSurface.test.tsx` — the tempo-clamp case now asserts the store
invariant, since the control it drove moved into the pill (covered by `TransportPill.test.tsx`).

**Gate:**

| Command | Result |
|---|---|
| `bunx tsc --noEmit -p tsconfig.app.json` | clean |
| `bunx eslint src packages e2e` | 1 error, **not this lane**: `Canvas/ContextMenu.tsx:133` `react-hooks/purity` (Canvas lane, in flight) |
| `bun run test:run` | **194 files / 2105 tests, all green** |
| `bun run build` | clean |
| `playwright test e2e/pwa-smoke.spec.ts e2e/arrangement-editing.spec.ts --project=chromium` | **12 passed, 1 failed** — see §7 |

---

## 6. Browser verification (Chromium on 5207, driven under `node`)

`plans/redesign-new-dna/.scratch/w4-s4/verify.mjs` — **all checks pass**, zero console or
page errors. Screenshots:

| File | What |
|---|---|
| `w4s4-01-onboarding-light.png` | Cold load, step 1, over the blurred studio |
| `w4s4-02/03-*.png` | Step 2, and the theme step with both swatches in their own theme |
| `w4s4-04-studio-beat-dark.png` | Beat rig, dark: pill with every zone, Song, step grid, hint bubble, help card |
| `w4s4-05-arrangement-dark.png` | The same pill on the arrangement (`space` hint present) |
| `w4s4-06-studio-jam-light.png` | Jam rig, light, after Skip |
| `w4s4-07-returning-pulse.png` | Returning user: no overlay, play pulsing until the gate |
| `w4s4-08-focus-ring.png` | Keyboard traversal frame |
| `w4s4-09-reduced-motion.png` | No blur, no stagger |
| `w4s4-10-onboarding-dark.png` | Onboarding, dark |
| `w4s4-11-sound-rig-light.png` | Sound-design rig with real `Knob`s (PAN −0.25, WIDTH 1.50) |
| `proto-01…06-*.png` | The handoff prototype, for the side-by-side |

Verified in the browser: overlay is a labelled modal dialog; the studio is blurred behind
it (`blur(5px)`); topbar 46px with a 1px rule; number keys 1/2/3 walk the flow; answers
persist; the theme applies and saves; **15 nodes / 65 cables installed**; the beat rig
installed a real Song; the step grid renders over the real clip; the beginner hint shows
for `first` and not for `some`; **the meter moves while a key is held** (33 distinct
values, e.g. `0.908 → 0.766`); the pill is present on both surfaces; Skip finishes with
defaults and installs the jam rig; a reload shows no overlay and the pulse returns until
the gate is satisfied; reduced motion removes both blurs and every entrance; the pro
persona gets two real knobs and a collapsed help card.

**Contrast, computed in the live DOM** (`meterScale`-style arithmetic in `verify.mjs`):
every word on the onboarding scrim is `--text-primary`, at 55% scrim. Dark, against the
brightest large area a dark studio can put behind a word (the accent): **4.93:1**. Light,
against a realistic light studio: **8.12:1**. Everything else in the flow sits on opaque
`--bg-node` / `--bg-tertiary` cards where the theme's audited values apply directly. See
the arithmetic at the top of `Onboarding.css`.

---

## 7. Deviations from the handoff, with reasons

1. **The attention pulse is an expanding ring, not `scale(1) → scale(1.09)` on the button.**
   A hit target whose bounding box oscillates is measurably harder to hit — Playwright
   refused to click it for 30 s ("element is not stable"), which is the automated version
   of a hand missing it — and "nothing animating slowly enough to delay an action" is a
   rule this product keeps. Same size, rhythm and colour; only the thing that grows
   changed. Static ring under reduced motion.
2. **The onboarding scrim is 55%, not 45%, and every word on it is `--text-primary`.**
   At 45% with secondary ink the dark-theme worst case is 2.6:1. 55% + primary ink closes
   it at 4.93:1 while keeping 45% of the studio showing through the backdrop blur.
   Subordination is carried by size and weight, which is how it should have been carried.
3. **The meter is dB-scaled** (−60…0 dBFS → 0…1), and each bar has a track. A comfortably
   loud held note is ~0.02 RMS; on a linear bar that is indistinguishable from silence,
   and a trackless row at rest reads as a dashed rule rather than a meter.
4. **Settings is a sliders glyph, not a cog.** A cog's spokes one button away from the
   theme toggle's sun read as a second sun at 16px (visible in the first screenshot pass).
5. **The option glyphs are token-driven markup, not real `KeyTile`/`Knob` instances.**
   Those carry an embedded `Port` and `role="slider"`; at 15px the socket shows, and a
   decorative control that announces itself to a screen reader is noise, not fidelity.
6. **The third rig is instrument + filter, not oscillator + filter** — no such node types
   exist (master-plan owner flag 1).
7. **The theme swatches use literal light/dark values.** They are PICTURES of the two
   themes; a dark swatch that turned light when you hovered it would be a magic trick, not
   a choice. Kept in step with `tokens/themes/*.json` and commented as such.

---

## 8. UNVERIFIED / handed on

1. **`e2e/arrangement-editing.spec.ts` "S splits at the playhead" fails — not this lane.**
   Evidence in `plans/redesign-new-dna/.scratch/w4-s4/probe-split.mjs`: the clip click
   still selects (`clipIds: ["t0.c0"]`), but the **ruler click no longer moves the
   playhead** — `playheadTick` stays 0, `pendingSeekSample` stays null and
   `transportError` stays null, i.e. `arrangementStore.seek()` is never called. The split
   then runs at tick 0 and clears the selection. `RulerStack.tsx` was rewritten this
   session by the concurrent timeline lane (its click became a scrub gesture, +93 lines);
   `arrangementStore.ts`, `editingContextStore.ts`, `song/ops.ts` and `song/verbs.ts` are
   all modified in the same worktree by other lanes. **For lane TB.**
2. **The beat rig's autoplay could not be confirmed on this box.** `arrangementStore.play()`
   reports *"The audio engine did not acknowledge the transport command"* on the dev
   server — and so does the **shipped** path (Paper Sketch + the arrangement's own play
   button), verified in `probe-transport.mjs`. It is a headless/dev-server engine-ack
   condition, not a lane regression; the rig calls exactly the same store method. Needs a
   founder listening pass with audio actually playing.
3. **Native (Tauri) was not run.** The Tauri branches — no pulse, no autoplay pretext in
   the copy, `handleActivate` on mount — are code-verified only.
4. **`Tab` cannot enter the shell chrome forwards.** `view.toggleArrangement` is bound to
   bare `Tab` globally, so the arbiter consumes it everywhere except inside editable
   targets and focus-trapped dialogs. This is pre-existing and app-wide, not new. What
   works today (verified in `probe-keyboard.mjs`): **Shift+Tab** carries a modifier the
   binding does not match, so it falls through and walks backwards through every chrome
   control; once focused, each control activates with Enter/Space and the tempo scrubber
   steps with arrows; the pill's internal order is unit-tested.
   I **attempted** a guard so Tab traverses while focus is in the chrome and reverted it:
   Chromium raises `:focus-visible` on the Tab keydown itself, so the guard could not tell
   "walking the chrome" from "clicked Play a moment ago", and 11 of 13 Playwright specs
   broke. Redefining a global binding three lanes and 12 specs depend on is an
   orchestrator decision. **Recommended fix:** either drop focus from chrome buttons after
   a mouse activation and then guard on chrome containment, or move the surface toggle off
   bare `Tab`.
5. **Windows type rendering** of Outfit at 13px and the 9.5px mono micro-labels is
   screenshot-verified only; the audit asks for a human eye on the founder box.
6. **`--oj-topbar-height` (Topbar.css) and `--oj-surface-top` (ArrangementSurface.css)
   must be changed together.** The 102px is spelled out rather than composed because that
   directory is gated against undeclared custom properties. Lane TB replaces this with the
   real sky band.
7. **`AutoParamPanel`'s "No parameters" empty state** shows on the `instrument` node
   (it derives no numeric params). Pre-existing and cosmetic; belongs to the Wave 5
   faceplate pass. Same for the Song node's "1 bars".
