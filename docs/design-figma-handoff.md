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
- **→ Figma**: **Tokens Studio** plugin Git-syncs those exact DTCG files → **Figma Variables**.
  On the **free** tier this leg is **one-way (pull-only)**: Tokens Studio's multi-file *folder*
  sync — which is what our `tokens/` directory uses (`$metadata.json` / `$themes.json`) — supports
  **pull**, not push. A designer **Pulls** the latest tokens, switches the Theme mode, and
  **Applies** them; they **cannot push token edits back from Figma**. Tokens are authored in the
  repo as PRs (a true Figma → repo write-back would need **Tokens Studio Pro** *and* tokens to be
  authored in Figma — neither is our path today).
- *(Already seeded:* I built the Figma Variables directly — 2 collections, 69 variables, 3 theme
  modes. Tokens Studio then keeps them in step by pulling from the repo going forward.)*

### Components → one source: the code (`packages/oj-ui`)
- **→ claude.ai/design**: done — **53 components** synced, live + browsable (32 of them also have
  a Ladle story today; the rest are covered by the claude.ai/design previews).
- **→ Figma**: the **designer builds the Figma components** (the visual masters), using the
  claude.ai/design previews + the variables as reference. There is **no reliable automatic
  code→Figma component generation** — Figma components are design artifacts. (A plugin like
  *html.to.design* can paste a rendered card in as editable layers for a fast first draft, but
  it produces layers, not true variant components.)
- **→ link back**: **Code Connect** maps each Figma component to its `oj-ui` code component, so
  Figma Dev Mode shows the real code + feeds AI agents the right snippet. Components flow
  design→Figma (authoring) + a code link back; they do **not** sync visually both ways.

**In one line:** tokens are authored in the repo and **mirror one-way into Figma** (Tokens Studio
Pull); components are authored in Figma by the designer against the code + claude.ai/design, then
linked to code via Code Connect.

## Plan & seat — what we have, what's gated

The OpenJammer file currently runs on **Education = Professional**, with a **Dev seat** (not a
View seat). On that tier **Dev Mode, library publishing, and up to 10 variable modes all work** —
verified: the file, the 69 variables, and the 3 theme modes were all created fine. The **only**
things OpenJammer wants that Professional does *not* grant are **Code Connect** (Dev-Mode code
snippets), **native branching**, and the **REST Variables write API** — all Organization/Enterprise.

Education is a **personal** student/educator grant (SheerID, re-verified annually); it is **not**
available to an open-source project as an entity. The system is built to **degrade, not break**:
if the grant lapses the file drops to **Starter**, the three Theme modes become **read-only** (the
data is safe, editing is frozen), and the code-first token path keeps working untouched — it never
depended on Figma writing anything. A durable **paid Professional Dev seat (~$12/mo, re-check
[figma.com/pricing](https://www.figma.com/pricing/))** restores the same capabilities permanently
if you want insurance against a lapse.

| Capability | Starter (Free) | Professional | Organization | Enterprise |
| --- | --- | --- | --- | --- |
| Publish team libraries | No | Yes | Yes | Yes |
| Dev Mode (inspect) | No | Yes (Full/Dev seat) | Yes | Yes |
| Code Connect (code snippets in Dev Mode) | No | No | Yes | Yes |
| Branching & merging | No | No | Yes | Yes |
| Variable modes per collection | 1 (effectively none) | up to 10 | up to 20 | unlimited |
| REST Variables API (write, headless CI) | No | No | No | Yes |
| Version history | 30 days | unlimited | unlimited | unlimited |

*(Pricing, USD/annual, checked 2026-06-20: Pro Full $16 / Dev $12 / Collab $3; Org Full $55 /
Dev $25; Ent Full $90 / Dev $35; View seats free. Pricing changes periodically — re-check
[figma.com/pricing](https://www.figma.com/pricing/).)*

## Day-one checklist for the designer

1. **Tokens → Figma Variables (Tokens Studio, pull-only on free).** Install the *Tokens Studio for
   Figma* plugin → Settings → Sync providers → **GitHub** → PAT (Code **read** access is enough on
   the free path) → **folder** path `packages/oj-tokens/tokens`, branch `canari`, **token format:
   W3C DTCG**. Pull. The repo already has `$metadata.json` + `$themes.json` defining the sets/themes,
   so the plugin creates: a **Primitives** collection + a **Theme** collection with **Cream /
   Cyberpunk / Midnight** modes. *(Verify the collection/mode mapping on first pull and adjust
   in-plugin if needed; then "Export to Figma Variables".)* The variables I already created match
   this — reconcile rather than duplicate. Remember the folder sync is **read-only on free** — Pull
   and Apply themes here; you don't push token edits back (those are repo PRs).
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
- ✅ **Code Connect mappings written + automated** — **53 mappings across 37 committed
  `.figma.tsx` files** (`packages/oj-ui/src/components/**`; multi-export files like Menu/Icons hold
  several), parse-validated, snippets → `@openjammer/oj-ui`. PRs validate them; merges to `canari`
  publish via `code-connect.yml`.
  ⏳ Three one-time human steps before snippets show in Dev Mode, all at the **Organization/
  Enterprise** rung: **publish the oj-ui library** in Figma, an **Org/Enterprise plan** (Code
  Connect isn't on Starter/Professional/Education), and the **`FIGMA_ACCESS_TOKEN`** repo secret.
  Until then the publish step skips cleanly.
- ✅ **`bun run tokens` is no longer a thing humans run** — `tokens.yml` auto-rebuilds + commits
  token artifacts on any token PR.
