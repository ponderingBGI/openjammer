# W5-P8 — the faceplates a performer plays

Lane: Keyboard · KeyboardVisual · Instrument · InstrumentVisual · MIDI · MIDIVisual ·
MiniLab 3. Builder: Opus 5. Branch `t3code/openjammer-redesign-timeline`.

**Gate: green.** `bun run test:run -- src/components/Nodes src/components/Canvas src/midi
src/engine packages/oj-ui` → **61 files / 661 tests pass** · `bunx tsc --noEmit -p
tsconfig.app.json` → clean · `bunx eslint src/components/Nodes src/components/controls
src/midi src/engine` → clean · `bun run build` → succeeds.
Browser gate (`plans/redesign-new-dna/.scratch/w5-p8/gate.mjs`, node + Chromium on 5218):
**103 assertions ok / 0 fail**, zero console or page errors on every run.

Full suite for good measure: `bun run test:run` → **2244 / 2245**. The single failure is
`src/components/Settings/__tests__/KeybindingsPanel.test.tsx` timing out at 5s — lane P9's
in-flight Settings work in the shared worktree; nothing in this lane touches `Settings/**`.
`src/store src/utils src/components/MIDI src/audio` → 52 files / 769 tests, all pass.

---

## 1. The headline: `keyboard-visual` is a first-class playable instrument

This closes master-plan **Follow-up #1** ("the beginner's rig must show something to
press"). Before this lane, a top-level visual keyboard was a *mirror*: 30 keycaps that lit
up when some **other** keyboard was played and emitted nothing themselves.

### The seam

| Piece | Where | What it does |
|---|---|---|
| Row bundles | `src/engine/registry.ts` — `keyboard-visual.defaultPorts` | Adds `row-1 / row-2 / row-3` (named `Row 1…3`) and `pedal` control outputs **before** the 31 per-key ports. `noteRouting.keyboardSourcePort` resolves a row by NAME and the pedal by the id `pedal`, so no engine code changed at all. |
| Registration | `KeyboardVisualNode` `useEffect` → `audioStore.registerKeyboard(n, node.id)` | The same seam `KeyboardNode` uses. `activeKeyboardId` and the whole QWERTY typing path now resolve to it. |
| The mode number | `src/components/Nodes/keyboardAssignment.ts` → `deriveKeyboardNumber(nodes, nodeId)` | **Pure and derived, never written.** A mount-time `updateNodeData` would push a phantom entry into the player's undo stack; a fixed `defaultData` value would hand every visual keyboard mode 2. So it reserves the numbers `keyboard` nodes have already claimed and hands the rest to the playable visual keyboards in stable id order — the same answer on every render, reload and collab client. An explicit `data.assignedKey` still wins. |
| Click = note | `tileHandlers()` → `audioStore.emitKeyboardSignal / releaseKeyboardSignal` | The **same** call the typing path makes, so per-note sustain (CC64), the cable pulse and the e2e note bridge all see one kind of event. Pointer capture + `onPointerCancel` + `onLostPointerCapture` + an unmount flush: a note ends exactly once, even if the pointer leaves the key or the node is deleted mid-press. |
| The mirror | `isKeyboardMirror(nodes, node)` | A `keyboard-visual` inside a `keyboard` container does **not** register (its parent already did) and plays/lights **through its parent's id**. That also fixes the old defect where the mirror lit up for any keyboard on the canvas: `pressedKeys()` now matches on the source id prefix. |
| Discoverable | `menuCategories` Input row | Added as **On-Screen Keys** — deliberately not "Keys", which would collide with the `keys` *instrument* and make the palette a coin toss. |
| Musical default | `rowOctaves: [5, 4, 3]` | Three rows, three octaves, top row highest. `keyboard` keeps `[4,4,4]` because its rows are re-tuned per instrument ROW once a bundle lands; a leaf visual keyboard has no row to re-tune, so its default has to stand on its own. |

### Proven, not asserted

- Unit (`__tests__/w5p8Faceplates.test.tsx`, 11 tests): registration + mode focus; no extra
  undo entry; number reservation vs `keyboard` nodes; the mirror does **not** register;
  note-on/off with exactly one release; a press on the *well* starts a cable instead of a
  note; and `resolveKeyboardNotes` turning `row-1` + key 3 into MIDI 75 on a connected
  instrument.
- Browser: built `On-Screen Keys → Keys → Speaker` by hand, clicked `W`, and read
  `window.__openjammerE2E.noteEvents()` → `{on, row 1, key 1}` then exactly one `off`;
  the instrument's socket core went `is-connected`; then pressed the node's own mode number
  and typed `Q`, which routed to the same node id.
  → `p8-01-rig-key-held-light.png`, `p8-02-rig-typed-light.png`, `p8-03-rig-light.png`.

### Honest deviation — this rig sounds, but it makes no instrument ROW

`keyboard-visual → instrument` **plays**: `resolveKeyboardNotes` falls through to the
per-port offsets path and produces real notes. What it does **not** produce is an
`InstrumentRow` (the Note/Octave/Offset/Spread tuning block), because
`bundleManager.getBundleInfo` only recognises a bundle whose source port is a **composite
`<output-panel-id>:<port-id>`** — i.e. a container node with an internal output panel.
A leaf `keyboard-visual` cannot be that and also own the 31 per-key ports: the panel sync
would replace them.

Rather than hide it, the Instrument faceplate now tells the truth (see §4) and this is
written down as a follow-up:

> **P8 → follow-up (owner call).** To give a visual keyboard full per-row tuning, either
> (a) teach `bundleManager.getBundleInfo` to accept a leaf source that declares `row-N`
> ports plus the `key-*` ports feeding them, or (b) mint an internal output panel for
> `keyboard-visual` in `nodeInternals.ts` and move its keys to a child. Both live outside
> this lane's files (`src/utils/bundleManager.ts`, `src/utils/nodeInternals.ts`,
> `src/store/graphStore.ts`).

---

## 2. KeyboardVisual — the faceplate

**Screenshots:** `p8-11-keyboard-visual-{light,dark}.png` ·
`p8-12-keys-2x-{light,dark}.png` (2×) · `p8-13-key-lit-{light,dark}.png` ·
`p8-16-selected-{light,dark}.png` · `p8-17-key-focus-ring-{light,dark}.png`

**Parts:** `NodeFrame` · `NodeShell` · `KeyTile` (`key` variant, `size=34`, `hint`) ·
`PortRow`.

**The layout is the argument.** Three staggered rows of keycaps, and **each row ends in the
socket that carries it** — `ROW 1`, `ROW 2`, `ROW 3`, and `PEDAL` at the end of the
spacebar. A player who has never read a manual can see that *these ten keys leave on this
cable*, because the cable leaves from the end of the row it belongs to. One CSS grid holds
all four rows so every socket lands in the same column regardless of the stagger.

**One tile, two jobs.** The key FACE plays; the well in its corner patches. And while a
cable is already in the air the WHOLE tile becomes the socket, because that is the target
the hand is aiming at (`isConnecting` from `canvasStore`). Per-key canvas connections
therefore still work, and every key still carries `data-node-id` / `data-port-id` /
`data-port-type` through KeyTile's embedded `Port`.

**Type on the key:** the QWERTY letter is the primary glyph (11px/600, `--text-primary`) —
it is what you press and what the port is named after. The note it will sound (`C5`, `C#5`)
is a 9px mono caption above it. The caption deliberately drops KeyTile's inset chip fill on
this faceplate: the pill is the system's voice for a value you can *grab*, and this one is a
readout.

**The green ring is gone.** `MODE 2` is a mono chip in the header, tinted with `--accent-ink`
on an accent-tinted inset when this keyboard has the number keys. In the New DNA green means
*healthy*, never *selected* (W4-S4 review finding #2).

**States:** default · hover (`translateY(-2px)`, KeyTile) · press/hit (solid accent fill,
`translateY(1px)`, inset press shadow) · connected (socket core takes the wiring colour) ·
selected (`NodeShell` accent edge) · dragging (`NodeShell` lift) · agent-pending
(`useIsAgentPending` → violet hairline) · flashing (refused gesture → warning border) ·
keyboard focus (one shared ring on the tile; Enter plays, release stops) · reduced-motion
(blanket rule; verified in-browser, every transition ≤ 0.01s).

---

## 3. Keyboard (the bundle node)

**Screenshots:** `p8-11-keyboard-{light,dark}.png`

**Parts:** `NodeFrame` · `NodeShell` · `PortRow`.

Four socket rows — `ROW 1 [10 KEYS]`, `ROW 2 [9 KEYS]`, `ROW 3 [10 KEYS]`, `PEDAL` — where
the count is the real bundle size read from `portSync.detectBundleInfo`, in the mono chip
voice because it is an exact number. Below them, one calm secondary line that changes with
the live state: *"Press 2 to play this keyboard."* → *"Type Q-P / A-L / Z-/ to play. Space
sustains."* → *"Sustaining — release Space to let go."* (accent ink).

Deleted: the 4px `--accent-success` border, the 12px green halo, the floating green
`keyboard-active-badge` (an inline-styled absolutely-positioned dot) and the bespoke
`.keyboard-octave` chip — `NodeShell`'s type chip is the same object, defined once.

---

## 4. Instrument

**Screenshots:** `p8-11-instrument-{light,dark}.png` ·
`p8-20-instrument-rows-{light,dark}.png` · `p8-14-instrument-picker-{light,dark}.png` ·
`p8-15-picker-focus-{light,dark}.png`

**Parts:** `NodeFrame` · `NodeShell` · `PortRow` · `ValueScrubber` · `Menu` /
`MenuCategory` / `MenuItem` · `Input`.

1. **Sockets are the first body row (D7).** Every connected keyboard row on the left, the
   audio out on the right, then a dashed `ADD ROW` placeholder. Previously the input sockets
   were built only from `data.rows`, so a cable from a source that makes no row (a visual
   keyboard's `Row 1`, a Math node, a plugin) landed on a node that **looked unplugged**.
   Now every live cable has a labelled socket row, named by its instrument row when there is
   one and `IN` when there is not.
2. **The picker is the shared `Menu`.** Real `role="menu"` rows with roving Arrow / Home /
   End focus, Escape, and outside-click on `pointerdown`; the search field is an `Input` and
   `ArrowDown` out of it lands on the first voice. It replaces a grid of clickable `div`s
   that no keyboard could reach. It anchors to the card instead of measuring the viewport,
   which also fixes the picker mispositioning at any zoom ≠ 1 — and deletes the
   `DROPDOWN_LAYOUT` table, the `ResizeObserver`, the window `resize` listener and the
   5px drag-threshold state machine.
   While it is open it takes an **empty modal binding set** (`useModalKeymap`), the app's own
   seam for "this owns the keyboard" — so no canvas letter (which is a NOTE in keyboard
   mode) can fire while a menu row has focus.
3. **The category headers stopped repeating the rows.** The old picker grouped by
   `def.name`, and since a definition's name is also its label, every group held exactly one
   instrument: *"ACOUSTIC GRAND PIANO / Acoustic Grand Piano, CHURCH ORGAN / Church Organ"* —
   a header above every row, saying the row again. It now groups by the catalogue's own
   **family** (`def.category`) and shows headers only when the node type spans more than one.
4. **The name in the header is a real `<button>`** with `aria-haspopup` / `aria-expanded`,
   in the tab order, with the one focus ring. The node is dragged by the grip/header around
   it — which is what the grip dots are for.
5. **Row values are the shared `ValueScrubber`** (wheel via `useScrollCapture`, click to
   type, one snap-to-grid used by both paths). This retires one of the four private
   ValueScrubber copies the reliability audit found.
6. **The empty state tells the truth.** Nothing plugged in → *"Connect a keyboard row to
   play this instrument."* Plugged in but no bundle → *"Playing. Note, octave and offset
   appear when the notes arrive as a keyboard bundle."*

Also deleted: `@keyframes ghost-fade-in` (dead since before the W5-S5 split — defined once,
referenced nowhere) and `.instrument-node.hover-connecting`'s accent **halo** (a drop target
says so with its edge; nothing on this canvas glows but a cable carrying signal).

---

## 5. InstrumentVisual

**Screenshots:** `p8-21-instrument-visual-{light,dark}.png`

**Parts:** `NodeFrame` · `NodeShell` · `PortRow` · `Port` · `ValueScrubber` · `Knob`.

Rebuilt from 35 literal colours — a fixed cream/ink/blue skin that stayed cream in every
theme and repainted the socket, the card, the header and the inline editor by hand. One
recessed strip per row: the row's name, a mono `C4 – F4` readout of what it actually spans,
`NOTE` / `OCT` / `OFF` scrubbers, a real **`Knob` for SPREAD** (the one continuous value
here, and a dial is how an instrument says so), then one well per key under the note it will
sound.

It also **draws the `row-in` port it has always advertised**. That port was declared in the
registry and rendered nowhere — a port the canvas could look up but a player could not see.

Its own `EditableValue` (the fourth private `ValueScrubber` in the app) is gone.

---

## 6. MIDI and MiniLab 3

**Screenshots:** `p8-11-midi-{light,dark}.png` · `p8-30-minilab-node-{light,dark}.png` ·
`p8-31-minilab-panel-{light,dark}.png` · `p8-32-pads-2x-{light,dark}.png` (2×) ·
`p8-33-midi-visual-{light,dark}.png`

**MIDINode / MiniLab3Node** — `NodeShell` + `PortRow` + `Button` + `EditableLabel`.
Connection is a line of `--success-ink` TEXT naming the device, not a glowing green dot with
no label. **The sockets survive "Web MIDI unavailable"**: both nodes used to replace their
entire body with an apology, so a graph you had already wired lost every visible port the
moment you opened it in a browser without a MIDI bridge. The node, its ports and its cables
are all still real when only the hardware is missing, and that is what it now says.

**A dormant engine parameter got its control.** `activeChannel` is read by
`MIDIVoiceRouter.channelMatches` (0 = omni, 1–16 pick one) and nothing in the UI had ever
set it. `MIDINode` now exposes it as a `CHANNEL / OMNI` scrubber — a production line that
was not used, now used.

**MIDIVisualNode** — rebuilt **port-driven, not preset-driven**. The old version walked
`preset.controls.keys.noteRange`, which for the generic preset is `[0, 127]`: it drew 128
keys that were not the node's ports, while the real sockets sat in a list underneath. Now
every drawn control **is** a declared port (keys and pads are `KeyTile`s carrying the shared
well; knobs, faders and strips read as named socket rows, because a dial frozen at zero on a
faceplate with no live MIDI subscription would be a value that lies). The key bed keeps a
playable 22px white key and scrolls rather than compressing — a generic device really does
advertise all 128 notes.

**MiniLab3Visual** — the biggest single cleanup in the lane. **102 literal hex values, the
largest count in the repository**, are gone; `grep -n "#[0-9a-fA-F]\{3,8\}\|rgba\?("
src/components/Nodes/MiniLab3Visual.css` → **empty**. The LAYOUT stays hardware-faithful
(you find the knob where your thumb expects it); the COLOUR is now the canvas's. The mint
body became `--bg-tertiary`; pads are `KeyTile` pads; the 25 keys are `KeyTile` white/black
faces (which keep a piano physically white-and-black in dark, by KeyTile's own
mix-toward-white/black rule); knobs are read-only `Knob`s the hardware drives, greyed until
the first CC arrives; the OLED uses that same physical-object idiom so it is a dark screen
with light type in **both** themes.

And it was **the last faceplate on the shrink-only list**: `.minilab3-key-port` was a bare
`<div>` with no `data-port-type`. See §7.

Dead CSS deleted, not carried: three blocks of MiniLab rules in `MIDIVisualNode.css`
(`:287-315, 328-351, 354-387`) that the markup stopped emitting long ago, plus the
`var(--text-secondary, …)` literal fallbacks guarding aliases that no longer exist.

---

## 7. The port DOM contract closes

`src/components/Nodes/__tests__/portDomContract.test.tsx` — **both exemption lists are now
empty** (110 tests pass):

- `NOT_YET_ON_THE_SHARED_SOCKET` → `[]`. `add`/`subtract` left it in W5-P6;
  `minilab3-visual` left it here. Every registered node type renders every port it
  advertises as an `.oj-port` well carrying `data-port-type`.
- `NO_SOCKETS_HERE` → `[]`. This one is a **finding, not a relaxation**: `midi`,
  `minilab-3` and `instrument-visual` were exempt for reasons that were never really about
  ports (see §6 and §5). The behaviour was fixed rather than the assertion.

The guard test now asserts both lists are empty, so neither can gain a member.

---

## 8. Contrast — measured in the real browser, both themes

Measured by painting each computed colour onto a 1×1 canvas and reading the pixel (parsing
`oklch(...)` as if it were `rgb()` is how a probe invents a failure — the first pass did
exactly that and reported a phantom 1.19:1). Every row is against the colour **actually
painted behind it**. Floor 4.5:1 (nothing here is WCAG "large").

| Element | Theme | Size / weight | Ratio |
|---|---|---|---|
| key legend (Q) | light / dark | 11px / 600 | 17.05 / 14.36 |
| key note caption (C5) | light / dark | 9px / 500 | 5.49 / 5.05 |
| **lit** key legend | light / dark | 11px / 600 | **5.08 / 6.27** |
| **lit** key note caption | light / dark | 9px / 500 | 5.08 / 6.27 |
| row socket label (ROW 1) | light / dark | 9.5px / 600 | 5.49 / 5.05 |
| mode chip (MODE 3) | light / dark | 11px / 500 | 4.57 / 4.50 |
| node title | light / dark | 15px / 600 | 16.20 / 13.85 |
| keyboard hint line | light / dark | 13px / 400 | 7.13 / 6.93 |
| keyboard row count (10 KEYS) | light / dark | 9.5px / 600 | 5.92 / 6.18 |
| instrument name (button) | light / dark | 15px / 600 | 16.20 / 13.85 |
| instrument empty line | light / dark | 13px / 400 | 7.13 / 6.93 |
| instrument row name | light / dark | 9.5px / 600 | 5.49 / 5.05 |
| instrument row value | light / dark | 12px / 500 | 14.17 / 12.81 |
| picker focused item | light / dark | 14px / 500 | 14.17 / 12.81 |
| row span readout (C4 – F4) | light / dark | 11px / 500 | 5.92 / 6.18 |
| key note label (visual) | light / dark | 9.5px / 500 | 4.57 / 4.50 |
| spread knob value | light / dark | 11px / 500 | 5.92 / 6.18 |
| midi device line | light / dark | 13px / 500 | 6.39 / 6.80 |
| midi channel label / value | light / dark | 9.5 / 12px | 5.49 / 5.05 · 14.17 / 12.81 |
| midi-visual section label | light / dark | 9.5px / 600 | 5.49 / 5.05 |
| minilab knob label | light / dark | 9px / 500 | 4.57 / 4.50 |
| minilab fader label | light / dark | 9px / 600 | 4.57 / 4.50 |
| minilab panel legend | light / dark | 8px / 600 | 5.49 / 5.05 |
| minilab logo | light / dark | 13px / 700 | 5.92 / 6.18 |

Lowest measured value in the lane: **4.50:1** (dark `--text-muted` on `--bg-tertiary`, the
system's own micro-label pair). Raw data: `.scratch/w5-p8/gate-results.json`.

**Two contrast defects were found and fixed during the pass**, both by measurement:
- The lit key's letter measured **2.36:1 in dark** — this faceplate's `color:
  var(--text-primary)` was overriding KeyTile's `.is-active { color: var(--text-on-accent) }`,
  and in dark that on-accent ink is the DARK one. Scoped to `:not(.is-active)`.
- The MiniLab OLED rendered as a **white slab in dark** (derived from `--text-primary`).
  It now uses KeyTile's physical-object mix idiom.

---

## 9. Requests for lane P6 (shared node chrome) and oj-ui

None of these blocked the lane; each was worked around in a way that is noted in the code.

1. **`PortRow` cannot forward `active`.** `PortRowProps` extends `HTMLAttributes`, so
   `active` (which `Port` supports, for "this control port is firing right now") is a type
   error on a `PortRow`. The Keyboard node's PEDAL row therefore has no port-level live
   read; the cable pulse carries it instead. Adding `active?: boolean` to `PortRowProps` and
   passing it through would restore it for every faceplate at once.
2. **`Knob` needs `readOnly`.** A hardware-mirrored dial should show its value, refuse the
   gesture, and *not* be dimmed. `disabled` is the only option today, so MiniLab's knobs are
   dimmed until the first CC arrives and then become draggable-but-inert (`onChange` is a
   no-op).
3. **`KeyTile` cannot receive handlers on its embedded `Port` separately from the tile.**
   Data attributes forward to the well and pointer handlers to the button, so
   "press the face to play, drag the well to patch" is implemented by hit-testing
   `e.target.closest('.oj-port')` in the consumer. A `portProps` slot would let KeyTile own
   that split.
4. **A shared canvas-slot class.** Each faceplate now repeats three z-index rules
   (`.<family>-frame.is-selected` / `.is-dragging`) because `oj-ui`'s `NodeFrame` puts every
   node on one `--z-node` layer and `SchematicBase.css` (P6's) is where a shared rule would
   live. Six near-identical blocks in this lane alone.
5. **`_sockets.css` has three orphaned rules.** `.keyboard-schematic-body .port-row`,
   `… .port-row.output` and `… .port-label` (`_sockets.css:69-80`) had exactly two emitters
   — `MIDINode` and `MiniLab3Node` — and both are on `PortRow` now. Nothing renders
   `.keyboard-schematic-body` any more. P6 owns that file; keep-on-doubt is why I left them.
6. **`_sockets.css:120` "one socket size" `!important` block** can drop `Instrument` and
   `Keyboard` from its delete-list: neither passes an inline port size any more.

---

## 10. Deviations, and things that stayed

- **`MIDINode.css` was P6's row** in the audit's ownership table (§7 P6 line) but my brief
  assigns MIDI to P8. I took it; flagging the overlap so it is not done twice.
- **`activeChannel` gained a control; `midiLearnMode` did not.** `midiLearnMode` /
  `learnTarget` are declared in `engine/types.ts` and **nothing anywhere sets them true**.
  A "LEARN" chip for a state no code can enter is dead UI, so I did not add one. Either wire
  MIDI-learn or delete the fields (`engine/types.ts` is not this lane's file).
- **Pad velocity is now a binary hit.** MiniLab pads used a `--pad-brightness` custom
  property scaled by velocity/pressure over a literal blue LED. The New DNA's hit state is a
  solid accent fill by design, and KeyTile owns it; I did not reintroduce a per-velocity
  wash. If the founder wants velocity visible on the pads, it belongs in `KeyTile` as an
  intensity prop, once, not as a per-faceplate repaint.
- **`generateNumberedControls`** (`MIDIDeviceConfig.ts`) was declared and never called —
  deleted (audit dead-code table).
- **Note names deduped** into `src/components/controls/noteNames.ts` (`NOTE_NAMES`,
  `noteName`, `noteOctave`, `noteLabel`, `isBlackKey`, `noteLabelFromDegree`). Consumers
  moved: `MIDIDeviceConfig`, `MiniLab3Visual`, `MIDIVisualNode`, `InstrumentNode`,
  `InstrumentVisualNode`. **Still to move (other lanes):** `SamplerNode.tsx:45-51` (P7).
- **`.editable-value` / `:hover` stay in `InstrumentNode.css`.** `LooperNode` (P7) is still
  their only consumer; when P7 moves the looper onto `ValueScrubber`, that block goes with
  it. Noted in the file.
- **The device-preset cards in the MIDI browser cannot create a node.**
  `MIDIIntegration.handleSelectDevice` returns `false` when `deviceId` is null, so clicking
  "Generic MIDI Device" in `MIDIDeviceBrowser` closes nothing, creates nothing and says
  nothing. Found while building the harness; the MIDI-chrome lane owns
  `src/components/MIDI/**`.
- **Registry `midi-visual.dimensions` (650×400)** is now approximate for the generic device,
  whose bed scrolls. Dimensions only feed marquee/fit approximations; correcting it is a
  registry edit outside this lane's grant.

---

## 11. UNVERIFIED

- **Audio feel.** No note in this report was *heard*. Clicking a key is proven to reach
  `emitKeyboardSignal` → `executor.noteOn` and to resolve to the right MIDI note, but
  whether it feels immediate under a hand, and whether the click-to-play path adds any
  perceptible latency over typing, is a founder pass with audio actually playing. Covenant:
  a taste-tier model or a human signs off on feel.
- **Real MIDI hardware.** Headless Chromium exposes `requestMIDIAccess` but has no devices
  behind it, so the harness installs a two-port stub (`MIDI_STUB` in `gate.mjs`; it emits no
  messages — nothing is faked beyond "a controller is plugged in"). Everything downstream of
  a real MIDI *message* — the MiniLab knobs turning, the pads lighting from velocity, the
  key bed following a played note, the channel filter actually filtering — is unproven on
  this machine and needs the founder's MiniLab 3.
- **Native tier.** Everything here is browser-only; nothing in this lane is engine code.
- **Concurrent-lane noise.** Two gate runs were polluted by other lanes' in-flight HMR
  states in the shared worktree (a deleted `Arrangement/TransportStrip.tsx` still imported;
  an `AudioHealthPanel` `verdict is not defined`; a `ClipView` export removed mid-edit). The
  final run is clean; none of those files are this lane's.

---

## 12. Files

**Rewritten:** `src/components/Nodes/` → `KeyboardNode.{tsx,css}`,
`KeyboardVisualNode.{tsx,css}`, `InstrumentNode.{tsx,css}`, `InstrumentVisualNode.{tsx,css}`,
`MIDINode.{tsx,css}`, `MIDIVisualNode.{tsx,css}`, `MiniLab3Node.tsx`,
`MiniLab3Visual.{tsx,css}`, `MiniLab3VisualNode.tsx`.

**New:** `src/components/Nodes/keyboardAssignment.ts` (the derived mode number, kept out of
the component module so react-refresh stays happy and the rule is testable on its own) ·
`src/components/controls/noteNames.ts` · `src/components/Nodes/__tests__/w5p8Faceplates.test.tsx`.

**Edited narrowly:** `src/engine/registry.ts` (keyboard-visual ports / data / name /
dimensions + the Input menu row — the playability change only) ·
`src/components/controls/MIDIDeviceConfig.ts` (note-name dedupe, dead export removed) ·
`src/components/Nodes/__tests__/portDomContract.test.tsx` (both exemption lists emptied).

**Artifacts:** `plans/redesign-new-dna/.scratch/w5-p8/` — `gate.mjs` (the harness),
`gate-results.json` (103 assertions + every contrast measurement), `dev.log`, 30 screenshots.
