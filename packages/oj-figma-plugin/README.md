# oj-ui Figma plugin — "stamp code links"

The **free-tier substitute for Code Connect**. Code Connect (real code snippets in Figma's Dev
Mode) requires a Figma Organization/Enterprise plan; on Professional/Education it is unavailable.
This plugin instead writes, onto every component master, what a designer or AI needs **without Dev
Mode**: the import line, deep links to the source + the live component on Claude Design, and the
Ladle story id — visible in the **Assets panel** and the component's **documentation link**.

It is driven entirely by the repo-root **`component-map.json`** (the same single source the docs
"Find the code" index uses), bundled into the plugin at build time. There is no second mapping to
maintain.

## Use

```bash
bun run gen:component-map          # (repo root) refresh component-map.json
bun run --filter @openjammer/oj-figma-plugin build   # or: cd packages/oj-figma-plugin && bun run build
```

Then in **Figma desktop** (on the oj-ui library file): Plugins → Development → **Import plugin from
manifest…** → pick `packages/oj-figma-plugin/manifest.json` → run it. It stamps every mapped
component master and reports how many it updated. Re-run after regenerating the map.

## Why it's manual

Figma exposes **no API** to publish a library or to run a plugin headlessly/in CI — both are
desktop-app actions. So this is a deliberate, idempotent maintainer step, not a CI job. The
drift-free authority remains the generated docs index; these Figma stamps are a best-effort
in-Figma convenience.

## Upgrade path

When OpenJammer is on a Figma Organization/Enterprise plan, real **Code Connect** turns on (add the
`FIGMA_ACCESS_TOKEN` secret + publish the library; `code-connect.yml` publishes the committed
`.figma.tsx` mappings unchanged). This plugin can keep running alongside — or be retired — with zero
impact on the rest of the system.
