# W6-P10 — adversarial review

**Verdict: COMMIT-AFTER-FIXES.**

The substance is right and the tests are unusually good. The blockers are all the same
species, and it is the sharpest possible one for *this* lane: **item 3 of the lane is
"stale comments that described behaviour that no longer exists" — and the lane ships three
new comments that are false against its own code.** Two of them are factual claims about
what a performer will feel. None require a behaviour change; all four fixes are text.

---

## Gates (all run from the worktree root)

| Command | Result |
|---|---|
| `bun run test:run -- src/engine src/store src/rigs src/components/__tests__ scripts/oj` | **38 files, 387 tests, 0 fail** (11.8s) |
| `bunx tsc --noEmit -p tsconfig.app.json` | **1 error — NOT this lane**: `src/components/Arrangement/ArrangementSurface.tsx(45,7): TS6133 'SKY_HEIGHT' is declared but its value is never read`. Zero errors in any W6-P10 file. |
| `bunx eslint src/engine src/store src/rigs scripts/oj` | **clean** (exit 0) |
| `bun run test:cli` | **52 pass, 0 fail**, 163 expects, 10 files |
| `git diff --check -- <lane files>` | **clean** (exit 0); no trailing whitespace in the 3 new files either |
| `bun scripts/oj/index.ts doctor --check node-registry` | **PASS** — 36 NodeTypes coupled cleanly |
| `bun scripts/oj/index.ts doctor --check test-collection` | **PASS** — 239 test files, exactly one runner each |

---

## Claim 1 — `pan`/`width` reachable; the invariant is total

**Reachability: VERIFIED, all three surfaces.**
- `src/components/CommandBar/useCommandSources.ts:98-105` — `buildNodeActions()` is
  `new Set(menuCategories.flatMap(c => c.items))`, one `node.add.<type>` Action each,
  `group`/`path[0]` = `CATEGORY_LABEL[def.category]` (lines 41-49).
- `src/components/Canvas/ContextMenu.tsx:77-96` — never touches the registry; groups the
  same Actions by `action.path?.[0] ?? action.group`, orders by `CATEGORY_ORDER` (bucket
  names). So the bucket↔`category` agreement the lane asserts is genuinely load-bearing.
- `src/ai/graphAdapter.ts:167-194` — `listAddableNodeTypes()` walks `menuCategories`. The
  agent's vocabulary is the same list. Confirmed.
- `registry.ts:906` — `items: ['effect', 'pan', 'width']`. `pan`/`width` declare
  `category: 'effects'`, so the bucket-agreement test passes on them.

**Totality: VERIFIED arithmetically, but total by *convention*, not by construction.**
`KNOWN_PLUGIN_IDS` = 36 ids. `menuItems` = 5+4+1+3+5+2 = 20. `INTERNAL_ONLY` = 16. 20+16=36,
disjoint (test 4 asserts disjointness + no stale ids + reason length > 20). Sound today.
The gap: the test iterates `KNOWN_PLUGIN_IDS`, which is a *hand-maintained array*
(`types.ts:214`, `satisfies readonly NodeType[]` only proves members ⊆ union, never ⊇).
Nothing in the repo asserts `KNOWN_PLUGIN_IDS === NodeType`. A new type added to the union
+ `nodeDefinitions` but forgotten in `KNOWN_PLUGIN_IDS` is invisible to this guard — the
exact "second list" the file's own comment forbids. See fix F4 (one line).

**Exemption spot-checks — 15 of 16 truthful, 1 FALSE.**

| Exemption | Verdict | Evidence |
|---|---|---|
| `instrument-visual` / `midi-visual` / `minilab3-visual` / `sampler-visual` "synthesised on enter" | ✅ | `utils/nodeInternals.ts:451 / 777 / 1093 / 1225` each mint that node inside `createDefaultInternalStructure` (`:173-208`). |
| `canvas-input` / `canvas-output` "interior handle for a parent port" | ✅ | `nodeInternals.ts:524 / 541`, plus `utils/portSync.ts:553` re-mints `canvas-output` on port sync. |
| `input-panel` / `output-panel` "a container creates for itself" | ✅ | `nodeInternals.ts:150, 324, 424, 579` + the keyboard's own output panel. |
| `minilab-3` "picked in the MIDI browser" | ✅ | only producer is `components/controls/MIDIDeviceConfig.ts:214`. |
| `instrument` "placed by rigs/agent, fronted by strings\|keys\|winds" | ⚠️ half-true | rigs ✅ (`rigs/presets.ts:78,126,184`, `rigs/beatSong.ts:92`). "**agent**" ❌ — the agent's vocabulary *is* `menuCategories` (`graphAdapter.ts:176`), so the agent specifically **cannot** place `instrument`. Cosmetic; not gated. |
| `piano`/`cello`/`electricCello`/`violin`/`saxophone` "load-only" | ✅ | only `type: 'x'` occurrences are the registry defs + tests. Nothing mints them. |
| **`keyboard-key`** "one key inside a keyboard container; **the keyboard mints its own**" | ❌ **FALSE** | see below |

**The `keyboard-key` falsehood is confirmed, and the lane repeats it verbatim.**
`nodeInternals.ts:228 createKeyboardInternals()` mints exactly two nodes: one
**`keyboard-visual`** carrying 31 per-key output **ports** (`:233-268`) and one
`output-panel`. It never creates a `keyboard-key` node. Full-repo audit of
`type: 'keyboard-key'` / `'keyboard-key'`: `registry.ts:68`, `types.ts:157,216`,
`emit.ts:125` (a `STRUCTURAL_TYPES` membership list), `scripts/oj/checks/node-registry.ts:275`
(a `PURELY_VISUAL` membership list), and tests. **Nothing in the app produces a
`keyboard-key` node.** It is a dead type — which is a *stronger* covenant-#8 case than the
5 legacy voices the lane did flag (those at least deserialize from old saves; this one has
never had a producer). The exemption reason as written tells the next author the keyboard
mints them, so nobody will ever delete it. Fix F2.

---

## Claim 2 — rig install is ONE history entry, Song included

**The core fix is real and correct.** At `HEAD`, `installRig` committed the gesture and then
called the plain `setArrangement`, whose `useHistoryStore.getState().clear()` wiped the
entry it had just made — the beat rig genuinely was un-undoable. Moving the swap inside the
bracket with `preserveHistory: true` is the right shape.

**Re-entrancy: SAFE.** `dispatch` sets `applyingHistory` around all drivers
(`historyStore.ts:46-53`); the driver's `setArrangement(..., {preserveHistory:true})` hits
the `if (isApplyingHistory()) return;` guard at `arrangementStore.ts:493` *after* the
`set(...)`, so state lands and nothing re-records. Pinned by the 3-cycle test
(`rigs.test.ts:190-205`, `entries.length === 1 && cursor === 1` every loop). Green.

**null→song and song→null: both covered.** `previous = get().arrangement` is captured before
the `set`, so the inverse is `{arrangement: null}` for the first case
(`rigs.test.ts:170-186`) and the whole previous document for the second
(`rigs.test.ts:188-...`, `toEqual(structuredClone(previous))`). Undoing to `null` re-enters
via `preserveHistory` and therefore does **not** clear the log. Correct.

**Ordering: works today, but the comment and the report overclaim it, and the direction
argument is wrong.** `record` appends `verbs` and *prepends* `inverse`
(`historyStore.ts:94`), so a rig entry is `verbs=[...graph, doc]`, `inverse=[doc, ...graph]`.
The driver's forced document-first loop (`arrangementStore.ts:865-872`) is right for the
forward direction: a snapshot must land before any `Verb` that edits it. **It is the exact
opposite of right for the inverse direction.** For a hypothetical entry that records a
document swap and *then* arrangement `Verb`s against the new song, the inverse is
`[...invVerbs, doc(old)]`, and the correct undo order is *verbs first, document restore
last*. Forcing document-first there would restore the old song and then apply the inverse
verbs against the wrong document. The comment's claim ("any `Verb`s in the same step edit
the document the swap left behind") and the report's claim ("the driver's explicit
document-first loop is what makes it true for **any** ordering") are both false in the undo
direction. It is latent, not live — the sole producer records the document verb *last* in
the gesture and contributes no arrangement `Verb`s — but `historyStore.test.ts:98-127`
*enshrines* the rule rather than the constraint that makes it safe. Fix F3 (comment) +
follow-up FU1 (make the driver order-preserving, which is correct in both directions and no
more code).

**`preserveHistory` with no gesture open: creates a stray standalone entry.** Not
hypothetical — the lane's own `historyStore.test.ts:93` does exactly that and asserts the
resulting top-level entry. Harmless today (one production call site, always inside
`beginGesture`), but the JSDoc at `arrangementStore.ts:252-255` documents only the
in-gesture case. Non-blocking; noted as FU2.

**Other `setArrangement` callers: I grepped all of them; none should change.** Every one is
a genuine document open/close where clearing the log is the law:
`components/Shell/AppMenuBar.tsx:138, 209, 266` (open project / import), 
`persistence/recovery/useCrashRecovery.ts:83, 175` (boot restore, Safe Mode recover),
`store/projectStore.ts:794` (close project → `null`),
`components/Arrangement/ArrangementSurface.tsx:235-247` (the four "Start from …" starters),
`test/e2eBridge.ts:63`. None runs inside an open gesture; none is now wrongly clearing. The
`pi-openjammer-graph/`, `src/ai/**` and collab paths speak `Verb`/`GraphVerb`, never
`EditVerb` — the report's claim there checks out (no exhaustive `switch` on `domain`
anywhere; both drivers filter by type-guard, so the third arm is inert for the graph driver
by construction).

**Transport / loop arm on redo — the report's own statement of it is factually wrong, and
my judgement is that the underlying gap is a real (small) perceptible bug.**
`setArrangement` hard-resets `loopOn: false, loopEnabled: false` (`arrangementStore.ts:477-478`)
on *every* call, including the driver's. So:
- The comment at `buildRig.ts:122-123` and `docs/shell.md:238-239` — "a redo restores the
  Song but **leaves the loop switch where the player last put it**" — is **false**. The redo
  forces the loop **OFF**, whatever the player had. Fix F1.
- The behaviour: `installRig` arms the loop; redo of `installRig` does not. **Redo does not
  reproduce the do.** For this specific rig that is audible — the beat rig's whole identity
  is a looping one-bar pattern, so a redone beat rig plays one bar and stops. Ctrl+Y giving
  you a different sound than the action it replays is the kind of thing a performer reads as
  "the app lost my patch". I do **not** gate on it (transport genuinely lives outside the
  log everywhere, and the fix is a design call about whether a document that declares a loop
  location should arm on load), but "acceptable" is too generous: log it for the owner with
  audio playing. FU3.
- Related and also new: **Ctrl+Z after a rig now stops the transport**, because the undo
  routes through `setArrangement` (`isPlaying: false`, `playheadTick: 0`, `stopPreview()`).
  Previously undo left playback alone. Correct-by-argument (the song is gone), but it is a
  new thing a performer feels mid-set. Same human pass. FU3.

**Snapshot aliasing (low risk, noted):** the inverse holds a *reference* to the previous
arrangement, not a clone. Safe as long as arrangement mutation stays immutable — the driver
does `const { next } = applyVerbs(...)` and `setState({ arrangement: next })`, and
`normalizeArrangement` returns a new object, so it holds. Worth a line in the `DocumentVerb`
docblock if anyone ever adds an in-place edit.

---

## Claim 3 — `instrument` → `ui: 'react'`

**VERIFIED, including that it was red on HEAD.** `git show HEAD:src/components/Nodes/NodeWrapper.tsx`
already has `'instrument'` in `SCHEMATIC_TYPES` (line 78) and `case 'instrument':` →
`<InstrumentNode>` (line 490), from commit `ab23a31`. `registry.ts` at HEAD declared
`ui: 'auto'`. The `node-registry` doctor gate couples exactly those two, so `bun run test:cli`
was genuinely failing on arrival and is green now (52/52, doctor PASS, 36 types coupled).

**Nothing else consumed `ui: 'auto'` for `instrument`.** The only runtime readers of `ui` are
`engine/manifest.ts:334` (`return def.ui ?? 'auto'`, the derivation) and
`NodeWrapper.tsx:575` (`dynManifest.ui`, dynamic plugin path only) / `:593` (`manifest.ui`
inside `renderNodeContent`'s `default:` arm). `instrument` is dispatched by the *schematic*
switch at `:490`, which `return`s before `renderNodeContent` is ever reached — so the change
is render-neutral and manifest-correct. No docs reference `instrument`'s `ui`. Correct call.

---

## Claim 4 — `scripts/oj/design.ts` + `component-map.json`

**`repoRelative`: correct on both platforms.** `relative(ROOT, file).split(sep).join('/')` —
on POSIX `sep === '/'` so the split/join is an identity; on Windows it converts the
backslashes `relative` returns. The docblock's diagnosis of the old bug is accurate: `ROOT`
comes from `join` (`design.ts:16`), so the literal `` `${ROOT}/` `` prefix could never match
a Windows path. Only `codePath` (`:156`) carries a path, and `githubUrl` (`:164`) is glued
from it, so the one change fixes both. `figmaUrl` carries none. ✓

**`states` preference: deterministic.** `isOverview` = `id.split('--').slice(2).join('--') === 'states'`
(handles `--` inside a variant); `choose` only upgrades `undefined → any` or
`non-states → states`, over a `.sort()`ed key list, so a second `states` story never
displaces the first. ✓ Agreed with the design decision: the map is a link target for Figma
reviewers and `states` is the canonical overview.

**`component-map.json`: 53 / 53 / 53, and clean.** Independently confirmed:
`grep -c '\\\\'` → **0**, `grep -c '"codePath": "[A-Za-z]:'` → **0**,
`grep -c '"codePath": "/'` → **0**; the new test's `existsSync` leg passes for all 53, so
every `codePath` resolves. `withStory` 48 → 53.

**The new test is non-vacuous** — it does real fs resolution (`existsSync(join(ROOT, codePath))`),
a real `githubUrl.endsWith('/' + codePath)` cross-check, and a real counts-match check. It is
`bun:test` under `scripts/oj/__tests__`, so `test-collection` still sees exactly one runner
(PASS, 239 files).

**Report inaccuracies here (not defects in the code):**
- "On the old code every entry was an absolute `C:\Users\...\Button.tsx` and all four of the
  first test's conditions fire at once." The **committed** map was already repo-relative
  POSIX (the `codePath` lines are untouched in the diff) — it was generated on POSIX, where
  the old code worked. The failure only materialises on a Windows *re*-generation. The fix
  is still worth having, but the "proven to fail on the old code" framing is not what the
  diff shows.
- "5 story-id moves, 4 of them the new preference": the diff has **4** moves (KeyTile,
  Swatch, WaveformView, ProgressBar) + 5 `null`→story. Button is listed as a "move" but did
  not change.
- The ProgressBar `levels → indeterminate` wobble is correctly diagnosed: it is the sorted
  fallback, and the old code would have done the same. Not a regression from this lane.

---

## Claim 5 — `BundlePortGroup.test.tsx`

**Not a duplicate.** `grep -rn "190px"` over `src` returns `PortPanelNode.css:27,28` (the
rule), three *comments* in `CanvasIONode.css:14` / `MathNode.css:12` / `PortPanelNode.css:14`
that reference the shared floor, and this test. `minmax(90px` appears only in
`BundlePortGroup.css:19` and the test. It is the only assertion of either rule. KEEP is right.

**Runs under the include globs.** `vitest.config.ts` include is
`src/**/*.{test,spec}.{…,tsx}` — `src/components/__tests__/BundlePortGroup.test.tsx` matches;
it ran in my scoped pass (`✓ src/components/__tests__/BundlePortGroup.test.tsx (1 test) 53ms`).

**Correction to the report's framing:** this is **not a move in commit terms**. The old
colocated path was never in git (`git ls-files | grep -i bundleportgroup` → only the `.css`
and `.tsx`; `git show HEAD:src/components/BundlePortGroup.test.tsx` → nothing). It was an
untracked artefact of an earlier uncommitted run of this same lane. The commit sees one
**net-new** test file, which is fine — but the diff does not contain the relocation the
report describes, and the "repo's only colocated test" claim was true of the working tree,
not of `HEAD`.

**One defect in it: the last assertion is a tautology.** Lines 70-74 stub
`clientWidth = 90` and `scrollWidth = 90` onto the element and then assert `90 <= 90`. It
cannot fail for any state of the code under test. Covenant #8 ("every production line is
used") applies to test lines that can never go red. Fix F5 — delete it; the four CSS
assertions above it are the whole value of the file and they are good.

---

## Claim 6 — the comment rewrites

| Rewrite | Verdict |
|---|---|
| `registry.ts:479-487` (`instrument` → `ui:'react'`) | ✅ accurate — `SCHEMATIC_TYPES:78`, `case 'instrument':490`, `manifest.ts:334` derivation, doctor gate all check out. |
| `registry.ts:871-888` (`menuCategories` docblock) | ✅ accurate — both surfaces and the agent verified above; the palette-groups-by-`category` / menu-orders-by-bucket-name asymmetry is real (`useCommandSources.ts:105` vs `ContextMenu.tsx:77`). |
| `arrangementStore.ts:244-256` (`setArrangement` JSDoc) | ✅ accurate for what it says; silent on the no-gesture case (FU2). |
| `arrangementStore.ts:865-868` (driver document-first) | ❌ **overclaims** — correct for redo, wrong for undo. F3. |
| `buildRig.ts:122-123` + `docs/shell.md:239` (loop on redo) | ❌ **false** — `setArrangement` forces `loopEnabled:false`. F1. |
| `menuCategories.test.ts:43` (`keyboard-key`) | ❌ **false** — nothing mints one. F2. |
| "checked and found NOT stale" list | ✅ spot-checked the per-key-ports one (`registry.ts:100-111`): `keyboard-visual` top-level has 4 ports (rows + pedal), `createKeyboardInternals` mirror keeps 31. Accurate. |

Also: the report says "**The 14 exemptions**" — `INTERNAL_ONLY` has **16** entries (4+5+1+1+5).
The table under it lists all 16. Report-only arithmetic slip.

---

## Claim 8 — taste / lean

Good on the whole. No dead code, no duplicated logic, no forked path: the lane *extended*
`EditVerb` with a third arm rather than adding a parallel document-history mechanism, kept
one producer for it, and documented the boundary. `historyStore.ts`'s `DocumentVerb` docblock
naming its own containment ("ordinary timeline editing must keep using `Verb`s") is exactly
right for a snapshot verb in a log of deltas. `design.ts`'s `isOverview` + `choose` is two
lines where a lesser version would have been a config map.

Two things that should have been simpler:
- The `BundlePortGroup` tautology above (F5).
- `historyStore.test.ts:98-127` deliberately constructs an entry whose shape the production
  code cannot produce, in order to pin a rule that is only half-right. Once FU1 lands
  (order-preserving driver) that test becomes "applies items in the order recorded", which is
  both simpler and true in both directions.

Comment bloat: borderline but I'd let it stand. `buildRig.ts:112-123` is 12 lines of comment
for 4 lines of code, and `menuCategories.test.ts` opens with 20 lines of preamble — but this
is the covenant's own bargain (value #5, docs are part of the feature) and every paragraph
earns itself except the one that is wrong.

---

# Required fixes

**F1 — the loop-on-redo claim is false.** `setArrangement` sets `loopOn: false, loopEnabled: false`
(`src/store/arrangementStore.ts:477-478`) on every call, including the history driver's, so a
redo forces the loop OFF; it does not preserve the player's switch.

- `src/rigs/buildRig.ts:122-123` — replace
  `// follow the swap. A redo restores the Song but leaves the loop switch` /
  `// where the player last put it.`
  with
  `// follow the swap. NOTE the asymmetry this leaves: a redo restores the Song`
  `// but NOT the arm — 'setArrangement' resets 'loopEnabled' to false, so a`
  `// redone beat rig plays its bar once instead of looping. Owner call.`
- `docs/shell.md:238-239` — replace `so a redo restores` / `the Song and leaves the loop switch where the player last put it.`
  with `so a redo restores the Song but NOT the arm: `setArrangement` resets the loop to off, and a redone beat rig plays its bar once instead of looping.`

**F2 — `keyboard-key`'s exemption reason is false.**
`src/engine/__tests__/menuCategories.test.ts:43` — replace
`'keyboard-key': 'one key inside a keyboard container; the keyboard mints its own',`
with
`'keyboard-key': 'legacy per-key generator — NOTHING mints one: a keyboard container's interior is a single keyboard-visual with 31 per-key ports (nodeInternals.createKeyboardInternals). Dead type; deletion candidate (covenant #8)',`
and move the line out of the "Parts a container builds" block into the legacy block at
`:52-66`, since it belongs with the other deletion candidates.

**F3 — the driver's ordering comment is right for redo and wrong for undo.**
`src/store/arrangementStore.ts:865-868` — replace the four comment lines with the constraint
that actually makes it safe, e.g.:
```
// Document swaps first. A snapshot must land before any `Verb` that edits it,
// which is right for the FORWARD direction. It is safe on undo only because the
// sole producer (`installRig`) records the document verb LAST in its gesture —
// `record` prepends inverses, so the restore is already first in the inverse.
// An entry that MIXED a document swap with arrangement `Verb`s would need
// order-preserving application: on undo the restore has to come LAST.
// `setArrangement` no-ops its own recording while history is applying, so this
// cannot re-enter the log.
```
Also drop the "makes it true for any ordering" sentence from the report if it is being kept
as a record.

---

# Non-blocking follow-ups

- **FU1 — make the driver order-preserving** (`src/store/arrangementStore.ts:863-880`). Walk
  `verbs` once, flushing the pending arrangement batch before each `document` item instead of
  running two passes. Correct in both directions, no more code, and it retires F3's caveat
  and simplifies `historyStore.test.ts:98-127`.
- **FU2 — make the totality guard total by construction.**
  `src/engine/__tests__/menuCategories.test.ts:96` — iterate
  `(Object.keys(nodeDefinitions) as NodeType[])` instead of `KNOWN_PLUGIN_IDS`.
  `nodeDefinitions: Record<NodeType, NodeDefinition>` makes that set exhaustive by the type
  system; `KNOWN_PLUGIN_IDS` is a second hand-maintained array with nothing asserting it
  covers the union. (Or add a one-line set-equality assertion between the two.)
- **FU3 — human pass with audio, on the two feel changes item 2 introduces.** (a) Redo of a
  beat rig no longer loops (F1's underlying behaviour) — decide whether a document that
  declares a loop location should arm on load. (b) Ctrl+Z after a rig now stops the
  transport, which it did not before. Per the covenant, green CI is not sign-off on feel.
- **FU4 — document `preserveHistory` outside a gesture.** `arrangementStore.ts:252-255` — it
  mints a standalone `Load song` / `Close song` entry (the lane's own
  `historyStore.test.ts:93` relies on that). Unreachable in production today; say so, or
  assert an open gesture.
- **FU5 — delete the tautological assertion.** `src/components/__tests__/BundlePortGroup.test.tsx:68-74`
  stubs both `clientWidth` and `scrollWidth` to 90 and asserts `90 <= 90`. Cannot fail.
- **FU6 — `instrument`'s exemption reason says "rigs/agent"**
  (`menuCategories.test.ts:57`); the agent reads `menuCategories` and therefore cannot place
  it. Drop "agent".
- **FU7 — covenant #8 candidates for the owner:** `keyboard-key` (no producer at all —
  stronger case than the 5 legacy voices the lane flagged), plus
  `piano`/`cello`/`electricCello`/`violin`/`saxophone`. Save-file cost, owner call.
- **FU8 — report corrections** (if the report is kept as the lane record): 16 exemptions not
  14; 4 story-id moves not 5; the committed `component-map.json` was already POSIX-relative,
  so the new test would not have gone red on `HEAD` — only on a Windows regeneration; and the
  `BundlePortGroup` "move" is a net-new file in commit terms.
- **FU9 — pre-existing, other lane:** `bunx tsc --noEmit` fails on
  `src/components/Arrangement/ArrangementSurface.tsx:45` (`SKY_HEIGHT` unused). Whoever owns
  the `SkyBand` work needs to clear it before the branch is green.
