# @openjammer/oj-tokens

The **single source of truth** for OpenJammer's design tokens and theme system.
Tokens are authored as [DTCG](https://tr.designtokens.org/) JSON and compiled by
[Style Dictionary](https://styledictionary.com/) into the artifacts the app
consumes. This package replaces the old hand-maintained `src/styles/themes.ts` +
`src/styles/variables.css` (one source instead of three drifting copies).

What the values *mean* — the New DNA, its named rules and its measured
accessibility floors — is [`DESIGN.md`](../../DESIGN.md).

## Two themes, no more

`light` (default) and `dark`. That is the whole list, and it is deliberate: the
three sketchbook themes (`cream`, `cyberpunk`, `midnight`) were retired with the
New DNA rather than left as a parallel path. Both themes declare **exactly the
same 53 keys** — a test asserts key-set parity — so a theme is a pure value swap
and a user skin is the same shape as a built-in.

## Token tiers

1. **Primitive** (`tokens/primitive.json`) — **37** theme-invariant tokens that
   compile to `:root`. Groups:

   | Group | Tokens |
   |---|---|
   | `space` | xs 4 · sm 8 · md 16 · lg 24 · xl 32 |
   | `radius` | sm 6 · md 10 · lg 14 · xl 20 · pill 99 |
   | `text` | micro 9.5 · xs 11 · sm 13 · md 14 · lg 15 · xl 22 · 2xl 30 |
   | `font` | `sans` = Outfit · `mono` = JetBrains Mono |
   | `motion` | `fast` 120ms cubic-bezier(.2,.8,.3,1) · `spring` 260ms cubic-bezier(.34,1.56,.64,1) |
   | `transition` | `normal` 250ms · `slow` 0.4s (legacy easing still in use) |
   | geometry | `node.min-width` 190 · `port.size` 18 · `knob-size` 52 · `key-tile-size` 48 |
   | feel | `press-scale-btn` .96 · `press-scale-pad` .94 · `hover-lift` −2px · `tracking.micro` .08em |
   | `z` | node 10 · panel 100 · popover 1000 · modal 2000 · toast 3000 · top 10000 |

2. **Theme** (`tokens/themes/<id>.json`) — the **53** semantic values per theme.
   Groups: surfaces (`bg*`), text (`text*` incl. `textOnAccent`), lines
   (`borderSubtle` / `borderStrong` / `borderControl`), accents and states
   (`accent*`), the tinted-text **ink pair** (`accentInk`, `successInk`,
   `warningInk`, `dangerInk`, `audioInk`), wiring (`audio*`, `control*`,
   `universal*`), the whole `timeline*` set, and the theme-sensitive depth roles
   (`shadowRaised`, `shadowOverlay`, `shadowInset`, `shadowPressed`, `focusRing`,
   `overlayScrim`).

> The semantic layer **is** the existing CSS variable names the whole app already
> uses (e.g. `--bg-canvas`, `--accent-primary`). Components never name a literal
> color — they read these vars, so swapping a theme restyles everything.

## The naming rules

- **No digits in a key.** The build's `camelToKebab` only inserts a hyphen
  *before an uppercase letter*, so `shadow1` would emit `--shadow1`, not
  `--shadow-1`. This is why depth is `shadowRaised` / `shadowOverlay` /
  `shadowInset` / `shadowPressed` and not `sh1` / `sh2`. A test asserts that no
  key in either theme contains a digit.
- **`camelCase` in, `--kebab-case` out.** `bgNodeHeader` → `--bg-node-header`.
- **Role names, never appearance names.** `accentDanger`, not `red`;
  `borderControl`, not `grey40`.
- **Keep the name, change the value.** Adding a parallel `--acc` alongside
  `--accent-primary` is the one thing this package exists to prevent.

## Outputs (generated — do not edit)

`bun run tokens` (from the repo root) regenerates:

- `dist/variables.css` — the 37 primitives on `:root`. Imported by `src/main.tsx`.
- `src/generated/themes.ts` — the typed `Theme[]` registry used by the runtime
  engine (`applyTheme`, `getThemeById`, `getSavedThemeId`, `saveThemeId`).
- `../oj-ui/oj-tokens.css` — a static **Light** snapshot for design previews
  (Ladle, `.design-sync`, Figma reference cards).

Output is deterministic (no timestamps) and idempotent, so all three artifacts
are committed. In practice `tokens.yml` re-runs the build and commits the
artifacts on any token PR — you rarely run it by hand.

## Consuming it

```ts
import { themes, applyTheme, getThemeById, getSavedThemeId, saveThemeId } from '@openjammer/oj-tokens';
```

The app applies a theme at boot and on user/AI change by writing the semantic
custom properties onto `:root` (pure DOM style writes — never the audio path).
`index.html`'s boot shell reads the saved theme inline so a dark start never
flashes light.

## Adding to the system

- **A primitive / scale value** → edit `tokens/primitive.json`, run `bun run tokens`.
- **A semantic color token** → add the key to **both** `tokens/themes/*.json`
  and to the `ThemeValues` interface in `src/types.ts` (parity is asserted).
- **A theme** → add `tokens/themes/<id>.json` (mirror an existing file's `color`
  group), register its `{ id, name }` in `build.mjs`'s `THEMES` list, and add it
  to `$metadata.json` / `$themes.json` so the Tokens Studio → Figma leg picks it up.

Then `bun run tokens` and commit the regenerated outputs. Any new colour pair has
to clear the floors in `src/components/Arrangement/__tests__/contrast.test.ts`
(body text ≥4.5:1, non-text boundaries ≥3:1, both themes) — the test reads these
DTCG files directly, so a bad value fails CI before it reaches a stage.
