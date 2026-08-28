# W3-P1 REVIEW — controls + the new Knob

**Verdict: DO-NOT-COMMIT (conditional).** Two AA contrast failures on 14px/600 button labels,
both inside files this lane owns and restyled, both fixable in well under ten lines. Everything
else in the lane measures true — geometry, motion, keyboard, gesture lifecycle, the Knob's whole
physics — and the work is a clear level above what it replaces. Fix must-fix 1 and 2, re-shoot
`button-variants`, and this commits.

Read-only review. No file in the repo was modified. Evidence: my own harness
(`plans/redesign-new-dna/.scratch/w3-p1-gate/{gate,gate2,gate3,gate4,probe,vl,vl3}.mjs`,
96 PNGs, logs `gate-log*.txt`), run under `node` + one Chromium against Ladle on `:61002`.
Ladle stopped afterwards. The lane's own 77 shots were not trusted; every number below is
re-measured.

---

## 1. Fidelity to the handoff, value by value

Read from `getComputedStyle` in the running catalog (light theme unless noted), diffed against
`design_handoff_new_dna/new-dna.css`. **Every specced value matches.**

| Component | Handoff | Measured | ✓ |
|---|---|---|---|
| Button | `padding 9px 16px`, `--r-md` 10px, `600 14px/1 Outfit`, `border:0`, no shadow, bg `--inset` | `9px 16px`, `10px`, `600 14px/14px`, `border-width 0px`, `box-shadow none`, `rgb(236,234,228)`, h32 | ✓ |
| Button press | `scale(.96)` on the spring | `matrix(0.96,…)`, `transform 0.26s cubic-bezier(.34,1.56,.64,1)` | ✓ |
| IconButton | 34×34, `padding 9px` | 34×34, `9px` | ✓ |
| Slider | 22px host, 6px pill track, accent progress, 18px thumb, 1.5px ring, sh1 | host 22px; `--oj-slider-progress` 0→100 at the bounds; thumb ring + halo visible in `slider-{rest,hover,focus}--*.png` | ✓ |
| Toggle | track 40×23, knob 17×17, `translateX(17px)` on the spring | 40×23, 17×17, `matrix(1,0,0,1,17,0)`, `0.26s cubic-bezier(.34,1.56,.64,1)` | ✓ |
| Segmented | pad 3px, gap 2px, `--r-md` container, 8px inner, `600 13px`, `padding 6px 14px`, selected = surface + sh1 | `3px` / `2px` / `10px` / `8px` / `600 13px` / `6px 14px` / `--bg-node` + `--shadow-raised` | ✓ |
| Input | `9px 12px`, 1px `--line2`, `--r-md`, `500 14px Outfit`, surface fill | `9px 12px`, `1px rgb(200,197,187)`, `10px`, `500 14px`, `rgb(255,255,255)` | ✓ |
| Select / Textarea | Input's shape | identical box; Select adds the muted caret in the right padding | ✓ |
| Field label | `600 12px Outfit`, `.02em`, uppercase, `--t2` | `600 12px`, `0.24px` (=.02em), uppercase, `rgb(90,88,80)` | ✓ |
| ValueScrubber chip | `500 12px` mono, `--inset`, `--r-sm`, `3px 7px`, `ew-resize`, hover inset 1px `--line2` | `3px 7px`, `6px`, `rgb(236,234,228)`, `ew-resize`, `inset 0 0 0 1px --border-strong` | ✓ |
| Knob | 52px, radial `surface→inset`, 1px ring, sh1, tick 3×15 @ `top:4`, origin `50% 22px`, −135…+135 | 52×52, `radial-gradient(circle at 35% 30%, rgb(255,255,255), rgb(236,234,228))`, tick `3.016×14.97` @ `top 4.004px`, origin `50% 21.996px`, sweep measured `-135 / -67.5 / 0 / 67.5 / 135` | ✓ |
| ParamRow | `1fr auto`, `gap 4px 10px`, label `500 13px`, value = the chip | matches in CSS (no Ladle story — see §7) | ✓ (unrendered) |

### Deviations

| # | Deviation | Justified? |
|---|---|---|
| 1 | `success` Button variant kept (audit §3.1 row 2 says drop) | **Yes.** Two app files outside this lane consume it; removing it red-lights `tsconfig.app.json`. Restyled as the mirror of `danger`, so the language holds. |
| 2 | Toggle **knob** gains a 1px `--border-control` ring the handoff does not have | **Yes.** D5 names the ring for "no fill delta"; I confirmed in the handoff itself that the dark knob is `#201F19` on a `#2A2822` track — invisible. The **track** uses `--border-strong`, which is exactly what the handoff specifies (`--line2`); the report frames that as a deviation, but it is not one. |
| 3 | No `Knob.figma.tsx` | **Yes.** No Figma master exists; a mapping would publish an invented node id. `bunx figma connect parse` is green at 53 mappings / 0 unresolved with the file absent. |
| 4 | Knob + Slider thumb ring use `--border-control`, not the handoff's `--line2` | **Yes.** D5 names both explicitly. |
| 5 | Knob label is uppercase with `--tracking-micro`; a formatted value readout is added under it | **Yes.** Audit §3.2 specifies the uppercase micro-label; the readout is a net addition and it is good. |
| 6 | Segmented `--vertical` uses `--text-md` (14px), not 13px | Yes — repo-only variant for the Settings sidebar; the handoff has no vertical spec. |
| 7 | Input's font default flips to Outfit, `mono` opt-in | Yes — the audit's own instruction (§3.1 row 12). App fallout in §5. |
| 8 | Button `secondary` is the same box as `node`, separated by ink | Yes — one inset button is the whole point. |
| 9 | `--knob-size` (52px token) is always shadowed by the inline `size` default | No harm, but the token is now dormant (code value #8). Either read it as the default or delete it. |

---

## 2. States, contrast, focus, motion

**Every component has default / hover / focus-visible / active / disabled, and they are visually
distinct in both themes.** Verified by real Tab presses and held pointer-downs, not `.focus()`.

**Focus ring** — one ring, everywhere, in both themes, measured 400ms after Tab so the 120ms
transition has settled: Button, Input, Knob, Segmented and the Toggle **track** all resolve
`oklab(… / 0.28) 0 0 0 3px` in light and `/ 0.35` in dark. The Slider carries it on the WebKit
thumb pseudo (not readable via `getComputedStyle`, so proved by pixels:
`slider-focus--{light,dark}.png` shows the halo). No component leaves a UA outline behind.

**Layout stability (No-Surprise)** — `offsetLeft/Top/Width/Height` identical at rest, on hover
and under a held pointer for Button, Segmented button, Input, ValueScrubber chip, Toggle track
and Knob. The only transform is the Button's `scale(.96)`, which does not reflow. **PASS.**

**Motion** — every transition resolves to `0.12s cubic-bezier(.2,.8,.3,1)` (colour/bg/border/
shadow) or `0.26s cubic-bezier(.34,1.56,.64,1)` (transform only). No third curve anywhere in the
lane. The Knob tick has `transition-duration: 0s` — correct, a readout must not ease.

**Reduced motion** (`emulateMedia reducedMotion:'reduce'`): Toggle knob → `transition: none`
(travel is instant, the state still reads); Slider thumb → box-shadow only; Button loader dots →
`animation-name: none`, opacity pinned 0.6 (still legibly "busy"); Knob tick unchanged (already
0s). Nothing loses meaning. **Caveat:** the Button's press spring is *not* collapsed by
`Button.css`; it relies on the blanket rule in `src/styles/global.css`, which Ladle does not load
and an external consumer of `packages/oj-ui` would not get. In the app it is covered.

**Contrast** (my own maths: computed colour composited over the first opaque ancestor ground;
14px/600 and 13px are normal text, so the bar is 4.5).

Passing, both themes: Button default (14.2 / 12.8), primary at rest (**5.08 / 6.27**), secondary
(5.9 / 6.2), ghost, link (4.97 / 6.7), armed, Segmented selected + unselected, Input/Select/
Textarea values, Field label / description / error, ValueScrubber value + label, Knob label +
value, Toggle label + description.

Failing — see must-fix 1 and 2.

> **Coordinator's flag, answered:** the light Primary and Armed buttons render `rgb(29,28,24)`
> (`#1D1C18`, i.e. `var(--text-on-accent)`) — **not white**. `Button.css:47` reads the token,
> `--text-on-accent` is `#1D1C18` in both generated themes, and the rest-state contrast is
> **5.08:1**. See `zoom-button--light.png` at 4× — the ink is unmistakably dark. Not a must-fix
> at rest. The real defect is one state over: **hover**.

---

## 3. Knob

Driven for real in Chromium, all assertions against `aria-valuenow`:

| Check | Result |
|---|---|
| 30px of a 150px `dragRange` = 20% of the span | 0.75 → 0.95 ✓ |
| clamps at both ends however far the pointer runs | 1 / 0 ✓ |
| Shift = a tenth of the travel | 0.75 → 0.77 ✓ |
| log mapping is geometric | CUTOFF 1200 Hz reports `1.20 kHz`, rotation 25.03° = `ln(60)/ln(1000)` ✓ |
| Arrow / PageUp-Down / Home / End | 0.75 → 0.76 → 0.66 → 1 → 0, tick at Home `-135deg` ✓ |
| wheel only when focused | unfocused 0.75 (unchanged), focused 0.76 ✓ |
| double-click → `defaultValue` | 1 → 0.75 ✓ |
| disabled = `tabindex="-1"` + `aria-disabled` + no drag | 0.3 → 0.3 ✓ |
| pointercancel freezes the gesture (later moves do nothing) | 0.8833 → 0.8833 ✓ |
| `onChange` per frame vs `onCommit` once | 7 `aria-valuenow` updates across a 10-step drag; unit tests pin `onCommit` × 1 on release **and** on cancel / window-blur / unmount, with no `onChange` after release ✓ |
| tick has no transition | `transition-duration: 0s` ✓ |

`knobMath.ts` is the right shape — the arithmetic is out of the component and unit-tested.
`knobUsesLog` correctly refuses `min<=0`, `max<=0` and `max===min` and falls back to linear;
`knobNorm` guards `max===min`; `knobValue` clamps its input. Findings:

- **`knobNorm(value<0, min>0, max, log)` returns NaN** — `Math.log(negative)` is NaN and
  `clamp01` passes NaN through (`NaN<0` and `NaN>1` are both false). Reachable only if a caller
  feeds a log dial a value below its own `min` *and* below zero; the visible damage is
  `rotate(NaNdeg)` (ignored, tick sits at 0°) plus `aria-valuenow="NaN"`. One `Number.isFinite`
  in `clamp01` closes it. Low.
- **No `step` snapping.** `nudge`/wheel do `value + n*step` from wherever the value happens to
  be, so a stepped dial never lands on the grid, and floats accumulate (I measured
  `0.9500000000000002`). `aria-valuetext` carries the formatted string so screen readers are
  fine; the raw `aria-valuenow` is not. Low.
- **Undo-stack flooding** (see must-fix 4): keyboard and wheel commit on *every* event.
- `{...rest}` lands on the wrapper, not on the dial, so a consumer's `aria-*`/`data-*` misses the
  `role="slider"` element. Worth a doc line.

---

## 4. API / consumer safety

- `bunx tsc --noEmit -p tsconfig.app.json` — **clean, exit 0, zero output.**
- `bunx tsc --noEmit -p packages/oj-ui/tsconfig.json` (strict) — 16 errors, **all** in other
  lanes' `.figma.tsx` files (Banner, DeviceSelect, EditableLabel, KeyTile, ListRow, Marquee, Menu,
  Modal, OffscreenPointer, StatusDot, Swatch, Waveform, WaveformView). None in P1's files.
- `Slider` is still a real `<input type="range">` with its accessible name intact — measured
  `{tag:"INPUT", type:"range", name:"Gain (dB)"}`, so `getByRole('slider', /gain/i)` (J1 /
  arrangement e2e) still resolves.
- `SegmentedControl` / `Tabs`: `role="tablist"` + roving tabindex confirmed live — before
  `[0,-1,-1]` with `aria-selected` on the first; ArrowRight → `[-1,0,-1]`, selection *and* focus
  move to "Beta"; Home returns to "Stable". Unchanged and correct.

### The app-side `mono` follow-up, precisely

`.oj-input` is Outfit unless `mono` is passed. Every app `<Input>`, with whether an app CSS rule
already fixes the family:

| Site | What it holds | Now renders | Action |
|---|---|---|---|
| `src/components/Export/ExportDialog.tsx:176` | `Tail seconds`, `type="number"`, `step=0.1` | **Outfit** — `ExportDialog.css:42` sets only `width` | **add `mono`** |
| `src/components/Export/ExportDialog.tsx:182` | destination path | **Outfit** — `ExportDialog.css:62` sets only `min-width`/`flex` | add `mono` |
| `src/components/CommandBar/AuthChooser.tsx:272` | API key (`type="password"`) | Outfit — `.command-bar-auth-input` sets no family | add `mono` |
| `src/components/CommandBar/AuthChooser.tsx:264` | base URL | Outfit | optional |
| `src/components/Collab/CollabControl.tsx:121` | join code, uppercase, `maxLength 12` | Outfit — `.collab-code-input` already forced `font-family: inherit`, so **no regression**, but a code wants mono | optional |
| `ExportDialog.tsx:154` (filename), `AutoParamPanel.tsx:68`, `PluginsPanel.tsx:152` | prose | Outfit via an explicit `--font-sans` rule | none |
| `CollabControl.tsx:95`, `DevLogPanel.tsx:297`, `IssueReporter.tsx:120`, `MIDIDeviceBrowser.tsx:170` | name / search / title | Outfit — correct | none |
| `ValueScrubber` inline editor | exact value | passes `mono` | done |

> The report claims `ExportDialog.css:42/62` "set a family and are therefore unaffected". They do
> not — they set `width` and `flex` only. Those are the two sites that actually regressed.

---

## 5. Tests, lint, Figma

| Gate | Result |
|---|---|
| `bun run test:run -- packages/oj-ui` | **300 passed / 39 files** — matches the claim |
| `bunx eslint packages` | exit 0 |
| `bunx figma connect parse` | exit 0, 53 `figmaNode` mappings, 0 unresolved |
| Console errors across 40 story loads (my run) | **0** |

**Non-vacuity: confirmed.** Every new test asserts something that did not exist before the diff —
`loading`/`aria-busy`/`.oj-btn__label` (new prop), `oj-input--mono` and its non-leakage (new
prop), `--oj-slider-progress` at both bounds plus caller-`style` survival (new behaviour),
`.oj-field__description`/`__error` presence *and* absence (new props). The Knob's 28 `it()`s are
all new, and the gesture-lifetime block (`it.each(['cancel','window-blur','unmount'])`) asserts
`onCommit` is called exactly once and stays at one after a later unmount — that is the test that
would catch the real bug.

---

## 6. Taste, next to the handoff's "Component retheme" frame

I opened `Visual Language.html` and read its computed values, so the comparison is against the
approved artefact, not a memory of it (`vl-retheme.png`).

- **Button row** reads right: one solid accent, everything else inset, ghost/link weightless.
  Ink-on-accent is *better* than the handoff's white (which is the 3.36:1 failure D5 exists to
  fix). Danger and Success, though, read as pale chips rather than buttons — they are the
  lightest things in the row, and that is exactly the contrast problem in must-fix 2.
- **Segmented**: the selected chip's lift is subtle and correct — the shadow strength is right,
  not a card floating off a pill.
- **Slider**: thumb halo is the right size; the 18px disc on a 6px rail reads as an instrument
  control. Progress fill lands exactly at the thumb centre.
- **Toggle**: knob is optically centred — I measured the gaps, 3px on all four sides off, 3px on
  all four sides on. In **dark** the cap is `#201F19`, darker than its orange track, so it reads
  as a *hole* rather than a cap. This is faithful — the handoff prototype's dark knob is the same
  `#201F19` — and the added `--border-control` ring makes it legible, which is what D5 asks for.
  Not a must-fix (state is never ambiguous), but a lighter dark cap would read as a switch
  instead of a punch-out.
- **Knob**: the best thing in the lane. 52px and 34px are visibly one object, the tick is crisp,
  the value readout under the label is a genuine improvement on the handoff. In **light** the
  tick measures **2.79:1** against the dial's inset edge (WCAG 1.4.11 wants 3:1 for a
  non-text indicator); against the white centre of the gradient it is ~3.3. The handoff specifies
  exactly this, and it is legible at 4× — flagging, not blocking.
- **Disabled fade** is on the strong side: 45% over already-muted ink gives 1.85–2.1:1, and the
  disabled Input (55% *and* `--text-muted`) lands at 2.17:1 — you cannot read a locked device
  name. WCAG exempts disabled controls, so this is taste: drop the double-dim (pick the muted ink
  *or* the opacity, not both).
- **Loading** is right: the label's box is held, the button keeps its colour, and the dots march
  where the label was. A busy Export button no longer looks broken.

---

## 7. Gaps in the evidence base (not defects, but they limit what any of us has actually seen)

1. **Ladle loads no webfonts.** `document.fonts` is empty; `document.fonts.check('14px Outfit')`
   and `…'JetBrains Mono'` both return true only because the family name falls back, and I
   measured identical text widths for `"JetBrains Mono"` and `Outfit` (42px) versus generic
   `monospace` (46px). `src/styles/fonts.css` carries the `@font-face` rules and
   `.ladle/components.tsx` never imports it. **Every screenshot in this redesign — the lane's 77
   and my 96 — was rendered in the system sans.** So "600 14px Outfit" is verified as *declared*,
   never as *rendered*, and the whole Outfit-vs-mono distinction is currently invisible in the
   catalog. `.ladle/` is a shared file, not P1's, but this weakens visual sign-off for every lane
   and is one import line.
2. **ParamRow has no story** — the only component in the lane never rendered in the catalog. Its
   CSS reads correct, and the negative `margin-block: -4px` around a 22px slider box is the kind
   of thing that only shows up on screen.
3. Firefox / Safari, touch, and the running app remain unexercised — the lane says so itself and
   is accurate.

---

## 8. Ranked must-fix

1. **Primary / armed Button label drops below AA on hover, light theme — 3.98:1.**
   `#1D1C18` on `--accent-secondary` `oklch(0.6 0.19 40)` = `rgb(216,74,0)`. Rest is 5.08 and
   passes; the moment the pointer lands on the most-pressed control in the product, its label
   fails. Root cause: D5 flipped `--text-on-accent` to ink for the rest state, but light
   `--accent-secondary` (the handoff's `acc-hi`) goes *darker* on hover — the two corrections
   were never composed. Dark is fine (7.08). Fix either in the tokens lane (light
   `--accent-secondary` becomes a *lighter* accent, e.g. `oklch(0.72 0.19 40)`, which also reads
   as "more energy under the finger") or in `Button.css:51` (hover mixes toward the light, not
   away from it). One line either way. Affects `.oj-btn--primary:hover` and
   `.oj-btn.is-active:hover`.
2. **Danger and Success tinted labels fail AA, both themes.**
   danger light 4.15 rest / 3.78 hover; danger dark 4.15 / 3.72; success light 4.28 / 3.99;
   success dark 5.09 / 4.43 hover. `--danger-ink` / `--success-ink` were tuned to clear AA on the
   *page* ground (they do: Field error is 5.07 / 5.84) and were never re-checked on their own
   10%/18% wash. Two ways out: darken the `*-ink` pair (tokens lane, D5's own file), or cut the
   wash to ~6% rest / 12% hover in `Button.css`. Same rule applies to the hover step, which is
   where every one of these is worst.
3. **`Field`'s new `description`/`error` slots pollute the control's accessible name.** Measured
   live: the buffer-size select announces as `"Buffer size64 samples128 samples256 samplesSmaller
   buffers cut latency and cost CPU. 128 is the live default."`, and the tempo input as
   `"TempoTempo must be between 20 and 300."`. The lane documents the trade-off, but this is a
   *new* prop shipping a known defect. When `htmlFor` is present, give the slots ids and let the
   consumer (or Field itself, via cloning) set `aria-describedby`; existing usages are untouched
   either way. Fix before the app lane starts adopting the props.
4. **Knob wheel and key-repeat commit on every event.** `onCommit` is the undo boundary, so one
   wheel notch or one auto-repeated ArrowUp is one undo step — spinning a knob buries the undo
   stack. Coalesce with a short idle timer (~250ms) before this reaches the graph.
5. **Two app sites really did lose mono** (`ExportDialog.tsx:176` `type="number"`, `:182` path) —
   the report's risk list wrongly clears them. Fold into the app lane's follow-up with the exact
   list in §4.

Non-blocking: `knobNorm` NaN guard; `step` snapping; `--knob-size` dormant token; disabled
double-dim; Ladle font pipeline (§7.1); ParamRow story (§7.2); Button `loading` sets `disabled`
so a busy button leaves the tab order.

---

**Verdict: DO-NOT-COMMIT until must-fix 1 and 2 land** (both are CSS/token one-liners in files
this lane or its D5 sibling owns; 3–5 can follow). Everything else in this lane is ready, and the
Knob in particular is exactly what the audit asked for.

*Artifacts: `plans/redesign-new-dna/.scratch/w3-p1-gate/` — 96 PNGs + `gate-log.txt`,
`gate-log-2.txt`, `gate-log-3.txt` + the five re-runnable harnesses.*
