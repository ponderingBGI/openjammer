# W4-TB — review (timeline visual redesign)

**Verdict: DO-NOT-COMMIT as-is.** Four must-fixes, three of them found by driving the
surface rather than reading it. The redesign itself is good — the geometry is exact, the
pixel-lock claim is true, dark reads as designed and not inverted, and the level-bead
contrast fix is real and correctly reasoned. What blocks it is that **three overlays are
not clipped to the ruled field**, so the sticky header column and the ruler stack — the two
things the spec's shell contract says are always there — are painted over during ordinary
scrolling and during every clip drag.

Scope reviewed: uncommitted `src/components/Arrangement/**` (incl. new `SkyBand.tsx`,
`clipPaint.ts`, `trackTint.ts`, deleted `TransportStrip.tsx`), `src/components/PianoRoll/**`,
`src/store/editingContextStore.ts`, `docs/timeline.md`, and the two touched tests.
`src/song/rulerMarks.ts`, `src/store/trackLaneViewStore.ts` and
`__tests__/tokenLiteralGate.test.ts` are **unmodified** — the brief listed them as scope;
they were not touched (rulerMarks' `crispLineX` was already committed).

Artifacts: `plans/redesign-new-dna/.scratch/w4-tb-gate/` — 60 captures, `gate.json`,
`detail.json`, `contrast2.json`, `colors.json`, `scrolled.json`, `final.json`,
`loopmarquee.json`, `ta2d/gate{1..7}.json`, harnesses `gate.ts` / `detail.ts` /
`contrast2.ts` / `colors.ts` / `scrolled.ts` / `final.ts` / `loopmarquee.ts`.

---

## 1. Must-fix (ranked)

### M1 — The drag ghost, its readout and the field overlays paint over the sticky header column and the whole ruler stack

Reproduced at 1280×800 and 1920×1080, both themes.
`plans/redesign-new-dna/.scratch/w4-tb-gate/light-1280-06-ghost-over-header.png`,
`…-07-ghost-over-ruler.png`.

Measured (`gate.json → light-1280.ghostOverHeader`):

```
headerRect  { left: 0,    right: 200 }
ghostRect   { left: -570, right: 690 }      ghostOverlapPx: 200   (the whole column)
readout     left: 74                        readoutCrossesHeaderEdge: true
ghostLayer  z-index 10, rect { left: 0, top: 46, right: 1280 }
header      z-index 5
```

Dragging the Bass clip leftwards hides that track's `M / S / ● / A` row and the instrument
chip completely, and paints the readout chip *inside* the header over the Lead track's name.
Dragging **upwards** is worse: `ghostTop: 86` against `skyBottom: 102` — the ghost covers
the section chips, the brace row, bar numbers 1–9, the `V B X` corner and part of the song
title. The performer loses the ruler at exactly the moment the ghost exists to tell them
where the clip lands.

Cause: `DragGhostLayer` is a sibling of `.arrangement-scroll` with
`position: absolute; inset: 0; z-index: 10` (`DragGhost.css:10-16`), and `useClipGesture`
publishes `x/y` in **surface** coordinates (`useClipGesture.ts:137-138`), not field
coordinates. Nothing constrains it to the field.

Prescription (either shape is fine, first is the smaller diff):
1. Clip the layer to the field without touching the transform maths —
   `.arrangement-drag-ghost-layer { clip-path: inset(calc(var(--arrangement-sky-height) + var(--arrangement-ruler-height)) 0 0 var(--arrangement-header-width)); }`
   and **clamp** the readout's x/y to the field's top-left + 8px so the numbers stay whole
   rather than being sliced (a clipped readout is worse than a moved one).
2. Or move the layer inside the field: `left: var(--arrangement-header-width); top: <ruler bottom>`
   and subtract the same offsets when publishing `preview.x/y`.

Do **not** solve this by lowering the ghost's z-index below the header: the ghost must stay
above clips (z 3) and the ruler needs the playhead cap above it, so the z-ladder cannot
express "below chrome, above content" for all four overlays at once.

### M2 — The playhead is drawn straight through the track headers whenever the field is scrolled

No gesture needed. `plans/redesign-new-dna/.scratch/w4-tb-gate/playhead-scroll-150.png`.

`final.json → playheadOverHeader`:

| scrollLeft | playhead left | header right | inside header |
|---:|---:|---:|:--|
| 0 | 200 | 200 | no |
| 60 | 140 | 200 | **yes** |
| 150 | 50 | 200 | **yes** |
| 199 | 1 | 200 | **yes** |

The playhead is `z-index: 9` inside the scroll content; `.arrangement-track__header` is
`z-index: 5` in the same stacking context, so the line paints over the header column and its
cap lands in the ruler corner between `V` and `B`. In the capture it slices "Nylon Chords",
the M/S/●/A row, "Bass" and "Lead". It reads as a stray divider in the header, not as time.

Same prescription as M1 — a field-clipped overlay pane. The snap hairline
(`gestureHandles.css:185`, `z-index: 10`, positioned at `headerWidth + tick·pxPerTick` in
content coordinates) has the identical exposure once scrolled and should ride the same pane.
The marquee (`z 8`) and the range-selection edges do too.

### M3 — At ≤ ~1024px the transport pill covers the sky band's utility cluster, hiding which edit mode is armed

`plans/redesign-new-dna/.scratch/w4-tb-gate/width-1024.png`, `width-900.png`.

The 56px sky reserve works for **bars** — measured `pillOverlapsRuler: false` at 900 / 1024 /
1280 / 1440 / 1600 / 1920 / 2560, ruler top pinned at 102 in every case. But the reserve is
one-sided: `.arrangement-sky__gap` protects the song name on the left; the right-flushed
utility cluster has no matching reserve, so the centred pill lands on top of it. At 1024 the
`Slide | Ripple` segment shows **only "Ripple"** — "Slide" (the armed mode) is behind the
pill. At 900 the zoom chip is pushed off-screen entirely.

This is the bill for deviation **D-a** (dropping the spec's `⋯` overflow). Fix by making the
sky a symmetric three-slot grid with a reserved centre column the pill's max width, or by
restoring an overflow `⋯` that swallows the cluster's tail below a breakpoint.

### M4 — Piano-roll notes miss the 3:1 non-text floor in light, and the new gate does not measure what ships

`colors.json`, computed in real sRGB (the tokens are `oklch`, so `getComputedStyle` string
parsing silently lies — everything below is canvas-resolved).

`--universal-connection` (acc2) over `--timeline-lane-bg`, at the alphas
`velocityOpacity()` actually paints (`0.45 + 0.55·vel/127`):

| alpha | light vs lane | light vs black-key row | dark vs lane |
|---|---:|---:|---:|
| 45% (vel 0, softest) | **1.65** | **1.63** | **2.28** |
| 72% (default / mid) | **2.30** | **2.24** | 3.83 |
| 86% | **2.76** | **2.67** | 4.87 |
| 100% (vel 127) | 3.35 | 3.20 | 6.12 |

The primary object of the editor sits below 3:1 in light for every note quieter than full
velocity, and below 3:1 in dark for the softest notes. The four new gates in
`contrast.test.ts` are green because they test `universalConnection` vs `timelineLaneBg`
**at full opacity** — a gate that cannot fail the way the pixels fail. Same shape for
`timelineSelection`: the D22 promise ("≥ 3:1 `--acc` outline, the 2.9 carve-out retired") is
kept at the token pair (3.35 light) but the shipped composite is the outline over the *tinted*
clip fill: **3.04 / 3.00 / 2.98** for the three tints observed in light.

Fix: raise the alpha floor (e.g. `0.62 + 0.38·vel/127`, which puts the softest note at ~2.9→
recheck, or keep the range and darken acc2 in light with an `accent-two-ink`), and change the
two new gates to assert the **composited** value at the minimum alpha and over the tinted
fill, not the raw token pair. Otherwise this regresses silently the next time someone
touches `velocityOpacity`.

---

## 2. Behaviour frozen — partly

`git diff --stat -- e2e` is **empty**. No spec was edited. Good.

`bunx playwright test e2e/arrangement-editing.spec.ts e2e/timeline-preview.spec.ts --project=chromium`
→ **9 passed, 1 failed** (`e2e.txt`, `e2e-retry.txt`). Reproduced 3×, not flaky.

- The configured `webServer` (`tsc -b && vite build`) cannot start: `tsc -b` is red on
  `src/components/Nodes/__tests__/w5p8Faceplates.test.tsx(28,38): TS2307 Cannot find module
  '../keyboardAssignment'` — another lane deleted `keyboardAssignment.ts`. I ran against a
  pre-built bundle via `.scratch/w4-tb-gate/pw.config.ts` (`bunx vite build` = **exit 0**).
- The one failure is **not TB's**: `getByTitle('Play')` now resolves to **30 elements** —
  `src/components/Nodes/KeyboardVisualNode.tsx:309` (uncommitted, another lane) added
  `title={\`${key} — plays on row ${row}\`}`, and Playwright's `getByTitle` substring-matches
  "plays". The keyboard lane owns this; the timeline diff is clean of it. Flagging it because
  the tree cannot go green until that lane fixes the title or the spec is updated.
  (One earlier attempt failed instead on the known `Tab` surface-switch flake and passed on
  the next run.)

**TA2d regression gates 1–7, re-pointed at :5228** (`ta2d/gate{1..7}.{ts,json,log}`, diffed
against the TA2d baseline; **0 console / page errors in all seven**):

| gate | delta | reading |
|---|---|---|
| 1 | geometry only: every y −52 (sky band), ruler viewport `62 → 64`, **`barsOverflowPx 2 → 0`** | the TA2d carry-forward is genuinely closed |
| 2 | `strip.marksAfter 1 → 0`, `strip.renameInputs 0 → 1` | **real behavioural delta — see below** |
| 2 | `renameInputs 0 → 1` on the chip label; `maxDrift 664 → 586` | improvement / probe artefact, as reported |
| 3 | automation point `11px → 9px`, chip label `w 31 → 2386` | spec §2.6 (9px points); label now spans the chip |
| 4 | `renameAfterDrag.control.renameInputs 1 → 0` | inconsistent with gate 2(a), which renames fine — worth one look |
| 5 | `elementAtLabel` now resolves, `pointer-events: auto` | improvement, as reported |
| 6 | `sections[0] 5408 → 2304` | tick rounding, improvement |
| 7 | **0 diffs** | — |

**The report's claim "gates 1, 2, 3 — 0 behavioural deltas" is not accurate for gate 2.**
Double-clicking the sections row *inside a section's span* used to drop a `kind: 'mark'`
(`marksAfter: 1`); it now opens the section rename instead (`renameInputs: 1, marksAfter: 0`),
because the chip label is now full-width with `pointer-events: auto` and swallows the event.
On Paper Sketch the sections cover the whole song, so **marker creation by hand is now
unreachable on that song** — and the lane's own new mark-pin renderer has no hand gesture
left to exercise it. Not a must-fix on its own (the rename fix is worth more than the
overlap), but it must be recorded, and the mark gesture needs a home (e.g. `Alt`+double-click,
or reserve the top 6px of the chip band).

Vitest, scoped: **35 files / 353 tests green** (`vitest.txt`) — matches the report.

---

## 3. Spec §2 / §8 fidelity, region by region

All numbers from `gate.json → *.geometry`, `detail.json`, `loopmarquee.json`; both themes,
1280×800 and 1920×1080 (identical results).

| Region | Spec | Measured | Verdict |
|---|---|---|---|
| Sky band | 56px, pill never over bars | `{y:46,h:56}`; ruler top 102 at all 7 widths; `pillOverlapsRuler:false` | ✅ for bars, ❌ for the utility cluster (**M3**) |
| Ruler stack | 64px = 22/14/28 | viewport 64; sections 22 @102, braces 14 @124, bars 28 @138; `barsOverflowPx: 0` | ✅ exact |
| Corner | 200×64, chips + `V B X` | 200 wide, two rows, magnet/follow as accent glyph on inset | ✅ (the two-alarm fix is right) |
| Headers | 200px, stripe 4→6, bead, M/S/R, rename, grips | 200×72; stripe `4px`; bead 3px full-width `scaleX` in `--success-ink` | ✅ |
| Field | ground / alt lanes / dividers / section markers / past-end wash | present; markers 2px dashed acc2 visible at bar 3 | ✅ |
| Clip | r6, 12% wash, 2px tint edge, sh1, 18px name | `border-radius 6px`, `border-top 1px`, `border-left 2px`, name bar 18px @13px/600, `--shadow-raised` | ✅ |
| Clip states | selected / muted / locked / faulted / dragging | all five classes + CSS present and correct; `is-muted` keys off `clip.mute` (a *track* mute dims the track, not its clips — defensible, matches Ableton) | ✅ |
| Drag ghost | content + readout + hairline, original 35% | `name:true content:true readout:"2.3+1.2" hairline:true originalOpacity:0.35` | ✅ content, ❌ containment (**M1**) |
| Range selection | acc 10% + edge chips | `["3.1","6.4.106"]` rendered at both edges | ✅ |
| Marquee | neutral dashed (D19) | `1px dashed rgb(137,134,124)` = `--border-control`, bg 5% | ✅ |
| Playhead | 2px acc rolling / 1.5px t2 stopped, cap, **no glow** | `1.5px rgb(90,88,80)` stopped, `2px` rolling, `filter: none`, `box-shadow: none` | ✅ paint, ❌ containment (**M2**) |
| Loop | brace + wash 6% | brace 420×14 in the brace row from a drag; wash alpha `.07`; bracket in the sections row | ✅ (7% vs 6% — noise) |
| Mixer | 188px, 124 + 92, vertical fader with acc progress, 8×76 meter, mono dB, pan pill | drawer 188, strip 124×187, master 92, slider 22×76 `rotate(-90°)` with `--oj-slider-progress: 83.3` **visible** | ✅ — the bespoke fader override is gone and the accent fill shows |
| Automation | 96px field | field 96, header **in the 200px column** (D-c) | ✅ deviation justified — see §5 |
| Piano roll | 40px toolbar `V B X K T`, `⋯`, scroomer 12, key bed, rows, notes acc2, velocity | toolbar 40; tools `V B X K T Q 1/16 Quantize Drums ⋯`; scroomer 12; keys 64; row height **22**; note `border-radius 3px` acc2 at velocity alpha; velocity lane 56 | ✅ geometry, ❌ note contrast (**M4**) |
| Empty state | four paths + Tab keycap | `Paper Sketch` (primary) · `First Light` · `Record something` · `Draw a clip` · ghost link · `Tab` footer | ✅ |
| Skeleton | none, deliberately | absent | ✅ accepted (see §5, D-g) |
| Error chips | chip in the utility cluster | code path present; no fault injectable headlessly | ⚠️ unverified |

---

## 4. Pixel-lock — measured, and it holds

`pixelLock()` reads the grid **canvas pixels** and compares each bar line to the same bar's
ruler tick. Max delta, in CSS px:

| | 46 px/bar | 90 px/bar | 210 px/bar |
|---|---:|---:|---:|
| light 1280 | **0** | **0** | **0** |
| dark 1280 | **0** | **0** | **0** |
| light 1920 | **0** | **0** | **0** |

(23/25, 11/13, 5/7 ticks matched at 1280 — the unmatched ones are the two edge ticks the
probe excludes.)

**Piano-roll surface**: `fieldLeft: 76 == rulerLeft: 76` in every run, and the first six bar
ticks land at `[76, 166, 256, 346, 436, 526]` — exactly the 90px stride, starting on the
field's own origin. The 124px shear is **confirmed fixed**.

**Bars-row overflow**: `barsOverflowPx: 0` (TA2d measured 2). **Confirmed fixed.**

**The inline roll's shear is real and still open.** In
`light-1280-12-inline-roll.png` the arrangement's bar-1 tick is at x=200 while the inline
roll's tick 0 begins at x≈258, after its own scroomer + key bed — ≈58px out of register with
the ruler directly above it. The lane discloses this in §7 and in `docs/timeline.md`; it is
carried, not introduced. It does mean the surface is only *half* pixel-locked, and the
review's table above says "✅" for the full surface only.

---

## 5. Deviations — judgement

Accepted, with reasons that hold: **D-b** (no `setSongName` verb — inventing one would fork
the model), **D-d** (native colour input is pinned by `ArrangementSurface.test.tsx:313`, and
the blue-dot-on-orange-track defect is genuinely fixed), **D-e** (56 vs 64 velocity lane),
**D-f** (`locked` is the only drop this model refuses — warning about a drop that then
succeeds would be the worse lie), **D-g** (no skeleton: the document is synchronous;
§8.3's own clip-granular sentence is satisfied), **D-i** (no `stale` state exists to drive),
**D-j** (roll corner narrowed to the gutter — that is what bought the 0px register).

**D-c (automation controls in the header column, not a 28px top row): accepted, and it is
the better design.** Verified in `dark-1280-11-automation.png` — the parameter `Select`, the
mono live value, `Off | Play` and `Step | Linear` sit in one column with the track header
above them, and the field keeps its full 96px. A 68px field would be too shallow to place a
point in, and it would break the shipped ramp e2e's `dblclick y: 72`. Spec §2.6 should be
amended to match rather than the code bent back.

**D-a (no undo/redo, no `⋯` in the sky band): the undo/redo half is right, the `⋯` half is
not.** Undo/redo are document-scoped and already in the topbar 46px above — duplicating them
forks a control. But dropping the overflow is what produces **M3**: with no overflow, the
cluster has nowhere to go when the pill takes the middle. Restore `⋯` (or reserve the pill's
width symmetrically).

**Not a deviation but worth naming: MIDI clip content moved teal → `--t2`.** Measured at the
spec's own alpha ramp, `t2` at 0.55 over the warning-tint fill is **2.44 light / 2.76 dark**.
Spec §2.5 prescribes that ramp, so this is a spec-level floor question, not a TB error —
but it is the same failure mode as M4 and should be settled once for both.

---

## 6. Contrast — full results

Canvas-resolved sRGB (`colors.json`, `contrast2.json`). **Text ≥ 4.5, non-text ≥ 3.**

**Text — every tightest run passes, both themes:**

| Pair | light | dark |
|---|---:|---:|
| bar number (11px/600 mono, `--text-muted` on chrome) | 5.22 | 4.87 |
| section chip label (11px/600) | 5.92 | 6.18 |
| grid chip / `Q 1/16` chip (11px/500 mono) | 5.92 | 6.18 |
| clip name on its tint bar (worst of 3 tints) | 13.41 | 9.20 |
| track name (14px/600) | 16.20 | 13.85 |
| mixer dB (11px/500 mono) | 6.77 | 6.69 |
| pan pill | 16.20 | 13.85 |

**Non-text:**

| Object | floor | light | dark |
|---|---:|---:|---:|
| clip border vs clip fill (3 tints) | 3 | 4.89–4.98 | 4.11–4.24 |
| playhead rolling (`--acc`) vs lane | 3 | 3.35 | 6.07 |
| playhead stopped (`--t2`) vs lane | 3 | 7.13 | 6.93 |
| **level bead / meter (`--success-ink`) vs header** | 3 | **6.07** | 6.56 |
| *(what it was: `--accent-success`)* | 3 | *2.99* ❌ | *6.41* |
| selection outline over tinted clip fill | 3 | **2.98–3.04** ⚠️ | 4.94–5.10 |
| piano-roll note at painted alpha | 3 | **1.65–2.76** ❌ | **2.28**–4.87 |

The level-bead catch is real and the reasoning is right: `--accent-success` was 2.99:1 on the
header in light, and the bead is the one element on this surface that reports live sound.
The two failures are M4.

Other gates: `bunx eslint src/components/Arrangement src/components/PianoRoll` → **clean**.
`bunx tsc --noEmit -p tsconfig.app.json` → **one error, not TB's**:
`src/components/Nodes/__tests__/w5p8Faceplates.test.tsx(28,38) TS2307` (another lane deleted
`src/components/Nodes/keyboardAssignment.ts`). `bunx vite build` → **exit 0**. `tsc -b` → red
on the same single foreign error. `tokenLiteralGate.test.ts` green (unmodified).

---

## 7. Reduced motion

Emulated `reducedMotion: 'reduce'` and walked every element under
`[data-surface-root="arrangement"]`:

- **0 elements with a running animation.** `final.json → reducedMotion.animations: []`.
- All 25 remaining transitions collapse to `1e-05s` (the global blanket rule), including the
  level bead, the meters and the snap hairline.
- The record-arm swaps its pulse for a solid fill + 2px ring (`ArrangementSurface.css:873`) —
  state is not carried by motion alone.
- The playhead is **not** in the reduced-motion block and its position is written straight to
  `style.transform` by the shared rAF, so it keeps moving. (I could not *demonstrate* motion
  headlessly — no engine frames are delivered — so this is verified by construction, not by
  observation.)
- Captures: `light-reduced-01..05`, `reduced-motion.png`.

✅ No animations, meaning intact, playhead unaffected.

---

## 8. Taste

**Where it is genuinely good.** The ruled page reads like a page: three ruler rows with real
hierarchy, section chips that span, bar numbers in mono muted that stay quiet at 46 and 210
px/bar alike. Clip weight is right — a 1px neutral border plus a 2px tint edge plus an 18px
name bar carries the object without the drenched-block look Ableton falls into, and the name
bar stays legible on every tint (13.4:1 worst case in light). **Dark reads as designed, not
inverted**: warm browns, the tints holding their hue, the ruler receding, the clip borders
lighter than the ground rather than darker — this is the single best thing in the diff. The
key bed drawn as *bars on a ground* instead of a fill swap is the correct instinct and it is
the only construction that survives a theme flip. The velocity stem quieted to 55% against a
solid head is a real observation about density, not a style choice. Deleting the bespoke
mixer-fader override so the shared `Slider` shows its accent progress is exactly "extend,
don't fork".

**Where it costs.**

1. **Clip fill vs lane is 1.04:1 in light** (1.19–1.23 dark). The 12% tint wash is
   effectively invisible against a white lane — a clip is legible only by its 1px border and
   its name bar. At 46 px/bar with short clips that is thin. Bitwig runs its clip bodies far
   heavier. Not a floor failure (the border carries it), but consider 16–18% in light.
2. **The field stops at the last lane.** `.arrangement-field-ground` is `offsets.at(-1)` tall
   while `.arrangement-scroll` is 698px — 418px of bare `--bg-canvas` below the last track at
   1280×800. In light it is a faint seam; in dark it is a hard black band across the lower
   half of the window and the surface reads as unfinished. **Pre-existing** (identical in
   `HEAD`), but the redesign makes it far more visible. Worth a two-line fix in this pass.
3. Ghost read is good *when it stays in the field* — real name bar, real notes, original at
   35%, mono readout with a correctly zero-based delta (`formatTickDelta` is a genuinely
   sharp catch). M1 is the only thing wrong with it.
4. Header density is right at 200px: name, bead, M/S/●/A and the instrument chip without
   crowding, and the `is-odd` absolute-index alternation is the correct call for
   virtualization.
5. Playhead visibility on busy content is fine (3.35 light / 6.07 dark rolling) and the
   no-glow rule is honoured.

---

## 9. Doc drift

`docs/timeline.md:47` still says the level bead is **`--accent-success`**. The CSS
deliberately uses `--success-ink` (`ArrangementSurface.css:476` even explains why), and
`--accent-success` is the 2.99:1 value the lane fixed. Fix the doc or the next person will
"restore" the bug. Otherwise the doc rewrite is accurate and covers the sky band, the
sticky/pixel-lock rule, the corner, the header + bead, the mixer and automation geometry, the
brace construction, the tick-rounding rule and the roll's toolbar/key-bed/row clamp.

---

## 10. Follow-ups (not blocking)

1. The **inline roll's ~58px shear** — the full surface is pixel-locked, the inline lane is
   not. Structural (key bed inside the lane vs in the header column); keep it disclosed.
2. **Mark creation over a section span** has no gesture left (gate 2). Give it one.
3. gate 4's `control.renameInputs 1 → 0` — one look to confirm it is probe ordering and not a
   real "first double-click after a reset does nothing".
4. Master mixer strip has no fader and no M/S — deliberate (no master-gain verb) but it looks
   like an omission next to three full strips. A disabled fader or a label would read better.
5. `shouldAutoDetectDrums` false-positives on Paper Sketch's chord clip (≤16 pitches, all
   35–81) — documented, escapable via `Drums`, left frozen. Correct call for a visual pass.
6. The oj-ui asks in the report §2 are all well-argued: `accent-two` semantic token (the
   surface currently borrows `--universal-connection`, a *port* name, for the second accent),
   vertical `Slider` (would delete `.mixer-strip__fader` and its `rotate(-90deg)` hit-box
   lie), a `Popover` primitive (third hand-rolled one), and a `role="radiogroup"`
   `SegmentedControl`. Worth raising as real API work.
7. **UNVERIFIED, and no harness can close it**: feel — no-click/no-dropout during a clip drag
   while rolling, the bead tracking real signal, the meter's 60ms lerp, the record pulse,
   stopped-only audible ruler scrub. Also the faulted-clip mapping (`card.nodeId === track.ref`)
   and the drop-invalid path (needs a `locked` clip, which no starter has). Founder pass with
   audio playing.

---

## 11. Verdict

**DO-NOT-COMMIT.** Fix M1 and M2 with one field-clipped overlay pane (they are the same bug
wearing two hats and one change closes the ghost, the readout, the hairline, the marquee and
the playhead), M3 with a symmetric sky reserve or the restored `⋯`, and M4 by making the two
new contrast gates assert the composited value and lifting the note alpha floor in light.
Then re-run the two e2e specs (which will still need the keyboard lane's `title="… plays on
row N"` collision resolved — that one is not TB's to fix, but the tree cannot go green
without it) and this lands. Everything else in the diff is ready.
