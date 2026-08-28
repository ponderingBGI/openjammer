# W3-S3 REVIEW — sockets, node cards, cables

Gatekeeper pass over the uncommitted S3 lane (Port / PortRow / NodeShell / Cable /
`_sockets.css` / `portPositions` / `registry` / `NodeCanvas` / `BundlePortGroup`).
Read-only: nothing edited, nothing staged. Browser work run under `node`, one
Chromium, dev server on **5205, stopped**.

**Verdict: COMMIT** — with one blocking must-fix (**M1**) that lives in this lane's
own files and should land in the same commit or the one immediately after.

Artifacts: `plans/redesign-new-dna/.scratch/w3-s3-gate/`
(`gate.mjs`…`gate7.mjs`, `results{,2,3,4}.json`, `{light,dark}-*.png`, gate logs).

---

## 1. Fidelity vs `new-dna.css` — value by value

All values below are **computed styles read off the running app**, not the source.
`results.json → themes.*.computed`.

| Spec (handoff) | Shipped | Verdict |
|---|---|---|
| well 18px circle | `18px × 18px`, `border-radius: 50%` | ✅ exact |
| inset bg | `#ECEAE4` light / `#2A2822` dark (= handoff inset) | ✅ exact |
| 1px control border | `1px solid #89867C` / `#807C6F` | ⚠️ **D1** |
| inset shadow | `inset 0 1px 3px rgba(0,0,0,.22)` | ✅ byte-exact |
| 8px core | **7.03px** (`width: 44%` resolves against the 16px *content* box) | ⚠️ **D2** |
| idle core `--line2` | `--text-muted` (`#6C695F` / `#928E83`) | ⚠️ **D3** (sanctioned) |
| live core = wiring colour | `--control/-audio/-universal-connection` on `.is-connected` | ✅ |
| universal flat violet | `oklch(.66 .19 300)` / `oklch(.72 .19 300)` = handoff accent-2 | ✅ |
| NO glow in any state | 0 non-inset shadows, 0 animations on every socket, both themes | ✅ proven |
| hover = 1px accent ring, no scale | `transform: none`, box 18×18 before **and** after hover, `border-color: oklch(.66 .19 40)` | ✅ measured |
| header 10px 14px | `padding: 10px 14px`, `gap: 8px`, bg `#FAF9F6` | ✅ exact |
| grip 4× 3px dots gap 2.5 | 4 `<i>`, `3px`, `gap: 2.5px`, `--border-strong` (= handoff `--line2`) | ✅ exact |
| title 600 15px | `15px / 600 / Outfit` | ✅ exact |
| type chip 500 **10px** mono uppercase .08em | `500 / **11px** / JetBrains Mono / .88px (=.08em)` | ⚠️ **D4** |
| chip on inset, radius-sm, 4px 7px | `#ECEAE4`, `6px`, `4px 7px` | ✅ exact |
| body 12px 14px gap 12px | `padding: 12px 14px; gap: 12px` | ✅ exact |
| port row = first body row, space-between | `portRowIsFirst: true`, `justify-content: space-between` | ✅ |
| card 1px line, radius-lg, shadow-overlay | `1px #E3E1DA`, `14px`, `0 2px 6px/0 12px 28px` (= handoff sh2) | ✅ exact |
| cable `2.5px + sig*2.5` | `stroke-width: calc(2.5px + var(--oj-cable-signal)*2.5px)` | ✅ |
| cable `.5 + sig*.5` | `opacity: calc(.5 + …*.5)` | ✅ |
| cable `drop-shadow(0 0 sig*7px)` | present, and `color` is paired with `stroke` on every kind (fixes the `currentColor` bug) | ✅ |
| idle 2.5 / 45% / none | measured `2.5px / 0.45 / none`, `stroke === color` | ✅ both themes |
| port label 9.5px mono uppercase .07em | `9.5px / 600 / mono / .76px (=.08em)` | ✅ (inside the handoff's stated .07–.12em band) |

### Deviation table

| # | Deviation | Justified? |
|---|---|---|
| **D1** | Socket ring is `--border-control` `#89867C`, not the handoff's `--line2` `#C8C5BB`. | **Yes.** `#C8C5BB` on the inset is ~1.5:1 — fails WCAG 1.4.11. Shipped value measures **3.03 light / 3.53 dark** on the inset (I recomputed both from the sRGB values; the lane's numbers are correct). |
| **D2** | Core renders **7.03px**, not 8px. `44%` of the 16px content box, not the 18px border box. | **Partly.** The percent trick is the right idea (it keeps the last hand-sized faceplate sockets in the same language). But the report claims "≈8px at 18px" and it is 12% short. One-character fix (`44%` → `50%` = 8.0px). Listed as **S2**. |
| **D3** | Idle core is `--text-muted`, not `--line2`. | **Yes** — audit §6.4 fix E, already sanctioned. Measured 4.57 / 4.50 on the inset. `--line2` would have been 1.44:1. |
| **D4** | Type chip is 11px, spec says 10px. | **Partly.** The scale has no 10px step (`--text-micro: 9.5` / `--text-xs: 11`), and the lane correctly refused to write a literal. Cost is +1px on a chip. Fix in W4 by adding a `--text-2xs: 10px` token, not here. Listed as **S1**. |
| **D5** | Socket-column x lives in `portPositions.ts`, not in the registry literals the brief asked to move. | **Yes** — see §6, question 2. |
| **D6** | `is-agent-pending` borrows `--universal-connection` for accent-2. | **Yes for now** — see §6, question 1. |
| **D7** | One scoped `!important` (`.schematic-node .oj-port { width/height }`). | **Yes.** Beats inline `style={{width:12}}` on faceplates the lane doesn't own, is dated to Wave 5, and the browser confirms `distinctSizes: ["18x18"]` for every socket. |
| **D8** | `tokenLiteralGate.test.ts:43` and `docs/node-standards.md` edited outside ownership. | **Yes** — see §6, question 3. |

No unjustified deviation found. Nothing "translated freely" from the handoff.

---

## 2. DOM contract + canvas interaction matrix

### DOM contract
- `src/components/Nodes/__tests__/portDomContract.test.tsx` (new) walks **all 37**
  registered types in jsdom: 101 assertions, green. Independently re-run in scope
  (§5).
- In the **browser**: 9/9 advertised markers carry `data-node-id`, `data-port-id`,
  `data-port-type`; 9/9 are (or wrap) an `.oj-port`; `distinctSizes: ["18x18"]`;
  0 glowing; 0 animated. Identical light and dark.
- Hit-test union `.oj-port, .oj-port-row` (`NodeCanvas.tsx:292-295`) still resolves
  — 11 matches on the rig. Schematic faceplates use `.port-row`, but their targets
  are `.oj-port`s so `closest()` hits, and the whole card is covered by
  `.schematic-node` in the same union.
- **`add` / `subtract`** confirmed in the browser: `.oj-port oj-port--universal`,
  18×18, findable, **`data-port-type` is `null`**. `data-port-type` is emitted in
  ~20 places and **read nowhere in production** (grep: only tests) — so this is a
  contract-hygiene gap, not a functional break. Guard test
  `'the not-yet-migrated list only ever shrinks'` exists and pins the set exactly.

### Interaction matrix (the `.nodes-layer` `pointer-events` change — the riskiest edit)

| Interaction | light | dark | Note |
|---|---|---|---|
| box select on empty canvas | ✅ 380×180 marquee | ✅ | selects 2 nodes across a sweep |
| node drag | ✅ Δy 60px | ✅ 60px | |
| right-click empty canvas | ✅ menu opens | ✅ | |
| right-click **on a node** | no menu | no menu | **pre-existing, not a regression** — `NodeCanvas.tsx:275` sets `rightClickOnCanvas = !isOnNode`, unchanged by this lane |
| port drag → temp cable | ✅ `is-temp is-quiet`, source-kind colour, `6 4` dashes, `filter: none` | ✅ | |
| connect audio→audio | ✅ ×2 | ✅ | |
| connect control→control | ✅ | ✅ | |
| connect universal | ✅ (multiplier/math ports render + resolve `--universal`) | ✅ | |
| **cable click → select** | ✅ 1 selected | ✅ | previously impossible — the fix is real |
| cable Delete | ✅ −1 | ✅ | |
| Ctrl+Z restores it | ✅ | ✅ | |
| Alt-drag pan | ✅ `matrix(.9,0,0,.9,70,40)` → `(…,170,100)` | ✅ | |
| Ctrl+wheel zoom | ✅ 1.0 → 0.9 | ✅ | |
| Library node resize (SE handle) | ✅ 500×400 → 620×490 | — | |
| ghost mode | ✅ `animationName: none`, shadow is inset-only, `pointer-events: auto`, cables at opacity 1 | ✅ | `portGlow` is gone |
| **console + page errors** | **0** | **0** | across every run |

Sibling layers (`.clips-layer`, presence overlay, `.resize-handle`) are outside
`.nodes-layer`, so the rule cannot reach them — and the Library resize handle drag
above exercised one of them live. The risk the report flagged is retired.

**Rejection feedback for an incompatible drop: none.** Dragging an audio out onto
a control in produces no invalid class, no cursor change, no toast — the temp cable
just disappears and no connection is made. This is **pre-existing** (the lane touched
no connection logic) and belongs to the canvas-reliability lane, not S3.

**Cache invalidation** is now three effects: pan/zoom (`useEffect`), `allNodes`
(`useEffect`), and the paint-time bust moved to `useLayoutEffect`, plus the
`ResizeObserver` + `document.fonts.ready` path. All exercised below with 0.00px
drift.

---

## 3. First-frame geometry — independently reproduced

A `MutationObserver` armed **before** the connection is made (its callbacks are
microtasks, so it captures the very first `d` a path ever carries).

| Condition | cables | first painted frame → socket centre | first → settled drift |
|---|---:|---:|---:|
| add node + connect (light) | 3 | **0.00px ×3** | **0.00px ×3** |
| add node + connect (dark) | 3 | **0.00px ×3** | **0.00px ×3** |
| at rest | 3 | 0.00 start / 0.00 end | — |
| after Ctrl+wheel zoom (→0.9) | 3 | 0.00 / 0.00 | — |
| after window resize (1440→1180→1440) | 3 | 0.00 / 0.00 | — |
| after runtime theme switch | 3 | 0.00 / 0.00 | — |
| **after node resize (Library 500×400 → 620×490, cable attached)** | 1 | **0.00 / 0.00** | — |
| after a content-height change (ResizeObserver path) | 2 | 0.00 / 0.00 | — |

**`distinctPaths: 1` on every cable in every run** — each cable's `d` was written
once and never rewritten, and that first value already lands on the well. The lane's
0.00px claim reproduces exactly. This is the strongest part of the work.

`src/engine/__tests__/socketGeometry.test.ts` is a real guard, not a rubber stamp:
it recomputes the constants from the card (`14+9`, `39+12+9`, `18+8`), proves the
narrow-card clamp, and sweeps the **whole registry** asserting every faceplate
coordinate strictly between the rails is left untouched (>20 checked).

---

## 4. Schematic faceplates

- `grep` for every class name in audit §4.2 step 2 (`.sampler-side-port`,
  `.instrument-output-port`, `.library-sample-out-port`, `.output-panel-port-row`,
  `.input-panel-port-row`, `.math-port-row`, `.bundle-input-port`, `.port-row`,
  `.port-label`, `empty-slot`) against `SchematicNodes.css`: **zero hits**. Every
  block was moved, not copied. 3042 → 2799 lines, `@import './_sockets.css'` at
  the top.
- `grep -n "portGlow\|scale(1.2\|box-shadow"` on `_sockets.css` → **nothing**.
  `Port.css` → only `--shadow-inset`, `--shadow-inset, --focus-ring`, and `none`.
  `SchematicNodes.css` still has 30 `box-shadow`s but every one is faceplate *card*
  chrome (looper loop hover, sampler drop zone, keyboard-active ring) — no port
  rule among them. Wave 5's taste pass owns those; the port claim holds.
- The one `!important` is scoped, commented with its delete condition, and
  empirically necessary (the faceplates still pass inline `width: 12`).
- The three not-yet-migrated faceplates: guard test present and exact; `add` /
  `subtract` verified **in the browser** to render 18px `.oj-port` wells and be
  findable/connectable; `minilab3-visual` verified findable in jsdom only (no MIDI
  device in either environment — same limitation the lane declared).

---

## 5. Gates

| Gate | Result |
|---|---|
| `bun run test:run -- packages/oj-ui src/components/Canvas src/components/Nodes src/utils src/engine …/tokenLiteralGate.test.ts` | ✅ **62 files / 657 tests**, exit 0 |
| `bunx tsc --noEmit -p tsconfig.app.json` | ✅ exit 0 |
| `bunx eslint src packages` | ✅ exit 0 |
| `bun run build` | ✅ exit 0 |
| `bunx figma connect parse` | ✅ exit 0 |
| browser, both themes | ✅ 0 console errors, 0 page errors |

---

## 6. The lane's three questions

**1 — `is-agent-pending` borrowing `--universal-connection` for accent-2.**
Accept for this lane. The values are already *numerically identical* to the
handoff's accent-2 (`oklch(.66 .19 300)` / `oklch(.72 .19 300)`), so nothing looks
wrong today; the objection is purely that a wiring token is doing state duty.
**Recommendation for W4:** add one semantic token — `accentTwo` — to the DTCG
source, and repoint *both* `--universal-port` and `--universal-connection` at it
(note there are already two identical violet tokens, one of which is unreferenced;
folding them is the same edit). Not a blocker.

**2 — Geometry home: `portPositions.ts` vs registry literals.**
The lane's call is **right**, and the brief's instruction was the weaker one. A
normalized `x` cannot express a fixed 23px inset across widths from 50px
(`keyboard-key`) to 660px — the same literal means 46% on one card and 3.5% on
another, so per-node literals would duplicate `dimensions.width` into a second place
and rot on the first resize. One resolver is code-value #2 (one pillar, no fork), the
`y` literals — which *are* per-node-expressible — did move, and
`socketGeometry.test.ts` recomputes them so they cannot drift. The one real cost is a
semantic overload: `x: 0` now means "input side", not "left edge", on a numeric
field. **Recommend for Wave 5:** put `side: 'input' | 'output'` on `PortDefinition`
and reserve `x` for genuine faceplate coordinates, so the meaning is in the type
rather than in a doc comment. Not a blocker.

**3 — The two out-of-ownership edits.** Both accepted.
- `tokenLiteralGate.test.ts:43` — the old assertion (`Port.css` contains no
  `box-shadow` at all) is *incompatible with D7*: the well needs `--shadow-inset` to
  be a hole and `--focus-ring` for focus. The rewrite enumerates exactly those two,
  rejects everything else, and adds `not.toContain('drop-shadow')` — strictly
  stronger than what it replaced. Diff is **8 insertions, 1 deletion**, and the
  timeline lane has not touched this file, so there is no collision.
- `docs/node-standards.md` — the doc said `x: 0 = left edge`, which D5 makes false.
  Leaving it would ship a lie to every future node author. "Docs are part of the
  feature." Edit is confined to the port-position section and the two templates.

---

## 7. Taste

Read against the handoff vignette in light and dark
(`{light,dark}-01-rig.png`, `-03-nodeshell.png`, `-04-selected.png`,
`-07-selected-cable.png`, `light-13-bundle-panel.png`).

**What lands.** The socket genuinely reads as a *hole* — the inset fill plus the
byte-exact `inset 0 1px 3px rgba(0,0,0,.22)` does the whole job at 18px, in both
themes, with no cheat. The idle core is unambiguously legible at a glance and does
not read as "broken connection"; the teal core on a connected socket is the single
clearest state change on the canvas. The grip dots are quiet enough to be an
affordance and not a decoration. The type chip's mono voice correctly says "machine
fact" against the Outfit title. And the selected cable is the best detail in the
lane: the accent halo sits *under* the wire so the wire keeps its true signal
colour — a performer never loses the audio/control read to a selection.

**Things a musician might pause at** (none are state misreads except M1):

- **The bundle label truncates to four glyphs.** See **M1** — the one must-fix.
- **The selected node wears the full focus ring.** `.is-selected` stacks
  `border-color: accent` + `0 0 0 .5px accent` + `--focus-ring` (3px at 28%). On a
  white card that reads as a ~4px orange halo, considerably louder than the "1.5px
  accent edge" the comment describes, and it makes mouse-selection look identical to
  keyboard focus. Consider dropping `--focus-ring` from `.is-selected` and leaving
  it to `:focus-visible`. (`{light,dark}-04-selected.png`.)
- **The port row on a min-width card is cramped.** `AUDIO IN  AUDIO OUT` sit close
  enough to read as one run-on phrase rather than two mirrored groups. This is
  faithful to `.nj-piorow`; it is the 190px card, not the rule. A wider
  `--node-min-width` in W4 would fix it for free.
- **An idle teal cable is hard to tell from an idle grey one** when it runs nearly
  horizontal. Both measure correct (`oklch(.6 .12 200)` vs `#8F8C82`), but at 2.5px /
  45% on the warm canvas the hue barely survives. Spec-exact, so not a lane finding —
  worth a note for whoever owns the canvas legibility pass.
- **The "Config" node's output is still a flat blue disc**
  (`InstrumentVisualNode.css .visual-port`, visible in `light-13-bundle-panel.png`).
  It is outside `.schematic-node`, so `_sockets.css` cannot reach it. Declared Wave-5
  debt — but it is on the *default drill-down rig*, so it is the most visible
  remaining break of "one socket language."
- Ghost mode reads correctly: the cards dissolve, the patch comes forward, nothing
  glows. The sockets fade with their card (documented, and correctly diagnosed as an
  opacity-inheritance problem that needs a ghost-mode redesign, not a socket change).
- Temp cable, dragging shadow, and the dashed placeholder well all read exactly as
  intended.

---

## 8. Ranked must-fix

**M1 (blocking) — the bundle port label truncates to 4–5 glyphs, making sibling
bundles indistinguishable.** `src/components/BundlePortGroup.css` +
`src/components/Nodes/_sockets.css` (both in this lane).

Measured in the browser (`gate6.mjs`): row 185px, label needs **90px**, gets **52px**
→ renders `KEYB… (10)`. A keyboard with Row 1 / Row 2 / Row 3 / Pedal bundles
produces four rows that all read `KEYB… (…)`. A performer cannot tell which bundle
they are plugging into — that is a state misread.

This is a **regression this lane introduced**, not inherited: before, the label was
12px Outfit with the count nested inside it and `max-width: 140px`, and
`"Keyboard Row 1 (1)"` measured ~98px into ~127px of available room — it did not
truncate. The change to 9.5px mono **uppercase + .08em tracking** made the same
string *wider* (91px for the name alone), and moving `.bundle-count` out into its own
`flex: 0 0 auto` sibling took ~38px more off the flexible label.

Cheapest honest fixes, in order of preference:
1. Raise `.input-panel-node` off its 140px width (already flagged as Wave-5 debt in
   the lane report §7.4) so the row has room — and re-measure.
2. Or keep the micro voice but drop `text-transform: uppercase` /
   `letter-spacing` on `.bundle-label` only; lowercase mono at 9.5px buys back ~20%.
3. Or let the count shrink/wrap instead of the name — the name is the identity, the
   count is the detail.
Acceptance: two sibling bundles on one keyboard must be distinguishable without
hovering for the `title`.

**S1 (should) — type chip is 11px, spec is 10px.** Add `--text-2xs: 10px` to the
DTCG source in W4 and point `.oj-node__type` at it. Do not write a literal here.

**S2 (should) — the core dot is 7.03px, spec is 8px.** `width/height: 44%` resolves
against the 16px content box. `50%` gives exactly 8.0px at 18px and preserves the
percent behaviour at every smaller size. One-character change in `Port.css`.

**S3 (should) — `.oj-node.is-selected` should not carry `--focus-ring`.** See §7.

**N1 (note) — narrow the `useLayoutEffect` dependency.**
`NodeCanvas.tsx:1077` depends on `[nodes, connections.size]`, and `nodes` is a Map
whose identity changes on every node-position write — so every drag frame forces a
synchronous extra render before paint (the old rAF coalesced these). I measured
**60fps, zero long tasks, 38 DOM writes for 40 pointer moves** on a 4-node rig, so
there is no evidence of harm at this scale; but keying the effect on node *identity*
(e.g. a joined id string) rather than the whole Map would keep the first-frame win
with none of the per-frame cost. Not a blocker.

**N2 (note) — `.oj-port:focus-visible` is currently unreachable.** The socket is a
`<span>` with no `tabIndex` and no consumer adds one, so the focus-ring branch never
fires. Either make the socket focusable (it is a connection target — arguably it
should be) or drop the rule.

**N3 (note) — no rejection feedback for an incompatible drop.** Pre-existing; canvas
lane, not S3.

**N4 (note) — `<title>` renders after the paths inside `.oj-cable-group`.** SVG a11y
wants it first.

---

## 9. Verdict

**COMMIT.** The lane does exactly what D7 asked and proves it rather than asserting
it: the socket is a hole with byte-exact depth, nothing on the canvas glows any
more, the first painted frame of every cable already lands on the well (reproduced
independently at 0.00px through add, zoom, node resize, window resize and theme
switch), and two pre-existing defects — cables that were never clickable, and the
ghost-mode port glow — are genuinely fixed. All six gates are green, both themes run
error-free, and every deviation from the handoff is either sanctioned by the audit or
the only correct reading of the constraint.

**M1 must land in the same commit or the next one** — it is two lines in files this
lane already owns, and left alone it is the one place a performer can misread which
socket they are wiring.
