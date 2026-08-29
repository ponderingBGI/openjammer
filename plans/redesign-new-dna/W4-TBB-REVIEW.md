# W4-TBb — re-gate (timeline visuals, fix round after W4-TB-REVIEW)

**Verdict: COMMIT-AFTER-FIXES — two one-line changes, both already proved in the browser.**

M1, M2, M3 and M4 are genuinely closed. I re-measured every number rather than reading the
report's JSON, and every headline claim in `W4-TBB-REPORT.md` reproduced: 0 px² of ghost,
readout, hairline or playhead on the header column at any scroll; 0 px² of pill on any
utility control down to 800px; the softest note at 3.20 / 3.10 / 3.01 in light and
4.84 / 4.90 / 4.19 in dark; `Alt`+double-click drops a mark; the two e2e specs pass 10/10
against a bundle built from this tree; nothing in the frozen behaviour set moved.

What blocks it is that the two fixes each left a smaller version of the thing they fixed:

- the **M3** wrap solution spills the utility cluster 2.2 px **under the ruler** across a
  ~150 px band of viewport widths the lane never sampled (it tested 1280 / 1024 / 900; the
  break is 1030–1177);
- the **M1/M2** rule — *above the clips, never on the chrome* — is stated in three places in
  the diff and is **false for the inline piano roll**: its scroomer paints straight through
  the sticky track header on an ordinary "double-click a clip, then scroll".

Both are one declaration. I injected each at runtime and measured the fix, so neither is a
guess.

Scope reviewed: `src/components/Arrangement/**` (incl. `SkyBand.tsx`, `clipPaint.ts`,
`trackTint.ts`, `usePlayheadTransform.ts`, `fieldOverlay.test.tsx`, `gestureHandles.css`,
the deleted `TransportStrip.tsx`), `src/components/PianoRoll/**`,
`src/components/Clips/AudioClipVisual.tsx`, `src/store/editingContextStore.ts`,
`src/components/Nodes/KeyboardVisualNode.tsx`, `docs/timeline.md`. As at the first gate,
`src/store/trackLaneViewStore.ts` and `src/song/rulerMarks.ts` are **unmodified**.

Artifacts: `plans/redesign-new-dna/.scratch/w4-tbb-gate/` — harnesses `lib.ts`, `g1`–`g8`,
`gate-revert.mjs`, `deadcss.mjs`; results `g1.json`…`g8.json`, `gate-revert.txt`,
`deadcss.txt`, `vitest.txt`, `tsc.txt`, `eslint.txt`, `e2e.txt`, `nodes-tests.txt`;
42 captures. Playwright ran under `node` throughout; one Chromium, dev port 5229, stopped.

---

## 1. Must-fix

### F1 — the inline piano roll's scroomer paints on the sticky track header

Reproduce: open Paper Sketch, double-click the Nylon Chords clip (inline roll opens),
scroll the field right ~150 px. Captures `g7-roll-before.png` / `g7-roll-after.png`.

A 12 px vertical strip slices the track name (the "o" of "Nylon Chords" is gone), the `S` of
the M/S/●/A row, and "Drum rows / Drums / Quantize / Step" in the lane menu.

Measured (`g7.json`, `elementFromPoint` on a 6 px lattice over the whole header column):

| | rollPixelsOverHeader | what is on top |
|---|---:|---|
| before | **54** | `piano-roll__scroomer`, `piano-roll__scroomer-window` |
| after `isolation: isolate` | **0** | — |

Cause: `.piano-roll__scroomer { z-index: 5 }` (`PianoRoll.css:181`) **ties**
`.arrangement-track__header { z-index: 5 }` (`ArrangementSurface.css:472`) inside the same
stacking context — `.piano-roll` is `position: relative` with no `z-index`, so it does not
create one — and the lane comes after the header in DOM order, so the tie goes to the roll.
`.piano-roll__playhead` (z 6), `.piano-roll__marquee` (z 7) and `.piano-roll__clip-brackets`
(z 9) outrank the header outright and will leak the same way.

**Fix — `src/components/PianoRoll/PianoRoll.css:34`**, immediately after `position: relative;`
inside the `.piano-roll { … }` rule (which opens at `:14`), add one declaration:

```css
    /* The roll owns its own z-ladder. Its scroomer (5), playhead (6), marquee (7)
     * and brackets (9) otherwise compete with `.arrangement-track__header` (5) in
     * the arrangement's stacking context and win on DOM order, painting the roll
     * over the sticky header column whenever the field is scrolled. */
    isolation: isolate;
```

Verified non-regressing: with it applied the roll's internals still stack correctly
(`topmostInField: "piano-roll__content"`, scroomer present, 128 notes rendered), and the
`⋯` popover (z 20) / rejection chip (z 21) are unaffected — the inline roll has no toolbar
(`PianoRoll.css:159`) so neither exists there, and the full-surface roll *is* the surface.

Pre-existing (identical z-indices at `HEAD`), but it is in lane scope, this round rewrote
`PianoRoll.css` (+306 lines), and `fieldOverlay.test.tsx` and `docs/timeline.md` both now
assert a boundary this violates. It is the same defect M1/M2 were a DNC for.

### F2 — the sky band's utility cluster spills 2.2 px under the ruler between 1030 px and 1177 px

The M3 fix is right and the reserve works (see §3). But the wrap it substitutes for the `⋯`
overflow starts **before** the compaction that makes wrapping fit.

Swept 1300 → 780 in 10 px steps (`g3b.json`, capture `g3b-overflow-1170.png`):

| width | cluster height | bottom vs sky bottom | cluster ∩ ruler | `elementFromPoint` at the zoom chip's bottom |
|---:|---:|---:|---:|---|
| ≥ 1180 | 30 px (one row) | −13 | 0 | self |
| **1170 → 1030** | **58.2 px (two 30 px rows)** | **+2.2** | **627–781 px²** | **`arrangement-sections-row`** |
| ≤ 1024 | 55.2 px (two 24 px rows) | −0.4 | 0 | self |

The compaction media query is `@media (max-width: 1024px)` (`ArrangementSurface.css:941`),
but the cluster starts wrapping at ~1177 px. Two 30 px rows + a 3 px row-gap is 63 px in a
56 px band; two compacted 24 px rows are 51 px. So for a ~150 px window of widths — which
contains 1152 and 1176, and any non-maximised window — the ruler's sections row paints over
the bottom of the zoom chip. The CSS comment on `.arrangement-sky__utility`
(`ArrangementSurface.css:131-136`) states the wrong threshold too ("Below ~1000px").

**Fix — `src/components/Arrangement/ArrangementSurface.css:941`.** Split the block; put the
four control-compaction rules on the width the cluster actually wraps at, and leave the
`Tab` hint where it is:

```css
/*
 * The cluster wraps at ~1177px, where its controls are still 30px: two 30px rows
 * plus the 3px row-gap is 63px in a 56px band, and the ruler's sections row ends
 * up over the bottom of the zoom chip (measured 2.2px, 627–781 px² of overlap).
 * Compacted, two rows are 24+3+24 = 51px and fit. The breakpoint IS the wrap.
 */
@media (max-width: 1180px) {
    .arrangement-sky__utility { gap: 3px 4px; }
    .arrangement-sky__utility .oj-btn { height: 24px; min-height: 24px; padding: 0 8px; }
    .arrangement-sky__utility .arrangement-edit-mode { padding: 2px; }
    .arrangement-sky__utility .arrangement-edit-mode button { padding: 0 7px; }
}

@media (max-width: 1024px) {
    .arrangement-sky__hint { display: none; }
}
```

Verified by injecting exactly that (`g7.json`, capture `g7-sky-fixed-1170.png`): overflow
`+2.2 → −14 / −0.4 / −0.5` across the whole sweep, cluster ∩ ruler `781 → 0`, pill overlap
still **0** at every width, and 1100–1180 now fits in **one** row rather than two — strictly
better than before.

Also update `docs/timeline.md:37-38`, which says the cluster compacts "below 1024px".

---

## 2. M1 + M2 — the field-clipped overlay pane: closed, with one honest crack

### Geometry and containment (`g1.json`, `g8.json`)

At 1280×800, both themes, header at 200 px:

```
pane      { left 200, top 166, right 1280, bottom 800 }   overflow hidden, z-index 10
header    { right 200 }        ruler shell { bottom 166 }     scroller { bottom 800 }
origin transform  translate3d(-200px, -64px, 0)   →  -200-scrollLeft, -64-scrollTop
```

`pane.left − header.right = 0` and `pane.top = ruler.bottom` exactly. It survives a header
resize: dragged to **300 px** and back to **160 px**, with the field scrolled 250 px, the
pane's left edge tracked the header's right edge to **0.00 px** every time and the origin
transform followed (`-300/-64`, `-550/-64`, `-410/-64`). Mixer open: pane bottom **612** =
drawer top **612**, overlap **0 px²**, 4 strips, pan pill reads `C`.

Every transient overlay is inside `[data-field-overlay]` and none is inside
`.arrangement-scroll`: playhead line, snap hairline, loop wash, range selection, marquee,
draw ghost, drag ghost, drag readout. All are `pointer-events: none`, so the pane does not
eat a gesture. The **cap** is the one deliberate exception — it lives in
`.arrangement-ruler-content`.

### The playhead line vs the header, at every scroll (`g1.json`)

| scrollLeft | line box ∩ header | **line *painted* ∩ header** | cap ∩ corner |
|---:|---:|---:|---:|
| 0 | 0 | **0** | 0 |
| 60 | 324 px² | **0** | 0 |
| 150 | 324 px² | **0** | 0 |
| 199 | 324 px² | **0** | 0 |
| 400 / 900 | 0 | **0** | 0 |

Identical in light and dark. The box overlap is still 324 px² — the element genuinely
extends under the column — and the pane clips all of it. M2 closed. (The first review's
`getBoundingClientRect` numbers were border boxes; intersecting with the clipping pane is
the correct measurement and the lane's harness already did it.)

### The drag ghost (`g1.json`)

Cross-track drag with the field scrolled 420 px, then dragged **up into the ruler** — the
worse case the first review named. Both themes:

| | painted ∩ header | painted ∩ ruler | painted ∩ sky |
|---|---:|---:|---:|
| ghost, dragged left | **0** | **0** | **0** |
| ghost, dragged up to y=130 | **0** | **0** | **0** |
| readout, either | **0** | **0** | — |
| snap hairline | **0** | — | — |

`readoutWhollyInsidePane: true` in every case — the readout is *moved*, not sliced, which is
the right call and the `useLayoutEffect` measurement is why it can be. `elementFromPoint` at
the centre of the header column returns header chrome throughout.

### Is the ruler content the right home for the cap? Yes — and it is where the tear is

Spec §2.5 puts a "9px triangular cap sitting in the bars row". Measured: cap box
`{ top 157, bottom 166, w 10, h 9 }`, bars row `138 → 166` — the cap sits in the bottom 9 px
of the bars row, and `.arrangement-ruler-viewport` (`overflow: hidden`, left 200) clips it
before it can reach the corner (at scrollLeft 199 the cap box is at x −4…6, entirely
outside). Spec-correct.

**But the line and the cap now live in two coordinate systems that update at different
rates.** The line rides the pane, whose origin is written **synchronously in `onScroll`**;
the cap rides `.arrangement-ruler-content`, translated by `-view.left`, which is React state
committed in a rAF. Sampled per frame under a **real wheel** scroll (`g2b.json`):

| | max during scroll | at rest |
|---|---:|---:|
| line vs the clips it scrolls with | **0.00 px** | 0.00 |
| line vs the ruler's bars row | **150 px** | 0.33 |
| **line vs its own cap** | **150 px** | 0.33 |
| grid canvas vs bars row | 704 px (by construction — both are counter-translated) | 0 |

150 px is one wheel notch; the rAF-driven control run gives **18 px** at 18 px/frame — i.e.
the lag is exactly one frame of scroll, whatever the rate. It re-converges within a frame of
the scroll stopping.

The `onScroll` write is **not** the problem — it is the only thing on the surface that is
frame-accurate, and it means **no overlay ever trails the clips**. The problem is that the
ruler (and the grid anchor) still use the rAF/React path that spec §2.1 explicitly outlaws
("No rAF-synchronised `translateX` compensation anywhere"). That lag is pre-existing and
unchanged; what this round added is a playhead **cap** on the lagging side of it, so the lag
is now legible as a playhead breaking in two rather than as ruler numbers sliding. Not a
blocker — transient, self-healing, and the honest fix is a decision, not a patch — but it is
follow-up #1 and it is the largest remaining truth-gap on a surface whose claim is exactness.

Two smaller notes on the same pair: the cap's apex sits **0.75 px** left of the stopped
1.5 px line's centre and 1 px left of the rolling 2 px line's centre, because the line is
drawn to the right of the tick (`left: headerWidth + tick·pxPerTick`) while the cap is
centred on it (`margin-left: -5px`). Sub-pixel, but it is a permanent misregistration
between two elements that are supposed to mark the same instant.

### Overlays that were NOT moved (`g6.json`)

With an automation lane open (6 points) and an inline roll open, at scrollLeft 0 / 150 / 420
I sampled every pixel of the header column and asked what was on top:

- **automation points / range / curve** — boxes extend up to 19 200 px² under the column;
  nothing leaks. They are inside `.arrangement-automation__field { overflow: hidden }` at
  z 2, under the header's z 5. ✅
- **record ghost** (z 3), **drop-invalid lane outline**, **`piano-roll-note--draw`** — same
  ladder, all below the header. ✅ (The drop-invalid *readout* is inside the ghost layer and
  therefore inside the pane; `is-invalid` renders "locked" in the clamped chip.)
- **inline piano roll** — leaks. That is **F1**.

Nothing paints on the ruler stack at all.

---

## 3. M3 — the symmetric sky reserve: closed, and it is the right fix

`g3.json`, ten widths × two themes, `elementFromPoint` on every control.

```
grid-template-columns:  <1fr>  432px  <1fr>     — the two side columns are byte-identical
                                                  at 1920/1440/1280/1100/1024/1000/950/900/860/800
```

| width | pill width | worst pill ∩ any utility control | worst pill ∩ song name | armed `Slide` reachable |
|---:|---:|---:|---:|:--|
| 1920 → 800 | **427.9 px, unchanged at every width** | **0 px²** | **0 px²** | **yes, every width** |

The pill never shrinks, so the geometric claim holds by construction rather than by luck.
`utilityClipped: false` everywhere. The zoom chip is the only control that leaves and it
leaves at ≤900 exactly as claimed (present at 950, hidden at 900 / 860 / 800). The
`⋯`-vs-reserve argument in the report is right: hiding "which mode is armed" behind a click
is M3 again, slower.

**The 432 px is a magic number, not a coupling** — see follow-up #2. And the wrap it enables
is what F2 fixes.

The two-row state at ≤1024 is legible and reads as deliberate (`g3-light-sky-1024.png`,
`-900.png`, `-800.png`): `Slide Ripple P Mix Export` over `21 bars` at 1024, `Slide Ripple
P Mix` over `Export` at 900. Right-flushed, aligned, no orphan. With F2 applied the same
treatment simply starts earlier, and 1100–1180 goes back to one row.

---

## 4. M4 — note contrast: closed, independently, at the pixel

Composited in the browser — row ground painted, note painted on top, pixel read back from a
canvas (`getComputedStyle` returns `oklab(…)` here, so string parsing lies). `g4.json`.

| velocity | alpha | light: white row / black row / **clip body** | dark: white / black / **clip** |
|---:|---:|---|---|
| 0 | 0.680 | 3.20 / 3.10 / **3.01** | 4.84 / 4.90 / **4.19** |
| 1 | 0.683 | 3.23 / 3.14 / 3.04 | 4.86 / 4.96 / 4.25 |
| 32 | 0.761 | 3.82 / 3.71 / 3.56 | 5.72 / 5.86 / 4.93 |
| 64 | 0.841 | 4.59 / 4.39 / 4.19 | 6.67 / 6.82 / 5.64 |
| 96 | 0.922 | 5.50 / 5.27 / 4.97 | 7.73 / 7.92 / 6.44 |
| 127 | 1.000 | 6.65 / 6.36 / 5.94 | 8.92 / 9.15 / 7.34 |

Everything ≥ 3. The lane's table reproduces exactly. The old derivation, measured in the
same run for control: **1.65 / 1.63** light at velocity 0, **3.35 / 3.20** at 127 — the
first review's numbers, reproduced by a probe that did not make them.

**The gates read the shipping code and go red on revert.** `contrast.test.ts` imports
`velocityOpacity` and regex-parses the ink weight and the black-row alpha out of
`PianoRoll.css`. I replayed the gate's own maths with each constant reverted
(`gate-revert.txt`):

| | light worst | dark worst |
|---|---|---|
| shipping | 3.22 / 3.15 | 4.86 / 4.94 |
| revert the ramp only (0.45) | **2.05 RED** | **2.89 RED** |
| revert the ink only (raw `--acc2`) | **2.20 RED** | 3.55 |
| revert both | **1.65 RED** | **2.28 RED** |

So the gate cannot be satisfied by either half alone. Good. One gap, non-blocking:
**`--timeline-clip-bg` and `--timeline-lane-bg` are the same value in both themes**, so that
`it.each` row is a duplicate of the white-key row and never tests the ground that ships —
`color-mix(in oklab, var(--track-tint) 12%, var(--surface))`. Measured over the two live
Paper Sketch tints the softest note is **3.01**. Follow-up #3.

### Taste: the ramp, and the derivation

`g4-{light,dark}-velocity-ladder.png` — five real `.piano-roll-note` elements at velocity
0/32/64/96/127, painted by the shipping rule.

In **light** the ramp reads cleanly, pale lilac to deep violet. In **dark** it is noticeably
flatter than before. Quantified as perceptual lightness across the full ramp:

| | ΔL\* velocity 0 → 127 |
|---|---:|
| light, before | 22.8 |
| light, now | 20.4 |
| dark, before | **27.8** |
| dark, now | **19.3** |

A 30 % loss of ramp in dark. It still reads at a glance at the extremes; mid-range steps are
subtle. I accept it — 3:1 on the primary object of the editor is not negotiable and the
alternative was worse — but it is a real cost and it belongs in the founder pass.

**Is `color-mix(… 60%, var(--text-primary))` the right derivation, or a token request?**
Both, in that order. It is the right thing to *ship*: no `--accent-two-ink` exists,
`packages/oj-tokens` is another lane, `--text-primary` flips with the theme so the one
expression does what an ink token would, and the app has no `[data-theme]` selector to hang
a light-only override on. It is semantically wrong as a *destination*: it couples the second
accent to the **body-text** ink, so a typography decision now moves note colour. File the
`--accent-two` / `--accent-two-ink` ask (already recorded in `docs/timeline.md:375`) — and
when it is specced, make **"≥ 25 L\* across the velocity ramp"** an acceptance criterion
next to 3:1, or the token will chase the floor and land back here.

---

## 5. Alt+double-click, and the retired test

Measured in the browser (`g5.json`):

| | marks created | rename inputs |
|---|---:|---:|
| plain double-click on a chip label | 0 | **1** |
| **Alt**+double-click on the same label | **1** | 0 |
| `Ctrl+M` | **1** | 0 |

**The retired "empty band" test was fiction — agreed.** It called `doublePress(chip, chip)`,
pressing the chip *element*; `.arrangement-section-chip__label` is `display: block` and fills
it, so a real pointer can never land there. It kept passing while the browser did the
opposite. The replacement — one test that reads the `display: block` rule, one that drives
`Alt` on the label — is the right shape, and the lane verified it red by removing
`!event.altKey`.

**Discoverability is the real cost, and it is not addressed.** `title` and `aria-label` on
`.arrangement-sections-row` and on the chip are all `null`; the cursor is `pointer`. Nothing
on screen says the modifier exists. The *capability* is discoverable — `arrangement.addMarker`
is in the keybindings catalogue as **`Ctrl+M` / "Add Marker"** (`keybindingsStore.ts:213`,
category "Arrangement Transport", surface `arrangement`) and it works — but it drops at the
**playhead**, not under the pointer, so it is a different gesture, not the same one by
another route. Follow-up #5 gives a one-attribute fix.

---

## 6. The extra ground-fill change — taste call: keep it

Captures `g5-light-groundfill.png`, `g5-dark-groundfill.png` (1280×800, Paper Sketch's three
tracks, zoomed out so the lanes end at y≈383).

- **Dark**: the hard black band the first review named is gone. The paper runs to y=800 and
  the surface reads as finished. Clear improvement.
- **Light**: better still — because `.arrangement-song-end` also extends to the bottom, the
  past-end wash becomes a full-height vertical boundary at the song end. **The past-end /
  ground distinction is not lost; it is more legible than before.** The lanes still stop
  where the tracks stop, and the grid canvas still stops with them, so "where the music is"
  is unambiguous.
- **`scrollHeight` really is unchanged**: 698 at zoom-out, default and 4× zoom-in, in both
  themes (`g5.json → geom_*.{zoom0,zoomIn,zoomOut}.geometry.scrollHeight`). No new scrollbar.
  `.arrangement-field-ground` height 634 = `view.height − RULER_HEIGHT`, as intended.

One observation, not a complaint: below the last lane the sticky header column continues as
a solid `--timeline-chrome-bg` block to the window bottom. It reads as a deliberate margin
in both themes.

---

## 7. Key title, and the behaviour-frozen regression set

`KeyboardVisualNode.tsx:309` → `` `${key} · row ${row}` ``. The verb is gone, so
`getByTitle('Play')` no longer substring-matches 30 keys. `aria-label="Row 2, key W"`
untouched. `git diff --stat -- e2e` is empty.

| Gate | Result |
|---|---|
| `e2e/arrangement-editing.spec.ts` + `e2e/timeline-preview.spec.ts`, `--workers=1`, fresh `bunx vite build` | **10 passed (1.1m)** — `e2e.txt` |
| `bun run test:run -- src/components/Nodes/__tests__` | **8 files / 177 tests green** — `nodes-tests.txt` |

Frozen behaviour, re-measured (`g5.json`), both themes, three zooms:

| | first gate | now |
|---|---|---|
| sky band | `{y 46, h 56}` | **46 / 56** |
| ruler stack | 64 = 22 @102 / 14 @124 / 28 @138 | **identical** |
| ruler viewport | 200 → 1280, h 64 | **identical** |
| header / stripe | 200 × 72, stripe 4px | **identical** |
| clip | r6, `border-left 2px`, name bar 18px | **identical** |
| playhead stopped | 1.5px, `filter: none`, `box-shadow: none` | **identical** |
| **pixel-lock** (grid canvas pixels vs bar ticks) | 0 px | **≤ 0.50 px** at 46 / 90 / 210 px-per-bar, 28/12/18 ticks matched, both themes — the residual is my probe reading the tick *label*'s left edge; no regression |
| drag ghost | name ✓ content ✓ readout ✓ hairline ✓ original 35% | **`ghostOpacity .96`, `originalOpacity .35`, readout `12.3 +11.2`, canvas ✓, hairline ✓** |
| +450 px drag | one history step, exact undo | **cursor 0→1→0, snapshot 16721 → 16725 → 16721 byte-length identical** |
| loop toggle | — | `aria-pressed` true → false |
| mixer | 188 px, pan pill | drawer 188, 4 strips, pan `C` |

**Not re-run, unchanged from the first gate:** double-stop (T27) and queued agent edits.
Headless Chromium delivers no engine frames, so `seek()` parks in `transportPending: 'seek'`
forever and **the playhead cannot be moved off tick 0** — I confirmed `Space` sets
`isPlaying` and the `is-rolling` class, and that the transform stays `translate3d(0,0,0)`.
The e2e `timeline-preview` spec covers Play/Stop publication and passes.

---

## 8. Reduced motion (`g5.json`, `g5-reduced-motion.png`)

Emulated `reducedMotion: 'reduce'`, walked every element under
`[data-surface-root="arrangement"]`:

- **0 running animations.**
- all **156** transitions collapse to `1e-05s`, including the new **sky band** and its
  wrapped cluster — the sky-band transitions carry nothing.
- record arm: `animationName: none`; the solid fill + 2px ring alternative is in
  `ArrangementSurface.css:970`.
- playhead **line and cap**: `animationName: none`, transform written straight to the DOM by
  `usePlayheadTransform`, which never consults the media query. Correct — it is the clock.
  (Verified by construction, not by observation; see §7.)
- the snap hairline's 80 ms fade-in is cancelled at `gestureHandles.css:197`.

Statics carry the meaning. ✅

---

## 9. The risks the lane named

**1 — the readout's `useLayoutEffect` forced layout, once per drag frame.** Measured
(`g5.json`), 1280×800, a continuous 2-second clip drag with `PerformanceObserver('longtask')`
plus rAF deltas, against a 2-second idle baseline in the same page:

| | long tasks | median frame | p95 | max | frames > 20 ms |
|---|---:|---:|---:|---:|---:|
| 2 s drag | **0** | 16.72 ms | 19.89 ms | 23.37 ms | 5 / 116 |
| idle | **0** | 16.56 ms | 18.28 ms | 27.18 ms | 2 / 116 |

+0.16 ms median, +1.6 ms at p95, no long task, no dropped-frame pattern. The read is on a
frame the browser was laying out anyway and it is measurably cheap. Accept it. Caveat: three
tracks, one clip — not re-measured on `hundredTracks`.

**2 — dark notes are paler.** Real; quantified in §4 (ΔL\* 27.8 → 19.3). Accept, flag for
the feel pass.

**3 — the sky band's second row is a new layout state.** It is, and it is broken in a band
the lane did not sample — **F2**.

**4 — the selected-note ring below 3:1.** Confirmed and worse than reported at mid velocity.
Measured against the note fill (`g4b.json`):

| ring candidate | light v0 / v64 / v127 | dark v0 / v64 / v127 |
|---|---|---|
| `--timeline-selection` (ships) | 1.05 / 1.37 / **1.98** | 1.26 / 1.10 / **1.47** |
| `--text-primary` @100 % | 5.34 / 3.72 / **2.56** | 2.97 / 2.15 / **1.61** |
| `--text-primary` @60 % over the fill | 2.78 / 2.28 / 1.85 | 2.01 / 1.61 / 1.34 |

**The reviewer's suggested 1.5 px `--text-primary` ring at 60 % does not work** — and neither
does it at 100 %. No flat ring colour can clear 3:1 against a fill whose luminance sweeps
this far in both directions. The only local construction that can is a **two-tone ring**:

```css
.piano-roll-note.is-selected {
    box-shadow: inset 0 0 0 1.5px var(--timeline-selection),
                inset 0 0 0 3px color-mix(in oklab, var(--bg-canvas) 80%, transparent),
                var(--focus-ring);
}
```

— one of the two edges always clears the floor whatever the fill does. Recording it in a gate
(as the lane did) was the honest interim move; the decision is spec §2.7's. Follow-up #4.

**5 — a moving tree.** Re-verified against the tree as it stands now; everything green.

---

## 10. Gates

| Gate | Result |
|---|---|
| `bun run test:run -- src/components/Arrangement src/components/PianoRoll src/song src/store src/keymap` | **61 files / 654 tests green** (`vitest.txt`) |
| `bunx tsc --noEmit -p tsconfig.app.json` | **clean, exit 0** (`tsc.txt`) |
| `bunx eslint src/components/Arrangement src/components/PianoRoll` | **clean, exit 0** (`eslint.txt`) |
| `git diff --check` over the lane's files (+ trailing-whitespace scan of the five untracked ones) | **clean** |
| `bunx vite build` | **exit 0** |
| e2e (`--workers=1`, fresh bundle) | **10/10** |
| Browser probes, light + dark, 800 → 1920 | **42 captures, 0 console errors, 0 page errors** across all eight harnesses |

**Dead-CSS audit** (`deadcss.txt`) — every class selector in the four sheets against all of
`src/`, `packages/oj-ui/src/` and `index.html`:

| sheet | classes | orphans |
|---|---:|---|
| `ArrangementSurface.css` | 123 | **0** |
| `PianoRoll.css` | 47 | 0 real (`piano-roll--inline` / `--surface` are composed at `PianoRoll.tsx:632`) |
| `DragGhost.css` | 11 | **0** |
| `gestureHandles.css` | 15 | 0 real (`arrangement-punch-brace` composed at `RulerStack.tsx:262`) |

Lane-declared custom properties never read via `var()`: **none**.

---

## 11. Doc drift

`docs/timeline.md:73` now says `--success-ink` **and why** ("2.99:1 on the header in light").
The §9 item is closed. The new paragraphs on the overlay pane (`:57`), the `SKY_HEIGHT` twin
(`:175`), the `Alt` gesture (`:151`) and the note ink / 0.68 ramp (`:215`) all match the code
I measured. One line needs updating with **F2**: `:37-38` says the cluster compacts "below
1024px"; the wrap it is compensating for starts at ~1180.

---

## 12. Follow-ups (not blocking)

1. **The playhead's line and cap tear by one frame of scroll** (§2, up to 150 px on a wheel
   notch, 18 px at 18 px/frame, 0.33 px at rest). The root cause is the ruler stack and grid
   anchor still riding the React/rAF `translateX` compensation that spec §2.1 outlaws, while
   the new pane is scroll-synchronous. The tempting fix — write `.arrangement-ruler-content`'s
   transform from the same `onScroll` handler — trades a playhead tear for a ruler-vs-grid
   tear, because `GridLayer` repaints from React state. This needs one decision (make the
   grid canvas over-draw and translate synchronously, or accept the lag and put the cap back
   on the line's side of the boundary), not a patch. *Owner: this lane / the next timeline pass.*
2. **`--arrangement-sky-pill-reserve: 432px` is not coupled to the pill.** The pill measures
   427.9 px at every width and never shrinks, so 432 is correct today — but nothing enforces
   it, and `rulerStack.test.tsx`'s `>= 428` is a copy of a measurement, not a coupling: add a
   zone to `TransportPill` and M3 comes straight back with a green test. Proposed:
   `TransportPillHost` publishes its measured width via `ResizeObserver` as
   `--oj-transport-pill-width` on `document.documentElement`, and
   `ArrangementSurface.css:37` becomes
   `--arrangement-sky-pill-reserve: calc(var(--oj-transport-pill-width, 428px) + 4px)`.
   If that cross-lane change is refused, the fallback is a browser assertion
   (`pill.width + 4 <= reserve` at three widths) — jsdom has no layout, so it is the only
   place the claim can be tested. *Owner: this lane + `src/components/Shell/` (oj-ui side).*
3. **The M4 "clip body" gate row is a no-op.** `--timeline-clip-bg` equals
   `--timeline-lane-bg` in both themes, so it re-tests the white-key row. The ground that
   ships is `color-mix(in oklab, var(--track-tint) 12%, var(--surface))`, measured **3.01:1**
   at the softest velocity over both live Paper Sketch tints — 0.01 of headroom, and §8.1's
   own "consider 16–18 % tint in light" would break it silently. Composite the gate over the
   tint using `trackTint.ts`'s palette. *Owner: this lane.*
4. **The selection ring on a note** — the two-tone construction in §9.4, or a spec §2.7
   ruling that the focus halo carries the state. *Owner: spec / oj-tokens + this lane.*
5. **`Alt`+double-click has no visible affordance.** One attribute at `RulerStack.tsx:234`:
   `<div className="arrangement-sections-row" title="Double-click to rename · Alt+double-click to drop a marker">`.
   *Owner: this lane.*
6. **`--accent-two` / `--accent-two-ink`.** Now more pointed than at the first gate: this
   round had to derive note ink from `--universal-connection`, a *port* name, mixed into the
   body-text colour. Spec the token with **both** acceptance criteria — ≥3:1 composited at
   the softest velocity **and** ≥25 L\* of ramp. *Owner: oj-tokens.*
7. `fieldOverlay.test.tsx:174-176` — `const paneLocalX = 0 - scrollLeft;
   expect(paneLocalX).toBeLessThan(0)` is arithmetic on literals, a gate that can only agree
   with itself. The origin-transform assertions above it are the real ones. Delete or read
   the pane-local x off the DOM. *Owner: this lane.*
8. The cap's apex is **0.75 px** left of the stopped line's centre (1 px rolling), because the
   line is drawn to the right of its tick and the cap is centred on it. Sub-pixel; name a
   convention and make both obey it. *Owner: this lane.*
9. **The inline roll's ~56 px shear** (first review §10.1) — unchanged, still disclosed.
10. **Feel — unverified and unverifiable headlessly.** `transportPending: 'seek'` never
    resolves without engine frames, so the playhead never leaves tick 0 in any harness. Still
    needs a founder pass with audio playing: no-click/no-dropout during a clip drag while
    rolling, the line and cap under real frames, double-stop, the level bead on real signal,
    the meter's 60 ms lerp, the record pulse, stopped-only audible ruler scrub, the
    faulted-clip mapping and the drop-invalid path. *Owner: founder.*

---

## 13. Verdict

**COMMIT-AFTER-FIXES.** Apply **F1** (`PianoRoll.css:34`, add `isolation: isolate`) and
**F2** (`ArrangementSurface.css:941`, split the media query at 1180 px, and correct
`docs/timeline.md:37-38`). Both are single declarations, both are measured green in this
gate's own harness, neither touches behaviour, and neither needs a re-run of anything beyond
`bunx eslint` and the two e2e specs.

Everything else in the round lands. M1–M4 are closed at the pixel, the frozen behaviour set
did not move, the ground fill is a real improvement, reduced motion is intact, the gates read
the shipping code and go red on revert, the four stylesheets carry no dead rule, and the
per-frame cost the lane flagged is 0.16 ms.
