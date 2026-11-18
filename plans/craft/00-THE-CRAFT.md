# The craft — how this team works, and the work in order

Written 2026-09-03 by the orchestrator, after the owner's brief: *a leader pushes others to do
better work than they could ever do themselves; that takes learning from them and teaching them;
delegate while pushing for amazing; manage resources; a plan and a vision beat a swarm of agents;
review their code yourself; not every change needs every test; quality over quantity; the actually
hard part is keeping the whole codebase in your head and keeping it small and clean — obsess over
every line, unify, rewrite to make it simpler. That is the craft.*

This document is the operating model and the ordered work. It supersedes the *process* parts of
`plans/ux-intuitive/00-PLAN.md`; the *direction* stays `plans/ux-intuitive/02-THE-SET.md` and the
guiding star in `AGENTS.md`.

## 1. The honest ledger

Measured 2026-09-03 on `t3code/openjammer-redesign-timeline` against `origin/canari` (merge-base
`42682a61`; canari has not moved).

| | canari | this branch | delta |
|---|---:|---:|---:|
| control-plane source, non-test (`src`, `packages/oj-ui/src`) | 74.2 k | 93.6 k | **+17.7 k** (35.7 k added, 18.0 k removed) |
| control-plane tests | ~22 k | ~42 k | **+19.9 k** (217 files) |
| Rust (`crates`) | | | +0.9 k |
| plans / reports markdown | | | +36.5 k, 124 files |
| commits | | 47 | |

The branch fixed real things — the timeline behaves to spec, the browser tier stopped silently
dropping every sampled voice, the first run tells the truth — and it grew the control plane by a
quarter while our covenant says *fewer, better*. Every wave ran builder → adversarial Opus gate →
fix round → seven gates → commit, and every gate found real defects. That is a process that
catches mistakes by paying twice for them. Two read-only surveys of the tree today found:

- **Verbs are declared in nine places, ≈ 9,600 lines.** `keybindingActions` (168 entries, metadata
  only), `commandRegistry.Action` (~40, behaviour and enablement), `ContextMenu`'s hand-written
  `CanvasVerbs` bag, `AppMenuBar` literals, `DropdownMenu` and `HelpPanel` each with their own item
  shape, four verb unions under `EditVerb` (70 kinds) plus `TimelineOp` (42) and `editingActions`,
  `TOOL_CATALOGUE` in `src/ai/tools.ts` *and again* in `pi-openjammer-graph`, and `historyPhrase`
  re-deriving English from verb shapes because every call site records `'Edit graph'`. The palette
  cannot reach delete, connect, mute or play. One verb has five labels.
- **≈ 1,400 dead lines** verified by grep: `engine/nodeStandards.ts` (585, all 20 exports unused),
  `utils/signals.ts` (135, all unused), `createStandardPanels` (~120), and ~40 more zero-importer
  exports; plus `generateWaveformPeaks` written four times, `formatDb` twice, `ROW_KEYS` twice, the
  canary flag expression twice.
- **≈ 900 lines of faceplate boilerplate**: 18 byte-identical `…NodeProps` interfaces, 18
  destructurings, 10 identical `NodeFrame`+`NodeShell` openings, 6 private port-row renderers, 14
  `useIsAgentPending` reads that `NodeWrapper` already made, 4 identical meter-feed effects.
- **≈ 1,000 lines of duplicated test scaffolding**: 33 hand-written graph-store reset blocks (3 of
  36 already drifted), 54 executor mocks, 10 node factories, 5 ResizeObserver stubs; `src/test/`
  exists and no test imports it. Five "wave" test files (2,361 lines) are organised by when the
  work happened, not what it covers. Several tests mostly assert that mocks were called.
- `graphStore.addConnection` is 504 lines with two parallel 100-line arms (sampler / instrument)
  and a `canvas-output (legacy)` branch. `NodeCanvas` carries a 548-line keyboard effect that
  re-implements the arbiter it also registers with. `nodeInternals.ts` (1,276) is node-definition
  data written as imperative code beside a registry that already declares the same ports.
- The two piano rolls are already one component. The saving there is small (~95 lines) but it
  closes two silent divergences: two velocity-alpha formulas, and a roll playhead without follow.

None of this is a surprise given how the code was produced: lanes briefed by the wave, each
adding beside what existed because deleting was nobody's job. From here, deleting is the job.

## 2. The operating model

### 2.1 Design before delegation

No lane starts without a design note I write. It fits on a page and always has the same parts:

```
Seam        the one type / module the change is built on, and why that one
Shape       the types after the change (written out — a lane implements, it does not invent)
Owns        files the lane may touch; everything else is read-only
Deletes     what is removed, by name — a lane that removes nothing is briefed wrong
Behaviour   acceptance as observable behaviour, in one sentence each
Budget      expected net lines (negative unless a written reason says otherwise)
Verify      the proportionate checks (§2.4), named — not "all gates"
Report      ≤ 40 lines: changed / verified / could not verify / risks / net lines
```

The design carries the taste; the lane carries the grind. This is how codex becomes usable for
real work (its taste is poor; handed a shape it is excellent) and how Opus stops re-deriving the
architecture per lane.

### 2.2 I review every line

The default reviewer is me, not a second Opus lane. I read the full diff of every lane before it
is committed, against this checklist:

1. **Which side of the boundary** — is anything here core that should be plugin, or store that
   should be document, or component that should be store?
2. **Does something already do this** — the survey says yes far more often than lanes assume.
   A second implementation of an existing idea is refused, even if better; extend the first.
3. **What got deleted** — every feature-shaped change should leave the tree smaller somewhere.
4. **Joins by string** — an id compared across modules where a type should carry it.
5. **Tests test behaviour** — an assertion that a mock was called is not a test; a file named
   after a wave is filed wrong.
6. **The audio path** — anything touching `src/audio` or a worklet: no allocation on the render
   thread, no fallback inside the core, `AudioContext.currentTime` for timing.
7. **Names and words** — one word per concept across cards, menus, palette, docs, history.
8. **Comments earn their place** — a comment that narrates the diff is deleted; one that records a
   non-obvious *why* stays.

Review findings go back to the lane as a written note with the reason, so the lane fixes it and
learns it. Findings that recur across lanes go into `plans/craft/LESSONS.md`, and every brief
carries that file. That is the teaching loop; it is also the only way the next lane starts
smarter than the last.

The adversarial persona re-run stays, but only for perception-facing work (a browser, hands, the
fresh-hands task that surfaced the friction). Code-shaped work does not get a second model; it
gets my eyes.

### 2.3 Fewer, longer-lived lanes

- **At most two lanes at once.** Three concurrent Chromium lanes made vitest flaky and tripped the
  Opus limit three times, and each kill cost a resume with context re-read.
- **One lane per pillar for the pillar's duration**, resumed by message. A lane that has read
  `graphStore` once should not be replaced by one that has not.
- **Model routing as the covenant says:** codex (`gpt-5.6-sol`, back 2026-09-03 18:26) for bounded
  implementation from a design, dead-code and edge-case hunts, and second-opinion reviews of Rust
  or wasm; Opus for anything a player perceives; me for design, review, and the calls.
  Codex never signs off on feel; the founder with audio playing does.
- **Reports are ≤ 40 lines.** No more per-lane `REPORT.md` / `REVIEW.md` files: the record is the
  design note, the review note, the commit message, and the lessons file.

### 2.4 Proportionate verification

"Run all seven gates" per lane was the reflex; it is expensive and it hid what mattered. From here:

| change touches | during the lane | before I commit | on the PR |
|---|---|---|---|
| any TS | `bunx tsc --noEmit -p tsconfig.app.json` (always, ~30 s) + vitest on the touched files' tests | lint on touched files; full `test:run` + `build` **once per commit batch** | CI runs everything |
| a node faceplate / shell / oj-ui | + the faceplate tests, one Ladle look | + `bunx figma connect parse` if a `.figma.tsx` moved | |
| keymap / verbs / menus | + `arbiter`, `keybindingsCatalogue`, `ContextMenu`, `CommandBar` tests | + the FH-2 keyboard task on a preview build | |
| `src/audio` or a worklet | + `wasmExportParity`, `ojcoreExecutors`; `e2e/engine-real.spec.ts` under node | + `cargo test -p ojcore` if Rust moved; `git checkout -- Cargo.lock` | + the founder's ears |
| `crates/*` | `cargo clippy --workspace --exclude oj-tauri --all-targets -- -D warnings`, `cargo test` for the crate | + rebuild wasm (`src/audio/wasm/build-wasm.sh`) if `ojcore-wasm` moved | + the founder's ears |
| docs / plans | nothing | nothing | |

A flake is re-run in isolation before it is called a regression (`voiceSynth`, `CommandBar` are
known). Playwright runs under `node`. Private ports per lane. e2e never hard-codes a port.

### 2.5 The net-lines ledger

Every commit message ends with its net line count for `src` + `packages/oj-ui/src` (non-test and
test, separately). Every design note carries a budget. A lane that lands positive without a
written reason gets sent back. The running total lives in §5 of this file and is updated at every
commit. The first target is not the budget in `02-THE-SET.md §4`; it is simpler: **below canari's
74.2 k non-test lines before map mode ships.**

### 2.6 Standing rules (unchanged)

bun only · lanes never run `git add/commit/stash/checkout/reset` · I commit by explicit pathspec,
never `git add -A` (other lanes' files share the tree) · PRs target `canari` · `--exclude oj-tauri`
for clippy on this box · Cargo.lock is restored before commit · the founder's listening pass with
audio and hardware is the merge gate for anything perception-facing.

## 3. The work, in order

Each phase is a set of design notes; each note is one lane-sized piece with a budget. Phases are
sequenced so that every later piece is cheaper to verify because of the earlier ones.

### Phase 0 — Land the floor (this week)

The redesign branch is the floor the reduction stands on. It closes as it is, with one change of
method: **I do the gates that were queued for Opus.**

1. I review the uncommitted UX-1A2 (voice registry, transport ack, sanitize report) and UX-1D
   (nine deferred word/keymap patches) diffs line by line — 94 files, +1,904 / −523 — and commit
   what passes by pathspec. Anything that fails goes back to its lane with a note.
2. UX-1F, the performer keyboard lane (`01-UX1-WAVES.md`: Enter fires Song buttons, the pill's
   fault text, focus = selection, M feedback, U17 the header reads the master meter, U18 Space is
   transport wherever a Song exists, Speaker meter index). One Opus lane, my design note, FH-2's
   task as its re-run. Budget: ≤ +150.
3. Baseline re-capture (W6-BASE, fix the hard-coded port in the collab spec), `COVERAGE.md`,
   `PR-DESCRIPTION.md`. PR → `canari`. Babysit every review comment and check.
4. Founder listening pass with audio and the MiniLab. Nothing on this branch has been heard.

### Phase 1 — Subtraction (the certain cuts, ≈ 3,500 lines)

One long-lived lane, "subtraction", in this order; each step is its own commit and its own tiny
design note. Steps 1–2 are mechanical and go to codex the moment its quota returns; step 3 is
perception-facing and goes to Opus.

1. **Delete the dead** (survey §6): `engine/nodeStandards.ts`, `utils/signals.ts`,
   `createStandardPanels`, the ~40 zero-importer exports, `migrateV1toV2`, the unused alias
   `useSampleLibraryStore`, `searchCommands` and the legacy `Command` normaliser once its three
   callers pass `Action`s. One `isCanary()`. One `generateWaveformPeaks` (the worker's; the
   deprecated one and the two copies go). One `formatDb`. Fix the one string-literal reference in
   `portVocabulary.test.tsx`. Budget: ≈ −1,400. *Decide first:* `createPort` / `PORT_TEMPLATES`
   in `nodeStandards.ts` are what Phase 3's declarative internals table wants — keep those two
   functions by moving them into `engine/registry.ts`, delete the rest.
2. **One test harness**: `src/test/harness.ts` with `resetGraph()`, `mockExecutor(overrides)`,
   `makeNode()`, `installResizeObserver()`; migrate the 33 reset blocks, 54 mocks, 10 factories.
   Refile the five wave-named faceplate tests by unit. Delete assertions that only check a mock was
   called where a behaviour assertion exists beside them. Budget: ≈ −1,000 test lines.
3. **One faceplate frame** (survey §1): export `SchematicNodeProps` (it already exists as
   `schematicProps` in `NodeWrapper`), `useNodeChrome`, one `<SchematicShell>`, `useNodeMeter`;
   the six private port-row renderers become one. `MIDINode` / `MiniLab3Node` share one
   `<MidiDeviceBody>`; `MiniLab3VisualNode` folds into `MIDIVisualNode`'s dispatch. Budget: ≈ −1,000.
   Verified by the existing faceplate tests plus a Ladle look at every node in both themes.
4. **Timeline divergences** (survey §3): one grid-mark generator with two renderers, one
   `velocityOpacity` (the contrast-proven one), the roll's playhead through `usePlayheadTransform`.
   Expect `contrast.test.ts` to move deliberately. Budget: ≈ −95.
5. **`SamplerNode`'s three decode paths → one; its five param handlers → `AutoParamPanel`;
   `useSamplerAdapter(nodeId)`.** Budget: ≈ −150.
6. **`addConnection`'s twin arms → `installBundleRow(kind)`; delete the `canvas-output (legacy)`
   branch** after confirming no save format still emits it. Budget: ≈ −140.

### Phase 2 — One verb catalogue (the keystone)

This is the piece map mode is impossible without, and the one that deletes the most restatement.
My design, in outline, so the lane inherits decisions and not questions:

**Seam:** `commandRegistry.Action`. It already has id, title, group, path, keywords, blurb,
`targets`, `surfaces` with an enforced superset invariant, `enabled(ctx)`, a projection
(`queryActions`) the context menu already uses, and a normaliser that absorbed one legacy shape
and can absorb the next.

**Shape after:**

```ts
interface Action {
  id; title; group; path?; keywords?; blurb?;
  targets: TargetKind[]; surfaces?: Surface[];        // 'palette' | 'menu' | 'key' | 'map' | 'agent'
  binding?: { default: KeyCombo; scope; surface?; mode? };   // absorbs keybindingActions
  enabled?(ctx: ActionCtx): boolean;  disabledReason?;
  run(inv: Invocation): ActionResult;                  // one dispatcher for key, button, menu, agent
  verbs?(inv: Invocation): EditVerb[];                 // reversible subset: generates undo title,
}                                                      //   live-region sentence, Pi tool, map target
type Invocation = { ctx: ActionCtx; event?: KeyboardEvent; source: 'key'|'palette'|'menu'|'agent'|'map' };
type ActionResult = 'done' | 'declined' | { rejected: string } | { pending: Promise<ActionResult> };
```

**The three obstacles the survey named, decided:**

1. *Decline-by-return and event guards.* `ActionResult 'declined'` is the arbiter's fall-through;
   binding-set order stays the tiebreaker (the `types.ts` warning about `e`/`q` before the note
   keys remains true and remains tested). `guard(event)` becomes `enabled(ctx)` where it only
   reads state, and stays an event read inside `run` where it needs `repeat`/`shift`.
2. *Async and interactive.* `{ pending }` is the shape for confirm dialogs and exports; the
   dispatcher owns the history transaction (`begin` at run, `commit` on done, `abort` on rejected
   or cancelled), so no call site brackets history by hand.
3. *Labels.* One `title`, imperative. The past face for the live region is derived by one rule
   table (`Delete X` → `Deleted X`) that replaces `historyPhrase`'s hand-written verb list; the
   agent description is `title` + `blurb`. Per-surface label variants are not a field; where a
   surface needs different words it is a bug in the title.

**Deletes:** `keybindingActions` (the array; `keybindingsStore` keeps only customisation and
persistence), `keybindingsCatalogue.test.ts` (the type now does its job), `runAction.ts` and
`getCommand(id)?.run()` (one dispatcher), `ContextMenu`'s `CanvasVerbs` bag and its duplicated
rows, `AppMenuBar`'s literals, `DropdownMenu`'s and `HelpPanel`'s item shapes (they project),
`TOOL_CATALOGUE`'s prose list of 58 verb kinds and the second copy in `pi-openjammer-graph`
(generated from `verbs?`), most of `historyPhrase.ts`, `editingActions.ts` (its eight functions
become actions). `NodeCanvas`'s 548-line keyboard effect becomes binding entries;
`multiConnect` moves beside `beginConnectionFrom`; the QWERTY rows become one hook shared with
`KeyboardVisualNode`.

**Steps, each shippable alone:** (a) the type merge and generated binding catalogue; (b) the
`NodeCanvas` effect into entries, behind `arbiter.test.ts`; (c) menus and help project from the
registry; (d) Pi tools generated; (e) history phrases derived. Budget for the phase: ≈ −2,500
across the ≈ 9,600 surveyed, with the keymap, palette, menus and agent finally agreeing.

### Phase 3 — Stores and internals

1. **One `viewStore`** (survey §2 group A): `canvasStore` + `canvasNavigationStore` + `uiViewStore`
   + `trackLaneViewStore` over `editingContextStore.viewports`; `SurfaceId` moves to a types module;
   the pan/zoom double-write ends. Fold `uiViewStore` first as the proof. Budget: ≈ −280.
2. **Palette learning into one file**; `uiFeedbackStore` into the view store; `guideStore`'s unused
   generic layer down to the one guide it serves. Budget: ≈ −250.
3. **`nodeInternals.ts` declarative** (survey §4): a table per node type read by one builder using
   the rescued `createPort` / `PORT_TEMPLATES`; `portSync`'s validation third moves to
   `typeGuards`; the dynamic-port add/remove pair lives once. This also retires four of the five
   sources of port naming that `portVocabulary.ts` exists to reconcile. Budget: ≈ −500.
4. **`graphStore` sheds what is not the graph**: selection to the view store, its second clipboard
   into `clipboardStore`, `getNodeDimensions` and the hierarchy walkers to their owners, the
   instrument/sampler row mutators beside the nodes they serve. Budget: ≈ −400.

### Phase 4 — The star's additions, over a smaller base

In the order `02-THE-SET.md §5` gives, now that each stands on one catalogue and fewer stores:
**map mode** (`bind` is a verb; bindings in the document; device-signature re-bind; tape labels;
the chip; Escape; undo; fake Web MIDI in e2e, the MiniLab on native) → **sound truth**
(`SignalState`) → **simple nodes** (≤ 4 face controls, twins collapse by migration, the five-role
menu, `group`) → **Macro and Snapshot nodes, Record on a pad** → **a chain per player** →
**the personas re-run**, with *the band* and *eyes-free* added. Map mode is the one feature this
plan adds; it lands only once §2.5's first target is met.

## 4. What I am doing next

1. Review the uncommitted UX-1A2 and UX-1D diffs myself (Phase 0, step 1) and commit by pathspec.
2. Write the UX-1F design note and start the one Opus lane.
3. Write the Phase 1 step 1–2 design notes so codex can take them the minute its quota returns.

## 5. The ledger (running)

| date | commit | non-test src | test src | note |
|---|---|---:|---:|---|
| 2026-09-03 | `87420a4b` | 93.6 k | ~42 k | start; canari is 74.2 k / ~22 k |
