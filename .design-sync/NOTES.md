# design-sync notes — @openjammer/oj-ui

Package shape (Ladle, **not** Storybook). Project: **OpenJammer Design System**
(`53cf9a90-d179-4e3f-8413-58b270fff363`), pinned in config.json.

## How the build runs
- oj-ui is a **raw-source workspace package** — no `dist`, no build script. The converter
  bundles the TS barrel directly: `--entry ./packages/oj-ui/src/index.ts`.
- `--node-modules ./node_modules` (repo root — that's where `react` resolves; oj-ui has no
  own node_modules).
- Re-sync driver (from repo root):
  `node .ds-sync/resync.mjs --config .design-sync/config.json --node-modules ./node_modules --entry ./packages/oj-ui/src/index.ts --out ./ds-bundle --remote .design-sync/.cache/remote-sync.json`
  (fetch the project's `_ds_sync.json` into that cache path first). First sync omitted `--remote`.
- Playwright: chromium **1228** is cached and matches the repo's `@playwright/test` 1.61.0;
  the render check resolves playwright from the repo-root node_modules. No extra install needed.

## Styling — the one non-obvious thing
oj-ui's **semantic color tokens are applied at runtime** by `applyTheme` (oj-tokens) and live
in **no static CSS**. `packages/oj-ui/oj-tokens.css` is a generated **static snapshot of the
default "cream" theme** (oj-tokens primitives from `dist/variables.css` + the cream semantic
colors as a `:root` block). It's wired via `cfg.cssEntry` (PKG_DIR-bounded), which appends it
to `_ds_bundle.css` so the `styles.css` closure defines every `--token` the components read.
**It is now emitted automatically by `bun run tokens`** (packages/oj-tokens/build.mjs step 3,
alongside variables.css + themes.ts) — no manual step, and the CI drift guard catches a stale
snapshot. Re-run `/design-sync` after a token change so claude.ai/design gets the new values.

## Fonts
`.design-sync/fonts.css` re-declares the 8 self-hosted woff2 with **relative `./` URLs** (the
app's `src/styles/fonts.css` uses absolute `/fonts/` URLs that don't resolve in the design
tool's serving root). `cfg.extraFonts` ships that css + the 8 woff2 from `public/fonts/`. If
oj-ui adds a brand font family, add its woff2 to `public/fonts/`, a `@font-face` to
`.design-sync/fonts.css`, and the woff2 path to `cfg.extraFonts`.

## Known / accepted render warns
- `[FONT_MISSING]` "Comic Sans MS" / "Fira Code": these are **fallback names** in the
  `--font-sketch` / `--font-mono` stacks, not shipped faces — the design tool falls back to a
  system font, which is correct. Not a defect; do not chase.
- `[GRID_OVERFLOW]` (converter check added after the first sync): Banner, Cable, Marquee,
  NodeShell and Waveform render wider than a grid cell. **Resolved** with
  `cfg.overrides.<Name>.cardMode: "column"` — one export per row at full card width. If a new
  wide component flags it, apply the same override rather than shrinking the preview.
- All 57 components render clean (0 bad / 0 thin / 0 variantsIdentical); every authored cell
  graded good.

## Re-sync risks (watch-list)
- **oj-tokens.css is auto-generated** by `bun run tokens` (build.mjs step 3) — just run it before
  a re-sync (the CI drift guard enforces it). Only the *default* (cream) theme is snapshotted —
  other themes aren't synced, by design: claude.ai/design renders one theme.
- **fonts.css is hand-maintained** (relative-URL twin of the app's font faces) — keep it in step
  if font families change.
- **DesignSync `localDir` gotcha**: the tool resolves relative paths against the persisted shell
  cwd. A prior `cd ds-bundle` doubled the path — pass an **absolute** `localDir`
  (`<repo-root>/ds-bundle` — the absolute path differs per clone/worktree), or `cd` back to
  repo root first.
- **`Port` universal is an animated rainbow gradient** (`Port.css` `@keyframes oj-port-rainbow`,
  3s loop) — its screenshot lands on whatever gradient phase the capture caught, so a cleared
  Port grade on an otherwise unchanged re-sync is animation phase, not a real diff. Re-confirm
  the sheet and move on.
- **`TimeRuler` marks hang below the ruler box.** `.oj-time-ruler__mark` is `bottom: 3px` on a
  6px-tall span, so a 14px bar label overflows ~5px past the container. Its preview wrapper
  gives 8px of bottom padding and does NOT set `overflow: hidden` — a clipping wrapper cuts the
  bar numbers in half. (The app's own `.arrangement-ruler-viewport` clips them the same way;
  that's an app-side observation, not a sync problem.)
- **`cfg.dtsPropsFor.TimeRuler`** is hand-written: the extracted `.d.ts` referenced a bare
  `TimeRulerMark[]` that it never defined, leaving the design agent without the mark shape. If
  `TimeRulerMark` changes in source, update that config entry to match.
- Previews were ported from the Ladle stories (`packages/oj-ui/src/components/*/*.stories.tsx`)
  + hand-authored for gaps (Port/NodeShell/Field/Input/Select/List/Tabs/Menu-items/icons). If a
  story's API changes, re-port that preview.

## Conventions header — drift fixed 2026-08-20
`.design-sync/conventions.md` is validated against the fresh build on every re-sync. This run
corrected two claims that no longer verified, plus one gap:
- `Callout` takes **`variant`** (success｜danger｜warning｜info｜tip), not `tone` — only `Banner`
  has `tone`. The old text said "`Callout`/`Banner` `tone`", which would have had the design
  agent writing a prop that does nothing.
- Universal ports render the **rainbow-until-typed gradient**, not solid violet. `--universal-port`
  (#9B59B6) is defined in the tokens but no component consumes it (see
  `docs/node-migration-plan.md` — the violet-vs-rainbow decision is still open with the design
  owner). If that decision lands, re-check this line.
- Added the `--timeline-*` token family, now that the timeline components ship.

## Timeline components (added this sync)
`LaneButton`, `ParamRow`, `TimeRuler`, `WaveformCanvas` arrived with the Tab-timeline work.
Previews are authored in `.design-sync/previews/`; `LaneButton`/`TimeRuler`/`WaveformCanvas`
were ported from their Ladle stories and then composed further (a lane-header strip, a chrome
strip with height, clip frames), `ParamRow` has no story and was composed from its props plus
`src/components/params/AutoParamPanel.tsx`. `ParamRow.control` has **no repo usage** — its
preview cell composes `SegmentedControl` from the API alone.
