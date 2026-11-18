# W6-P11 — adversarial review

**Reviewer:** gate agent · **Date:** 2026-08-29 · **Branch:** `t3code/openjammer-redesign-timeline`
**Lane:** collapse five legacy instrument alias types into `instrument` (load-time migration);
delete the dead `keyboard-key`; fix the NodeWrapper ghost-port list.

## VERDICT: **COMMIT-AFTER-FIXES**

Two fixes, both small. One is a real **fifth document seam the lane missed and explicitly
claimed does not exist** — the persisted clipboard. One is commit hygiene (`Cargo.lock`).
Everything else in the lane holds up: the deletions are complete, the family-preservation
claim is true (I recomputed it by hand, not just by running the lane's test), all four named
seams are correctly wired and correctly ordered, and every gate is green on my machine.

---

## 0. What I consider P11's file set

`git status --short`, minus the concurrent lanes' paths named in the brief:

**Modified (P11):**
`README.md` · `apps/docs/src/content/docs/play/first-patch.mdx` · `docs/assets/README.md` ·
`docs/creating-nodes.md` · `docs/node-standards.md` · `docs/voice-engine.md` ·
`plans/redesign-new-dna/COVERAGE.md` · `plans/redesign-new-dna/MASTER-PLAN.md` ·
`scripts/oj/checks/node-registry.ts` · `scripts/oj/__tests__/node-registry.test.ts` ·
`src/audio/defaultInstrument.ts` · `src/audio/__tests__/defaultInstrument.test.ts` ·
`src/audio/__tests__/voiceSynth.test.ts` · `src/audio/ojgraph/emit.ts` ·
`src/audio/ojgraph/noteRouting.ts` · `src/audio/ojgraph/__tests__/emit.test.ts` ·
`src/collab/graphStoreBridge.ts` · `src/components/Nodes/InstrumentNode.tsx` ·
`src/components/Nodes/NodeWrapper.tsx` ·
`src/components/Nodes/__tests__/NodeWrapper.reconnect.test.tsx` ·
`src/components/Nodes/__tests__/portDomContract.test.tsx` · `src/engine/manifest.ts` ·
`src/engine/registry.ts` · `src/engine/serialization.ts` · `src/engine/types.ts` ·
`src/engine/__tests__/{manifest,menuCategories,serialization,socketGeometry}.test.ts` ·
`src/midi/routing/__tests__/MIDIVoiceRouter.test.ts` · `src/store/graphStore.ts` ·
`src/store/__tests__/{actionRegistry,graphStore}.test.ts` · `src/utils/bundleManager.ts` ·
`src/utils/nodeInternals.ts` · `src/utils/portPositions.ts` · `src/utils/portSync.ts` ·
`src/utils/__tests__/bundleConnections.test.ts`

**New (P11):** `src/engine/nodeTypeMigrations.ts` ·
`src/engine/__tests__/nodeTypeMigrations.test.ts` ·
`plans/redesign-new-dna/W6-P11-REPORT.md`
(+ gitignored evidence in `plans/redesign-new-dna/.scratch/w6-p11/` — confirmed ignored by
`plans/redesign-new-dna/.gitignore:1`, so it will not be committed.)

**Also dirty, and NOT P11's:** `Cargo.lock` (see FIX 2). `src/components/Nodes/w5p7Faceplates.test.tsx`,
`src/store/editingContextStore.ts`, `src/utils/audioMetadata.ts`,
`src/components/Arrangement/**`, `src/components/PianoRoll/**`, `src/components/Clips/**`,
`docs/timeline.md`, the `W4-TB*` / `W5-P7*` reports and `.scratch/{w5-p7,w5-s5}` belong to the
concurrent lanes; I ignored them.

---

## FIX 1 (blocking) — the FIFTH seam: the persisted clipboard

**This is the one substantive finding.** The report §2 and the module docblock of
`src/engine/nodeTypeMigrations.ts` (lines 26–41) both assert there are exactly four seams and
that "everything else is covered *because* it funnels into one of those four." That is false.

The graph store's persist config (`src/store/graphStore.ts:1916-1918`) declares only `name`
and a fully custom `storage` — **there is no `partialize`**. `setItem`
(`graphStore.ts:2017-2032`) therefore serializes `...value.state`, which includes
`clipboard: ClipboardData | null` (`graphStore.ts:128`), whose `nodes` field is a plain
`[string, GraphNode][]` array that JSON round-trips perfectly. `getItem`
(`graphStore.ts:1998-2008`) returns `...parsed.state` — the clipboard comes back **verbatim,
un-migrated**. `pasteClipboard` (`graphStore.ts:1688-1702`) then does
`{...structuredClone(node), id: newId, position}` — `type` is carried through untouched.

Repro: copy a Cello node (Ctrl+C) → reload → Ctrl+V. A `type: 'cello'` node lands on the
canvas, resolves to `MISSING_DEFINITION`, and renders as an inert Unknown stub with no voice
picker. It self-heals on the *next* reload (it is now in `nodes`, which is migrated), but the
session in between shows exactly the failure this lane exists to prevent.

**Evidence this is real, not theoretical:** the lane's own browser artifact
`plans/redesign-new-dna/.scratch/w6-p11/legacy-save.json` has
`state` keys `['nodes','connections','connectionsByNode','rootNodeIds','selectedNodeIds','selectedConnectionIds','version','clipboard']`
— `clipboard` is written to localStorage by the very autosave the lane is protecting.

### The change

**File `src/store/graphStore.ts` — insert immediately before line 1998 (`return {`):**

```ts
                        // SEAM 5: the CLIPBOARD is persisted too — this store has
                        // no `partialize`, so `setItem` writes the whole state.
                        // A node copied before P11 comes back as a legacy type and
                        // `pasteClipboard` clones `type` verbatim, so Ctrl+C then
                        // reload then Ctrl+V would paste an inert Unknown stub.
                        const rawClipboard = parsed.state.clipboard as
                            | { nodes?: unknown; connections?: unknown }
                            | null
                            | undefined;
                        const clipboard = rawClipboard && Array.isArray(rawClipboard.nodes)
                            ? {
                                ...rawClipboard,
                                nodes: (rawClipboard.nodes as [string, GraphNode][]).map(
                                    ([nodeId, node]) =>
                                        [nodeId, migrateLegacyInstrumentNode(node)] as [string, GraphNode],
                                ),
                            }
                            : rawClipboard ?? null;
```

**and add `clipboard,` to the returned state object — `graphStore.ts:2006`, after
`selectedConnectionIds`:**

```ts
                                selectedConnectionIds,
                                clipboard
```

**File `src/engine/nodeTypeMigrations.ts` — line 27, change `four` → `five`, and after the
seam-1 bullet (line 30) insert:**

```
 *   1b. `store/graphStore` persist `storage.getItem` — the persisted CLIPBOARD.
 *       The graph store has no `partialize`, so a copied node is written to
 *       localStorage with the rest of the state and `pasteClipboard` clones its
 *       `type` verbatim.
```

**File `src/store/__tests__/graphStore.test.ts` — add one case in the same `describe` as the
two new migration tests (after the `loadGraph` test that ends at :283):**

```ts
        it('migrates a legacy node sitting in the PERSISTED CLIPBOARD', () => {
            // The graph store has no `partialize`: `setItem` writes `clipboard`
            // alongside `nodes`, and `pasteClipboard` clones `type` verbatim.
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                state: {
                    nodes: [], connections: [],
                    clipboard: {
                        nodes: [['c-1', {
                            id: 'c-1', type: 'cello', category: 'instruments',
                            position: { x: 0, y: 0 },
                            data: { offsets: { 'input-1': -12 } },
                            ports: [], parentId: null, childIds: [], specialNodes: [],
                        }]],
                        connections: [],
                    },
                },
            }));
            const storage = (useGraphStore as unknown as { persist: { getOptions: () => { storage: { getItem: (n: string) => unknown } } } }).persist.getOptions().storage;
            const result = storage.getItem(STORAGE_KEY) as {
                state: { clipboard: { nodes: [string, { type: string; data: Record<string, unknown> }][] } }
            };
            const [, pasted] = result.state.clipboard.nodes[0];
            expect(pasted.type).toBe('instrument');
            expect(pasted.data.instrumentId).toBe('gm-cello');
        });
```

**File `plans/redesign-new-dna/W6-P11-REPORT.md` — §2 heading "one map, four seams" → "one
map, five seams"; add the clipboard row to the seam table; delete the sentence "There is no
e2e/test bridge that injects nodes" claim of exhaustiveness or qualify it. §8 risk 4 stays
accurate.**

I deliberately do **not** ask you to run `migrateNodePorts` on the clipboard: that gap
(looper `sample-out`, top-level `keyboard-visual` `key-*`, `library` `audio-out`/`trigger`)
is pre-existing and predates this lane. See follow-up FU-1.

## FIX 2 (blocking, hygiene) — `Cargo.lock` is not P11's

`Cargo.lock` is dirty in the working tree with an unrelated change: `toml_write 0.1.2` and its
`toml_edit` dependency edge removed (7 lines). It is not mentioned anywhere in the report, is
not in any excluded lane's path, and is not related to instrument aliases. Under the
orchestrator's "everything not excluded is P11's" rule it would be swept into this commit,
silently altering the Rust dependency graph inside a TypeScript node-type commit.

**Change:** do not stage `Cargo.lock` in the P11 commit. If it is stale churn, `git restore
Cargo.lock`; if it is a real intended dependency change it belongs in its own `chore(deps)`
commit with a reason.

---

## Evidence, claim by claim

### 1. Save-file safety — my own seam enumeration

I enumerated every `GraphNode[]`-from-external-JSON path myself rather than trusting §2.

| # | Path | Migrated? | Notes |
|---|---|---|---|
| 1 | `graphStore.ts:1949` persist `getItem` → `nodes` | **YES** | `migrateNodePorts(migrateLegacyInstrumentNode(node))` |
| 2 | `graphStore.ts:1998-2008` persist `getItem` → `clipboard.nodes` | **NO** | **FIX 1** |
| 3 | `graphStore.ts:1602` `loadGraph` | **YES** | |
| 4 | `serialization.ts:159` `importWorkflow` | **YES** | before `getNodeDefinition` at :160 — correct |
| 5 | `graphStoreBridge.ts:187` `applyRemoteSnapshot` | **YES** | |
| 6 | `AppMenuBar.tsx:135-136` file import | covered | `importWorkflow` → `loadGraph` (migration runs twice; idempotent, harmless) |
| 7 | `AppMenuBar.tsx:204` / `:261` open project / open recent | covered by 3 | `manifest.graph.nodes` cast **straight** to `loadGraph`, no `importWorkflow` — the lane correctly identified this |
| 8 | `useCrashRecovery.ts:82` boot restore, `:174` Safe-Mode "Recover anyway" | covered by 3 | |
| 8b | `webPayloads.validateRecoveredGraph` (`:126-138`) | n/a | **checked specifically**: validation is structural (`typeof n.id === 'string'`) and does **not** filter by node type, so a legacy node reaches `loadGraph` rather than being silently dropped. Good. |
| 9 | `projectStore.ts:390` manifest parse / `:220-262` `validateGraphData` | n/a | write + structural validation only; the read path is #7 |
| 10 | `NodeCanvas.tsx:507` canvas drop | not a seam | `handleDragOver` (`:491-497`) accepts only `application/library-item`; the payload is an audio library item. **No `.json`/`.openjammer` canvas-drop handler exists.** |
| 11 | `ai/plan.ts:130` `node.type as NodeType` from LLM JSON | not a seam | gated by `planValidator.ts:89-99` `UNKNOWN_TYPE` — fails loudly |
| 12 | `useCommandSources.buildNodeActions:97-110`, `ai/graphAdapter.ts:179-185` | follow the registry | both enumerate `menuCategories`; verified by reading, not grep |
| 13 | `scripts/oj/author.ts:127`, `scripts/oj/song.ts:52` | not a seam | parse a song **spec**; `specToGraph` builds from the registry. `scripts/oj/render.ts` never ingests `GraphNode`s |
| 14 | `e2e/` | none | zero `openjammer-graph-v2` / `openjammer-emergency` writes; the only `window.__oj*` symbols are `__ojWorkletReady` / `__ojWorkletError` (`pwa-smoke.spec.ts:103`) — no graph bridge |
| 15 | `pi-openjammer-graph/`, `public/` | none | zero hits for any deleted type |
| 16 | `historyStore` | not a seam | no `persist`, no `localStorage` — undo snapshots are in-memory only |
| 17 | `CrdtGraphProjection.ts:332` `JSON.parse` | covered by 5 | `fromCrdtNode`'s only caller in the app is the migrated `applyRemoteSnapshot`; `collab/index.ts:45` re-exports it but nothing consumes it |
| 18 | URL / share-link loader | none exists | |
| 19 | `agentSessionStore.ts:546` persist | not a seam | `partialize` keeps only `sessionId` + `messages` |

**Persist `version` bump: NO, and bumping it would be a bug.** The persist options
(`graphStore.ts:1916-1918`) are `{ name, storage }` only — there is no `version` and no
`migrate`. Introducing a `version` without a `migrate` makes zustand **discard** the persisted
state on mismatch, i.e. delete the player's autosave — the exact opposite of this lane's
purpose. The unconditional, idempotent rewrite inside the custom `getItem` is the right
mechanism.

**Order relative to `migrateNodePorts`: correct as written.** The lane runs
`migrateNodePorts(migrateLegacyInstrumentNode(node))` — type migration **first**.
`migrateNodePorts` (`graphStore.ts:34-63`) keys on `node.type` for exactly three types —
`looper` (:40), top-level `keyboard-visual` (:48-52), `library` (:56) — none of which is a
legacy alias, so today the two orders are behaviourally identical. But port rules are written
against **current** type names: the day someone adds a port rule for `'instrument'`, a saved
`piano` would escape it if the type migration ran second. First is the order that stays right.

### 2. Idempotence / purity / no timbre loss

- `migrateLegacyInstrumentNode` spreads `...node`, so `id`, `position`, `ports`, `parentId`,
  `childIds`, `specialNodes`, `pluginId` all ride through by construction; `data` becomes
  `{...data, instrumentId}` so `offsets` and `activeInputs` survive; an existing non-empty
  `instrumentId` is never overwritten. Non-legacy nodes are returned **by reference**
  (`return node` at `nodeTypeMigrations.ts:82`). All pinned by
  `nodeTypeMigrations.test.ts` (10 cases incl. by-reference identity and non-mutation).
- **`data.offsets` really is on the node, not resolved from the registry** — I checked both
  producers: `addNode` merges `data: { ...definition.defaultData, ...initialData }`
  (`graphStore.ts:319`), and `importWorkflow` uses `serialized.data` verbatim
  (`serialization.ts:170`). So `cello`'s `-12` and `violin`'s `+12` are persisted per node and
  are not lost by deleting the defs.
- **`electricCello` "saturation and chorus" was implemented nowhere.** `KIND_BY_TYPE` mapped
  it to `'Sampler'`, byte-identical to `cello` (`manifest.ts` diff). `grep -rni
  "electriccello\|electric_cello" crates/` → zero hits. The description was prose only.
- **Family equality — recomputed by hand against `voiceSynth.ts:324-345`, not just trusting
  the lane's test:**

| old type string → family | new id (+ name/category) → family | same? |
|---|---|---|
| `piano` → `/piano\|grand\|honky/` → **piano** | `gm-acoustic-grand-piano` "Acoustic Grand Piano"/piano → **piano** | ✓ |
| `cello` → strings rule → **strings** | `gm-cello` "Cello"/strings → **strings** | ✓ |
| `electricCello` → lowercased `electriccello`, `/electric[ -]?piano/` does **not** match (needs "piano"), falls to strings rule via "cello" → **strings** | `gm-cello` → **strings** | ✓ |
| `violin` → strings rule → **strings** | `gm-violin` → **strings** | ✓ |
| `saxophone` → no `organ`/`horn` substring, reaches `/sax\|…/` → **reed** | `gm-alto-sax` "Alto Sax"/woodwinds → **reed** | ✓ |

  All four target ids exist in `instrumentCatalog.ts` (:44, :84, :86, :109). Because families
  are unchanged, `instrumentUsesKarplus` (`defaultInstrument.ts:66-76`) lowers identically —
  no node changes primitive.
- The report's **risk 2 is accurate and appropriately disclosed**: the bound voice moves from
  `getFamilyVoice(family)` to `getInstrumentVoice(id, name, category)`
  (`defaultInstrument.ts:110-124`) and the executor rebind key from `type:piano` to the id.
  That forces exactly one rebind, at load, not while playing. Family-equality is the honest
  guarantee and it is the one the test pins.

### 3. Deletions complete

I ran the brief's grep across `src scripts docs README.md e2e pi-openjammer-graph packages apps`
(`.ts/.tsx/.md/.mdx/.json/.css/.py`). Every remaining hit classified:

- `instrumentCatalog.ts` — `category: 'piano'` and `gm-*-piano` ids. Catalogue, not types.
- `voiceSynth.ts:35,331,349,377` — `VoiceFamily`, `FAMILY_KEYWORDS`, `CATEGORY_FAMILY`. Families.
- `InstrumentNode.tsx:89,91,96` — `NODE_TYPE_TO_CATEGORIES` **values** are catalogue categories.
- `pluginFamily.ts:9,30` — CLAP **feature** strings and a built-in name/category regex; never fed a NodeType.
- `song/songs/firstLight.ts:26` — `instrument('piano', …)` where the argument is `InstrumentCategory`.
- `utils/audioMetadata.ts:292-293` — filename keyword heuristics (another lane's file).
- `packages/oj-ui/src/components/Kbd/{Kbd.css:2,Kbd.tsx:14}` — prose about a `<kbd>` glyph.
- `e2e/journeys/J5-offline.spec.ts`, `e2e/timeline-preview.spec.ts` — `.piano-roll*` CSS selectors.
- `audio/executor/__tests__/{ojcoreExecutors:879,wasmParity:939}` — comments about the catalogue category.
- `nodeTypeMigrations.ts` + its test + the three migration tests + `menuCategories.test.ts:58-61` — the map and its tests.

**No leftover alias handling anywhere.** Confirmed clean: `NodeType` union, `KNOWN_PLUGIN_IDS`,
`KIND_BY_TYPE`, `createDefaultInternalStructure`, `isInstrumentNode`,
`INSTRUMENT_NODE_TYPES`, `DEFAULT_VOICE_INSTRUMENTS`, `STRUCTURAL_TYPES`, `NODE_TYPE_NAMES`,
`INSTRUMENT_LABELS`, `NODE_TYPE_TO_CATEGORIES`, `SCHEMATIC_TYPES` + the render switch,
`PURELY_VISUAL`, the doctor's `titleCase` docstring, `portPositions.ts:40`.

**Dead CSS: none.** `grep -rni "node-piano|node-cello|node-violin|node-sax|node-electric|keyboard-key" src packages --include=*.css` → only the `Kbd.css` prose line.
**No i18n table, icon map, story, or Figma Code Connect entry** keys on a node type
(`component-map.json` is clean in the tree).

**Set integrity, verified mechanically:** the `NodeType` union and `KNOWN_PLUGIN_IDS` are the
same 30 members (diffed sorted extractions — identical). `bun run oj doctor` reports
`node-registry` **PASS — "30 NodeTypes coupled cleanly across registry, KIND_BY_TYPE (SSOT),
nodeDefinition.ui, and NodeWrapper"** (10 pass / 1 warn `just` not installed / 0 fail).

One deletion beyond the report's table: `'guitar'` left `NODE_TYPE_TO_CATEGORIES`
(`InstrumentNode.tsx:93`). It was never a `NodeType`, so nothing regresses — the report does
note it.

### 4. The ghost-port fix

`NodeWrapper.tsx:301` was
`['piano','cello','electricCello','violin','saxophone','strings','keys','winds','sampler']` —
nine entries with **`'instrument'` absent**. Now `['instrument','strings','keys','winds','sampler']`.

- **Behaviour change for `sampler` / `strings` / `keys` / `winds`: none.** All four are
  retained verbatim. The only delta is `instrument` gaining ghost-port growth, plus the five
  now-impossible types leaving.
- **Pinned by a test that fails without it.** `NodeWrapper.reconnect.test.tsx:55-85` mocks
  `InstrumentNode` (`:9-15`) to expose a `ghost-port` button firing
  `handlePortMouseUp('ghost-input-3')`. `case 'instrument':` already existed in the render
  switch before this lane, so the mock renders on the old code too — the failure lands on
  `expect(after.nodes.get(instrumentId)!.ports.length).toBeGreaterThan(originalPortIds.length)`
  (and earlier on `connections.has(originalId)`), which is precisely the missing-`'instrument'`
  bug. Genuine pin, not a tautology.
- Minor report inaccuracy: it says the old list named "all eight legacy aliases"; it was nine
  entries (5 legacy + 3 family + `sampler`). Cosmetic only.

### 5. The loosened assertion — **acceptable, yes**

`portDomContract.test.tsx:92` `> 30` → `> 20`. `TYPES` there is
`Object.keys(nodeDefinitions)` (`:25`). The registry↔union set equality is pinned **exactly**,
once, at `menuCategories.test.ts:114-119`:
`expect([...KNOWN_PLUGIN_IDS].sort()).toEqual([...registeredTypes].sort())`, and
`menuCategories.test.ts:100-111` walks the whole registry for orphans. The `> 30` literal was a
weaker, drift-prone *duplicate* of a fact already pinned precisely — the kind of second copy
covenant #2 warns about. Loosening to a labelled smoke bound keeps the only thing that
assertion could honestly test (the import resolved and `it.each` is non-trivially populated)
without a second copy of the invariant. Correct call, correctly commented.

### 6. Docs

- **COVERAGE.md is internally consistent.** Section 3's node rows are exactly the 30 registry
  types plus one `AutoParamPanel` row (extracted and diffed against the `NodeType` union: no
  type missing, nothing extra). The MISSING list renumbers contiguously **1…30** (was 1…31;
  one item removed, the eight-type row collapsed to three). Six rows removed, three rewritten
  from "legacy fixed-instrument type" to "live Instruments menu row" — accurate.
- **MASTER-PLAN.md's node list is exactly the 30-type union** (diffed — identical). The "40 →
  30" correction is right: the old list did include `audio-in`/`audio-out`, which are port ids
  (`registry.ts:373-375`), not types. The FU7 follow-up wording is accurate and dated.
- **The menu paths are now true.** `menuCategories` (`registry.ts:780-782`) bucket
  **Instruments** = `['strings','keys','winds','sampler']`, names `Strings` / `Keys` / `Winds`
  (`registry.ts:293,315,337`). `CATEGORY_LABEL` lives in
  `useCommandSources.ts:42-49` and is keyed by `NodeCategory`, not node type — untouched and
  unaffected. README:145-146 ("Keys, Strings or Winds") and first-patch.mdx:16-17
  ("Instruments → Keys") are both correct. `docs/assets/README.md:15` ("Input → Keyboard") is
  correct — `keyboard`'s name is `Keyboard` (`registry.ts:49`) in the `Input` bucket.
- **One pre-existing doc inaccuracy left standing right next to a fixed one** — see FU-2.

### 7. The process violation (`git checkout -- src/audio/ojgraph/__tests__/emit.test.ts`)

`git diff --stat` on that file: **45 insertions / 45 deletions**. I verified it is a *pure*
rename: **every** removed line contains `piano` and **every** added line contains `inst`
(`git diff | grep "^-" | grep -v piano` → empty; `grep "^+" | grep -v inst` → empty). There is
no other-lane content visible in the file and no non-rename edit. The file is intentionally
modified (not identical to HEAD), and the modification is 100% this lane's own fixture swap.

Caveat stated honestly: a destructive `checkout --` cannot be *proven* not to have discarded
something, only shown not to have left a hole. Nothing in the current diff suggests one.
`emit.test.ts` is not in any excluded lane's path. **Do not do this again** — the covenant's
delegation clause exists because a `checkout --` in a shared worktree is unrecoverable.

### 8. Gates — all run by me, in this worktree

| Gate | Result |
|---|---|
| `bun run test:run -- src/engine src/store src/utils src/audio src/components/Nodes/__tests__ src/collab scripts/oj` | **72 files / 1063 tests passed, 0 failed** (21.0 s, exit 0) |
| `bunx tsc --noEmit -p tsconfig.app.json` | **clean** (exit 0, no output) |
| `bunx eslint src scripts` | **clean** (exit 0, no output) |
| `bun run test:cli` | **52 pass / 0 fail**, 163 expects, 10 files |
| `git diff --check` | **clean** (exit 0; only CRLF advisory warnings, which are `core.autocrlf` noise on other lanes' files, not whitespace errors) |
| `bun run oj doctor` | **10 pass / 1 warn / 0 fail** — `node-registry` PASS at 30 NodeTypes; the warn is `just: not found`, environmental |

**Other lanes' transient failures: none observed.** The scoped set the brief specified came
back fully green — I did not reproduce the `KeybindingsPanel` timeout the report mentions
(that file is outside the scoped paths).

**Browser evidence reviewed.** `plans/redesign-new-dna/.scratch/w6-p11/verify.log` +
`legacy-save.json` + both PNGs are consistent and honest: the save under test is a real
autosave (13 nodes, real generated ids) downgraded to `type: 'piano'` with `instrumentId`
deleted; after reload the node renders with the real Instrument faceplate reading
"Acoustic Grand Piano · INSTRUMENT · IN · AUDIO" (confirmed in the light PNG), 10 cable paths
drawn, 4 cables on the node before and after, meter `0 → 0.736` (−15.8 dB) light /
`0 → 0.744` (−15.4 dB) dark under a held key, re-persisted as
`type=instrument instrumentId=gm-acoustic-grand-piano offsets={"input-1":0} cables=4`, zero
console errors, and 13→13→13 across Ctrl+Z/Ctrl+Y. The two controls (`diag3.mjs`, `diag7.mjs`)
that keep the report from over-claiming the autoplay gate and the "Sound degraded" chip are
the right instinct and are correctly reported as *not* caused by this change.

### 9. Lean / taste

- **The "risk 4" mitigation — I recommend REJECTING the proposed grep-for-`as GraphNode[]`
  lint test.** My sweep found exactly **one** such cast in production
  (`webPayloads.ts:134`) and it is *inside* an already-covered seam — so the grep has almost
  no signal. Worse, the real project-folder seam the lane's brief itself missed is
  `AppMenuBar.tsx:203-204`, written as
  `manifest.graph.nodes as Parameters<typeof loadGraph>[0]` — it contains no `as GraphNode[]`
  at all. **The proposed lint would have missed the very seam it is meant to catch.** A lint
  that cannot catch the historical instance of its own bug class is dead weight (covenant #8).
  Recommend instead a cheap *behavioural* invariant that cannot go stale by phrasing: one
  table-driven test that pushes a legacy node through **every** public document entry point —
  `storage.getItem` (nodes **and** clipboard), `loadGraph`, `importWorkflow`, and
  `GraphStoreBridge.applyRemoteSnapshot` — asserting `type === 'instrument'` for each. Three
  of the five already exist; FIX 1 adds the clipboard; FU-3 adds the bridge. ~30 lines, and it
  fails loudly if a wired seam regresses. Be honest in the report: **no cheap test detects a
  *new* seam.** The durable mitigation is architectural — make `loadGraph` the single door —
  and that is a follow-up, not this lane.
- **Comment bloat, mild.** The reasoning is stated four times: once in the module docblock
  (`nodeTypeMigrations.ts:1-41`, ~40 lines of comment for ~25 lines of code) and again in
  5–8-line blocks at each of the three store/serialization seams
  (`graphStore.ts:1601-1606`, `graphStore.ts:1943-1949`, `serialization.ts:150-156`) plus
  `graphStoreBridge.ts:181-186`. The module docblock earns its length (it is the covenant-#7
  provenance for a deletion). The per-seam blocks would be better as one line + a pointer.
  Non-blocking; note that the hand-maintained seam list in the docblock is exactly what just
  rotted — FIX 1 corrects it, but consider replacing the enumeration with "every caller of
  this function IS the seam list" so it cannot drift again.
- `INSTRUMENT_TYPE` (`nodeTypeMigrations.ts:56`) is a single-use constant — mild ceremony, but
  it names the intent at the one place `type` is rewritten. Keep.
- `MigratableNode` + the `as T` cast is the minimal honest shape for "both `GraphNode` and
  `SerializedNode`". Correct choice over a union or a generic constraint gymnastics.
- The three tests added to `graphStore.test.ts` / `serialization.test.ts` are exemplary: they
  assert the *consequence* (the cable survives, `resolveNodeDefinition(...).name === 'Instrument'`,
  not `MISSING_DEFINITION`) rather than restating the map.

---

## Non-blocking follow-ups

| # | Item | Owner |
|---|---|---|
| FU-1 | The persisted clipboard also escapes `migrateNodePorts` (`graphStore.ts:34-63`) — a node copied before the looper `sample-out` / top-level `keyboard-visual` `key-*` / `library` `audio-out` migrations pastes back with dead ports. **Pre-existing**, same call site as FIX 1. | graphStore / persistence owner |
| FU-2 | `apps/docs/.../first-patch.mdx:14-15` still says "Right-click empty canvas → **Keyboard → Add Keyboard Node**". There is no such submenu — the context menu buckets are `Input / Instruments / Routing / Effects / Utility / Output` (`registry.ts:775-805`). The lane corrected step 2 and `docs/assets/README.md` to "Input → Keyboard" but left the false path in step 1, one line above. Cheap to fix now. | docs / this lane |
| FU-3 | The collab seam (`graphStoreBridge.applyRemoteSnapshot`) has no test — the report §7 admits it. Cheap: build a `GraphSnapshot` with a `cello` `CrdtNode`, drive it through a projection stub, assert `type === 'instrument'`. | collab lane |
| FU-4 | `INSTRUMENT_LABELS` (`InstrumentNode.tsx:77-88`) still mixes instrument ids and the three family type strings in one map (report risk 5) — reduced from eight rows to three, not eliminated. | nodes lane |
| FU-5 | A **new** `instrument` node defaults to `instrumentId: 'salamander-piano'` (`registry.ts:380`) while a **migrated** `piano` gets `gm-acoustic-grand-piano`. Both resolve to family `piano`, so nothing is audibly inconsistent — noting only so nobody "fixes" one to match the other without checking the family. | — |
| FU-6 | COVERAGE.md also flips the W5-P8 rows to `DONE ab23a31`. Accurate, but W5-P7 is editing COVERAGE.md concurrently — expect a merge conflict at integration. | orchestrator |
| FU-7 | Native tier unverified + no human listening pass (report §7). Per the covenant, **codex/agents never sign off on feel**: this needs ears with audio playing before it can be called done for a performer. | founder |
| FU-8 | The "Sound degraded" chip appears in both screenshots and on a fresh rig install with an unmodified save. Proven *not* caused by this change; not diagnosed. | engine-health owner |

---

## Bottom line

The lane is well-built, honestly reported, and its central claim — *a saved session opens,
stays wired, and keeps its voice* — is true along every path I could find but one. Fix the
clipboard seam (three small edits + one test), keep `Cargo.lock` out of the commit, correct
the "four seams" claim in the module docblock and the report, and this is a clean covenant-#7
migration: six dead types gone, one real bug fixed alongside, and the alias map living in
exactly one place.
