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
**Regenerate after `bun run tokens` (or any theme/token edit)** with the generator below, else
the synced cards drift from the app's look:

```python
# run from repo root; rewrites packages/oj-ui/oj-tokens.css from the cream theme
import re
prims=open("packages/oj-tokens/dist/variables.css").read()
ts=open("packages/oj-tokens/src/generated/themes.ts").read()
body=re.search(r'"id":\s*"cream".*?"colors":\s*\{(.*?)\}\s*\}', ts, re.S).group(1)
pairs=re.findall(r'"(\w+)":\s*"([^"]+)"', body)
kebab=lambda s: re.sub(r'([a-z0-9])([A-Z])', r'\1-\2', s).lower()
root=":root {\n"+"\n".join(f"    --{kebab(k)}: {v};" for k,v in pairs)+"\n}\n"
open("packages/oj-ui/oj-tokens.css","w").write(prims.rstrip()+"\n\n/* cream theme semantic colors (static snapshot for design-sync) */\n"+root)
```

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
- All 53 components render clean (0 bad/thin); 117 cells graded good.

## Re-sync risks (watch-list)
- **oj-tokens.css is a manual cream snapshot** — it does NOT auto-update when the DTCG tokens
  change; re-run the generator above before a re-sync or the cards lag the app's look. (Only the
  *default* theme is captured; other themes aren't synced — by design, claude.ai/design renders
  one theme.)
- **fonts.css is hand-maintained** (relative-URL twin of the app's font faces) — keep it in step
  if font families change.
- **DesignSync `localDir` gotcha**: the tool resolves relative paths against the persisted shell
  cwd. A prior `cd ds-bundle` doubled the path — pass an **absolute** `localDir`
  (`/home/wsl/projects/openjammer/ds-bundle`), or `cd` back to repo root first.
- Previews were ported from the Ladle stories (`packages/oj-ui/src/components/*/*.stories.tsx`)
  + hand-authored for gaps (Port/NodeShell/Field/Input/Select/List/Tabs/Menu-items/icons). If a
  story's API changes, re-port that preview.
