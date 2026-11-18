# Wave 3 P2 — oj-ui Surfaces & Feedback

Date: 2026-08-29  
Lane: W3-P2  
Scope: `Surface`, `Modal`, `Menu` family, `Callout`, `Banner`, `Chip`, `StatusDot`, `Kbd`, `Spinner`, `ProgressBar`, `PanelHeader`, `List`/`ListRow`, `CodeBlock`, `Swatch`

## Outcome

The 15 owned component families now recreate the New DNA surface/feedback language in the existing `.oj-*` DOM contracts. The implementation keeps app-facing compatibility, uses only live semantic tokens, preserves keyboard/focus behavior, and has light/dark Ladle evidence for every owned story.

The visual pass used one headless Chromium driven by `node` against Ladle on port `61004`. Outfit loaded successfully (`document.fonts.check('600 14px Outfit') === true`), all 70 required story/theme captures completed, zero browser console/page errors were recorded, and the server was stopped after capture.

## Component evidence

All screenshot paths below are under `plans/redesign-new-dna/.scratch/w3-p2/`.

| Component | Change and API compatibility | Tests | Screenshots | Rendered contrast (light / dark) |
|---|---|---:|---|---:|
| Surface | `--bg-node`, subtle hairline, `raised`/`overlay` shadows, md/lg/xl radii. `SurfaceElevation` adds the new names; deprecated `rest`→`raised`, `menu`→`overlay`, `lifted`→`raised` remain accepted and emit only new classes. Default is now `raised`. | 5 | `surface--{elevations,radii}--{light,dark}.png` | 17.05 / 14.36 (primary text on surface) |
| Modal | Overlay Surface with xl radius; guarded 14px blur+saturation scrim; 260ms rise/fade; reduced-motion/transparency removes animation and backdrop. Portal, focus trap, focus restore, Escape, scrim close, role and sizing are unchanged. | 9 | `modal--{default,alignments,sizes,scrim-locked}--{light,dark}.png` | Scrim luminance 0.323→0.080 in dark; body uses primary text |
| Menu family | 12px overlay panel, 6px inset, 14px/500 rows, 8px hover rows, mono `Kbd` shortcuts, 10.5px category labels, hairline separators, 45% disabled state, matching submenu. Added optional `MenuItem.danger?: boolean`; existing keyboard navigation and activation remain. | 14 | `menu--{dropdown,context-menu}--{light,dark}.png` | 6.72 / 6.39 |
| Callout | Now composes raised Surface; 12px radius, 12×14 padding, no side bar. Variant colors only title/icon via contrast-safe ink tokens; body remains secondary. No API change. | 6 | `callout--{variants,title-and-icon-optional}--{light,dark}.png` | 6.14 / 6.39 minimum title |
| Banner | Raised Surface with the same no-stripe construction; tone colors title/icon only; actions remain caller-composed Buttons. No API change. | 7 | `banner--{tones,with-actions,title-only}--{light,dark}.png` | 6.14 / 6.39 minimum title |
| Chip | 12px/600 pill, 4×10 padding, neutral border/background, text-only state inks, mono count, pressed node surface + raised shadow. `glyph` remains accepted; dot strings and direct `StatusDot` elements are deprecated/no-op, while non-dot React nodes still render. | 8 | `chip--{tones,with-glyph-and-count,filter-chips}--{light,dark}.png` | 5.11 / 5.70 minimum |
| StatusDot | True 8px borderless graphic; semantic base fills; no pulse. API unchanged. | 5 | `status-dot--statuses--{light,dark}.png` | N/A — labelled graphic, not text |
| Kbd | 11px/500 mono, muted ink, inset fill, subtle border, 5px radius, 2×5 padding; custom uses `--accent-ink`. API unchanged. | 5 | `kbd--{variants,in-context}--{light,dark}.png` | 4.57 / 4.50 |
| Spinner | Existing numeric size API retained; subtle ring + accent arc; retired transition token removed; reduced-motion remains a meaningful static arc. | 4 | `spinner--{sizes,inline}--{light,dark}.png` | N/A — progress graphic |
| ProgressBar | 6px pill track and semantic fill. Added `indeterminate?: boolean`; `value` is optional only to permit that state. Indeterminate omits `aria-valuenow`, slides a 30% segment, and becomes a static 100%/40%-opacity segment under reduced motion. | 10 | `progress-bar--{tones,levels,indeterminate}--{light,dark}.png` | N/A — progress graphic |
| PanelHeader | 22px/600 title, 13px subtitle, subtle rule. Both back and close are committed IconButtons; `backLabel` remains the accessible name. Arbitrary badge content remains accepted, so existing Chip and compound consumers compile. | 10 | `panel-header--{default,with-subtitle,with-badge,with-back,with-actions,everything}--{light,dark}.png` | 17.05 / 14.36 title |
| List / ListRow | 14px/500 rows, 8px radius, tertiary hover/selection, accent-ink selected text, 1.5px focus-visible outline, 45% disabled. `current` uses a 6px accent dot before the label—no side stripe. API unchanged. | 7 | `list-row--{states,with-actions}--{light,dark}.png` | 5.34 / 5.96 minimum |
| CodeBlock | Inset surface, subtle hairline, sm radius, 12px mono primary text. Existing selection/max-height behavior is unchanged; there was no copy affordance to preserve. | 6 | `code-block--variants--{light,dark}.png` | 14.17 / 12.81 |
| Swatch | Strong hairline, md radius, 13px/500 name, 1.5px selected accent border + shared focus ring; native button/radiogroup keyboard behavior remains. Stories now show only the live Light/Dark themes. | 6 | `swatch--{gallery,states}--{light,dark}.png` | 17.05 / 14.36 name |

Owned tests: 102 tests across 15 component suites. Package gate: 311 tests across 39 files.

## Visual comparison and measurements

- Compared captures against the handoff’s “Menu” and “Status & messages” rows. The menu panel, category rhythm, keycaps, chip scale, and callout/banner construction match the approved compact Outfit treatment.
- Initial `PanelHeader/Everything` evidence exposed wrapping caused by the story’s stale 190px `max-width`; the story frame was corrected to 480px and recaptured in both themes. The component stayed responsive.
- Minimum required measured contrast is at least 4.5:1 in both themes:
  - menu item: 6.72 / 6.39
  - chip: 5.11 / 5.70
  - callout title: 6.14 / 6.39
  - kbd: 4.57 / 4.50
- Dark modal scrim demonstrably darkens underlying button luminance from 0.323 to 0.080 and applies the supported backdrop blur.
- Full measurement data: `plans/redesign-new-dna/.scratch/w3-p2/visual-results.json`.

## Verification

```text
bun run test:run -- packages/oj-ui
PASS — 39 files, 311 tests

bunx tsc --noEmit -p tsconfig.app.json
PASS

bunx eslint packages
PASS

bun run build
PASS — tsc -b + Vite production build + PWA generation

bunx figma connect parse
PASS
```

Visual harness:

```text
bun ladle serve --port 61004 --viteConfig plans/redesign-new-dna/.scratch/w3-p2/vite.config.ts
node plans/redesign-new-dna/.scratch/w3-p2/visual-check.cjs
PASS — one Chromium, 70 required captures, Outfit loaded, zero console/page errors
Ladle port 61004 stopped after verification
```

## Deviations and intentional compatibility choices

- The stale repository `DESIGN.md`/Impeccable detector flags literal 12px menu/callout/banner radii, 8px menu-item radii, the 5px keycap radius, and the binding spring curve. These are intentional false positives: the user brief, handoff `new-dna.css`, and binding master plan explicitly require those exact values and state that `DESIGN.md` is stale. No detector configuration was changed outside lane ownership.
- Legacy Surface elevation values remain in the public union as deprecated aliases instead of being removed. This is the requested fail-safe migration and keeps current app callers compiling while rendered classes are fully migrated.
- Chip dot glyphs are suppressed narrowly (known dot strings and direct `StatusDot` elements). Non-dot glyph consumers such as the existing bolt icon keep working.
- `ListRow.current` uses the allowed 6px accent dot rather than bold-only treatment because it distinguishes “current” from “selected” without changing text metrics or adding a side stripe.
- Menu typeahead was not added because the existing menu had none; roving arrow/Home/End/Escape behavior remains unchanged.
- A scratch-local Vite config gives this lane an isolated optimize-dependency cache. It avoided disturbing concurrent agents after the shared Vite cache returned `504 Outdated Optimize Dep`; production configuration is untouched.

## Unverified

- `prefers-reduced-transparency` cannot currently be emulated by Playwright Chromium. Its CSS branch is present and parse/build verified; `prefers-reduced-motion` fallbacks are also present, but the screenshots are standard-motion captures.
- No human audio-playing or stage-feel pass was performed. This lane changes presentational oj-ui surfaces only and does not touch the audio path.
