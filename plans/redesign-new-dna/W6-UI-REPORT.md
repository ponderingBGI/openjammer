# W6-UI — design-system + a11y remainder

**Lane:** W6-UI (resumed after an API-limit interruption).
**Branch:** `t3code/openjammer-redesign-timeline`. Nothing staged, nothing committed.
**Evidence:** `plans/redesign-new-dna/.scratch/w6-ui/` — 104 files, light + dark.

The first run died mid-way through the sky-band alert media-query test (item 8) and left
no report. This run audited every uncommitted edit against the brief, found items 1, 2,
4–11 substantively finished and **item 3 half-finished** (the Chip half was done; the
menu-category half was untouched), finished item 3, and ran every gate — the first run had
run none of the final verification.

---

## Gates (all run this session, from the repo root, `bun` only)

| Gate | Result |
|---|---|
| `bun run test:run -- packages src/keymap src/components/Shell src/components/Arrangement src/components/PianoRoll src/store` | **97 files / 966 tests passed** |
| `bun run test:run` (whole suite, for the shared-component change) | 225 files / 2588 tests — **1 flake**, see below |
| `bunx tsc --noEmit -p tsconfig.app.json` | **clean** |
| `bunx eslint packages src/keymap src/components/Shell src/components/Arrangement src/components/PianoRoll` | **clean** |
| `bunx figma connect parse` | **exit 0** (53 Code Connect docs parsed, incl. `IconButton.figma.tsx`) |
| `bun run build` | **built in 3.81s**, PWA precache 87 entries |
| `git diff --check` on owned files | **clean** (only the repo's usual LF→CRLF notices) |
| `tokenLiteralGate.test.ts` + `src/components/__tests__` (incl. `webSurfaceTokens`) | **9 files / 111 tests passed** |
| `bun run tokens` (re-run **last**, so both sheets carry `--accent-two-ink`) | 2 themes, 2 static sheets; 4 occurrences of `--accent-two-ink` in each |
| Browser, Ladle 61010 + app 5232, light + dark | **zero console errors, zero page errors** across `sky.json`, `tab.json`, `roll.json`, `ladle.json`, `consumers-after.json`, `menu.json` |

**The one full-suite failure is a known load flake, not a regression.**
`src/components/Settings/__tests__/KeybindingsPanel.test.tsx > should render all keybinding
actions` timed out at 5000 ms under full parallel vitest. Re-run isolated
(`bun run test:run -- src/components/Settings`): **4 files / 38 tests passed**, that test in
**2671 ms**. It renders 169 `ListRow`s, so I checked it specifically against item 4 — the
row-body change is CSS only and cannot move a jsdom render.

Both servers were started for the browser pass and **stopped** (ports 61010 / 5232 now
refuse connections).

---

## Per item

### 1. Waveform clip edge + Meter lit bar — *previous run: done. This run: verified only.*

`packages/oj-ui/src/components/WaveformView/WaveformView.css:16` — `border: 1px solid
var(--timeline-clip-border)`. `packages/oj-ui/src/components/Meter/Meter.css:47` —
`background: var(--success-ink)`.

Measured in Chromium off the live computed style (`ladle.json`), not from the tokens:

| Mark vs ground | light | dark |
|---|---:|---:|
| clip edge vs the card (`--bg-node`) | **5.49** | **5.05** |
| clip edge vs what is behind it (`--bg-canvas`) | **4.95** | **5.59** |
| meter lit bar vs its bed (`--bg-tertiary`) | **5.31** | **6.07** |
| *(what it replaced)* `--border-subtle` vs `--bg-node` | 1.31 | 1.27 |
| *(what it replaced)* `--accent-success` vs `--bg-tertiary` | **2.61 — the failure** | 5.91 |

Semantics still read: the meter keeps three distinguishable states — bed
`rgb(236,234,228)` / lit `oklch(0.459 0.17 150)` / clipping `oklch(0.58 0.21 25)`, lit-vs-
clipping 1.34 light / 1.42 dark, and the clip latch still latches (`clipLatched: true`).

Pinned by `packages/oj-ui/src/components/__tests__/w6UiContrast.test.tsx` (new file from
the first run) — it recomputes every number above from the DTCG sources, so the measurement
cannot rot. Shots: `ladle-composites--waveformview--{single,states}-{light,dark}.png`,
`ladle-canvas--meter--{silent,live-level,clipping}-{light,dark}.png`.

### 2. `IconButton` → `forwardRef` — *previous run: done. This run: verified only.*

`packages/oj-ui/src/components/IconButton/IconButton.tsx:1,42`. `bunx figma connect parse`
is green and `IconButton.figma.tsx` is unchanged. The test
(`IconButton.test.tsx:58`) is honest about what was actually broken: under React 19 a `ref`
on a function component arrives in `props` and was spread through `...rest`, so the ref
happened to land — the **defect was the type**, `IconButtonProps` had no `ref` and
`tsc -p packages/oj-ui/tsconfig.json` rejected the call site. Both halves are asserted
(`$$typeof === Symbol.for('react.forward_ref')`, and `ref.current === button`).

### 3. Chip type + the two places §5 and §3 disagreed — **the unfinished item.**

**(a) Chip — previous run: done.** `Chip.css:19` `font-size: var(--text-sm)`; the trailing
`count` slot stays mono `--text-xs`. DESIGN.md §3 and §5 both updated. Measured live: chip
root **13px**, label **13px**, count **11px**, height **23px** in both themes.

Consumer sweep (`consumers-after{,-summary}.json`) — 14 surfaces × 2 themes, driven in the
real app: canvas, arrangement, command bar, and all 10 Settings tabs. **0 chips overflowing
their parent, 0 rows with collapsed children, 0 rows clipped without an ellipsis** anywhere.
Shots for the surfaces that changed: `after-{canvas,arrangement,command-bar,settings-*}-{light,dark}.png`
(26 files) plus `ladle-primitives--chip--*`.

**(b) Menu category headers — NOT started by the previous run. Done here.**

DESIGN.md §5 specified `10.5px/600 uppercase` sans category headers, and
`packages/oj-ui/src/components/Menu/Menu.css:103` shipped exactly that. That is illegal
twice over: 10.5px is not on the primitive scale at all, and functional sans never goes
below the 13px floor (`Field`'s 12px label being the one documented exception).

I did **not** lift it to 13px. The menu item above it is 14px/500; a 13px/600 header would
be as loud as the thing it introduces and the hierarchy would invert. It changes **face**
instead — `--text-micro`, the voice the DNA already reserves for uppercase, tracked markers
that *name* a group (socket labels, ruler marks, unit labels), which the floor exempts by
construction. JetBrains Mono is the wider face, so the run barely moves optically.

- `packages/oj-ui/src/components/Menu/Menu.css:117–130` — `--font-mono` / `--text-micro` /
  `--tracking-micro`, uppercase and `--text-muted` unchanged.
- `DESIGN.md` §5 Menu bullet rewritten to the Micro voice, with the reason.
- Pinned: `packages/oj-ui/src/components/__tests__/w6UiContrast.test.tsx`, new describe
  *"Menu category — the micro voice, not a sub-floor sans run"* — four gates: the three
  token declarations sit in the same block, no `10.5px` literal survives anywhere in the
  library, the muted header still clears **4.5:1** on the menu surface in both themes, and
  DESIGN.md says the new rule and not the old one.

Measured live (`menu.json`), Ladle **and** the real canvas context menu in the app:

| | light | dark |
|---|---|---|
| header face / size / tracking | `JetBrains Mono` 9.5px 0.76px | same |
| item face / size | `Outfit` 14px | same |
| header on the menu surface | **5.49:1** | **5.05:1** |
| category headers overflowing the menu | 0 | 0 |

Shots: `ladle-composites--menu--context-menu-{light,dark}.png`,
`ladle-composites--menu--dropdown-{light,dark}.png`, `app-context-menu-{light,dark}.png`.

> **Follow-up for the orchestrator (another lane owns the file this week):**
> `src/components/CommandBar/CommandBar.css:165` (`[cmdk-group-heading]`) and `:817`
> (`.command-bar-ai-slash-empty`) still hard-code the retired **10.5px sans**. They are the
> same vocabulary as `.oj-menu-category` and should take the same four lines. Noted in the
> `Menu.css` comment so the next reader finds it from the component.
> A second, smaller one: `src/components/Shell/SurfaceSwitcher.css:10` sizes the topbar
> `Kbd` at a bare `10.5px`. That one is **mono**, so it breaks no floor — it is only off the
> scale. I left it rather than move a topbar keycap nobody asked me to move.

### 4. `ListRow` body is a flex row — *previous run: done. This run: verified only.*

`ListRow.css:81–86` declares `display:flex; align-items:center; gap:var(--space-xs);
flex:1; min-width:0` once, replacing the same three lines re-declared by six consumers.
Two escape hatches make it safe:

- `:95` `.oj-list-row__body:not(:has(*)) { display: block }` — `text-overflow: ellipsis`
  applies to block containers only, so a blanket flex box would have swapped the command
  bar's rewind ellipsis for a hard clip. Verified live: `rewindDisplay: "block"`,
  `rewindTextOverflow: "ellipsis"`, `scrollWidth 478 > clientWidth 322`, i.e. the ellipsis
  actually fires.
- `:107` `.oj-list-row__body > :only-child { flex: 1; min-width: 0 }` — the commonest shape
  is one wrapper element, which as a flex item would have shrunk to content and lost its
  truncation.

Consumers verified in Ladle (`bodyDisplays: ["flex","flex","flex","block","block"]`, the
Library-shaped tag dot now measures **8×8** where it used to be 0×0) **and** in the app —
the Keybindings panel's **169** real rows all compute `display: flex`, height 39, none with
collapsed children, none clipped without an ellipsis, in both themes. Pinned by three tests
in `ListRow.test.tsx:36–71`; new `BodyShapes` story.

### 5. Waveform extremes — *previous run: investigated. Verdict: the claim is not real.*

W5-P7 claimed the shared `Waveform` clips a full-scale sample. Driven with a full-scale
square (`[1,-1,1,-1,1,-1]`) in Ladle:

- the mapping puts the peaks **on** the viewBox edges — polyline `y` values are exactly
  `0` and `100` (asserted in `w6UiContrast.test.tsx`);
- nothing clips the stroke: `svgOverflow: "visible"`, `hostOverflow: "visible"`,
  `clipPathOnSvg: "none"`, and every one of the 7 ancestors computes `overflow: visible`;
- `elementFromPoint` just **outside** the svg box still hits `.oj-waveform__trace`, so the
  half-stroke that hangs out really is painted;
- stroke is a true `1.5px` (`vector-effect: non-scaling-stroke`), overhang top/bottom `0`.

**No fix made.** Both halves are pinned instead, because a future `overflow: hidden` on this
element is what would *create* the bug the report feared. Shots:
`ladle-waveform-square-{light,dark}.png`, `ladle-waveform-flat-edge-{light,dark}.png`.

### 6. `--accent-two-ink` — *previous run: done. This run: verified + re-measured.*

Token in both theme JSONs with a `$description` that carries the derivation
(`light.json:51` `oklch(0.3 0.16 300)`, `dark.json:51` `oklch(0.88 0.068 300)`), through
`bun run tokens` into `types.ts`, `generated/themes.ts`, `oj-ui/oj-tokens.css` and both
static sheets. **Adopted** at `src/components/PianoRoll/PianoRoll.css:34` —
`--piano-roll-note-ink: var(--accent-two-ink)`, replacing the W4-TBb stand-in `color-mix(in
oklab, var(--universal-connection) 60%, var(--text-primary))` (which coupled note colour to
the *body-text* colour and left light at 3.0006:1 — four ten-thousandths of headroom).
`contrast.test.ts` now reads the **token** and asserts the stylesheet adopts it, so the two
cannot drift; it also gates that the token is used, so it can never become dead.

Composited table, browser-measured (`roll.json`), 3 velocities × 5 grounds × 2 themes:

**light** — ink `oklch(0.3 0.16 300)` → `rgb(61,0,111)`

| ground | v0 (α .68) | v64 (α .841) | v127 (α 1.0) | L* ramp |
|---|---:|---:|---:|---:|
| white-key row | 5.94 | 10.04 | 14.71 | 26.1 |
| black-key row | 5.78 | 9.63 | 14.07 | 25.6 |
| clip `oklch(0.72 0.15 80)` | 5.68 | 9.31 | 13.33 | 24.6 |
| clip `oklch(0.71 0.19 40)` | **5.61 (worst)** | 9.15 | 13.14 | 24.6 |
| clip `oklch(0.64 0.17 150)` | 5.66 | 9.19 | 13.08 | 24.2 |

**dark** — ink `oklch(0.88 0.068 300)` → `rgb(222,206,255)`

| ground | v0 | v64 | v127 | L* ramp |
|---|---:|---:|---:|---:|
| white-key row | 5.93 | 8.36 | 11.31 | 21.5 |
| black-key row | 6.01 | 8.55 | 11.60 | 21.9 |
| clip `oklch(0.78 0.15 80)` | **5.10 (worst)** | 7.01 | 9.21 | 19.8 |
| clip `oklch(0.78 0.19 40)` | 5.13 | 7.05 | 9.30 | 20.0 |
| clip `oklch(0.7 0.17 150)` | 5.24 | 7.20 | 9.49 | 20.0 |

All 30 composites clear 3:1 with large margin (worst **5.61** light / **5.10** dark).

> **Deviation — the L* ramp does not reach 25 in dark. It cannot.** See *Deviations* below.

Shots: `roll-{light,dark}.png`, `roll-velocity-ladder-{light,dark}.png`.

### 7. Tab focus trap (P6-F7) — *previous run: done. This run: verified + one honest gap.*

`src/keymap/arbiter.ts:38` — `target.closest('[data-surface-root]')` →
`target.matches('[data-surface-root]')`. The stage **floor** toggles; a control walks.
Hidden peer surfaces already carried `inert` + `aria-hidden` (`App.tsx:583–584`,
`ArrangementSurface.tsx:248,306`, `PianoRollSurfaceHost.tsx:74`); the first run pinned all
three with `src/components/Shell/__tests__/surfaceTabOrder.test.tsx`, including the case
`hidden` cannot cover — the 180 ms transition-out, when the peer is still painted.
`docs/shell.md` rewritten; `chromeFocus.ts` comment corrected.

Browser (`tab.json`, both themes, 3 nodes on the canvas, identical results in each):

- Tab from the stage floor: `canvas → arrangement`, focus lands on the arrangement surface
  root. The advertised law still holds.
- Tab from a node control (a key tile): walks **4** sibling controls, all
  `inCanvas: true`, surface never changes. This is the trap, closed.
- Shift+Tab from the same control: walks **3** back, same node, surface never changes.
- Shift+Tab from the stage floor: leaves to `BODY` / the chrome, and **never** toggles.
- 60 consecutive Tabs: **53 distinct stops**, **3 nodes touched**, 42 stops inside the
  canvas, 18 in the chrome; the surface changes only at step 50, when traversal has wrapped
  back to `document.body` — which is the stage floor, so that is the law working.

Shots: `tab-canvas-{light,dark}.png`. Symmetry and the target rule are pinned by two
arbiter tests (`arbiter.test.ts:204`, `:248`), the jsdom inert contract by `surfaceTabOrder.test.tsx`.

> **Could NOT verify: "every port present" in the 60-Tab count.** See *Deviations*.

### 8. Sky-band alert chip — *previous run: died here. Test finished + swept this run.*

Component: `SkyBand.tsx:10–41` — one `Alert` component all three call sites go through
(`faults`, `transportError`, `recordError`), carrying `IconWarning`, `role="status"` and
`title={children}` **at every width**, because the 34ch cap truncates even while the text
shows. CSS: `ArrangementSurface.css:191` gives the chip `flex: 1 1 0` (a flex **base of
zero**, so it can never be the item that starts a new row — `flex: 0 1 auto` wraps before it
shrinks, which is what put a 291px sentence on a row of its own) with a `27px` glyph floor;
`:1010–1023` clips the label below 1180px — **clipped, not `display:none`**, because the
chip *is* its own live region and a removed label is a failure a screen reader stops
hearing; `:1036–1039` moves the compaction threshold to 1260px **only for a cluster that
has an alert** (`:has()`, no JS, no resize listener), because an alert costs the row 33px.

The half-written media-query test is finished and passing:
`src/components/Arrangement/__tests__/rulerStack.test.tsx:209–241`, *"turns the alert chip
into a glyph on the compaction width, without silencing it"* — 10 assertions across the
`mediaBlock(SURFACE_CSS, 'max-width: 1180px')` pattern and `SkyBand.tsx`.

Browser sweep (`sky.json`), with an alert present, **780 → 2200 px in 10px steps, 143
widths, both themes, identical results**:

- **cluster ∩ ruler = 0 px² at every single width.**
- max cluster height **55.19px** in a **56px** band; overflow below the band is **negative
  everywhere** (worst −0.41px of slack). Cluster heights seen: 30 (≥1270), 28 (1170–1260),
  55.19 (910–1160), 55 (780–900) — i.e. one row, then one compacted row, then **two** rows.
  A third compacted row would be 24+3+24+3+24 = 78px; **it never appears.**
- the label leaves the flow at exactly **≤1180** (`position: absolute`) and is in flow at
  **≥1190** — the media query and the layout agree.
- `title`, `role="status"` and the accessible text are present at **all 286 samples**; the
  glyph is never `display:none`; the chip never shrinks below 29px.

Shots: `sky-alert-{800,900,1000,1100,1180,1200,1300,1400,1600,1920}-{light,dark}.png`.

### 9. Dead `getTagColorDark` — *previous run: done. This run: verified only.*

Removed from `src/store/libraryStore.ts` (11 lines). Zero consumers — confirmed by grep and
by the full suite. Pinned by `src/store/__tests__/libraryStoreExports.test.ts`, which also
records *why* the survivor survives (only the hue moves, so a tag's colour can never become
its legibility).

### 10. Record-dot ink ≤1.5px — *previous run: done. This run: verified only.*

`TransportPill.css:139` `border: 1.5px solid var(--accent-danger)`, and `:100` (the attention
ring) took the same cut. Pinned negatively — `not.toMatch(/border:\s*2px solid/)` over the
whole sheet, so the literal cannot come back anywhere in the component. The recording read
survives: the dot still fills with `--accent-danger` while recording and the
`oj-transport-rec` pulse is intact (both asserted). Measured live: 18×18 box, solid border,
`background: oklch(0.58 0.21 25)` light / `oklch(0.66 0.21 25)` dark. Shots:
`ladle-composites--transportpill--{recording,song}-{light,dark}.png`.

> Chromium reports the computed border as `1px` at DPR 1 — it rounds sub-pixel borders for
> layout. The declared value is 1.5px and that is what the DNA caps; nothing here is >1.5.

### 11. The token build emits both static sheets — *previous run: partially done. This run: verified end-to-end.*

The first run created `packages/oj-tokens/staticSheet.mjs` (+ `.d.mts`) and wired it into
`build.mjs:34,146–155`. Confirmed working and complete:

- `bun run tokens` prints *"…and 2 static web-surface sheets (2 themes)"* and writes
  `public/download/oj-tokens.css` and `apps/docs/src/styles/oj-tokens.css`.
- Both are gated **both ways**, the shape W6-FIX established: `:root` (light default),
  `@media (prefers-color-scheme: dark)`, `:root[data-theme='dark']`, `:root[data-theme='light']`.
- Both carry `--accent-two-ink` **4 times** (once per block) after the final re-run.
- The emission depends on **nothing** under `plans/redesign-new-dna/.scratch/` — the renderer
  lives in the package. Nothing under `.scratch/` was deleted; I only added
  `w6-ui/menu.mjs`, `w6-ui/menu.json` and 6 png/log files.
- W6-FIX's transcription test (`src/components/__tests__/webSurfaceTokens.test.ts`, another
  lane's file) imports the **same renderer** and asserts the committed files are
  byte-identical to a fresh render. It passes.

---

## Deviations

1. **The dark velocity ramp is 21.5 L*, not the 25 the brief asked for. It is unreachable,
   and that is proven mechanically rather than asserted.** `velocityOpacity` starts at
   **0.68**, so softest→loudest is 32% of one alpha; over the dark lane (`#201F19`, L* 12.6)
   that whole range is worth only **25.5 L\*** even to a **pure white** ink. Nothing that is
   still recognisably the violet second accent gets there. `contrast.test.ts:289–314`
   therefore ships two gates instead of a lowered number: one **sweeps every in-gamut
   `oklch(L C 300)`** with enough chroma to read as a hue and asserts the best achievable
   ramp is `< 25`; the other asserts the shipped ink spends **≥90%** of that ceiling. Light
   holds the full **25** (measured 26.1). If the alpha floor is ever lowered — now
   affordable, since the ink clears 3:1 with 2.5× headroom — the ceiling rises past 25, the
   first gate goes red, and that is the moment dark should be held to the light number. I
   consider that the correct fix and it is **out of this lane's scope** (it changes how every
   note is painted).

2. **Item 7's "every port present" in the 60-Tab count is not satisfiable today, and I did
   not force it.** Measured: `portsOnCanvas: 9`, `portsReached: 0`, `firstPort: -1` — in both
   themes. The cause is not the focus trap: `Port` renders a bare `<span>` with no `tabIndex`
   and no role (`packages/oj-ui/src/components/Port/Port.tsx:65`, via `PortRow`), so **ports have
   never been in the tab order**, before or after this change. Adding `tabIndex` would put
   9 stops per canvas into the order with nothing to do when you get there — the only
   connection verb, `canvas.multiConnect` (`NodeCanvas.tsx:811`), requires a *hovered* port,
   i.e. a pointer. Nine dead stops is worse than none (covenant #8), and a real keyboard
   connection flow is a feature, not a W6-UI polish item. **Recommended as a follow-up**:
   focusable ports + a keyboard connect/land gesture, specified together.
   What the fix *does* provably close is the trap itself — from any focused node control,
   Tab and Shift+Tab now walk the node's controls and never swap the surface (item 7 above).
   Note also that W5-P6's F7 was written as "focus on a node port", which cannot literally
   happen; the real trap was focus on any node **control**, and that is what is fixed.

3. **Item 3's resolution is a face change, not a size change.** The brief offered "mono micro
   voice or 13px"; I took the mono micro voice, for the hierarchy reason given in §3(b).
   DESIGN.md now states the rule and the reason, so this is a spec decision on the record,
   not a silent one.

4. **`SurfaceSwitcher.css:10` still carries a bare `10.5px`.** It is a `Kbd`, i.e. mono, so
   it breaks no floor — it is merely off the primitive scale. I own the file and chose not
   to change a topbar keycap that nothing asked me to change; logged above as a follow-up.

---

## What I could not verify

- **Audio.** Nothing in this lane touches the audio path, the graph, or the engine — the
  diff is CSS, one token, one `forwardRef`, one arbiter predicate, one dead export, and
  docs. No audio test was run and none is implied.
- **The native shell.** All browser evidence is Chromium at DPR 2 via the Vite dev server on
  5232. Nothing was checked in the Tauri window.
- **Figma parity.** `bunx figma connect parse` proves the docs parse; it does not publish or
  compare against the Figma masters. The `IconButton` and `Menu` masters were not re-checked
  visually.
- **The two static sheets in situ.** `bun run tokens` writes them and the byte-equality test
  passes, but I did not render `public/download/index.html` or the Starlight docs site with
  the new sheet — those files belong to lanes W6-FIXb and are being edited concurrently.
- **`prefers-reduced-motion` / forced-colors.** Not exercised for the alert chip or the menu
  header.
- **A real screen reader.** The alert's `role="status"` + clipped-label behaviour is verified
  structurally (accessible text present at all 286 sweep samples, label clipped rather than
  removed) but was not heard through NVDA/VoiceOver.

## Risks

- **The 56px band has 0.41px of slack** between 910px and 1160px with an alert present. It
  holds at every width I measured and `rulerStack.test.tsx` pins the mechanism, but any
  future control added to the utility cluster, or a font-metric change, will land on the
  ruler. The gate that would catch it is the browser sweep, not a unit test — worth keeping
  `sky.mjs`-style sweeps in the E2E lane.
- **`:has()` carries the alert-only compaction threshold** (`ArrangementSurface.css:1036`).
  It is baseline-supported in every browser we ship to and there is no JS fallback by
  design; a target without `:has()` would get the 1180 threshold and a two-row cluster.
- **`.oj-list-row__body:not(:has(*))`** decides flex-vs-block by *whether the body has
  element children*. A consumer that conditionally renders a wrapper (an editing state, say)
  will flip the body between block and flex. Three tests pin both branches, but it is a
  structural rule and reads as one.
- **The menu category is now 9.5px.** It is mono, uppercase, tracked and clears 4.5:1
  (5.49 light / 5.05 dark), and it is measured at 9.5px in the real app context menu — but
  it is the smallest type in the menu vocabulary and deserves a look under stage light by a
  human before this ships.
- **`--accent-two-ink` has exactly one consumer.** That is deliberate and `contrast.test.ts`
  gates it, so if the roll ever stops adopting it the token goes red rather than becoming
  dead weight.
