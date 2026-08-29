# W5-P7b RE-GATE — Looper / Sampler / SamplerVisual / Library, fix round

Gatekeeper: Opus 5. Read-only — **no source edits, no git writes**. Branch
`t3code/openjammer-redesign-timeline`, uncommitted worktree
(`C:\Users\olimt\.t3\worktrees\openjammer\t3code-2faff191`). No browser: P7b's browser
evidence (`plans/redesign-new-dna/.scratch/w5-p7b-fix/`, 3 JSONs + 27 captures) was
inspected, and every contrast claim was **re-derived analytically** rather than taken on
trust (pixel-decoded the PNGs, swept all 360 tag hues through a WCAG implementation).

---

## Verdict

# COMMIT-AFTER-FIXES

Three fixes. All three are in this lane's own files, all three are small, and all three
falsify a claim the report makes in its own headline sections:

- **F1** — "Clear every layer" records **one undo entry per layer**, not one. The report's
  central law ("delete-a-layer, clear-all and take-the-last-layer-off each cost **one**
  `Ctrl+Z` and never more") is false for clear-all, and the test that would have caught it
  is blind because the test double diverges from the real handle on exactly this call.
- **F2** — `.library-tag__dot` **does not render** (0×0). M1's whole justification for
  deleting the chip wash is "the hue now buys exactly one thing: the 8px dot". It buys
  nothing. Verified by decoding the lane's own screenshots pixel by pixel.
- **F3** — the record button's focus ring is **suppressed while recording**, because the
  running `box-shadow` animation outranks `:focus-visible` in the cascade. This is in the
  exact rule P7b rewrote (follow-up 5).

Everything else is genuinely good, and better than the first gate found. M1 is not only
fixed, it is now *provable* — I swept the bound the report only measured. M3 is exact. The
undo seam is a real extension of the existing history, not a fork, and the Looper mute →
`Ctrl+Z` → engine un-mute path holds up under source reading as well as under their
measurement. `_sockets.css` is genuinely down to one live rule. The gates are green under
my own re-run, including the wider `src/store` scope.

---

## Gates — re-run by me

| Gate | Result |
|---|---|
| `bun run test:run -- src/components/Nodes src/utils src/store` | **46 files, 672 tests, 0 failed** (exit 0). `w5p7Faceplates.test.tsx` **62/62**. Matches the report exactly. |
| `bunx tsc --noEmit -p tsconfig.app.json` | **0 errors** (exit 0). The first gate's stray error from the node-type-migration lane is gone. |
| `bunx eslint src/components/Nodes src/store src/utils` | **0 problems** (exit 0) |
| `git diff --check` over the 12 tracked lane paths | **clean** — CRLF notices only, repo-wide |
| trailing whitespace in the untracked `src/store/libraryVerbs.ts` (`--check` cannot see it) | **clean** |

**Scope note for the orchestrator.** `src/components/Nodes/KeyboardVisualNode.tsx` is dirty
and is **not** this lane's. It is a 13-line e2e fix (`title="… plays on row N"` →
`"{key} · row N"`, to stop Playwright's `getByTitle('Play')` substring-matching ~30 keys).
Do not sweep it in with `git add src/components/Nodes/` unless you mean to.

---

## 1. History extension — is it an extension or a fork?

**It is an extension. Verified line by line.**

| Property | Evidence |
|---|---|
| Same `record(forward, inverse, label, scope)` | `libraryVerbs.ts:140` calls `useHistoryStore.getState().record(...)`. No other write path. |
| Same stack, same cursor, same `begin`/`commit` | No new store. `historyStore.ts` gained **12 lines** and they are all one union arm + its comment (`git diff` confirms: `+ \| { domain: 'library'; verb: LibraryVerb }`). |
| One driver, registered the same way | `libraryVerbs.ts:171` `registerHistoryDriver`, module scope — identical to `graphStore.ts:2063` and `arrangementStore.ts:887`. |
| No second undo stack, no parallel keybinding | `grep -rn "recordLibraryEdit\|applyLibraryVerb\|libraryVerbs"` returns 24 hits: 21 call sites in `LibraryNode.tsx`, 1 type import in `historyStore.ts`, the file itself. Nothing binds a key. |
| Merges into an open bracket | `record` (`historyStore.ts:117-123`) appends to `open` when one exists, so a graph+library gesture is one entry. Correct by construction. |
| Inverse ordering inside a bracket | `record` **prepends** inverses (`[...inverse, ...open.inverse]`), so A-then-B replays as invB-then-invA. The library driver applies its verbs in array order. Correct. |

### The one asymmetry: re-entrancy

`graphStore.ts:265` and `arrangementStore.ts:515` both early-return on `isApplyingHistory()`.
**`libraryVerbs.ts` has no such guard.** Today that is safe — `recordLibraryEdit` is opt-in
and every one of its 21 call sites is a DOM event handler, and the driver writes through
`useLibraryStore.setState` directly rather than through the recorder, so it cannot
self-recurse. But the guard is the thing that makes the *other* two drivers safe against a
future effect, and its absence here is the seam's one soft spot (the report's own risk #3
says as much about opt-in). See non-blocking #4.

### Mixed domains in one entry — ordering

`dispatch` (`historyStore.ts:73-80`) hands **every** verb to **every** driver and each
driver filters by domain, so within one entry the *relative* order of a graph verb and a
library verb is lost — the effective order is driver-registration order, not verb order.
That is already true of graph-vs-arrangement and the arrangement driver has a long comment
about ordering *within* its own domain. For graph×library it is harmless: the two stores
are independent, and the only cross-reference (`LibraryNodeData.currentItemId` pointing at
an item id) is only ever inconsistent inside one synchronous dispatch. **No hazard, worth a
sentence in the file.**

### Is `libraryVerbs.ts` the right home?

**Yes.** It sits exactly where `graphVerbs.ts` sits relative to `graphStore.ts`, and putting
it inside `libraryStore.ts` would have forced the store to import `historyStore` — which is
what would have tempted a `set`-wrapper diff, which the file's own docstring correctly
argues against (a folder scan is not an undo step). The opt-in recorder is the right call
and the reasoning is written down.

### Dead code in it

- **`applyLibraryVerb` is exported and has no external consumer.** Its docstring says
  "Exported for the driver and for tests"; the driver is in the same module and no test
  imports it (`grep -rn applyLibraryVerb src e2e packages` → definition + the in-file driver
  only). Code value #8. See non-blocking #3.
- `LibraryVerb`, `recordLibraryEdit`, `recordSealedLibraryEditAsync` are all used. `snapshot`,
  `same`, `diffLibrary`, `finish` are module-private and all used.

### One real gap the file does not state

`diffLibrary` covers `items` / `allTags` / `pinnedTags` / `activeFilterTag`. It does **not**
cover `libraries[id].itemCount`, which `emptyTrash` (`libraryStore.ts:1306-1327`) and
`permanentlyDeleteItem` (`:1359-1372`) both mutate. Harmless today because those two are the
*sealed* pair (inverse === forward, nothing is restored) — but the day a **recorded** action
changes an item count, undo will silently leave the count wrong. Worth one line in
`diffLibrary`'s comment. Non-blocking #5.

---

## 2. Looper undo correctness

### (a) mute → `Ctrl+Z` → does the audio really un-mute?

**Yes, through the executor command path.** Traced end to end:

1. `handleToggleMute` (`LooperNode.tsx:686`) → `commitLayers` → `beginGesture` /
   `updateNodeData({layers})` / `endGesture`. One graph verb, one entry.
2. `Ctrl+Z` → graph driver writes `node.data` back.
3. The reconcile effect (`LooperNode.tsx:666-682`) re-runs on the new `layerMeta` and calls
   `looper.toggleLoopMute(id)` for every engine layer whose flag disagrees.
4. `LooperHandle.toggleLoopMute` (`src/audio/executor/ojcoreHandles.ts:398-407`) flips its
   local flag **and** emits `this.action(LooperAction.SET_MUTE, idx | MUTE_FLAG)`.

So the undo lands on the same seam a click lands on. The lane's browser run corroborates
(`MEASUREMENTS.json` → `looperJourney.mute`: `afterMute [true,false]` → `afterUndo
[false,false]`, `engineAfterUndo [false,false]`, `nodesAfter 3`, card present).

*Caveat on their evidence, not on the code:* `getLoops()` is the handle's own mirror, so
their measurement proves the JS side. The `SET_MUTE` emission is proven by source and by
`ojcoreLooperHandle.test.ts:271-279`, not by their harness.

### (b) The reconcile effect — mid-recording, per-render, redundant commands, idempotence

- **Idempotent: yes.** The guard is `if (engineLoop.isMuted !== wanted)`, and
  `toggleLoopMute` updates `loop.isMuted` *synchronously* before sending the command
  (`ojcoreHandles.ts:401-406`). So a repeat run sends nothing. No audio-thread noise.
- **Can it fire mid-recording? Yes — and it is a no-op when it does.** The effect's dep is
  `layerMeta`, memoised off `node.data`, so it re-runs on *any* `setNodeData` for this node
  (a MIX sweep, a duration change, a committed take). During a take, `onLoopAdded` →
  `syncLayerMetaFromHandle` → `mergeLayerMeta` seeds the new layer with `isMuted:
  row.isMuted`, i.e. already in agreement, so nothing is sent.
- **On every render? No.** `LooperNode` is `memo`, `data` identity only changes when the
  store replaces the node, and the per-frame path writes refs, never state
  (`setEngineState` with an equal value is a React no-op).

### (c) Does undoing a *rename* touch the engine?

**No.** `handleRenameLayer` (`:710`) writes only `meta.name`. On undo the reconcile effect
re-runs, but its only engine call is the mute-disagreement branch, and no mute moved →
zero commands. Correct.

### (d) The confirm-gated removals — is history left consistent?

**What `Ctrl+Z` does right after a confirmed layer delete: nothing visible, and it consumes
one entry.** Traced:

`handleDeleteLoop` (`:719`) → `looper.deleteLoop(id)`, which **synchronously** calls
`onLoopDeleted` (`ojcoreHandles.ts:418`) → `trashItem(libraryItemId)` +
`syncRowsFromHandle` + `syncLayerMetaFromHandle` → **entry 1** (metadata without the
layer). Then `handleDeleteLoop`'s own `commitLayers(mergeLayerMeta(remaining, layers))`
writes a byte-identical list → `diffGraph` yields no verb → `commit()` returns early on an
empty transaction → **no second entry**. The code comment claims exactly this and it is
correct.

Undoing it restores `data.layers` **including the deleted layer's meta**. That ghost is
invisible: rows are engine-led (`setLoops` maps over existing rows only; the reconciler
iterates `looper.getLoops()`), and the next take's `mergeLayerMeta` maps over rows and
drops it. So **no dangling row, no layer that looks restored and plays nothing.**

But note the doctrine asymmetry: `libraryVerbs.ts:124-141` seals its irreversible steps
(inverse := forward) with an explicit argument — *"a row that looks restored and plays
nothing is a lie"* — while the Looper's three irreversible steps record a **real** inverse
that restores metadata for a take whose PCM is gone. It happens to be invisible; it is not
the same discipline. Non-blocking #2 has the exact change.

**A separate honesty point.** All three confirms say *"the take cannot be brought back —
the kernel owns their audio"* (`LooperNode.tsx:1099`, `:1129`, `:1157`). Every committed
take is auto-saved into the project Library (`onLoopAdded` → `saveAudioToLibrary(buffer,
'Loop', ['loop'])`, `:472`) and deleting a layer **trashes** that item rather than
destroying it (`:490` → `trashItem`), so the audio is normally still on disk and one
Restore away. What is true is narrower: *it cannot go back into the loop* (there is no
`ADD_LAYER`, and `addLoopFromBuffer` never transfers PCM — `ojcoreHandles.ts:441-457`,
its own TODO). The copy overstates the loss. Non-blocking #1.

Also: that `trashItem` is a library mutation that does **not** go through
`recordLibraryEdit`, so it is outside history — consistent with sealing, but undocumented.

### (e) Persisted sessions — ghost layers on reload?

**No ghosts.** `data.layers` persists (graph store `persist`); the engine's layers do not.
Rows come from `LooperHandle.getLoops()`, so a reload shows **zero rows** and the empty
state (`"Record a pass, or drop an audio clip on this card to start a layer."`), not stale
rows. The stale metadata is inert and self-cleans on the next take (`mergeLayerMeta` maps
over rows, and ids are `oj-loop-${Date.now()}-${n}` so a collision is not reachable). The
deliberate upside the report claims — a mute survives a reload because the reconciler pushes
it into the fresh handle — is real, and only fires for ids that actually come back, which
after a reload is none. Matches the report's stated risk. ✅

---

## 3. Library undo — recorded vs sealed

| Action | Route | Undo |
|---|---|---|
| Rename sample (`:633`) | `recordLibraryEdit` | ✅ full inverse |
| Trash / restore (`:1189`, `:1264`, `:1273`) | `recordLibraryEdit` | ✅ — restore bundles the filter change into the same step |
| `Delete`/`Backspace` on a row (`:1189`) | `recordLibraryEdit` | ✅, and `aria-keyshortcuts="Delete Backspace"` is now on the row |
| Tag add on drop, incl. a multi-file drop (`:720`, `:753`, `:760`) | `recordLibraryEdit` | ✅ — the batch is one step |
| Tag removal (`:1230`, `:1236`) | `recordLibraryEdit` | ✅ (measured: `['drums'] → [] → Ctrl+Z → ['drums']`) |
| Create tag / delete tag (`:931`, `:1686`) | `recordLibraryEdit` | ✅ |
| Pin / unpin / reorder (`:998`–`:1133`) | `recordLibraryEdit` | ✅ |
| **Permanently delete** (`:1694`) | `recordSealedLibraryEditAsync` | **sealed** |
| **Empty trash** (`:1708`) | `recordSealedLibraryEditAsync` | **sealed** |

**Is the sealing honest?** Yes, and it is the right shape. `finish(..., sealed=true)` sets
`inverse := structuredClone(forward)` (`libraryVerbs.ts:137-139`), so `Ctrl+Z`:

- **consumes** the entry (cursor moves back one) — it does **not** fall through into the
  previous entry, which is the failure mode that used to delete the Library card; and
- **changes nothing** — re-applying the post-state is a fixed point.

So "skip cleanly" is exactly what happens, and it cannot undo the previous entry
unexpectedly. `structuredClone` is safe here: a `LibraryItem` is plain data (`handleKey` is
a string; the handle itself lives in IndexedDB).

The residual risk is the one the report names honestly: a player who presses `Ctrl+Z`
expecting *something* sees nothing. The confirm carries the honesty, and both sealed
actions have one.

Not covered by any recorder (fine, but worth knowing): `createVirtualItem` on a crop drop
(`:725-735`) is **not** wrapped — the tag-only branch above it is. A crop is therefore not
undoable while a tag is. Non-blocking #6.

---

## 4. M1–M3 as applied

### M1 — the tag hue is no longer a contrast ground. **Fixed, and now provable.**

`LibraryNode.css:415-421`: `.library-file-row__tag.oj-chip` carries `cursor` / `min-width:
60px` / `max-width: 76px` / `overflow` and **no background**. `.library-filter-chip`
(`:223-230`) is down to `cursor: pointer`. Measured by the lane at **5.92 light / 6.18 dark**
for every chip — and the point is that it is now the *same* number for every tag, which is
the property that was actually missing.

**No `--tag-color` dependency anywhere a word sits.** Confirmed by rule-level audit and by
the lane's own gate (`P7b — M1`, two tests over `LibraryNode.css`).

*One correction to the report:* its M1 table is headed "`drums`/`pads`/`soft`/`warm`", but
`MEASUREMENTS.json` shows the sweep actually read three chips — `drums`, `pads`, `drums` —
because a row now shows only its first tag. The number is right; the header oversells the
sample.

### `.library-tag.is-selected` at 24% under `--text-primary` — derivation confirmed

The report asserts the bound and measures two points (13.31 / 7.02). I derived it. The
ground is `--bg-tertiary` (`.library-tags-panel`, `LibraryNode.css:68`), the wash is
`color-mix(in oklab, var(--tag-color) 24%, transparent)` = the hue at α=0.24, and
`getTagColor` is `hsl(h, **60%**, **70%**)` (`libraryStore.ts:169-178`) — **only the hue
varies; S and L are pinned**, which is precisely why a bound exists at all.

Sweeping all 360 hues (sRGB alpha composite, WCAG relative luminance):

| Theme | text / ground | worst hue | **worst ratio** | best | plain ground |
|---|---|---|---:|---:|---:|
| light | `#1D1C18` on `#ECEAE4` | 240 (blue) | **11.43** | 13.69 (h60) | 14.17 |
| dark | `#F1EFE8` on `#2A2822` | 60 (yellow) | **6.69** | 9.01 (h240) | 12.81 |

**The claim holds with a large margin, for every possible tag name.** Worst case is the
hue whose luminance moves the ground *toward* the text: blue in light, yellow in dark. The
lane's measured 13.31 / 7.02 sit inside those ranges.

The same model reproduces the *first* gate's failure to within 0.05, which validates it:
`--text-secondary` on a 22% wash in dark → my sweep worst **3.41**, the gate measured
**3.46**. And for the record, `--text-secondary` at 24% would be **3.23** worst-case — so
the token choice (`--text-primary`), not the percentage, is what makes this one safe. That
should be written into the CSS comment; today the comment says "24% over the panel ground"
without naming why the token matters.

### M2 — the tag remove control. **Fixed, with a caveat.**

`LibraryNode.tsx:1225-1243`: a real `IconButton` with `label={`Remove ${tag} tag`}` (→
`aria-label`), `title`, an Enter/Space `onKeyDown`, `recordLibraryEdit` around the mutation,
and `LibraryNode.css:432-450` reveals it on `:hover` **or** `:focus-visible` so Tab reaches
it. `onDoubleClick` on the `Chip` is gone. Measured: focus by role name → **Enter** →
`['drums'] → []`, `Ctrl+Z` → `['drums']`, node map 3 → 3. ✅

The keydown handler `preventDefault()`s, which suppresses the native button activation, so
Enter/Space fire the removal exactly once — no double-fire. The `stopPropagation` is load-
bearing (the parent `ListRow`'s own `onKeyDown` binds Enter/Space and Delete/Backspace).

**Caveat:** only the **first** visible tag gets a remove control (`visibleTags.slice(0, 1)`,
`:1221`); the rest sit behind an inert `+N` chip. HEAD showed two removable badges plus
`+N`. So the reachable-removal count went **2 → 1**, which is a small capability reduction
introduced by taste call (c), not a new class of defect (tags 3+ were already unreachable
on HEAD). Non-blocking #7.

### M3 — `aria-selected` on a marquee-caught row. **Fixed, exactly.**

`LibraryNode.tsx:1177` `selected={isActive || isMultiSelected}`. `ListRow` emits
`aria-selected={selected || undefined}` (`packages/oj-ui/src/components/ListRow/ListRow.tsx:68`),
so unselected rows report `null` rather than `"false"` — which is what
`MEASUREMENTS.json.m3` shows (`[{cls:false,aria:null},{cls:true,aria:"true"},{cls:false,aria:null}]`).
Pinned by a source-text test. ✅

---

## 5. Follow-ups from the first gate

| # | Item | Verdict |
|---|---|---|
| 1 | `LooperNode.css:81` comment quoted 5.03/5.42 | ✅ now 5.34/5.96, and a test forbids the old string |
| 2 | `_sockets.css` orphans | ✅ **file is 46 lines** (report says 47 — trivially off by one) and contains exactly one rule, `.bundle-port-row`, with two real emitters (`BundlePortGroup.tsx:83,155`). Zero orphans. |
| 3 | the `!important` port-size rule | ✅ deleted |
| 4 | stylesheet-floor gate covers `_sockets.css` | ✅ `SHEETS` at `w5p7Faceplates.test.tsx:734-740` includes it |
| 5 | `.looper-record` unforked | ✅ `<Button variant="danger">`, class reads `oj-btn oj-btn--danger looper-record`, the stylesheet keeps only `flex/height/ring`. **But see F3** — the pulse now breaks the focus ring. |
| 6 | ERR-1 aria + title | ✅ `title="Sample not found"` + `aria-label="Sample failed to load"`, body agrees (`SamplerNode.tsx:619-635`) |
| 7 | export-name field decision documented in code | ✅ `LooperNode.tsx:56-66`, a full paragraph with the reasoning |

**Reduced motion on the pulse — honoured.** `src/styles/global.css:41-46` collapses
`animation-duration` to `.01ms` and `iteration-count` to `1` for `*`, `*::before`,
`*::after` (excluding `.oj-cable` / `.oj-meter`). `looper-record-breathe`'s 0% and 100%
frames are both the static `inset 0 0 0 2px var(--accent-danger)`, and with the default
`animation-fill-mode: none` the element reverts to its own rule — so the wash + the static
2px ring survive intact. ✅ No bespoke `@media` block ships in any lane stylesheet (pinned
by the gate).

---

## 6. Taste calls — better, or merely different?

**(a) Sampler trace `scaleY(0.94)` — better.** `SamplerNode.css:60-73`. With SVG's default
`transform-box: view-box` and `transform-origin: 50% 50%`, the scale is about the viewBox
centre, so it takes 3 units of headroom off **both** ends of a 100-unit box — numerically
identical to the Looper's accepted `TRACE_BLEED = 3`, which is the argument the comment
makes and it holds. Measured 5.5px of headroom on a 48px trace box, `matrix(1,0,0,0.94,0,0)`.
Nothing is clipped (`Waveform.css` is `overflow: visible`, `non-scaling-stroke`). The
flagship object stops reading as a border. ✅

**(b) Note names in the key map — clearly better.** `14-keymap-light.png` reads
`C4 D4 E4 F#4 G#4 A#4 C5 D5` where it used to read `1…8`. **Spot-check of the mapping:
index 0 at default offset → `C4`, and that is what renders** — `semitonesFromRoot = index *
spread = 0`, `pitch = rootNote`, registry default `rootNote = 60`, `spread = 1.0`
(`registry.ts:693`), `noteLabel(60) = "C4"`. `MEASUREMENTS-3.json` confirms
`"Key 1, C4, +0.0 semitones from root"`, 46px, no overflow, both themes. The exact
fractional offset stays in the accessible name, which is the right split. ✅
Two small edges, neither blocking: `SPREAD` min is **0** (`SamplerNode.tsx:91`), so at
spread 0 all ten pads print the same note — honest, but the visible label loses per-pad
identity; and at spread 0.5 adjacent pads round to the same name. The `aria-label` still
disambiguates in both cases.

**(c) Filename 120px floor + `+N` — better, with one regression.** Name boxes went
**140 / 63 / — → 176 / 165 / 136px** and `pad-long-name-that-runs-on.wav` now shows ~22
characters instead of ~8. Real improvement, visible in `A-library-light.png`.
The `+N` chip does **not** lose tag identity colour, because after M1 no file-row chip
carries colour — `.library-file-row__more` and `.library-file-row__tag` are the same
neutral pill. Consistent, not a regression.
**The regression:** in `A-library-light.png` the durations no longer line up —
`0.4s` / `3s` / `0.8s` sit at three different x positions and the row's right edge is
ragged, because the trailing cluster is now `flex-shrink: 1` and each row's chip payload
differs. W5-P7 explicitly built that alignment ("`.library-file-row__len` gets a fixed
right-hung box so lengths line up down the list") and this round undid it without saying
so. Non-blocking #8.

---

## Ranked must-fix — each `file:line` + the exact change

### F1 — "Clear every layer" costs one `Ctrl+Z` **per layer**. **Blocking.**

`src/components/Nodes/LooperNode.tsx:732-739`

```ts
const handleClearAll = useCallback(() => {
    const looper = getLooper();
    for (const loop of loops) looper?.deleteLoop(loop.id);   // ← :735
    setLoops([]);
    commitLayers([]);
    setConfirmClear(false);
}, [getLooper, loops, commitLayers]);
```

`LooperHandle.deleteLoop` calls `this.onLoopDeleted?.(removed)` **synchronously**
(`src/audio/executor/ojcoreHandles.ts:409-419`). The registered callback
(`LooperNode.tsx:487-499`) ends in `syncLayerMetaRef.current()` →
`commitLayers(mergeLayerMeta(getLoops(), storeData.layers))` → its own
`beginGesture()/updateNodeData()/endGesture()`. Both sides are read fresh, so each
iteration writes a **strictly shorter** list, each write is a real `setNodeData` verb, and
each `endGesture` closes its own transaction:

> 3 layers → `[m2,m3]`, `[m3]`, `[]` → **3 history entries**. N layers → **N**.

The trailing `commitLayers([])` is then the no-op. This directly contradicts the report
(*"delete-a-layer, clear-all and take-the-last-layer-off each cost **one** `Ctrl+Z` and
never more"*) and `agents.md`'s one-gesture-one-undo law. On stage it means N dead `Ctrl+Z`
presses that visibly do nothing before the stack reaches a step that matters.

`handleDeleteLoop`, `handleUndoLast` and `handleLoopDragStart` are **not** affected — each
fires `onLoopDeleted` exactly once and their own `commitLayers` is a verified no-op write.

**Fix — one outer bracket. `useHistoryStore.begin` is depth-counted
(`historyStore.ts:114-116`, `129-135`), so the nested brackets merge into it and the whole
clear becomes one entry:**

```ts
// LooperNode.tsx:732-739
 const handleClearAll = useCallback(() => {
     const looper = getLooper();
+    // One press is one entry. Each `deleteLoop` fires `onLoopDeleted`
+    // synchronously, which commits its own layer-metadata step; the outer
+    // bracket is depth-counted, so they all merge into this one.
+    beginGesture();
     for (const loop of loops) looper?.deleteLoop(loop.id);
     setLoops([]);
     commitLayers([]);
+    endGesture();
     setConfirmClear(false);
-}, [getLooper, loops, commitLayers]);
+}, [getLooper, loops, commitLayers, beginGesture, endGesture]);
```

(`beginGesture` / `endGesture` are already in scope at `LooperNode.tsx:268-269`.)

**And fix the blind spot that hid it** — `w5p7Faceplates.test.tsx:65-68`:

```ts
    deleteLoop = vi.fn((id: string) => {
        this.loops = this.loops.filter((x) => x.id !== id);
    });
    undoLast = vi.fn(() => { this.loops = this.loops.slice(0, -1); });
```

The real handle reports both. Make the double honest, then assert the entry count:

```ts
    deleteLoop = vi.fn((id: string) => {
        const removed = this.loops.find((x) => x.id === id);
        this.loops = this.loops.filter((x) => x.id !== id);
        if (removed) this.onDeleted(removed);
    });
    undoLast = vi.fn(() => {
        const removed = this.loops.pop();
        this.loops = [...this.loops];
        if (removed) this.onDeleted(removed);
    });
```

plus one assertion — after a confirmed clear of 3 layers,
`useHistoryStore.getState().entries.length` must have grown by **1**.

### F2 — the tag identity dot does not render, so M1's justification is not true on screen. **Blocking.**

`src/components/Nodes/LibraryNode.css:143-151` (`.library-tag__dot`) +
`packages/oj-ui/src/components/ListRow/ListRow.css:61-64`

`ListRow` puts its children in `<span className="oj-list-row__body">`
(`ListRow.tsx:70`), and `.oj-list-row__body` declares only `flex: 1; min-width: 0` — **no
`display`**, so it is a plain inline box. `.library-tag__dot` is an *empty* `<span>` whose
entire appearance is `width: 8px; height: 8px; background: var(--tag-color)`. A non-replaced
inline element ignores `width`/`height`, so it renders **0×0 and paints nothing**.
(`ListRow.css:43-52` proves the point from the other side: the `is-current` dot has to
declare `display: inline-block` explicitly.)

**Verified against the lane's own evidence, not inferred.** I decoded
`A-library-light.png` and sampled the four "ALL TAGS" rows: x=19…25 is uniform
`rgb(236,234,228)` = `--bg-tertiary`, and the first glyph pixel appears at x≈26 — there is
no 8px pastel disc, and a full-image scan for a solid `hsl(h,60%,70%)` run finds none in
either theme (every saturated pixel is ClearType subpixel fringing on the text).

Why it matters: M1's entire argument for deleting the chip wash is *"The hue now buys
exactly one thing: the 8px `.library-tag__dot`"* / *"the tag's identity stays where it
already measures 12.81 / 14.17"*. It buys **nothing**. Today the Library carries no tag
colour at all except the `is-selected` wash. The contrast fix is still right; the
compensating half was never on screen. The gate test that "pins" it
(`w5p7Faceplates.test.tsx:1050-1052`) greps the stylesheet text and cannot see a 0×0 box —
exactly the false-confidence shape.

**Fix — give the tag row's body the same flex treatment the file row already gets
(`LibraryNode.css:299-308`). Add after `.library-tag.oj-list-row` (`:136-141`):**

```css
/* `ListRow`'s body slot is an inline span (`ListRow.css:61`), so an empty
   `<span>` sized in px inside it renders 0x0. The dot — the ONE thing the tag
   hue is spent on after M1 — and the name's ellipsis both need this row to be
   a flex line. */
.library-tag .oj-list-row__body {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
}
```

The same rule also revives `.library-tag__name`'s `overflow`/`text-overflow: ellipsis`
(`:154-160`), which is inert today for the identical reason — a long tag name currently
overflows instead of ellipsising.

**Then make the pin honest**: change the M1 dot test from a stylesheet grep to a render
assertion — mount the Library with a seeded tag and assert
`getComputedStyle(dot).display !== 'inline'` (or that the dot's `offsetWidth` is 8 in a
layout-capable env), so a 0×0 identity mark fails loudly.

### F3 — the record button loses its focus ring exactly while recording. **Blocking.**

`src/components/Nodes/LooperNode.css:154-172`

```css
.looper-record.oj-btn.is-recording { … animation: looper-record-breathe 1200ms …; }   /* :158 */
.looper-record.oj-btn.is-recording:focus-visible {
    box-shadow: inset 0 0 0 2px var(--accent-danger), var(--focus-ring);              /* :166 */
}
@keyframes looper-record-breathe {
    0%, 100% { box-shadow: inset 0 0 0 2px var(--accent-danger); }                    /* :170 */
    50%      { box-shadow: inset 0 0 0 2px var(--accent-danger), 0 0 0 4px …; }
}
```

CSS animations sit **above** author-normal declarations in the cascade, so while the breath
is running the keyframed `box-shadow` wins and `:focus-visible`'s `var(--focus-ring)` is
never painted. The one focus vocabulary the first gate praised on this button is silently
absent in the one state where a performer most needs to know where the keyboard is. (Under
reduced motion it is fine — the animation ends in 0.01ms and the element reverts.)

**Fix — move the breath onto a pseudo-element so the button's own `box-shadow` stays free
for focus. Replace `:158` and the keyframes:**

```css
.looper-record.oj-btn.is-recording {
    background: color-mix(in oklab, var(--accent-danger) 12%, var(--bg-tertiary));
    color: var(--danger-ink);
    box-shadow: inset 0 0 0 2px var(--accent-danger);
    position: relative;                  /* if `.oj-btn` is not already positioned */
}

/* The breath rides on its own layer so it never outranks the focus ring: an
   animation beats an author-normal declaration, and `:focus-visible` is one. */
.looper-record.oj-btn.is-recording::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
    animation: looper-record-breathe 1200ms ease-in-out infinite;
}

@keyframes looper-record-breathe {
    0%, 100% { box-shadow: 0 0 0 0 color-mix(in oklab, var(--accent-danger) 22%, transparent); }
    50%      { box-shadow: 0 0 0 4px color-mix(in oklab, var(--accent-danger) 22%, transparent); }
}
```

`global.css:42` matches `*::after`, so reduced motion still stills it, and the static 2px
ring + wash remain the complete read. Add one assertion to the existing
`.looper-record` test that the recording+focused button's computed `box-shadow` still
contains the focus ring.

---

## Non-blocking follow-ups

**Owner: this lane** (cheap; do them with the fixes if convenient)

1. **The confirm copy overstates the loss.** `LooperNode.tsx:1099`, `:1129`, `:1157` say
   *"the take cannot be brought back — the kernel owns their audio"*. Every committed take
   is auto-saved to the Library (`:472`) and a delete only **trashes** that copy (`:490`).
   The true sentence is narrower: it cannot go back **into the loop**. Suggested:
   *"This cannot go back into the loop — its take stays in the Library trash."* Do not
   promise the Library copy unconditionally (the save is best-effort and swallows its
   error at `:485`); phrase it as where to look, not as a guarantee.
2. **Seal the Looper's three destructive steps, like the Library's two.** `handleDeleteLoop`
   (`:719`), `handleClearAll` (`:732`), `handleUndoLast` (`:742`) record a real inverse that
   restores metadata for a take whose PCM is gone. It is invisible today, but it is the
   opposite of the discipline `libraryVerbs.ts:124-131` argues for. A `commitLayers(next,
   {sealed: true})` that records `inverse := forward` would make the three consistent and
   make "one `Ctrl+Z`, and it changes nothing" true by construction rather than by luck.
3. `src/store/libraryVerbs.ts:73` — drop `export` from `applyLibraryVerb` (the driver is in
   the same module; nothing else imports it) and correct its docstring, which claims it is
   "Exported for the driver and for tests" while no test uses it. Code value #8.
4. `src/store/libraryVerbs.ts:133` — add the same re-entrancy guard the other two drivers
   have: `function finish(...) { if (isApplyingHistory()) return; … }`. Zero behaviour
   change today; it is what makes the seam safe against a future effect-driven caller
   (the report's own risk #3).
5. `src/store/libraryVerbs.ts:90-122` — `diffLibrary` does not cover
   `libraries[id].itemCount`, which `emptyTrash`/`permanentlyDeleteItem` mutate. Harmless
   while those two are the only sealed pair; add one line to the comment so the next
   recorded action that touches a count does not silently drift.
6. `LibraryNode.tsx:725-741` — the crop branch (`createVirtualItem`) is not wrapped in
   `recordLibraryEdit` while the tag-only branch one block above is. A crop is therefore
   not undoable. Either wrap it or say why in the comment.
7. `LibraryNode.tsx:1221` — `visibleTags.slice(0, 1)` means only the first tag is removable;
   HEAD allowed two. The `+N` chip is inert. Either give `+N` a disclosure (click expands
   the row's tags) or state the limitation in the chip's `title`.
8. `LibraryNode.css:299-315` — the 120px name floor cost the duration column its alignment:
   in `A-library-light.png` the three lengths sit at three different x positions and the
   row's right edge is ragged. W5-P7 explicitly built that alignment; give
   `.library-file-row__len` a fixed-width right-hung box again, or drop the earlier claim.
9. `LibraryNode.css:161-166` — write the *reason* the 24% wash is safe into the comment:
   it is bounded because `getTagColor` pins `hsl(h, 60%, 70%)` (only the hue moves) **and**
   because the text is `--text-primary`. Worst case over all 360 hues is **11.43 light /
   6.69 dark**; the same wash under `--text-secondary` would be **3.23** in dark. The
   number that makes it safe is the token, not the percentage.
10. `SamplerVisual.css:13-17` — still declares `width: 268px` and reasons about "six 32px
    pads" while the pads measure 46px. Carried over from the first gate, acknowledged as
    not-in-brief. It is a comment that argues for a layout that does not exist.
11. `MEASUREMENTS-3.json` carries one console error (`"Cannot enter node: node not found
    nope"`, harness-induced) while the report's gate table says **0 console errors** across
    every session. Say "0 app errors; one harness probe error" rather than 0.

**Owner: oj-ui lane**

12. `ListRow.css:61` — `.oj-list-row__body` should probably be
    `display: flex; align-items: center; gap: var(--space-xs)` in the component, not
    re-declared by every consumer. `LibraryNode.css:299` already does it for file rows and
    F2 exists because the tag row did not. This is the root cause, not the symptom.
13. Still open from the first gate and untouched (correctly — other lanes):
    `WaveformView.css:6` → `--timeline-clip-border`; `Meter.css:39` → `--success-ink`;
    `Chip.css:11` `12px` → `var(--text-sm)` or a `DESIGN.md` §3 exception;
    `IconButton.tsx:36` → `forwardRef`; a non-playable `KeyTile` variant.

**Owner: founder / other lanes**

14. `getTagColorDark` (`src/store/libraryStore.ts:180`) is still a dead export — its last
    consumer went with HEAD's `file-tag-badge`. Not in this lane's file list; carried over
    from the first gate's #19.
15. W5-P6 F7 is still live: one `Tab` on the canvas swaps the surface and hides every node.
    Both this lane and the first gate had to reach controls programmatically. Until it is
    fixed, no faceplate is keyboard-reachable and F3's focus ring cannot be seen by a real
    player anyway.
16. `e2eBridge` still has no `seedLibrary` verb (third gate in a row to note it).

---

## What I could not verify

- **Feel.** Nothing was heard. The mute→undo→`SET_MUTE` path is proven by source and by the
  lane's `getLoops()` readback; whether an undone mute *sounds* instant with a loop playing
  is a founder pass. A gate never signs off on feel.
- **F1 by execution.** I proved it by reading the two call sites and the synchronous
  `onLoopDeleted` in `ojcoreHandles.ts:418`; I did not run it, because the existing test
  double does not fire the callback and I am not permitted to write source. The fix to the
  double (above) is what would turn this into an executed experiment.
- **The browser.** No browser this round by instruction. Every visual claim here comes from
  decoding the lane's PNGs or from the CSS/DOM contract, not from a live render.
- **The native tier.** Browser/JS only; nothing in this lane is engine code.
- **The lane's `deleteLayer` undo evidence is thinner than it reads.**
  `MEASUREMENTS.json.looperJourney.deleteLayer` records only `afterUndoNodes: 3` — the row
  count and `data.layers` after that undo were never captured. I reasoned the ghost
  metadata is invisible (rows are engine-led); nobody measured it.
