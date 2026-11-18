<!-- Design-system gap audit for the "New DNA" retheme. Read-only audit — no source file
     was modified to produce it. This is the execution map: every later increment in
     plans/redesign-new-dna/ should be traceable to a row or section here. -->

# 00 — Design Gap Audit: "Living Sketchbook" → New DNA

**Scope.** Everything that must change to retire the Living Sketchbook and land the New DNA
(handoff: `C:\Users\olimt\Downloads\design_handoff_new_dna`, source of truth `new-dna.css`).
Covers the token pipeline, the font pipeline, all 41 `oj-ui` components, all 46 app CSS files,
the app shell, the risk register, and the increment order.

**Sources audited.** `agents.md`, `DESIGN.md`, `docs/design-system-migration-plan.md`,
`packages/oj-tokens/**`, `packages/oj-ui/src/**` (41 components × css/tsx/stories/test/figma),
every `src/**/*.css` (46 files, 11 455 lines), `src/App.tsx`, `src/main.tsx`, `index.html`,
`vite.config.ts`, `src/styles/{global,fonts}.css`, `public/fonts`, `src/engine/registry.ts`,
`src/utils/portPositions.ts`, `src/components/Canvas/NodeCanvas.{tsx,css}`,
`src/components/Settings/SettingsPanel.tsx`, `src/ai/envAdapter.ts`, `scripts/oj/design.ts`,
`component-map.json`, `figma.config.json`, `docs/design-figma-handoff.md`, `.ladle/**`,
`.design-sync/config.json`, `e2e/**` (12 specs + 3 support), `.github/workflows/**`,
`eslint.config.js`.

**The covenant clause this whole plan answers.** *"Migrate fully, remove legacy paths"* — the
retheme is not a second theme beside the sketchbook. Cream / Cyberpunk / Midnight are removed;
`light` and `dark` replace them; `--font-sketch`, `--shadow-sketch`, `--shadow-node`,
`--shadow-menu`, `--border-sketch-width`, `--border-sketch`, `--border-strong`,
`--sketch-black/gray/light` are deleted from the DTCG, not aliased. No shim survives the
migration.

---

## 0. Executive summary — the ten things that actually decide this migration

1. **The node's ports are already in-body.** `NodeShell` renders `.oj-node__ports` (a flex row
   with a left input column and a right output column) *between* the header and
   `.oj-node__content` — see `packages/oj-ui/src/components/NodeShell/NodeShell.tsx:60-66` and
   `NodeShell.css:96-121`. The New DNA's "ports move INSIDE the node body as labeled rows" is
   therefore a **restyle of an existing structure**, not a re-architecture — for every node that
   uses `NodeShell`. The hard part is the ~20 bespoke schematic nodes that place
   `data-port-*` markers themselves (§3.4).
2. **Cables already render *under* nodes** (`.connections-layer { z-index: 1 }` vs
   `.nodes-layer { z-index: 10 }`, `src/components/Canvas/NodeCanvas.css:26-33,52-56`). Recessed
   in-body sockets therefore read correctly for free: the wire disappears at the card edge and
   terminates in the well. No z-order change is needed, and no "exit stub" geometry is required.
3. **`applyTheme`'s `camelToKebab` cannot produce `--shadow-1`.** It is
   `key.replace(/[A-Z]/g, m => \`-${m.toLowerCase()}\`)` (`packages/oj-tokens/src/index.ts:31-33`)
   — digits get no hyphen, so `shadow1` → `--shadow1`. Same in `build.mjs:191`. Name the new
   shadows `shadowRaised` / `shadowOverlay` (→ `--shadow-raised` / `--shadow-overlay`) rather
   than patching the transform. This is a real blocker discovered in code, not a style preference.
4. **Shadows and the focus ring must move from `primitive.json` into the theme files.** The New
   DNA's `sh1`/`sh2` are ink-tinted in light (`rgba(24,22,16,…)`) and black in dark
   (`rgba(0,0,0,.3)`), and `--ring` mixes accent at 28 % light / 35 % dark. They are no longer
   theme-invariant. `ThemeColors` (`packages/oj-tokens/src/types.ts`) grows non-color keys, or
   is renamed `ThemeValues`.
5. **Two contrast failures are in the handoff itself, in the light theme.** White on
   `--acc` `oklch(0.66 0.19 40)` is **3.36:1** — the primary button label is 14 px/600, needs
   4.5:1. And `--t3` `#8F8C82` on `--inset` is **2.80:1** — that is the color of the 9.5 px mono
   port labels. Both fail WCAG AA. Fixes with exact values in §6.4; neither requires changing the
   accent hue.
6. **`tokenLiteralGate.test.ts` forces the token swap to be a single atomic commit.** Its second
   gate (`src/components/Arrangement/__tests__/tokenLiteralGate.test.ts:23-31`) asserts every
   `var(--x)` used in `Arrangement/`, `Export/`, `Plugins/`, `Bench/` is declared in those files
   *or* in the generated `packages/oj-ui/oj-tokens.css`. Delete `--font-sketch` from the DTCG
   before rewriting those four directories and CI goes red. Good news: the gate forbids
   `#hex`/`rgb()`/`rgba()`/`hsl()` but **not** `oklch()` or `color-mix()` — the New DNA palette
   passes as authored.
7. **e2e is essentially safe.** No spec touches `.oj-port`, `.oj-port-row`, `.oj-node`,
   `.oj-btn`, `data-node-id`, `data-port-id`, `data-port-type`, or `data-testid`. The e2e
   contract is `.arrangement-*` / `.piano-roll*` / `.mixer-strip*` classes, `[data-surface-root]`,
   inline `style.left` / `style.transform` on clips and the playhead, and accessible names —
   notably `getByTitle('Play'|'Stop'|'Record'|'Open mixer')` and
   `getByRole('button', /play here in your browser/i)`. The onboarding rewrite (§5) is the one
   thing that *will* break e2e, because every journey boots through that welcome button
   (`e2e/journeys/support.ts:6`).
8. **The unit tests are the real blast radius.** ~30 `expect(el.className).toBe('oj-btn')`-style
   *exact-equality* assertions across `packages/oj-ui/src/components/*/*.test.tsx` break on an
   **added** class, not just a rename. Plus `NodeShell.test.tsx:40-42,47` pins
   `.oj-node__ports-left/-right`, and `ArrangementSurface.test.tsx:56-58` regex-pins
   `font: 600 18px/26px var(--font-sketch)` out of the raw CSS file.
9. **There is no transport on the canvas today.** The only canvas transport is a single global
   play/pause button inside the floating toolbar pill (`Toolbar.tsx:384-393`); BPM and the
   metronome live only in `Arrangement/TransportStrip.tsx`, which never renders on the canvas
   surface; and there is **no level meter anywhere in `src/`**. The handoff's floating transport
   pill (play/stop + drag-scrub BPM + live meter) is net-new UI wired to
   `useTransportStore` + `arrangement.tempoBpm` + a new RMS source.
10. **`index.html` hardcodes the cream palette** as `--oj-boot-*` literals (`index.html:9-16`:
    `#f5f0e8`, `#ede8e0`, `#1a1a1a`, `#4a4a4a`, `#ffffff`, `#c68b3f`) and sets
    `font-family: Inter` on `body`. The pre-React boot shell must be re-authored, and it must
    respect the saved light/dark choice or the app flashes the wrong ground on every cold start.

---

## 1. Token migration map

### 1.1 The naming decision (do this first — everything else depends on it)

`new-dna.css` uses short prototype names (`--canvas`, `--t1`, `--acc`, `--sh1`). **Do not adopt
them.** The repo's semantic vocabulary (`--bg-canvas`, `--text-primary`, `--accent-primary`, …)
is referenced by 46 app CSS files, 38 oj-ui CSS files, `.ladle/components.tsx`, and the
`tokenLiteralGate` declared-variable gate. Introducing `--t1` alongside `--text-primary` would
be a *parallel path* — exactly what code value #2 ("extend these; never fork a parallel version")
forbids.

**Rule: keep the existing CSS custom-property names; change only their values, plus add the small
set of genuinely new roles.** `new-dna.css` is then read as "what value each existing role takes",
and the `nj-*` rules are read as "what each component's CSS should become", translated into the
`oj-*` class structure. This is also what the handoff README asks for verbatim ("translated into
the library's existing class structure (`.oj-btn`, `.oj-node`, …)").

### 1.2 Semantic color tokens — `tokens/themes/cream.json` (51 keys) → light / dark

`RETIRE` means the DTCG key is deleted and every `var()` consumer rewritten in the same commit.

| # | Current key (→ CSS var) | Cream value | New DNA role | **light** | **dark** | Verdict |
|---|---|---|---|---|---|---|
| 1 | `bgPrimary` → `--bg-primary` | `#F5F0E8` | canvas | `#F4F3F0` | `#161510` | RETHEME (alias of canvas — see note) |
| 2 | `bgCanvas` → `--bg-canvas` | `#F5F0E8` | `--canvas` | `#F4F3F0` | `#161510` | RETHEME |
| 3 | `bgNode` → `--bg-node` | `#FFFFFF` | `--surface` | `#FFFFFF` | `#201F19` | RETHEME |
| 4 | `bgNodeHeader` → `--bg-node-header` | `#EDE8E0` | `--header` | `#FAF9F6` | `#242219` | RETHEME |
| 5 | `bgTertiary` → `--bg-tertiary` | `#E8E3DA` | `--inset` | `#ECEAE4` | `#2A2822` | RETHEME (becomes *the* inset role — buttons, chips, keycaps, sockets) |
| 6 | `bgSecondary` → `--bg-secondary` | `#EDE8DF` | panel ground | `#FAF9F6` (= header) | `#242219` | RETHEME |
| 7 | `bgCanvasAlt` → `--bg-canvas-alt` | `#EDE8E0` | alt canvas shade | `#ECEAE4` (= inset) | `#2A2822` | **RETIRE** → fold into `--bg-tertiary`; 1 consumer (`Button.css` secondary hover) |
| 8 | `textPrimary` → `--text-primary` | `#1A1A1A` | `--t1` | `#1D1C18` | `#F1EFE8` | RETHEME |
| 9 | `textSecondary` → `--text-secondary` | `#4A4A4A` | `--t2` | `#5A5850` | `#ABA89C` | RETHEME |
| 10 | `textMuted` → `--text-muted` | `#8A8A8A` | `--t3` | `#6C695F` ⚠︎ (handoff says `#8F8C82`) | `#928E83` ⚠︎ (handoff says `#767267`) | RETHEME **+ a11y correction, §6.4** |
| 11 | `textOnAccent` → `--text-on-accent` | `#FFFFFF` | `--on-acc` | `#1D1C18` ⚠︎ (handoff says `#FFF`) | `#1D1C18` | RETHEME **+ a11y correction, §6.4** |
| 12 | `borderSubtle` → `--border-subtle` | `#D4CFC6` | `--line` | `#E3E1DA` | `#33312A` | RETHEME |
| 13 | `borderStrong` → `--border-strong` | `#1A1A1A` | `--line2` | `#C8C5BB` | `#4B473D` | RETHEME (semantics flip: was "ink", becomes "strong hairline") |
| 14 | `borderSketch` → `--border-sketch` | `#1A1A1A` | — | — | — | **RETIRE** → `--border-subtle`. 2 consumers: `global.css:349` (Sonner), `WaveformView.css` |
| 15 | `sketchBlack` → `--sketch-black` | `#1A1A1A` | — | — | — | **RETIRE** → `--border-strong` when a boundary, `--text-primary` when ink. 25 hits in `SchematicNodes.css`, 35 in `CommandBar.css`, 23 in `ArrangementSurface.css` |
| 16 | `sketchGray` → `--sketch-gray` | `#4A4A4A` | — | — | — | **RETIRE** → `--text-secondary` |
| 17 | `sketchLight` → `--sketch-light` | `#8A8A8A` | — | — | — | **RETIRE** → `--text-muted` (text) / `--border-strong` (rules) |
| 18 | `accentPrimary` → `--accent-primary` | `#1A1A1A` | `--acc` | `oklch(0.66 0.19 40)` | `oklch(0.72 0.19 40)` | RETHEME (**biggest semantic shift: accent stops being ink and becomes orange**) |
| 19 | `accentSecondary` → `--accent-secondary` | `#6B5B4F` | `--acc-hi` (hover) | `oklch(0.6 0.19 40)` | `oklch(0.78 0.19 40)` | RETHEME → rename to `accentHover` in a follow-up; keep the key for this migration |
| 20 | `accentSuccess` → `--accent-success` | `#4A7C59` | `--ok` | `oklch(0.64 0.17 150)` | `oklch(0.7 0.17 150)` | RETHEME |
| 21 | `accentWarning` → `--accent-warning` | `#C68B3F` | `--warn` | `oklch(0.72 0.15 80)` | `oklch(0.78 0.15 80)` | RETHEME |
| 22 | `accentDanger` → `--accent-danger` | `#A65353` | `--bad` | `oklch(0.58 0.21 25)` | `oklch(0.66 0.21 25)` | RETHEME |
| 23 | `audioInput` → `--audio-input` | `#7EB3D8` | — | — | — | **RETIRE**. New DNA sockets are not direction-shaded: idle core = `--border-strong`, live core = `--audio-connection`. Kills `.oj-port--audio-input/-output` |
| 24 | `audioOutput` → `--audio-output` | `#2C5F88` | — | — | — | **RETIRE** (same). 1 extra consumer: `Waveform.css` trace → `--audio-connection` |
| 25 | `audioConnection` → `--audio-connection` | `#4A90C2` | `--audio` (teal) | `oklch(0.6 0.12 200)` | `oklch(0.7 0.12 200)` | RETHEME — **blue → teal** |
| 26 | `audioConnected` → `--audio-connected` | `#5B9FD4` | live audio | `oklch(0.6 0.12 200)` | `oklch(0.7 0.12 200)` | RETHEME (collapse to the same value; keep the key, `NodeShell.is-agent-pending` + `Cable.is-selected` use it) |
| 27 | `controlInput` → `--control-input` | `#606060` | — | — | — | **RETIRE** → `--control-connection` |
| 28 | `controlOutput` → `--control-output` | `#A0A0A0` | — | — | — | **RETIRE** → `--control-connection` |
| 29 | `controlConnection` → `--control-connection` | `#808080` | `--ctl` | `#8F8C82` | `#767267` | RETHEME |
| 30 | `controlConnected` → `--control-connected` | `#909090` | live control | `#8F8C82` | `#767267` | RETHEME (collapse) |
| 31 | `universalPort` → `--universal-port` | `#9B59B6` | `--acc2` | `oklch(0.66 0.19 300)` | `oklch(0.72 0.19 300)` | RETHEME — the rainbow gradient in `Port.css:56-63` is **RETIRED**; a universal socket is a flat `--acc2` core |
| 32 | `universalConnection` → `--universal-connection` | `#9B59B6` | `--acc2` | `oklch(0.66 0.19 300)` | `oklch(0.72 0.19 300)` | RETHEME |
| 33 | `timelineBg` | `#F5F0E8` | canvas | `#F4F3F0` | `#161510` | RETHEME |
| 34 | `timelineChromeBg` | `#EDE8E0` | header | `#FAF9F6` | `#242219` | RETHEME |
| 35 | `timelineLaneBg` | `#FAF7F1` | surface | `#FFFFFF` | `#201F19` | RETHEME |
| 36 | `timelineLaneAltBg` | `#EFEAE1` | canvas | `#F4F3F0` | `#1B1A15` | RETHEME |
| 37 | `timelineGridBar` | `rgba(26,26,26,0.24)` | line-on-lane | `color-mix(in oklab, #1D1C18 24%, transparent)` | `color-mix(in oklab, #F1EFE8 22%, transparent)` | RETHEME (must clear the 1.5:1 gate, §6.3) |
| 38 | `timelineGridBeat` | `rgba(26,26,26,0.11)` | ″ | `… 11%` | `… 10%` | RETHEME |
| 39 | `timelineGridSub` | `rgba(26,26,26,0.055)` | ″ | `… 5.5%` | `… 5%` | RETHEME |
| 40 | `timelineLaneDivider` | `#D4CFC6` | `--line` | `#E3E1DA` | `#33312A` | RETHEME |
| 41 | `timelineClipBg` | `#FFFFFF` | surface | `#FFFFFF` | `#201F19` | RETHEME |
| 42 | `timelineClipBorder` | `#4A4A4A` | `--line2` | `#C8C5BB` ⚠︎ | `#4B473D` ⚠︎ | RETHEME — **breaks `contrast.test.ts` 3:1 floor, §6.3** |
| 43 | `timelineClipMutedBg` | `#E8E3DA` | inset | `#ECEAE4` | `#2A2822` | RETHEME |
| 44 | `timelineNoteFill` | `#4A90C2` | audio teal | `oklch(0.6 0.12 200)` | `oklch(0.7 0.12 200)` | RETHEME (clears 3:1 on white: 3.65) |
| 45 | `timelineWaveformFill` | `#2C5F88` | audio teal, darker | `oklch(0.5 0.12 200)` | `oklch(0.62 0.12 200)` | RETHEME |
| 46 | `timelineAutomationLine` | `#6B5B4F` | `--acc2` | `oklch(0.66 0.19 300)` | `oklch(0.72 0.19 300)` | RETHEME |
| 47 | `timelinePlayhead` | `#A65353` | `--acc` | `oklch(0.6 0.19 40)` | `oklch(0.72 0.19 40)` | RETHEME (needs 3:1 vs lane **and** vs clip — use the `acc-hi` L in light) |
| 48 | `timelineSectionMarker` | `#1A1A1A` | `--t1` | `#1D1C18` | `#F1EFE8` | RETHEME |
| 49 | `timelineLoopRange` | `rgba(26,26,26,0.07)` | tint | `color-mix(in oklab, var(--accent-primary) 7%, transparent)` | ″ | RETHEME |
| 50 | `timelineSelection` | `#C68B3F` | `--acc` | `oklch(0.66 0.19 40)` | `oklch(0.72 0.19 40)` | RETHEME (2.9:1 floor still met at 3.03) |

Notes on the retirements above:
- `bgPrimary` and `bgCanvas` are the same value today and always have been. Keep both keys for
  this migration (they have separate consumers: `NodeCanvas.css:6` uses `--bg-primary`) but file
  a follow-up to collapse them — that is a `every production line is used` item, not a retheme item.
- Retiring the four directional port colors (23/24/27/28) is what makes the socket redesign
  clean: a socket well is *one* recessed shape whose core dot is either idle (`--border-strong`)
  or live (wiring color). Direction is communicated by which side of the row it sits on, which
  is exactly what `.nj-piorow` does.

### 1.3 Primitive tokens — `tokens/primitive.json`

| Group.key → CSS var | Current | New DNA | Verdict |
|---|---|---|---|
| `space.xs/sm/md/lg/xl` | 4/8/16/24/32 px | unchanged | KEEP |
| `radius.sm` → `--radius-sm` | 6px | 6px | KEEP |
| `radius.md` → `--radius-md` | 10px | 10px | KEEP |
| `radius.lg` → `--radius-lg` | 14px | 14px (node card) | KEEP |
| `radius.xl` → `--radius-xl` | 20px | 20px | KEEP |
| `radius.pill` → `--radius-pill` | 50px | **99px** | RETHEME (`nj-*` uses `99px` throughout) |
| `text.xs` → `--text-xs` | 14px | **11px** | RETHEME — the whole scale shrinks because Outfit reads at a normal size (Caveat needed the +4px bump) |
| `text.sm` → `--text-sm` | 16px | **13px** | RETHEME (body/controls) |
| `text.md` → `--text-md` | 18px | **14px** | RETHEME (default UI voice) |
| `text.lg` → `--text-lg` | 22px | **15px** | RETHEME (node titles) |
| `text.xl` → `--text-xl` | 28px | **22px** | RETHEME (headings) |
| `text.2xl` → `--text-2xl` | 36px | **30px** | RETHEME (onboarding question) |
| — | — | `--text-micro: 9.5px` | **NEW** — mono micro-labels (port labels, step-grid row names) |
| `font.sketch` → `--font-sketch` | `'Caveat', 'Comic Sans MS', cursive` | — | **RETIRE** (147 occurrences, §2.3) |
| `font.sans` → `--font-sans` | `'Inter', …` | `'Outfit', system-ui, sans-serif` | **RETHEME the value, keep the key** — this is the cheapest correct move: every `--font-sans` consumer (67) already means "the functional UI face", and every `--font-sketch` consumer is rewritten to `--font-sans` |
| `font.mono` → `--font-mono` | `'JetBrains Mono', 'Fira Code', monospace` | unchanged | KEEP |
| `node.min-width` → `--node-min-width` | 180px | 190px (`app-styles.css` `.node .nj-node{min-width:190px}`) | RETHEME |
| `node.header-height` | 40px | ~40px (10px pad + 15px title) | KEEP — **0 consumers found; candidate for deletion under "every production line is used"** |
| `port.size` → `--port-size` | 16px | **18px** (socket well) | RETHEME |
| `port.spacing` → `--port-spacing` | 28px | row gap → `--space-sm` | **RETIRE** — 0 CSS consumers |
| `transition.fast` → `--transition-fast` | `0.15s ease` | `120ms cubic-bezier(.2,.8,.3,1)` | RETHEME (colour/bg/border) |
| `transition.normal` → `--transition-normal` | `0.25s ease` | `260ms cubic-bezier(.34,1.56,.64,1)` | RETHEME → **but see `--motion-spring` below**; keep `--transition-normal` as a non-spring 250 ms ease for opacity/height |
| `transition.slow` → `--transition-slow` | `0.4s ease` | unchanged | KEEP (Spinner only) |
| `shadow.node` → `--shadow-node` | `2px 3px 0 rgba(0,0,0,.1)` | — | **RETIRE** → `--shadow-raised` |
| `shadow.menu` → `--shadow-menu` | `3px 4px 0 rgba(0,0,0,.15)` | — | **RETIRE** → `--shadow-overlay` |
| `shadow.sketch` → `--shadow-sketch` | `2px 2px 0 var(--sketch-black)` | — | **RETIRE** → `--shadow-raised` |
| `border.sketch-width` → `--border-sketch-width` | 2px | — | **RETIRE** → literal `1px` (hairline) / `1.5px` (interactive outline). Do **not** create `--border-hairline`: a 1px border is not a token-worthy decision and 38 oj-ui files would just re-indirect it |
| `overlay.scrim` → `--overlay-scrim` | `rgba(0,0,0,0.45)` | onboarding/modal scrim | RETHEME → per-theme: light `color-mix(in oklab, var(--bg-canvas) 45%, transparent)`, dark `color-mix(in oklab, #000 55%, transparent)`. **Moves into the theme files** |
| `z.node/panel/popover/modal/toast/top` | 10/100/1000/2000/3000/10000 | unchanged | KEEP |

### 1.4 New tokens required

Theme-invariant → `primitive.json`:

| Token | Value | Why |
|---|---|---|
| `--motion-fast` | `120ms cubic-bezier(.2,.8,.3,1)` | New name for the colour/bg/border curve. Keep `--transition-fast` as an alias for one increment only if the mechanical swap can't be atomic — **preferred: rename in place, no alias** |
| `--motion-spring` | `260ms cubic-bezier(.34,1.56,.64,1)` | transform-only. "One spring curve everywhere" |
| `--press-scale-btn` | `0.96` | buttons |
| `--press-scale-pad` | `0.94` | pads / keys |
| `--hover-lift` | `-2px` | pads / keys / option cards |
| `--text-micro` | `9.5px` | mono micro-labels |
| `--tracking-micro` | `0.08em` | uppercase mono labels (spec range .07–.12em) |
| `--knob-size` | `52px` | new Knob component |
| `--key-tile-size` | `48px` | KeyTile / pad |

Per-theme → `tokens/themes/{light,dark}.json` (these are the ones that force `ThemeColors` to
grow beyond colors):

| Token key (camel) | → CSS var | light | dark |
|---|---|---|---|
| `shadowRaised` | `--shadow-raised` | `0 1px 2px rgba(24,22,16,.05), 0 2px 6px rgba(24,22,16,.06)` | `0 1px 2px rgba(0,0,0,.3), 0 2px 8px rgba(0,0,0,.25)` |
| `shadowOverlay` | `--shadow-overlay` | `0 2px 6px rgba(24,22,16,.07), 0 12px 28px rgba(24,22,16,.11)` | `0 4px 10px rgba(0,0,0,.35), 0 14px 32px rgba(0,0,0,.4)` |
| `shadowInset` | `--shadow-inset` | `inset 0 1px 3px rgba(0,0,0,.22)` | `inset 0 1px 3px rgba(0,0,0,.45)` |
| `shadowPressed` | `--shadow-pressed` | `inset 0 2px 6px rgba(0,0,0,.28)` | `inset 0 2px 6px rgba(0,0,0,.5)` |
| `focusRing` | `--focus-ring` | `0 0 0 3px color-mix(in oklab, var(--accent-primary) 28%, transparent)` | `… 35% …` |
| `accentInk` | `--accent-ink` | `oklch(0.54 0.19 40)` | `oklch(0.72 0.19 40)` | 
| `successInk` | `--success-ink` | `oklch(0.49 0.17 150)` | `oklch(0.7 0.17 150)` |
| `warningInk` | `--warning-ink` | `oklch(0.52 0.15 80)` | `oklch(0.78 0.15 80)` |
| `dangerInk` | `--danger-ink` | `oklch(0.54 0.21 25)` | `oklch(0.66 0.21 25)` |
| `audioInk` | `--audio-ink` | `oklch(0.49 0.12 200)` | `oklch(0.7 0.12 200)` |
| `overlayScrim` | `--overlay-scrim` | `color-mix(in oklab, #F4F3F0 45%, transparent)` | `color-mix(in oklab, #161510 55%, transparent)` |

The `*Ink` pair is the a11y device (§6.4): the saturated token is the **fill/graphic** color, the
`-ink` token is the same hue at a lightness that clears 4.5:1 as **text on a neutral surface**.
Chips tint their text with `-ink`; a filled button paints with the plain token. Two tokens, one
hue, no drift — and it is the only way to keep the designer's exact accent while passing AA.
Dark theme needs no split (all four already clear 4.5:1 on all four surfaces), so the `-ink`
values equal the base values there — deliberate, so component CSS has a single code path.

### 1.5 Theme files: retire cream / cyberpunk / midnight, ship light / dark

**Recommendation: delete all three, add `light` and `dark`.** Justification against the covenant:

- *Migrate fully, remove legacy paths.* Cream **is** the Living Sketchbook — its `accentPrimary`
  is ink `#1A1A1A`, its `borderStrong` is ink, its `sketchBlack` is ink. Keeping it as a
  "classic" option keeps a second design language alive inside the token system, and every
  component's CSS would have to remain compatible with both a 2px-ink and a 1px-hairline world.
  That is the parallel path the covenant forbids.
- *Every production line is used.* Cyberpunk and Midnight are re-mappings of a role vocabulary
  that is being rewritten (directional port colors, sketch colors, ink accent). Porting them is
  work with no user asking for it; the handoff's own first-run flow offers exactly two choices.
- *A minimal core made infinite by everyone.* Themes are community territory. Ship the two the
  product needs; the DTCG + `applyTheme` contract is unchanged, so a Cyberpunk revival is a
  community JSON file, not a core concern.

Concrete file changes:
- `packages/oj-tokens/tokens/themes/cream.json` → **delete**; add `light.json`.
- `.../cyberpunk.json`, `.../midnight.json` → **delete**; add `dark.json`.
- `tokens/$metadata.json` `tokenSetOrder` → `["primitive", "themes/light", "themes/dark"]`.
- `tokens/$themes.json` → replace the `cream`/`cyberpunk`/`midnight` entries with `light`/`dark`
  (each `primitive: "source"` + own set `enabled`). Note this file also drives the Figma Tokens
  Studio sync and `docs/design-figma-handoff.md` states **3 theme modes named Cream / Cyberpunk /
  Midnight** — that doc must be updated in the same PR (§6.5).
- `build.mjs:31-35` `THEMES` → `[{id:'light',name:'Light'},{id:'dark',name:'Dark'}]`.
- `build.mjs:186-199` — the "design-sync static snapshot" block emits `themeColors.cream` into
  `packages/oj-ui/oj-tokens.css`. Change to `themeColors.light`. **This is the file
  `tokenLiteralGate` reads for its declared-variable corpus**, so it must contain every new token
  name before the app CSS references it → `bun run tokens` must run *inside* the atomic commit.

### 1.6 `applyTheme` / `getSavedThemeId` / `types.ts` changes

`packages/oj-tokens/src/index.ts`:
- L25 `const DEFAULT_THEME_ID = 'cream'` → **`'light'`**.
- L48-59 `getSavedThemeId()` — a user with `localStorage['openjammer-theme'] === 'cream'` falls
  back to the default because of the `themes.some(...)` guard, so no migration shim is needed.
  **Add nothing.** (Verified: the guard already makes stale ids safe.)
- L37-42 `applyTheme` — works unchanged for the new non-color keys **provided** no key contains a
  digit (see §0.3). Values containing `var(--accent-primary)` (the focus ring, the loop-range
  tint) are fine: custom properties substitute at use time, and `document.documentElement` is
  where both the referenced and referencing property live.
- `packages/oj-tokens/src/types.ts` — `ThemeColors` grows the 11 keys from §1.4 and loses the 9
  retired keys. Rename the interface to `ThemeValues` and keep `Theme.colors` as the field name
  (that field name is what `applyTheme` iterates and what `SettingsPanel.tsx:78-88` reads for its
  swatch preview) — renaming the field would ripple into `SettingsPanel` and `envAdapter` for no
  gain.

`src/main.tsx:30-31` and `src/App.tsx:164-168` **both** apply the saved theme on boot. That is a
duplicate path; delete the `App.tsx` effect during this migration (`main.tsx` runs before first
paint, which is the one that matters).

`src/ai/envAdapter.ts:187, 248-265` — `themeId` in/out of the agent's settings tools works
unchanged; only the doc comment in `src/ai/types.ts:347` (`'cream' | 'cyberpunk' | 'midnight'`)
needs updating, and `src/ai/__tests__/envTools.test.ts:89,100,167` must move to `'light'`.

### 1.7 Generated artifacts + drift guards

Regenerated by `bun run tokens` (root script → `packages/oj-tokens/build.mjs`):
1. `packages/oj-tokens/dist/variables.css` — primitives on `:root`.
2. `packages/oj-tokens/src/generated/themes.ts` — the typed registry.
3. `packages/oj-ui/oj-tokens.css` — primitives **+ the default theme's semantic block**, used by
   design-sync preview cards *and* by `tokenLiteralGate`'s declared-variable corpus.

Guards:
- `.github/workflows/tokens.yml` — runs `bun run tokens` on any `packages/oj-tokens/**` change and
  **auto-commits** the rebuild on same-repo PRs (`--signoff`, `[skip ci]`), **hard-fails on fork
  PRs**. Note the `[skip ci]`: the pushed rebuild does not re-trigger the other jobs, so a retheme
  PR can land token artifacts the test job never saw. **Mitigation: always run `bun run tokens`
  locally and commit it in the same commit as the DTCG edit.**
- `.github/workflows/figma-tokens-sync.yml` — a true `git diff --quiet` guard, but only fires on
  `figma/tokens` / `figma-sync/**` pushes (dormant without Tokens Studio Pro).
- `scripts/oj/design.ts` `cmdStatus` runs the same rebuild + `git diff --quiet` locally; expect
  `oj design status` to report DRIFT until the rebuild is committed.
- **Not guarded anywhere:** `ladle build`, `gen:component-map`, stylelint (not installed), a11y,
  visual regression. There is no screenshot baseline to update.

---

## 2. Font pipeline

### 2.1 `src/styles/fonts.css` (81 lines, 8 `@font-face` blocks)

Delete blocks:
- `Caveat` 400 (L9-16), `Caveat` 700 (L18-25)
- `Inter` 400 (L28-35), 500 (L37-44), 600 (L46-53), 700 (L55-62)

Add blocks (same shape: `font-style: normal`, `font-display: swap`, latin `unicode-range`
identical to the existing ones — that subset already covers the app's copy):
- `Outfit` 400 → `/fonts/outfit-regular.woff2`
- `Outfit` 500 → `/fonts/outfit-medium.woff2`
- `Outfit` 600 → `/fonts/outfit-semibold.woff2`
- `Outfit` 700 → `/fonts/outfit-bold.woff2`

Keep unchanged: `JetBrains Mono` 400 (L65-72), 500 (L74-81).

`font-display` considerations:
- Keep `swap`. The app is a fixed-chrome instrument, not a text document; FOUT on the topbar is
  preferable to invisible controls. But **Outfit is now the body face on `body` (`global.css:107`)**,
  where Caveat's fallback (`Comic Sans MS`) used to be wildly different in metrics. Choose a
  metric-adjacent fallback stack — `'Outfit', system-ui, 'Segoe UI', -apple-system, sans-serif` —
  and add `size-adjust` only if the swap shift is visible on Windows (`Segoe UI` runs slightly
  wider than Outfit at 14px). Measure before adding; do not add speculatively.
- All four Outfit faces are needed *above the fold* (400 body, 500 controls, 600 titles/labels,
  700 brand + onboarding H1), so all four should be `<link rel="preload">`ed from `index.html`
  alongside the boot shell, or the first paint renders in the fallback and reflows. Today nothing
  is preloaded.

### 2.2 `public/fonts`

| Action | File | Bytes |
|---|---|---|
| DELETE | `caveat-bold.woff2` | 51 020 |
| DELETE | `caveat-regular.woff2` | 48 836 |
| DELETE | `inter-bold.woff2` | 24 412 |
| DELETE | `inter-medium.woff2` | 24 352 |
| DELETE | `inter-regular.woff2` | 23 812 |
| DELETE | `inter-semibold.woff2` | 24 460 |
| KEEP | `jetbrains-mono-medium.woff2` | 21 832 |
| KEEP | `jetbrains-mono-regular.woff2` | 21 168 |
| ADD | `outfit-regular.woff2` / `-medium` / `-semibold` / `-bold` | ~20 KB each (latin subset) |

Net: −197 KB of precached font payload, +~80 KB → **~117 KB smaller offline bundle**. Self-hosted
is non-negotiable here (offline stage + no third-party requests); subset to the same latin
`unicode-range` the existing faces use.

### 2.3 Consumers to rewrite (grep counts, whole repo)

`--font-sketch`: **147 occurrences across 62 files.** Top consumers:

| File | count | | File | count |
|---|---:|---|---|---:|
| `src/components/Nodes/SchematicNodes.css` | 22 | | `src/components/Nodes/BaseNode.css` | 4 |
| `src/components/CommandBar/CommandBar.css` | 11 | | `src/components/Settings/AudioSettingsPanel.css` | 3 |
| `src/components/Settings/KeybindingsPanel.css` | 10 | | `src/components/Plugins/PluginsPanel.css` | 3 |
| `src/components/Arrangement/ArrangementSurface.css` | 9 | | `src/components/Nodes/MIDIVisualNode.css` | 3 |
| `src/styles/global.css` | 5 | | `src/components/Clips/WaveformEditorModal.css` | 3 |
| `src/components/PianoRoll/PianoRoll.css` | 4 | | 2× each: `AutoParamPanel`, `Toolbar`, `DropdownMenu`, `UpdatesPanel`, `MIDINode`, `MIDIConnectionToast`, `Guide`, `ClipDragLayer`, `AppErrorBoundary` |

Plus **17 oj-ui component CSS files** (1–2 each: `Banner`, `Button`, `Callout`, `Chip`,
`EditableLabel`, `Field`, `KeyTile`, `ListRow`, `Menu`, `NodeShell`, `OffscreenPointer`,
`PanelHeader`, `PortRow`, `SegmentedControl`, `Select`, `Swatch`, `Toggle`, `ValueScrubber`,
`WaveformView`), 2 in `.ladle/components.tsx` (eslint-ignored, untested), 1 in
`src/components/Nodes/MultiplierNode.tsx` (inline style), 1 in
`src/components/Arrangement/__tests__/ArrangementSurface.test.tsx:57` (a **regex assertion**), and
1 each in the two generated files (`dist/variables.css`, `oj-ui/oj-tokens.css`).

`--font-sans`: **67 occurrences across 23 files** — top: `CommandBar.css` 14,
`ArrangementSurface.css` 13, `global.css` 5, `PluginsPanel.css` 5, `PluginWindowShell.css` 4,
`ExportDialog.css` 4, `PianoRoll.css` 3. These need **no edit** if `font.sans`'s *value* changes
to Outfit (§1.3) — that is the single highest-leverage decision in the font migration.

`--font-mono`: 91 occurrences — **untouched**.

Also hardcoded and needing edits outside `src/`:
- `index.html:30` — `font-family: Inter, …` on the boot shell `body`.
- `.design-sync/config.json` `extraFonts` — explicitly lists `caveat-regular.woff2`,
  `caveat-bold.woff2` + 4 Inter weights.
- `apps/docs/src/fonts.css:7-8`, `apps/docs/src/styles/custom.css:74-76`,
  `apps/docs/src/components/Hero.astro:36`, `apps/docs/astro.config.mjs:28` — the docs site.
- `.impeccable/design.json` — embeds `'Caveat', cursive` and the Caveat-Is-the-Voice rule as data.
- `DESIGN.md` lines 24, 30, 36, 105, 137, 193, 200, 205, 207.

### 2.4 Vite PWA precache

`vite.config.ts:198` already globs `**/*.{js,css,html,ico,png,svg,woff2,wasm}` — **new Outfit
files are precached automatically and removed Caveat/Inter files drop out automatically. No glob
change needed.**

Two cleanups worth doing while here (code value #8, "every production line is used"):
- `vite.config.ts:225-247` — `runtimeCaching` entries for `fonts.googleapis.com` and
  `fonts.gstatic.com`. The app self-hosts every face; these rules can never match. **Delete.**
- `vite.config.ts:165` `includeAssets` — unchanged.

---

## 3. `oj-ui` component-by-component spec (41 components)

Legend for **Verdict**: **RESTYLE** = CSS-only token/shape swap · **RESHAPE** = CSS + markup or
class changes · **API** = prop surface changes · **NEW** = does not exist yet.

### 3.1 The 41, in one table

| # | Component | Current CSS (gist) | New DNA target (`new-dna.css` rule) | API change | DOM contract that must NOT break | Verdict |
|---|---|---|---|---|---|---|
| 1 | **Banner** | `--font-sketch` title + `--font-sans` message, composes `Surface elevation="menu"` (hard shadow), left accent stripe via `--banner-accent` | `.nj-callout` — surface card, 1 px `--line`, 12 px radius, `--shadow-raised`; **no left bar**; variant tints the *title* only, body stays `--text-secondary` | none | `.oj-banner`, `__icon/__body/__title/__message/__actions`; `Banner.test.tsx:17-18` asserts `oj-surface oj-surface--elevation-menu` | RESHAPE |
| 2 | **Button** | 2 px `--sketch-black` border, `--radius-md`, `--font-sketch` `--text-sm`, `--bg-node` fill, hover `translateY(-1px)`, active `translateY(1px)`; variants primary/secondary/success/danger/ghost/link/icon-only | `.nj-btn` — **flat inset, no border, no shadow**: `background:var(--bg-tertiary)`, `padding:9px 16px`, `--radius-md`, `600 14px Outfit`; hover `color-mix(in oklab, var(--text-primary) 8%, var(--bg-tertiary))`; active `scale(.96)` w/ `--motion-spring`; focus `--focus-ring`. Primary = accent fill + `--text-on-accent`, hover `--accent-secondary`. Danger = `color-mix(--accent-danger 10%, inset)` bg + `--danger-ink` text (18 % on hover) — **not** a solid red fill. Ghost = transparent → inset. Icon-only 34×34 | `variant`: drop `'success'` (unused as a *fill* in the new language — map to `is-active` accent), keep the rest | `.oj-btn`, `.oj-btn--*`, `.is-active`; **`Button.test.tsx:9` uses `toBe('oj-btn')`** — adding a class breaks it | RESTYLE + API |
| 3 | **Cable** | `--oj-cable-signal` drives `stroke-width: calc(3px + sig*3px)`, `opacity: calc(.7 + sig*.3)`, `drop-shadow(0 0 calc(sig*6px))`; selected pulses; bundled heavier; temp dashed | `.nj-cable` / `app-styles.css .wire` — **teal** via `--audio-connection`; `stroke-width: calc(2.5px + sig*2.5px)`; `opacity: calc(.5 + sig*.5)`; `filter: drop-shadow(0 0 calc(sig*7px) currentColor)`; **idle = 2.5px / 45 % / no filter** (a `.is-quiet` state, or just sig=0 which the formula already gives). Selected: keep the brighten, **drop the infinite glow animation** (violates "nothing else glows, ever" once the signal is silent) | add `quiet?: boolean` **or** rely on `signalLevel === 0`; prefer the latter — no new prop | `.oj-cable`, `.oj-cable--audio/-control/-universal`, `.is-selected/.is-bundled/.is-temp`, the `--oj-cable-signal` custom property name, the `<g className="oj-cable-group">` wrapper. `NodeCanvas.css:104-120` ghost-mode overrides select `.oj-cable*` | RESTYLE |
| 4 | **Callout** | 2 px ink border, left accent bar via `--callout-accent`, `--font-sketch` title | `.nj-callout` — 1 px `--line`, 12 px radius, `--shadow-raised`, **no left bar**, variant tints title with the `*-ink` token | none | `.oj-callout`, `--info/--success/--warning/--danger/--tip`, `__icon/__body/__title/__content`. `Callout.test.tsx:9` `toBe` | RESHAPE |
| 5 | **Chip** | pill, 2 px `--border-strong`, `--font-sketch`, tone variants recolor bg + a `__glyph` dot | `.nj-chip` — pill, `--bg-tertiary`, 1 px `--line`, `600 12px Outfit`, **tones tint the TEXT only** (`--success-ink`/`--warning-ink`/`--danger-ink`), **no dot inside a chip** | `glyph` prop → deprecate/remove (the `__glyph` slot is the dot the spec bans) | `.oj-chip`, `--success/--warning/--danger`, `.is-pressed`, `__label`, `__count`. `Chip.test.tsx:9` `toBe` | RESHAPE + API |
| 6 | **CodeBlock** | `--bg-tertiary`, 2 px border, mono `--text-xs` | inset panel, 1 px `--line`, `--radius-sm`, mono 11–12 px | none | `.oj-code`, `.is-unselectable` | RESTYLE |
| 7 | **DeviceSelect** | custom trigger + list, `--accent-primary` selection, bolt glyph for low-latency | `.nj-input` trigger (surface, 1 px `--line2`, 10 px radius) + `.nj-menu` list | none | `.oj-device-select__trigger/__list/__option/__caret/__*-bolt` | RESTYLE |
| 8 | **EditableLabel** | `--font-sketch` display text, `--bg-tertiary` input, 2 px border | Outfit 500; input = `.nj-input` | none | `.oj-editable-label__text/__input`, `--center`, `.is-placeholder` | RESTYLE |
| 9 | **Field** | `--font-sketch` label, `--text-sm`, `--text-muted` | `.nj-field` — label `600 12px Outfit` uppercase `--text-secondary`, `letter-spacing .02em`, 6 px gap | none | `.oj-field`, `--row`, `__label` | RESTYLE |
| 10 | **IconButton** | 8-line CSS, delegates to `Button` | `.nj-btn.nj-icon` — 34×34, `padding:9px` | none | `.oj-icon-btn` | RESTYLE |
| 11 | **Icons** | 13-line CSS, `currentColor` SVGs | unchanged shape; recolored by tokens ("Icons remain the existing oj-ui icon set, recolored") | none | `.oj-icon` | KEEP |
| 12 | **Input** | `--bg-canvas` fill, 2 px `--sketch-black`, `--radius-sm`, `--font-mono`, focus = accent border | `.nj-input` — `--bg-node` (surface) fill, 1 px `--line2`, `--radius-md`, `500 14px Outfit`, `padding:9px 12px`, focus = accent border **+ `--focus-ring`**. **Numeric inputs stay mono** (Mono-Means-Exact survives the DNA change; the spec keeps mono for exact values) | add `mono?: boolean` (default false) so text fields get Outfit and value fields keep JetBrains | `.oj-input`, `.oj-input:focus`. `Input.test.tsx:8` `toBe` | RESTYLE + API |
| 13 | **Kbd** | `--bg-tertiary`, `--border-subtle`, `--radius-sm`, mono `--text-xs` | `.nj-menu-item kbd` — `500 11px JetBrains`, `--text-muted`, `--bg-tertiary`, 1 px `--line`, 5 px radius, `padding:2px 5px` | none | `.oj-kbd`, `--custom`. `Kbd.test.tsx:9` `toBe` | RESTYLE |
| 14 | **KeyTile** | 2 px ink, `--shadow-sketch`, `--font-sketch` label, `--radius-lg/sm`, white/black/key/pad variants, `.is-active` = `--accent-primary` fill | `.nj-pad` — **48 px**, `--radius-md`, `--bg-node`, 1 px `--line2`, `--shadow-raised`, **bottom-anchored 10 px mono label** (`padding-bottom:5px`), `--text-muted`; hover `translateY(-2px)` (spring); active `scale(.94)`; **hit = solid `--accent-primary` fill + `--text-on-accent` + `translateY(1px)` + `--shadow-pressed`**. **No glow.** `--black` variant keeps its dark faceplate | `size?: number` for the 34 px canvas-vignette variant | `.oj-key-tile`, `--white/--black/--key/--pad`, `.is-active`, `__port`, `__label`. **`KeyTile.test.tsx:49-58` asserts the `__port` child forwards `data-node-id`/`data-port-id`** | RESHAPE |
| 15 | **LaneButton** | `--shadow-sketch`, `--border-strong`, timeline tokens, aria-pressed tones | inset pill segment; pressed = `--bg-node` + `--shadow-raised` (segmented-control physics) | none | `.oj-lane-button--mute/--solo/--armed/--recording[aria-pressed="true"]` — **e2e `J2` selects these by title/label, not class** | RESTYLE |
| 16 | **ListRow** | 2 px border on selected, `--font-sketch`, `--radius-md` | `.nj-menu-item` physics — `500 14px Outfit`, 8 px radius, hover `--bg-tertiary`; selected = `--bg-tertiary` + `--accent-primary` text | none | `.oj-list`, `.oj-list-row`, `.is-selected/.is-current/.is-disabled`, `__body/__actions`. `ListRow.test.tsx:9,30` `toBe` | RESTYLE |
| 17 | **Marquee** | 13-line, `--accent-primary` dashed box | 1.5 px `--accent-primary`, `color-mix(… 10%)` fill (matches `.selection-box`) | none | `.oj-marquee` | RESTYLE |
| 18 | **Menu** | `--font-sketch` items, `--border-subtle`, `--z-popover`, submenu on hover/focus-within, category headers | `.nj-menu` — `--bg-node` panel, **12 px radius**, `--shadow-overlay`, `padding:6px`; items `500 14px Outfit`, 8 px radius, hover `--bg-tertiary`; shortcuts as mono keycaps; categories `600 10.5px Outfit` uppercase `.1em` `--text-muted`; separators = 1 px `--line`, `margin:5px 8px` | none | `.oj-menu`, `.oj-menu-item`, `__icon/__label/__shortcut/__chevron/__submenu`, `--has-submenu`, `.oj-menu-category`, `.oj-menu-separator`, `[aria-disabled='true']` | RESTYLE |
| 19 | **Modal** | scrim `--overlay-scrim`, align/size variants, `--z-modal` | scrim → per-theme `color-mix` + `backdrop-filter: blur(14px) saturate(1.1)`; panel = `--bg-node`, 1 px `--line`, `--radius-xl`, `--shadow-overlay` | none | `.oj-modal__scrim`, `--align-*`, `.oj-modal`, `--size-*` | RESTYLE |
| 20 | **NodeFrame** | absolute, `--z-node`, `translate()` transform, grab cursor | unchanged | none | `.oj-node-frame`, `.is-dragging`, the inline `transform: translate(x,y)` (**`NodeCanvas` and e2e both depend on transform-based positioning**). `NodeFrame.test.tsx:11` `toBe` | KEEP |
| 21 | **NodeShell** | `--bg-node`, 2 px ink, `--radius-lg`, `--shadow-node`; header = `--bg-node-header` + `--font-sketch` `--text-lg` title + `--font-sans` 13 px type; **ports already in-body** via `__ports` / `__ports-left` / `__ports-right` | `.nj-node` — 1 px `--line`, `--radius-lg`, `--shadow-overlay`; header = `--bg-node-header`, `padding:10px 14px`, **2×2 grip dots** (`.nj-grip i` 3 px `--line2`) + `600 15px Outfit` title + right-aligned **type chip** (`500 10px JetBrains` uppercase `.08em`, `--bg-tertiary`, `--radius-sm`, `padding:4px 7px`); body `padding:12px 14px`, `gap:12px`; port rows are the **first row of the body**, laid out as one `justify-content:space-between` row (`.nj-piorow`) rather than two stacked columns | add `grip?: boolean` (default true); `nodeType` now renders inside a chip element | `.oj-node`, `.is-selected/.is-dragging/.is-agent-pending/.is-bypassed/.is-window-open/.is-watchdog-bypassed`, `__header/__title/__type/__window/__content`. **`NodeShell.test.tsx:40-42,47` pins `__ports`, `__ports-left`, `__ports-right`** — §3.4 | RESHAPE |
| 22 | **OffscreenPointer** | `--shadow-menu`, 2 px ink, `--font-sketch`, `--oj-pointer-rotation` | surface pill, 1 px `--line`, `--shadow-overlay`, Outfit | none | `.oj-offscreen-pointer`, `__arrow/__label`, `--oj-pointer-rotation`. `OffscreenPointer.test.tsx:11,54` `toBe` | RESTYLE |
| 23 | **PanelHeader** | `--font-sketch` title `--text-lg`, `--border-subtle` rule | `600 22px Outfit` title, `--text-secondary` subtitle, 1 px `--line` | none | `.oj-panel-header`, `__row/__left/__back/__heading/__title/__badge/__subtitle/__right/__actions/__extra` | RESTYLE |
| 24 | **ParamRow** | 7-line CSS, mono value, `--timeline-automation-line` for driven state | `.nj-param` — `grid-template-columns:1fr auto`, `gap:4px 10px`; label `500 13px Outfit` `--text-secondary`; value = ValueScrubber chip | none | `.oj-param-row`, `__line/__label/__value`, `.is-driven`, `[aria-pressed]::before` | RESTYLE |
| 25 | **Port** | 16 px circle, 2 px `--sketch-black`, filled by directional wiring color; hover `scale(1.25)`; connected = brighten + **8 px glow**; universal = animated rainbow; `.is-active` = green + glow + pulse | `.nj-sock` — **18 px recessed well**: `--bg-tertiary` bg, 1 px `--border-strong`, `--shadow-inset`, `place-items:center`, with an **8 px `::after` core dot** — `--border-strong` when idle, `--control-connection` when live, `--audio-connection` when live+audio, `--universal-connection` when live+universal. **No glow, ever.** Hover: no scale (No-Surprise) — instead a 1 px `--accent-primary` ring on the well | `direction` becomes **presentational only** (row side), no longer selects a color → keep the prop (row layout needs it) but drop `--audio-input/-output` classes; `resolvedKind` unchanged; `active` keeps the success core, loses the glow + pulse | **`data-node-id` / `data-port-id` / `data-port-type` must still land on the `.oj-port` element** — `NodeCanvas.tsx:188,997` query `[data-node-id][data-port-id]` and take `getBoundingClientRect()` center; `NodeCanvas.tsx:259` hit-tests `.oj-port, .oj-port-row`; `NodeCanvas.css:103` ghost-mode. `Port.test.tsx:21-22` asserts universal ports are direction-less | RESHAPE + API |
| 26 | **PortRow** | flex; `input` = `[dot][label]`, `output` = `row-reverse`; label `--font-sketch` `--text-sm` `--text-secondary` | `.nj-pio` — `gap:7px`, label `600 9.5px JetBrains` uppercase `letter-spacing:.07em` `--text-muted`; inputs left, outputs right. Rows sit inside a `.nj-piorow` (`space-between`) supplied by NodeShell | none | `.oj-port-row`, `--input/--output`, `__label`, `__label--hidden`, `.is-connected/.is-placeholder/.is-disabled`. **`...rest` (incl. `data-*` + pointer handlers) must keep forwarding to the `Port`, not the row** (`PortRow.tsx:69-75`) | RESTYLE |
| 27 | **ProgressBar** | `--bg-tertiary` track, `--sketch-light`, tone fills | 6 px pill track `--bg-tertiary`, accent/tone fill, `--radius-pill` (99 px) | none | `.oj-progress`, `__fill`, `--success/--warning/--danger`. `ProgressBar.test.tsx:9` `toBe` | RESTYLE |
| 28 | **SegmentedControl / Tabs** | pill container, 2 px ink, `--font-sketch`, active = `--accent-primary` fill + `--text-on-accent`; `--vertical` variant | `.nj-seg` — **3 px-padded `--bg-tertiary` pill**, `--radius-md`, 2 px gap; buttons `600 13px Outfit` `--text-secondary`, `padding:6px 14px`, 8 px radius, transparent; **selected = `--bg-node` + `--text-primary` + `--shadow-raised`** (not an accent fill) | none | `.oj-seg`, `__btn`, `.is-active`, `.is-disabled`, `--vertical`. `SegmentedControl.test.tsx:17,30,31,132` `toBe`. **`SettingsPanel` uses the vertical Tabs for its sidebar** | RESHAPE |
| 29 | **Select** | 2 px ink, `--bg-canvas`, `--font-sketch` | `.nj-input` (surface + `--line2` + `--radius-md`) with a `--text-muted` caret | none | `.oj-select`. `Select.test.tsx:14` `toBe` | RESTYLE |
| 30 | **Slider** | 2 px ink track, `--shadow-sketch` thumb, `--radius-pill`, `--accent-primary` progress | `.nj-range` — **6 px pill track** (`--bg-tertiary` bg, `--accent-primary` fill via `linear-gradient`/`-moz-range-progress`), **18 px thumb**: `--bg-node`, **1.5 px `--border-strong`**, `--shadow-raised`; hover thumb `scale(1.15)` + `--focus-ring`; height 22 px | none | `.oj-slider` + all six `::-webkit-*` / `::-moz-*` pseudos. `Slider.test.tsx:9,32` `toBe`. **e2e `getByRole('slider', /gain/i)`** (J1, arrangement-editing) — keep it a real `<input type=range>` | RESTYLE |
| 31 | **Spinner** | `--border-subtle` ring + `--accent-primary` arc, `--transition-slow` | unchanged shape, new tokens | none | `.oj-spinner`. **e2e `plugins.spec.ts:33` asserts `getByText('Spinner')` count 0** (text, not class) | RESTYLE |
| 32 | **StatusDot** | 2 px ink dot, ok/warn/bad/idle/info | 8 px dot, no border, state color fill; **must not appear inside a Chip** (§Chip) | none | `.oj-status-dot`, `--ok/--warn/--bad/--idle/--info`. `StatusDot.test.tsx:9,28` `toBe` | RESTYLE |
| 33 | **Surface** | `--shadow-node`/`--shadow-menu`/lifted elevations, 2 px ink, radius variants | `--shadow-raised` / `--shadow-overlay`; 1 px `--line`; **`elevation="lifted"` becomes redundant** — collapse to two elevations | `SurfaceElevation`: `'rest' \| 'menu' \| 'lifted'` → `'raised' \| 'overlay'` | `.oj-surface`, `--elevation-*`, `--radius-*`. **`Banner.test.tsx:17-18` asserts `oj-surface--elevation-menu`** | RESTYLE + API |
| 34 | **Swatch** | 2 px ink chip, `--font-sketch` name, selected ring | 1 px `--line2` chip, `--radius-md`, Outfit 500 name, selected = `--accent-primary` border + `--focus-ring` | none | `.oj-swatch`, `__preview/__chip/__name`, `.is-selected`. `Swatch.test.tsx:9` `toBe`. **`SettingsPanel` theme cards do *not* use Swatch today** — they should after this migration | RESTYLE |
| 35 | **Textarea** | `--bg-canvas`, 2 px ink, `--font-sans` | `.nj-input` | none | `.oj-textarea`. `Textarea.test.tsx:10,15` `toBe` | RESTYLE |
| 36 | **TimeRuler** | 5-line CSS; mono marks; `--timeline-grid-*` | mono `--text-micro` uppercase; retimed grid tokens | none | `.oj-time-ruler`, `__mark`, `.is-bar/.is-beat/.is-sub` | RESTYLE |
| 37 | **Toggle** | 2 px ink track, `--radius-pill`, checked = `--accent-success` | `.nj-toggle` — **40×23 pill**, `--bg-tertiary` track + 1 px `--line2`; **17 px `--bg-node` knob** with `--shadow-raised`, `translateX(17px)` on the **spring**; checked = `--accent-primary` track + transparent border; focus-visible = `--focus-ring` on the track | none | `.oj-toggle`, `__input/__track/__knob/__text/__label/__desc`, `.is-checked/.is-disabled`. `Toggle.test.tsx:9` `toBe`. **e2e `button 'Snap to grid'`** is a Toggle by accessible name | RESHAPE |
| 38 | **ValueScrubber** | `--font-mono` value on `--bg-tertiary`, 2 px border on editable, `--radius-sm` | `.nj-param .val` — `500 12px JetBrains`, `--text-primary`, `--bg-tertiary` chip, `--radius-sm`, `padding:3px 7px`, **`cursor: ew-resize`**, hover `box-shadow: inset 0 0 0 1px var(--border-strong)` | none | `.oj-value-scrubber`, `__label/__value/__input`, `--editable`, `.is-disabled`. **`TransportStrip.tsx:58-63` uses it for BPM — the floating transport pill will reuse it** | RESTYLE |
| 39 | **Waveform** | trace = `--audio-output`, playhead = `--accent-danger`, recording state | trace = `--audio-connection` (teal), playhead = `--accent-primary`, center line `--line` | none | `.oj-waveform`, `__svg/__trace/__playhead/__center`, `.is-recording`. `Waveform.test.tsx:12` `toBe` | RESTYLE |
| 40 | **WaveformCanvas** | 1-line CSS | unchanged | none | `.oj-waveform-canvas` | KEEP |
| 41 | **WaveformView** | `--shadow-sketch`, `--border-sketch`, 2 px, `--font-sketch` name, drop-target/dragging states | surface card, 1 px `--line`, `--radius-md`, `--shadow-raised`; name Outfit 500; drop target = `--accent-primary` dashed | none | `.oj-waveform-view`, `__preview/__trace/__duration/__crop/__name`, `.is-selected/.is-drop-target/.is-dragging`. `WaveformView.test.tsx:13` `toBe` | RESTYLE |

### 3.2 New components required

**Knob** — the highest-value addition; it is what makes a node read as an instrument.

```ts
export interface KnobProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  /** Current value in its own units. */
  value: number;
  min: number;
  max: number;
  /** Logarithmic mapping — the right default for frequencies. */
  log?: boolean;
  /** Uppercase micro-label under the dial (mono). */
  label: string;
  /** Formats the value for the readout under the label. Mono-Means-Exact. */
  format?: (v: number) => string;
  /** Live, per-frame while dragging — feeds the optimistic graph edit. */
  onChange: (v: number) => void;
  /** Fired once on pointer-up — the undo boundary. */
  onCommit?: (v: number) => void;
  /** Vertical px for the full range. Default 150 (matches the prototype). */
  dragRange?: number;
  /** 52 by default. */
  size?: number;
  disabled?: boolean;
}
```
CSS: `.oj-knob` — `radial-gradient(circle at 35% 30%, var(--bg-node), var(--bg-tertiary))`,
1 px `--border-strong`, `--shadow-raised`, `cursor: grab`; `::after` tick 3×15 px
`--accent-primary`, `transform-origin: 50% 22px`, `rotate(var(--oj-knob-rot))` mapped
−135°…+135°; hover `box-shadow: var(--shadow-raised), var(--focus-ring)`.
A11y: `role="slider"`, `aria-valuenow/min/max/valuetext`, `tabIndex=0`, Arrow/PageUp/Home
keyboard stepping (the prototype has none — this is the taste-tier addition).
Reduced motion: the tick rotation is a *value* not an animation; no change needed, but the
`--motion-spring` on hover must be stilled.

**Meter** — needed by the transport pill, the Output node, and the mixer.

```ts
export interface MeterProps extends HTMLAttributes<HTMLDivElement> {
  /** RMS 0..1. Written to `--oj-meter-signal`; bars scale on the GPU. */
  level: number;
  /** Per-bar weights, e.g. [.55,.8,1,.7,.45]. Length = bar count. */
  weights?: number[];
  size?: 'sm' | 'lg';
  /** Accessible summary, e.g. "-6.0 dB". */
  label?: string;
}
```
CSS: `.oj-meter i { transform: scaleY(calc(var(--oj-meter-signal) * var(--oj-meter-k))); transform-origin: bottom; transition: transform 60ms linear; background: var(--accent-success) }`.
**Critical:** the level must be written as a CSS custom property from a `requestAnimationFrame`
loop on a ref — never as React state, or the canvas re-renders at 60 fps. Precedent already in
the repo: `SharedSurfaceChrome.tsx:10-19` does exactly this for the bar.beat readout.

**TransportPill** — the floating top-center transport (§5.3).

```ts
export interface TransportPillProps {
  playing: boolean;
  onTogglePlay: () => void;
  bpm: number;
  onBpmChange: (bpm: number) => void;   // drag-to-scrub, clamp 20..300
  level: number;                        // feeds Meter
  /** Pulse the play button until the first user gesture (browser autoplay). */
  attention?: boolean;
  /** Right-side hint, e.g. "space". */
  hint?: string;
}
```

**Grip** — do **not** create one. Four 3 px dots is `.oj-node__grip` inside NodeShell; a
standalone component would be a line that earns nothing.

**SocketRow** — do **not** create one either. `PortRow` already *is* the socket row; the only
new thing is the `.nj-piorow` wrapper (`display:flex; justify-content:space-between`), which is
one rule inside `NodeShell.css` replacing `__ports` / `__ports-left` / `__ports-right`.

### 3.3 The Port / PortRow redesign in detail

**What exists today.**
- `NodeShell.tsx:60-66` renders, between the header and the content:
  ```
  <div className="oj-node__ports">
    <div className="oj-node__ports-left">{inputs}</div>
    <div className="oj-node__ports-right">{outputs}</div>
  </div>
  ```
  Each column is `display:flex; flex-direction:column; gap:var(--space-sm)`, `padding-left/right:
  var(--space-sm)` and deliberately full-bleed *outside* the content padding so the dots hug the
  card edges (`NodeShell.css:96-121`).
- `PortRow` composes `Port` + a label and forwards **all** `...rest` — including
  `data-node-id` / `data-port-id` / `data-port-type` and pointer handlers — **to the `Port`**, not
  the row (`PortRow.tsx:69-75`). That is the connection target.

**What changes.**
1. `.oj-node__ports` becomes a single `justify-content: space-between` row (the `.nj-piorow`
   shape) living **inside** `.oj-node__content`'s padding, as its first child. `__ports-left` /
   `__ports-right` collapse into `__ports__in` / `__ports__out` groups (or disappear entirely for
   the 1-in-1-out majority).
2. `.oj-port` becomes an 18 px recessed well with an 8 px `::after` core dot; the directional
   fill classes (`--audio-input` etc.) are deleted.
3. `.oj-port-row__label` becomes 9.5 px uppercase mono `--text-muted`.

**Why cable endpoints mostly take care of themselves.**
`NodeCanvas.getPortPosition` (`src/components/Canvas/NodeCanvas.tsx:986-1021`) is DOM-first:
```
document.querySelector(`[data-node-id="${nodeId}"][data-port-id="${portId}"]`)
  → getBoundingClientRect() center → un-project by (pan, zoom) → cache
```
Because it measures the *actual* element, moving the socket inward is transparent to it. Cache
invalidation already covers the cases that matter: `pan`/`zoom` change
(`NodeCanvas.tsx:958-966`), `allNodes` change (`:968-971`), and a post-paint rAF bump of
`portLayoutVersion` (`:974-981`). And `.connections-layer` is `z-index: 1` while `.nodes-layer` is
`z-index: 10` (`NodeCanvas.css:26-56`), so a cable running to an inset socket correctly slides
*under* the card and terminates in the well — which is the exact "plugged in" read the spec wants.
**No z-order change, no exit-stub geometry.**

**What must change.**
- **`src/utils/portPositions.ts` — the fallback math.** `DEFAULT_PORT_LAYOUT` is
  `inputArea: { x: 0, … }, outputArea: { x: 1, … }` (`:16-20`) — i.e. exactly on the card edge —
  and `getPortPosition` multiplies the normalized x by the node width (`:41-46`). This path is used
  (a) on the first render pass, before nodes paint, and (b) whenever the DOM query misses. With
  in-body sockets the true x is ≈ `(14 content pad + 9 socket radius) / width` ≈ `0.12` for a
  190 px node, and `1 − 0.12` for outputs, and the true y is the *first body row*, not the vertical
  middle. Update `DEFAULT_PORT_LAYOUT` and the per-node `defaultPorts` `position: { x: 0 | 1, … }`
  literals in `src/engine/registry.ts` (they appear on ~15 node types) to the new inset. **Symptom
  if skipped:** one frame of cables anchored to the card corners on every canvas mount and every
  node add, then a snap — a visible glitch, which the covenant calls a bug.
- **`getPortCanvasPositionForSelection`** (`NodeCanvas.tsx:184-217`) has the *same* fallback and
  hardcodes `nodeWidth = 180; nodeHeight = 120` (`:209-210`). Those literals are already wrong for
  most nodes; fix or delete while here.
- **`findPortAtPosition`** (`portPositions.ts:126-148`) uses a 15 px radius threshold in canvas
  coords. With an 18 px well the threshold should be ≥ 12 px; keep 15.
- **The ~20 bespoke schematic nodes** that emit `data-port-*` themselves and are positioned by
  `SchematicNodes.css` rather than by `NodeShell` — see §4.3. These are the real work.

### 3.4 Tests that pin the old node/port DOM

- `packages/oj-ui/src/components/NodeShell/NodeShell.test.tsx:40-42,47` — asserts
  `.oj-node__ports`, `.oj-node__ports-left`, `.oj-node__ports-right` exist. **Must be rewritten**,
  not adapted.
- `packages/oj-ui/src/components/Port/Port.test.tsx` — asserts the
  `oj-port--<kind>-<direction>` class scheme and (`:21-22`) that universal ports are
  direction-less. **Rewrite** for the new socket model.
- `packages/oj-ui/src/components/PortRow/PortRow.test.tsx` — asserts `data-*` forwarding to the
  `Port`. **Keep passing** — that is the load-bearing contract.
- `packages/oj-ui/src/components/KeyTile/KeyTile.test.tsx:49-58` — asserts `__port` forwards
  `data-node-id`/`data-port-id`. **Keep passing.**
- `packages/oj-ui/src/components/Port/Port.figma.tsx` pins `<Port kind="audio" direction="output"/>`
  — if `direction` is removed the Code Connect example fails typecheck and
  `.github/workflows/code-connect.yml` fails the PR. **Keep `direction`.**

---

## 4. App CSS inventory (46 files, 11 455 lines)

Columns: **Lines** · **sk** = `--font-sketch` uses · **sh** = `--shadow-sketch/-node/-menu` uses ·
**bd** = `--border-sketch-width/-strong/-sketch` uses · **sc** = `--sketch-black/gray/light` uses ·
**lit** = literal `#hex`/`rgb(a)` occurrences · **dead** = class selectors not found anywhere in
`.ts`/`.tsx` (coarse, string-match).

| File | Lines | sk | sh | bd | sc | lit | dead | Verdict |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| `src/styles/global.css` | 359 | 5 | 4 | 6 | 10 | 1 | 0 | **REDESIGN** — owns `body`, `#root` dot grid, scrollbars, `input/select/textarea` reset, `:focus-visible`, Sonner overrides **and the entire `.oj-welcome` screen (L164-330, 167 lines)** which onboarding replaces |
| `src/styles/fonts.css` | 81 | 0 | 0 | 0 | 0 | 0 | — | **REDESIGN** — §2.1 |
| `src/components/Nodes/SchematicNodes.css` | 3041 | 22 | 4 | 13 | 25 | 34 | 0 | **REDESIGN** — see §4.3 |
| `src/components/CommandBar/CommandBar.css` | 1127 | 11 | 4 | 16 | 35 | 0 | 0 | **REDESIGN** — the Ctrl+K palette + AI panel is a signature surface; 35 `--sketch-*` uses means the whole ink language is baked in. Target: `.nj-menu` + `.nj-input` + `.nj-chip` physics |
| `src/components/Guides/Guide.css` | 651 | 2 | 0 | 3 | 1 | 23 | 4 | **RETHEME + literal cleanup** — 23 literal colors, only 3 legacy border uses. Settings-scoped (only `LowLatencyGuide` consumes it) |
| `src/components/Nodes/MiniLab3Visual.css` | 618 | 0 | 0 | 0 | 0 | **102** | 0 | **REDESIGN** — a hardware faceplate drawn almost entirely in literal hex. Zero token discipline. Highest literal count in the repo |
| `src/components/Nodes/MIDIVisualNode.css` | 449 | 3 | 0 | 2 | 28 | 46 | 3 | **REDESIGN** — 28 `--sketch-*` + 46 literals |
| `src/components/Arrangement/ArrangementSurface.css` | 383 | 9 | 6 | 19 | 23 | **0** | 10 | **REDESIGN** — the timeline. Already literal-clean (the `tokenLiteralGate` enforces it) but 19 border + 23 sketch-color uses. **`ArrangementSurface.test.tsx:56-58` regex-pins three declarations here** |
| `src/components/Settings/KeybindingsPanel.css` | 279 | 10 | 1 | 1 | 2 | 0 | 0 | **RETHEME** |
| `src/components/Clips/WaveformEditorModal.css` | 274 | 3 | 0 | 1 | 0 | 2 | 7 | **RETHEME** (+ 7 dead selectors to check) |
| `src/components/Toolbar/Toolbar.css` | 267 | 2 | 4 | 1 | 3 | 0 | 1 | **REDESIGN** — the floating pill is replaced by the new topbar + transport pill (§5) |
| `src/components/Settings/AudioSettingsPanel.css` | 239 | 3 | 0 | 0 | 0 | 0 | 0 | **RETHEME** |
| `src/components/Nodes/InstrumentVisualNode.css` | 234 | 0 | 0 | 0 | 0 | 35 | 0 | **REDESIGN** — 35 literals |
| `src/components/Nodes/SamplerVisual.css` | 231 | 1 | 0 | 1 | 2 | 0 | 4 | **RETHEME** |
| `src/components/Clips/AudioClipVisual.css` | 213 | 1 | 0 | 1 | 0 | 2 | 0 | **RETHEME** |
| `src/components/Settings/SettingsPanel.css` | 210 | 1 | 0 | 4 | 8 | 0 | 4 | **REDESIGN** — theme picker becomes 2 cards (§5.5); `.minimal-theme-card` markup is `div onClick` with no a11y |
| `src/components/common/ResizeHandles.css` | 196 | 0 | 0 | 0 | 0 | 9 | **8** | **RETHEME** — 8 of 14 selectors unreferenced; audit for DELETE |
| `src/components/BundlePortGroup.css` | 191 | 0 | 0 | 0 | 1 | 10 | 3 | **REDESIGN** — bundle ports are ports; must follow the socket redesign |
| `src/components/Canvas/NodeCanvas.css` | 189 | 1 | 2 | 1 | 1 | 0 | 4 | **REDESIGN** — dot grid (`--border-subtle` 1px on 20px vs the DNA's `--line` 1px on **22px**), ghost mode (`portGlow` keyframes must die — "nothing else glows"), `.back-to-action`, `.selection-box` |
| `src/components/Collab/CollabControl.css` | 188 | 0 | 0 | 0 | 0 | **25** | 0 | **REDESIGN** — 25 literals incl. `box-shadow: 0 0 6px #22c55e` (L39), a hardcoded glow |
| `src/components/DevLog/DevLogPanel.css` | 180 | 0 | 0 | 2 | 3 | 0 | 0 | **RETHEME** |
| `src/components/Toolbar/DropdownMenu.css` | 178 | 2 | 2 | 2 | 2 | 2 | 0 | **DELETE (candidate)** — this is a hand-rolled menu that duplicates oj-ui `Menu`. `DropdownMenu.tsx` (279 lines) reimplements keyboard nav, submenus, click-outside. Migrating the 3 toolbar menus to `<Menu>` removes 178 CSS + ~200 TSX lines (code value #1). If not migrated: RETHEME |
| `src/components/MIDI/MIDIConnectionToast.css` | 167 | 2 | 0 | 3 | 0 | 1 | 0 | **RETHEME** |
| `src/components/Settings/UpdatesPanel.css` | 156 | 2 | 0 | 0 | 0 | 0 | 0 | **RETHEME** |
| `src/components/Export/ExportDialog.css` | 132 | 1 | 0 | 1 | 3 | 0 | 2 | **RETHEME** (inside the `tokenLiteralGate` scope) |
| `src/components/Nodes/BaseNode.css` | 118 | 4 | 0 | 1 | 4 | 0 | 0 | **DELETE (candidate)** — 118 lines of node chrome superseded by `NodeShell`. Verify no live emitter, then remove |
| `src/components/MIDI/MIDIDeviceCard.css` | 104 | 1 | 0 | 2 | 0 | 1 | 0 | **RETHEME** |
| `src/components/Canvas/ContextMenu.css` | 101 | 0 | 2 | 0 | 0 | 0 | 0 | **RETHEME** → `.nj-menu` values (or DELETE if migrated to oj-ui `Menu`) |
| `src/components/PianoRoll/PianoRoll.css` | 96 | 4 | 1 | 4 | 16 | 0 | 4 | **REDESIGN** — 16 `--sketch-*` in 96 lines; the densest legacy concentration per line in the repo. **e2e selects `.piano-roll-note`, `.piano-roll__field`, `.piano-roll__row`, `--draw`, `--elsewhere`, `.is-selected`** |
| `src/components/Clips/ClipDragLayer.css` | 88 | 2 | 0 | 0 | 0 | 3 | 0 | **RETHEME** |
| `src/components/Nodes/SongNode.css` | 79 | 0 | 0 | 0 | 0 | 16 | 0 | **RETHEME + literal cleanup**. **e2e selects `.song-node`** |
| `src/components/Nodes/MIDINode.css` | 75 | 2 | 0 | 1 | 4 | 4 | 0 | **RETHEME** |
| `src/components/EngineHealthDot/EngineHealthDot.css` | 68 | 1 | 0 | 1 | 6 | 1 | 0 | **RETHEME** → StatusDot tokens |
| `src/components/Dialogs/RelinkSamplesDialog.css` | 68 | 0 | 0 | 1 | 1 | 0 | 0 | **RETHEME** |
| `src/components/common/PanelSeparator.css` | 67 | 0 | 0 | 0 | 0 | 3 | 2 | **RETHEME** |
| `src/components/AppErrorBoundary.css` | 67 | 2 | 1 | 2 | 4 | 12 | 0 | **REDESIGN** — 12 literals; imported directly by `main.tsx:12` so it must survive a token failure. **Keep it literal-only on purpose** and document why (it is the one surface that must render when the token layer is broken) |
| `src/components/Toolbar/Breadcrumbs.css` | 55 | 1 | 0 | 0 | 0 | 0 | 0 | **RETHEME** |
| `src/components/MIDI/MIDIDeviceBrowser.css` | 48 | 1 | 0 | 0 | 0 | 0 | 0 | **RETHEME** |
| `src/components/AudioHealth/AudioHealthPanel.css` | 43 | 1 | 0 | 1 | 1 | 0 | 0 | **RETHEME** |
| `src/components/Collab/PresenceOverlay.css` | 37 | 0 | 0 | 0 | 0 | 2 | 0 | **RETHEME** |
| `src/components/Plugins/PluginsPanel.css` | 34 | 3 | 0 | 1 | 2 | 0 | **6** | **RETHEME** (inside `tokenLiteralGate` scope) |
| `src/components/IssueReporter/IssueReporter.css` | 30 | 1 | 0 | 1 | 1 | 0 | 0 | **RETHEME** |
| `src/components/params/AutoParamPanel.css` | 14 | 2 | 0 | 0 | 3 | 0 | 2 | **REDESIGN** — 14 lines is far too little for the panel that renders *every* `ui: 'auto'` node. This is where `Knob` lands (§3.2) |
| `src/components/Plugins/PluginWindowShell.css` | 14 | 1 | 1 | 2 | 3 | 0 | 1 | **RETHEME** |
| `src/components/Bench/Bench.css` | 9 | 0 | 0 | 2 | 0 | 0 | **4** | **RETHEME** (inside `tokenLiteralGate` scope) |
| `src/components/LatencyWarningBanner.css` | 7 | 0 | 0 | 0 | 0 | 0 | 0 | **KEEP** |

**Totals across `src/**/*.css`:** 122 `--font-sketch`, ~34 legacy-shadow, ~106 legacy-border,
~197 `--sketch-*`, ~421 literal colors, ~155 `box-shadow` declarations.
**Zero blurred `box-shadow`s in the app CSS** — the Hard-Shadow Rule was actually held, which
means every single shadow declaration in `src/` is a hard offset that must be replaced. That is
the cleanest possible starting point for a mechanical swap.

### 4.1 Dead-CSS candidates (coarse; verify before deleting)

`ResizeHandles.css` 8/14 unreferenced · `WaveformEditorModal.css` 7/21 ·
`PluginsPanel.css` 6/20 · `Bench.css` 4/7 · `SamplerVisual.css` 4/21 ·
`PianoRoll.css` 4/41 · `SettingsPanel.css` 4/26 · `NodeCanvas.css` 4/19 ·
`Guide.css` 4/62 · `ArrangementSurface.css` 10/110 · `BundlePortGroup.css` 3/19 ·
`MIDIVisualNode.css` 3/44 · `ExportDialog.css` 2/21 · `PanelSeparator.css` 2/4 ·
`AutoParamPanel.css` 2/11.
(The detector is a plain substring match against all `.ts`/`.tsx` identifiers, so it
under-reports dead rules and never over-reports. Every hit is a genuine candidate.)

### 4.2 `SchematicNodes.css` — how to approach 3041 lines

Section map, from the file's own banner comments:

| Lines | Section | Nature |
|---|---|---|
| 1-57 | Schematic Node Base + clip drop target | **shared chrome** — the `.schematic-node` card |
| 58-246 | Speaker Node (mute button, master slider + live meter, device selector, low-latency indicator) | faceplate |
| 247-299 | Keyboard Node (+ active mode ring, port rows) | faceplate + **port rows** |
| 300-494 | Instrument Node (body layout, row divider, empty state, output port, pedal row, bundle input port) | faceplate + **ports** |
| 495-653 | Instrument selector dropdown (grid, groups, cards, shortcut hints) | **menu — migrate to oj-ui `Menu`/`ListRow`** |
| 654-673 | Inline editable values | **migrate to `EditableLabel`/`ValueScrubber`** |
| 674-1077 | Looper Node (duration scrubber, waveform, loops list, record button, transport pill, export editor, wet control, undo) | faceplate — **the biggest single node, 403 lines** |
| 1078-1200 | Microphone Node (latency badge, source selector, device dropdown, mute + slash overlay, waveform) | faceplate |
| 1201-1232 | Keyboard bundle/advanced mode, bundle mapping button | ports |
| 1233-1304 | Canvas I/O Nodes | faceplate + ports |
| 1305-1663 | Keyboard Visual Node (full 30-key layout) | **faceplate, 358 lines** |
| 1664-1686 | Empty-slot styling ("always one empty port") | **ports** |
| 1687-1753 | Container Node | faceplate |
| 1754-1827 | Math Node (Add/Subtract) | faceplate + ports |
| 1828-1979 | Sample Library Node | faceplate |
| 1980-2737 | Library Node two-panel layout (file rows, tags, search, trash) | **panel UI, 757 lines — the least "node-like" part of the file** |
| 2738-3041 | Sampler Node | faceplate |

**Approach, in order:**
1. **Extract the shared chrome (L1-57) first** and make `.schematic-node` a thin alias of
   `.oj-node` — one card language, not two. This alone retires the `--shadow-node`/2 px-ink
   duplication for every schematic node at once.
2. **Extract the port rules** (L285-299, L354-457, L1201-1232, L1664-1686, plus
   `.sampler-side-port`, `.instrument-output-port`, `.library-sample-out-port`,
   `.output-panel-port-row`, `.input-panel-port-row`, `.math-port-row`, `.bundle-input-port`) into
   one `_sockets.css` partial that implements the well+row treatment once. This is the file's
   real coupling to §3.3 and must land in the same increment as the `Port` redesign.
3. **Split the file.** 3041 lines in one stylesheet is itself a covenant violation (a core you
   can't hold in your head). Target: `SchematicBase.css`, `_sockets.css`, and one file per node
   family (`Speaker`, `Looper`, `Microphone`, `Instrument`, `KeyboardVisual`, `Library`,
   `Sampler`, `Math`, `CanvasIO`, `Container`). The `Library` two-panel block (757 lines) is not
   node styling at all — it is a file browser, and it should move next to its component and
   consume `List`/`ListRow`/`Input`/`Chip` from oj-ui.
4. **Then** retheme each faceplate. Per-node faceplates are the one place the New DNA explicitly
   leaves room (`Coherence over consistency` survives the DNA change): a Looper does not have to
   look like a Sampler, but both must be built from the same wells, chips, knobs and hairlines.
   Faceplates are **REDESIGN** (taste pass), not RETHEME — do not hand these to a mechanical swap.

---

## 5. App shell & surfaces

### 5.1 Today

- **`src/App.tsx` is the shell** (749 lines). There is no `AppShell` file, no topbar, no bottom
  bar, no status bar.
- The **only chrome** is `.toolbar-wrapper` — a `position: fixed; top: var(--space-md); left: 50%;
  transform: translateX(-50%)` floating pill (`Toolbar.css:6-30`) containing, in order:
  `<Toolbar>` (File / Edit / View dropdowns, undo, redo, global play-pause, settings gear,
  `EngineHealthDot`, project chip, offline chip), `<Breadcrumbs>` (null at root), and
  `<SharedSurfaceChrome>` (a `1.1` bar-beat readout + a Canvas/Arrangement switcher).
- Surfaces are `position: fixed; inset: 0` layers behind that pill:
  `[data-surface-root="canvas"]` → `<NodeCanvas>`, plus `<ArrangementSurface>` and
  `<PianoRollSurfaceHost>`.
- **`HelpPanel`** is a floating bottom-right button/panel, canvas-only (`App.tsx:730`), with
  ~15 lines of inline styles and a `openjammer:help-dismissed` localStorage key.
- **The welcome screen is inlined in `App.tsx:586-655`** as `.oj-welcome` — a `role="dialog"`
  modal with two options: primary `<button>` "Play here in your browser" (calls `handleActivate`
  → `initAudioContext`) and a secondary `<a href="/download">`. It is shown when
  `!isTauri()` (`App.tsx:121`), hidden when audio is already ready (`:171-176`), suppressed under
  Safe Mode. Its CSS is `global.css:164-330`.
- **The first-run hint** is a Sonner toast fired inside `handleActivate` (`App.tsx:487-501`),
  gated by `localStorage['oj-first-run-done']`, id `'first-sound-hint'`, 12 s, copy:
  *"🎹 Make your first sound / Right-click the canvas → add a Keyboard and an Instrument…"*.
- **`SafeModeScreen.tsx`** reuses the same `.oj-welcome*` class vocabulary plus
  `.oj-welcome-footer` / `-link` / `-footer-sep`.

### 5.2 The handoff's shell

- A real **topbar**: `.topbar` — `--bg-node-header`, 1 px `--line` bottom rule, brand dot + name,
  a preset chip, spacer, theme toggle, "Redo setup".
- A **floating transport pill** top-center over the canvas: play/stop (32–38 px accent circle,
  spacebar), drag-to-scrub BPM (mono), live meter, `space` hint. Play pulses
  (`scale 1 → 1.09`, 1.6 s) until the first gesture.
- An optional **bottom step grid** (8 steps) for looped rigs, hidden for continuous rigs.
- The **onboarding overlay** (3 steps) over the blurred, non-interactive real studio.

### 5.3 Mapping the transport

There is no canvas transport to retheme — it must be built:
- **play/stop** → `useTransportStore` `toggleGlobalPause()` (already wired at
  `Toolbar.tsx:59-65,384-393`); on the arrangement surface it should instead drive
  `TransportStrip`'s `store.play()/stop()` so one pill serves both surfaces.
- **BPM** → `arrangement.tempoBpm` via the existing `apply({kind:'setTempo'})` action
  (`TransportStrip.tsx:58-63`). Reuse `ValueScrubber` — it already implements drag-to-scrub and
  `onCommit`; do not write a second scrubber.
- **meter** → **net new.** There is no level meter in `src/` (`LevelMeter|level-meter|vu-meter|peakMeter`
  → 0 hits). The only signal source today is `probeSignal` in `src/ai/envAdapter.ts:163-177`
  (agent-only) and the per-connection `signalLevels` map `NodeCanvas` already feeds to `Cable`
  (`NodeCanvas.tsx:1039-1041`). **Use the master-out RMS the speaker node already renders**
  (`SchematicNodes.css:118` "master volume slider + live output meter (VIS-1: the meter reads the
  engine's…)") — that path exists; expose it as a store selector and drive `--oj-meter-signal`
  from a rAF loop. **Never put it in React state.**
- **The attention pulse** must be honest: it exists because of the browser autoplay policy, so it
  must be shown **only in the browser tier** and never in Tauri, where `App.tsx:532-536` already
  unlocks audio on mount. That is the "Honest interfaces" rule applied to a decoration.

### 5.4 Onboarding replaces welcome + first-run toast

The 3-step overlay (experience → goal → light/dark) subsumes both of today's mechanisms:

| Today | Replaced by |
|---|---|
| `.oj-welcome` modal (`App.tsx:586-655`, `global.css:164-330`) | Step 3's **theme choice buttons are the user gesture** that calls `initAudioContext`. Same code path (`handleActivate`), new surface |
| `oj-first-run-done` toast (`App.tsx:487-501`) | Step 1's persona → the beginner "nothing can break" hint bubble, dismissible, rendered *on the canvas near the rig* rather than as a corner toast |
| `openjammer:help-dismissed` HelpPanel | keep, but default-collapsed for `pro`, default-open for `first` |
| — | new: `localStorage['oj-onboarding-v1'] = {exp, goal, theme}`; `SettingsPanel` gains "Redo setup" which clears it |

**Non-negotiable constraints:**
1. **The browser autoplay gate must remain a real user gesture.** `initAudioContext` must be
   called synchronously from the click handler of an onboarding option — not from a `useEffect`
   after the overlay closes. The prototype does this correctly (`app-main.jsx` `done()` calls
   `OJAudio.init(); …play()` inside the click). Preserve that shape.
2. **Native (Tauri) has no gate.** `App.tsx:532-536` unlocks on mount. Onboarding must still
   *show* on native (it configures persona/goal/theme) but must not pretend the audio unlock is
   the reason it exists — the copy differs, and the play-button attention pulse is browser-only.
3. **Skip must work.** Esc or "Skip, take me in" finishes with defaults *keeping answers already
   given* — and on the browser that skip button is itself the gesture.
4. **The overlay sits on the real studio, blurred.** `.app.preview { pointer-events: none }` and
   `.app.preview > * { filter: blur(5px) }`. `filter: blur()` on a subtree containing the canvas
   creates a compositing layer over ~everything; on a large canvas this is expensive. **Blur the
   surface layers only, and drop the blur entirely under `prefers-reduced-motion` / low-power** —
   and verify it does not touch the audio thread's frame budget (it will not; but verify the
   *visual* frame rate on the founder box before shipping).

### 5.5 Theme picker

`SettingsPanel.tsx:69-92` maps `themes` into `.minimal-theme-card` `<div onClick>` elements with
inline-styled swatches. With two themes this becomes a proper 2-up radio group. Fix the a11y gap
while here (no `role`, no `tabIndex`, no keyboard activation today) and use oj-ui `Swatch`.
Also note `envAdapter` can change the theme underneath an open SettingsPanel without updating its
local `selectedTheme` state — a real bug worth fixing in the same pass.

### 5.6 Preset rigs from REAL nodes

The prototype's rigs are toy WebAudio. Build them from `src/engine/registry.ts` types.
Available (40 registered types): `keyboard`, `keyboard-key`, `keyboard-visual`, `instrument`,
`instrument-visual`, `microphone`, `midi`, `midi-visual`, `minilab-3`, `minilab3-visual`,
`piano`, `cello`, `electricCello`, `violin`, `saxophone`, `strings`, `keys`, `winds`, `looper`,
`effect`, `pan`, `width`, `multiplier`, `speaker`, `recorder`, `canvas-input`, `canvas-output`,
`output-panel`, `input-panel`, `container`, `add`, `subtract`, `library`, `sampler`,
`sampler-visual`, `song`, `audio-in`, `audio-out`.

| Handoff rig | Real graph | Notes |
|---|---|---|
| **jam** ("a warm playable synth with space on it") | `keyboard-visual` → `instrument` (`instrumentId: 'salamander-piano'`, the registry default at `registry.ts:~483`) → `effect` (`effectType`, default `'distortion'` — **change the rig's default to a reverb/delay preset**) → `speaker` | `keyboard-visual` outputs are **`control`** ports (31 of them, one per key) — the port-color legend holds: grey out of the keyboard, blue/teal out of the instrument |
| **beat** ("drums and an 8-step groove") | `keyboard-visual` (pads) → `sampler` → `speaker`, plus a `song` node for the 8-step grid | The prototype's step grid maps to the **Arrangement**, not the canvas. Either (a) put the beat rig's grid in `ArrangementSurface` and have the goal answer switch surface, or (b) build the 8-step grid as a real `song`/clip pattern. **(b) is the honest one** — a fake grid that isn't the arrangement is a lie the user discovers in 30 seconds |
| **sound design** ("an oscillator, a filter, knobs to sculpt") | `instrument` → `effect` → `speaker`, with `AutoParamPanel` rendering the new `Knob` for each param | **There is no standalone oscillator or filter node type.** Either add them (they are DSP → plugin territory, `ojcore-dsp` + a manifest) or express the rig with `instrument` + `effect`. **Flag as an owner decision** — the handoff's third rig is the only one with no faithful mapping today |

Preset construction must go through the **same reversible graph verbs the agent and the user
use** (`docs/agent-tools.md`), so "Redo setup" and Ctrl+Z behave. Do not write a bespoke
graph-seeding path.

---

## 6. Risk register

### 6.1 Tests that WILL break (named)

| Test | Location | Why |
|---|---|---|
| `tokenLiteralGate` gate 2 | `src/components/Arrangement/__tests__/tokenLiteralGate.test.ts:23-31` | Any `var(--x)` in `Arrangement/`, `Export/`, `Plugins/`, `Bench/` not declared in those files or in the generated `packages/oj-ui/oj-tokens.css`. **Forces the DTCG edit + `bun run tokens` + the four-directory rewrite into ONE commit** |
| `tokenLiteralGate` gates 1 & 3 | same file `:17-21, 35-39` | Forbids `#hex`/`rgb(a)`/`hsl(a)` in `Arrangement/`, `Plugins/`, `Bench/`. **`oklch()` and `color-mix()` are allowed** — the New DNA passes |
| `ArrangementSurface.test.tsx` | `:56-58` | Regex-pins `grid-template-rows: 26px 24px`, `font: 600 18px/26px var(--font-sketch)`, `overflow-clip-margin: 6px` out of the raw CSS. The whole test is a Caveat-ascender guard — **delete it**, it protects a face that no longer ships |
| `contrast.test.ts` | `:2, 23-24, 28` | Imports `cream.json` directly; `hex()` slices `#RRGGBB` and **produces `NaN` on `oklch()`**; pins `sketchBlack` and the literal `#1A1A1A`. **Rewrite to parse oklch and to run over both themes** — see §6.3 |
| `envTools.test.ts` | `:89, 100, 167` | `themeId: 'cream'` ×2 and `expect(res.summary).toContain('cream')` |
| `NodeShell.test.tsx` | `:40-42, 47` | Pins `.oj-node__ports`, `__ports-left`, `__ports-right` |
| `Port.test.tsx` | `:21-22` and the class assertions | Pins `oj-port--<kind>-<direction>` and direction-less universal ports |
| ~30 exact-class assertions | `Button:9`, `Callout:9`, `Chip:9`, `CodeBlock:9`, `Input:8`, `Kbd:9`, `ListRow:9,30`, `Marquee:9`, `NodeFrame:11`, `OffscreenPointer:11,54`, `ProgressBar:9`, `SegmentedControl:17,30,31,132`, `Select:14`, `Slider:9,32`, `Spinner:9`, `StatusDot:9,28`, `Surface:9`, `Swatch:9`, `Textarea:10,15`, `Toggle:9`, `Waveform:12`, `WaveformView:13` | They use `expect(el.className).toBe(...)`, so **adding** a class fails them. **Recommend converting the whole family to `toContain` in a single mechanical prep commit before any styling starts** |
| `Banner.test.tsx` | `:14, 17-18` | Test *name* says "hard menu shadow" and it asserts `oj-surface--elevation-menu`; both go stale with the Surface elevation rename |
| e2e `journeys/support.ts` | `:6` | `getByRole('button', { name: /play here in your browser/i })` — every journey + `pwa-smoke` + `arrangement-editing` boots through this. **The onboarding rewrite must either keep that accessible name on step 3, or all 12 specs get a new boot helper in the same PR** |
| e2e `pwa-smoke.spec.ts` | `:67, 156, 210, 241` | Same button |
| e2e `arrangement-editing.spec.ts` | `:6-7` | Same button + `/^Dismiss$/i` (the first-run toast) |

### 6.2 Design-sync / Ladle / Figma dependencies

- **`.github/workflows/code-connect.yml`** runs `bunx figma connect parse` on every PR touching
  `packages/oj-ui/src/components/**/*.figma.tsx`, and **fails on "could not be resolved"**. So
  removing a prop used in any of the 37 `.figma.tsx` examples (e.g. `Port`'s `direction`, or
  `Chip`'s `glyph`) is a **hard PR gate failure**, not a warning.
- **`figma.config.json`** hard-pins `packages/oj-ui/src/components/**`. Splitting a component into
  a subdirectory or renaming its folder silently drops it from Code Connect *and* from
  `component-map.json`.
- **`scripts/oj/design.ts`** derives `codePath` by `X.figma.tsx → X.tsx` string surgery and joins
  Ladle stories by **directory name**. Renaming `PortRow/` → anything silently drops the story
  link and quietly lowers `coverage.withStory`. It never reads any CSS, so class renames are safe
  there. **Neither `ladle build` nor `gen:component-map` runs in CI** — a stale
  `component-map.json` is not detectable by CI; it degrades at docs build time only.
- **`.ladle/components.tsx`** is eslint-ignored and untested, and it hardcodes
  `defaultValue: 'cream'` twice plus `var(--font-sketch)`, `var(--sketch-black)`,
  `var(--shadow-node)`, `var(--border-sketch-width)`. It will silently render unstyled chrome
  after the token retirement. **Add it to the atomic commit.**
- **`docs/design-figma-handoff.md`** is a prose contract committing to *69 Figma Variables, 3
  theme modes named Cream/Cyberpunk/Midnight, 53 components*, and to the binding rule
  "border → `border/sketch-width` + `color/sketch-black`". Every one of those goes stale. Nothing
  tests it. **"Docs are part of the feature" (code value #5) — update it in the same PR.**
- **`.design-sync/config.json`** `extraFonts` lists the two Caveat files and four Inter files.
- **`.impeccable/design.json`** embeds `'Caveat', cursive`, `#1A1A1A`, `#F5F0E8`,
  `box-shadow: 2px 3px 0 rgba(0,0,0,0.1)` and the "Caveat-Is-the-Voice Rule" as machine-readable
  data. It is what a design agent reads. **Regenerate it from the new DESIGN.md.**
- **`DESIGN.md` must be rewritten wholesale** — its front-matter is the machine-readable design
  system (colors, typography, components), and its §4 Elevation says in so many words *"A blurred
  shadow anywhere in this system is a bug"*, which the New DNA inverts. This is not an edit; it is
  a replacement.

### 6.3 The `contrast.test.ts` floors under the new palette

The test's five `it.each` floors, re-evaluated against §1.2's proposed values (light):

| fg | bg | floor | cream today | **new light** | Status |
|---|---|---:|---:|---:|---|
| `textSecondary` `#5A5850` | `timelineChromeBg` `#FAF9F6` | 4.5 | ok | **6.77** | PASS |
| `timelineClipBorder` `#C8C5BB` | `timelineClipBg` `#FFFFFF` | 3 | ok | **1.73** | **FAIL** |
| `timelineNoteFill` teal | `timelineClipBg` `#FFFFFF` | 3 | ok | **3.65** | PASS |
| `timelinePlayhead` `oklch(0.6 0.19 40)` | `timelineLaneBg` `#FFFFFF` | 3 | ok | **4.29** | PASS |
| `timelinePlayhead` | `timelineClipBg` `#FFFFFF` | 3 | ok | **4.29** | PASS |
| `timelineSelection` `oklch(0.66 .19 40)` | `timelineClipBg` | 2.9 | ok | **3.36** | PASS |
| `sketchBlack` | `timelineClipBg` | 3 | ok | — | **token retired — assertion must be re-pointed to `textPrimary` (17.05, passes)** |
| bar grid @24 % alpha | `timelineLaneBg` | 1.5 | ok | ~1.5 | **VERIFY** — recompute after the lane bg moves to `#FFFFFF` |

**`timelineClipBorder` is a genuine conflict.** A 1 px hairline at `--line2` cannot carry a 3:1
boundary. Two honest options: (a) set `timelineClipBorder` to `--text-muted` (`#6C695F`, 4.57:1 on
white) — a clip is a *content boundary*, not decorative chrome, and WCAG 1.4.11 applies; or
(b) keep the hairline and give clips a `--bg-tertiary` fill so the boundary is a fill delta rather
than a stroke. **(a) is the smaller change and the safer read on a projector.**

Also: the test must be rewritten to parse `oklch()` (its `hex()` helper slices `#RRGGBB` and will
silently produce `NaN`), and it should run over **both** themes — today it only checks cream, so
cyberpunk and midnight have never been contrast-tested. Retiring them removes an untested
liability; the replacement must not recreate it.

### 6.4 Accessibility — computed contrast for the New DNA palette

Resolved sRGB for the oklch tokens (D65): light `acc #EE5E23`, `acc2 #A670F3`, `ok #17A750`,
`warn #D59800`, `bad #DB2B33`, `audio #00959C`; dark `acc #FF723A`, `acc2 #B884FF`, `ok #37BB62`,
`warn #E9AB2B`, `bad #F84B4B`, `audio #00B4BC`.

**LIGHT — contrast ratio, foreground × background**

| fg | canvas `#F4F3F0` | surface `#FFF` | inset `#ECEAE4` | header `#FAF9F6` |
|---|---:|---:|---:|---:|
| `t1 #1D1C18` | 15.37 | 17.05 | 14.17 | 16.20 |
| `t2 #5A5850` | 6.42 | 7.13 | 5.92 | 6.77 |
| **`t3 #8F8C82`** | **3.03** | **3.36** | **2.80** | **3.20** |
| **`acc`** | **3.03** | **3.36** | **2.80** | **3.20** |
| **`acc2`** | **3.03** | **3.36** | **2.79** | **3.19** |
| **`ok`** | **2.82** | **3.13** | **2.60** | **2.97** |
| **`warn`** | **2.27** | **2.52** | **2.10** | **2.40** |
| `bad` | 4.29 | 4.76 | 3.96 | 4.52 |
| `audio` | 3.28 | 3.65 | 3.03 | 3.46 |
| `line2 #C8C5BB` | 1.56 | 1.73 | 1.44 | 1.64 |

`--on-acc #FFF` on `--acc` = **3.36** · on `--acc-hi` = 4.29 · `t1` on `--acc` = **5.07**

**DARK** — everything passes: `t1` 12.8–15.9, `t2` 6.2–7.7, `acc` 5.4–6.7, `acc2` 5.5–6.8,
`ok` 5.9–7.3, `warn` 7.3–9.0, `bad` 4.3–5.3, `audio` 5.8–7.2, `on-acc` on `acc` **6.26**.
Only `t3` (3.07–3.81) and `line2` (1.59–1.97) fall short.

**Failures and exact fixes (all preserve the designer's hue and chroma):**

| # | Failure | Where it bites | Fix |
|---|---|---|---|
| A | `--on-acc #FFF` on `--acc` = **3.36** (needs 4.5 for 14 px/600) | `.nj-btn.nj-primary`, `.nj-pad.hit` label, `.nj-play` icon, active `KeyTile`, selected step cells | **light `--text-on-accent: #1D1C18`** (→ 5.07:1). Dark already uses `#1D1C18` — this makes the token *consistent* across themes rather than inverted |
| B | `--t3 #8F8C82` = 2.80–3.36 (needs 4.5 for 9.5–12 px text) | **every port label**, node type chip, mono micro-labels, step-row names, `--text-muted` everywhere | **light `--text-muted: #6C695F`** (4.57:1 on inset, 5.5:1 on surface). **dark `--text-muted: #928E83`** (4.50:1 on inset, 5.59:1 on canvas) |
| C | `acc / acc2 / ok / warn / audio` as **text** = 2.10–3.36 | `.nj-chip.ok/.warn/.bad` (tones tint text only!), `.nj-callout b` (tinted title), tinted danger button label, `--audio` used as a label color | The `*-ink` token pair (§1.4). Light `-ink` lightness values that clear 4.5:1 on the tightest bg (`inset`): `ok 0.495`, `warn 0.525`, `bad 0.545`, `audio 0.495`, `acc 0.540`, `acc2 0.545`. Dark `-ink` = base |
| D | `--line2` as a **control boundary** = 1.44–1.97 (WCAG 1.4.11 needs 3:1) | the socket well's ring, the slider thumb's 1.5 px border, the pad border, the toggle track border, the input border | Non-text UI components need 3:1 **against adjacent colors**. Introduce `--border-control` (light `#969389` = 3.07:1 on white; dark ≈ `#6E6A5E`) used **only** on interactive boundaries, and keep `--line2` for decorative rules. Alternatively accept it and rely on the fill delta — **but the socket well has no fill delta at rest, so at least the socket ring must move to `--border-control`** |
| E | The **idle socket core dot** is `--line2` on `--inset` = 1.44 | a disconnected port is nearly invisible | Use `--text-muted` for the idle core (4.57:1) — it also makes "empty socket" read at a glance mid-performance, which is the actual product requirement |
| F | `warn` at **2.27** on canvas is the worst value in the palette | the honest-latency amber, `Callout` warning title, clipping chip | Covered by C, but call it out: **the honesty copy must never be the dimmest pixel** (the existing `global.css:257-261` comment makes exactly this argument for the welcome subline — keep that principle) |

**Reduced motion.** 36 CSS files contain `transition:`/`animation:`/`@keyframes` **without** a
`prefers-reduced-motion` block (22 in `src/`, 14 in `oj-ui`). The New DNA adds *more* motion
(spring transforms, hover lifts, press scales, the play-button attention pulse, staggered
onboarding entrances). Establish one rule in `global.css`:
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: .01ms !important; animation-iteration-count: 1 !important;
    transition-duration: .01ms !important; scroll-behavior: auto !important;
  }
}
```
and then delete the 10 bespoke per-file blocks that exist today. That is a net *removal* of code
and closes 36 gaps at once. **Exception to keep explicit:** the `Cable` signal-driven
width/opacity is not decoration — it is a meter. Exempt `.oj-cable` and `.oj-meter` from the
blanket rule; those must keep reporting.

**Other a11y items surfaced during the audit:**
- `SettingsPanel.tsx:69-92` theme cards are `<div onClick>` — no role, no `tabIndex`, no keyboard.
- The new `Knob` needs `role="slider"` + arrow-key stepping; the prototype has none.
- The onboarding number-key shortcuts (1/2/3) must not swallow keys while an `<input>` is focused
  — the prototype's handler checks `e.target.tagName !== 'INPUT'` only in some paths.
- `.oj-welcome`'s manual 2-element Tab loop (`App.tsx:592-608`) does not generalize to a 3-option
  step; use a real focus trap.

### 6.5 Windows-specific

- **`oklch()` and `color-mix(in oklab, …)` need Chromium ≥ 111.** The Tauri shell uses WebView2
  (evergreen, currently far past 111) and the browser tier targets modern Chrome/Edge/Safari
  16.4+. **But** `color-mix()` is already used in shipped CSS (`global.css:170`,
  `NodeCanvas.css:78`, `NodeShell.css:23`), so the floor is already established. `oklch()` is new;
  add a note to the browser-support doc and verify on the founder box.
- **`-webkit-font-smoothing: antialiased` is a no-op on Windows** (`global.css:112-113`). Outfit is
  a geometric sans with thin stems at 13 px; with ClearType and no sub-pixel control it can read
  lighter than the designer's mac render. **Check `--text-sm` (13 px) body and the 9.5 px mono
  micro-labels on the founder's Windows box before signing off** — this is exactly the kind of
  thing a taste-tier model or a human must judge, not a screenshot diff.
- **`backdrop-filter: blur(14px) saturate(1.1)`** on the onboarding scrim over a full-screen canvas
  is a heavy composite on integrated Windows GPUs. Measure; have a no-backdrop fallback (a solid
  `--overlay-scrim`) behind a media query or a capability check.
- **`::-webkit-scrollbar`** styling (`global.css:118-136`) works in WebView2 and Chrome; it does
  nothing in Firefox. If the browser tier claims Firefox support, add `scrollbar-color`.
- `filter: blur(5px)` on `.app.preview > *` promotes the whole studio to a composited layer.
  Cheap on discrete GPUs, not on integrated. See §5.4.
- The known `cpal` WASAPI device-change abort is **unrelated** to this work, but it means a
  device change during a retheme verification session can kill the native app — don't misread
  that crash as a redesign regression.

### 6.6 Other risks

- **`index.html` boot shell** (`:9-16, 30`) hardcodes the cream palette and Inter. A user whose
  saved theme is `dark` gets a cream flash on every cold start today, and will keep getting it
  after the retheme unless the boot shell reads `localStorage['openjammer-theme']` in an inline
  script before first paint. **Fix it in this migration** — it is the very first pixel of the
  product.
- **`.github/workflows/tokens.yml` auto-commits with `[skip ci]`**, so a bot-pushed token rebuild
  is never re-validated by the test job in the same run. Always commit `bun run tokens` output
  yourself.
- **`doctor --check test-collection`** enforces `COVERED_PREFIXES` — any new retheme test must live
  under `src/`, `packages/oj-ui/src/`, `scripts/oj/__tests__/`, `e2e/`, `e2e-native/`, or
  `pi-extensions/permission-gate/`, or CI fails it as "born dead".
- **Journeys run post-merge** (push to `canari` + nightly, 9 sharded jobs), not on PRs. Onboarding
  breakage will surface *after* merge unless a journey shard is added to the PR lane for this work.
- **No visual regression baseline exists.** There is nothing to update — and nothing to catch a
  silent visual break. Consider adding one Playwright `toHaveScreenshot` of the canvas + a node +
  the transport pill, in both themes, as the *last* increment (not the first — a baseline taken
  mid-migration is worse than none).

---

## 7. Recommended increment order

The constraint that sets the shape: **`tokenLiteralGate` gate 2 makes the token rename atomic**
(§6.1), and **the ~30 `toBe(className)` assertions make any added class a test failure** (§6.1).
So the first two increments are mechanical prep, and only then does parallel work open up.

### Serialized spine (shared files — one agent, one PR each)

**S0 — Prep: loosen the class assertions.** Convert every `expect(el.className).toBe(...)` in
`packages/oj-ui/src/components/*/*.test.tsx` to `toContain`, and add the missing
`prefers-reduced-motion` blanket rule to `global.css` while deleting the 10 bespoke ones.
*No visual change.* Files: 23 test files + `global.css`. **Unblocks everything.**

**S1 — Fonts.** `fonts.css` rewrite, `public/fonts` swap, `--font-sans` value → Outfit, mechanical
`--font-sketch` → `--font-sans` across all 62 files, delete `font.sketch` from
`primitive.json`, `bun run tokens`, `index.html` body font + preloads, `.design-sync/config.json`
`extraFonts`, delete `ArrangementSurface.test.tsx:56-58`. Also delete the two dead Google-Fonts
`runtimeCaching` rules in `vite.config.ts`. *This is a real visual change but a bounded one:
same layout, new face.* **Must be atomic** (gate 2).

**S2 — Tokens.** New `light.json` / `dark.json`, delete the three theme files, move
shadows/ring/scrim into the themes, add the new primitives and the `*-ink` pair, retire the 9
color keys + 5 primitives, update `types.ts`, `build.mjs` `THEMES`, `DEFAULT_THEME_ID`,
`$metadata.json`, `$themes.json`, `.ladle/components.tsx`, `envTools.test.ts`,
`ai/types.ts:347`, rewrite `contrast.test.ts` for oklch + both themes, `bun run tokens`,
mechanical `--sketch-*`/`--shadow-*`/`--border-sketch-width` rewrite across **all 46 app CSS +
38 oj-ui CSS files**. *This is the single biggest commit and it cannot be split* — gate 2 again.
Target: a visually coherent but un-refined app in the new palette. **Ship it green; do not chase
polish here.**

**S3 — NodeShell + Port/PortRow socket redesign + `portPositions.ts` fallback + the schematic
`_sockets.css` extraction.** Everything that touches the connection DOM lands together.
Files: `NodeShell.{tsx,css,test}`, `Port.{tsx,css,test}`, `PortRow.{css,test}`,
`utils/portPositions.ts`, `NodeCanvas.tsx:184-217`, `registry.ts` port positions,
`SchematicNodes.css` port sections, `BundlePortGroup.css`.

**S4 — App shell + onboarding + transport pill.** `App.tsx`, `global.css` `.oj-welcome` removal,
`Toolbar.{tsx,css}`, `SharedSurfaceChrome`, `HelpPanel`, `index.html` boot shell, new
`TransportPill`/`Meter`, `SettingsPanel` theme picker, the preset-rig builder, **and the e2e boot
helper** (`e2e/journeys/support.ts` + the 3 PR-lane specs) in the same PR.

**S5 — `DESIGN.md` rewrite + `docs/design-figma-handoff.md` + `.impeccable/design.json` +
`component-map.json` regen + a visual-regression baseline.** Docs are part of the feature.

### Parallel lanes (disjoint file sets — safe to run concurrently AFTER S2)

| Lane | Files (disjoint) | Nature |
|---|---|---|
| **P1 — oj-ui controls** | `Button`, `IconButton`, `Slider`, `Toggle`, `SegmentedControl`, `Input`, `Select`, `Textarea`, `Field`, `ValueScrubber`, `+ new Knob` | RESTYLE + the Knob build |
| **P2 — oj-ui surfaces & feedback** | `Surface`, `Modal`, `Menu`, `Callout`, `Banner`, `Chip`, `StatusDot`, `Kbd`, `Spinner`, `ProgressBar`, `PanelHeader`, `ListRow`, `CodeBlock`, `Swatch` | RESTYLE (+ the `SurfaceElevation` rename, which P1 does not touch) |
| **P3 — oj-ui canvas & media** | `Cable`, `KeyTile`, `Waveform`, `WaveformView`, `WaveformCanvas`, `Marquee`, `OffscreenPointer`, `TimeRuler`, `LaneButton`, `DeviceSelect`, `EditableLabel`, `ParamRow`, `+ new Meter` | RESTYLE. **Depends on S3** for KeyTile's `__port` |
| **P4 — Timeline** | `Arrangement/*.css`, `PianoRoll.css`, `Clips/*.css`, `TimeRuler` consumers | REDESIGN. **Owns the `tokenLiteralGate` scope — must not be split across PRs** |
| **P5 — Command bar** | `CommandBar.css` (1127 lines) + `AiPanel` | REDESIGN |
| **P6 — Node faceplates A** | `SchematicNodes.css` Speaker / Microphone / Math / CanvasIO / Container sections, `SongNode.css`, `MIDINode.css` | REDESIGN + file split |
| **P7 — Node faceplates B** | `SchematicNodes.css` Looper / Sampler / Library sections, `SamplerVisual.css` | REDESIGN + file split |
| **P8 — Node faceplates C** | `SchematicNodes.css` Keyboard / KeyboardVisual / Instrument sections, `InstrumentVisualNode.css`, `MIDIVisualNode.css`, `MiniLab3Visual.css` (102 literals) | REDESIGN + literal cleanup |
| **P9 — Panels** | `Settings/*.css` (4 files), `Guides/Guide.css`, `DevLogPanel.css`, `Plugins*.css`, `Export`, `Dialogs`, `MIDI/*`, `Collab/*`, `AudioHealth`, `IssueReporter`, `common/*` | RETHEME (mostly mechanical; 25 literals in `CollabControl.css` need a pass) |

**Serialization hazards to respect:** P6/P7/P8 all edit `SchematicNodes.css` — they are only
parallel *after* S3 splits it into per-family files. Until then, treat them as one lane.
`global.css` is touched by S0, S1, S2 and S4 — never assign it to a parallel lane.

**Per the delegation contract in `agents.md`:** P4–P9 are bounded mechanical work well suited to
`gpt-5.6-sol` with the exact token map from §1 handed to it. P1–P3 and S3–S4 are perception-facing
(controls under a performer's fingers, the socket the cable plugs into, the transport) — those get
a taste-tier model, and **nothing ships without a founder listening to it with audio playing**.
codex never signs off on feel.

---

## 8. What this audit could NOT verify

1. **Anything requiring the app to run.** No dev server was started, no audio played, no
   screenshots taken. Every claim about visual behaviour is read from CSS/TSX, not observed.
2. **Whether `filter: blur(5px)` on the studio and `backdrop-filter` on the scrim hold 60 fps** on
   the founder's Windows box, and whether Outfit at 13 px / 9.5 px reads correctly under ClearType.
3. **Whether the master-out RMS the Speaker node meters is exposed in a form the transport pill
   can subscribe to.** The comment at `SchematicNodes.css:118` says it reads the engine; the store
   selector was not traced end-to-end.
4. **The `timelineGridBar` 1.5:1 floor** under the new lane background — the alpha needs
   recomputing once `timelineLaneBg` moves to `#FFFFFF`; I computed the palette contrast but not
   that specific composite.
5. **The exact per-node port `position: {x, y}` literals** in `registry.ts` that need the in-body
   inset. I confirmed the pattern (`x: 0` / `x: 1`) and the affected node types but did not
   enumerate every port on every node.
6. **Whether `BaseNode.css` and `Toolbar/DropdownMenu.css` are truly dead.** Both are still
   imported; the "DELETE candidate" verdict is a recommendation to verify the last emitter, not a
   verified finding.
7. **The dead-CSS counts in §4.1** come from a substring match against all `.ts`/`.tsx`
   identifiers. It under-reports (never over-reports), so each hit is a candidate needing a
   human/agent check, not a confirmed deletion.
8. **`oklch()` support in the exact WebView2 build on the founder's machine.** The floor is
   almost certainly met (`color-mix()` already ships) but it was not measured.
9. **Whether the "sound design" rig has a faithful node mapping.** There is no oscillator or
   filter node type in `registry.ts`; §5.6 flags this as an owner decision.
