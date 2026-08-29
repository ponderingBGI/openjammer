# @openjammer/oj-ui

OpenJammer's **presentational component library** — the minimal, theme-agnostic
React primitives the app composes with. This is the "infinite edges, minimal
core" boundary in practice: components here are *dumb* (props in, events out)
and carry no app state.

The visual language they speak is the **New DNA**: calm ground, loud signal;
everything has weight; sound is visible; legible always. The whole system,
with the named rules and the measured accessibility floors, is
[`DESIGN.md`](../../DESIGN.md).

## The one rule

**Components read only the semantic design-token CSS variables** (`--bg-node`,
`--text-primary`, `--accent-primary`, `--port-size`, …) defined by
[`@openjammer/oj-tokens`](../oj-tokens). They never name a literal color or a
raw pixel value, and they never import from the app's `store/`, `audio/`,
`engine/`, or `hooks/`. That is what lets one component restyle across every
theme and render identically in the app, in Ladle, and in Figma.

## The theme contract

A component may rely on exactly these five things, and nothing else:

| Contract | What it means |
|---|---|
| **Semantic colour** | `--bg-*`, `--text-*`, `--border-*`, `--accent-*`, `--*-ink`, `--audio-*` / `--control-*` / `--universal-*`, `--timeline-*`. Never a hex, never `white`. |
| **Scale** | `--space-*`, `--radius-*`, `--text-*` (micro/xs/sm/md/lg/xl/2xl), `--font-sans` / `--font-mono`. Never a bare `px` for anything a theme could want to change. |
| **Depth** | `--shadow-raised`, `--shadow-overlay`, `--shadow-inset`, `--shadow-pressed`. Four steps, per theme. No local `box-shadow` literals. |
| **Focus** | `--focus-ring`. One ring, everywhere, on `:focus-visible` only. |
| **Motion** | `--motion-fast` for colour/background/border, `--motion-spring` for `transform` only. The app's blanket `prefers-reduced-motion` rule (`src/styles/global.css`) collapses both — the only exemptions are `.oj-cable` and `.oj-meter`, which are *meters*, not decoration. |

Two components additionally publish a **live-signal custom property** that is
written straight onto the DOM from a shared animation frame, never through React
state: `--oj-cable-signal` (Cable) and `--oj-meter-signal` (Meter). A rolling
transport costs zero renders.

## Consuming it

```tsx
import { Button, Knob, Meter } from '@openjammer/oj-ui';

<Button variant="primary" onClick={play}>Play</Button>
```

Co-located CSS is imported by each component for its side effect; the bundler
(and Ladle) injects it. Resolved via the `@openjammer/oj-ui` alias in
`vite.config.ts`, `tsconfig.app.json`, and `vitest.config.ts` — raw source, no
build step (same pattern as `@openjammer/oj-protocol` / `@openjammer/oj-tokens`).

## The catalog

**44 component folders → 60 exported React components** (48 named components +
12 icons), plus 4 pure helpers (`knobNorm`, `knobValue`, `knobRotation`,
`cablePath`). Every one previews in both built-in modes, Light and Dark.

**Base primitives** — Button, IconButton, Input, Textarea, Select, Field,
Slider, Toggle, **Knob**, SegmentedControl, Tabs, ValueScrubber, ParamRow,
Swatch.

**Node & canvas** — NodeShell, NodeFrame, Port, PortRow, Cable, KeyTile,
Marquee, OffscreenPointer.

**Transport & signal** — **TransportPill**, **Meter**, TimeRuler, LaneButton,
Waveform, WaveformView, WaveformCanvas.

**Surfaces & feedback** — Surface, Modal, Menu (+ MenuItem, MenuCategory,
MenuSeparator), PanelHeader, Callout, Banner, Chip, StatusDot, Kbd, Spinner,
ProgressBar, List, ListRow, CodeBlock, DeviceSelect, EditableLabel.

**Icons** — Apple, Bolt, Check, ChevronDown, ChevronRight, Close, Download,
Linux, Mute, Speaker, Warning, Windows.

The three newest — **Knob**, **Meter** and **TransportPill** — arrived with the
New DNA. `Knob` is the standard continuous control on a faceplate (`role="slider"`
with keyboard stepping, vertical drag, linear or log taper). `Meter` is the one
honest level readout, driven per-frame by `--oj-meter-signal`. `TransportPill`
is the single floating transport shared by the canvas, the arrangement and the
piano roll — see [`docs/shell.md`](../../docs/shell.md).

## Structure

```
src/
  index.ts                       barrel (public API)
  components/<Name>/<Name>.tsx    one component per folder
  components/<Name>/<Name>.css    its semantic-var styles
  components/<Name>/<Name>.figma.tsx   Code Connect mapping
```

## Adding a component

1. Read [`DESIGN.md`](../../DESIGN.md) first — the named rules are not optional
   (no glow except live signal, no dot inside a chip, no display font in
   functional UI, one focus ring, hairline borders, soft layered shadows).
2. New folder, `.tsx` + `.css` + a Ladle story + a test, then export from
   `index.ts`.
3. Semantic vars only. If you need a value the tokens do not have, add the
   **token** first (`packages/oj-tokens`) — do not inline it here.
4. Screenshot it in Light **and** Dark, and check it under
   `prefers-reduced-motion` before you call it done.
