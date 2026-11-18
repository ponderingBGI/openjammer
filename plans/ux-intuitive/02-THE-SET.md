# The Set — the guiding star, and what it asks of the code

Written 2026-09-03 by the orchestrator. Replaces an earlier draft ("Pieces") that put a second
layer in front of the nodes; the owner corrected it, and the correction is now in `AGENTS.md`,
`PRODUCT.md` and `README.md`:

> **Build the set on the canvas. Bind it to your hands. Play without looking.**

The node canvas is the primary interface — the place a player spends most of their time and the
thing that makes OpenJammer feel like you can build anything. People arrive already speaking it
from ComfyUI, Max, Pure Data and modular. Each node is a simple, intuitive block; the set is what
you build by putting them together, as simple or as deep as the idea demands, with your own
plugins, instruments, samples and loops. Before the show the set is crafted with care. On stage it
is played from hardware: any control and any verb binds to a MIDI knob, pad or button in one
gesture, the way Ableton's Ctrl+M does, so the monitor goes dark and the performer is in the
moment with taped-up buttons. A band routed live through one machine with a chain per player; a
solo act with loops and samples; a recording session where Record is on a pad — same set, same
nodes, same bindings.

## 1. Where we are, measured against the star

- **There is no map mode.** Hardware reaches the canvas only as cables from a MIDI node's Keys /
  Pads / Knobs / Faders ports (`src/engine/registry.ts:152-157`). That is the right node-native way
  to carry *signal* and it stays. But nothing lets a player touch a control or a verb and say
  "this knob". Transport, Record, a looper's record/overdub/clear, mute/solo, a scene change — none
  can be driven from hardware today. `midiStore` already tracks device signatures and presets,
  which is the foundation a set needs to re-bind when the same hardware reappears.
- **130 keybinding actions, none reachable from hardware**, and the palette, menus, keymap and Pi
  tools each restate them. Map mode needs one addressable catalogue of verbs; today there are four.
- **Nodes are not yet simple.** 33 menu entries with `-visual` twins, four panel nodes, five math
  nodes and three legacy instrument categories; three bespoke faceplates weigh 4.1 k lines. A
  ComfyUI player expects each block to be obvious and the power to be in the combination.
- **No model of sound** (FH-2): the transport is honest, the meters are honest, and nothing reads
  them. A set that has gone silent on stage must say so — on the pill, and later on the hardware.
- The fresh-hands persona closest to the star is FH-2 (`FH-2-LOG.md`): keyboard-first, eyes on the
  stage. Space never reached the transport, Enter did not fire the Song's buttons, and the loop
  went silent with the header still saying "making sound". That study is the benchmark.

## 2. What the star asks for — the building blocks

Everything below is a node or a verb. Nothing is a layer in front of the canvas.

1. **Map mode** (`Ctrl+M`, the pill and the topbar carry it). Every control on every node and
   every verb in the catalogue lights as *mappable*; touch one, move a hardware control, bound.
   Bindings live in the set (graph document) beside the node, render as a small chip on the node
   ("CC 21 · MiniLab"), and re-bind by device signature when the hardware comes back. A binding can
   carry the **tape label** the player wrote on the button ("MUTE KICK"); the chip shows it, and a
   set can print its map sheet. Escape leaves map mode; every binding is one undo entry.
2. **One verb catalogue.** About twenty verbs — `add`, `remove`, `wire`, `unwire`, `set`, `move`,
   `name`, `open`/`close`, `group`; Song: `record`, `loop`, `place`, `edit`, `split`, `mute`/`solo`,
   `bind`, `play`/`stop`/`seek`; set: `scene`. One table generates the keymap, the menus, the palette
   rows, the undo titles, the live-region sentence, the map-mode targets and the Pi tools. Inverses
   derived, guardrails in the verb. This is not a nicety: map mode is impossible without it.
3. **Simple nodes.** Each node shows at most four controls on its face; the rest is inside, one
   click away (`open`). The `-visual` twins, panel nodes and math nodes collapse by load-time
   migration (`nodeTypeMigrations.ts` seam) into fewer, clearer blocks; one generic faceplate
   driven by the node's manifest replaces the bespoke three. `group` turns a selection into a
   sub-patch you can open — a normal node-system feature (Max's subpatch, ComfyUI's group), not a
   replacement for nodes. The Add menu has five roles (Play · Sound · Shape · Time · Out) and
   Reverb, Delay, Filter are in it by name.
4. **Macro node.** One control in, N control outs, each with a range and a curve. The node-native
   way to put a whole rig under one knob; it maps like any control.
5. **Snapshot node (scenes).** Captures the values of the controls wired into it; recall by pad,
   with an optional morph time. Song sections, kit changes, "the drop" — one button, eyes closed.
6. **A chain per player.** An Input node per band member (name, meter, own latency readout),
   each with its own effect chain into one Speaker; the native tier's < 5 ms holds per chain and
   the pill shows the worst one. The set is the mixing desk.
7. **Record on a pad.** Arm, count-in, record, stop-and-keep are verbs, so they map. A recording
   session and a performance are the same set with the Song node open.
8. **Sound truth.** One `SignalState` from the master meter feeds the header, the pill, the
   Speaker faceplate and the agent's `look`. "Rolling but silent" has a name.
9. **Hardware feedback (later).** Bindings can send state back (LED on a mapped pad, a fader's
   motor) through the same MIDI node's outputs — the eyes-free loop closed both ways.

**The agent** gets what the hand gets: `look` (canvas, Song, bindings, sound state, in words) ·
`do` (`apply(verbs[])`, live, undoable) · `hear` (`bun oj render` / live capture). "Map my
MiniLab's first knob to the filter cutoff" is a sentence that resolves to one `bind` verb.

## 3. What flow looks like

*Before the show*: open the set, add a Mic for the singer and a Kit for the pads, wire them,
open the Reverb and turn three knobs, `Ctrl+M`, touch the Reverb's mix, turn knob 1, touch the
looper's Record, hit pad 5, write "LOOP" on the tape, leave map mode, save. Twenty minutes, all on
the canvas, every step one undo entry and one sentence.

*On stage*: the laptop lid is half closed. Pad 5 records the loop, knob 1 opens the reverb, pad 8
recalls the drop's snapshot. If the engine ever falters the last good sound holds and a pad LED
tells you before the crowd does.

*Recording*: the same set, the Song node open, Record on pad 1, count-in on. You play. Undo is one
button too.

## 4. The reduction budget (unchanged, reframed)

| surface | today | after |
|---|---:|---:|
| Add-menu entries | 33 | ≤ 20 |
| `EditVerb` kinds | 96 | ≤ 25 (the catalogue) |
| agent tools | 30 | ≤ 12 |
| keybinding actions | 130 | generated from the catalogue |
| stores | 37 | ≤ 15 |
| bespoke faceplates | 27 files | ≤ 6 |
| `src/components` lines | 46 k | ≤ 30 k |

A lane that adds net lines needs a written reason. Map mode is the one feature this plan adds; it
pays for itself by deleting the four restatements of the verb surface.

## 5. Sequence

0. Land the redesign PR (Track 1). It is the floor.
1. **The verb catalogue.** One table; keymap, menus, palette, undo titles, live region and Pi
   tools generated; derived inverses; `apply(verbs[])` replaces the three plan tools. Delete the
   restatements as each surface switches.
2. **Map mode.** Over the catalogue and the node controls; bindings in the set; device-signature
   re-bind; tape labels; the chip; Escape; undo. Verified with a fake Web MIDI device in e2e and
   with the founder's MiniLab on the native tier.
3. **Sound truth** (`SignalState`).
4. **Simple nodes.** ≤ 4 face controls + `open`; twins/panels/math collapse by migration; generic
   faceplate; five-role menu; `group`.
5. **Macro and Snapshot nodes**; **Record on a pad**.
6. **A chain per player** — the band pass, native tier, latency per chain.
7. **Re-run the personas.** FH-2 as the star's benchmark, plus two new ones: *the band* (three
   inputs, one machine) and *eyes-free* (build a set, then complete a performance with the
   screen covered, hardware only). The founder plays it with real hardware and audio before
   anything merges.

## 6. What this does not touch
`ojcore`, `ojproto`, the plugin contract, the wire format, the timeline engine. This is the
control plane earning the discipline the core already has, in service of one star.
