# @openjammer/oj-ui

OpenJammer's **presentational component library** — the minimal, theme-agnostic
React primitives the app composes with. This is the "infinite edges, minimal
core" boundary in practice: components here are *dumb* (props in, events out)
and carry no app state.

## The one rule

**Components read only the semantic design-token CSS variables** (`--bg-node`,
`--text-primary`, `--accent-primary`, `--port-size`, …) defined by
[`@openjammer/oj-tokens`](../oj-tokens). They never name a literal color or a
raw pixel value, and they never import from the app's `store/`, `audio/`,
`engine/`, or `hooks/`. That is what lets one component restyle across every
theme and render identically in the app, in Ladle, and in Figma.

## Consuming it

```tsx
import { Button } from '@openjammer/oj-ui';

<Button variant="primary" onClick={play}>Play</Button>
```

Co-located CSS is imported by each component for its side effect; the bundler
(and Ladle) injects it. Resolved via the `@openjammer/oj-ui` alias in
`vite.config.ts`, `tsconfig.app.json`, and `vitest.config.ts` — raw source, no
build step (same pattern as `@openjammer/oj-protocol` / `@openjammer/oj-tokens`).

## Structure

```
src/
  index.ts                       barrel (public API)
  components/<Name>/<Name>.tsx    one component per folder
  components/<Name>/<Name>.css    its semantic-var styles
```

## Status

Phase 1 in progress — primitives are being authored/extracted (Button first).
The app is migrated onto them in Phase 2.
