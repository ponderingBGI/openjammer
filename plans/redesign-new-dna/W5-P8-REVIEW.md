# W5-P8 review — the faceplates a performer plays

Gatekeeper: Opus 5. Read-only. Branch `t3code/openjammer-redesign-timeline`, uncommitted.
Artifacts (76 captures + 5 harnesses + raw JSON): `plans/redesign-new-dna/.scratch/w5-p8-gate/`.

## Verdict

**COMMIT.** The delta is strongly positive over what is on disk, every gate is green, and
the two must-fixes are small and local. Must-fix 1 has to land before the Wave-6 coverage
gate; must-fix 2 needs either the fix or an explicit owner acceptance plus a pinned test.

## Gates (re-run, not taken on trust)

| Gate | Result |
|---|---|
| `bun run test:run -- src/components/Nodes src/components/Canvas src/midi src/engine src/store packages/oj-ui` | **86 files / 922 tests pass** |
| `bunx tsc --noEmit -p tsconfig.app.json` | clean — **zero** errors, none from other lanes |
| `bunx eslint src/components/Nodes src/midi src/engine src/store` | clean |
| `bun run build` | succeeds (725 kB / 157 kB gz) |
| Browser (node + one Chromium on 5224, light + dark, ~16 page loads) | **52 ok / 4 fail**, **zero console or page errors on every run** |
| `portDomContract.test.tsx` | 110 tests, both exemption lists `[]`, the guard asserts both |
| `grep -nE '#[0-9a-fA-F]{3,8}\|rgba?\(' ` over all 7 P8 CSS files | **empty** (stronger than the claim, which was MiniLab3Visual only) |
| Every `var(--…)` used in the 7 CSS files | all 38 resolve to a defined token; no retired ones |

## Per-faceplate verdicts

| Faceplate | Verdict | Note |
|---|---|---|
| **KeyboardVisual** | **PASS** | The best work in the lane. Rows end in the socket that carries them; the argument is legible without a manual. Both themes coherent. |
| **Keyboard** (bundle) | **PASS** | Honest, calm, green ring and badge gone (master-plan follow-up #2 closed). |
| **Instrument** | **PASS, must-fix 1** | Picker is a real `role="menu"` with roving focus, Escape, outside-pointerdown and no note leak — all verified — but it opens below the fold. |
| **InstrumentVisual** | **PASS** | Draws the `row-in` port it always advertised; 1/1 ports; 7.13 / 6.93 on its tightest label. |
| **MIDI** | **PASS** | 3/3 ports; connection is `--success-ink` TEXT naming the device; `CHANNEL / OMNI` wires a dormant engine parameter. |
| **MIDIVisual** | **PASS** | Port-driven, not preset-driven. 130/130 ports unique in the browser. |
| **MiniLab 3** | **PASS** | Hardware-faithful layout, tokens only, white/black keys stay physical in dark, OLED legible in both. Excellent. |

## The playability seam — adversarial

Verified against the running app, not the report.

**What holds.**
- `keyboard-visual` registers through the same `registerKeyboard` seam; the top-level node is
  deletable (`UNDELETABLE_INTERNAL_TYPES` is guarded by `if (node.parentId)`), so the new
  palette entry is not a trap.
- Row bundles resolve with **no engine change**: `noteRouting.keyboardSourcePort` matches
  `p.name.toLowerCase().includes('row N')`, and the registry names them `Row 1…3`; the pedal
  matches `getKeyboardControlPortId` by the id `pedal`. Read the code end to end — nothing in
  `src/audio/**` was touched and nothing needed to be.
- **Click = note.** One press on `W` → exactly one `on` and one `off` on `(kvId, row 1, key 1)`
  read off `window.__openjammerE2E.noteEvents()`.
- **Drag across keys → the first note holds; 1 on / 1 off; no leak.** Pointer capture retargets
  everything to the first tile, so it is *not* a glissando. Correct and safe; whether a real
  instrument should glissando is an owner call (follow-up 8).
- **Unmount / stray Delete while a key is held**: balanced 1/1, no stuck note.
- **Sustain**: the SPACE tile drives `emitControlDown/Up`, i.e. the same `SustainController`
  as CC64, and shows the pedal-down state. Clicked keys share `sustain.onNoteOn`, so a
  re-press of a held note owns the voice cleanly.
- **The mirror**: a `keyboard-visual` inside a `keyboard` container still exists, does not
  register, and plays/lights through its parent id.
- **Menu**: "Add On-Screen Keys" is the first Input row; it does not collide with the `keys`
  instrument in the palette.
- **Stability**: mode numbers are byte-identical across a full reload, and `Ctrl+Z` restores
  every original number. Adding an on-screen keyboard writes **one** history entry (the node
  add) — the derivation costs nothing.

**What does not hold — the multi-keyboard mode finding.**

Two on-screen keyboards get MODE 2 and MODE 3. Then, measured per node id:

```
add a bundle Keyboard   →  MODE 2 → MODE 3   and   MODE 3 → MODE 4   (both shift)
delete one visual kbd   →  the survivor      MODE 4 → MODE 3
```

`deriveKeyboardNumber` reserves what the `keyboard` nodes claimed and hands the rest out in
id order, so *every* visual keyboard renumbers whenever the population changes. A `keyboard`
node's number is persisted and never moves. Two kinds of keyboard now live under two
different laws, and mid-set "press 2 to play this keyboard" silently becomes "press 3"
because you dropped a node somewhere else on the canvas. The derivation was the right call
(a mount-time write would poison the undo stack); the gap-filling rule is what needs to
change — e.g. never surrender a number a node has already registered, only fill upward from
it. Nothing currently pins either behaviour: `w5p8Faceplates.test.tsx` tests reservation
against `keyboard` nodes but not add/delete churn.

**QWERTY + click on the same note**: 2 on / 2 off. No leak and no stuck note, but the mouse
release kills the still-held typed note and clears the lit state while the physical key is
down. Define it (refcount per note, or ignore a click on a note already sounding).

## Contrast and motion — measured in the browser, both themes

Painted onto a 1×1 canvas and read back (the only way to get a number out of Chromium's
`oklch(...)`), against the colour actually painted behind. Floor 4.5:1; nothing here is
WCAG "large".

| Element | light / dark |
|---|---|
| **MODE chip (tightest in the lane)** 11px/500 | **4.57 / 4.50** |
| key note caption `C5` 9px/500 | 5.49 / 5.05 |
| row socket label `ROW 1` 9.5px/600 | 5.49 / 5.05 |
| keyboard row count `10 KEYS` 9.5px/600 | 5.49 / 5.05 |
| instrument socket label `ADD ROW` 9.5px/600 | 5.49 / 5.05 |
| key legend `Q` 11px/600 | 17.05 / 14.36 |
| node title / instrument name 15px/600 | 16.20 / 13.85 |
| midi-visual socket `Pitch Bend` 9.5px/600 | 7.13 / 6.93 |
| instrument-visual `AUDIO` 9.5px/600 | 7.13 / 6.93 |

Independently corroborates the lane's table on every row sampled. The floor is **4.50:1**
(`--text-muted` on `--bg-tertiary` in dark) — it passes by 0.00. That is a system-level pair,
not this lane's invention, but it means any future darkening of `--bg-tertiary` breaks P8
first.

**Motion**: with `prefers-reduced-motion: reduce`, every transition and animation inside the
keyboard faceplate measures ≤ 0.02s. **Focus**: one accent ring, and zero static outlines
anywhere inside a node.

## Port DOM contract

`portDomContract.test.tsx` now asserts, for every registered type, that each advertised port
has a marker carrying `data-port-type` that is (or wraps) an `.oj-port`, with **both**
exemption lists empty and a guard that they stay empty. It does not assert *uniqueness*, so I
counted in the browser instead — `.oj-port[data-node-id][data-port-id][data-port-type]` per
node, top-level and inside containers:

`keyboard-visual 34/34` · `keys 2/2` · `speaker 1/1` · `midi 3/3` · `minilab-3 1/1` ·
`midi-visual 130/130` · `instrument-visual 1/1` — every one exact, unique, zero extras.
`minilab3-visual` was reached inside its container and renders as a `NodeShell`.

Dragging `keyboard-visual:row-1 → instrument` and `instrument:audio-out → speaker` both
landed in the wells; the cables render with no first-frame drift (4 paths, endpoints on the
socket centres).

## Interplay with P6's uncommitted base change

Every P8 frame renders exactly **one** `.oj-node` and **one** `.oj-node__header`; zero
legacy `.node-card` / `.base-node` / `.schematic-node__header`. No P8 faceplate emits
`.schematic-node` any more (only the container and panel nodes do), so P6's alias does not
double-apply. Every label is `.oj-port-row__label` — S3's labels render correctly and the
`.port-label` override P6 removed is not needed by anything here.

## Ranked must-fix

1. **The instrument picker opens below the fold and cannot be reached.**
   `InstrumentNode.css:151` — `.inst-picker { position: absolute; top: calc(100% + 6px); }`.
   Pure CSS, no viewport clamp and no upward flip. With the instrument at canvas y ≈ 880 in a
   1050px viewport the menu measures `top: 1078 / bottom: 1596` — the **entire** menu is
   off-screen, and `End` focuses an item outside the viewport. The user clicks the instrument
   name and nothing appears; the only escape is to close, pan, reopen. This is a regression
   introduced by this lane: the old path measured the viewport (the deleted `DROPDOWN_LAYOUT`
   + `ResizeObserver`). Anchoring to the card was right for zoom; it needs one clamp/flip on
   top. Proof: `g-l1-picker-low.png`, `g-l2-picker-end.png`.

2. **Mode numbers renumber on any keyboard add/delete** (measured above). Fix the gap-fill
   rule so a registered keyboard keeps its number, or accept it explicitly — and either way
   pin it with a test, because nothing asserts it today.

## Follow-ups

**Ranked, with the judgement asked for.**

1. **Master-plan follow-up #1 is NOT closed — correct the report.** All three preset rigs
   still install `type: 'keyboard'` (`src/rigs/presets.ts:46, 94, 151`), which now renders
   four socket rows and one hint line and **nothing to press**. The lane built the capability;
   no rig uses it, and `src/rigs/**` was outside its grant. The beginner's first run is
   unchanged. Hand the one-word rig swap to whoever owns `src/rigs/**`; until then the report's
   opening line ("This closes master-plan Follow-up #1") should read "unblocks".
2. **InstrumentRow bundle detection — follow-up, not a blocker; confirmed by measurement.**
   `keyboard → instrument` yields `data.rows` with a real row; `keyboard-visual → instrument`
   yields `rows: null`, exactly as declared. **But the notes arrive.** With no row,
   `resolveKeyboardNotes` falls through to the per-port offsets path and row 1 sounds C5…A5
   (`rowOctaves [5,4,3]`) — the same ten notes per cable a `keyboard` row delivers, and each
   row is its own cable on both node types. What is missing is only the NOTE/OCT/OFF/SPREAD
   tuning block, and the faceplate says so in plain words. **A rig built on `keyboard-visual`
   is musically complete; it is not tunable.** Fix in `bundleManager.getBundleInfo` /
   `nodeInternals.ts` as the lane proposed.
3. **Per-key ports are sockets that lie for the note path.** `resolveKeyboardNotes` and
   `getConnectionsForRow` resolve only the `row-N` port, so a cable from `key-q` to an
   instrument connects, gets a labelled `IN` socket row, pulses nothing and sounds nothing.
   The registry comment this lane added — "a player may still wire one key anywhere" — is not
   true for instruments. Route per-key connections or delete the claim. (Thirty grey wells per
   faceplate also carry a real visual cost for a path that does not work.)
4. **Two cards on the canvas both titled "Keys."** `KeyboardVisualNode.tsx:264` hardcodes
   `title="Keys"` while the `keys` instrument is also "Keys". The lane avoided precisely this
   collision in the palette ("On-Screen Keys") and reintroduced it on the canvas. The hardcode
   also means the node cannot be renamed and ignores any saved `data.name`.
5. **The instrument header chip repeats the title** — "Keys / KEYS", "Strings / STRINGS".
   The same "the header says the row again" defect the lane correctly fixed inside the picker.
6. **QWERTY + click double-release** (above) — define it.
7. **Drag across keys is not a glissando** (above) — owner call; today's behaviour is safe.
8. `.instrument-output-port` in `_sockets.css` now has **zero emitters** — orphaned by this
   lane's rewrite and not listed in its §9 requests. Add it to P6's delete list next to the
   three `.keyboard-schematic-body` rules (also confirmed orphaned).
9. **Report §10's MIDI-browser claim is wrong as written.** Clicking the first card in the
   device browser minted a `midi` node plus its `midi-visual` (verified, both themes). Re-scope
   the claim to the `deviceId === null` preset cards specifically, or drop it.
10. The `midi` registry `name` is `"Midi"`, so the palette row reads "Add Midi". Should be
    "MIDI". Not this lane's edit; one word in `registry.ts`.

**The six base / oj-ui requests — judged.**

| # | Request | Judgement |
|---|---|---|
| 1 | `PortRow` forwards `active` | **Accept.** One optional prop passed to the embedded `Port`; restores the pedal's live read for every faceplate at once. No new concept. |
| 2 | `Knob` gains `readOnly` | **Accept.** A hardware-mirrored dial that is *dimmed* reads as broken; `disabled` is the wrong word for "driven from elsewhere". Should also leave the tab order and set `aria-readonly`. |
| 3 | `KeyTile` `portProps` slot | **Accept, lower priority.** The `e.target.closest('.oj-port')` hit-test belongs in KeyTile once, not per consumer — but the current workaround is correct and unit-tested. Do it when a third consumer appears. |
| 4 | Shared canvas-slot z-index class in `SchematicBase.css` | **Accept.** Six near-identical blocks in this lane alone is exactly the duplication code-value #1 forbids. |
| 5 | Delete `_sockets.css:69-80` orphans | **Accept, and add `.instrument-output-port`.** Verified: zero emitters for all four. |
| 6 | Drop Instrument / Keyboard from the `!important` size delete-list | **Accept.** Verified neither emits `.schematic-node` any more and neither passes an inline port size. |

## Unverified

- **Feel.** No note in this review was heard. The click path is proven to reach
  `emitKeyboardSignal → executor.noteOn` and to resolve to the right MIDI note, but whether
  the click adds perceptible latency over typing is a founder pass with audio playing.
- **Real MIDI hardware.** Devices were a two-port inert stub; everything downstream of a real
  MIDI *message* (knobs turning, pads lighting from velocity, the channel filter filtering) is
  unproven here.
- **Native tier.** Browser-only; nothing in this lane is engine code.
- **`prefers-reduced-motion` beyond the keyboard faceplate** — measured on `.keyboard-visual-node`
  only; the blanket rule is global but was not re-measured per faceplate.
