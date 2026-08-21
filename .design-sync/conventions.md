# OpenJammer oj-ui — how to build with it

OpenJammer's component library. The visual language is **"The Living Sketchbook"**: a
hand-drawn instrument, not a dashboard — Caveat handwriting for labels, 2px ink borders,
hard offset shadows (no blur), calm motion. Components are **theme-agnostic and prop-driven**;
the look comes entirely from CSS variables the theme defines.

## Setup — no provider, just the stylesheet

There is **no React provider or context to wrap**. Components render correctly as long as
the design's `styles.css` is loaded (it is, by default) — that stylesheet defines every
design token and `@font-face` the components read. Drop a component in and it's styled:

```jsx
<Button variant="primary">Play</Button>
```

The theme is "cream" (warm paper) by default. A theme is just a different set of values for
the same CSS variables, applied on `:root` — never a code change to components.

## Styling idiom — props for the component, CSS variables for your layout

**Do not write utility classes** — this DS has none. Style components through their **props**,
and write your own layout glue with the **semantic CSS variables** below (real names; use
`var(--…)`). Never hardcode hex/px for color, spacing, or type — always a token.

- **Color** — surfaces `--bg-canvas` `--bg-node` `--bg-node-header` `--bg-tertiary`; text
  `--text-primary` `--text-secondary` `--text-muted` `--text-on-accent`; accents
  `--accent-primary` `--accent-secondary` `--accent-success` `--accent-warning` `--accent-danger`;
  ink/borders `--sketch-black` `--border-subtle` `--border-strong`; **wiring (ports/cables)**
  `--audio-input` `--audio-output` `--audio-connected` `--control-input` `--control-output`
  `--control-connected` `--universal-port`; **timeline/arrangement** `--timeline-bg`
  `--timeline-chrome-bg` `--timeline-lane-bg` `--timeline-lane-alt-bg` `--timeline-lane-divider`
  `--timeline-clip-bg` `--timeline-clip-border` `--timeline-clip-muted-bg` `--timeline-grid-bar`
  `--timeline-grid-beat` `--timeline-grid-sub` `--timeline-playhead` `--timeline-selection`
  `--timeline-loop-range` `--timeline-section-marker` `--timeline-note-fill`
  `--timeline-waveform-fill` `--timeline-automation-line`.
- **Space** `--space-xs --space-sm --space-md --space-lg --space-xl`
- **Radius** `--radius-sm --radius-md --radius-lg --radius-xl --radius-pill`
- **Type** sizes `--text-xs … --text-2xl`; families `--font-sketch` (Caveat — titles/labels),
  `--font-sans` (Inter — UI), `--font-mono` (JetBrains Mono — exact values/shortcuts)
- **Depth** `--shadow-node` `--shadow-menu` (hard, blur 0); `--border-sketch-width` (2px)

Key prop vocabularies: `Button` `variant` = node｜primary｜secondary｜success｜danger｜ghost｜link
(+ `iconOnly`, `active`). `Port`/`PortRow` `kind` = audio｜control｜universal; optional
`resolvedKind` = audio｜control｜universal. `PortRow` forwards `resolvedKind` to `Port`, which uses
it as the color kind when `kind` is universal (+ `direction` input｜output, `connected`, `active`,
`placeholder`). `Callout` `variant` =
success｜danger｜warning｜info｜tip; `Banner` `tone` = danger｜warning｜info (they differ — Callout
has no `tone`). `Toggle` `checked`; `Slider` `value/min/max/step`. Timeline family: `LaneButton`
`tone` = default｜mute｜solo｜armed｜recording (styling lands on the pressed state, so pass
`aria-pressed`); `ParamRow` label + `valueText` + range, `control` swaps the slider out;
`TimeRuler` `marks` with `level` = bar｜beat｜sub; `WaveformCanvas` `peaks` as flat min/max pairs.
Port color *is* meaning — audio=blue, control=grey, universal shows the rainbow-until-typed
gradient until you pass `resolvedKind`, then it takes that kind's color; only pair a state color
with a label or icon.

## Where the truth lives

- **Tokens + fonts**: the `styles.css` `@import` closure (`_ds_bundle.css` carries the `:root`
  token block; the `fonts/` woff2 ship the three families). Read it before inventing values.
- **Per component**: each `<Name>.prompt.md` (usage + examples) and `<Name>.d.ts` (exact props).
  Read those before composing a component you haven't used.

## One idiomatic snippet

```jsx
// A node card — library components for the parts, semantic vars for your own layout glue.
<NodeShell
  title="Oscillator"
  nodeType="instrument"
  inputs={<Port kind="control" direction="input" connected />}
  outputs={<Port kind="audio" direction="output" connected />}
>
  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
    <Field label="Waveform"><Select defaultValue="sine"><option>sine</option><option>saw</option></Select></Field>
    <Slider aria-label="Level" min={0} max={1} step={0.01} value={0.7} onChange={() => {}} />
    <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
      <Button variant="primary">Play</Button>
      <Button variant="ghost" iconOnly aria-label="Mute"><IconMute size={16} /></Button>
    </div>
  </div>
</NodeShell>
```
