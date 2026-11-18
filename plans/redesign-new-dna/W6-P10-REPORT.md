# W6 · P10 — small correctness leftovers

Branch `t3code/openjammer-redesign-timeline`, uncommitted. Resumed a partial run whose
edits were already in the tree; everything below is the finished state.

**Verification (all run from the worktree root):**

| Command | Result |
|---|---|
| `bun run test:run -- src/engine src/store src/rigs src/components/__tests__/BundlePortGroup.test.tsx src/ai` | 44 files, 476 tests, **pass** |
| `bunx tsc --noEmit -p tsconfig.app.json` | **clean** |
| `bunx eslint src/engine src/store src/rigs scripts/oj src/components/__tests__` | **clean** |
| `git diff --check` | **clean** |
| `bun run test:cli` (the `oj` CLI suite — the new map test lives there) | 52 pass, 0 fail |
| `bun scripts/oj/index.ts doctor --check node-registry` | **PASS** (was FAIL before item 3) |
| `bun run test:run` (whole suite, once) | 2373 pass, **1 fail — not this lane** (below) |

**The one full-suite failure is another lane's / a load flake:**
`src/components/Settings/__tests__/KeybindingsPanel.test.tsx > should render all keybinding
actions` — `Test timed out in 5000ms` under full parallel load. Re-run alone: **21/21 pass
in 11.7s**. Not touched by this lane.

---

## 1 · `pan` / `width` reachable, and an invariant that keeps the next orphan out

**Change**
- `src/engine/registry.ts:899-907` — `Effects` bucket is now `['effect', 'pan', 'width']`.
- `src/engine/registry.ts:867-885` — new doc comment on `menuCategories` naming it as the
  ONE reachability list and both surfaces that read it. (Replaces the inline note the
  previous run had left inside the `Effects` object.)
- `src/engine/__tests__/menuCategories.test.ts` (new, 6 tests).

**Both surfaces do derive from this list — read, not edited:**
- `src/components/CommandBar/useCommandSources.ts:94-104` — `buildNodeActions()` builds
  `new Set(menuCategories.flatMap((c) => c.items))` and mints one `node.add.<type>` Action
  per member, grouped by `CATEGORY_LABEL[def.category]` (lines 42-49).
- `src/components/Canvas/ContextMenu.tsx:76-100` — the right-click menu does **not** read
  the registry at all; it renders those same `Action`s, grouping by `path[0]` (the same
  `CATEGORY_LABEL`) and ordering the groups by `CATEGORY_ORDER`
  (`['Input','Instruments','Routing','Effects','Utility','Output']`).
- `src/ai/graphAdapter.ts:169-180` — the in-app agent's add-a-node vocabulary is the same
  flatMap. So an orphan is unreachable by the player *and* by the agent.

Because the palette groups by `def.category` while the menu orders by bucket *name*, the two
agree only if a type's bucket matches its declared category — the test pins that too.

**The invariant test.** `menuCategories.test.ts` is total: every id in `KNOWN_PLUGIN_IDS`
must be in exactly one bucket **or** in the file's `INTERNAL_ONLY` map with a per-entry
reason. It also asserts `INTERNAL_ONLY` stays honest (no stale ids, nothing both internal
and offered, every reason longer than 20 chars). The 16 exemptions, with the reason given
in-file (the reasons for `keyboard-key` and `instrument` were corrected in P10b — see the
last section; the wording below is P10's):

| Exemption | Reason |
|---|---|
| `instrument-visual`, `midi-visual`, `minilab3-visual`, `sampler-visual` | interior mirrors of a container the player already placed; synthesised on enter |
| `keyboard-key` | one key inside a keyboard container; the keyboard mints its own |
| `canvas-input`, `canvas-output` | level-boundary interior handles for a parent port |
| `input-panel`, `output-panel` | published-port panels a container creates for itself |
| `minilab-3` | a MIDI device preset, reached by picking the hardware in the MIDI browser |
| `instrument` | the generic voice-by-id the rigs/agent build; the menu fronts it with `strings`/`keys`/`winds` so there is one obvious "add an instrument" row |
| `piano`, `cello`, `electricCello`, `violin`, `saxophone` | legacy fixed voices, load-only, superseded by the family aliases — flagged as covenant-#8 deletion candidates for the owner, not deleted here (out of lane) |

**Why it fails on the old code:** on `HEAD`'s `items: ['effect']`, the totality test reports
`orphans = ['pan', 'width']` and the F5 spot-check `expect(effects.items).toContain('pan')`
fails outright.

---

## 2 · Rig install = ONE `Ctrl+Z`, Song included

**The bug that was left.** The previous run had added the in-gesture `setArrangement(...,
{ preserveHistory: true })` but had *not removed* the old post-gesture block, so the beat rig
installed its Song twice — and the second call was the plain `setArrangement`, which
**clears the command-log**. The rig's single history entry was wiped one line after it was
made: the beat rig was the one edit in the app a player could not undo.

**Change**
- `src/rigs/buildRig.ts:107-129` — the Song (and then the loop arm, which must follow it
  because `setArrangement` resets transport) moved **inside** the
  `beginGesture()`/`endGesture()` bracket; the duplicate post-gesture block deleted.
- `src/store/historyStore.ts:11-28` — new `DocumentVerb` and a third `EditVerb` arm,
  `{ domain: 'document' }`, carrying a whole-`Arrangement` **snapshot**. Documented as
  existing for this one shape: a `Verb` edits a song that exists and cannot cross
  none→song.
- `src/store/arrangementStore.ts:244-258` — `setArrangement(arr, { preserveHistory? })`; the
  JSDoc now states both halves of the law.
- `src/store/arrangementStore.ts:485-499` — default path still `useHistoryStore.clear()`; the
  `preserveHistory` path keeps the log and records the swap, guarded by `isApplyingHistory()`
  so undo/redo replay never re-records.
- `src/store/arrangementStore.ts:864-873` — the arrangement history driver applies `document`
  snapshots **first**, then the `Verb`s in the same step.

**Ordering is load-bearing.** `historyStore.record` appends verbs but *prepends* inverses,
so a rig entry is `verbs = [...graph, document]`, `inverse = [document, ...graph]`. Undo
therefore hands the driver the document first anyway.

> **Corrected in P10b (review F3/FU1).** This section originally claimed the driver's
> document-first loop "makes it true for *any* ordering". It does not: forcing documents
> first is right forward and **wrong on undo**, where the restore has to come last. The
> driver is order-preserving as of P10b.

**Pinning tests**

`src/rigs/__tests__/rigs.test.ts:167-227` (4 new):
- *takes the beat rig SONG away on the same Ctrl+Z as its nodes* — one entry; undo gives
  `arrangement === null` **and** nodes/connections back to before; redo returns both.
- *puts the song that WAS open back* — the non-null previous case.
- *does not grow the log while the player undoes and redoes it* — 3 undo/redo cycles,
  `entries.length === 1` and `cursor === 1` every time.
- *records no document swap for a rig that has no song at all*.

`src/store/__tests__/historyStore.test.ts:66-135` (3 new):
- *still CLEARS the log when a document is simply opened* — the unchanged law.
- *keeps the log, and records the swap, when it is part of a bigger gesture* — asserts the
  exact recorded verb/inverse pair, then that replaying it appends nothing.
- *applies the document swap BEFORE the arrangement verbs in the same step* — **replaced in
  P10b** by *applies a swap and the verbs around it in the order they were recorded*, which
  pins the constraint in both directions instead of the forward-only rule.

**Proven to fail on the old code (measured, then restored):**
- Restoring the pre-fix `installRig` (song installed after the gesture, plain
  `setArrangement`) → `bun run test:run -- src/rigs`: **3 failed / 34 passed**, exactly the
  three new undo/redo tests. Restored: 37/37.
- Moving the driver's document loop to run *after* the arrangement verbs →
  `bun run test:run -- src/store/__tests__/historyStore.test.ts`: **1 failed / 5 passed**,
  exactly the ordering test. Restored: 6/6.

**Agent / collab / serialization paths.** I grepped every `.domain` use in `src`
(`src/store/graphStore.ts:2032`, `src/store/arrangementStore.ts:875`,
`src/song/__tests__/wave4bEditing.test.ts`, `src/__bench__/controlPlane.bench.ts`). There is
**no exhaustive `switch` on `domain` anywhere** — both history drivers use a filtered
type-guard (`item.domain === 'graph'` / `'arrangement'`), so the new arm is a no-op for the
graph driver by construction rather than by a silent fallthrough. `src/ai/arrangementAdapter.ts`
and `src/ai/graphAdapter.ts` speak `Verb`/`GraphVerb`, never `EditVerb`; nothing serializes
`HistoryEntry` (there is no `pi-openjammer-graph` history payload — `collectSaveData.ts` saves
the document, not the log). `bunx tsc --noEmit` is clean and the `src/ai` tests pass.

**Docs.** `docs/shell.md` "Preset rigs" and "The beat rig's Song and the step grid" now state
that the Song is inside the rig's gesture and that opening a document still clears the log.
(The loop-arming paragraph was rewritten in P10b: the arm now travels IN the snapshot.)

---

## 3 · Stale comments that described behaviour that no longer exists

**The real one, and it was breaking a gate.** `src/engine/registry.ts:479-487` said:

> `NodeWrapper has NO bespoke branch for 'instrument' (it is NOT in SCHEMATIC_TYPES nor a renderNodeContent case) — it falls through to the FREE AutoParamPanel … reality is 'auto'.`

That stopped being true in the previous commit (`ab23a31`), which added `'instrument'` to
`SCHEMATIC_TYPES` (`NodeWrapper.tsx:78`) and gave it a `case 'instrument':` branch rendering
`<InstrumentNode>` (`NodeWrapper.tsx:486-499`). The def still declared `ui: 'auto'`, so the
**plugin manifest advertised a free param panel for a node that renders a bespoke faceplate**.

- Fixed at `src/engine/registry.ts:479-487` → `ui: 'react'`, comment rewritten to say what is
  now true and why the declaration matters (it is what the manifest publishes).
- `src/engine/__tests__/manifest.test.ts:165-182` updated to the new reality, and I added
  `pan` / `width` to the free-panel spot-checks (they had none).

**Why it fails on the old code:** `bun run test:cli` was **red on arrival** —
`scripts/oj/__tests__/node-registry.test.ts:205` (`run() on the real tree PASSES`) reported
`1 coupling finding … NodeWrapper renders 'instrument' with a bespoke branch but
nodeDefinitions['instrument'].ui is NOT 'react'`. Green now. This was pre-existing on `HEAD`,
not caused by this lane (my `registry.ts` diff before this was comments plus menu items only;
`NodeWrapper.tsx` is unmodified in the tree).

**Others corrected**
- `src/store/arrangementStore.ts:244` — `"resets the command-log + transport"` was wrong in
  both directions after item 2; rewritten to state the clear-on-open law *and* the one
  exception.
- `src/rigs/buildRig.ts:1-18, 107-129` — the header claimed one gesture covered the graph, and
  a comment claimed the Song "replaces the open song rather than joining the graph's undo
  stack". Both now describe the shipped behaviour.

**Checked and found NOT stale (no change):**
- `TransportStrip` — zero references anywhere in `src`/`docs`/`scripts`.
- `webaudio` executor — the only mentions (`src/audio/executor/index.ts:14`,
  `src/audio/instrumentCatalog.ts:4`, `docs/ARCHITECTURE.md:42`, `docs/BOUNDARY.md:70`) all
  say it *was removed*, which is correct history, not a stale claim.
- cream / cyberpunk / midnight — every mention is "retired" or "the file this replaces held";
  `onboardingStore.test.ts:32` asserts `"theme":"cream"` is *rejected*.
- per-key ports (`src/engine/registry.ts:100-111`, `src/store/graphStore.ts:38-51`) —
  accurate: top-level `keyboard-visual` has none, the container mirror keeps them, and the
  migration filter is live.
- `src/rigs/presets.ts:52-56` "the rows do not yet arrive as a detected BUNDLE" — verified
  against `src/utils/bundleManager.ts:222-250`: `getBundleInfo` still requires a composite
  `panel:port` id, so the claim (and the matching `docs/shell.md` cost) is still true.

---

## 4 · `BundlePortGroup.test.tsx`

**Verdict: KEEP.** It passes, and it is the **only** assertion of the 190px rule anywhere —
`grep -rn "190px" src --include=*.ts*` returns that test file and nothing else. It pins two
rules that now live in two different files after W5-P6 split them (`bundle-label` and
`grid-template-columns` in `src/components/BundlePortGroup.css`, and
`.oj-node.port-panel:has(.bundle-port-group) { width: 190px }` in
`src/components/Nodes/PortPanelNode.css:26-29`, whose own comment already says
"`BundlePortGroup.test.tsx` pins it"). Not a duplicate of anything in
`src/components/Nodes/__tests__/`.

**Change:** it lives at `src/components/__tests__/BundlePortGroup.test.tsx`. In commit terms
this is a **net-new file**, not a move: the colocated path it came from was never in `HEAD`,
only an untracked artefact of an earlier uncommitted run of this same lane (so "the repo's
only colocated test" was true of the working tree, not of the repo). It was and given the header docblock it lacked, explaining what breaks without it
and why the assertions are on CSS text (jsdom has no layout engine, so the test pins the rules
that produced the measured browser evidence, not a rendered width). Imports re-pointed; the
`readFileSync` paths are repo-relative so they are unaffected. Still covered by exactly one
runner (vitest `src/**`), which the `test-collection` doctor check requires.

---

## 5 · `component-map.json` regeneration on Windows

**Change**
- `scripts/oj/design.ts:25-35` — new `repoRelative(file)` =
  `relative(ROOT, file).split(sep).join('/')`, with the reasoning in a docblock.
- `scripts/oj/design.ts:156` — `codePath` now uses it. That is the only path string written
  into the map; `githubUrl` (line 164) is `codePath` glued onto the blob URL, so the same
  change fixes it. `figmaUrl` carries no path.
- `scripts/oj/design.ts:96-129` — `ladleStories()` now **prefers a `states` story** when the
  component publishes one, falling back to first-sorted for determinism.

**On the `states` preference — I agree, and implemented it.** The map is a set of links for
Figma reviewers jumping from a frame to the live story, and `states` is the canonical
overview; letting whichever variant sorts first win means adding a story silently moves the
link (`button--states` → `button--loading`). One-line rule (`isOverview` + `choose`),
documented in the function's docblock with that exact example.

**Regenerated** (`.ladle/build/meta.json` was present and current, so no `bunx ladle build`
was needed): `bun scripts/oj/index.ts design map` →

```
component-map.json: 53 components, 53 Figma-mapped, 53 with a Ladle story (0 storyless)
```

Verified: `grep -c '"codePath": "[A-Za-z]:'` → **0**, and zero backslashes in the whole file;
every path is repo-relative POSIX. Net diff is 10 lines: 5 `null` → a real story (Field,
Input, NodeShell, Port, Select — new stories since the last regeneration), and **4** story-id
moves, 3 of them the new preference doing its job (KeyTile `pad-grid`→`states`, Swatch
`gallery`→`states`, WaveformView `single`→`states`) plus ProgressBar below. Button *held* at
`states` — it did not change, so it is not one of the moves.

**One honest wobble:** ProgressBar moved `levels` → `indeterminate`. ProgressBar has no
`states` story, so the deterministic first-sorted fallback picks the newly-added
`indeterminate`. Correct per the documented rule; if the owner wants ProgressBar to land on
`levels`, the fix is a `states` story in `packages/oj-ui` (another lane's file), not another
rule here.

**New pinning test:** `scripts/oj/__tests__/component-map.test.ts` (4 tests, `bun:test` — the
runner the `oj` CLI tests use, so `test-collection` still sees exactly one runner per file).
It asserts every `codePath` is non-empty, contains no backslash, is not drive-rooted or
absolute, and **resolves to a file that exists**; that every `githubUrl` ends with its own
`codePath`; that the coverage counts match the listed components; and that Button still links
to `primitives--button--states`. The **committed** map was already repo-relative POSIX — it
was generated on POSIX, where the old code worked — so this test would not have gone red on
`HEAD`. What it guards is a *Windows regeneration*, where the old `` `${ROOT}/` `` prefix
strip could never match and every entry would come out as an absolute `C:\Users\…`.

---

## What I could NOT verify

- **No audio, no browser.** Nothing here was exercised with sound playing. Item 2 changes an
  undo path a performer drives (`Ctrl+Z` right after a rig lands) and item 1 adds two nodes to
  a live menu; both want a human pass with the app running. Per the covenant, green CI is not
  a sign-off on feel.
- **The redo-loses-the-loop gap — FIXED in P10b, still unheard.** As shipped in P10 this was
  worse than the report claimed: `setArrangement` resets `loopEnabled`, so a redone beat rig
  played its bar **once** rather than looping. P10b puts the arm in the `document` snapshot,
  so redo reproduces the do and undo restores the player's switch. Pinned by tests, but still
  never heard with audio playing — that pass is still owed.
- **`bunx ladle build` was not re-run** — the existing `.ladle/build/meta.json` (today, 06:24)
  already yielded 53/53/53, and rebuilding would have swept in whatever stories the concurrent
  `src/components/**` lanes have in flight.
- **The `figma connect parse` leg needs the Figma CLI.** The regeneration warns that v1.4.8 is
  installed and v2.0.0 exists; I did not upgrade it (out of lane, and an upgrade could change
  the parse output shape the map depends on).
- **The 5 legacy fixed voices** (`piano`/`cello`/`electricCello`/`violin`/`saxophone`) are
  flagged in `INTERNAL_ONLY` as covenant-#8 deletion candidates. I did not delete them — that
  is an owner call with a save-file-compatibility cost.

## Risks

- **`document` is a snapshot verb in a log of deltas.** A rig entry now holds a whole
  `Arrangement` (a few KB for the beat song). Fine for the one shape it serves; if it ever
  spreads to ordinary timeline editing the log stops being small and stops being something
  collaboration can ship. The type's docblock says so explicitly, and the only producer is
  `setArrangement({ preserveHistory: true })` — one call site, in `src/rigs/buildRig.ts`.
- **Installing a beat rig replaces the open document.** It always did; it is now *undoable*,
  which is strictly better, but it is still a document swap and the player has one entry to
  get back.
- **`instrument` now declares `ui: 'react'`.** That is what `NodeWrapper` already does, so no
  render changes — but it changes what the plugin manifest advertises for that type. Worth a
  glance from whoever owns the manifest consumers.

---

# P10b — the review's fixes, behaviour included

Round two against `W6-P10-REVIEW.md`. The review's three blockers were all "a new comment
that is false against its own code"; two of them (F1, F3) were false because the *behaviour*
was wrong, so this round fixes the behaviour and then makes the prose describe it. The rest
are the follow-ups the review listed.

## F1 + FU3 — the loop arm travels with the document

The gap: `setArrangement` hard-resets `loopOn` / `loopEnabled` (`arrangementStore.ts:475-476`)
on every call, the history driver's included. `installRig` armed the loop *after* the swap,
outside the log — so **redo did not reproduce the do**: a redone beat rig played its one bar
and stopped, and an undo left the player's own loop switch off. For a rig whose entire
identity is a looping bar, that is a performer reading "the app lost my patch".

Fix: the `document` snapshot now carries the arm alongside the arrangement — one snapshot
type, no parallel mechanism.

- `src/store/historyStore.ts:22` — new `TransportSnapshot = { loopEnabled; loopOn }`, with the
  reason it exists (a swap has to be able to reverse what it resets).
- `src/store/historyStore.ts:40` — `DocumentVerb` gains `transport: TransportSnapshot`
  (required, so no producer can forget it).
- `src/store/arrangementStore.ts:454` — the arm is captured BEFORE the reset; that is the
  inverse's `transport`.
- `src/store/arrangementStore.ts:503-508` — `setArrangement(arr, { transport })` applies an
  asked-for arm through `setLoopEnabled`, so the executor hears it too, not just the store.
  Omitted, the reset stands: **plain `setArrangement` still resets the loop, unchanged.**
- `src/store/arrangementStore.ts:516-520` — the recorded forward verb carries the arm the
  document actually landed with, read back from state at record time.
- `src/store/arrangementStore.ts:887-923` — the driver passes `item.verb.transport` back
  through on replay.
- `src/rigs/buildRig.ts:130-136` — the rig asks for `transport: { loopEnabled: true,
  loopOn: false }` in the same call instead of a separate `setLoopEnabled(true)` after it.
- `src/rigs/buildRig.ts:121-129`, `src/rigs/buildRig.ts:11-16` and `docs/shell.md:234-242` —
  the prose now describes what ships. The `installRig` JSDoc also states that **`Ctrl+Z` of a
  rig stops the transport** — that is intended: taking the Song back is a document swap and
  the song that was playing is gone.

New tests:
- `src/rigs/__tests__/rigs.test.ts:226` *brings the loop back ARMED when the player redoes the
  rig*.
- `src/rigs/__tests__/rigs.test.ts:236` *gives the player back the loop switch they had, armed
  or not* — runs the whole install/undo cycle for both pre-install states.
- `src/store/__tests__/historyStore.test.ts:149` — *resets the loop arm on an ordinary document
  open, and carries it on a preserved swap* — pins the unchanged law and the new one together.

Measured red on the old behaviour: dropping the `transport` argument from `buildRig.ts` →
**3 failed** (`installs the beat rig's song and arms the loop`, and both new ones). Restored.

## FU1 + F3 — the driver applies in the order recorded

`src/store/arrangementStore.ts:887-923`. One pass over the items: consecutive arrangement
`Verb`s accumulate into a batch (still one `applyVerbs`, one re-publish), and the batch is
flushed **before** each `document` item and once at the end. That is correct in both
directions — forward `[doc, ...verbs]` applies the doc first; on undo `record` prepends
inverses, so the same entry arrives as `[...invVerbs, doc(old)]` and the restore lands last,
after verbs that still belong to the song being taken away. The old two-pass "documents
first" loop would have restored the old song and then edited it with the wrong verbs. The
comment now states that constraint instead of the forward-only rule.

`src/store/__tests__/historyStore.test.ts:112` replaces the old ordering test with *applies a
swap and the verbs around it in the order they were recorded*: one entry, a tempo witness per
direction — undo must leave the restored document at 120 bpm (document-first would stamp the
inverse's 100 bpm on the player's own song), redo must reach 132 (verbs-first would apply it
to the outgoing document and then throw it away, landing on 120). Measured red on the old
behaviour: removing the flush-before-swap → `expected 100 to be 120`, exactly the undo leg.

## F2 + FU6 + FU2 — `menuCategories.test.ts`

- `:63` — `keyboard-key`'s reason is now *"dead type — nothing produces one: the keyboard
  container mints a single keyboard-visual with 31 per-key PORTS; deletion candidate
  (covenant #8)"*, and the entry moved into the legacy/deletion-candidate block with a comment
  saying why its case is stronger than the five voices (they at least deserialize from old
  saves). The old reason told the next author the keyboard mints them, so nobody would ever
  have deleted it.
- `:53-57` — `instrument`'s reason drops "agent": the agent's add-a-node vocabulary IS
  `menuCategories` (`ai/graphAdapter.ts`), so it cannot place `instrument` either. Only the
  rigs do.
- `:88-97` — new `registeredTypes = Object.keys(nodeDefinitions) as NodeType[]`, exhaustive by
  `Record<NodeType, NodeDefinition>`; the totality guard (`:114`) and the INTERNAL_ONLY
  staleness guard (`:131`) now walk that instead of the hand-maintained `KNOWN_PLUGIN_IDS`.
- `:123` — new test *keeps KNOWN_PLUGIN_IDS equal to the registry, so the hand list cannot
  drift*, so the runtime id list cannot silently fall behind the union either.

## FU4 — `preserveHistory` outside a gesture: documented, not asserted

`src/store/arrangementStore.ts:245-266`. **Documented.** Asserting an open gesture would make
`historyStore.test.ts`'s *keeps the log, and records the swap* test illegal — that test reads
the recorded verb/inverse pair straight off the top-level entry, which is only possible
because a no-gesture call mints its own standalone `Load song` / `Close song` entry. The JSDoc
now says so, and says no production caller does it today (`installRig` always brackets).

## FU5 — the tautology is gone

`src/components/__tests__/BundlePortGroup.test.tsx:66` is now the last assertion; the stubbed
`clientWidth`/`scrollWidth` block that asserted `90 <= 90` is deleted. The four CSS assertions
are the whole value of the file.

## FU8 — report corrections

Applied above, in place: **16** exemptions not 14; **4** story-id moves not 5 (Button held);
the committed `component-map.json` was already POSIX-relative, so the new test guards a
*Windows regeneration* rather than having been red on `HEAD`; `BundlePortGroup.test.tsx` is a
net-new file in commit terms, not a move; and the "true for any ordering" ordering claim and
the "leaves the loop switch where the player last put it" claim are marked corrected.

## Verification (P10b, from the worktree root)

| Command | Result |
|---|---|
| `bun run test:run -- src/engine src/store src/rigs src/components/__tests__` | **38 files, 391 tests, 0 fail** (11.9s) |
| `bunx tsc --noEmit -p tsconfig.app.json` | **clean, exit 0** — zero errors anywhere, other lanes included (the review's FU9 `SKY_HEIGHT` error is no longer present) |
| `bunx eslint src/engine src/store src/rigs` | **clean** (exit 0; also clean with `src/components/__tests__` added) |
| `bun run test:cli` | **52 pass, 0 fail**, 163 expects, 10 files |
| `git diff --check -- <P10b files>` | **clean** (exit 0) |

Still not verified: **no audio, no browser.** The two feel changes are now pinned by tests but
have never been heard — a redone beat rig looping, and `Ctrl+Z` of a rig stopping the
transport. FU3's human pass is still owed. FU7 (deleting `keyboard-key` and the five legacy
voices) remains an owner call with a save-file cost.
