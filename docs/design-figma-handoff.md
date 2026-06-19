# OpenJammer × Figma — handoff & 3-way sync

How code, **claude.ai/design**, and **Figma** stay in sync, and exactly what the designer
does on day one. Written for the kickoff next week.

## First: "FigJam" vs a Figma design file

**FigJam is a whiteboard** (sticky notes, diagrams, brainstorming) — components, variables,
and a library **cannot** live there. A component library lives in a **Figma _design_ file**
published as a **Team Library**.

So when the designer said "create a Figma jam," it's one of two things — **confirm which**:
- A **planning/kickoff jam** = a working session, optionally on a FigJam board. Fine to have one
  for planning; just not where the components live. (Say the word and I'll create a FigJam board too.)
- They meant a **design file**. That already exists: **OpenJammer oj-ui Library** →
  https://www.figma.com/design/ayHEMsJL1BPhvTYWi1CFJs — this is where the library is being built.

## The 3-way sync model (it's not a triangle of equals)

There is **one source of truth per concern**, fanned out to the three surfaces:

### Tokens → one source: the repo's DTCG files (`packages/oj-tokens/tokens/`)
- **→ code**: Style Dictionary (`bun run tokens`) → `dist/variables.css` + `themes.ts`.
- **→ claude.ai/design**: the design-sync (a static cream snapshot ships in the bundle).
- **→ Figma**: **Tokens Studio** plugin Git-syncs those exact DTCG files ↔ **Figma Variables**
  (two-way). This is the genuinely bidirectional leg — a designer can tweak a token in Figma,
  push, and it lands as a commit that rebuilds code + the sync.
- *(Already seeded:* I built the Figma Variables directly — 2 collections, 69 variables, 3 theme
  modes. Tokens Studio then maintains them in step with the repo going forward.)*

### Components → one source: the code (`packages/oj-ui`)
- **→ claude.ai/design**: done — 53 components synced, live + browsable.
- **→ Figma**: the **designer builds the Figma components** (the visual masters), using the
  claude.ai/design previews + the variables as reference. There is **no reliable automatic
  code→Figma component generation** — Figma components are design artifacts. (A plugin like
  *html.to.design* can paste a rendered card in as editable layers for a fast first draft, but
  it produces layers, not true variant components.)
- **→ link back**: **Code Connect** maps each Figma component to its `oj-ui` code component, so
  Figma Dev Mode shows the real code + feeds AI agents the right snippet. Components flow
  design→Figma (authoring) + a code link back; they do **not** sync visually both ways.

**In one line:** tokens sync automatically (Tokens Studio); components are authored in Figma by
the designer against the code + claude.ai/design, then linked to code via Code Connect.

## Seat requirement

Building/editing in Figma needs a **Full or Dev seat** (View seats are read-only and capped at
~6 MCP calls/month). The "openjammer" team currently shows Milo on a **View** seat — but the
**Education/student tier grants edit access in practice** (verified: file + variables created
fine). The designer will have their own Full/Dev seat. If you hit limits building more, upgrade
the seat on the team.

## Day-one checklist for the designer

1. **Tokens → Figma Variables (Tokens Studio).** Install the *Tokens Studio for Figma* plugin →
   Settings → Sync providers → **GitHub** → PAT (Code read+write) → **folder** path
   `packages/oj-tokens/tokens`, branch `feat/design-system`, **token format: W3C DTCG**. Pull.
   The repo already has `$metadata.json` + `$themes.json` defining the sets/themes, so the plugin
   creates: a **Primitives** collection + a **Theme** collection with **Cream / Cyberpunk /
   Midnight** modes. *(Verify the collection/mode mapping on first pull and adjust in-plugin if
   needed; then "Export to Figma Variables".)* The variables I already created match this — reconcile
   rather than duplicate.
2. **Components → Figma.** For each component: build the master with auto-layout, **bind every
   visual property to the variables** (fills → `color/*`, padding/gap → `space/*`, radius →
   `radius/*`, type → `text/*` + `font/*`, border → `border/sketch-width` + `color/sketch-black`),
   and create its variant set. Use the **live previews at the claude.ai/design project** as the
   visual spec, and each component's `.d.ts` (in the repo / synced) as the prop contract.
3. **Code Connect.** In Dev Mode, Library → "Connect components to code", or the
   `@figma/code-connect` CLI / the `figma-code-connect` skill: map each Figma component → its
   `packages/oj-ui/src/components/<Name>` path. Publish. Dev Mode then shows real oj-ui code.

## Component inventory (53 — the build list)

Primitives: Button (variant: node/primary/secondary/success/danger/ghost/link · iconOnly · active),
Input, Textarea, Select, Field, Slider, Toggle, ProgressBar, Spinner, StatusDot, Chip, Kbd,
Callout, Surface, Swatch, Marquee, OffscreenPointer, SegmentedControl, Tabs, List, ListRow,
CodeBlock, + 12 Icons (Apple/Bolt/Check/ChevronDown/ChevronRight/Close/Download/Linux/Mute/
Speaker/Warning/Windows).
Composites: Port (kind audio/control/universal · direction · connected · active · placeholder),
PortRow, NodeShell, NodeFrame, KeyTile, Cable, Waveform, WaveformView, DeviceSelect, Modal,
PanelHeader, IconButton, Banner, EditableLabel, ValueScrubber, Menu (+ MenuItem/MenuCategory/
MenuSeparator).

Port-color meaning is load-bearing: **audio = blue, control = grey, universal = violet**.

## Current status (what's built vs the designer's part)

- ✅ Figma file created + **69 Variables** (Primitives + Theme×3 modes), scoped + `var()` code syntax.
- ✅ Tokens Studio sync files committed (`$metadata.json`, `$themes.json`) — token leg ready.
- ✅ claude.ai/design has all 53 components (the visual spec).
- ✅ **All 53 Figma component masters built** — across pages Primitives / Composites / Icons,
  every fill, padding, radius, stroke, and font-size **bound to the Variables above** (so a
  Theme-mode switch in Figma restyles them, exactly like the app). Build scripts are committed
  under `.design-sync/figma-scripts/` (re-runnable). **The designer's job is now polish, not
  build**: a few tall variant-sets overlap their neighbours (fixed-grid placement — just drag
  apart), `IconLinux` / `IconWindows` have approximated glyph paths to redraw, and a handful of
  state-fills (e.g. Surface "lifted") want an eye. Everything is real, named, and token-bound.
- ✅ **Code Connect mappings written + automated** — all 53 as committed `.figma.tsx`
  (`packages/oj-ui/src/components/**`, parse-validated, snippets → `@openjammer/oj-ui`). PRs
  validate them; merges to `canari` publish via `code-connect.yml`.
  ⏳ Three one-time human steps before snippets show in Dev Mode: **publish the oj-ui library**
  in Figma, an **Org/Enterprise plan** (Code Connect isn't on Free/Pro/Edu), and the
  **`FIGMA_ACCESS_TOKEN`** repo secret. Until then the publish step skips cleanly.
- ✅ **`bun run tokens` is no longer a thing humans run** — `tokens.yml` auto-rebuilds + commits
  token artifacts on any token PR.
