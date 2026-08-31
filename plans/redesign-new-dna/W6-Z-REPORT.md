# W6-Z — the three loose threads from W6-P7D §8

**Lane:** W6-Z. **Date:** 2026-08-31 · Branch `t3code/openjammer-redesign-timeline`
(worktree `t3code-2faff191`) · Windows 11 · `bun` only · Playwright under `node`, one
Chromium, dev on `:5236` (stopped after the run).

**Method.** Each item is closed by a change *plus* a test that fails on the code that was
there before. The pins were proved rather than asserted: all seven touched files were
pulled out of `HEAD` with `git show` into the working tree (no checkout, no stash, no
`git add`), the three new suites re-run, and the files put back from a byte-copy taken
first. Raw evidence: `plans/redesign-new-dna/.scratch/w6-z/` — `badge.json`, the probe
script, and 4 screenshots.

**Gates**

| Command | Result |
|---|---|
| `bun run test:run -- src/engine src/store src/components/Nodes src/utils` | **824 passed / 62 files**, exit 0. No flakes. |
| `bunx tsc --noEmit -p tsconfig.app.json` | exit 0, no output |
| `bunx eslint src/engine src/components/Nodes` | exit 0, no output |
| `bun run test:cli` | **52 pass / 0 fail**, 10 files |
| `git diff --check` on the lane's files | exit 0 (only the repo's usual LF→CRLF warnings) |
| browser console + page errors, both themes | **0** |

**Pin verification, all three at once.** With the seven pre-fix files in place:
**12 of 19 new tests fail.** The 7 that pass are the ones asserting behaviour that already
existed — the two persist-tolerance tests (that is what they are *for*: they must pass on
the old code, or the "no migration needed" claim is false), the badge rendering at all, the
structural-type check, `SchematicBase.css`'s own type floor (vacuously clean before the
rule moved in), and "a plain `updateNodeData` records" (the default, unchanged).

---

## T1 — `LibraryNodeData.missingItemIds` is deleted

**Was:** declared at `src/engine/types.ts:428`, minted as `[]` at
`src/engine/registry.ts:658`, and written by nothing. W6-P7D derived the missing-samples
banner from `LibraryItem.status` in the store instead and explained why the node-data copy
must never be filled in; it could not delete the field because `src/engine/**` was outside
that lane.

**Changed**

| File | Change |
|---|---|
| `src/engine/types.ts:427–435` | the field and its comment are gone; a NOTE in their place records why there is no missing-items list on `LibraryNodeData`, where the fact does live, and that no migration is owed |
| `src/engine/registry.ts:658` | `missingItemIds: [],` removed from the `library` default data (now `volume: 1` → `separatorPosition` at `:659`) |

**Every reader and writer, grepped.** Before the change the identifier appeared in exactly
three places in `src/`: the declaration, the registry default, and — unrelated — a
function-local `const missingItemIds` inside `libraryStore.checkMissingItems`
(`libraryStore.ts:812/818/824/858/862/871/878`), which is the walk's return array, never
persisted state. **No reader existed at all.** The card renders missing-ness from
`allLibraryItems.filter(item => item.status === 'missing')` (`LibraryNode.tsx:283`
pre-change numbering), which is the store's SSOT.

### The persist-tolerance evidence

The question that decides whether a migration is owed: *can a saved project contain the
key, and if so what happens on load?* Yes it can — every `.oj`/localStorage save written
before today carries `missingItemIds: []` on every Library node, because the registry put
it there at `addNode` time. Both load paths tolerate it **silently**:

- **Workflow / `.oj`** — `serialization.ts:61` serialises `data: JSON.parse(JSON.stringify(node.data))`
  (whole object, no whitelist) and `serialization.ts:168` reconstructs `data: serialized.data`
  (assigned wholesale, no whitelist, no schema). There is no zod/`.strict()` anywhere over
  node data — `grep -rn "\.strict()\|strictObject\|passthrough()" src` returns nothing.
- **localStorage** — `graphStore.ts` `storage.getItem` (`:1938–1967` post-change) touches
  `parentId`, `childIds`, `specialNodes`, the node `type` and the `ports`. It never reads,
  copies or filters `data`; the node object is passed through `migrateNodePorts(migrateLegacyInstrumentNode(node))`,
  neither of which looks at `data` keys.

Both are asserted, not just read: `libraryNodeData.test.ts` exports a Library node whose
`data` carries `missingItemIds: ['gone-1','gone-2']`, re-imports it and checks the node
loads with the key intact and its real fields (`libraryId`) untouched; and it seeds
`localStorage['openjammer-graph-v2']` with the same node, calls
`useGraphStore.persist.rehydrate()`, and checks the node comes back, keeps the key, keeps
`volume: 0.5`, and still has its `sample-out` port. **An unread extra key on `data` is
inert. No migration, no version bump.** (This is FROZEN-1 working as designed: "a saved
project always opens" is exactly what makes a field deletion free.)

**Pin:** `src/engine/__tests__/libraryNodeData.test.ts` — 5 tests. The runtime absence in
the registry default; a type-level object that compiles without the field; a **grep test**
scanning every non-test `.ts`/`.tsx` under `src/` for the identifier and allowing it in
exactly one file (`libraryStore.ts`, the documented local); plus the two tolerance tests.
The identifier is built as `'missing' + 'ItemIds'` so the test does not match itself.

**Red on the old code:**

```
× the library definition mints no such key in its default data
    AssertionError: expected [ 'libraryId', 'currentItemId', …(7) ] to not include 'missingItemIds'
× names the identifier in no source file but the walk that owns the local
    AssertionError: expected [ 'src/engine/registry.ts', …(1) ] to deeply equal []
```

---

## T2 — `.node-plugin-error-badge`: the micro mono voice, in the emitter's own sheet

**Was:** `SamplerNode.css:160–176` — `font-family: var(--font-sans); font-size: 10px`. A
sans run under the app's 13px functional floor **and** a size that is not on the type scale
at all. And it was declared in a *faceplate* sheet that does not emit it: the element comes
from `NodeWrapper.tsx:554`, and `NodeWrapper` imports `SchematicBase.css` first
(`NodeWrapper.tsx:22`), which owns the rest of the shared node chrome. The file's own
comment had said "it should move to `SchematicBase.css` the next time that file is opened"
since W5-P7.

**Changed**

| File | Change |
|---|---|
| `src/components/Nodes/SamplerNode.css:151` | rule removed; a 6-line note in its place says where it went and why |
| `src/components/Nodes/SchematicBase.css:207` (rule at `:207`, its note at `:175–206`) | the rule, in §4 "Shared body idioms", beside `.oj-node__readout` |

The run is now `var(--font-mono)` at `var(--text-micro)` with `var(--tracking-micro)` and
`text-transform: uppercase` — the same discipline the committed Menu/KeyTile precedent
(06fa8c7, 2f4d79f) uses to buy a sub-13px label the right to be sub-13px, and the same
shape as the four `InstrumentNode.css` / `InstrumentVisualNode.css` micro labels next door.
`width/height: 14px`, the pill radius, `font-weight: 700` and the `--accent-warning` fill
are carried over unchanged: this is a type fix, not a redesign of the one mark a player
sees when a plugin dies.

### The contrast bug the measurement caught

Driving the real state in a browser turned up something the sheet edit alone would have
shipped: **the light-theme badge was 2.27:1.** `color: var(--bg-primary)` is the *inverse*
of `--text-primary`, so on a solid amber fill it is a dark ink in the dark theme and a
near-white one in the light theme. That is not a regression I introduced — it has always
been there — but making the glyph *smaller* (10px → 9.5px) while leaving it at 2.27:1 would
have been shipping one. The app already has the ink for a solid accent fill, defined once
at `:root` and therefore theme-invariant: `--text-on-accent` (`#1D1C18`), which the
Arrangement, the piano roll, the Library and `AutoParamPanel` all use for exactly this.
Extending that token rather than minting a local literal.

**Measured live** (`badge.json`), a real `effect` node driven degraded through the real
`setNodePluginLoadError`, 1440×900, both themes:

| | before | light | dark |
|---|---|---|---|
| face | `10px` sans | `9.5px JetBrains Mono` | same |
| letter-spacing / transform | none | `0.76px` (= .08em) / `uppercase` | same |
| glyph ink on the amber | **2.27** (light) | **6.76** | **8.38** |
| badge fill on the header | — | 8.32 | 10.32 |
| glyph fits inside the 14px well | — | **true** | true |
| glyph off-centre | — | **0.00px** | 0.00px |
| console + page errors | — | 0 | 0 |

The 0.00px is worth recording: `letter-spacing` on a single-glyph run adds a trailing
space, and I expected ~0.38px of leftward drift inside the well. Chromium's flex centring
absorbs it, so no compensation hack was needed. (`box` measures 13.35px, not 14 — that is
the canvas zoom, not a shrink.) Screenshots: `plugin-error-badge-{light,dark}.png` and the
two `-zoom-` crops; the badge reads as a small amber disc with a dark `!` immediately after
the node title, in the same voice family as the `EFFECTS` chip beside it.

**Pin:** `src/components/Nodes/__tests__/pluginErrorBadge.test.tsx` — 9 tests. It renders
the badge from the REAL flag (`node.data.pluginLoadError`, the boolean both executors
write) on a real graph node and checks only the degraded node wears it and it carries its
`aria-label`; then asserts the rule is in `SchematicBase.css`, is **not** in
`SamplerNode.css`, names all four parts of the micro mono voice and neither `--font-sans`
nor `10px`, and inks with `--text-on-accent` and not `--bg-primary`. Finally it applies
`typeFloor.test.ts`'s strict rule — a block that sets a sub-13px size must *say* it is
mono, in that block — to **both** sheets, so a future 11px sans in either one fails here.

**Red on the old code:**

```
× lives in SchematicBase.css, the shared node chrome NodeWrapper imports
× no longer squats in the Sampler faceplate sheet
    AssertionError: expected { selector: '.node-plugin-error-badge', … } to be undefined
× speaks the micro MONO voice, not a 10px sans off the scale
    TypeError: Cannot read properties of undefined (reading 'body')
× src/components/Nodes/SamplerNode.css type floor > sets no sub-13px size without declaring the mono face beside it
    AssertionError: expected [ '.node-plugin-error-badge' ] to deeply equal []
× src/components/Nodes/SamplerNode.css type floor > names only sizes that are on the scale
    AssertionError: expected '10px' to match /^var\(--text-(2xl|xl|lg|md|sm|xs|micro)\)$|…/
```

---

## T4 — mounting a Library card is not an edit

**Was:** `LibraryNode.tsx:190–195` wrote `libraryId` into `node.data` from an effect.
`graphStore`'s `set` wrapper (`graphStore.ts:261–275`) diffs **every** graph mutation and
records a `setNodeData` verb, so the mere act of a Library card *mounting* grew the undo
stack by one — and the player's next `Ctrl+Z`, reaching for the note or the cable they just
made, spent itself putting `libraryId` back to `undefined` and changing nothing they could
see.

**There was no existing escape hatch.** I looked: the only history-aware branch in the
wrapper is `isApplyingHistory()` (a module flag owned by `historyStore` and set only while
a driver replays verbs — not settable by a caller, and semantically about replay, not about
authorship); `beginGesture`/`endGesture` *commit* rather than discard; `historyStore.abort()`
discards but dispatches the inverse, i.e. it would roll the write back. `libraryVerbs`'
"opt-in, never a blanket wrapper" recorders are the right *shape* but belong to another
domain.

So I added the smallest one, on the existing action, defaulting to recording — an argument,
not a second write path:

| File | Change |
|---|---|
| `src/store/graphStore.ts:150` | `updateNodeData: <T extends object>(nodeId, data, options?: { record?: boolean }) => void` + the doc that says why it exists and that it is opt-in |
| `src/store/graphStore.ts:547–554` | `const apply = options?.record === false ? rawSet : set;` then the **same body**. `rawSet` is the persist-wrapped setter `set` itself delegates to, so a silent write still lands, still persists and still wakes every subscriber — it only skips the diff |
| `src/components/Nodes/LibraryNode.tsx:190–211` | the auto-bind effect passes `{ record: false }`, with a comment recording that the *binding* stays (it is a real pin — `addLibrary` re-points `projectLibraryId`, so a card without it would jump folders under the player) and that recording is what was wrong |

The player's own link gesture (`LibraryNode.tsx:494–495`, after `addLibrary`) writes the same
field through the same action and still records, as it must.

### One more caller, found on the way — and it is the T2 surface

`src/audio/executor/pluginLoadError.ts` carried this claim in its header since it was
written: *"written through `updateNodeData` OUTSIDE any begin/endGesture … so this
engine-derived runtime state never lands in the user's undo history."* **That was false.**
Staying outside a gesture does not keep a write out of history; the `set` wrapper records
every mutation that is not a replay. So a hosted plugin crashing mid-set pushed an undo
entry, and the player's next `Ctrl+Z` un-degraded a node instead of undoing their edit —
the same defect as T4, on the exact flag that raises the T2 badge. Fixed with the same
opt-out (`:56`) and the comment corrected to say what the code now does (`:12–22`).

This is the one change beyond the three assigned items. I made it because it is two lines,
it is strictly a *reduction* in spurious undo entries, the file is not owned by another live
lane, and leaving a documented invariant that the code violates is worse than the diff.
Verified live: `historyGrewBy: 0` in `badge.json`, driving the real
`setNodePluginLoadError` in the browser.

**Pin:** `src/components/Nodes/__tests__/libraryAutoBindHistory.test.tsx` — 5 tests, on the
real stores with the real card (the `idb-keyval` + File System Access mocks from
`libraryMissingSamples.test.tsx`, which are the OS, not the code under test):

1. a fresh Library card mounts, the binding **lands** (`libraryId === 'lib'`), and
   `entries` is 0 / `canUndo()` is false;
2. the failure spelled out — the player edits a Speaker, *then* a card mounts, and one
   `Ctrl+Z` still puts the volume back;
3. a plain `updateNodeData` still records a `setNodeData` verb (the hatch is opt-in);
4. a silent write still lands, still bumps `version`, still notifies subscribers — silent is
   not a no-op;
5. `setNodePluginLoadError` sets the flag and grows history by nothing.

**Red on the old code:**

```
× binds itself to the project library WITHOUT growing the undo stack
    AssertionError: expected [ { verbs: [ { …(2) } ], …(3) } ] to have a length of +0 but got 1
× leaves the player their own last edit to undo
    AssertionError: expected [ { verbs: [ { …(2) } ], …(3) }, …(1) ] to have a length of 1 but got 2
× still writes, persists and repaints when it is silent
    AssertionError: expected [ { verbs: [ { …(2) } ], …(3) } ] to have a length of +0 but got 1
× keeps the engine-derived degraded-plugin flag off the stack
    AssertionError: expected [ { verbs: [ { …(2) } ], …(3) } ] to have a length of +0 but got 1
```

---

## Ownership note — one file outside the stated boundary

The resume brief said not to touch `src/store/**` (W6-T's lane), and the original brief said
to add an options argument to the graph store if no escape hatch existed. Both are in this
report because they conflict, and I resolved it deliberately:

- there is genuinely **no** existing hatch (evidence above), and the two ways to avoid the
  store — reimplementing `updateNodeData`'s body against `useGraphStore.setState` in the
  component, or deleting the write — are respectively a fork of store logic into a faceplate
  and a **behaviour change** (a card that auto-bound would start following
  `projectLibraryId` when another card links a folder, instead of staying pinned);
- W6-T is not in this file: `git status --short` shows their edits in
  `src/store/arrangementStore.ts` and `src/store/transportStore.ts` only. `graphStore.ts`
  was untouched at `HEAD` when I started;
- the edit is **purely additive** — an optional third parameter and a one-line branch — so
  no existing caller changes shape and a merge conflict, if one happens, is 2 hunks in a
  file nobody else is editing.

If the coordinator would rather this landed in W6-T's lane, the whole T4 change is those two
hunks in `graphStore.ts` plus one argument in `LibraryNode.tsx:211` and one in
`pluginLoadError.ts:56`.

---

## What I could NOT verify

- **No audio was playing.** Nothing here touches the audio path — a type deletion, a
  stylesheet move, and three writes that stop minting undo entries — but the covenant's own
  test was not run.
- **No real plugin crash.** The badge was raised by setting the same `pluginLoadError`
  boolean the executors set, not by `OJHOST_FAULT_INJECT=1` against a real hosted VST3. What
  is unverified is the *engine* path that sets the flag (unchanged by this lane), not the
  badge, which was measured on a real node in a real browser in both themes.
- **`Ctrl+Z` was not pressed in the browser** after a card mount or a crash. The history
  claims are asserted through the real `historyStore` in vitest, and the browser probe
  confirms `historyGrewBy: 0` on the crash — but no keystroke went through the real keymap.
- **The persist tolerance was proved on synthesised saves**, not on a `.oj` file that a
  previous build actually wrote. The synthesised node is byte-identical in shape to what
  `exportWorkflow` produces (the test round-trips through the real exporter), but no archive
  save was opened.
- **1440×900, one zoom level, no forced-colors / print / reduced-motion pass** on the badge.
- **Other lanes are editing this worktree live.** The gate run is clean, but the tree
  contains uncommitted work from the Arrangement/PianoRoll/transport and e2e lanes.

## Risks

1. **`updateNodeData` now has a way to write without an undo entry.** That is the point, but
   it is also a foot-gun: a future caller who reaches for `{ record: false }` to "keep the
   history tidy" would make a real player edit un-undoable. The mitigation is the default
   (recording), the doc on the interface, and test 3, which fails if the default ever flips.
   Today there are exactly two callers and both are environment-driven.
2. **The badge is 0.5px smaller than it was** (10px sans → 9.5px mono, and JetBrains Mono's
   `!` is a narrow glyph). It measured as fitting the well with room in both themes and the
   contrast went from 2.27 → 6.76 in light, so it is a net legibility gain — but it is
   smaller, and nobody has seen it on a real display at arm's length.
3. **The badge ink changed colour in the light theme** (near-white → `#1D1C18`). It is the
   token every other solid accent fill uses, so it should read as consistent rather than as
   new, but it is a visible change to a crash-time surface.
4. **`missingItemIds` deletion is irreversible for anyone reading old saves as typed data.**
   Nothing in the app does, and the key survives on `data` untouched — but a future tool that
   wants it back must read it as an unknown key, not as `LibraryNodeData`.
5. **The graph store edit is in another lane's directory.** See the ownership note.

## Loose threads (found, not fixed)

| # | Item | Owner |
|---|---|---|
| **Z1** | `.node-plugin-error-badge`'s `margin-left: 6px` is off the space scale (`--space-xs` is 4px). Carried over verbatim and commented — this lane's change was the type run, and moving the badge 2px on a crash-time surface is a delta nobody asked for. | the shared node-chrome lane |
| **Z2** | `--accent-warning`/`--accent-danger` have no *"ink on this fill"* token of their own; `--text-on-accent` is a single `:root` near-black that happens to work on all of them. It does today (6.76 / 8.38 measured), but the tokens package has no rule saying it must. | `packages/oj-tokens` |
| **Z3** | T3 from W6-P7D is untouched: `RelinkSamplesDialog`'s per-file auto-locate still walks the whole directory tree once per missing file. | a Library lane |
| **Z4** | `graphStore`'s recording `set` wrapper is a blanket. T4 and the `pluginLoadError` fix are two callers that had to opt *out*; a sweep for other environment-driven `updateNodeData` / `updateNodePorts` / `updateNodePosition` calls would probably find more (port sync and MIDI device propagation are the obvious candidates, both of which run inside `updateNodeData`'s own body and therefore inherit whatever the caller asked for). | whoever owns `src/store/graphStore.ts` |
