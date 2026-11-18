# UX-1C — canvas grammar

Builder lane report. Written 2026-09-02. Branch `t3code/openjammer-redesign-timeline`,
worktree `t3code-2faff191`. Scratch, scripts and screenshots: `.scratch/ux-1c/`.

Eight items, all landed. Two bugs were found *while verifying* that were not in the brief
(one of them introduced by this lane's own U12 change) and are fixed here; both are written
up in full below rather than folded quietly into an item.

---

## Gates

| gate | result |
|---|---|
| `bunx tsc --noEmit -p tsconfig.app.json` | **clean** (no output, exit 0) |
| `bun run lint` | exit 0, **2 warnings** in `src/audio/wasm/pkg/**` (UX-1A's generated files — see the Fix round, 1C-13). Corrected: the first draft of this table said "clean" |
| `bun run test:run` | **3189 passed / 1 failed (249 files)** — the one failure is a pre-existing load flake in another lane's file, see *Known failures* |
| `bunx vite build` | **`✓ 1725 modules transformed. ✓ built in 5.95s`** |
| `bun run build` (`tsc -b && vite build`) | **broken by another lane at 12:00**, see *Known failures* |
| `bunx figma connect parse` (in `packages/oj-ui`) | **53 components parsed**, `Port` among them (`sourceLocation.line 45`) |

Browser verification ran headless Chromium under `node` (never bun),
`--autoplay-policy=no-user-gesture-required`, viewport 1440×900, **both themes** and
reduced motion, against `http://localhost:5252`. Vite refused to stay up on the shared
config — lane UX-1B's Chromium profile under `.scratch/ux-1b/udd/…/Network/Cookies` is
locked by Windows and chokidar took the dev server down with `EBUSY` mid-run. As the brief
anticipated, the runs use a lane-local config, `.scratch/ux-1c/vite.config.ts`, which
re-exports the root config with `**/.scratch/**` added to `server.watch.ignored`. Nothing
the app serves changes.

---

## 1 — U5: outputs fan out

**What changed**

- `src/components/Nodes/NodeWrapper.tsx:249-307` — `handlePortMouseDown`'s pending-disconnect
  lookup is now **asymmetric**. It was symmetric (`if (port.direction === 'output') … else …`,
  the old `:264-266`), so mousedown on *any* connected port armed a reconnect and the drop
  took the `reconnectConnection` branch, which deletes the old edge in the same `set()`.
  Only an **input** arms it now; grabbing an output always starts a new cable.
- `src/components/Canvas/NodeCanvas.css:31-56` — the connections layer still rises to
  `z-index: 100` during a drag (the loose end must paint over the cards), but every settled
  cable's 14px `pointer-events: stroke` hit path now goes inert for the duration:
  `.node-canvas.is-connecting .oj-cable__hit { pointer-events: none }`. Raise the paint, drop
  the pointer. This mirrors the precedent `Cable.css` already sets for the temp cable.

**Evidence** (`.scratch/ux-1c/v1-fanout.mjs`, log `v1.log`, shots `A-01`/`A-02`/`B1`/`B2`)

FH-1 task 3 verbatim — add an effect between the instrument and the speaker:

```
  LOST edges:   []
  GAINED edges: ["effect:delay/audio-out -> effect:distortion/audio-in"]
  SPEAKER STILL FED? true
  cables leaving Delay audio-out: 2
  total connections: 6 -> 7          <- an ADD, not a move
```

UX-INV's Q5 numbers for the same steps were `LOST: ["effect:delay/audio-out -> speaker/audio-in"]`,
`SPEAKER STILL FED? false`, `6 before, 6 after`.

The z-order half, measured with `elementFromPoint` at the drop target mid-drag:

```
  B1  drag new IN -> Delay OUT (occupied)   hit@target mid-drag: PORT(audio-out)
  B2  drag new OUT -> Speaker IN (occupied) hit@target mid-drag: PORT(audio-in)
      cables into Speaker audio-in: 1       <- the one-input rule is reachable by mouse again
```

Q5 measured `NOT-A-PORT(path)` and zero graph change for both.

Unit tests: `src/components/Nodes/__tests__/outputFanOut.test.tsx` (2) — fan-out to two
targets keeps both; an input pickup still arms `pendingDisconnect`.

**Not done, deliberately.** The brief says "moving a cable from its output end = grab the
cable body (confirm the cable-body drag exists; if not, say so and leave it)". **It does not
exist.** `packages/oj-ui/src/components/Cable/Cable.tsx:89` binds `onClick={handleSelect}` on
`.oj-cable__hit` and nothing else — the body is a *select* target (then `Delete`), never a
drag handle. So the only way to move a cable is to grab it at its **input** end. That is
sufficient (an input holds exactly one cable, so its input end is unambiguous), but it means
U5's "or grab the cable body" is currently aspirational. Left alone as instructed.

---

## 2 — U8: ports are named, reachable, and typed at rest

**What changed**

- `packages/oj-ui/src/components/Port/Port.tsx` — a new optional `name` prop and a
  `describePort()` helper. Every port now renders `role="button"`, an `aria-label` and the
  same words as a `title`, built from type + direction + name: *"Audio out — drag to connect,
  or press Enter"*, *"Control in — Level — drag to connect, or press Enter"*. A name that
  only repeats the two words already said (`In`, `Out`, `Audio In`, `In 2`…) is dropped. A
  caller's own `aria-label`/`title` still wins (spread order), so a gated port keeps its "why
  this is inert" text. **No `tabIndex`** — the canvas owns the tab stops.
- `packages/oj-ui/src/components/PortRow/PortRow.tsx:63-72` — forwards its `label` as `name`
  when it is a string. That is what gets all fourteen faceplates named without threading a
  prop through any of them.
- `packages/oj-ui/src/components/Port/Port.css` — `--oj-port-hit: 24px` and a concentric
  `::before` pad at `max(var(--oj-port-hit), 100%)`. The 18px well is untouched: nothing
  scales, hover still only recolours the ring. Two documented opt-outs, both keyed on class
  names the owning components declare: `.oj-key-tile__port` (the tile is the playable
  surface; a 24px pad over a 12px well on a 34px key eats the note) and
  `.minilab3-control-port` (a dense hardware map whose sockets sit under their knob).
- `packages/oj-ui/src/components/Port/Port.css` — the idle tint. The argument at the old
  `:57-70` is **answered in place, not deleted**: the previous rule confused the SIGNAL with
  the SOCKET. Idle cores are now `color-mix(in srgb, var(--…-connection) 45%, var(--text-muted))`;
  `.is-connected` keeps the full-strength token. Plus an `[data-armed]` state (focus ring +
  filled core, no glow, no scale).
- `packages/oj-ui/src/components/KeyTile/KeyTile.tsx:74-90` — the embedded socket passes
  `role={undefined} aria-hidden`. The TILE is the button there; a socket claiming
  `role="button"` inside it nests one control in another and folds its label into the key's
  accessible name (*"C4"* becoming *"Control out — drag to connect C4"*).
- `src/components/Canvas/NodeCanvas.tsx:262-420` (new block) — **one roving tab stop per
  card**, written straight to the DOM and kept true by a single `MutationObserver` on
  `.nodes-layer`. Twenty-three faceplates render their own ports; threading a roving index
  through all of them would put one rule in twenty-three places. React never writes
  `tabindex` on a port (no component passes one), so it never fights for the attribute.
  Arrow keys walk that card's sockets; `Enter` arms; `Enter` on a compatible socket lands;
  `Escape` drops. Gated (`data-port-disabled`) and `aria-hidden` sockets are skipped.
- `src/components/Canvas/NodeCanvas.tsx` (same block) — **arming and landing dispatch the
  pointer events the card already handles** rather than re-implementing the drop. That is the
  point, not a shortcut: `NodeWrapper.handlePortMouseUp` is where ghost ports become real
  ports, where an instrument grows inputs for a multi-source drop, and where the pending
  reconnect resolves. The keyboard route **is** the pointer route and `addConnection` is
  reached down exactly one path.
- `src/a11y/announce.ts` + `src/a11y/LiveAnnouncer.tsx` — an incompatible target is refused
  *out loud* ("Two outputs cannot connect. Reach for an input.") instead of silently.
- `docs/shell.md` — the open decision is closed and replaced with a new **"Ports: named,
  reachable, and typed at rest"** section describing what shipped, including the KeyTile
  carve-out. UI-017 is closed by the same change.
- Story + tests: `Port.stories.tsx` gains `Named` and an armed cell; `Port.test.tsx` +8;
  `Knob.test.tsx` +3; `src/components/Canvas/__tests__/keyboardConnect.test.tsx` (5, new).
  `Port.figma.tsx` needed no change — no prop it pins was altered — and `figma connect parse`
  passes.

**Evidence** (`.scratch/ux-1c/v2.log`, `v3.log`, `v5.log`, `v7-final.mjs`; both themes)

```
  ports on canvas: 39 (visible to AT: 9)
  role=button: 9/9   aria-label: 9/9   title: 9/9
  smallest DRAWN well: 17px   smallest HIT pad: 24px  (pads under 24px: 0)
  one roving tab stop per card: YES (all cards)
  sample labels: ["Control out — ROW 1 — drag to connect, or press Enter",
                  "Control in — drag to connect, or press Enter",
                  "Audio out — drag to connect, or press Enter", …]
```

The legend at rest (HA-12), measured side by side:

```
  idle AUDIO   : color(srgb 0.1401 0.488868 0.480776)   <- teal-leaning
  idle CONTROL : color(srgb 0.485294 0.473529 0.434314) <- grey
  live AUDIO   : oklch(0.6 0.12 200)
  live CONTROL : rgb(143, 140, 130)
  idle audio DIFFERS from idle control: true
```

HA-12 measured both wells as `fill rgb(42,40,34)` before.

Keyboard connect, end to end, no mouse (`v5.log`, identical light and dark):

```
  focused (by keyboard): "Audio out — drag to connect, or press Enter"
  armed: true
  live: "Out armed. Move to another card's socket and press Enter to connect."
  Tab while armed moved focus: true
  walked to: PORT Audio in — drag to connect, or press Enter [canvas]
  cables 7 -> 8 | live: "Connected Effect to Looper"
  cables leaving that output now: 2      <- a fan-out, made with the keyboard
```

Refusal (`v3.log`): `refusal announced: "Two outputs cannot connect. Reach for an input."`,
graph unchanged, cable still in hand.

Six faceplates override the derived `title` with something more specific, which is the
intended precedence — e.g. `aria-label "Control out — ROW 1 — …"` / `title "Row 1 — all 10
keys on one cable"`.

**Bug found while verifying (fixed here).** With a cable armed, `arbiter.ts`'s drag guard
consumed **every** key but `Escape` — including `Tab`. `isConnecting` is now raised by the
keyboard route too, so that left a keyboard player armed and unable to move: the gesture
failed at exactly the step that matters. `src/keymap/arbiter.ts:96-118` now lets a
mid-gesture `Tab` **fall through to native traversal** while still never reaching the surface
toggle (the half of that guard that was load-bearing — a live drag must not have the surface
swapped under it). Test `G4` rewritten to the new law, plus an assertion that every other key
is still consumed.

---

## 3 — U9: forward Tab enters the surface

**What changed**

`src/keymap/arbiter.ts:34-76, 88-96` — the stage-floor toggle now distinguishes focus
**parked** on the floor from focus **in transit** across it. A bare `Tab` whose immediately
preceding key was also a bare `Tab` is a traversal and falls through to native focus
movement; anything else parks focus and the next `Tab` toggles. `useKeymap.ts` wires
`pointerdown` (capture) to `resetTabTraversal()`, so a click on the empty stage ends the
traversal and the next `Tab` brings up the other surface exactly as the topbar keycap says.

**Decision not in the brief.** The brief's literal rule was "the toggle fires only when the
previous focus was NOT that surface root". Implemented literally, walking forward out of the
chrome lands on `document.body`, the *first* Tab there toggles (flipping the player to the
Song surface they did not ask for) and only the second enters — so "Tab from the topbar's
last control lands on the first control inside the **active** surface", stated twice in the
brief and in `docs/shell.md:80-82`, would still be false for the canvas. The shipped rule is
a strict superset that satisfies both halves: it still falls through on a second consecutive
`Tab` on a surface root (the brief's clause, kept and tested), and it also falls through when
the traversal arrives from the chrome. Written up in `docs/shell.md`.

**Evidence** (`v5.log`, both themes)

```
  start: Settings [chrome]
   Tab 1 -> Hold all sound [chrome]
   Tab 2 -> Show keyboard help [chrome]
   Tab 3 -> BODY
   Tab 4 -> Row 1, key Q [canvas]
  FIRST CANVAS CONTROL reached after 4 Tab presses
  canvas<->song toggle from the stage floor: canvas -> arrangement
  a SECOND consecutive Tab walks into: arrangement
```

HA-01 measured this route as `pill → hint ✕ → help ✕ → document.body → then canvas↔arrangement
forever`, zero canvas controls ever reached.

Tests: `arbiter.test.ts` — `S4` updated (the parked gesture still toggles, from the root and
from the bare body), new `U9` test covering traversal, the second-consecutive fall-through,
a non-Tab key ending the traversal, and the pointer reset.

---

## 4 — U12: every verb answers

**What changed**

- `src/a11y/historyPhrase.ts` (new, pure) — `describeHistoryEntry(entry, lookupNodeName)`
  returns `{ name, done }`: the imperative (what reads correctly after "Undo") and the past
  (what an announcement has to be). It derives from the **verbs** first and falls back to the
  entry label, because `graphStore`'s `set()` wrapper records the literal string `'Edit graph'`
  for adding a node, wiring a cable, moving a card and deleting a rig alike — HA-09's premise
  that the label was already there is only half true. A deleted card is still named, off the
  entry's own `inverse`. Multi-verb adds are named by the **card** (the add whose parent is the
  canvas), not by the internals it arrived with.
- `src/a11y/LiveAnnouncer.tsx` (new) — one polite `role="status"` live region, portalled to
  `document.body` (the inactive surfaces are `inert` + `aria-hidden`; a region inside one goes
  quiet), subscribed to the history store so every recording verb is named at one seam rather
  than at thirty call sites. A nonce of no-break spaces makes an identical repeat announce
  again. Mounted from `NodeCanvas` (always mounted; App.tsx is another lane's file).
- `src/a11y/announce.ts` (new) — the second source, for gesture moments that record no history
  (arming a cable, a refused connection).
- `src/components/CommandBar/useCommandSources.ts` — `addNodeFromCtx` now keeps `addNode`'s
  returned id and selects the new card. Covers the palette **and** the context menu (both run
  the same action).
- `src/components/Shell/Topbar.tsx:60-100, 120-136` — undo/redo `title` **and** `aria-label`
  carry the phrase. Kept strictly to those lines; UX-1B's HA-27 offline-chip work in the same
  file is untouched and coexists.
- **No toasts.** Selection + the live region are the feedback, per the brief.

**Evidence** (`v5.log`, `v7-final.mjs`)

```
  Add Looper -> selected elements on canvas: 1 | live: "Added Looper"
  undo title: "Undo Add Looper (Ctrl+Z)"

  cables 7 -> 8 | live: "Connected Effect to Looper"
  undo button before: "Undo Connect Effect to Looper (Ctrl+Z)"
  after Ctrl+Z — cables: 7 | live: "Undo Connect Effect to Looper"
  redo button: "Redo Connect Effect to Looper (Ctrl+Shift+Z)"
```

HA-07 measured `selected: 0` after every add and a live region that never said anything but
"Canvas surface active"; HA-09 measured `Undo (Ctrl+Z)` and a rig vanishing unnamed.

Tests: `src/a11y/__tests__/historyPhrase.test.ts` (7); `paletteSpawnPlacement.test.tsx` +2.

**Bug this lane introduced and fixed.** Selecting the new card exposed a latent trap:
`addNodeFromCtx` resolved its spawn parent as `ctx?.node?.id ?? currentParentId()`, and
`buildPaletteCtx` sets `ctx.node` to the **single selected node**. So the moment an add
selected what it made, every *next* palette add landed **inside** the previous card. Measured:
`Add Looper` then `Add Library` produced one visible card and one nested a level down. The
branch had no correct caller either — the menu never passed a `node` (right-click on a card
was suppressed until HA-26). The spawn parent is now the level the player is looking at, full
stop (`useCommandSources.ts`, with the reasoning in the docblock), pinned by a regression test.

---

## 5 — Faceplate dimensions truth + spawn

**The choice, and why.** The brief offered re-declaring `registry.ts` `dimensions` from
measured renders, or measuring rendered card rects. **Measuring wins, and re-declaring is not
merely worse — it is wrong.** Two reasons; the second decides it.

1. *It rots on the next commit.* Faceplate bodies are content-driven now: a Sampler with four
   rows is taller than one with one, an Instrument grows an input when you drop a cable on its
   ghost port, a hosted plugin card is whatever its parameter list makes it. A number typed
   into the registry is a snapshot of one render, one day, one theme, and nothing in CI can
   notice when it stops being true.
2. *`dimensions` is not the card's footprint.* It is the nominal box the **socket-anchor
   fallback** normalises against — `utils/portPositions.ts` `socketColumnX(width)` /
   `socketRowY(height)` — and `src/engine/__tests__/socketGeometry.test.ts` recomputes every
   edge-anchored port `position` literal in the registry from it. Bending a declared height to
   make spawning honest would move that node's cable anchors on the first painted frame. One
   field, two jobs; only one of them is wrong. **`src/engine/registry.ts` is therefore
   unchanged.**

**What changed**

- `src/utils/spawnPlacement.ts` — the measurement rule moved here from `useCommandSources`
  (`measureRenderedCards`, `spawnCardSize`, `resetMeasuredCards`) with the whole argument
  written down, plus a **session cache by type**, so a type measured once stays known after
  its card is deleted. The module still imports no stores; zoom and the id→type lookup are
  passed in.
- `src/utils/spawnPlacement.ts` — **the width floor is gone**, and that is a fix. Height is
  still floored at the tallest card measured (that is the axis the registry lies about, by up
  to 2.7×, and over-reserving height only *moves* a card while under-reserving drops it below
  the fold). Width is not: a card's width really is roughly what it declares (jam rig: Looper
  240→252, Sampler 200→224, Library 500→500). Flooring it cost a real slot — with a 500px
  Library on screen a Sampler that needed a 224×397 hole was made to look for a 500×400 one,
  found none, and landed two thirds off the bottom while a free 224-wide column sat beside the
  Looper.
- `src/utils/spawnPlacement.ts` — **a deterministic sweep** before the "most visible" fallback.
  The cascade is a 128-point diagonal lattice: the right shape for a legible pile, a poor
  *search*. Measured, it missed a genuinely free column. The sweep is a plain `CASCADE_STEP`
  grid over the visible canvas, read top-left to bottom-right, first clear cell wins —
  exhaustive to within 28px, ~2k cells against ~10 siblings, once per add, nowhere near the
  audio path.
- `src/components/CommandBar/useCommandSources.ts` — `visibleCanvasBounds()` now **intersects
  the canvas element with the window** instead of merely converting it. Measured, `.node-canvas`
  is a 1440×900 box positioned at `top: 46` (under the topbar), so its own bottom 46px are off
  the screen; trusting its rect told the placement rule a strip it cannot see was fair game.

**Evidence** (`.scratch/ux-1c/v6-spawn.mjs`, `spawn-dump.json`, `v5.log`, `final-spawn-*.png`)

Measured vs declared on the jam rig, at zoom 1.0, in canvas px:

| type | declared (`registry.ts`) | rendered |
|---|---|---|
| keyboard-visual | 580×320 | 591×308 |
| instrument | 180×120 | **269×155** |
| effect | 160×100 | **226×228** |
| speaker | 140×160 | **232×258** |
| looper | 240×120 | **252×280** |
| library | 500×400 | 500×400 |
| sampler | 200×140 | **224×397** |

Five of the seven under-state, three of them by more than 1.6× on height; `keyboard-visual`
and `library` happen to be right. W6-SHIP's Looper (120→267) and Sampler (140→378) figures
reproduce here as 280 and 397 — the small difference is the rig's zoom being divided back out
plus a card's own content.

Three palette adds onto the jam rig at 1440×900 (identical light and dark):

```
   {"type":"looper","x":659,"y":55,"w":240,"h":267,"inside":true}
   {"type":"library","x":908,"y":46,"w":477,"h":381,"inside":true}
   {"type":"sampler","x":705,"y":599,"w":214,"h":378,"inside":false}
```

Before this lane, two of the three hung off the bottom (`library` bottom 1060, `sampler`
bottom 1111, against a 900px viewport). **Could NOT get to three of three**, and it is not a
placement failure: after five rig cards plus a Looper and a 500×400 Library, the remaining
free space in the visible canvas is a band ~284px tall, and the Sampler needs 397. I walked
the geometry by hand from `spawn-dump.json` and there is no clear 200×400 (or 224×397)
rectangle left anywhere inside the bounds. The fallback then does what it is designed to do —
the most *visible* uncovered spot, ~80% of the card on screen, header and controls included,
and it is selected and announced. The brief's condition is "fully inside the viewport **when a
free slot exists**"; here none does.

Tests: `src/utils/__tests__/spawnMeasurement.test.ts` (6) — measurement beats the registry,
zoom is divided back out, a type is remembered after its card is gone, the height floor, the
absent width floor (with the narrow-column case), and containment.

---

## 6 — HA-19: the Knob names its gestures

`packages/oj-ui/src/components/Knob/Knob.tsx:295-325` — one `title` on the wrap (so the label
and value readout carry it too): *"Drag to change · Shift for fine · double-click to reset ·
wheel or arrows when focused"*. The double-click clause is omitted when `defaultValue` is
absent — the control does not promise a reset it cannot perform. `rest.title` wins, because a
consumer that names the parameter (the MiniLab's `Knob 3 (CC74) → cutoff`) is saying something
this cannot. The file had **zero** occurrences of `title=` before. Three tests.

---

## 7 — HA-21: emoji → glyphs

`src/components/Canvas/ContextMenu.tsx:63-75` — the `CATEGORY_ICON` table (`⌨️ 🎻 🔄 ✨ 🔧 🔊`)
is **removed**, not replaced.

**Decision.** The brief allowed "the six oj-ui category glyphs … or labels only". There is no
six-category glyph set in `oj-ui` (`Icons.tsx` ships twelve chrome icons: close, chevrons,
mute, speaker, download, bolt, check, warning, three platforms) and none in
`Onboarding/glyphs.tsx` (six *option* glyphs — pads, keys, dials, a waveform — that answer
different questions). Drawing six new icons to say "Effects" beside the word "Effects" spends
pixels repeating an unambiguous word, and the disclosure chevron already says "this opens".
The audit's own suggestion was "or drop icons entirely — the labels carry it". Labels only.

Verified: `emoji: false` on the rendered menu in both themes, and a unit test that asserts no
`.oj-menu-item__icon` and no emoji codepoint anywhere in the menu's text.

---

## 8 — HA-26: verbs in the menu, and a node menu

**What changed**

- `src/components/Canvas/NodeCanvas.tsx:264-310` — **one implementation of each canvas edit
  verb** (`canvasVerbs`), lifted out of the keydown handler. The keymap's `canvas.copy` /
  `canvas.paste` / `canvas.duplicate` / `canvas.selectAll` / `edit.delete` entries now call the
  same functions the menu calls, through a ref, so the two cannot drift.
- `src/components/Canvas/NodeCanvas.tsx:~296` — right-click on a card is no longer discarded
  (the old `rightClickOnCanvas.current = !isOnNode` at `:280-283`). The card is found via
  `closest('[data-canvas-node-root]')`, and a right-click on an unselected card selects it
  first, so "Delete" deletes what the player pointed at. The now-dead `rightClickOnCanvas` ref
  is removed.
- `src/components/Canvas/ContextMenu.tsx` — a `CanvasVerbs` prop and a `ContextMenuTarget`
  prop. The canvas menu gains an **Edit** section; a node menu leads with **Duplicate ·
  Disconnect all cables · Delete** and then still offers the add categories (a right-click is
  how a first-run player adds a node). Every row shows its **current** binding via
  `keyComboToString(getBinding(id))`, so a rebound key is never advertised wrong. Rows that
  need a selection are `aria-disabled` without one; Paste and Select all are not.
  `disconnectNode` pulls every cable on a card inside one `beginGesture`/`endGesture` — one
  Ctrl+Z.
- Both menus keep the oj-ui `Menu` keyboard contract (roving focus, Home/End, typeahead,
  Left/Right disclosure, Escape cascade, focus restored on close).

**Decision not in the brief: no Cut.** The canvas has no cut action and no `Ctrl+X` binding —
`keybindingActions` has `arrangement.cut` and `pianoroll.cut` and nothing for the graph. A menu
row advertising a verb the keyboard does not perform is the mirror image of the bug this lane
is fixing. Follow-up: add a real `canvas.cut` action (copy + delete in one gesture) in
`keybindingsStore.ts` + `NodeCanvas`, then the row.

**Evidence** (`v5.log`, both themes; shots `final-nodemenu-*.png`)

```
  CANVAS menu: {"label":"Canvas menu",
    "verbs":["Input","Instruments","Routing","Effects","Utility","Output",
             "Copy","Paste","Duplicate","Select all","Delete","Cancel"],
    "emoji":false, "focusIsInMenu":true}
  ArrowDown inside the menu -> Instruments
  Esc closed: true
  NODE menu: {"label":"On-Screen Keys menu",
    "verbs":["Duplicate","Disconnect all cables","Delete", …add categories…,
             "Copy","Paste","Duplicate","Select all","Delete","Cancel"]}
```

HA-26 measured `ADD NODE · Input · Instruments · Routing · Effects · Utility · Output · Cancel`
and no node menu at all.

Tests: `ContextMenu.test.tsx` +4 (no emoji; the verbs run the same functions; disabled
without a selection; the node menu, including `disconnectNode` receiving the right id) — 20
passing in that file.

---

## Reduced motion, both themes

`v5.log` / `v7-final.mjs`. Everything above was run in light and dark and the outputs are
byte-identical apart from the colour values. Under `reducedMotion: 'reduce'`:

```
 {"reduced":true,"role":"button","label":"Control out — ROW 1 — …",
  "hitPad":"24px","drawn":17,"transition":"1e-05s"}
   menu opens: true
```

The port's transition collapses to ~0 and nothing else changes — no glow, no scale, one
`--focus-ring` (asserted in `Port.test.tsx`: the stylesheet contains `--focus-ring` and no
`transform: scale` or `filter: drop-shadow`).

---

## What I could NOT verify

- **Audio actually playing.** Everything here is graph topology, focus and pixels, measured
  headless. No sound was heard. The covenant's real test is unrun for this lane; the cable
  gestures do reach `addConnection`, which is the same path the pointer always used, so the
  engine sees nothing new — but that is an argument, not a listen.
- **Three of three palette adds fully on screen.** Two of three, plus a hand-checked proof
  that no free slot exists for the third on that canvas (above). Not verified at other
  viewport sizes.
- **Native tier.** All browser runs are `vite dev` in Chromium. Nothing here is tier-specific,
  but the Tauri build was not exercised.
- **A real screen reader.** The live region and the labels are verified by DOM inspection
  (`role`, `aria-label`, `aria-live`, `role="status"`, the nonce that forces a repeat to
  re-announce), not by NVDA/VoiceOver.
- **Touch.** The 24px pad is a pointer target; it was not tested with touch events.
- **The MiniLab and KeyTile pad opt-outs** are reasoned from their CSS and markup
  (`--port-size: 12px` on a 25-key panel; the socket sitting on a 34px playable tile) and from
  the KeyTile port being `aria-hidden`, not from a click-accuracy measurement on those
  faceplates.
- **`bun run build` end to end** — see below.

## Known failures (not this lane)

- **`bun run build`** fails at `tsc -b` with
  `src/components/Export/browserExport.ts(8,1): error TS2578: Unused '@ts-expect-error' directive.`
  `browserExport.ts` has **no diff** in this worktree; the file it points at,
  `src/audio/wasm/pkg/ojcore_wasm.js`, was rewritten at 12:00 by lane **UX-1A** (whose
  ownership includes `src/audio/wasm/pkg/**`) while these runs were in flight. `bunx vite build`
  is green (`✓ 1725 modules transformed. ✓ built in 5.95s`) and `bunx tsc --noEmit -p
  tsconfig.app.json` is clean, so nothing in this lane's diff is implicated. My own
  `bun run build` earlier in the session was fully green (`✓ built in 15.81s`, PWA precache 87
  entries) before that write. **Owner: UX-1A** — the fix is one line (drop the now-unneeded
  `@ts-expect-error`, or ship the `.d.ts`).
- **`src/components/CommandBar/__tests__/CommandBar.test.tsx > Tab from search sends the typed
  prompt to AI`** fails only under full-suite parallelism (twice), and passes 20/20 whenever
  that file runs alone. The test's own comment names the cause: it awaits a lazy dynamic import
  of the heavy `AiPanel` module graph in jsdom with a 5s budget "so the full suite's parallel
  load can't tip it over". On this box it tips over. Nothing in this lane touches `CommandBar`
  rendering, `AiPanel` or the arbiter path that test uses (a `Tab` on an `<input>` returns from
  `resolveKeydown` at the `isEditableTarget` guard, before any change of mine). Same family as
  the recorded `voiceSynth` flake — re-run before assuming a regression.

## Risks

- **The DOM-written tab stop.** The roving `tabindex` and `data-armed` are set imperatively
  because twenty-three faceplates render their own ports. This is safe *because* React never
  writes those attributes (no component passes them) and a `MutationObserver` re-applies on
  mount — but if a future faceplate starts passing `tabIndex` on a `Port`, React will win the
  attribute and that card's stop will be wrong. The `Port` docblock says so; a test asserts
  `Port` renders no `tabindex` of its own.
- **Synthesised pointer events.** Keyboard arm/land dispatch real `MouseEvent`s at the socket.
  That buys exact parity with the pointer path (which is the whole point) at the cost of a
  seam: a future change that gates `handlePortMouseDown` on something only a real pointer
  carries (`isTrusted`, `pointerId`) would silently break the keyboard route. The
  `keyboardConnect.test.tsx` suite fails loudly if it does.
- **`.oj-port::before`.** New pseudo-element on a very widely used component. It is
  non-painting and `position: absolute`, but any consumer that later wants `::before` on a port
  now has a conflict. Two opt-outs already exist as the documented escape hatch.
- **Idle tint contrast.** `color-mix(… 45%, var(--text-muted))` was checked for *distinctness*
  between kinds in both themes (numbers above), not against a WCAG ratio on the inset fill. The
  old rule's 4.5:1 claim for `--text-muted` no longer strictly describes the tinted core.
  Worth a contrast pass in the visual-baseline lane.
- **The sweep's cost** is bounded but not free (~2k rectangle tests on a large canvas). It runs
  only when the cascade has already failed 128 candidates, once per add, on a user gesture —
  never on the audio path — but it is the slowest thing in the add.
- **`Topbar.tsx` is shared with UX-1B.** My edit is confined to the undo/redo block and the
  three imports; their HA-27 offline work is intact in the same file. Whoever commits by
  pathspec gets both, which is correct — but the file needs one read before landing.
- **The arbiter's Tab exemption** loosens a guard that existed to protect live drags. `Tab`
  can now move focus mid-drag. No edit can land from a `Tab` and the surface toggle is still
  blocked, so I believe this is inert for the pointer path — but it is a real behaviour change
  to a gesture guard and deserves a second pair of eyes.

## Decisions not in the brief (summary)

1. **U9's rule is a superset of the brief's**, so that the doc sentence the brief demands be
   made true actually becomes true for the canvas (§3).
2. **No `Cut` in the menu** — the canvas has no cut action or binding (§8).
3. **Category glyphs dropped rather than redrawn** — no such glyph set exists and the labels
   carry it (§7).
4. **`registry.ts` `dimensions` left alone**; measurement is the rule, and re-declaring would
   move cable anchors (§5).
5. **The spawn parent is the viewed level, never the selection** — fixes a latent bug this
   lane's U12 change would otherwise have made constant (§4).
6. **`visibleCanvasBounds()` intersects with the window** (§5).
7. **The arbiter lets a mid-gesture `Tab` through** (§2).
8. **Two files touched outside the listed ownership**, both minimal and both in `oj-ui` beside
   `Port`: `PortRow.tsx` (+5 lines — forwards `label` as `name`, which is what names all
   fourteen faceplates' sockets) and `KeyTile.tsx` (+8 lines — `role={undefined} aria-hidden`
   on the embedded socket, without which every key tile's accessible name is corrupted).
   Neither is claimed by another lane in `01-UX1-WAVES.md`.

## Files touched

```
docs/shell.md                                        102 ++++--
packages/oj-ui/src/components/KeyTile/KeyTile.tsx      8 +
packages/oj-ui/src/components/Knob/Knob.test.tsx      24 ++
packages/oj-ui/src/components/Knob/Knob.tsx           19 ++
packages/oj-ui/src/components/Port/Port.css           97 +++++-
packages/oj-ui/src/components/Port/Port.stories.tsx   34 +-
packages/oj-ui/src/components/Port/Port.test.tsx      67 +++-
packages/oj-ui/src/components/Port/Port.tsx           64 +++-
packages/oj-ui/src/components/PortRow/PortRow.tsx      5 +
src/components/Canvas/ContextMenu.tsx                175 ++++++++--
src/components/Canvas/NodeCanvas.css                  99 +++++-
src/components/Canvas/NodeCanvas.tsx                 355 ++++++++++++++++--
src/components/Canvas/__tests__/ContextMenu.test.tsx  93 +++++-
src/components/CommandBar/useCommandSources.ts       132 ++++----
src/components/Nodes/NodeWrapper.tsx                  40 ++-
src/components/Shell/Topbar.tsx                       47 ++-
src/keymap/__tests__/arbiter.test.ts                  85 ++++-
src/keymap/arbiter.ts                                 69 +++-
src/keymap/useKeymap.ts                               12 +-
src/utils/spawnPlacement.ts                          155 ++++++++-

new:
src/a11y/announce.ts
src/a11y/historyPhrase.ts
src/a11y/LiveAnnouncer.tsx
src/a11y/__tests__/historyPhrase.test.ts
src/components/Canvas/__tests__/keyboardConnect.test.tsx
src/components/Nodes/__tests__/outputFanOut.test.tsx
src/utils/__tests__/spawnMeasurement.test.ts
src/components/CommandBar/__tests__/paletteSpawnPlacement.test.tsx   (+2 cases)
```

Untouched, as instructed: `crates/**`, `src/audio/**`, `src/store/arrangementStore.ts`,
`src/persistence/**`, `src/App.tsx`, `src/components/Arrangement/**`,
`src/components/Plugins/**`, `src/engine/registry.ts`. No `git add/commit/stash/checkout/reset`
was run. The dev server on 5252 is stopped.

---
---

# Fix round — the 14 gate findings

Written after `plans/ux-intuitive/UX-1C-REVIEW.md` (verdict **SHIP-AFTER-FIXES**). All 14 are
addressed. Two of them turned out to be bigger than a patch and were taken as the review asked
rather than filed: the connection gesture is now a shared **verb** instead of a synthesised
mouse event, and the self-wire rule moved into the store. Scripts and logs for this round:
`.scratch/ux-1c/f1-fixround.mjs` (`f1.log`), `.scratch/ux-1c/f2-moveundo.mjs`, plus the gate's
own `.scratch/ux-1c-gate/g1-fanout.mjs`, `g1b-inputpickup.mjs`, `g3c-connect.mjs`,
`g8-delete.mjs`, `g9-nodemenu.mjs` re-run as the red baseline.

## Gates, re-run

Final state, after every lane's in-flight edits settled:

| gate | result |
|---|---|
| `bunx tsc --noEmit -p tsconfig.app.json` | **clean**, exit 0 |
| `bun run lint` | **exit 0, ZERO warnings** (`bunx eslint . --max-warnings 0` also exit 0) |
| `bun run test:run` | **3263 passed / 0 failed — 257 of 257 files** |
| `bun run build` (`tsc -b && vite build`) | **GREEN** — `✓ built in 4.06s`, PWA precache 87 entries |
| `bunx figma connect parse` (in `packages/oj-ui`) | exit 0, **53 components** |

Said honestly, because it was true for most of this round: mid-round the same commands showed
**2 test failures** (`typeFloor.test.ts` on `AppErrorBoundary.css` and `Shell/StepGrid.css`) and
**1 lint warning** (`SkyBand.tsx:99`) — all three UX-1E files, all three on paths this lane must
not touch, and all three resolved by that lane while this round ran. Nothing in this lane's diff
was implicated in any of them, and the `CommandBar` parallel-load flake from the first round did
not recur in either full run.

---

## 1C-01 · S1 — the menu verbs were a pointer no-op

**Fixed.** `src/components/Canvas/ContextMenu.tsx:~500` — the `.context-menu-host` div now stops
`mousedown` and `mouseup`. Belt and braces at `src/components/Canvas/NodeCanvas.tsx:~372` — the
`isNodeOrPort` selector gained `, .context-menu-host`, so even an event that got past the host
cannot clear the selection or start a marquee underneath an open menu.

**Evidence — real browser, real pointer** (`f1.log`; `.click()` sends mousedown → mouseup →
click, exactly as a user does):

```
selected before the menu: 1
DELETE     cards 4 -> 3   speaker gone: true
           live: "Deleted selection" | undo: "Undo Delete selection (Ctrl+Z)"
DUPLICATE  cards 3 -> 4
COPY+PASTE cards 4 -> 5
SELECT ALL selected 5 of 5 cards
```

The gate's own `g8-delete.mjs`, re-run:

```
=== NODE MENU: Delete one card ===
   before: {"nodes":13,"roots":4,"sel":0}
   after:  {"nodes":10,"roots":3,"sel":0}   menu closed: true
   live: "Deleted selection"   undo: "Undo Delete selection (Ctrl+Z)"
   ONE Ctrl+Z: {"nodes":13,"roots":4,"sel":0}
=== CANVAS MENU: Delete with a selection made by clicking a card ===
   selection after opening the canvas menu: {"sel":1}   <- was [] before the fix
   after:  {"nodes":10,"roots":3,"sel":0}   live: "Deleted selection"
```

`g9-nodemenu.mjs` reaches `cards 4 -> 3`, `live "Deleted selection"` and then **crashes on its
own next step** (`Cannot read properties of undefined (reading '0')`) because the Speaker it
looks for later was actually deleted by the step that now works — the script was written against
the broken build.

**Test — real DOM, not a direct `onSelect` call.** `src/components/Canvas/__tests__/menuPointerVerbs.test.tsx`
(5 cases) renders the whole `NodeCanvas`, opens the menu with a real right-click and drives rows
with bubbling `mousedown`/`mouseup`/`click`. Confirmed as a red baseline: with the two fixes
reverted, **4 of 5 fail** — and `Select all` passes, exactly as the review predicted, because it
is the one verb that does not read the prior selection.

```
reverted:  × mousedown does NOT reach the canvas   × Delete   × Duplicate   × Copy+Paste   ✓ Select all
restored:  5 passed
```

Counting note: the tests count **cards** (`parentId === null`), not `nodes.size` — an `effect`
arrives with two internal nodes, so the raw map measures the wrong thing and would move the day
a faceplate's insides change.

## 1C-02 · S2 — there was no way to move a cable's destination

**Implemented, not documented away.** `src/components/Nodes/connectionVerbs.ts:105-150` — when an
input-grab armed a pending disconnect and the drop lands on another **input**, the cable's far
end is resolved from the store and `reconnectConnection` moves that cable's destination. One
verb, one history entry, announced.

**Evidence** — the gate's own `g1b-inputpickup.mjs`, whose Case 1 was the red baseline
(`LOST: []`, `GAINED: []`, `n 6 → 6`, nothing announced):

```
=== CASE 1: grab speaker audio-in (occupied) -> fresh effect audio-in (EMPTY) ===
   LOST:   ["…/audio-out -> …speaker/audio-in"]
   GAINED: ["…/audio-out -> …effect/audio-in"]
   n 6 -> 6   MOVED? true
   live: "Moved cable from Speaker to Effect"
   still connecting (cable stuck in hand)? false
```

And onto an **occupied** input, which must also replace what was there and still round-trip
(`f2-moveundo.mjs`):

```
--- grab speaker audio-in (occupied) -> looper audio-in (OCCUPIED) ---
live  : "Moved cable from Speaker to Looper"
EXACT ROUND TRIP: true   n 7 -> 6 -> 7
```

The `7 → 6` is the one-cable-per-audio-input rule doing its job, and one `Ctrl+Z` restores the
exact prior edge set, ids included.

> **On the gate's `U5b` line in `g1-fanout.mjs` (`ONE Ctrl+Z exact: false`).** That script's
> bookkeeping was written against a build where the input-grab drop was a *no-op*, so its
> "exact inverse" comparison is against a snapshot taken for a gesture that did nothing.
> **Correction (re-gate):** the reason given here was wrong. A move does *not* keep the cable's
> id — `addConnection` mints a new one (`graphStore.ts:844`) and deletes `replacingConnectionId`
> in the same `set()`, so an id-keyed diff sees both a LOST and a GAINED. The substantive claim
> the aside defends — that the round trip is exact — stands and is measured. `f2-moveundo.mjs`
> tests the same case directly and reports `EXACT ROUND TRIP: true`, and the unit test asserts
> the same. The behaviour is right; the old script's expectation is stale.

Vocabulary followed the behaviour: `graphStore.ts:1313` now opens that gesture as **`Move cable`**
rather than `Reconnect cable`, so the live region ("Moved cable from X to Y") and the undo button
("Undo Move cable") use one word for one concept (U10).

`docs/shell.md` gained a **"cable grammar"** paragraph stating all of it — outputs fan out, an
input carries its cable, dropping on an occupied input replaces, a card cannot wire to itself,
and, said plainly, **there is no cable-body drag**.

## 1C-09 — the test that named a behaviour the build did not have

`src/components/Nodes/__tests__/outputFanOut.test.tsx`'s second case is now
*"grabbing a CONNECTED input and dropping on another input MOVES the cable"* and it **lands** the
cable: asserts one cable, same source, new destination, one history entry, and that a single
`undo()` puts it back on the original input.

## 1C-05 · S3 — the keyboard forked the connection rules

Taken as the review's deeper ask rather than the minimum.

- **The rule moved into the store.** `src/store/graphStore.ts:773-791` — `addConnection` returns
  `null` when `sourceNodeId === targetNodeId`, for every caller. It is also right on the merits:
  the executor compiles an acyclic schedule, so a node feeding its own input is an edge the
  engine can never honour.
- **The verb replaced the synthetic event.** New `src/components/Nodes/connectionVerbs.ts` holds
  `beginConnectionFrom(node, portId)` and `completeConnectionAt(node, portId)` — the former
  `handlePortMouseDown`/`handlePortMouseUp` bodies with the event plumbing stripped off.
  `NodeWrapper`'s handlers are now four lines each; `NodeCanvas`'s keyboard route calls the
  functions directly. **No `MouseEvent` is dispatched anywhere.** The keyboard's private
  pre-flight refusal set is gone: `completeConnectionAt` returns
  `{ ok } | { ok: false, reason }` and both routes speak the store's answer.
- The dead `canConnect` branch the review named is gone with it.

**Evidence** (`f1.log`), the same self-wire attempted both ways:

```
POINTER  cables 7 -> 7 | live: "A card cannot be wired to itself."
KEYBOARD cables 7 -> 7 | live: "A card cannot be wired to itself. "
```

Before: the pointer created the loop (`6 -> 7`, "Connected Effect to Effect") while the keyboard
refused it. Tests: a self-wire case in `outputFanOut.test.tsx` (store level, pointer route) and
one in `keyboardConnect.test.tsx` asserting both routes and the spoken reason.

**One difference between the routes remains, and it is deliberate — gesture lifetime, not rules.**
A refusal leaves the cable in hand; the *caller* decides whether the gesture is over. A mouse
drop happened with the button coming up, so `NodeWrapper` drops the cable rather than leaving one
trailing a cursor nobody is pressing. A keyboard `Enter` released nothing, so the player can try
the next socket without re-arming (`g3c-connect.mjs`: `still armed: uw51/audio-out`). Stated in
the code at the point where it happens.

## 1C-03 · S2 — "Added 1 nodes"

`src/a11y/historyPhrase.ts`. Three changes:

1. The headline branch no longer requires `wires.length === 0`. The wires an add brings **with**
   it are the card's insides, not a separate verb — a pre-wired card is named, and says so.
2. A count of one is never printed. `${count} ${count === 1 ? 'card' : 'cards'}`, and a
   multi-verb add with exactly one root is named rather than counted.
3. Rig installs are named at the source: `src/rigs/buildRig.ts:89` opens the history frame with
   `begin(\`Install ${spec.label}\`, 'graph')` instead of the generic `beginGesture()`. A leading
   imperative is past-tensed for the announcement through a twelve-entry table, so a label reads
   correctly in both grammars.

**Evidence** (`f1.log`):

```
rig install undo title: "Undo Install Jam rig (Ctrl+Z)"      (was "Undo Add 4 cards")
Add Sampler: live "Added Sampler, wired" | undo "Undo Add Sampler (Ctrl+Z)"
Add Looper:  live "Added Looper"         | undo "Undo Add Looper (Ctrl+Z)"
```

**And the "Undo compound" the UX-1B gate saw.** `arrangementStore` records
`verbs.length === 1 ? verbs[0].kind : 'Edit timeline'`, so a single wrapped timeline gesture is
labelled with the bare machine word `compound` — and that store is on this lane's do-not-touch
list. Handled in `historyPhrase` where it belongs: a label that is one lowercase token is treated
as a leaked verb kind, `addClip` becomes "Add clip"/"Added clip", and **`compound` resolves to
its first inner verb**. Tests assert `Move clip` / `Moved clip` and that neither string ever
matches `/compound/i`.

`historyPhrase.test.ts` is now 12 cases, including the pre-wired card, the rig install in both
grammars, the "never 1 nodes" rule, `compound`, and a leaked kind.

## 1C-04 · S2 — the re-announce nonce

`src/a11y/LiveAnnouncer.tsx`. The padding is no longer chosen by a parity bit over all
announcements — that is precisely why `Ctrl+Z` → `Ctrl+Shift+Z` → `Ctrl+Z` rendered the first and
third identically. `seq` is monotonic (every announcement is a fresh state object, so React always
commits) but the padding is chosen against a **two-deep window of what was actually rendered**,
which is exactly as far back as that cycle reaches.

**Evidence** (`f1.log`, the exact cycle):

```
undo : "Undo Add Looper"
redo : "Redo Add Looper"
undo : "Undo Add Looper "        <- a different string
the second undo is a DIFFERENT string from the first: true
...and says the same words: true
```

Test: `src/a11y/__tests__/liveAnnouncer.test.tsx` (4 cases) — the exact cycle; six identical
messages in a row with no two consecutive renders equal and all six saying one sentence; no
padding when the words change; and the region's `role`/`aria-live`/`aria-atomic`/`document.body`
parent. It reproduces the bug: with the old parity code the cycle test fails
(`expected 'Undo Add Speaker' not to be 'Undo Add Speaker'`).

## 1C-06 · S3 — the armed socket borrowed the focus ring

`packages/oj-ui/src/components/Port/Port.css` — `[data-armed]` keeps its accent border and accent
core and its `box-shadow` is now `var(--shadow-inset)` alone. There is exactly one focus ring
again, and it means only "you are here".

```
{"armed":true,"boxShadow":"rgba(0, 0, 0, 0.22) 0px 1px 3px 0px inset","border":"oklch(0.66 0.19 40)"}
g3c: {"ports":["ARMED audio-out"],"focused":"BUTTON","focusedHasRing":true}
```

## 1C-07 · S3 — the sweep's cost note was a zoom-1 number

`src/utils/spawnPlacement.ts` — restated as `O((W/zoom · H/zoom) / CASCADE_STEP²)`, with both
figures given: ~1.7k cells at zoom 1 on 1440×900, ~27k at `MIN_ZOOM = 0.25`. No behaviour change;
the comment was the defect.

## 1C-08 · S3 — a gated socket was told to "drag to connect"

`src/components/Nodes/NodeWrapper.tsx` `renderPort`'s disabled branch now passes
`aria-label={port.disabledReason ?? …}` beside the existing `title`, so assistive tech is not
given an instruction the port will not obey. Latent, as the review says — the registry ships no
gated port today — and unmeasurable for the same reason.

## 1C-10 · S3 — the Knob's title was slightly imprecise

`packages/oj-ui/src/components/Knob/Knob.tsx` — "Shift for a **fine drag**", since Shift is a drag
modifier only. `PageUp`/`PageDown` and `Home`/`End` are deliberately left to the help panel, with
the reason in the code: naming six gestures in a tooltip is a paragraph, not an affordance.

## 1C-11 · S3 — the MutationObserver could not see the attributes it filters on

`src/components/Canvas/NodeCanvas.tsx` — the observer now takes
`attributes: true, attributeFilter: ['aria-hidden', 'data-port-disabled']`. Self-retrigger stays
impossible: our own write is `tabindex`, which is not in the filter. Forward-looking, as the
review says.

## 1C-12 · S3 — an unreported diff in a lane-owned file

Named here, as asked. **`src/components/CommandBar/useCommandSources.ts:385-390` carries UX-1B's
**U4**: the "New Project" command was changed from `window.dispatchEvent('openjammer:new-project')`
to a direct `requestNewProject('new')`. It is not this lane's change.** Whoever commits by
pathspec should read that file once before landing, exactly as for `src/components/Shell/Topbar.tsx`
(where UX-1B's HA-27 offline-chip work sits beside this lane's undo/redo titles). Both files carry
two lanes' work and neither conflicts.

## 1C-13 · S3 — lint was not "clean"

Two things. The report's original gate table is corrected above. And `eslint.config.js` now
ignores `src/audio/wasm/pkg/**`: `wasm-pack` regenerates that directory on every wasm build and
stamps its own disable header, so the warning is unfixable by hand and returns with the next
build. Generated artifacts are not source. (UX-1A had already removed the directive by the time
this round ran, so the warnings were gone either way — the ignore is what stops them coming back.)

The one warning that remains is UX-1E's `SkyBand.tsx:99`, on a path this lane must not touch.

## 1C-14 · info — three live regions

No action, as the review says: HA-20 is UX-1E's item. Recorded so the two are reconciled when 1E
lands. This lane's region is the only one that speaks for graph verbs, and it is on
`document.body` so an inert surface cannot mute it.

---

## What this round could NOT verify

- **Audio actually playing.** Unchanged from the first round, and now more pointed: the cable
  gestures grew a new path (`connectionVerbs`) and a new verb (the move). They reach the same
  `addConnection`/`reconnectConnection` the pointer always used, and the executor sees the same
  graph diffs — but no sound was heard. The founder listening pass is still the gate.
- **A real screen reader**, which matters most for 1C-04. The fix is verified by comparing
  rendered strings, not by hearing NVDA read the second undo.
- **Touch**, **the native tier**, and **viewport sizes other than 1440×900** — as before.
- **The gated-port label (1C-08)**, which no shipped node can produce.
- **The gate's `g9-nodemenu.mjs` past its Delete section** — it crashes on a card that no longer
  exists precisely because the fix works; re-running it end to end needs the script updated, which
  is the gate's file, not this lane's.

## Risks added by this round

- **`connectionVerbs.ts` is a real refactor of a 150-line accretion.** It is byte-for-byte the
  same logic (ghost ports, instrument auto-expansion, the pending reconnect, the
  `beginGesture`/`endGesture` bracket) moved out of a closure, and the pointer suites that covered
  it — `NodeWrapper.reconnect.test.tsx` (4), `portDomContract.test.tsx` (92), `outputFanOut` (3) —
  all pass unchanged. But it is the connection gesture, on the surface a player uses most, and it
  deserves a second pair of eyes on the diff rather than only on the tests.
- **The self-wire prohibition is a store-level behaviour change.** No built-in rig wires a node to
  itself and the executor could never honour such an edge, but any caller that relied on
  `addConnection` accepting one now gets `null`. Grep found none.
- **`buildRig` now opens the history frame directly** (`useHistoryStore.begin` /`commit`) instead
  of via `graphStore.beginGesture()`/`endGesture()`. Those wrappers are exactly `begin('Edit graph')`
  and `commit()`, so this is the same bracket with a name — but it is a second call site for the
  history frame in a file this lane does not own.
- **`historyPhrase` now interprets labels.** A one-lowercase-token label is treated as a machine
  word. If a store ever writes a genuine single-lowercase-word label meant for a human, it will be
  title-cased. That seemed a better failure than shipping "Undo compound".

---

# Re-gate round — RG-01 to RG-06

Written after the "Re-gate of the fix round" section of `UX-1C-REVIEW.md` (verdict
**SHIP-AFTER-FIXES**, 0 blocking / 1 S2 / 3 S3 / 3 info; none of the 14 originals recurred).
All six actionable findings are closed. RG-07 is left as directed. Script and log for this
round: `.scratch/ux-1c/f3-regate.mjs` (`f3.log`).

## Gates

| gate | result |
|---|---|
| `bunx tsc --noEmit -p tsconfig.app.json` | **clean**, exit 0 |
| `bunx eslint . --max-warnings 0` | **exit 0, zero warnings** |
| `bun run test:run` | **3267 passed / 2 failed (256 of 257 files)** — both failures are the recorded `CommandBar.test.tsx` parallel-load flake; **re-run alone: 20/20 pass**. Not this lane's file |
| `bun run build` (`tsc -b && vite build`) | **GREEN** — `✓ built in 13.52s`, PWA precache 87 entries |
| `bunx figma connect parse` (in `packages/oj-ui`) | exit 0, **53 components** |

## RG-01 · S2 — a "move" that did not happen was announced as one

**Fixed.** `src/components/Nodes/connectionVerbs.ts:155-180` reads the graph back before speaking.
A truthy return from `reconnectConnection` is not proof: `addConnection` short-circuits on a
duplicate edge and hands back the **existing** connection's id without touching anything. The
discriminator needs no assumption about the new id — a real move **mints** one and deletes
`replacingConnectionId` in the same `set()`, so *the cable we grabbed still being present* means
nothing happened. Then: `{ ok: false, reason: 'That cable is already there.' }`, and no
`stopConnecting()` — a refusal leaves the cable in hand and the caller decides, exactly as
everywhere else in the module.

**Evidence — the gate's exact topology** (`f3.log`; one output feeding both the grabbed input and
the target):

```
setup edges: ["7w3i: effect -> speaker/audio-in", "kfdk: effect -> looper/audio-in"]
n = 7   undo title: "Undo Connect Effect to Looper (Ctrl+Z)"
after edges: ["7w3i: effect -> speaker/audio-in", "kfdk: effect -> looper/audio-in"]
n 7 -> 7  (unchanged: true)
live : "That cable is already there."
undo : "Undo Connect Effect to Looper (Ctrl+Z)"   <- still the PREVIOUS gesture, correctly
graph untouched: true
```

The gate measured live **"Moved cable from Speaker to Effect"** here, with the undo button
pointing at an earlier edit.

One more silence closed while in the same branch: dropping a cable back on the socket it came
from is a complete gesture that changes nothing, and it used to end in silence. It now says the
same sentence.

**Test.** `outputFanOut.test.tsx`, *"refuses honestly when the cable is already where it is being
dropped"* — builds the exact topology, subscribes to `announce()`, and asserts the connection ids
are unchanged, `historyStore.cursor` unchanged, `open === null`, the honest sentence spoken, and
**no** "Moved cable" anywhere. Confirmed red without the guard:
`AssertionError: expected [ Array(1) ] to include 'That cable is already there.'`

## RG-02 · S3 — a cable could be let go in silence

**Fixed**, and unified rather than patched. A cable in the air can be released from four places —
the socket's own `Escape`, the global Escape cascade (`NodeCanvas.tsx:~752`), a click on empty
paper (`~382`), and a mouse-up that landed on nothing (`~572`). Three said nothing; the fourth
said "Cable dropped." All four now say one sentence, `CABLE_RELEASED`, declared once at the top of
the file with the reason.

**Decision, since it goes slightly past the brief's wording:** the sentence is **"Cable
released."** for all four, not "Cable released" for the global paths and "Cable dropped." for the
socket. Same event, two words is precisely the U10 fault this lane fixed elsewhere this round
(`Reconnect cable` → `Move cable`) — and "released" is the better word besides, because a cable
*dropped on a port* is the successful landing.

**Evidence** (`f3.log`):

```
armed  : "Out armed. Move to another card's socket and press Enter to connect."
Tab+Esc: "Cable released."   connecting: false     <- the global cascade; was silent
click  : "Cable released."   connecting: false     <- click on empty paper; was silent
drag→nothing: "Cable released."                    <- mouse-up on nothing; was silent
```

**Test.** `keyboardConnect.test.tsx`, *"says so when the GLOBAL Escape drops an armed cable"* —
arms a socket, moves focus **off** it (so the socket-scoped handler cannot run), and drives
`Escape` through the real arbiter.

## RG-03 · S3 — Duplicate was announced and titled as Paste

**Fixed** at the source. `src/store/graphStore.ts` `duplicateSelected` brackets its delegation with
`begin('Duplicate nodes', 'graph')` / `commit()` in a `finally`. The delegation to
`pasteClipboard` is right and stays; only the frame the player reads changes. Nesting is what
makes it work — `historyStore.begin` merely increments `depth` when a frame is open, so the outer
label wins and `'Paste nodes'` is swallowed.

The two faces of the phrase now differ on purpose (`historyPhrase.ts`): `name` is the **command**,
so it reads correctly after "Undo"; `done` is **what happened**, and when the gesture produced
exactly one card it names it. That is the difference between a button and an announcement.

**Evidence** (`f3.log`, both routes):

```
menu Duplicate: cards 4 -> 5
  live: "Duplicated Effect" | undo: "Undo Duplicate nodes (Ctrl+Z)"
Ctrl+D        : live "Duplicated Effect" | undo "Undo Duplicate nodes (Ctrl+Z)"
```

Was `live: "Pasted nodes"` / `undo: "Undo Paste nodes"`. Tests: two cases in
`historyPhrase.test.ts` (one card → "Duplicated Sampler"; more than one → "Duplicated nodes",
never a name it cannot justify).

## RG-04 · S3 — Copy and Select all answered with nothing

**Fixed.** `NodeCanvas.tsx` `canvasVerbs.copy` and `.selectAll` go through the `announce()`
channel, which exists for exactly this: gesture moments that record no history and so can never
reach `LiveAnnouncer` through the history store.

```
menu Copy      : "Copied 1 node"
menu Select all: "Selected all 6 nodes"
Ctrl+C         : "Copied 6 nodes"
```

Both routes, because both run the same function. Test: *"Copy and Select all answer out loud"* in
`keyboardConnect.test.tsx`, driving `Ctrl+C` and `Ctrl+A` through the real arbiter.

**Vocabulary note.** These say **nodes**, and so, now, do the counted fallbacks in `historyPhrase`
("Deleted 2 nodes", not "cards"). "Cards" was this lane's own coinage in round 1; the app's own
history and keybinding labels say nodes (`Paste nodes`, `Select All Nodes`, `Copy Nodes`,
`Duplicate Nodes`). One word for one concept.

## RG-05 · info → **removed**

**No production caller exists, and I looked for one.** `grep -rn "ghost-input-"` across `src/` and
`packages/` at `HEAD` and in the working tree returned exactly three hits: the two lines in
`connectionVerbs.ts` that consumed the prefix, and `NodeWrapper.reconnect.test.tsx:11`, a mock
that **invented the id itself**. No faceplate emits one. The live "always one empty port"
affordance is `PortPanelNode.tsx:257-280`, which renders a real `emptySlotPort.id` (an `empty-…`
id) and takes the ordinary path — matching the review's live measurement of the jam rig's
`input-panel-…:empty-…`.

So it is dead, and agents.md value #8 says so plainly. Removed: the index parse, the port-growth
loop, the two-way `targetPort` lookup, the `beginGesture`/`endGesture` bracket that existed only
for it, and the `try/finally` that wrapped it — about fifty lines — **and its test and the mock
that fed it**. Both sites carry a comment saying what was removed, why, and what to write instead
if the `empty-…` affordance ever wants growth-on-drop.

Kept: `GROWS_INPUTS`, because its *other* user is live — a multi-source drop still expands an
instrument's inputs, and that is reachable today (`Ctrl+A` over a port arms every matching port,
then one drop).

What that test really pinned — one gesture, one `Ctrl+Z` — is pinned instead by the cable **move**
test, which lands a real cable through the same module and asserts `cursor + 1` and an exact round
trip. `NodeWrapper.reconnect.test.tsx` is 3 cases and green; `grep ghost-input-` now returns only
the two explanatory comments.

## RG-06 · info — a ref written during render

**Fixed.** `NodeCanvas.tsx` — `verbsRef.current = canvasVerbs` moved into
`useEffect(..., [canvasVerbs])`. Same behaviour, no render-phase write, and the comment now says
why a ref rather than a closure *and* why the write is in an effect.

## RG-07 · info — `blur` / `pointercancel` do not drop an in-air cable

**Left, as directed.** Pre-existing, no reachable stuck state (every realistic escape hatch
clears it, and the re-gate measured a fresh drag landing normally after all three cancellation
attempts), and the cancel-set gap belongs with the node-drag cleanup it would sit beside.

## What this round could NOT verify

- **Audio actually playing** — unchanged, and still the founder's gate. RG-01's fix changes what
  is *said*, never what is wired, and RG-03/RG-04 touch only labels and announcements; but a
  keyboard connect and an input-grab move should be driven once with a rig sounding.
- **A real screen reader** — every announcement in this round was read out of the DOM.
- **Touch, native tier, viewports other than 1440×900** — unchanged.
- **The removed ghost-port gesture** — it was never drivable in a browser, which is why it went.
