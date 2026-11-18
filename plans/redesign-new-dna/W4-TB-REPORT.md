# W4-TB — the timeline, redesigned

Lane TB of the New DNA redesign: the **visual** rebuild of the arrangement surface, ruler
stack, track headers, clips, playhead, loop/punch, markers, selection, readouts, mixer
drawer, automation lanes and piano roll, on top of the committed interaction controller.

**Behaviour is frozen and proven frozen.** `e2e/arrangement-editing.spec.ts` +
`e2e/timeline-preview.spec.ts` are **10/10 green with zero edits to either spec**, and the
W3-TA2d regression gates 1–7 re-run clean with **0 behavioural deltas** on gates 1/2/3 and
only *improvements* on 4/5/6 (below).

---

## 1. What changed, region by region

### 1.1 Shell — the sky band (spec 2.1)

`TransportStrip.tsx` is gone. `SkyBand.tsx` replaces it as a **56px band** that is the lane
the floating transport pill occupies, so the pill can never cover a bar and its position
rule stays identical on the canvas, the arrangement and the piano roll.

- Left: song name (15px/600 Outfit) + the `Tab` keycap reading "canvas".
- Middle: reserved (`.arrangement-sky__gap`, `clamp(220px, 26vw, 420px)`) so a long song
  name can never slide under the pill.
- Right: `Slide | Ripple` (segmented shape, plain buttons), `P` punch, `Mix`, `Export`,
  timeline zoom, and **error chips**.
- `--oj-surface-top` moved `102px → 46px`; the surface now paints its own band instead of
  leaving a hole where one used to be.

**Undo/redo are deliberately NOT here.** They are document-scoped, they already sit in the
topbar 46px above this line, and `Ctrl+Z` reaches them from anywhere; a second copy of a
control is what "extend, don't fork" forbids. Deviation from the spec's
`↶ ↷ | Grid chip | Mix | Export | ⋯` cluster, recorded in §5.

**Grid chip / magnet / tool / follow moved to the ruler's 200×64 corner** (spec 2.3), where
they sit directly above the header column and directly left of the bars they measure. The
brief listed them in both places; §2.3 is the authority.

Errors are chips (`Chip tone="warning" | "danger"`, tinted text only) plus the existing
`aria-live` region — never a modal, never a banner that shoves the ruler off the bar you
were reading. A benched plugin adds an `N plugin benched` chip, read from
`usePluginFaultCards()`.

**One scroll container, sticky ruler + sticky header column, no rAF `translateX`
compensation** (there was none to remove — TA2c had already landed that).

### 1.2 Ruler stack — 64px, three rows (spec 2.3)

Geometry still lives once in `gestureHandles.css` (`--arrangement-ruler-height: 64px`,
sections 22 / braces 14 / bars 28), now with the whole TA2d **CSS parcel** styled:

| Part | Treatment |
|---|---|
| Section chip | inset fill, 1px `--border-strong`, 11px/600, ellipsis. Selected → 1.5px `--acc` + `--focus-ring`, **no drench** (was a 2px `--timeline-section-marker` outline — W2-S2-REVIEW V4) |
| Mark pin | **new**: `kind: 'mark'` renders as a 7px triangle + its name at natural width, not as a chip spanning to the next section |
| Loop brace | 3px `--acc` bar + 7px end-cap grips |
| Punch brace | dashed `--bad` bar + `--bad` caps |
| Bars row | 11px mono `--text-muted` numbers; bar ticks `--timeline-grid-bar`, beats `--timeline-grid-beat` |
| Loop bracket | hairline-weight mono `[` `]` in `--acc` at 55%, `pointer-events: none` |
| Corner | row 1 grid chip · magnet · follow, row 2 `V B X`. On the piano-roll surface it narrows to the roll's gutter and stacks magnet+follow / grid chip |

The grid chip is now a real button that cycles the ladder (same units `[` and `]` step
through). The magnet's and follow's armed state is an **accent glyph on inset**, not an
accent fill — two filled orange squares in one 200px corner were two alarms.

**Ruler ticks are rounded to whole ticks** before they preview (`Math.round` in
`locationTick`), closing the TA2d "unrounded brace / location ticks" carry-forward. Gate 6
now reports `sections: [2304, 7680, 30720, 53760]` where it used to report `5408`.

### 1.3 Track headers — 200px (spec 2.4)

Grid rows `26px / 3px / 24px` (name · level bead · controls).

- **Colour stripe** 4px, 6px + `--acc` when selected. This is the ONE sanctioned vertical
  bar on the surface: it is the track's identity, the same colour its clips wear on their
  left edge.
- **Level bead** — the carried-forward item, now real: a 3px full-width bar under the name,
  `transform: scaleX(level)` written straight onto the DOM by `registerTimelineLevelWriter`
  (it was `scaleY` inside the stripe before). **The only animated element in the field
  region** (D14).
- **Inline rename** input styled; **track colour** is now a swatch showing the track's
  *effective* tint with the native `<input type="color">` invisible on top (the browser's
  own swatch shows the fallback hex, so it claimed the lane was blue while its stripe and
  clips were orange).
- Soloed elsewhere → `.is-dimmed` at 55%.
- Alternate lane tint keys off the track's **absolute** index (`is-odd`), not
  `:nth-child`, or virtualization would swap the stripes under the eye on every scroll.
- The inline roll's lane menu stopped lying: it resolved `drumMode` differently from the
  roll itself and said "Pitched notes" over a lane full of drum diamonds. A dead
  `<span>Velocity</span>` with no control under it is deleted.

### 1.4 The ruled field and clips (spec 2.5)

Ground `--timeline-lane-bg`, odd lanes `--timeline-lane-alt-bg` at 40%, 1px dividers, grid
on canvas (unchanged `GridLayer`), past-end `--inset` wash. The Living-Sketchbook dot grid
is gone from every chrome surface — this is a ruled page, not a dotted canvas.

**Clip**: radius 6, `color-mix(in oklab, var(--track-tint) 12%, var(--timeline-clip-bg))`,
1px `--timeline-clip-border`, 2px left border in the track tint, `--shadow-raised`, 18px
name bar at tint 24%. States: selected = 1.5px `--acc` + ring with the fill shifting 12%→18%
(**no drench** — W2-S2-REVIEW); muted = inset + strikethrough + content at 40%; locked =
dashed; faulted = 1.5px `--warn` + a `⚠` in the name bar; dragging = 35% original.

MIDI content moved from teal to `--text-secondary` (spec 2.5): teal is reserved for AUDIO in
this language, and a clip already washed in its track's tint must not carry a second
saturated hue. Audio waveforms stay `--timeline-waveform-fill`.

**Track palette** (`trackTint.ts`, extracted so lane, clip and ghost agree): accent-secondary,
success, audio, universal, warning. Danger and muted-grey are deliberately out — on this
surface red already means "recording / faulted" and grey means "muted", so a track that
hashed to either would wear a state it is not in.

**Playhead**: 2px `--acc` `.is-rolling` / 1.5px `--t2` stopped, with a 9px triangular cap in
the bars row (z-index raised above the sticky ruler so the cap can sit in it). **No glow**
(D15). The piano roll's playhead now follows the same law.

**Loop wash** `--timeline-loop-range`. **Range selection** `--acc` 10% + 1px edges + a
**bar.beat chip at each edge** (measured `["3.1", "6.4.106"]`). **Marquee** is neutral dashed
`--border-control` (D19) — accent means *selected*, and a marquee is a proposal.

`user-select: none` on the surface: dragging a clip down-left used to paint a text selection
across the track headers, which the eye reads as "something broke" mid-edit.

### 1.5 Transient overlays (spec 8.2)

- **Drag ghost carries the clip's real content**: name bar + the same MIDI canvas
  (`clipPaint.ts`, extracted) or waveform, at 96% with `--sh2`, the original at 35%.
- **Readout chip** follows the cursor: `2.3 +1.2` — position in bar.beat and a **duration**
  delta (`formatTickDelta`, zero-based: reusing `formatBarBeat` reported a zero nudge as
  "1.1", because a distance and a place are not the same number).
- **Snap hairline** 1px `--acc` with an 80ms fade-in.
- **Drop-invalid**: wired to the one drop this model genuinely refuses — `moveClips` skips a
  locked clip, so the gesture would silently do nothing. Ghost + lane take a 1.5px `--bad`
  outline and the chip reads `locked`. No shake, no sound.
- Three VIEW-ONLY fields added to `ClipDragPreview` (`tick`, `originTick`, `locked`) — no
  document state, no new gesture.

### 1.6 Mixer drawer — 188px (spec 2.6)

Was 236px. Strips 124px + 92px master, `grid-template-rows: 20 / 1fr / 16 / 22 / 22`.
**The bespoke fader override is deleted** (W3-P1-REVIEW `ArrangementSurface.css:289-292`):
the shared `Slider` keeps its own construction, so the accent progress fill shows. Meter
8×76 on a pill track, `--success-ink` fill, `--bad` when clipping, custom-property-driven.
dB readout and the pan pill are mono.

### 1.7 Automation lane — 96px (spec 2.6)

Default hairline `--border-subtle`, curve 1.5px `--timeline-automation-line` (the acc2
purple), points 9px `--surface` circles with `--border-control`, hover → acc2 fill, focus →
`--acc` + ring, range 10% dashed.

**Deviation:** spec 2.6 draws the controls as a 28px row across the top. That would leave a
68px field — too shallow to place a point in confidently, and it breaks the shipped ramp
e2e, which double-clicks at `y: 72`. They live in the 200px **header column** instead, in
line with the track header above them: one column of controls, one column of time. Rows
`28 / 24 / 24`: parameter `Select`, live mono value + `Off | Play`, `Step | Linear`.

### 1.8 Piano roll (spec 2.7 / 9)

- **40px toolbar**: title · tool strip `V B X K T` (28px each, inset pill, armed tool rises)
  · `Q 1/16` quantize-grid chip · `Quantize` (disabled with nothing selected) · `Drums` ·
  `⋯` popover holding grid / strength / swing — the three number fields leave the always-on
  chrome. The `Q` prefix distinguishes it from the corner's grid-unit chip.
- **The `Drums` override on the full surface was a dead control** — the host passes no
  `onDrumModeChange`, so it was pressed-looking and inert. It now owns the override locally
  when nobody else does (§9 promises an explicit override).
- **Key bed**: a sharp is drawn as a **short bar on the white ground**, the way a keyboard is
  built — not a fill swap. Every "inset" token in this system goes *lighter* in dark, so the
  fill-based version drew the keyboard upside-down; a shape cannot invert. C rows labelled
  11px mono, seams at C and F. GM drum names left-align so they lose their tail, not their
  head ("igh bongo" was worse than useless).
- **Rows**: black-key rows `--timeline-lane-alt-bg` at 45%, C rows a `--border-strong` top
  hairline. Row height cap **16px → 22px** (spec 2.7's `clamp(6, fit, 22)`); at 16 a narrow
  pitch range drew a short block floating above a third of an empty surface.
- **Notes**: radius 3, `--universal-connection` (acc2) at `velocityOpacity()`, selected
  1.5px `--acc` inset + ring, other clips' notes at 22% `--text-muted`, non-interactive.
- **Velocity lane**: 2px stem at 55% + 7px head, selected `--acc`. The stem is quieter than
  the head because at real note density a solid 2px black stem per note fuses into a picket
  fence and the *shape* of the dynamics — the only thing the lane exists to show —
  disappears.
- **Step cursor** 2px `--universal-connection`. **Marquee** neutral dashed.
- Inline lane and full surface remain one component and one stylesheet.

**Pixel-lock fix (real defect):** the full surface's ruler used a 200px corner while its key
bed is 76px, so **bar 1's tick sat 124px to the right of tick 0** — a ruled surface whose
ruler measured the wrong place. The host now sets `--arrangement-header-width` to the roll's
gutter (`SURFACE_GUTTER = 12 + 64`), the corner narrows to match, and the surface key column
is a constant width so drum auto-detection cannot slide every bar number sideways.
Measured `fieldLeft: 76, rulerLeft: 76` in every configuration.

The roll's height now derives from the chrome above it (`56 + 64 + 18`) instead of a stale
`180`, so the velocity lane lands on the bottom edge instead of hanging off it.

### 1.9 Empty, loading, error (spec 8.3)

Ghosted 32-bar shell behind a `--surface` card with `--sh2`: "An empty page." + copy, and
**all four ways in** — `Start from 'Paper Sketch'` (primary), `Start from 'First Light'`,
**`Record something`** (adds a track and arms it), **`Draw a clip`** (adds a track and arms
the Draw tool) — plus the "Add an empty track" ghost link and the `Tab` keycap footer.
Empty-lane hint already read "drag audio here · press **B** and draw" (D13).

**No arrangement-level loading skeleton, on purpose.** The document is synchronous — there
is nothing to wait for at that scale, and an 800ms fake skeleton would be a lie about work
that is not happening. The honest granularity is the clip, and §8.3's own second sentence
says so: a clip without peaks shows its name bar over an empty tinted body while
`getWaveform()` resolves. That is what ships.

### 1.10 Reduced motion (spec 8.4)

Every transition and animation in both stylesheets has a `prefers-reduced-motion: reduce`
alternative: the record arm swaps its pulse for a solid fill + ring, meters and the level
bead write instantly, the snap hairline and the surface transition become instant, press
scales are dropped. **The playhead keeps moving — it is the clock, not decoration.** No
state is carried by motion alone. Captured at `light-reduced-*`.

---

## 2. Parts used (oj-ui)

`Button`, `Chip`, `Kbd`, `ValueScrubber`, `LaneButton`, `Slider`, `Select`,
`SegmentedControl`, `TimeRuler`, `WaveformCanvas`. No oj-ui component was modified.

**API needs for oj-ui (none blocking):**

1. **`accentTwo` semantic token.** The spec's `--acc2` is spelled `--universal-connection`
   in the app (piano-roll notes, step cursor, record-ghost marks) and
   `--timeline-automation-line` in the automation lane. They hold identical values, but the
   names describe *ports* and *automation*, not "the second accent". A real `--accent-two`
   (+ `--accent-two-ink`) would let this surface stop borrowing.
2. **A vertical `Slider`.** The mixer fader is `rotate(-90deg)` on a horizontal one, which
   costs a wrapper and makes its hit box a lie about its geometry. `orientation="vertical"`
   would delete `.mixer-strip__fader` entirely.
3. **A `Popover` primitive.** The piano roll's `⋯` panel is hand-rolled (surface card, sh2,
   12px radius) because `Menu` is a command list, not a form. Third hand-rolled popover in
   the repo.
4. `SegmentedControl` renders `role="tab"`; a **mode** switch (Slide/Ripple, tools) is not a
   tab strip, so those stayed plain buttons in the segmented *shape*. A `role="radiogroup"`
   variant would let them use the real part.

---

## 3. Contrast

Computed from `packages/oj-tokens/tokens/themes/{light,dark}.json`, both themes, sRGB/WCAG.

| Pair | Floor | light | dark |
|---|---:|---:|---:|
| clip border vs lane | 3 | **5.49** | **5.05** |
| clip border vs clip | 3 | **5.49** | **5.05** |
| clip border vs clip **fill** (12% tint, worst of 5 tints) | 3 | **4.80** | **4.12** |
| note fill `acc2` vs lane | 3 | **3.36** | **6.11** |
| note fill `acc2` vs clip | 3 | **3.36** | **6.11** |
| clip MIDI content `t2` vs clip | 3 | **7.13** | **6.93** |
| playhead rolling vs lane | 3 | **4.29** | **6.06** |
| playhead stopped `t2` vs lane | 3 | **7.13** | **6.93** |
| selection vs clip | 3 | **3.36** | **6.06** |
| grid bar vs lane | 1.5 | **1.66** | **1.94** |
| level bead vs header | 3 | **6.05** | **6.55** |
| level bead vs inset (meter) | 3 | **5.29** | **6.06** |
| clip name `t1` vs name bar (worst tint) | 4.5 | **12.94** | **9.16** |
| track name `t1` vs header | 4.5 | **16.20** | **13.85** |
| bar numbers `muted` vs chrome | 4.5 | **5.22** | **4.87** |
| chip label `t2` vs inset | 4.5 | **5.92** | **6.18** |

**One floor was missed and fixed.** The level bead and the mixer meter were
`--accent-success`, which is **2.97:1** on the header in light — below WCAG 1.4.11's 3:1 for
a non-text graphical object, and the bead is the ONE thing on this surface that reports live
sound, so it must never be the dimmest pixel. Both now use `--success-ink`.

`contrast.test.ts` gains four permanent gates so this cannot silently regress: `successInk`
vs `timelineChromeBg` and `bgTertiary` ≥ 3, and `universalConnection` vs `timelineLaneBg`
and `timelineClipBg` ≥ 3 — both themes. All existing floors still hold;
`tokenLiteralGate` is green (zero hex/rgb/hsl literals, zero undeclared `var(--…)`).

---

## 4. Verification

| Gate | Result |
|---|---|
| `bun run test:run -- src/components/Arrangement src/components/PianoRoll src/song src/store/__tests__/editingContextStore.test.ts src/store/__tests__/trackLaneViewStore.test.ts` | **35 files / 353 tests green** |
| `bunx tsc --noEmit -p tsconfig.app.json` | **clean** — the only errors in the tree are in `src/components/Nodes/**`, which another lane is editing live |
| `bunx eslint src/components/Arrangement src/components/PianoRoll` | **clean** |
| `bunx playwright test e2e/arrangement-editing.spec.ts e2e/timeline-preview.spec.ts --project=chromium` | **10/10 passed**, no spec edits — `plans/redesign-new-dna/.scratch/w4-tb/e2e.txt` |
| `bun run build` | **exit 0** when run against a settled tree. It went red twice *during* this lane on `src/components/Nodes/**` — another lane's in-flight P6/P8 edits (`w5p6bMeterScale.test.tsx`, `LooperNode.tsx`, `w5p8Faceplates.test.tsx`, `InstrumentNode.tsx`). `bunx vite build` — the bundle itself — is **exit 0** with every change in this lane |
| W3-TA2d regression gates 1–7 (re-pointed at :5222) | all exit 0, **0 console/page errors**, JSON diffed against the TA2d baseline |
| Screenshot harness, light + dark, 1280×800 + 1920×1080 + reduced-motion | **46 captures, 0 console errors, 0 page errors** |

### Pixel-lock (T24) — measured, not asserted

`pixelLock()` reads the grid **canvas pixels** and compares each bar line to the same bar's
ruler tick:

| | 46 px/bar | 90 px/bar | 210 px/bar |
|---|---:|---:|---:|
| light 1280 | **0 px** | **0 px** | **0 px** |
| dark 1280 | **0 px** | **0 px** | **0 px** |
| light 1920 | **0 px** | **0 px** | **0 px** |

Piano-roll surface ruler alignment: `fieldLeft 76 == rulerLeft 76` in all three runs (was a
124px shear).

### Ruler geometry (`rulerbox.ts`) — the TA2d 2px overflow, closed

```
sky      46 → 102  (56)
shell   102 → 166  (64)   viewport 102 → 166 (64)
sections 22 · braces 14 · bars 28
barsOverflowPx: 0        firstLaneTop: 166
```

TA2d measured `barsOverflowPx: 2`: a `border-bottom` sits *inside* the shell's 64px box, so
the 28px bars row was taller than the viewport clipping it. The closing hairline is now
drawn as an `::after` on top of the last pixel of the tick ladder — which is where a ruler's
baseline belongs anyway — and the whole stack abuts the first lane exactly.

### Regression-gate diff vs the W3-TA2d baseline

- gates **1, 2, 3** — **0 behavioural deltas**.
- gate **4 / 5** — `renameInputs` flipped 0→1: `elementAtLabel` now resolves to
  `.arrangement-section-chip__label` with `pointer-events: auto`, where the baseline found
  nothing. Double-click-to-rename works where it silently did not. **Improvement.**
- gate **6** — `sections[0]` `5408 → 2304`: the ruler tick rounding. **Improvement.**
- `loopBracketDrift` reports `maxDrift 586` vs the baseline's **664** — the probe compares
  the DOM-scroll-driven bracket against a store-only `leftTick` the app has never followed,
  so it is a probe artefact in both runs, and mine is smaller.
- Gate 7's 2 console errors were another lane's live HMR
  (`LooperNode.tsx` / `audioMetadata.ts` `formatSampleDuration`); a re-run after it settled
  reports **0**.

**Cross-lane note.** Two e2e failures during this lane turned out to be another lane's
in-flight work, not regressions: the record-flow test failed while `tsc -b` was red (so
`vite preview` served a stale bundle), and `timeline-preview` failed once on `Tab` and
passed on retry. Both are green in the final run, and the `Tab` path was independently
proven twice on the dev server (`tabprobe.ts`, `tabprobe2.ts`). Gate 7's console errors were
live HMR of `LooperNode.tsx`.

### Screenshots — `plans/redesign-new-dna/.scratch/w4-tb/`

`{light,dark}-{1280,1920}-NN-*.png` plus `light-reduced-*`:
`01-empty` · `02-paper-sketch` · `03-first-light-out` · `04-first-light-in` ·
`05-selected-clip` · `06-range` · `07-drag-ghost` · `08-mixer` · `09-automation` ·
`10-inline-roll` · `11-roll-surface` · `12-roll-quantize`.
Harness: `shots.ts`; measurements: `shots.json`; gates: `gate/gate{1..7}.{ts,json,log}`.

### Defects found by LOOKING at the captures, and fixed

1. A clip drag painted a **text selection across the track headers** → `user-select: none`.
2. The colour swatch showed a **blue fallback hex** on an orange track → the input is now
   invisible over a swatch of the effective tint.
3. **Magnet + follow both accent-filled** — two alarms in one corner → accent glyph on inset.
4. The full piano roll's ruler was **124px out of register** with its notes → corner
   narrowed to the roll's gutter.
5. The dark key bed was drawn **upside-down** (black keys lighter than white) → sharps are
   bars, not fills.
6. GM drum names clipped from the **left** ("igh bongo") → left-aligned, ellipsized at the end.
7. The `Drums` override on the full surface was a **dead pressed button** → owns its state.
8. The inline lane menu said **"Pitched notes" over drum diamonds** → resolves the mode the
   same way the roll does.
9. Velocity lollipops fused into a **picket fence** → stem quieted to 55%.
10. The roll floated above **a third of an empty surface** → row-height cap 16 → 22.
11. `getByTitle('Play')` matched a new **"Follow the playhead"** title (Playwright substring
    match) → title shortened to `Follow (F)`, spec untouched.

---

## 5. Deviations from spec §2 / §8, with reasons

| # | Spec | What shipped | Why |
|---|---|---|---|
| D-a | §2.1 utility cluster `↶ ↷ \| Grid \| Mix \| Export \| ⋯` | No undo/redo, no `⋯` | Undo/redo are document-scoped and already in the topbar 46px above; duplicating them forks a control and costs attention on stage. With punch + edit mode + zoom visible there is nothing left to overflow, and the two controls the shipped e2e clicks by role/title must stay visible anyway |
| D-b | §2.1 song name "click-to-rename inline" | Display only | There is **no `setSongName` verb**, and §10's missing-verb table does not list one. Inventing it here would fork the document model |
| D-c | §2.6 automation "header row 28px" | Controls in the 200px header column, field stays 96px | A 68px field is too shallow to place a point in, and it breaks the shipped ramp e2e (`dblclick y: 72`). The column also lines the controls up with the track header above them |
| D-d | §2.4 8-swatch colour popover | Native `<input type="color">` dressed as a swatch | The native picker is the only one that reaches the OS palette, and `ArrangementSurface.test.tsx:313` pins `getByLabelText('Colour for …')` + `fireEvent.change`. The visual defect (a blue dot on an orange track) is fixed |
| D-e | §2.7 velocity lane 64px | 56px (`VELOCITY_LANE_HEIGHT`) | Changing it moves `noteFieldHeight` for every roll; the 8px grip it would buy is not worth re-deriving the roll's layout in a visual pass |
| D-f | §8.2 drop-invalid "audio only" | Only `locked` | It is the one drop this document model actually refuses (`moveClips` skips locked clips). Warning about a drop that then succeeds would be a lie |
| D-g | §8.3 loading skeleton | None | The document is synchronous; per-clip waveform degradation already satisfies §8.3's own clip-granular sentence. See §1.9 |
| D-h | §2.5 clip "faulted host" | Wired to `usePluginFaultCards()` by `card.nodeId === track.ref` | The only per-node fault signal that exists. **UNVERIFIED** — see §6 |
| D-i | §8.1 "stale (edit not yet live)" | Not implemented | No per-clip staleness state exists in the model; a 500ms underline with nothing to drive it would be decoration |
| D-j | §2.3 corner on the piano-roll surface | Magnet + follow / grid chip, no tool strip | The corner is now 76px so the ruler registers with the notes; the roll's own toolbar already carries its five tools |

**Removed** (deliverable 11): `TransportStrip.tsx` and all `.arrangement-transport*` rules,
`.arrangement-transport__play` (a rule with no emitter), `.arrangement-record-error` (the
error moved to a chip — `rulerStack.test.tsx`'s `RULER_OFFSET_RULES` updated with the
reason), the two dead `height: 46px` declarations, the bespoke mixer-fader override, the
dot-grid backgrounds on every chrome surface, and a dead `<span>Velocity</span>`.
`.arrangement-lane-menu__quantize` kept (it is live). No `--transition-fast`, no retired
tokens, no literals.

---

## 6. UNVERIFIED — needs a founder pass with audio actually playing

- **Feel.** No-click / no-dropout during a clip drag while rolling, the level bead tracking a
  real signal, the mixer meter's 60ms lerp, the record pulse, stopped-only audible ruler
  scrub. Headless Chromium delivers no engine frames; **no harness of any class can sign
  this off.**
- **The faulted-clip treatment** (D-h). It renders correctly when a fault card matches, but
  no fault was injectable here, so the `card.nodeId === track.ref` mapping is unproven
  against a real plugin latch. If the mapping is wrong the treatment simply never fires — it
  cannot produce a false alarm.
- **The drop-invalid path** — reachable only with a `locked` clip, which no starter has.
(The 2px bars-row overflow is closed and re-measured — see §4.)

## 7. Still open / carried forward

- **The INLINE roll's 56px shear.** The full surface is pixel-locked (0px, measured); the
  inline lane's field still begins after its own scroomer + key bed. Closing it means either
  hiding 56px of notes behind the key bed or moving the key bed across the track grid into
  the header column — structural, not styling. Documented in `docs/timeline.md`'s honest gaps.
- `shouldAutoDetectDrums` false-positives on Paper Sketch's chord clip (≤16 distinct pitches,
  all 35–81). §9 behaviour, left frozen, now documented and escapable via the `Drums` toggle.
- The settings keybinding catalogue for the ~25 binding-set-local ids (TA2d carry-forward,
  not this lane).
- `oj-ui` asks in §2.

## 8. Docs

`docs/timeline.md` updated: "Entering and leaving the DAW" rewritten for the sky band, the
sticky/pixel-lock rule, the corner, the header + level bead, the mixer and automation
geometry; the ruler section gained the brace construction and the tick-rounding rule; a new
piano-roll paragraph covers the toolbar, the `⋯` popover, note colour, the key-bed
construction and the row-height clamp; the honest-gaps list swapped the now-shipped CSS
parcel for the three real remainders.

---

*Adversarially reviewed with real browser runs: 46 captures across two themes and two
viewports were opened and read, and eleven defects visible only in the pixels were found and
fixed before this report was written.*
