# W5-S5 — splitting `SchematicNodes.css`

**Mechanical, zero-visual-change refactor.** 2 799 lines in one stylesheet were
split into a shared base plus one file per node family. Every declaration moved
byte-identical; the only new bytes are the per-file provenance headers. Proven
identical by a computed-style dump of all 36 renderable node types in both
themes (byte-identical JSON) and by pixel-identical screenshots.

---

## 1. File map — old line ranges → new files

`src/components/Nodes/SchematicNodes.css` (2 799 lines, 62 111 B) is **deleted**.
All new files sit alongside their component in `src/components/Nodes/`
(matching the convention already set by `MIDINode.css`, `SongNode.css`,
`SamplerVisual.css` — no new `styles/` directory was introduced).

| New file | From (old lines) | Lines | Imported by |
|---|---|---:|---|
| `SchematicBase.css` | **L1-57** (`@import './_sockets.css'`, `.schematic-node` shell + selected/dragging/clip-drop, `.schematic-header`) + **L602-604** (the historical "Settings panel was relocated" note) | 69 | `NodeWrapper.tsx` |
| `SpeakerNode.css` | **L59-252** — mute symbol, master slider + live meter, device selector, low-latency indicator | 200 | `SpeakerNode.tsx` |
| `KeyboardNode.css` | **L253-292** — card, active-mode ring, octave chip | 43 | `KeyboardNode.tsx` |
| `InstrumentNode.css` | **L293-426** (body, divider, empty state, pedal row) + **L427-585** (instrument selector dropdown) + **L586-599** (inline editable values) | 314 | `InstrumentNode.tsx` |
| `LooperNode.css` | **L606-1009** — duration scrubber, waveform, loops list, record button, transport pill, export editor, wet control, undo | 408 | `LooperNode.tsx` |
| `MicrophoneNode.css` | **L1010-1132** — latency badge, source selector, device dropdown overrides, mute + slash, waveform | 127 | `MicrophoneNode.tsx` |
| `CanvasIONode.css` | **L1148-1218** (canvas I/O nodes + `@keyframes flash-red`) + **L1300-1415** (output panel) + **L1416-1536** (input panel) | 311 | `CanvasIONode.tsx`, `OutputPanelNode.tsx`, `InputPanelNode.tsx` |
| `KeyboardVisualNode.css` | **L1219-1299** — the full 30-key layout | 83 | `KeyboardVisualNode.tsx` |
| `ContainerNode.css` | **L1537-1603** | 70 | `ContainerNode.tsx` |
| `MathNode.css` | **L1604-1668** | 68 | `MathNode.tsx` |
| `LibraryNode.css` | **L1669-1789** (Sample Library node) + **L1790-2547** (two-panel browser) | 885 | `LibraryNode.tsx` |
| `SamplerNode.css` | **L2548-2799** | 254 | `SamplerNode.tsx` |

`_sockets.css` was **not touched**; `SchematicBase.css` keeps the same
`@import './_sockets.css'` at its head, so one import still carries the whole
shared node language.

### What did not move

**L1133-1147 — three banner comments with no rules** (`Keyboard Node — Bundle
Mode`, `Keyboard Node — Advanced Mode`, `Bundle Mapping Button`). S3 emptied
these when it lifted the port rows into `_sockets.css`; they were empty headings
pointing at nothing. Dropped, not relocated.

**Verbatim check.** Concatenating the 12 new files (minus their headers) and
normalising away blank lines yields a multiset of source lines identical to the
original except for exactly those three banner headings — no declaration, no
selector, no comment inside a rule was altered. (`.scratch/w5-s5/split.mjs`
performs the extraction by line range; the check is in the transcript.)

### Panels: why they live in `CanvasIONode.css`

The deliverable's file list has no panel file. The output/input panels are the
same idea as the canvas I/O nodes (a wall of named ports bridging a container
boundary) and the panels reuse the `flash-red` keyframe defined in the I/O
block, so the three ship together and all three components import that one file.
If a lane later wants `PortPanelNode.css`, the split point is clean
(`OUTPUT PANEL NODE` banner onwards).

---

## 2. Cascade: one real hazard, fixed structurally

Nothing in the split needed a specificity change. One **ordering** hazard was
real, was caught by the computed-style diff, and is fixed properly.

### The hazard

Inside one stylesheet, order is the file. Split across twelve, order becomes
"whichever component React happened to import first" — `NodeWrapper.tsx`'s
component list. That list is not the old file order, and three collisions follow
from it. The first run of the split (per-component imports only) produced
exactly one visible regression:

| Element | Was | Became | Why |
|---|---|---|---|
| `.looper-duration.editable-value` (the Looper's duration chip) | `padding 2px 6px`, `radius 4px`, `height 28px`, `transition background-color` — i.e. **`.editable-value` from `InstrumentVisualNode.css`** won | `padding 0 6px`, `radius 6px`, `height 24px` — **`.looper-duration`** won | `InstrumentVisualNode.css` declares a *second, different* `.editable-value` (with literal `rgba()` colours). It used to load after `SchematicNodes.css` and beat `.looper-duration` at equal specificity. With per-component imports, `LooperNode.tsx` (16th) loads after `InstrumentVisualNode.tsx` (15th), flipping the winner. |

Two more order flips were latent (no default-state pixel to prove them, but the
collision is real): `SamplerNode.css` vs `MIDIVisualNode.css` / `MiniLab3Visual.css`
over `.schematic-title` and `.selected`, and `SpeakerNode.css` vs
`InstrumentVisualNode.css` over `.selected`.

### The fix

`NodeWrapper.tsx` imports the twelve stylesheets **explicitly, in the old file's
order, above every node-component import**:

```ts
import './SchematicBase.css';
import './SpeakerNode.css';
import './KeyboardNode.css';
import './InstrumentNode.css';
import './LooperNode.css';
…
import './SamplerNode.css';
import { InstrumentNode } from './InstrumentNode';
```

Each family file is *also* imported by its own component (per the brief — a node
styles itself in isolation for Ladle, unit tests, future extraction). The
bundler emits one copy; the first evaluation fixes the order, so the manifest
above is the single source of truth for the cascade and a harmless reorder of
the component list can no longer restyle the canvas. That reproduces the old
order against *every other* stylesheet in the tree (`InstrumentVisualNode.css`,
`MIDINode.css`, `MIDIVisualNode.css`, `MiniLab3Visual.css`, `SamplerVisual.css`,
`SongNode.css`, and `BaseNode.css`, which still loads last) — after the fix the
diff is byte-identical, including the Looper chip.

One deliberate consequence: the family sheets (and therefore `_sockets.css`)
now load *before* oj-ui's component CSS, where `SchematicNodes.css` used to load
just after it. No family file contains a single `.oj-*` selector, and
`_sockets.css`'s `.oj-port` rules are unaffected (verified — every port element
of all 36 node types is identical in the diff).

### Cross-family couplings, documented not moved

Two blocks are consumed by a family other than the one whose file they now live
in. Both are presence-safe (all node CSS is co-loaded through `NodeWrapper`) and
both are flagged in the new files' headers for the faceplate lanes:

- `.schematic-dropdown`, `.device-item*` — in `SpeakerNode.css`, also used by
  `MicrophoneNode` (whose own section only adds higher-specificity overrides).
- `.editable-value` — in `InstrumentNode.css`, also used by
  `InstrumentVisualNode` and `LooperNode`. **And duplicated** by a second,
  conflicting definition in `InstrumentVisualNode.css` (which currently wins,
  with hardcoded `rgba()` colours). That duplicate is the root cause of §2's
  hazard and is worth killing during the faceplate pass — it is out of W5-S5's
  ownership.

---

## 3. Zero-visual-change proof

Harness: `.scratch/w5-s5/snap.mjs`, plain `node` + `playwright`, one Chromium,
dev server on `:5216`.

1. Boot with `oj-onboarding-v1` pre-answered and `openjammer-theme` seeded
   (falls back to "Skip, take me in" / `Escape` if the overlay still appears).
2. Add **one node of every registered type** — `Object.keys(nodeDefinitions)`,
   sorted, placed on a deterministic grid — through the app's own
   `useGraphStore.addNode`, the same verb the context menu and the Ctrl+K
   palette call.
3. Wait for commit + `document.fonts.ready`, then walk every element under every
   `[data-canvas-node-root]` and dump a 68-property `getComputedStyle` subset
   (display, position, box metrics, all four borders, background, colour, font,
   shadow, radii, gap, flex, grid templates, cursor, transition, transform, …),
   keyed by **node type + DOM path**, never by node id.
4. Repeat for `light` and `dark`; screenshot the rig in each.

**Result**

| | |
|---|---|
| Coverage | **36** node roots, **1 062** elements, **× 2 themes** |
| Harness noise | **none** — two consecutive baseline runs were byte-identical |
| `before.json` vs `after.json` | **byte-identical** (4 423 702 B each) |
| `before-light.png` / `after-light.png` | identical SHA-256 |
| `before-dark.png` / `after-dark.png` | identical SHA-256 |

Artifacts: `.scratch/w5-s5/{before,after}.json`,
`.scratch/w5-s5/{before,after}-{light,dark}.png`.

**Honest limits.** The proof covers each node's *default* rendered state. It
does not open the instrument-selector dropdown, arm the Looper, link a Library
folder (so the 757-line two-panel browser is unexercised), or hover/focus
anything. Those blocks moved as contiguous verbatim ranges and their relative
order is preserved by the manifest in §2, so the risk is structural rather than
empirical — but it is not *measured*.

---

## 4. Dead-CSS candidates

`plans/redesign-new-dna/W5-S5-DEAD-CSS.md` — collected, **not** deleted.

Short version: of 218 class names, **zero** are unreferenced under either a
loose substring or a whole-token search of `src/**` + `packages/oj-ui/src/**`.
Three stricter candidates are handed to the faceplate lanes: the never-animated
`@keyframes ghost-fade-in`, the unreachable `.looper-record-btn.armed` (the
component only ever emits `recording`), and the `@keyframes looper-armed-blink`
that only that rule uses.

---

## 5. Gates

| Gate | Result |
|---|---|
| `bun run test:run -- src/components/Nodes src/components/Canvas packages/oj-ui` | **48 files / 491 tests passed** |
| `bun run test:run -- src/components/Arrangement/__tests__/tokenLiteralGate.test.ts` | **6 passed** — the Speaker-slider invariant already points at `SpeakerNode.css` (a concurrent lane had updated it); no edit needed outside W5-S5's ownership |
| `bunx tsc --noEmit -p tsconfig.app.json` | **clean** |
| `bunx eslint src/components/Nodes` | **clean** |
| `bun run build` | **succeeds**, 3.6 s |

### Bundle

CSS chunking is unchanged in shape — the same 7 stylesheets are emitted, with
the node CSS still landing in the main `index-*.css` entry (Vite hoists CSS
imported from a synchronously-imported module into that entry regardless of how
many files it came from):

```
dist/assets/index-*.css            155.18 kB │ gzip: 25.08 kB
dist/assets/src-*.css               54.73 kB │ gzip:  8.80 kB
dist/assets/SettingsPanel-*.css     22.60 kB │ gzip:  3.80 kB
dist/assets/CommandBar-*.css        20.22 kB │ gzip:  3.60 kB
dist/assets/WaveformEditorModal-*.css 4.02 kB │ gzip:  1.02 kB
dist/assets/PluginsPanel-*.css       3.65 kB │ gzip:  1.15 kB
dist/assets/SafeModeScreen-*.css     2.71 kB │ gzip:  0.90 kB
```

Source grew 62 111 B → 68 097 B (+5 986 B, +9.6 %), *entirely* the twelve
provenance headers. Comments are stripped by the CSS minifier, so the shipped
payload is unchanged.

---

## 6. Follow-ups this lane deliberately did not take

- **`InstrumentVisualNode.css` declares a second `.editable-value`** with
  hardcoded `rgba()` colours that shadows the shared one. Root cause of §2's
  hazard, and a token-literal violation. Not in W5-S5's ownership.
- **Stale doc comments** still naming the old file:
  `src/components/Nodes/MIDINode.css:3` ("Extends schematic-node base styles
  from SchematicNodes.css" — now `SchematicBase.css`) and
  `src/components/Nodes/_sockets.css:14`. `_sockets.css` was explicitly
  out of bounds; `MIDINode.css` is another lane's file.
- **`docs/design-system-migration-plan.md`** and **`docs/node-migration-plan.md`**
  still reference `SchematicNodes.css` by name.
- The **Library two-panel browser** (885-line `LibraryNode.css`) is a file
  browser, not node chrome. §4.2 of the audit wants it moved next to its
  component and rebuilt on oj-ui `List`/`ListRow`/`Input`/`Chip`. W5-S5 only
  gave it its own file.
