# Pieces — the instrument after the redesign

Written 2026-09-03 by the orchestrator, after four fresh-hands studies, a heuristic audit and the
UX-1 wave. This is the plan for the thing the redesign could not fix: the building blocks
themselves. It is a control-plane migration in TypeScript. `ojcore` does not change.

## 1. What we learned, read as one finding

Four personas, one shape. The app is rigorously honest about its **transport** and has no model
of **sound**. Its vocabulary fragments because its building blocks fragment. Measured today:

| surface | count | what a person or agent can hold |
|---|---:|---|
| node types in the Add menu | 33 (with `-visual` twins, panel nodes, math nodes) | ~7 |
| `EditVerb` kinds | 96 | ~20 |
| agent tools (`pi-openjammer-graph`) + plan tools | 21 + 9 | 10–20 (every agent-native source agrees) |
| keybinding actions | 130 | — |
| Zustand stores | 37 | — |
| `src/components` | 46 k lines; three bespoke faceplates alone are 4.1 k (`LibraryNode` 1979, `LooperNode` 1374, `SamplerNode` 731) | — |
| tests | 44 k lines, tracking the surface above | — |

The one thing every persona called a delight was the **rig**: a small, named, pre-wired thing that
made sound the moment it landed and had a few controls that mattered. That is the puzzle piece.
The node graph underneath it is where they got lost (stacked spawns, cables, port names, no
"Reverb" in the menu, a track with no voice).

What the instruments people love do: the OP-1 puts a whole studio behind four knobs and one screen
and is *faster* than a DAW because there are fewer choices at each step; every module works alone
and connects through one pipe. Tidal/Strudel make rhythm cheap with a vocabulary you can hold in
your head: everything is a pattern or a function on patterns. Value graphs (Max, geometry nodes)
compose because any cut of the graph is a valid sub-piece. Agent-native design converges from the
other side: 10–20 verb-first tools, parity between what a hand can do and what an agent can call,
and one catalogue that generates every binding.

## 2. The idea: pieces, one verb set, sound truth

### Pieces, not nodes
A **piece** is the unit a hand and an agent both think in: a named subgraph with a faceplate, one
line of "what it does", **at most four exposed controls**, typed in/out. Built-ins are pieces
(Keys, Pads, Pluck, Kit, Reverb, Delay, Filter, Looper, Speaker, Mic, MIDI). A rig is a piece. A
selection on the canvas can be *made into a piece* (the value-graph cut: the wires crossing the
selection are its ports). Every piece **opens** to show its nodes, and a node is just a piece with
no lid. Progressive disclosure with no ceiling, which is what `PRODUCT.md` promised.

Consequences, all reductions:
- The `X` / `X-visual` twins, `input-panel` / `output-panel` / `canvas-input` / `canvas-output`,
  `container`, `add`/`subtract`/`multiplier`/`pan`/`width`, `strings`/`keys`/`winds` stop being
  menu items. They are internals of pieces or plain nodes inside an opened piece.
- The Add menu has **five roles** — Play · Sound · Shape · Time · Out — and about **20 entries**.
  "Reverb" is a piece, not a kind inside an Effect node.
- One generic faceplate, driven by the piece's manifest (`AutoParamPanel` already exists), replaces
  the three bespoke ones. Bespoke UI is allowed only where the piece *is* the UI (Keys, the Steps
  card, the Looper's rings) and lives behind the same manifest.
- The plugin contract is unchanged: a `PluginManifest` + `DspInstance` *is* a piece. The community
  authors pieces; Pi authors pieces (`author_code_node` becomes "make a piece").

### One verb set, shared by hand and agent
Today a hand drives 130 actions, the history records 96 verb kinds, the agent has 30 tools across
two surfaces, and the palette, the menus, the keymap and the Pi schema each restate them. One
catalogue, about twenty verbs, generates all of them:

`add(piece, at)` · `remove` · `wire(from, to)` · `unwire` · `set(control, value)` · `move` ·
`name` · `open`/`close` (a piece) · `make_piece(selection)` — and for the Song:
`record` · `loop(range)` · `place(clip, at)` · `edit(notes)` · `split` · `mute`/`solo` ·
`bind(track, piece)` · `play`/`stop`/`seek`.

Rules for every verb: reversible with a **derived** inverse (not hand-written), one history entry,
one sentence in the live region ("Added Reverb after Pluck"), one keybinding, one menu row, one Pi
tool — all emitted from the catalogue. `batch_apply` / `emit_plan` / `validate_plan` collapse to
one `apply(verbs[])` with a dry-run flag; guardrails live in the verbs, never in the prompt.

### Sound truth
One `SignalState`, read from the master meter, feeds the header, the pill, the Speaker faceplate
and the agent's `look`. "Rolling but silent" is a state with a name, in warning ink, before anyone
asks. The performer's study found the meter was the only component telling the truth and nothing
else read it. That ends.

### The agent's three moves
`look` (the canvas and the Song in words, including sound state and what is unbound) · `do`
(`apply(verbs[])`, live, undoable) · `hear` (`bun oj render` offline audition, or a live capture).
That is the whole surface. It mirrors what a hand does: see, act, listen.

## 3. What flow looks like after this

A first run: "What do you want to make?" → *a beat* → four pieces land wired and sounding (Pads →
Kit → Speaker, plus a Steps card) → tap, hear → Space, loop → Add → Sound → Reverb, it auditions
itself as it lands → Ctrl+Z if not → it is already saved. Every action is one word, one undo
entry, one sentence spoken. Nothing to learn before the first sound; nothing hidden after it.

A performer: every piece's four controls are the four things the keyboard reaches; Space is the
transport wherever a Song exists; Stop always stops; the header says *silent* when it is.

An agent: `look` → `apply([add('Delay', after='Pluck'), set('Delay.time', '1/8')])` → `hear` →
one paragraph back to the player naming what changed. The same verbs the player just used.

## 4. The reduction budget (measured, tracked in `COVERAGE.md`'s successor)

| surface | today | after |
|---|---:|---:|
| Add-menu entries | 33 | ≤ 20 |
| `EditVerb` kinds | 96 | ≤ 25 |
| agent tools | 30 | ≤ 12 |
| keybinding actions | 130 | ≤ 60 (one per verb per surface, generated) |
| stores | 37 | ≤ 15 |
| bespoke faceplates | 27 files | ≤ 6 |
| `src/components` lines | 46 k | ≤ 30 k |
| tests | 44 k | shrinks with the surface; the gates stay |

A lane that adds net lines needs a written reason.

## 5. Sequence (each step a migration, no shims left behind)

0. **Land the redesign PR** (Track 1). It is the floor; nothing below relitigates it.
1. **Piece manifest over the existing registry.** Every node type gets `role`, `blurb`,
   `controls[≤4]`, `opens`. The Add menu, palette and Pi `list_node_types` read it. No behaviour
   change. (Small; unlocks everything.)
2. **The verb catalogue.** One table; the keymap, menus, palette rows, undo titles, live-region
   sentences and Pi tools are generated from it; derived inverses; `apply(verbs[])` replaces the
   three plan tools. Delete the hand-written duplicates as each surface switches.
3. **Sound truth** (`SignalState`, U17) and the agent's `look`/`hear`.
4. **Twins and panels collapse into pieces.** Migration on load (the `nodeTypeMigrations.ts` seam
   already exists); delete the types. Generic faceplate replaces Library/Looper/Sampler bespoke UI.
5. **`make_piece` and `open`.** Selection → piece; piece → its nodes. The step-sequencer card is
   the first opened piece.
6. **Re-run the four personas.** The bar from `00-PLAN.md` stands: first sound under 30 s with no
   hints, every hidden gesture has a twin, and the founder has heard it.

## 6. What this does not touch
`ojcore`, `ojproto`, the plugin contract, the wire format, the timeline engine. This is the control
plane earning the same discipline the core already has.
