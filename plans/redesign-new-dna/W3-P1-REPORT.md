# W3-P1 — Controls (New DNA)

Lane: the controls a performer's fingers touch. Button, IconButton, Slider, Toggle,
SegmentedControl/Tabs, Input, Select, Textarea, Field, ValueScrubber, ParamRow, and the
new **Knob**.

Everything below was recreated from `design_handoff_new_dna/new-dna.css` (`.nj-*`) into the
library's `.oj-*` class structure, using only semantic tokens from
`packages/oj-ui/oj-tokens.css`. No literal colours were introduced anywhere in this lane.

## Gates

| Gate | Result |
|---|---|
| `bun run test:run -- packages/oj-ui` | **300 passed / 39 files** (was 252/38 — +48 tests, +1 file) |
| `bunx tsc --noEmit -p tsconfig.app.json` | clean |
| `bunx eslint packages src` | clean (exit 0) |
| `bun run build` | built in 3.9s |
| `bunx tsc --noEmit -p packages/oj-ui/tsconfig.json` (stricter: `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`) | **every file this lane owns is clean.** 17 pre-existing errors remain in *other* lanes' `.figma.tsx` files (Banner, DeviceSelect, EditableLabel, KeyTile, ListRow, Marquee, Menu, Modal, NodeFrame, OffscreenPointer, StatusDot, Swatch, Waveform, WaveformView) |
| Browser harness (`plans/redesign-new-dna/.scratch/w3-p1/shoot.mjs`, node + Playwright, Ladle :61001) | **16/16 checks passed, zero console errors across 40 story loads** |
| `bunx figma connect parse` | 53 mappings, 0 unresolved |

## Per component

### Button — `.oj-btn`
- **Changed:** flat inset construction. No border, no shadow. `background: var(--bg-tertiary)`,
  `padding: 9px 16px`, `--radius-md`, `600 14px` Outfit, `line-height: 1` → 32px tall.
  Hover `color-mix(in oklab, var(--text-primary) 8%, var(--bg-tertiary))`; active
  `scale(var(--press-scale-btn))` on `--motion-spring`; `:focus-visible` = `--focus-ring`,
  `outline: none`. Verified computed in-browser: `border 0px / radius 10px / padding 9px 16px /
  600 14px Outfit / h 32 / icon-only 34×34`.
- **Primary** = `--accent-primary` fill + `--text-on-accent`, hover `--accent-secondary`.
  **Danger** = `color-mix(--accent-danger 10%, --bg-tertiary)` + `--danger-ink` (18% on hover) —
  never a solid red. **Ghost** = transparent → inset. **Link** = text-only, `--accent-ink`
  (ink token so the tint clears AA), underline on hover, no press scale.
  **`.is-active`** = accent fill (accent is "engaged" in the new language; it used to be
  `--accent-success`).
- **`success` variant: KEPT, restyled — a deliberate deviation from the audit.** The audit
  (§3.1 row 2) says drop it. It is live in the app in two places I do not own
  (`src/components/Guides/LowLatencyGuide/LowLatencyGuide.tsx:189`,
  `src/components/Nodes/RecorderNode.tsx:272`), so removing it breaks `tsconfig.app.json`.
  It is now the mirror of `danger` — a 10%/18% success wash with `--success-ink` text, never a
  solid green fill. Nothing in the new language is lost, and the app lane can retire the prop
  later with a one-line change.
- **API added:** `loading?: boolean`. Sets `aria-busy`, disables the button, keeps the label's
  exact box (`.oj-btn__label` gets `visibility: hidden`) and marches three CSS-only dots in its
  place — nothing on a toolbar reflows while work is in flight, and there is no Spinner
  dependency (Spinner is lane P2). A loading button reads *busy*, not unavailable: it is
  excluded from the disabled fade and its hover is frozen per variant. The label is only
  wrapped when `loading` is true, so the non-loading DOM is byte-identical to before.
- **Disabled:** `--text-muted` at 45%, no hover, no press, `cursor: not-allowed`.
- **Tests:** +3 (loading keeps the label / no wrapper when idle / no click while loading).
- **Shots:** `button-variants--{light,dark}`, `button-states--*`, `button-loading--*`,
  `button--{hover,focus,active}--{light,dark}`.

### IconButton — `.oj-icon-btn`
- Inherits everything from `Button iconOnly` — now exactly 34×34 with `padding: 9px`.
  CSS unchanged (it only centres the glyph). `active` follows Button's new accent fill.
- **Figma:** `IconButton.figma.tsx` example fixed (it was `<IconButton />`, missing the
  required `label`).
- **Shots:** `iconbutton-variants--*`, `iconbutton-disabled--*`.

### Slider — `.oj-slider`
- Still a real `<input type="range">` — verified in-browser that
  `getByRole('slider', { name: … })` resolves (the J1/arrangement e2e contract).
- 6px pill track, `--bg-tertiary` rail with `--accent-primary` progress; 18px `--bg-node` thumb,
  `1.5px solid var(--border-control)`, `--shadow-raised`; height 22px. Hover/focus-visible:
  thumb `scale(1.15)` + `--shadow-raised, --focus-ring`. Disabled: 45%, `not-allowed`, no swell.
- **API added (internal):** the component writes `--oj-slider-progress` (0–100) into `style`,
  because WebKit has no `::-moz-range-progress`; the runnable track paints the fill with a
  hard-stop gradient off that property. Caller-supplied `style` is merged, not replaced.
- Reduced motion: the thumb keeps only its `box-shadow` transition.
- **Tests:** +2 (progress property at both ends; caller `style` survives).
- **Shots:** `slider-states--*`, `slider--{hover,focus,active}--*`.

### Toggle — `.oj-toggle`
- 40×23 pill track (`--bg-tertiary`), 17px `--bg-node` knob with `--shadow-raised` translating
  `17px` on `--motion-spring`; checked = `--accent-primary` track with a transparent border;
  `:focus-visible` ring on the track. Label `500 14px`, description `--text-muted` 13px.
  Verified computed: `track 40×23`, `knob 17×17`, `translate(17px, 0)`.
- **Deviation from the lane brief, following D5 (binding):** the brief asked for
  `1px --border-control` on the track. D5 says `--border-control` is for rings *where there is
  no fill delta*, and that "inputs/toggles keep `--border-strong`". The track has a fill delta
  against every ground it sits on, so it uses **`--border-strong`**. The **knob** does not —
  in dark, `--bg-node` (#201F19) against `--bg-tertiary` (#2A2822) is nearly invisible — so the
  knob wears the control ring instead, the same one the slider thumb has. Caught by looking at
  `toggle-states--dark.png`; fixed and re-shot.
- The old `:active` knob nudge is gone (it fought the spring translate and moved a value).
- **Shots:** `toggle-states--*`, `toggle--{hover,focus,active}--*`.

### SegmentedControl / Tabs — `.oj-seg`
- 3px-padded `--bg-tertiary` pill, `--radius-md`, 2px gap. Buttons `600 13px` Outfit,
  `--text-secondary`, `padding: 6px 14px`, 8px radius, transparent.
  **Selected = `--bg-node` + `--text-primary` + `--shadow-raised`**, not an accent fill —
  the accent belongs to things that are engaged or carrying signal, not to "which page am I on".
- Vertical variant (the Settings sidebar) keeps the same physics, stacked, `padding: 8px 12px`.
  The old inset right-edge marker is gone; the raised chip is the marker now.
- Roving tabindex + Arrow/Home/End were already correct and are untouched;
  `:focus-visible` ring added per segment (and stacked with the raised shadow when selected).
- **Shots:** `segmented-horizontal--*`, `segmented-vertical--*`,
  `segmented--{hover,focus,active}--*`.

### Input — `.oj-input`
- `--bg-node` fill, `1px solid var(--border-strong)`, `--radius-md`, `500 14px` Outfit,
  `padding: 9px 12px`, `box-sizing: border-box`. Placeholder `--text-muted`.
  Hover (unfocused) lifts the hairline to `--border-control`; focus = `--accent-primary` border
  + `--focus-ring`; `[aria-invalid="true"]` = `--danger-ink` border and a danger-tinted ring on
  focus; disabled = inset fill, muted, `not-allowed`; read-only = inset fill.
- **API added:** `mono?: boolean` → `.oj-input--mono` (JetBrains + `tabular-nums`).
  **This flips the default:** Input used to be mono for everything. Prose fields are now Outfit
  and exact/numeric fields opt in. See "Risks" — app-side numeric inputs that relied on the old
  default now render in Outfit until the app lane passes `mono`.
- **Tests:** +2 (mono opt-in; the flag does not leak to the DOM).
- **Stories:** new (`Input/Input.stories.tsx` — States + MonoForExactValues).

### Select — `.oj-select`
- Input's shape, plus a `--text-muted` caret drawn as two CSS gradient triangles in the right
  padding (`appearance: none`), so the native arrow never fights the theme. Options get the
  surface ground. Same hover/focus/invalid/disabled language as Input.
- **Stories:** new (`Select/Select.stories.tsx`).

### Textarea — `.oj-textarea`
- Input's shape for prose: `--bg-node`, `--border-strong`, `--radius-md`, `500 14px` Outfit,
  `line-height 1.5`, vertical-only resize. Same focus/invalid/disabled treatment.

### Field — `.oj-field`
- Label `600 12px` Outfit, uppercase, `letter-spacing: .02em`, `--text-secondary`; 6px gap.
- **API added:** `description?: ReactNode` (`--text-muted` 12px) and `error?: ReactNode`
  (`--danger-ink` 12px), both ordered *after* the control.
- **Known a11y trade-off (documented in the prop doc):** the root stays a wrapping `<label>` —
  changing it to a `<div>` would break the `.oj-field` DOM contract and lose click-to-focus for
  the many app usages with no `htmlFor`. So a `description` folds into the control's accessible
  name. Consumers who want it announced separately should pass `aria-describedby` on the
  control. Both new props are additive, so no existing usage changes behaviour.
- **Tests:** +2. **Stories:** new (`Field/Field.stories.tsx`, exercising Input/Select/Textarea
  inside it, including the error state).

### ValueScrubber — `.oj-value-scrubber`
- `500 12px` mono, `tabular-nums`, `--text-primary` on a `--bg-tertiary` chip, `--radius-sm`,
  `padding: 3px 7px`, `cursor: ew-resize`, hover `box-shadow: inset 0 0 0 1px var(--border-strong)`.
  The old 1px transparent border is gone (it made the chip jump a pixel on hover in some
  browsers); hover and focus are pure `box-shadow` now, so nothing reflows.
- The inline editor now renders `<Input mono>`, sized `8ch`.
- Drag/commit semantics are untouched: the parent still wires `onPointerDown`/`onWheel` through
  the spread, `onCommit` still fires on Enter/blur, Escape still reverts. The timeline's BPM
  and zoom scrubbers keep working, and their app-side overrides still apply.

### ParamRow — `.oj-param-row`
- `__line` is now `grid-template-columns: 1fr auto; gap: 4px 10px` (was flex/space-between).
  Label `500 13px` Outfit `--text-secondary` with a hover ink shift and a focus ring;
  the value is the ValueScrubber chip (`--bg-tertiary`, `--radius-sm`, `3px 7px`, mono 12px).
- Driven state: was a text underline, now an accent-2 hairline
  (`inset 0 -1px 0 0 var(--timeline-automation-line)`) under the chip — a state, not decoration.
- The embedded slider keeps its full 22px control box (an 18px thumb must not be clipped) and is
  pulled back into a compact row with `margin-block: -4px`; net row cost is unchanged at 14px.
- `step` is now defaulted at the boundary (`step ?? 1`), which also clears a pre-existing
  `exactOptionalPropertyTypes` error in the package's strict config.

### Knob — NEW, `packages/oj-ui/src/components/Knob/`
Files: `Knob.tsx`, `knobMath.ts`, `Knob.css`, `Knob.test.tsx`, `Knob.stories.tsx`.
Exported from `src/index.ts` as `Knob`, `KnobProps`, `knobNorm`, `knobValue`, `knobRotation`.

**API** (audit §3.2, plus three additions):

```ts
interface KnobProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange' | 'defaultValue'> {
  value: number; min: number; max: number;
  log?: boolean;                 // geometric mapping; falls back to linear if min/max ≤ 0
  label: string;                 // uppercase mono micro-label AND the accessible name
  format?: (v: number) => string;
  onChange: (v: number) => void; // live, per pointer move — drives the optimistic edit
  onCommit?: (v: number) => void;// exactly once per gesture — the undo boundary
  dragRange?: number;            // default 150
  size?: number;                 // default 52
  step?: number;                 // NEW — default is 1% of the NORMALISED range
  defaultValue?: number;         // NEW — double-click target
  disabled?: boolean;
}
```

**Visual:** `--knob-size`-driven circle,
`radial-gradient(circle at 35% 30%, var(--bg-node), var(--bg-tertiary))`,
`1px solid var(--border-control)`, `--shadow-raised`, `cursor: grab` / `grabbing`.
`::after` tick `--accent-primary`, `transform-origin: 50% 22px` at 52px,
`rotate(var(--oj-knob-rot))` mapped −135°…+135°. Hover / focus-visible / dragging all show
`--shadow-raised, --focus-ring`. Label + formatted value below in `500 11px` mono
(`--text-muted` / `--text-secondary`). Every dimension derives from `--oj-knob-size`
(tick width `max(2px, size*.058)`, top `size*.077`, length `size*.288`, origin `size*.423`),
so 34px and 52px are the same object — verified in `knob-sizes--light.png`.
**The tick never transitions, in any motion preference** — it is a readout, and a value that
eases into place lies about where the parameter is.

**Interaction:** vertical pointer drag, `dragRange` px = full sweep, accumulated per move (so
holding/releasing `Shift` mid-drag changes sensitivity without a jump). Pointer capture *plus*
window `pointermove`/`pointerup`/`pointercancel`/`blur` listeners; the gesture closes exactly
once, on whichever comes first, including unmount. Double-click → `defaultValue`.
A **focused** knob takes the wheel, via a non-passive native listener, so scrolling a panel full
of knobs still scrolls the panel.

**A11y:** `role="slider"`, `aria-valuenow/valuemin/valuemax/valuetext`, `aria-orientation`,
`aria-label` from `label`, `tabIndex 0` (`-1` + `aria-disabled` when disabled).
Arrow ±1 step, PageUp/PageDown ±10, Home/End to the bounds. Keyboard and wheel changes commit
immediately, so each keystroke is its own undo step. The default step is 1% of the *normalised*
range, which for a linear dial is exactly `range/100` (as specced) and for a log dial steps
evenly across the whole sweep instead of crawling at the bottom.

**Math** lives in `knobMath.ts` (not `Knob.tsx`) so `react-refresh/only-export-components` stays
happy and the arithmetic is testable without rendering. `log` with a non-positive bound falls
back to linear rather than handing a performer a NaN.

**Verified in a real browser** (not just jsdom), all against `aria-valuenow`:

| Check | Result |
|---|---|
| 30px of a 150px range moves 20% of the span | 0.75 → 0.95 |
| clamps at max / min however far the pointer travels | 1 / 0 |
| `Shift` gives a tenth of the travel | 0.75 → 0.77 |
| log mapping is geometric (1200 → 1200 × 1000^0.1) | 2394.3 (expected 2394.3) |
| ArrowUp steps 1% | 0.75 → 0.76 |
| PageDown steps ten | 0.76 → 0.66 |
| End / Home | 1 / 0 |
| a focused knob takes the wheel | 1 → 0.99 |
| double-click returns to `defaultValue` | 0.75 |
| disabled dial is out of the tab order | `tabindex="-1"` |
| the tick sweeps the full arc | −135° −67.5° 0° 67.5° 135° |

**Unit tests:** 31, including the log round-trip over 20 Hz–20 kHz, clamping at both ends, the
linear fallback for a non-positive `min`, gesture-closes-exactly-once on
cancel / window-blur / unmount, and "no `onChange` after release".

**Stories:** `States` (linear + log + disabled + 34px tiny), `LinearVsLog`, `Sweep`, `Sizes`.

## Screenshots

`plans/redesign-new-dna/.scratch/w3-p1/` — 77 PNGs, plus the harness itself
(`shoot.mjs`, re-runnable: start Ladle on 61001, then `node …/shoot.mjs`).

- Every owned story in **light and dark**: `<name>--light.png` / `<name>--dark.png`
  (button-variants, button-states, button-loading, iconbutton-variants, iconbutton-disabled,
  slider-states, toggle-states, segmented-horizontal, segmented-vertical, input-states,
  input-mono, select-states, textarea-states, field-states, valuescrubber-editable,
  valuescrubber-readonly, knob-states, knob-sweep, knob-sizes, knob-linear-vs-log).
- Interaction states in both themes for Button, Slider, Toggle, Segmented, Input and Knob:
  `<name>--hover--<theme>.png`, `--focus--<theme>.png`, `--active--<theme>.png`
  (focus is driven by real Tab presses, so it is genuine `:focus-visible`; active is a held
  pointer-down). Disabled is covered inside the `*-states` shots.
- `knob-keyboard-min--light.png` — the dial after Home.

**What looking at them changed.** Two fixes came out of the review pass, not the spec:
1. `button-states--light.png` showed the loading button rendering at the disabled 45% — a busy
   button was reading as unavailable. Disabled styling now excludes `.is-loading`, and the
   per-variant hover is frozen while busy.
2. `toggle-states--dark.png` showed the knob nearly invisible on its track. Resolved by applying
   D5 properly (see Toggle above).

## Deviations from the handoff / brief, with reasons

1. **`success` Button variant kept** (audit says drop). It is used by two app files outside this
   lane; removing it breaks the app typecheck. Restyled as a tint, so the new language holds.
2. **Toggle track uses `--border-strong`, knob gains `--border-control`** — the lane brief said
   `--border-control` on the track. D5 is binding and says the control ring is only for rings
   with no fill delta; that describes the knob, not the track. Dark legibility is the evidence.
3. **`Knob.figma.tsx` NOT created.** Every other `.figma.tsx` maps to a real Figma node id, and
   `code-connect.yml` runs `figma connect publish` on non-PR pushes. There is no Knob master in
   the Figma library yet, so a mapping would either publish to a non-existent node or ship an
   invented id. Follow-up: add it in one file once the Knob master exists (the component-map
   generator, `bun run gen:component-map`, will pick it up).
4. **Button's `secondary` and default `node` variants are now the same box**, distinguished by
   ink (`--text-secondary` vs `--text-primary`). The new DNA has exactly one inset button; a
   second fill would be a colour with no meaning.
5. **Input's font default flipped** to Outfit with `mono` as the opt-in — this is the audit's
   own instruction (§3.1 row 12), recorded here because it is the one change with app-visible
   fallout.

## Risks / follow-ups for other lanes (not touched — outside my ownership)

- **Numeric app inputs lost mono.** `.oj-input` is Outfit unless `mono` is passed. Places that
  were relying on the old mono default and do *not* already override the family should add
  `mono`. `ValueScrubber`'s editor already does. Known app overrides that *set* a family and are
  therefore unaffected: `ExportDialog.css:54`, `ExportDialog.css:42/62`,
  `AutoParamPanel.css:2`, `PluginsPanel.css:10`.
- **Mixer fader.** `ArrangementSurface.css:289-292` overrides
  `.mixer-strip__fader .oj-slider::-webkit-slider-runnable-track { background: var(--bg-tertiary); border: 2px solid var(--text-primary) }`.
  That override wins over the new gradient, so the vertical fader shows **no accent progress**
  and keeps a 2px ink border. It needs the app lane to drop those four rules.
- **Settings sidebar strip.** `SettingsPanel.css:97` replaces the selected segment's shadow with
  an inset bottom marker in the narrow-viewport media query. It still works, but it now contradicts
  the "selected rises" physics; the app lane should drop it.
- **Mixer pan scrubber.** `ArrangementSurface.css:298` still adds a 1px `--border-strong` border
  and a pill radius to `.oj-value-scrubber__value`; harmless but no longer needed.
- `apps/docs/tsconfig.json` currently fails to resolve `astro/tsconfigs/strict`, which makes
  `ladle serve` print a `TSConfckParseError` on boot. Non-fatal (Ladle serves fine), another
  lane's file.

## UNVERIFIED

- **Nothing was tested with audio playing** — this lane is presentational only and touches no
  audio path, but the controls are consumed by node UIs, so a pass over a live rig (`bun dev`)
  is still owed by whoever integrates.
- **Not verified inside the app.** Everything visual here was verified in Ladle, not in the
  running app: the app is mid-redesign across three other lanes and its own CSS overrides
  (listed above) will change what these components look like in situ.
- **Firefox / Safari.** The harness ran one Chromium. The `-moz-range-progress` /
  `-moz-range-thumb` rules and `:focus-visible` on the range thumb are written but unexercised.
- **Touch.** `touch-action: none` is set on the Knob and the drag uses pointer events, but no
  touch device was driven.
- **`prefers-reduced-motion`** rules are written (Button dots, Slider thumb, Toggle knob) but
  were not rendered under the media query.
- **Figma Code Connect publish.** `bunx figma connect parse` was run locally and is green
  (53 `figmaNode` mappings, 0 "could not be resolved") — the same two conditions
  `code-connect.yml` gates on. The actual *publish* to Figma is owner-gated on
  `FIGMA_ACCESS_TOKEN` and was not exercised.
