# W3-S3 — sockets, node cards, cables

Lane: the signature components of a node-based instrument. Branch
`t3code/openjammer-redesign-timeline`, same worktree, disjoint ownership (D16).
Nothing committed — the orchestrator commits after review.

**Gate:** `bunx tsc --noEmit -p tsconfig.app.json` ✅ · `bunx eslint src packages` ✅ ·
`bun run test:run` **181 files / 1923 tests** ✅ · `bun run build` ✅ ·
`bunx figma connect parse` ✅ (all five of this lane's `.figma.tsx` parse) ·
`bun run ladle:build` ✅.
**Browser (node harness, one Chromium, port 5202, server stopped):** zero console
errors, zero page errors, both themes.

---

## 1. What changed

### `Port` — the recessed socket well (D7)

- `packages/oj-ui/src/components/Port/Port.css` — rewritten. 18px `inline-grid`
  well: `--bg-tertiary` fill, `1px solid var(--border-control)`,
  `box-shadow: var(--shadow-inset)`, `cursor: crosshair`. `::after` core dot,
  `--text-muted` idle, `--control-connection` / `--audio-connection` /
  `--universal-connection` when `.is-connected`, `--success-ink` when `.is-active`.
  Hover = a 1px `--accent-primary` ring on the well (`border-color`, no scale,
  no transform — the target never moves). `:focus-visible` =
  `var(--shadow-inset), var(--focus-ring)`. `.is-placeholder` = dashed, no core,
  no depth. **No glow in any state, no pulse, no keyframes.**
- **The core is sized in percent (44%), not px.** ~8px at 18px, and it keeps the
  same object at 10/12/14px — which is what lets the last hand-sized faceplate
  sockets read as one language before Wave 5 rebuilds them.
- `Port.tsx:34-60` — `direction` is now destructured-but-unread (`_direction`)
  with the reason in a comment: it is the ROW's business, it must not reach the
  DOM (`direction` is not a valid `span` attribute), and D7 retired the
  directional colours. **Fixes W2-S2-REVIEW D4**: the class is now always
  `oj-port--<kind>`; the `direction &&` guard used to emit a colourless port for
  any `<Port kind="audio" />` without a direction (`MathNode` renders exactly
  that).
- `Port.test.tsx` — rewritten for the new model (11 cases), including "never
  leaks `direction` onto the DOM" and "carries the kind class without a
  direction". `Port.stories.tsx` — **new** (Idle / Connected / States / Sizes).
  `Port.figma.tsx` unchanged (already a valid example).

### `PortRow` — socket + name

- `PortRow.css` — label is `600 9.5px var(--font-mono)` uppercase,
  `letter-spacing: var(--tracking-micro)`, `--text-muted`; `gap: 7px`;
  **`min-height: 24px`** so the row is a real target around an 18px well.
  Inputs `[socket][label]`, outputs `[label][socket]`. Hidden-label variant keeps
  the socket. Dropped the italic on `.is-disabled` (italic at 9.5px mono is
  unreadable; the 0.45 opacity + `not-allowed` carries it).
- `PortRow.tsx` — docstrings only; `...rest` still forwards to the `Port`
  (the load-bearing contract). `PortRow.test.tsx` unchanged and green.
- `PortRow.stories.tsx` rewritten (rows shown inside a card, plus a `Gated` story);
  `PortRow.figma.tsx` given a real example.

### `NodeShell` — the node card

- `NodeShell.tsx` — header now emits `.oj-node__grip` (2×2 `<i>` dots,
  `aria-hidden`, new `grip?: boolean` prop, default true) before the title; the
  ports moved **inside** `.oj-node__content` as its first child;
  `__ports-left/-right` → `__ports-in/__ports-out` (no other consumer in the
  repo — grepped `src`, `packages`, `e2e`, `.ladle`).
  New `hasPorts()` guard: `inputs={[]}` is *no ports*, not an empty 24px row —
  every port-less node used to open its body with a blank row and a 12px gap.
- `NodeShell.css` — rewritten. Card: `--bg-node`, `1px --border-subtle`,
  `--radius-lg`, `--shadow-overlay`. Header `10px 14px`, `--bg-node-header`,
  bottom hairline, `cursor: grab`, grip dots in `--border-strong`, `600 15px`
  Outfit title, right-aligned type chip (`500 11px` mono uppercase
  `--tracking-micro`, `--text-muted` on `--bg-tertiary`, `--radius-sm`, `4px 7px`).
  Body `12px 14px`, `gap: 12px`. Ports = one `space-between` row.
  - selected: `border-color: var(--accent-primary)` + `0 0 0 0.5px accent` +
    `var(--focus-ring)` — a 1.5px accent edge **with no layout shift** (growing
    the border to 1.5px would move the card half a pixel).
  - dragging: `opacity: .96` + `--shadow-overlay` plus one extra layer
    (`0 18px 40px color-mix(--text-primary 14%)`) — the handoff's
    `app-styles.css .node.dragging`, tokenised.
  - agent-pending: violet (`--universal-connection`) **hairline** pulse, 1px, no
    halo; stilled by the blanket reduced-motion rule.
  - bypassed / window-open / watchdog-bypassed keep their meaning on tokens
    (the bypass strike is now `--border-strong`, the window-open underline 1px
    accent, the window button a real hover/pressed pair).
- `NodeShell.test.tsx` rewritten (8 cases incl. "the port row is the FIRST child
  of the body" and the empty-array case). `NodeShell.stories.tsx` — **new**.
  `NodeShell.figma.tsx` given a real example.

### `Cable`

- `Cable.tsx` — the `<g className="oj-cable-group">` now holds **two** paths on
  the same `d`: an invisible 14px `.oj-cable__hit` (the click target, audit
  UI-022) and the visible wire over it, which is `pointer-events: none`. State
  classes are mirrored onto the group so the halo can sit *under* the wire.
  `is-quiet` is applied at signal 0. Memo comparator, `--oj-cable-signal` name
  and `.oj-cable-group` all unchanged.
- `Cable.css` — rewritten to the handoff formulas:
  `stroke-width: calc(2.5px + sig*2.5px)`, `opacity: calc(.5 + sig*.5)`,
  `filter: drop-shadow(0 0 calc(sig*7px) currentColor)`; idle = 2.5px / 45% /
  `filter: none`. **`color` is set alongside `stroke` on every kind** — that is
  the audit's `currentColor` bug: the glow used to take the SVG's inherited text
  ink instead of the wire's own colour. Audio is teal (`--audio-connection`).
  Selected = full opacity + 1px wider + an accent halo carried by the hit path,
  so the WIRE keeps its true signal colour; **the infinite glow animation is
  gone**. Bundled heavier. Temp = dashed, in the source port's kind colour,
  `filter: none`; only the marching dashes stop under reduced motion — the
  signal-driven width/opacity stays, because it is a meter.
- `Cable.test.tsx` — three new cases (hit path first and on the same curve,
  `is-quiet` at rest, state classes mirrored on the group); the click test now
  targets the hit path. `Cable.stories.tsx` gains `Quiet`; `Cable.figma.tsx`
  given a real example.

### Geometry — no first-frame cable snap

- `src/utils/portPositions.ts` — new exported socket geometry measured off the
  rendered card: `SOCKET_INSET_PX 23` (14 body padding + 9 radius),
  `SOCKET_ROW_TOP_PX 60` (39 header + 12 padding + 9 radius),
  `SOCKET_ROW_STEP_PX 26`, plus `socketColumnX(width, side)` and
  `socketRowY(height, index)`. `resolveSocketX` pulls an edge-anchored `x`
  (`<= 0` / `>= 1`) in to the real socket column for **both** the explicit and
  the dynamic path; anything strictly between the rails is a faceplate
  coordinate and is untouched. The column is clamped at 30% of the width so the
  two columns can never cross on a card whose nominal box is tiny
  (`keyboard-key` declares 50×50). `DEFAULT_PORT_LAYOUT` bands moved to
  `0.45…0.85` (top-weighted — the sockets open the body, they do not straddle
  the middle).
- `src/engine/registry.ts` — the port-template comments now say what x means;
  the `y` literals of the four cards laid out by the shared `NodeShell` row moved
  to their real body rows: `effect` 0.5→0.6, `pan`/`width` 0.5→0.667,
  `multiplier` 0.33/0.67/0.5 → 0.6/0.86/0.6. Guarded by
  `src/engine/__tests__/socketGeometry.test.ts`.
- `src/components/Canvas/NodeCanvas.tsx:246-251` — `getPortCanvasPositionForSelection`'s
  duplicated fallback (its own `port.position.x * nodeWidth` math) **deleted**;
  it now delegates to `calculatePortPosition`, so the marquee and the cables can
  no longer disagree about where a socket is. (The `180×120` literals the audit
  flagged were already gone; the duplication was not.)
- `src/components/Canvas/NodeCanvas.tsx:1077-1084` — the post-paint cache bust
  moved from `requestAnimationFrame` to **`useLayoutEffect`**. Connections render
  before nodes, so the first pass of a mount or a node add could only use
  fallback math and the rAF corrected it one frame later — a visible snap from
  the card corner into the well. A layout effect runs after the DOM commit and
  **before** paint, so the re-render it schedules is flushed synchronously and
  the first painted frame is already measured. This is what makes the proof below
  possible; the registry/fallback work is the belt to its braces.

### Schematic faceplates — one socket language

- **`src/components/Nodes/_sockets.css` (new, 158 lines)** — imported at the top
  of `SchematicNodes.css`. Implements the row treatment once for `.port-row`,
  `.bundle-port-row`, `.math-port-row`, `.output-panel-port-row`,
  `.input-panel-port-row`, the `.port-label` / `.empty-slot-label` micro voice,
  the empty-slot rule, and the POSITION (only) of `.instrument-output-port`,
  `.sampler-side-port`, `.library-sample-out-port`.
- `SchematicNodes.css` **3042 → 2799 lines**. Every extracted block was deleted,
  not copied: the bespoke port disc rules (`.instrument-output-port` 16px teal
  disc + `0 0 6px` glow, `.bundle-input-port` 12px on a 2px ink border with
  `#888`/`#f0f0f0` literals, `.sampler-side-port` and `.library-sample-out-port`
  with their `0 0 6px` glows and `scale(1.2)` hovers) are gone. Those elements are
  already `<Port>`s, so they now inherit the shared well.
- The sampler's and library's sockets **moved inside the card** (`left: -7px` →
  `left: 14px`, `right: -7px` → `right: 14px`): D7's "the well is in the body,
  the cable slides under the edge".
- One `!important`, scoped and documented: `.schematic-node .oj-port { width/height: var(--port-size) }`.
  Instrument / Sampler / Library / Keyboard / the panel nodes still pass
  `style={{ width: 12 }}` to their `<Port>`, and inline styles can only be
  answered with `!important`. It is labelled **DELETE THIS RULE when Wave 5
  removes the inline sizes**, and the browser run confirms it works
  (`distinctSizes: ["18x18"]`, every socket on the canvas).
- `src/components/BundlePortGroup.tsx` — inline `width: 14 / 12` on the two
  bundle `<Port>`s removed (no `!important` needed there); the channel count
  moved out of the truncating label span into its own sibling, so a long bundle
  name ellipsises and the number still reads.
  `BundlePortGroup.css` — row shape delegated to `_sockets.css`; label on the
  micro mono voice; `.bundle-channel-marker` is now a small solid core, not a
  mini-well (nothing plugs into a channel, so it must not look like a socket);
  literal `#fff` / `#888` fallbacks and the empty `.expanded .bundle-triangle`
  rule removed.

### Two canvas defects found and fixed while proving the work

- **No cable had ever been clickable** (`NodeCanvas.css` `.nodes-layer`).
  `.nodes-layer` is a full-bleed 10000px div at `z-index: 10` with
  `pointer-events: auto`, so it swallowed every pixel between the cards; the
  wire's `pointer-events: stroke` was correct and permanently covered.
  `elementFromPoint` along the whole cable returned `DIV.nodes-layer` at every
  sample. The layer is now `pointer-events: none` with `.nodes-layer > * { auto }`
  — `pointer-events` is inherited, so the schematic nodes' `display: contents`
  wrapper passes it down to the real card. Re-verified in the browser: box
  select, node drag (54px), the right-click menu and port drags all still work,
  and a cable click now selects.
- **The ghost-mode port glow is gone** (`@keyframes portGlow`, an 8→16px pulsing
  halo on every socket). D7 bans a glowing port everywhere and an X-ray view is
  not an exception. Ghost cables keep a raised width floor and full opacity.

### Docs

`Port` / `PortRow` / `NodeShell` / `Cable` docstrings rewritten to the new model.
`docs/node-standards.md` "Position Normalization" + the audio-port templates
updated: `x: 0 / 1` names a **side**, not a pixel, and the y of a shared-card
socket is its body row.

---

## 2. API changes

| Component | Change | Compatibility |
|---|---|---|
| `Port` | `direction` kept (row layout + Code Connect) but is now presentational only — it never selects a colour and never reaches the DOM | source-compatible; the `oj-port--<kind>-<direction>` class scheme is gone |
| `Port` | class is now always `oj-port--<kind>` even without a `direction` | fixes W2 D4 (colourless ports) |
| `NodeShell` | new `grip?: boolean` (default `true`) | additive |
| `NodeShell` | `.oj-node__ports-left` / `-right` → `.oj-node__ports-in` / `-out`, and the row moved inside `.oj-node__content` | no other consumer in the repo |
| `NodeShell` | empty-array port slots no longer render the row | behavioural fix |
| `Cable` | the group now renders two `<path>`s; the visible wire is `pointer-events: none` and `.oj-cable__hit` is the target; state classes mirrored on `.oj-cable-group` | `.oj-cable`, `.oj-cable--*`, `.is-*`, `--oj-cable-signal`, `.oj-cable-group` all preserved; a `container.querySelector('path')` now finds the hit path first |
| `portPositions.ts` | exports `SOCKET_INSET_PX`, `SOCKET_ROW_TOP_PX`, `SOCKET_ROW_STEP_PX`, `socketColumnX`, `socketRowY` | additive |

---

## 3. Tests

| File | Status |
|---|---|
| `packages/oj-ui/src/components/Port/Port.test.tsx` | **rewritten** — 11 cases |
| `packages/oj-ui/src/components/NodeShell/NodeShell.test.tsx` | **rewritten** — 8 cases |
| `packages/oj-ui/src/components/Cable/Cable.test.tsx` | **extended** — 3 new cases, click test retargeted |
| `packages/oj-ui/src/components/PortRow/PortRow.test.tsx` | unchanged, green (the `data-*` forwarding contract) |
| `packages/oj-ui/src/components/KeyTile/KeyTile.test.tsx` | unchanged, green |
| `src/components/Nodes/__tests__/portDomContract.test.tsx` | **new** — renders all 37 registered node types and asserts the canvas can find every advertised port and that it is (or wraps) an `.oj-port` carrying `data-port-type`. 101 assertions |
| `src/engine/__tests__/socketGeometry.test.ts` | **new** — 11 cases pinning the constants to the rendered card, the edge→column resolution, "every faceplate coordinate is left alone" (checked across the whole registry), and the shared-card `y` literals |
| `src/components/Arrangement/__tests__/tokenLiteralGate.test.ts` | **one assertion rewritten** (see deviations) |

`portDomContract` found six real gaps on first run; three were environment-correct
(`midi` / `minilab-3` render the honest "Web MIDI unavailable" card under jsdom,
`instrument-visual` has no rows on a fresh node) and three are genuine faceplate
debt, listed below and pinned by a `NOT_YET_ON_THE_SHARED_SOCKET` set with a
guard test so the list can only shrink.

---

## 4. Proof (browser)

Harness `plans/redesign-new-dna/.scratch/w3-s3/verify.mjs`, run under **node**,
one Chromium, dev server on 5202 (**stopped**). Machine-readable results:
`plans/redesign-new-dna/.scratch/w3-s3/results.json`.

| Claim | Light | Dark |
|---|---|---|
| console + page errors | 0 | 0 |
| `[data-port-id]` markers vs `.oj-port` count | 10 / 10 | 10 / 10 |
| markers that are (or wrap) a socket | 10 / 10 | 10 / 10 |
| distinct socket sizes on the canvas | `["18x18"]` | `["18x18"]` |
| ports with a non-inset shadow (a glow) | 0 | 0 |
| cables built (Keyboard→Keys→Effect→Speaker) | 3 | 3 |
| **distinct `d` values per cable, ever** | **1, 1, 1** | **1, 1, 1** |
| **first-painted-frame endpoint vs settled endpoint** | **0.00px drift ×3** | **0.00px drift ×3** |
| **settled endpoint vs socket centre** | **0.00px ×3** | **0.00px ×3** |
| idle cable | 2.5px / 0.45 / `filter: none`, `stroke === color` | same |
| temp cable | `oj-cable--audio is-temp is-quiet`, teal, `6 4` dashes | same |
| cable clickable / selects | yes / 1 | yes / 1 |
| marquee · node drag · context menu after the pointer-events change | yes · 54px · yes | yes · 54px · yes |

The first-frame proof is a `MutationObserver` armed **before** the connection is
made; its callbacks are microtasks, so it captures the very first `d` a cable
path ever carries. Every cable's `d` was written once and never rewritten, and
that first value already lands on the socket centre — there is no snap to see.

**Screenshots** — `plans/redesign-new-dna/.scratch/w3-s3/{light,dark}-*.png`:

| File | What |
|---|---|
| `*-01-rig.png` | the whole rig, four nodes, three cables |
| `*-02-node-closeup.png` | a schematic faceplate's sockets (Instrument) |
| `*-03-nodeshell.png` | the `NodeShell` card close up — grip, title, type chip, port row |
| `*-04-selected.png` | selected node |
| `*-05-dragging.png` | node mid-drag |
| `*-06-temp-cable.png` | temp cable mid-drag |
| `*-07-selected-cable.png`, `*-07b-selected-cable-crop.png` | selected cable + halo |
| `*-08-ghost.png` | ghost mode |
| `*-09-bundle-inside.png`, `*-10-bundle-closeup.png` | the bundle port group (inside the instrument) |

**Contrast** (computed, sRGB):

| | light | dark | floor |
|---|---:|---:|---|
| idle core `--text-muted` on the inset well | **4.57** | **4.50** | 4.5 |
| well ring `--border-control` on the inset | **3.03** | **3.53** | 3.0 (1.4.11) |
| well ring on the card | 3.64 | 3.96 | 3.0 |
| port label on the card | 5.49 | 5.05 | 4.5 |
| type chip on the inset | 4.57 | 4.50 | 4.5 |

W2-S2-REVIEW's D9 asked for a `--border-control` re-check against the socket's
real background; the shipped `#89867C` / `#807C6F` clears 3:1 on the inset in
both themes, so **no token change is needed** from this lane.

---

## 5. Deviations from the handoff / brief (with reasons)

1. **Idle core is `--text-muted`, not `--border-strong`.** The handoff's
   `.nj-sock::after{background:var(--line2)}` is 1.44:1 on the inset — a
   disconnected socket would be nearly invisible. This is audit §6.4 fix E,
   already sanctioned.
2. **The socket-column x lives in `portPositions.ts`, not in 63 registry
   literals.** The brief asked for the literals to move. A normalized `x` cannot
   express a fixed 23px inset across node widths from 50px to 660px — the same
   literal means 46% on `keyboard-key` and 3.5% on `keyboard-visual`. Writing it
   per node would duplicate every `dimensions.width` into a second place and rot
   on the first resize. So `x: 0 / 1` now *names the side* (documented in the
   template comments and in `docs/node-standards.md`) and one resolver turns it
   into the column — code value #2, one pillar, no fork. The `y` literals, which
   are per-node-expressible, **did** move, and `socketGeometry.test.ts`
   recomputes them from the shared constants so they cannot drift.
3. **`getPortCanvasPositionForSelection`'s literals** were already gone when I
   arrived (it used `getNodeDimensions`); what remained was a *duplicate* of the
   fallback, which I deleted in favour of delegating to `portPositions`.
4. **`is-agent-pending` uses `--universal-connection` for accent-2.** No token
   carries the handoff's violet as a *state* colour; `--universal-connection` is
   the only semantic token holding `oklch(… 300)`. Semantically defensible (violet
   is this palette's "not yet typed / not yet yours" hue) but it is a wiring token
   doing state duty. **Owner call:** if Wave 4/5 wants it clean, add
   `accentSecondaryAlt`/`accent2` to the theme files; I did not touch tokens.
5. **One `!important`** (`.schematic-node .oj-port` size), scoped, dated to Wave 5,
   and the only way to beat the inline `style={{ width: 12 }}` those faceplates
   pass without editing `.tsx` files this lane does not own.
6. **`tokenLiteralGate.test.ts:43` rewritten** (a file the TA2b lane owns —
   flagging it explicitly). It asserted `Port.css` contains **no** `box-shadow`,
   which D7's own spec violates: the well needs `--shadow-inset` for depth and
   `--focus-ring` for focus. The assertion now enumerates the two sanctioned
   values, rejects everything else, and adds `not.toContain('drop-shadow')` —
   strictly stronger than the original (the old one was satisfied by a port with
   no depth *and* no focus ring). One assertion, no other line in that file
   touched.
7. **`docs/node-standards.md` edited** (not in the ownership list). It documented
   `x: 0 = left edge`, which my change makes false. "Docs are part of the
   feature"; the edit is confined to the port-position section and the two port
   templates.

---

## 6. What I could NOT verify

- **Audio.** No listening pass. Nothing in this lane touches the audio path — it
  is CSS, DOM structure and one geometry resolver — but "codex never signs off on
  feel" applies to me too: the founder's pass with sound playing is still owed.
- **Native (Tauri) shell.** Browser only.
- **Reduced motion end-to-end.** The Cable exemption and the `is-temp` rule are
  correct by inspection and the blanket rule lives in `global.css` (W1), but I did
  not run the suite under `prefers-reduced-motion: reduce`.
- **The MIDI faceplates** (`midi`, `minilab-3`) render their honest
  "Web MIDI unavailable" card under both jsdom and headless Chromium, so their
  sockets were never rendered in any run of mine. Needs a machine with a MIDI
  device, or a `requestMIDIAccess` stub, to confirm.
- **`keyboard-visual` / `midi-visual` at scale.** Their 31 key sockets are
  `KeyTile`s (lane P3/P4) — I confirmed the DOM contract, not the look.

## 7. Risks and known debt

1. **`.nodes-layer` pointer-events** is the highest-risk change here: it alters
   canvas hit-testing globally. I re-verified box select, node drag, the
   right-click menu, port drag-to-connect and cable click in both themes, and the
   whole unit suite is green — but an adversarial pass should also try clip
   drag (`.clips-layer`), the presence overlay and the resize handles. Those live
   in *sibling* layers, not inside `.nodes-layer`, so they are untouched by the
   rule; that is reasoning, not a run.
2. **Faceplates not yet on the shared socket** (pinned in
   `portDomContract.test.tsx`, Wave 5 owns the files):
   - `MathNode.tsx:52-62` — real `<Port>`, missing `data-port-type` (`add`, `subtract`).
   - `MiniLab3Visual.tsx:284-312` — `.minilab3-key-port` is a bare `<div>`, not a
     `<Port>`, and omits `data-port-type` (`minilab3-visual`).
   Both are one-line fixes in files this lane does not own. Cables land correctly
   on all three types today.
   - `InstrumentVisualNode.css` `.key-port` / `.visual-port` still repaint their
     sockets as solid discs (visible in `*-09-bundle-inside.png`, the "Config"
     node's blue output dot). Not `.schematic-node`, so the shared size rule does
     not reach them either.
3. **Ghost mode's sockets are dimmed with the card.** `.ghost-mode .node` fades
   with `opacity`, and no descendant can be more opaque than its ancestor. The
   banned glow is gone and the sockets stay grabbable, but making them *brighter*
   than the card requires dissolving the card's paint instead of its alpha — a
   ghost-mode redesign for the canvas-reliability lane. Documented in
   `NodeCanvas.css`.
4. **`.input-panel-node` is 140px wide** (`SchematicNodes.css`, a card rule, not a
   port rule), which is below `--node-min-width: 190px` and is why a bundle name
   still ellipsises after the count was rescued. Wave 5.
5. **W2-S2-REVIEW V7 survives**: the Instrument faceplate's italic "Pedal" row
   struck through by a divider (`*-02-node-closeup.png`). Its sockets are correct
   now; the body is Wave 5.
6. **`SchematicNodes.css` is still 2799 lines.** Audit §4.2 step 1 (make
   `.schematic-node` a thin alias of `.oj-node`) and step 3 (split per node
   family) are deliberately NOT done here — they are card/faceplate work, not
   socket work, and doing them would have collided with Wave 5's ownership.
