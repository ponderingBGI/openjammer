# @openjammer/oj-tokens

The **single source of truth** for OpenJammer's design tokens and theme system.
Tokens are authored as [DTCG](https://tr.designtokens.org/) JSON and compiled by
[Style Dictionary](https://styledictionary.com/) into the artifacts the app
consumes. This package replaces the old hand-maintained `src/styles/themes.ts` +
`src/styles/variables.css` (one source instead of three drifting copies).

## Token tiers

1. **Primitive** (`tokens/primitive.json`) — theme-invariant scales: spacing,
   radius, type sizes, font families, and motion. These
   compile to `:root` CSS custom properties.
2. **Theme** (`tokens/themes/<id>.json`) — the Light and Dark value sets. Each theme
   provides the **semantic** contract: colors plus theme-sensitive shadows, focus,
   and overlay values. A theme is just a
   swappable set of these values — built-in themes and any user skin are the same
   shape.

> The semantic layer **is** the existing CSS variable names the whole app already
> uses (e.g. `--bg-canvas`, `--accent-primary`). Components never name a literal
> color — they read these vars, so swapping a theme restyles everything.

## Outputs (generated — do not edit)

`bun run tokens` (from the repo root) regenerates:

- `dist/variables.css` — primitives on `:root`. Imported by `src/main.tsx`.
- `src/generated/themes.ts` — the typed `Theme[]` registry used by the runtime
  engine (`applyTheme`, `getThemeById`, `getSavedThemeId`, `saveThemeId`).

The build also emits `../oj-ui/oj-tokens.css`, a static Light snapshot for design
previews. Output is deterministic (no timestamps), so all three artifacts are committed.

## Consuming it

```ts
import { themes, applyTheme, getThemeById, getSavedThemeId, saveThemeId } from '@openjammer/oj-tokens';
```

The app applies a theme at boot and on user/AI change by writing the semantic
custom properties onto `:root` (pure DOM style writes — never the audio path).

## Adding to the system

- **A primitive / scale value** → edit `tokens/primitive.json`, run `bun run tokens`.
- **A theme** → add `tokens/themes/<id>.json` (mirror an existing file's `color`
  group) and register its `{ id, name }` in `build.mjs`'s `THEMES` list.
- **A semantic color token** → add the key to every `tokens/themes/*.json` and to
  the `ThemeValues` interface in `src/types.ts`.

Then `bun run tokens` and commit the regenerated outputs.
