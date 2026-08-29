# W4-TBb — fix round on the timeline visuals

Fixes M1–M4, the section double-click regression, the doc drift and the key-title
collision from `W4-TB-REVIEW.md`, on top of the uncommitted W4-TB lane edits.

**Every claim below is a measurement.** The tree was probed in Chromium **before** any edit
(`plans/redesign-new-dna/.scratch/w4-tbb/before.json`, harness `tbb.ts`, run under `node`
on dev port 5229) and again after (`after2.json`), so each fix has a red number and a green
one. The before-run independently reproduced the review's own figures — 12 800 px² of ghost
on the header column, 432 px² of playhead, 1.65:1 on the softest note — which is the
harness validating itself against a measurement it did not make.

Artifacts: `plans/redesign-new-dna/.scratch/w4-tbb/` — `before.json` / `after2.json`,
32 captures, harnesses `tbb.ts` (main probe), `probe3–5.ts` (ground fill, mixer clearance,
playhead cap), `contrast_probe.mjs` / `ink_solve2.mjs` / `sel.mjs` (token maths).

One thing the review asked for could **not** be done as described, and the report says so
rather than hiding it: **lifting the note's alpha floor cannot on its own reach 3:1 in
light** — see item 3.

---

## 1 + 2. M1 + M2 — one field-clipped overlay pane

**Change.**
- `src/components/Arrangement/ArrangementSurface.css:240-259` — new
  `.arrangement-field-overlay` (+ `__origin`, `__surface`), `overflow: hidden`,
  `top: calc(var(--arrangement-sky-height) + var(--arrangement-ruler-height))`, `z-index: 10`.
- `src/components/Arrangement/ArrangementSurface.tsx:441-457` — the pane, sized inline to the
  scroller's field viewport (`left: headerWidth`, `width: fieldViewportWidth`,
  `height: view.height - RULER_HEIGHT`). The loop wash, range selection, snap hairline,
  playhead line, marquee, draw ghost and `DragGhostLayer` all moved out of
  `.arrangement-timeline-content` into it.
- `ArrangementSurface.tsx:85-90, 304` — `writeOverlayOrigin()` writes the counter-translate
  straight onto the DOM, **synchronously in `onScroll`** (and after every render), so the
  overlays never trail the clips they point at by a frame.
- `ArrangementSurface.tsx:45` — `SKY_HEIGHT = 56`, the JS twin of `--arrangement-sky-height`,
  pinned equal by test.
- `src/components/Arrangement/DragGhost.css:10-24` — the ghost layer is now a zero-sized
  origin; it no longer clips anything itself.
- `src/components/Arrangement/DragGhost.tsx:100-116, 156` — the readout is **clamped whole**
  inside the pane in a `useLayoutEffect` that measures its own box. It is measured rather
  than clamped against a constant because the chip's width is its text: `±0` and
  `12.4.480 +3.2.240` cannot share one number, and a guess would either crop the long one or
  park the short one early.
- `src/components/Arrangement/usePlayheadTransform.ts` (new) +
  `PlayheadLayer.tsx` — one writer, two elements. The playhead **line** rides the pane; its
  9px **cap** is a new `PlayheadCap` rendered inside `.arrangement-ruler-content`
  (`RulerStack.tsx:246-252`), whose `.arrangement-ruler-viewport` already starts at the
  header edge and already clips. So the cap keeps the bars row the spec gives it and still
  cannot reach the 200px corner. `ArrangementSurface.css:695-721`.

**Why a clip and not a z-index.** The rule these overlays share is not an order — it is a
boundary: *above the clips, never on the chrome*. The ghost must outrank the clip it is
moving, so it cannot go under the header; and the review is right that no single ladder can
express both at once. A clip can.

**Pinning test.** `src/components/Arrangement/__tests__/fieldOverlay.test.tsx` (new, 5 tests).
It asserts the CSS states the boundary as a clip (`overflow: hidden`, `z-index` above both
`.arrangement-ruler-shell` and `.arrangement-track__header`), that the pane is exactly the
field viewport, that all seven transient overlays are descendants of `[data-field-overlay]`
and of nothing inside `.arrangement-scroll`, and that the origin transform tracks the live
scroll — from which the playhead's pane-local x is `tick·pxPerTick − scrollLeft`, i.e.
negative behind the pane's left edge, which *is* the header's right edge.
*Fails on the old code trivially:* `[data-field-overlay]` does not exist, so `mount()` and
`ruleBody('.arrangement-field-overlay')` both throw.

**Measured** (`before.json` → `after2.json`, 1280×800, both themes, field scrolled right
420px, cross-track drag). `getBoundingClientRect` reports the border box and never shows an
ancestor's clip, so the probe intersects each element with the pane first — the *visible*
rect is what may not touch chrome:

| | before | after |
|---|---:|---:|
| ghost ∩ header column (light / dark) | **12 800 px²** | **0 / 0** |
| ghost ∩ ruler stack | 0 | 0 |
| drag readout ∩ header column | **2 266 / 1 694 px²** | **0 / 0** |
| readout wholly inside the pane | `false` | **`true`** |
| snap hairline ∩ header column | 200 px wide, unclipped at x −210 | **0 / 0** |
| playhead ∩ header column @ scrollLeft 60 / 150 / 199 | **432 px² each** | **0 / 0 / 0** |
| playhead cap ∩ the 200px corner @ scrollLeft 0 / 150 / 420 | (cap was on the line, z 9) | **0 / 0 / 0** (box overlap 45 / 90 / 0, all clipped) |
| pane vs mixer drawer, mixer open | — | pane bottom 612 = mixer top 612, **no overlap** |

Captures: `after2-light-ghost-scrolled.png`, `after2-dark-ghost-scrolled.png` (ghost sliced
exactly at x=200, all three track headers legible, readout at x=274 inside the field),
`after2-{light,dark}-playhead-scroll400.png`, `after2-light-cap-scrolled.png`,
`after2-light-mixer.png`. Before: `before-light-ghost-scrolled.png` (readout painted at
x=84, inside the header column, over the track name).

---

## 3. M3 — the transport pill can no longer cover the sky band's utility cluster

**Which fix, and why.** The review offers a symmetric reserve **or** a restored `⋯`
overflow. I took the **symmetric reserve**, plus wrapping. Three reasons, and the third is
the deciding one:

1. It fixes the *cause*. The band's reserve was one-sided (`.arrangement-sky__gap` was a
   `flex: 0 0 clamp(220px, 26vw, 420px)` that only protected the song name). The pill is
   `position: fixed; left: 50%` — centred on the **window**, not on any column — so a
   one-sided reserve protects exactly one side by construction.
2. It is geometric, not a breakpoint guess: the cluster *cannot* enter the centre lane at
   any width.
3. **M3's own requirement rules the `⋯` out.** "Which edit mode is armed must always be
   visible" and "put the tail behind a click" are the same failure at different speeds — and
   at 900px the tail that would have to go is `Export`, `Mix`, `P`, i.e. most of the
   cluster. Below 1024 the controls compact and then **wrap to a second 24px row inside the
   same 56px band** instead. Nothing leaves the surface.

**Change.** `ArrangementSurface.css:29-37` (`--arrangement-sky-pill-reserve: 432px` — the
pill's measured 428px full-zone width plus a 4px shoulder), `:90-101` (`display: grid;
grid-template-columns: minmax(0,1fr) var(--…-pill-reserve) minmax(0,1fr)`), `:133-149`
(cluster wraps, `.arrangement-sky__gap` is now just the empty middle cell), `:958-975`
(≤1024px compaction; the zoom chip is the only control that leaves, at ≤900px, and
`Ctrl+wheel` / `+` / `-` / `Ctrl+0` all still reach it).

**Pinning test.** `rulerStack.test.tsx` → *"reserves the pill lane on BOTH sides of the sky
band"*: the band is a grid, the centre column is the reserve variable, **the two side
columns are byte-identical** (that is the symmetry claim), the reserve is ≥ 428px, the
one-sided flex gap is gone, the cluster wraps, and no rule hides `.arrangement-edit-mode`.
*Fails on the old code:* `.arrangement-sky` was `display: flex`.

**Measured** — the pill rect against every control in the cluster:

| width | worst pill ∩ control, before | after | armed `Slide` occluded (`elementFromPoint`) before → after |
|---:|---:|---:|:--|
| 1280 | 0 px² | **0 px²** | no → no |
| 1024 | **1 152 px²** (on `Slide` itself) | **0 px²** | **yes** (`oj-kbd oj-transport__hint`) → **no** |
| 900 | **1 008 px²** (on `Slide`) | **0 px²** | **yes** → **no** |

At 1024 the cluster is `Slide Ripple P Mix Export` on row 1 and `21 bars` on row 2; at 900
it is `Slide Ripple P Mix` / `Export`. No control is clipped (`utilityClipped: false` at all
three widths). Captures: `after2-sky-{1280,1024,900}.png` vs `before-sky-{1024,900}.png`.

---

## 4. M4 — piano-roll notes clear 3:1 at every velocity, and the gates measure the composite

**What the review asked for, and what is actually possible.** "Lift the note alpha floor in
light" cannot reach 3:1 on its own: `--universal-connection` at **100% opacity** is only
**3.35:1** on a white-key row and **3.20:1** on a black-key one, so any floor short of full
opacity still fails and full opacity would delete the velocity ramp. The colour had to move
too. The review's own parenthesis anticipated this ("or … darken acc2 in light with an
`accent-two-ink`"); I did both halves.

**Change.**
- `src/components/PianoRoll/geometry.ts:41-58` — `velocityOpacity` is now
  `0.68 + 0.32·v/127` (was `0.45 + 0.55·v/127`). Monotonic, clamped, still exactly `1` at
  velocity 127.
- `src/components/PianoRoll/PianoRoll.css:20-33` — new
  `--piano-roll-note-ink: color-mix(in oklab, var(--universal-connection) 60%, var(--text-primary))`,
  used at `:238`. It is *derived*, not a token, because there is no `--accent-two-ink` and
  `packages/oj-tokens` is another lane's territory — but `--text-primary` flips with the
  theme, so this one expression darkens in light and lightens in dark exactly as an ink
  token would. There is no `[data-theme]` selector in this app (themes are applied as inline
  custom properties on `:root` by `applyTheme`), so a light-only override was not available.
  When `--accent-two-ink` lands, that one line is the only thing that changes.

**Gates rewritten to measure the composite.** `Arrangement/__tests__/contrast.test.ts:59-96,
118-135`. The two `universalConnection` gates asserted the **full-opacity token pair** — a
gate that could not fail the way the pixels failed. They are replaced by three gates that
composite the ink at the alphas `velocityOpacity` actually emits, over the white-key row,
the black-key row (`lane-alt` at its real 45% over the lane) and the clip body, at
velocities 0/1/32/64/96/127; plus a monotonicity gate. **Both constants are read from the
code that ships** — the ramp by importing `velocityOpacity`, the ink weight and the
black-row alpha by parsing `PianoRoll.css` — so a gate that only agrees with itself is not
possible. `PianoRoll/__tests__/geometry.test.ts:12-22` pins the ramp's shape.

*Fails on the old code:* reverting both values and re-running printed
`velocity 0: expected 1.6535227159461137 to be greater than or equal to 3` and
`expected 1.6279159530086769 …` — the review's 1.65 / 1.63, reproduced by the new gate.

**Measured in the browser** (canvas-composited: the row ground painted, then the note
painted on top, then the pixel read — `getComputedStyle` returns `oklab(…)` here and string
parsing silently lies):

| velocity | alpha | light vs white-key row | light vs black-key row | dark vs white | dark vs black |
|---:|---:|---:|---:|---:|---:|
| 0 (softest) | 0.680 | **3.20** | **3.10** | **4.84** | **4.90** |
| 1 | 0.683 | 3.23 | 3.14 | 4.86 | 4.96 |
| 32 | 0.761 | 3.82 | 3.71 | 5.72 | 5.86 |
| 64 | 0.841 | 4.59 | 4.39 | 6.67 | 6.82 |
| 96 (default) | 0.922 | 5.50 | 5.27 | 7.73 | 7.92 |
| 127 (loudest) | 1.000 | 6.65 | 6.36 | 8.92 | 9.15 |

Before, for the same six velocities in light: **1.65 · 1.66 · 1.96 · 2.33 · 2.80 · 3.35**
(white-key row) and **1.63 · 1.64 · 1.92 · 2.26 · 2.68 · 3.20** (black-key row).

Captures: `after2-{light,dark}-velocity-ladder.png` — three real `.piano-roll-note` elements
mounted at velocity 0 / 64 / 127 by the shipped rule (Paper Sketch's notes are all one
velocity, so the honest way to show the ramp is to paint it, not to fake it), plus
`after2-{light,dark}-pianoroll.png`.

---

## 5. The section double-click regression — `Alt` is the mark gesture

**Change.** `src/components/Arrangement/RulerStack.tsx:200-215` — the rename branch is now
guarded by `!event.altKey`, so `Alt`+double-click falls through to `addMarkerAt`.

**Why `Alt` and not the marks strip.** `.arrangement-section-chip__label` is
`display: block`, so it fills the chip — that is what made double-click-to-rename reachable
at all — and on Paper Sketch the sections cover the whole song, which left marker creation
by hand with no gesture anywhere (the gate measured `marksAfter 1 → 0`). Alt is already this
surface's *do the other thing* modifier: Alt+drag on the brace row makes a punch, Alt+drag
in the field is an object marquee. Rename stays the plain double-click because renaming is
far the commoner act. Documented in `docs/timeline.md`.

**Pinning tests.** `rulerStack.test.tsx` gains *"the chip label fills the chip, so there is
no empty band left to press"* (reads the CSS) and *"ALT + double-clicking a chip LABEL drops
a marker and opens no rename"*. The old *"chip EMPTY BAND"* test is retired: it pressed the
chip **element**, which a real pointer can never hit, so it kept passing while the browser
did not — the exact fiction that let this regression through. *Verified red on the old
behaviour:* removing `!event.altKey &&` and re-running gives `1 failed | 11 passed`.

**Measured in the browser**, plain and Alt double-click on the same chip label:

| | before | after |
|---|---|---|
| plain dblclick → rename inputs | 1 | **1** (unchanged) |
| plain dblclick → marks created | 0 | **0** (unchanged) |
| **Alt**+dblclick → marks created | **0** | **1** |
| **Alt**+dblclick → rename inputs | **1** (wrong) | **0** |

Captures: `after2-section-rename.png`, `after2-section-mark.png`.

---

## 6. Doc drift — `docs/timeline.md`

- **§9's named item:** line 47 said the level bead is `--accent-success`; it is
  `--success-ink`, and the doc now says why (2.99:1 on the header in light).
- The sky band paragraph gains the symmetric reserve, the ≤1024 compaction and the wrap.
- A new paragraph describes the field overlay pane, the DOM-written counter-translate, the
  clamped readout and the cap-in-the-ruler construction.
- The gesture paragraph now describes plain / `Alt` double-click correctly (it previously
  described an "empty band of a section chip" that does not exist).
- The piano-roll paragraph now states the note ink, the 0.68 floor and why both numbers are
  set by the contrast floor rather than by taste.
- The ruler paragraph records `SKY_HEIGHT` as the second JS/CSS twin.
- Honest gaps gain the accent-ring-on-note measurement and the missing `--accent-two` token.

I re-read §9 in full: line 47 is the only drift it names ("Otherwise the doc rewrite is
accurate"), and it is fixed.

---

## 7. Key title collision

`src/components/Nodes/KeyboardVisualNode.tsx:309-320` —
`title={\`${key} — plays on row ${row}\`}` → `` `${key} · row ${row}` ``. Playwright's
`getByTitle` substring-matches case-insensitively, so "**play**s" made all ~30 keys
candidates for the transport's Play button. The a11y name is untouched and still meaningful
(`aria-label="Row 2, key W"`), and the tooltip states the same fact minus the verb. No e2e
selector was weakened — no `e2e/**` file was touched at all
(`git diff --stat -- e2e` is empty).

**Both named specs pass, 10/10, unedited** (see §8).

---

## 8. Verification

All run **after** the last source edit.

| Gate | Result |
|---|---|
| `bun run test:run -- src/components/Arrangement src/components/PianoRoll src/song src/store src/keymap` | **61 files / 654 tests green** |
| `bunx tsc --noEmit -p tsconfig.app.json` | **clean, exit 0** |
| `bunx eslint src/components/Arrangement src/components/PianoRoll src/components/Nodes/KeyboardVisualNode.tsx` | **clean, exit 0** |
| `git diff --check` | **clean** (only the repo's usual CRLF notices) |
| `bunx vite build` | **exit 0** — the bundle itself builds |
| `bun run build` (`tsc -b && vite build`) | **red on ONE foreign file**, see below |
| `node node_modules/@playwright/test/cli.js test e2e/arrangement-editing.spec.ts e2e/timeline-preview.spec.ts --project=chromium` | **10 passed (13.6s)**, against a bundle rebuilt from this tree |
| Browser probe, light + dark, 1280 / 1024 / 900 | **32 captures, 0 console errors, 0 page errors** |

**`bun run build` is red on another lane's file**, not on this diff:
`src/engine/__tests__/nodeTypeMigrations.test.ts(86,25): TS2339 Property 'data' does not
exist on type '{ type: string; }'`. `src/engine/**` belongs to a concurrent lane and appeared
red mid-session; `tsconfig.app.json` (the project the brief names) is clean, and
`bunx vite build` — the bundle the e2e actually runs against — is exit 0. The e2e was run
against a bundle rebuilt with every change in this round.

An earlier full-scope run reported 5 failures in `src/store/__tests__/graphStore.test.ts`
(*canvas reliability verbs*) while another lane was editing `src/store/graphStore.ts` live —
its mtime moved **during** that run. That lane settled and the final run above is 654/654.
Neither file is in this diff.

The e2e run went `9 passed, 1 failed` once at 8 workers — `openPaperSketch` timed out waiting
for the canvas context menu's `Add Song`, before touching any timeline assertion. Re-run
alone (`--workers=1`) and again at `--workers=4`: **10/10**. It is a load flake in the canvas
menu path, not the review's `getByTitle('Play')` collision, which is closed. Playwright ran
under `node` throughout (`node node_modules/@playwright/test/cli.js`), never under bun.

---

## 9. One extra, from review §8.2 — the field now runs to the bottom of the window

The review called this "worth a two-line fix in this pass": `.arrangement-field-ground` was
`offsets.at(-1)` tall while the scroller is 698px, leaving ~418px of bare `--bg-canvas`
under the last track — "a faint seam in light, a hard black band in dark", and the dark
capture confirmed it exactly. `ArrangementSurface.tsx:291, 424-425`: the ground and the
past-end wash are now `Math.max(offsets.at(-1), view.height - RULER_HEIGHT)`. The **lanes**
still end where the tracks end; only the paper continues. Measured: ground now spans
y 166 → 800 (was 166 → 382), scrollHeight unchanged at 698 (no new scrollbar).
Captures: `after2-{light,dark}-groundfill.png`.

Flagged explicitly because it is outside the seven items, is a visual change to reviewed
work, and should get a taste look.

---

## 10. Review §10 follow-ups

**Done.**
- **§10.2 — mark creation has a gesture again.** Item 5 above.
- **§10.3 — gate 4's `control.renameInputs 1 → 0`.** Confirmed **probe ordering**, not a dead
  first double-click: on a freshly loaded Paper Sketch the very first plain double-click on a
  section chip's label opens the rename (`renameInputsOnPlainDblclick: 1` in both `before.json`
  and `after2.json`, and again in the light and dark runs). No code change needed.

**Deferred, with reasons.**
- **§10.1 — the inline roll's ~56px shear.** Structural (the key bed lives inside the lane
  rather than in the header column), unchanged, still disclosed in `docs/timeline.md`.
- **§10.4 — the master mixer strip has no fader and no M/S.** There is no `setMasterGain`
  verb; a *disabled* fader would be a control that cannot be operated, and inventing the verb
  here is the fork the W4-TB report already refused. Needs an owner decision, not CSS.
- **§10.5 — `shouldAutoDetectDrums` false-positives on Paper Sketch's chord clip.** §9
  behaviour, documented and escapable via `Drums`. (Visible in `after2-light-pianoroll.png`,
  where the roll opens in drum rows.)
- **§10.6 — the oj-ui asks** (`--accent-two` / `--accent-two-ink`, a vertical `Slider`, a
  `Popover` primitive, a `role="radiogroup"` `SegmentedControl`). Still open and now more
  pointed: this round had to *derive* the note ink from `--universal-connection` because
  `--accent-two-ink` does not exist. Recorded in `docs/timeline.md`'s honest gaps.
- **§10.7 — feel.** Unchanged; see below.
- **§8.1 — the 12% clip wash reads 1.04:1 against a white lane.** Not touched: it is a taste
  call on the whole clip language (the 12%→18% selected shift is paired with it), it is not a
  floor failure, and it is not one of the seven items.

---

## 11. What I could NOT verify

- **Feel.** No-click / no-dropout during a clip drag while rolling, the level bead on real
  signal, the meter lerp, the record pulse, stopped-only audible ruler scrub. Headless
  Chromium delivers no engine frames. Unchanged from W4-TB: **needs a founder pass with audio
  playing.** The one thing this round adds to that list is the readout's per-frame
  `offsetWidth` read (see risks).
- **The playhead line under a *rolling* transport inside the pane.** Its transform is written
  by the same shared frame writer as before and the e2e proves the transform changes on Play,
  but the pane's counter-translate under simultaneous scroll + playback was not observed with
  real frames.
- **The faulted-clip mapping and the drop-invalid path** (W4-TB D-h / D-f). No fault or
  `locked` clip is reachable headlessly. Unchanged.
- **The pre-fix dark measurements in `before.json` are actually light.** The probe wrote
  `localStorage['openjammer-theme'] = '"dark"'` (JSON-quoted), which the theme store rejects,
  so it fell back to light; the bug was found and fixed before the `after2` run, where dark is
  genuinely dark (grounds `[32,31,25]` / `[29,29,22]`). The *before* dark numbers I quote are
  therefore light-theme numbers — but the review measured the dark case independently and
  agrees, and every **after** number is measured in the real theme.

## 12. Risks

1. **The readout's `useLayoutEffect` measures `offsetWidth` once per drag frame.** That is a
   forced layout read on the drag path. The browser lays out that frame anyway (the ghost's
   transform changed), and nothing on the audio path is touched — but it is the only new
   per-frame DOM read in this diff and it belongs on the founder's feel pass.
2. **Dark notes are paler than before.** The ink mixes toward `--text-primary`, which in dark
   means toward white, so the violet lightens (measured 4.84:1 → 8.92:1 across the ramp).
   That is a real change to a look the review praised. It was unavoidable without a
   theme-conditional selector, which this app does not have. Judged against the captures it
   reads well; it deserves a taste look.
3. **The sky band wraps to two rows below ~1000px.** At 900 that leaves `Export` alone on the
   second row. Correct and legible, but it is a new layout state nobody has seen.
4. **The accent ring on a selected note is still below 3:1** — measured 1.98:1 light /
   1.47:1 dark at velocity 127 (it was 1.00 / 1.01 before this change, so it improved at the
   loud end and worsened at the quiet end: 2.03 → 1.04 light at velocity 0). `--acc` and
   `--acc2` are near-isoluminant by design, so this cannot be fixed locally; the selected
   state is carried by the ring plus the focus halo. It is now **recorded by a gate** rather
   than asserted, and named in `docs/timeline.md` next to the same question for the clip
   selection outline on a tinted fill (2.98–3.04:1). Spec-level, §2.5 / §2.7.
5. **Another lane is editing the tree live** (`src/store/graphStore.ts` went red and green
   again mid-session; `src/engine/__tests__/nodeTypeMigrations.test.ts` is red now and holds
   `tsc -b` down; `src/components/Nodes/**`, `src/engine/**`, `src/rigs/**` are all dirty from
   other lanes). The gates above were run against a moving tree; re-run before merging.

---

# TB-c — the fix round after W4-TBB-REVIEW

Both must-fixes (F1, F2) and four of the non-blocking follow-ups (1, 2, 3, 5), each pinned
by a test that goes **red** on the pre-fix code. Artifacts:
`plans/redesign-new-dna/.scratch/w4-tbc/` — harnesses `lib.ts`, `t1`–`t3` (+ `t1b`, `t1c`,
`t2b`, `t2c`, `t3b`), results `t1.json`…`t3.json`, `gate-revert.mjs` / `gate-revert.txt`,
`tint-contrast.mjs` / `tint-revert.mjs`, `e2e-baseline.mjs`, logs `vitest.txt`, `tsc.txt`,
`eslint.txt`, `build.txt`, `e2e.txt`, 12 captures. Playwright ran under **node** throughout;
one Chromium, dev port **5229**, stopped.

## Every gate goes red on the pre-fix code

`gate-revert.mjs` applies each change's exact inverse to the shipping source, runs that
change's own test, and restores the file (`gate-revert.txt`):

| revert | gate |
|---|---|
| drop `isolation: isolate` | **RED** |
| compaction back at 1024px | **RED** |
| cap without the live counter-scroll | **RED** |
| cap back inside `.arrangement-ruler-content` | **RED** |
| reserve back to the literal `432px` | **RED** |
| host stops publishing its width | **RED** |
| the `title` removed | **RED** |
| clip tint raised to 16% (section 8.1's own suggestion) | **RED** |

The first pass of the F1 gate came back **green** on the revert — `toContain('isolation:
isolate')` was matching the *comment* that explains the declaration. It now matches the
declaration on its own line (`/^\s*isolation:\s*isolate;\s*$/m`). A gate that reads its own
rationale is the same defect as one that restates a constant.

## 1 — F1: `isolation: isolate` on `.piano-roll`

`src/components/PianoRoll/PianoRoll.css:51` (the declaration; :35–50 is the reason, inside
the `.piano-roll` rule that opens at :14).

The roll was `position: relative` with no `z-index`, so it opened no stacking context and its
scroomer (5) / playhead (6) / marquee (7) / brackets (9) were compared directly with
`.arrangement-track__header` (z 5), winning on DOM order.

Browser (`t1.json` / `t1b.json`, `elementFromPoint` on a 6px lattice over the whole header
column, 3 828 samples per pass, both themes, inline roll open on the Nylon Chords clip):

| scrollLeft | roll pixels over the header | owners |
|---:|---:|---|
| 0 / 150 / 420, light | **0 / 0 / 0** | — |
| 0 / 150 / 420, dark | **0 / 0 / 0** | — |
| 150, `isolation` reverted at runtime | **54** | `piano-roll__scroomer` 51, `piano-roll__scroomer-window` 2, `B` 1 |

The 54 reproduces the review's number exactly, from a probe that did not make it. The roll
still renders (128 notes, scroomer present, `isolation: isolate` computed).
**The field must actually be scrolled for this to exist at all**: at the default zoom Paper
Sketch's content is 1280px wide in a 1280px viewport, so `scrollLeft` is pinned at 0 and the
roll's left edge never leaves the header edge. The probes zoom in 4 steps first
(`scrollWidth 1984`); a sweep that skips that measures nothing.
Captures `t1-{light,dark}-roll-scroll150.png`, `t1b-reverted-scroll150.png`.

Pinned by `fieldOverlay.test.tsx` → *"the inline piano roll cannot paint on the chrome
either"* (2 tests): the declaration is present with its reason, and every roll z-index that
would outrank the header is enumerated so the gate names the collision rather than a number.

## 2 — F2: the compaction breakpoint is the wrap

`src/components/Arrangement/ArrangementSurface.css:969-986` (`@media (max-width: 1180px)`,
the four control-compaction rules) and `:988-990` (`@media (max-width: 1024px)`, the `Tab`
hint alone). The `.arrangement-sky__utility` comment at `:141-150` said "Below ~1000px" and
now states the real threshold.

Browser sweep 1300 → 780 in **10px steps, 53 widths** (`t2.json`, `t2b.json`):

| | worst cluster overflow | worst cluster ∩ ruler | offending widths |
|---|---:|---:|---|
| shipping | **−0.41 px** | **0 px²** | **none** |
| media query reverted to 1024 through the CSSOM | **+2.19 px** | **777.6 px²** | 1030…1170 (15 widths) |

With the revert, `elementFromPoint` at the zoom chip's bottom returns
`arrangement-sections-row`; with the fix it returns the chip itself. Cluster height by width:
one 30px row above 1180, one 28px compacted row from 1180 to ~1100, two compacted rows
(55.19px) below — i.e. 1100–1180 went from two rows to **one**, strictly better than before.
Captures `t2-sky-1170.png`, `t2-sky-1100.png`, `t2b-reverted-1170.png`.

`docs/timeline.md:33-52` rewritten: the three widths in the order the band gives way
(**≤1180 compact**, ≤1024 hint, ≤900 zoom chip), with the 63-vs-56px arithmetic that makes
1180 the right number.

Pinned by `rulerStack.test.tsx` → *"compacts the cluster at the width it starts wrapping,
not 150px later"*: a brace-matched `mediaBlock()` reader asserts each of the four rules is
inside the 1180 block, that the hint is alone at 1024, that compaction is **not** still at
1024, the ordering of the three widths, and that the doc no longer teaches 1024.

### 2b — NEW, out of scope, reported not fixed: the alert chip forces a third row

The same sweep, run in the state where `.arrangement-sky__alert` is present (the headless
engine never acknowledges the transport, so the failure chip joins the cluster after the
1.5s timeout — a real state, not an artefact), **fails the same criterion**:

| | worst overflow | worst cluster ∩ ruler | offending |
|---|---:|---:|---|
| cluster as designed (5 controls) | −0.41 px | 0 px² | none |
| **+ the transport-failure chip** | **+24.19 px** | **7 621 px²** | 1270–1300 and **1030 → 780** |

`elementFromPoint` at the lowest control's bottom returns `arrangement-braces-row` /
`arrangement-sections-row`. Cause: a full-sentence chip costs a row's worth of width, and
three compacted rows are 24+3+24+3+24 = 78px in a 56px band — no compaction can fix that.
I swept candidate `max-width`s for the chip (`t2c.json`): even at **10ch** (79px) it still
overflows below 840px, so shrinking the text is not a fix. The two constructions that work
are (a) the chip becomes an **icon-only** warning glyph below the compaction width, with the
message on `title` and in the existing `aria-live` region, or (b) the band grows when an
alert is present, which spec 8.3 forbids ("never a banner that pushes the ruler off the bar
you were reading"). That is an information-design decision about how a failure degrades, not
a patch, so it is **reported rather than invented**. Pre-existing — the chip overflowed
before this round too, and the W4-TBb sweep never provoked it.
Capture `t2-alert-overflow-1000.png`. Related: the chip truncates at 34ch with an ellipsis
and carries **no `title`**, so the rest of the message is unreadable at any width.

## 3 — the playhead's line and cap no longer tear

`usePlayheadTransform.ts` (rewritten; the registry at :17-28, the hook at :55-79),
`PlayheadLayer.tsx:32-48`, `RulerStack.tsx:249-262` (the cap moved out of
`.arrangement-ruler-content` into `.arrangement-ruler-viewport`),
`ArrangementSurface.tsx:97-100` (the registration) and `:312-325` (the handler),
`ArrangementSurface.css:728-748`.

One registry, one call. `onScroll` invokes `writeScrollTransforms()` **once**; the field
overlay pane's origin (which carries the LINE, the ghost, the readout, the hairline and the
marquee) and the CAP are both registered writers, so nothing can move one without the other.
The cap counter-translates itself by the live `scroll.scrollLeft` — it had been riding the
ruler content's React-committed `translateX`, one frame behind.

Browser, per-rAF sampling of both boxes' tick x (`t3.json`), Paper Sketch zoomed 4 steps:

| run | max abs(line − cap) | at rest | line vs the clips | line vs the ruler's bars row |
|---|---:|---:|---:|---:|
| real wheel, 5 notches | **0.328 px** | 0.328 | 0.00 | **150 px** |
| real wheel, 16 notches (the W4-TBb shape) | **0.328 px** | 0.328 | 0.00 | **150 px** |
| rAF-paced 18 px/frame | **0.000 px** | 0.000 | 0.00 | 18 px |

Was **150 px** on a notch (`W4-TBb g2b.json`). The `line vs bars row` column is that same
lag, still there and unchanged — it is the ruler's rows, and the point of the fix is that the
cap is no longer on that side of the boundary.

**The residual 0.328 px is not the writer.** Both transforms are exactly equal; diagnosed in
`t3b.ts`: at maximum scroll the sticky `width: 100vw` ruler shell's viewport rect reports
`left: 199.672` instead of 200, and the cap rides that box. At scrollLeft 0 / 60 / 150 / 199
/ 400 the delta is **0.000**; it appears only at the scroller's last pixel. Below the 0.5px
bar, and it moves the whole ruler, not the cap alone.

The cap still cannot reach the 200px corner: `capPaintedOverCornerPx2 = 0` at every
scrollLeft (its border box overlaps by up to 90px², the ruler viewport clips all of it), and
`linePaintedOverHeaderPx2 = 0` — the M1/M2 containment is intact through the move.

Pinned by `fieldOverlay.test.tsx` → *"the playhead line and its cap are written by one
scroll-synchronous writer"* (3 tests): the cap is outside the box that lags and inside the
one that clips; the handler contains `writeScrollTransforms();` and **not**
`writeOverlayOrigin();`; and one `fireEvent.scroll` leaves both transforms current, with
`lineX − capX === 0` computed from the real DOM at 0 / 37 / 150 / 512 / 2048.

## 4 — the pill reserve is a coupling, not a copied measurement

`TransportPillHost.tsx:59-94` (one `ResizeObserver`, write only when the width changes by
0.5px or more, property removed on unmount), `ArrangementSurface.css:32-53`:
`--arrangement-sky-pill-reserve: calc(var(--oj-transport-pill-width, 428px) + 4px)`.
`--oj-transport-pill-width: 428px` is declared in the same `:root` — the directory is gated
against undeclared custom properties, and a reserve that collapsed to nothing if the host
stopped publishing would bring M3 back with every test green.

Browser (`t2.json` → `summary.pill`): `grid-template-columns` resolves to
**`420.062px 431.875px 420.062px`** — the centre column is the published `427.875px` + 4,
and the two side columns are byte-identical.

| viewport | pill | pill ∩ any utility control | ∩ cluster | ∩ ruler | ∩ song name | armed mode |
|---:|---:|---:|---:|---:|---:|---|
| 1920 / 1280 / 1024 / 900 / 800 | 427.88 px | **0 px²** | **0 px²** | **0 px²** | **0 px²** | `Slide`, reachable |

Pinned by `rulerStack.test.tsx` → *"derives the pill lane from a width the pill publishes"*
(the exact `calc()`, a literal reserve rejected, the fallback at least 428, the declaration
present, one observer, the change guard) and by three new `TransportPillHost.test.tsx` tests:
the measured width is written on `documentElement`, a re-observation at the **same** width
writes nothing, and unmount removes the property rather than leaving a stale one.

## 5 — Alt+double-click has an affordance

`RulerStack.tsx:276` (the comment at :265-275) — `title="Double-click to rename · Alt+double-click to add a marker"` on
`.arrangement-sections-row`, so it covers both the chips (which have no title of their own
and inherit the row's) and the uncovered strip: the two gestures it describes.
`docs/timeline.md:176-180` carries the same sentence.
Pinned by `rulerStack.test.tsx` → *"says out loud that Alt is what drops a marker on a
covered row"*.

## 6 — the M4 gate now measures the ground that ships

`contrast.test.ts:40-61` (the derivation) and `:120-133` (the rows). The `['a clip body', …, 'timelineClipBg']` row was a
duplicate of the white-key row (`--timeline-clip-bg` equals `--timeline-lane-bg` in both
themes). It is replaced by **five** rows, one per `TRACK_TINTS` entry, composited over
`color-mix(in oklab, var(--track-tint) N%, var(--timeline-clip-bg))` — the palette imported
from `trackTint.ts`, the `N` parsed out of the `.arrangement-clip` rule, neither re-typed.
`var(--accent-secondary)` → `accentSecondary` is derived, so adding a tint adds a row.

Composited at the alphas `velocityOpacity` emits (`tint-contrast.mjs`, reproducing the
review's 3.01):

| tint | light v0 → v127 | dark v0 → v127 |
|---|---|---|
| accentSecondary | 3.04 → 5.95 | 4.25 → 7.34 |
| accentSuccess | 3.04 → 5.92 | 4.30 → 7.47 |
| audioConnection | **3.01** → 5.82 | 4.31 → 7.48 |
| universalConnection | **3.01** → 5.89 | 4.33 → 7.51 |
| accentWarning | 3.06 → 6.04 | 4.23 → 7.29 |

And it has teeth the old row did not (`tint-revert.mjs`), worst light at velocity 0 —
shipping **3.01**; tint at 16% **2.93 RED**; tint at 18% **2.90 RED**; ramp reverted to 0.45
**1.98 RED**; ink reverted to raw `--acc2` **2.04 RED**; both **1.58 RED**. Section 8.1's own
"consider 16–18% tint in light" now fails the gate instead of breaking the floor silently.
Two further tests assert the parse is real, the palette is non-empty and every key exists,
and that the clip ground is genuinely a different colour from the lane — the exact way the
old row was a no-op.

## Gates

| gate | result |
|---|---|
| `bun run test:run -- src/components/Arrangement src/components/PianoRoll src/song src/store src/keymap` | **62 files / 680 tests green** (`vitest.txt`) — was 61 / 654 |
| `bun run test:run -- src/components/Shell` | **7 files / 49 tests green** |
| `bunx tsc --noEmit -p tsconfig.app.json` | **clean, exit 0** (`tsc.txt`) |
| `bunx eslint src/components/Arrangement src/components/PianoRoll src/components/Shell` | **clean, exit 0** (`eslint.txt`) |
| `git diff --check` over the changed files + a trailing-whitespace scan of the two untracked ones | **clean** |
| `bunx vite build` | **exit 0** (`build.txt`) |
| e2e, `--workers=1`, fresh bundle, under `node` | **10/10, exit 0** (`e2e.txt`) — 6 clean, 4 green on retry |
| browser probes, light + dark, 780 → 1920 | **12 captures, 0 console errors, 0 page errors** across every harness |

**The e2e flakiness is the box, not the change, and it was measured rather than asserted.**
Three unretried runs failed 4, 4 and 6 of 10, always with the same signature — the `Tab`
surface switch never happens and the page snapshot still shows the canvas, i.e. the failure
lands *before* the arrangement surface mounts, in a path this round does not touch. A
concurrent lane is running its own dev server (port 5231), Playwright harnesses
(`.scratch/w6-cap/cap*.mjs`), `tsc` and `eslint` in this same worktree at ~50% CPU. So I
built the tree with **every TB-c runtime change reverted** and ran the same suite
(`e2e-baseline.mjs`, `e2e-baseline.txt`): the baseline was **worse** — 5 failed, 1 flaky —
against TB-c's 3 failed / 3 flaky in the adjacent run. The final run above, on a quieter box,
is 10/10 with every retry succeeding.

## Carried forward

- **The alert chip overflow (2b)** — measured, not fixed; it needs the icon-only decision.
- W4-TBb follow-ups **4** (the note selection ring, spec 2.7), **6** (`--accent-two` /
  `--accent-two-ink`), **7** (`fieldOverlay.test.tsx`'s literal-arithmetic assertion — left
  alone; the three new tests beside it read the real DOM), **8** (the cap's apex sits 0.75px
  left of the stopped line's centre: the line is drawn to the right of its tick, the cap is
  centred on it — a naming convention, untouched here), **9** (the inline roll's ~56px
  shear), **10** (feel, founder pass with audio playing).
- The ruler's three rows and the grid anchor still ride the React/rAF `translateX` that spec
  2.1 outlaws — 150px of lag on a wheel notch, unchanged. The cap is simply no longer on that
  side of the line. Closing it needs the grid-canvas over-draw decision (W4-TBb 12.1).
