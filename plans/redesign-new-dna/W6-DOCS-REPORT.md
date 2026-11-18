# W6-DOCS report — the New DNA documented

Lane: **W6-DOCS** (Opus 5). Docs only — **zero** `.tsx` / `.ts` / `.css` / token-JSON /
test files were touched. No dev server was started. No git add / commit / stash / checkout.

---

## 1. Files written

| File | What changed |
|---|---|
| `DESIGN.md` | **Replaced wholesale.** New front-matter (48 light colours + a `dark:` block of the same 48, 7 typography roles, radius/space scales, `elevation:` + `motion:` blocks, 37 component entries) + a body in the six spec sections. |
| `PRODUCT.md` | Brand Personality rewritten ("a real instrument"); Anti-references gains "the cream sketchbook we retired" as an explicit non-goal; Accessibility rewritten around the shipped floors. One 6-word clause fixed in Design Principle 4 (see §4). |
| `README.md` | New **"The look"** section replacing the Living Sketchbook pointer; first-run paragraph aligned to `docs/shell.md` (adds "Skip, take me in" + "keeping whatever you already answered"); Docs badge recoloured off the retired pine `#4A7C59`. |
| `docs/design-figma-handoff.md` | Token counts, 2 theme modes, 60-component build list, a binding-rules table (border → subtle/strong/control; effects → the four shadow roles + focus ring + scrim), Outfit, the teal/socket-well Port changes, and honest ⏳ downgrades on the Figma variable + master status. |
| `docs/design-system-migration-plan.md` | **Appended** "§7 New DNA status" — history above untouched. Records Phase 4 as done-and-larger-than-planned, Phase 6 done (Knob/Meter/TransportPill), Phase 5 partially superseded, and that the §6 designer-gated prohibition is now spent. |
| `docs/node-standards.md` | Visual sections only: "Base Structure" and "Schematic Style" rewritten as "The card language (New DNA)" — NodeShell owns the card, semantic-token table, the bans. P2 bullet updated (13px floor, one focus ring, no per-node reduced-motion block, nothing glows). |
| `docs/creating-nodes.md` | Step-3 component example rewritten to render the *body* with oj-ui primitives instead of a hand-rolled card; "Visual Testing" checklist rewritten around the New DNA bans + both themes + reduced motion. |
| `.impeccable/design.json` | **Regenerated** from the new front-matter, same schema (`schemaVersion: 2`, `extensions{colorMeta, typographyMeta, shadows, motion, breakpoints}` + a new `themes` array, `components[]`, `narrative{}`). 11 colour entries with OKLCH-derived 8-stop ramps, 9 component recipes, 10 named rules, 11 do's, 12 don'ts. |
| `packages/oj-ui/README.md` | Rewritten: the five-part **theme contract** table, the live-signal custom properties, the full catalog by group, and an "adding a component" checklist. |
| `packages/oj-tokens/README.md` | Rewritten: two themes, the primitive group table (37), the semantic groups (53), **the naming rules incl. the no-digits rule and why**, the outputs, and the contrast gate. |
| `apps/docs/src/content/docs/index.mdx` | Hero copy: "patch on paper" / "warm sketchbook canvas" → New DNA language. |
| `apps/docs/src/content/docs/design-system/three-way-sync.mdx` | "three Theme modes" → two; "Cream / Cyberpunk / Midnight" → "Light / Dark"; Code Connect sentence corrected + the 7 unmapped folders noted. |
| `plans/redesign-new-dna/COVERAGE.md` | **New.** The Wave 6 gate matrix. |
| `plans/redesign-new-dna/W6-DOCS-REPORT.md` | This file. |

Scratch generators (kept, reproducible): `.scratch/w6-gen-colors.cjs`,
`.scratch/w6-gen-impeccable.cjs`, `.scratch/w6-docs-patch.py`, `.scratch/w6-yamlcheck.mjs`.

---

## 2. Counts verified against code (not from any report)

| Count | Value | How |
|---|---|---|
| Semantic tokens per theme | **53** | `Object.keys(light.color).length` / `dark.color` — identical |
| Primitive tokens | **37** | walk of `primitive.json`; matches the 37 `--` lines in `dist/variables.css` |
| CSS custom properties emitted | **37 + 53** in `packages/oj-ui/oj-tokens.css` | counted per `:root` block |
| Token entries total | **143** (37 + 53 + 53) | derived |
| Component folders | **44** | `ls packages/oj-ui/src/components` |
| Exported React components | **60** (48 named + 12 icons) | parsed every `export { … } from` in `index.ts` |
| Value exports total | **64** (60 + 4 helpers: `knobNorm`, `knobValue`, `knobRotation`, `cablePath`) | same parse |
| Code Connect | **53 mappings across 37 `.figma.tsx` files** | `ls **/*.figma.tsx` + `grep -c 'figma.connect('` |
| Registered node types | **36** | the `NodeType` union in `src/engine/types.ts` |
| Contrast test | 11 pair assertions + on-accent ×2 + 5 ink pairs × 2 washes + danger-ink ×4 grounds + border-control ×3 grounds + bar-rhythm 1.5 + key-parity + no-digits, `describe.each` over both themes | `src/components/Arrangement/__tests__/contrast.test.ts` |
| Reduced-motion rule | `src/styles/global.css:41–46`, exempting `.oj-cable`, `.oj-meter`, `.oj-meter *` | read directly |

**The MASTER-PLAN's "40 registered node types" is wrong.** The union has 36; the
inventory list included `audio-in` and `audio-out`, which are **port ids**, not node types.
COVERAGE.md uses 36 and says so.

---

## 3. Gates

- `node -e "JSON.parse(... .impeccable/design.json ...)"` → **parses OK** (27,077 bytes).
- `DESIGN.md` front-matter parses as YAML: keys `name, description, colors, dark,
  typography, rounded, spacing, elevation, motion, components`; 48 / 48 / 7 / 5 / 5 / 37.
- Body sections, in spec order and with the literal spec words present:
  `## 1. Overview: A Real Instrument` · `## 2. Colors` · `## 3. Typography` ·
  `## 4. Elevation` · `## 5. Components` · `## 6. Do's and Don'ts`.
- `bunx eslint` over every path this lane touched → **exit 0** (markdown and JSON are not
  linted; all touched files are outside the eslint config's file patterns).
- ⚠️ **`bun run lint` is currently RED, and it is not this lane's doing.**
  `src/components/Nodes/InstrumentNode.tsx:104:17` —
  `react-refresh/only-export-components`. That file is **modified and uncommitted** by the
  in-flight **W5-P8** lane. One error, zero warnings; no other file fails. Flagging it to
  the orchestrator rather than editing another lane's file.

---

## 4. Statements I could NOT verify against code — read these before merging

1. **Two measured contrast figures were flagged in gate reviews and I could not confirm
   they were fixed.** Neither is in DESIGN.md's table; both are open questions for the
   Wave 6 review:
   - **Knob tick vs the dial's inset edge, light: 2.79:1** against a 3:1 (WCAG 1.4.11)
     bar (`W3-P1-REVIEW.md:208`). The tick is `--accent-primary` on a
     `radial-gradient(--bg-node → --bg-tertiary)`, so it cannot be settled from the token
     files — it needs a pixel measurement.
   - **KeyTile `key`-variant hint chip on the hit state: 3.81:1 light / 7.17:1 dark**
     against 4.5 (`W4-P3-REVIEW.md:52,184`) — 9px text on the accent fill.
2. **`--border-control` on `--bg-canvas` / `--bg-tertiary`.** W2 measured **2.77 light /
   3.38 dark** on canvas and **2.56 / 2.73** on tertiary — below 3:1 — and recommended a
   new value. The token was **never changed** (`#89867C` / `#807C6F`); the concern was
   closed instead by re-measuring against the socket's *real* ground, the inset
   (**3.03 / 3.53**, `W3-S3-REVIEW.md:51`). Meanwhile `contrast.test.ts` asserts
   `borderControl ≥ 3` against `bgTertiary`, `bgCanvas` **and** `bgNode` and the suite is
   green, so the two sets of numbers cannot both be current. **No review file records a
   re-measurement against canvas/tertiary.** I did not run the test myself (four lanes
   building on a memory-constrained host). Someone should reconcile this.
3. **Whether W2's D8 remedy landed as recommended.** Dark `dangerInk` shipped at
   `oklch(0.785 0.21 25)`; the review recommended `oklch(0.69 0.21 25)`, which was
   *already* the value it was reviewing. The repair actually came in `3473001`. Outcome is
   right (5.59 / 5.70 measured); the paper trail is not.
4. **Reduced motion for cables and meters is verified only by the selector**, never by a
   measurement. No review file reports that `.oj-cable` / `.oj-meter` actually keep
   animating under `prefers-reduced-motion: reduce`. DESIGN.md states the *rule*, which is
   in code; it does not claim the behaviour was observed.
5. **Figma-side counts.** "69 Variables", "3 theme modes", "53 masters built" in the
   handoff describe the Figma file, which I cannot read. I downgraded those bullets from ✅
   to ⏳ with a stated day-one reconciliation action rather than asserting new numbers.
6. **`.design-sync` previews, the `public/download` page and the `apps/docs` render** were
   not opened in a browser (no dev server by instruction), so "the docs site now reads
   correctly" is a copy-level claim only.
7. **Three deliberate deviations I made, for the record:**
   - DESIGN.md front-matter carries **OKLCH** values, matching the token files exactly.
     Per the impeccable reference this triggers a Stitch linter *warning* (hex-only). I
     chose one source of truth over strict Stitch parity; hex equivalents are not
     duplicated anywhere.
   - I added `dark:`, `elevation:` and `motion:` as extra top-level front-matter keys. The
     six **body** sections are unchanged and in spec order; Motion is a `###` under
     Elevation and "Accessibility floors" is a `###` under Colors, because the reference
     forbids extra top-level *sections*.
   - I edited **six words** in `PRODUCT.md` Design Principle 4 — "(the hand-drawn
     character is the purpose…)" → "(weight and sound-reactive light are the purpose…)" —
     which is outside the three sections I was given. It was a live reference to the
     retired identity inside the brand document; leaving it would have contradicted the
     section I *was* asked to rewrite, two paragraphs later. Revert it if you disagree.
8. **`component-map.json` was NOT regenerated** (it is at the repo root, and it is stale by
   exactly the 7 New DNA folders). Regen is `bun run gen:component-map`, which shells out
   to a full `ladle build`; I did not run a build on a memory-constrained host with four
   lanes live. See COVERAGE item 51.
9. **README "node list"** (from the MASTER-PLAN's W6-DOCS line): the root README does not
   contain a node-type list — the node catalog lives on the docs site — so there was
   nothing to update. Flagging in case a list was expected to be *added*.

---

## 5. Two live defects found while reading (not fixed — not my files)

- **`src/components/Nodes/SamplerVisual.css`** still declares a **port glow**
  (`.sampler-key-port.connected { box-shadow: 0 0 4px var(--control-connected) }`) plus a
  hover `scale(1.3)` + `brightness(1.2)`. The class appears in no `.tsx`, so it is dead
  CSS — but it is the last surviving violation of the Nothing-Glows rule in the repo, and
  it sits in **W5-P7's** files. Delete it with the Sampler pass.
- **Two stale JSDoc comments** advertise the retired language:
  `packages/oj-ui/src/components/IconButton/IconButton.tsx:122` ("hand-drawn ink border,
  hard offset feel") and `src/components/EngineHealthDot/EngineHealthDot.tsx:6` ("a Caveat
  label"). Harmless at runtime; wrong in a file an agent will read.

(Everything else audited clean: **zero** hard offset shadows anywhere in `src` or
`packages`, **zero** Caveat `font-family` declarations, **zero** port glows in the
library. The only remaining 2px borders in oj-ui are the two intentional glyph strokes in
`TransportPill` — the attention ring and the record dot.)

---

## 6. COVERAGE.md — the MISSING summary

`plans/redesign-new-dna/COVERAGE.md` has one row per inventory item with lane/commit,
light path, dark path and status. **The gate cannot close.**

**Fully missing (no image in either theme) — 31 items**, of which the biggest block is the
node registry: `looper`, `sampler`, `sampler-visual`, `library` (all P7, **not started**),
`pan`, `width`, and the **eight legacy fixed-instrument types** (`piano`, `cello`,
`electricCello`, `violin`, `saxophone`, `strings`, `keys`, `winds`). Also missing
entirely: universal-kind cable, node `.is-agent-pending`, export dialog, waveform-editor
modal, piano-roll velocity lane/scroomer, timeline record ghost, Bench, relink-samples
dialog, four command-bar surfaces (model picker, sessions, slash items, rewind rows), PWA
update prompt, offline chip, error boundary, safe-mode screen, plugin window shell, the 12
icons, the Ladle catalog, `public/download`, the `apps/docs` site, `.design-sync`
previews, and the W6-E2E visual-regression baselines.

**Half-covered (one theme only, or incidental-shot only) — 19 items**, notably: dedicated
captures for **`Meter`, `TransportPill` and `ParamRow`** (three of the components the New
DNA *introduced* have no component-level screenshot), the topbar in dark, the latency chip
in light, a post-P9 help panel, `canvas-input`/`canvas-output` faceplates, the MIDI browser
in dark, timeline **dark 1920×1080 frames 06–12**, and four reduced-motion passes that
exist only in light.

**Headline numbers.**

- **14 of 36 node types** have no capture in either theme.
- **10 of those have no taste-pass owner in any wave** — `pan`, `width` and the eight
  legacy instrument types. They are either live surfaces that must be redesigned or dead
  types that covenant #8 says to delete. **This needs an owner decision; it will otherwise
  pass the gate by omission.**
- Four lanes still open: **P7** (not started), **P8** and **TB** (built, uncommitted),
  **P10** and **W6-E2E** (not started).
- Gate-complete today: the token layer, the oj-ui component library (bar the three new
  components' dedicated shots), the shell, the canvas, the command bar, the panels, and
  the committed node families.
