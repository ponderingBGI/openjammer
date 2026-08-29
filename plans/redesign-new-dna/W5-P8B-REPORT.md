# W5-P8b — the keyboard/instrument fix round

Branch `t3code/openjammer-redesign-timeline`, uncommitted. Work order: `W5-P8-REVIEW.md`
must-fixes 1–2 + follow-ups 1–3 (+ the one-word #10). Evidence:
`plans/redesign-new-dna/.scratch/w5-p8b/` (harness `gate.mjs`, `gate.json`, 7 captures,
`build.log`, `vitest-full.log`, `pwa-smoke.log`).

## Gates

| Gate | Result |
|---|---|
| `bun run test:run -- src/components/Nodes src/rigs src/midi src/engine src/store src/components/Canvas` | **49 files / 667 tests pass** |
| `bun run test:run` (whole repo) | 2345 pass / **1 pre-existing parallel-load flake** — `KeybindingsPanel.test.tsx > should render all keybinding actions` times out at 5s under full parallelism and passes in **2.6s in isolation** (re-run alone: 21/21 green). Untouched by this round. |
| `bunx tsc --noEmit -p tsconfig.app.json` | clean — **zero** errors, none from other lanes |
| `bunx eslint src/components/Nodes src/rigs src/midi src/engine src/store` | clean |
| `bun run build` | succeeds |
| `bunx playwright test e2e/pwa-smoke.spec.ts --project=chromium` | **4 passed** |
| Browser (node, one Chromium on 5227, 1700×1050, light + dark) | **27 ok / 0 fail**, **zero console or page errors on every run** |

---

## 1 · Instrument picker viewport clamp/flip — FIXED

**Decision.** Keep the picker anchored to the card (P8's zoom fix stays: it pans and
zooms with the node), and put a measure → flip → clamp pass on top of it. Not a portal:
`ContextMenu` needs one because it is anchored to a *click point* in viewport space,
while this is anchored to a *node* that moves with the canvas transform — a portal would
have to re-track pan/zoom every frame to stay glued to its card. The geometry is decided
in **viewport space** and written back in the anchor's **local** space, divided by the
scale measured off the anchor itself (`rect.width / offsetWidth`), so any ancestor
transform is included rather than trusted from the store.

**Changes**
- `src/components/Nodes/popoverPlacement.ts` (new, 41): `placePopover(anchor, size,
  viewport, gap, pad)` — pure. Prefers below, flips above only when below cannot hold it
  and above holds more, clamps both axes, and caps `maxHeight` so a menu taller than the
  viewport is still fully reachable. Extracted rather than left in the component so
  `react-refresh/only-export-components` stays satisfied and the rule is unit-testable.
- `src/components/Nodes/InstrumentNode.tsx:305` — the `useLayoutEffect` that measures and
  applies it, re-running on `resize`, capture-phase `scroll`, canvas `zoom`, and the
  search query (filtering changes the list's height). The zoom selector collapses to a
  constant while the picker is closed, so wheel-zoom never re-renders a closed node.
- Same file: outside-`pointerdown` now treats the picker as inside (it holds a `ref` of
  its own), and `data-flipped` is written for CSS/tests.

**Pinned by** `w5p8Faceplates.test.tsx`:
- component: *"flips ABOVE the card when the node sits low on the canvas"* — jsdom with
  the anchor's rect mocked at `top: 1000` in a 1050px viewport; asserts
  `data-flipped="true"`, `style.top === '-366px'`, and that the resulting box is inside
  the viewport.
- pure: 5 cases in *"placePopover keeps an anchored menu on screen"* (below / flip / cap
  when neither side fits / right-align / wider-than-viewport clamp).

**Browser** (`b-1-picker-low-light.png`, `b-1-picker-high-light.png`): instrument name
button at **y 952** in a 1050px viewport → picker `top 573.7 / bottom 934`, `flipped:
true`, fully inside; `End` focuses "Rock Organ" at `top 856.9 / bottom 893.9` — on
screen. The same node **high** on the canvas still opens downwards (`flipped: false`).

---

## 2 · One law for mode numbers — FIXED

**Decision.** Delete the derivation. A keyboard-kind node's mode is **allocated once**
(lowest free 2–9) when it enters the graph, **persisted** on the node, and never
renumbered by another node's arrival or departure. Both kinds share **one pool**, so a
mixed canvas can no longer collide. Collisions arriving from outside (a file, a paste) are
settled by moving the **newer** node only.

**Changes**
- `src/store/keyboardModes.ts` (new) — the whole law, pure: `isKeyboardKind`,
  `isKeyboardMirror`, `keyboardModeOf`, `lowestFreeKeyboardMode`, `claimedKeyboardModes`,
  `allocateKeyboardMode`, `normalizeKeyboardModes`. Lives in `store/` because the number
  is persisted graph state; `src/components/Nodes/keyboardAssignment.ts` (the old derivation)
  is **deleted**, not shimmed.
- `src/store/graphStore.ts:332` — `addNode` allocates for either kind (skipping a mirror
  created inside a `keyboard` container) and honours an explicit `initialData.assignedKey`.
  It is part of `addNode`'s own history entry, so adding a keyboard is still one undo step.
- `graphStore.ts:1593` (`loadGraph`), `:1723` (`pasteClipboard`, seeded with what is
  already on the canvas so only the copy moves), `:1965` (persist `getItem`, i.e. reload).
- `src/engine/registry.ts` — `keyboard`'s `defaultData.assignedKey: 2` removed; a fixed
  default would pre-claim mode 2 for every keyboard before the allocator ran.
- `src/components/Nodes/KeyboardVisualNode.tsx:121` — reads the persisted number.
- `src/rigs/buildRig.ts:145` — `focusRig` asks the node, not the type, so it finds either kind.

**Pinned by** `src/store/__tests__/keyboardModes.test.ts` (18 tests): allocation 2/3/4;
delete-the-middle leaves survivors alone and frees 3 for the next NEW keyboard; undo/redo
of a delete restores the same number; one history entry; **one pool across both kinds**
(the exact finding: adding a bundle keyboard used to shift every visual keyboard);
explicit pin honoured; the mirror claims nothing; a full serialize → rehydrate round trip;
duplicate re-allocates only the copy. Plus 5 pure-law cases.

**Browser** (`b-2-modes-light.png`): A(kv) B(kv) C(kb) → `MODE 2 / 3 / 4`; delete B →
**A stays 2, C stays 4**; add D → **D gets 3**, nobody moved; reload → byte-identical;
undo + redo → identical.

---

## 3 · The rigs play the on-screen keys — DONE (D12)

**Decision.** All three presets install `keyboard-visual`, wired ROW 1/2/3 → instrument
exactly as before. The beat rig gets **keys, not pads**: the faceplate has no pad layout
today, and promising pads by shipping keys labelled as pads would be the kind of lie this
round is removing. There is no separate "compact" mode either — `keyboard-visual` *is* the
compact on-screen layout (40×56 tiles, 580px card).

**Changes**
- `src/rigs/presets.ts:57` — `KEYBOARD_TYPE = 'keyboard-visual'`, plus a `KEYS_PITCH`
  (640) / `KEYS_AT` / `INSTRUMENT_AT` / `EFFECT_AT` / `OUT_AT` layout so the ~580px-wide
  keyboard does not sit under the instrument; the beat rig's Song moved to `y 580` to
  clear the now-360px-tall keyboard. Jam's blurb now says "Click the keys, or press…".
- `src/rigs/buildRig.ts` — `focusRig` (above), so typing still lands on the rig keyboard.
- `docs/shell.md` §Preset rigs — table updated and the old *"Honest deviation — the rigs
  use `keyboard`"* block replaced with what is now true **and its two costs** (no bundle
  detection → no per-row tuning; no pad layout).
- `src/components/Nodes/NodeWrapper.tsx:490` — **out of the listed files, called out
  deliberately.** `type: 'instrument'` — the type every rig installs, and the one already
  in `InstrumentNode`'s own `NODE_TYPE_TO_CATEGORIES` table — was never dispatched to
  `InstrumentNode`, so a rig's instrument rendered as an anonymous fallback card with raw
  port names and no voice picker. Two lines (`SCHEMATIC_TYPES` + the `case`). Verified in
  the browser and against the full suite; revert is a two-line revert.
- `src/components/Nodes/InstrumentNode.tsx:543` — the empty-state line now names the node
  a beginner would have to add ("…when a **Keyboard node's** row bundle arrives") instead
  of the bare term "keyboard bundle".

**Pinned by** `src/rigs/__tests__/rigs.test.ts`: the existing wiring test now asserts the
three cables leave `row-1/2/3`, and a new `it.each(GOALS)` — *"gives the %s rig ON-SCREEN
keys that make a note"* — asserts the rig keyboard is `keyboard-visual`, holds mode 2, and
that **all three rows resolve through `resolveKeyboardNotes` to real MIDI notes on the
rig's instrument** (72 / 60 / 48 = C5 / C4 / C3).

**Browser** (`b-3-jam-key-down.png`, `b-3-beat-key-down.png`, real onboarding driven to
the end as the *First time* persona): 1 top-level on-screen keyboard · 30 key tiles · key
hints show (`C5`) · pressing `W` → exactly **one `on` + one `off`** on `(this keyboard,
row 1, key 1)` off the e2e bridge · the instrument card is the real faceplate ("Electric
Piano 1" / "Synth Drum") with a **connected** `IN` socket and a live `AUDIO` out.

**One honest cost, measured.** `keyboard-visual` rows are not detected as bundles, so the
instrument's input panel never expands and all three cables land on its **single** `IN`
socket (`data.rows === undefined`). Every row still sounds; what is missing is the
per-row `NOTE / OCT / OFF` block. See follow-up A.

**`Ctrl+Z`**: jam → 13 nodes → **0** in one step (history: 1 entry, scope `graph`). Beat →
**14 → 14**, because `arrangementStore.setArrangement` calls
`useHistoryStore.getState().clear()` (`arrangementStore.ts:471`) and `installRig` sets the
beat Song immediately after the graph gesture, wiping the rig's only entry. **Pre-existing
and not this round's** (the beat rig has always installed a Song); it is another lane's
file (`src/store/arrangementStore.ts`, TB). Recorded as follow-up B — and `docs/shell.md`
still claims "Ctrl+Z really does remove the rig", which is true for jam/sound and false
for beat.

---

## 4 · Per-key ports — REMOVED (option b), with evidence

**Decision: (b).** A top-level `keyboard-visual` no longer advertises the 31 per-key
ports. The evidence for choosing removal over routing:

1. **Nothing anywhere consumes a per-key connection.** `noteRouting.keyboardSourcePort`
   resolves `bundle-out` / `Row N` / a keys-bundle only; `connectionActivity`
   (`getConnectionsForRow` / `getConnectionsForPedal`) the same; and `ojgraph/emit.ts`
   gives keyboards **no IrNode at all** (`keyboard`, `keyboard-key`, `keyboard-visual` are
   control-only). A `key-q → instrument` cable connected, drew a socket row, pulsed
   nothing and sounded nothing — including `key-space`, which is *not* the pedal port.
2. **Routing them (option a) is not bounded.** `resolveKeyboardNotes` lives in
   `src/audio/ojgraph/` and would need a port-id → `(row, keyIndex)` table — a **fourth**
   copy of the QWERTY layout (registry order, `KeyboardVisualNode.ROW_KEYS`,
   `NodeCanvas.ROW_KEYS`), pushed into the audio tier, plus the same again for the visual
   pulse path. That is a new shared concept for a capability nothing offers a way to use.
3. Code-value #8: thirty grey wells per faceplate for a path that does not work.

**Changes**
- `src/engine/registry.ts:112` — `keyboard-visual.defaultPorts` is now `row-1 · row-2 ·
  row-3 · pedal`, re-spaced, with the reasoning in place of the old "a player may still
  wire one key anywhere" claim (which was not true).
- `src/components/Nodes/KeyboardVisualNode.tsx` — `tileHandlers(portId?: string, …)`: a
  tile with no port is purely playable, and while a cable is in the air it declines the
  drop instead of firing a note under the drag. The **mirror** inside a `keyboard`
  container is unchanged — its per-key ports come from
  `nodeInternals.createKeyboardInternals()` and are really wired to the container's output
  panel, so there the wells stay and still start a cable.
- `src/components/Nodes/KeyboardVisualNode.css:120` — `KeyTile` always renders its
  embedded `Port`, and `packages/**` is out of scope, so the well is hidden by attribute
  (`.oj-key-tile__port:not([data-port-id])`) — the CSS cannot drift from what the node
  advertises.
- `src/store/graphStore.ts:40` (`migrateNodePorts`) — saved sessions drop the stale
  per-key ports on a **top-level** `keyboard-visual`; the cables that lied go with them via
  the existing `connectionPortsExist` filter. Mirrors keep theirs.

**Pinned by** `w5p8Faceplates.test.tsx`: *"advertises NO per-key port"* (ports are exactly
`pedal, row-1..3`; no `[data-port-id^="key-"]` marker; and every marker drawn corresponds
to a port the node really has) and *"keeps the per-key wells on the MIRROR, where they are
really wired"* (the mirror's `key-q` well still starts a connection and plays no note).

**Browser**: both rigs report `keyPorts: 0, rowPorts: 3`; the mirror inside a `keyboard`
container still exposes **30** key wells (`b-4-mirror-dark.png`, dark theme).

---

## 5 · InstrumentRow bundle detection — still a follow-up (did not fall out)

It does not fall out of (4b), and it cannot be closed inside this round's grant:
`bundleManager.getBundleInfo` returns `null` unless the source port is a **composite**
`output-panel-…:port-N` id, which only a container has. Measured after the swap:
`data.rows === undefined` on the rig instrument and all three cables share one input port
(`gate.mjs` §3 output). `src/utils/bundleManager.ts` / `portSync.ts` are outside the
ownership grant. See follow-up A for the shape of the fix.

---

## Also done (review follow-up #10)

`src/engine/registry.ts` — the `midi` node's `name` is now `"MIDI"`, so the palette row
reads "Add MIDI". The action id is derived from the *type* (`node.add.midi`), so
`ContextMenu`'s MIDI special case and `CommandBar`'s type chip are untouched (verified;
`ContextMenu.test.tsx` registers its own label and is unaffected).

## Follow-ups (ranked)

**A. Give a leaf keyboard row a synthesised bundle.** ~25 lines in
`bundleManager.getBundleInfo`: when the source is a keyboard-kind node and the port is
`row-N`, emit a `BundleInfo` with that row's key count and per-key channel labels. It
restores `NOTE / OCT / OFF` per row on every rig instrument, gives each row its own named
socket instead of three cables on one well, and closes review follow-up #2. Owner:
whoever holds `src/utils/**`.

**B. The beat rig cannot be undone.** `arrangementStore.setArrangement` clears the SHARED
history (`arrangementStore.ts:471`), wiping the rig's graph entry. Either scope the clear
to the arrangement domain, or install the Song *before* the graph gesture. Owner: TB
(`src/components/Arrangement` / `arrangementStore`). Until then `docs/shell.md`'s
"`Ctrl+Z` really does remove the rig" is true for jam/sound only.

**C. `ContextMenu` should adopt `placePopover`.** It solves the same problem inline
(`ContextMenu.tsx:269`). One consumer each is not yet a fork; a third would be.

**D. Two cards titled "Keys"** (review #4) — `KeyboardVisualNode.tsx:264` hardcodes
`title="Keys"`, ignoring `data.name`. Less acute on the rig now that the instrument shows
its voice name ("Electric Piano 1"), still a rename the player cannot do.

**E. Review #5–#9 untouched**: header chip repeats the title; QWERTY+click double-release;
drag-across-keys is not a glissando (owner call); `.instrument-output-port` orphan for
P6's delete list; report §10's MIDI-browser claim.

## Unverified

- **Feel.** No note in this round was heard. The click path is proven to reach
  `emitKeyboardSignal` and to resolve to the right MIDI note; whether the rig's on-screen
  keys add perceptible latency over typing is a founder pass with audio playing.
- **Native tier / real MIDI hardware.** Browser only; nothing here is engine code.
- **`keyboard-visual` inside a collab session.** The mode number is now persisted graph
  state rather than derived, so it converges like any other node data — but no two-client
  run was made.
