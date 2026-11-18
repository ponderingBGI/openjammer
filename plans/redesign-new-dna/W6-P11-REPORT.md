# W6-P11 — the five instrument aliases collapse into `instrument`; `keyboard-key` dies

**Lane:** W6-P11 · **Branch:** `t3code/openjammer-redesign-timeline` · 2026-08-29
**Covenant:** #7 (migrate fully, remove legacy paths), #8 (every production line is used),
"extend, don't fork", one gesture = one undo.

The registry carried **30** node types when this lane finished, down from **36**. Six types
are gone; nothing about a saved session is.

---

## 1. Deletions

### 1a. The five fixed-voice aliases — deleted, migrated on load

`piano`, `cello`, `electricCello`, `violin`, `saxophone`. They were byte-for-byte
`instrument`: same `PrimitiveKind` (`Sampler`), same internal structure, same predicates,
same faceplate. They differed only by a `defaultData.offsets` integer and by which keyword
`resolveVoiceFamily` happened to hit on the **type string** — both of which
`data.instrumentId` already expresses better (`defaultInstrument.familyForNode` keys on
`instrumentId` and ignores the type whenever one is present). `electricCello`'s advertised
*"saturation and chorus"* was implemented nowhere.

| File | What went |
|---|---|
| `src/engine/registry.ts` | the five `NodeDefinition` blocks (was ~310–403, 94 lines) — plus the now-false comments `strings: "defaults to cello sampler"`, `keys: "…piano sampler"`, `winds: "…saxophone sampler"` |
| `src/engine/types.ts` | the five `NodeType` union members (~165–169) and the five `KNOWN_PLUGIN_IDS` entries (~224–228) |
| `src/engine/manifest.ts` | five `KIND_BY_TYPE` rows (141–145) |
| `src/utils/nodeInternals.ts` | five `case` labels in `createDefaultInternalStructure` (178–182) |
| `src/utils/portSync.ts` | five entries in `isInstrumentNode` (382) — the list is now `['strings','keys','winds','instrument','sampler']` |
| `src/audio/ojgraph/noteRouting.ts` | five entries in `INSTRUMENT_NODE_TYPES` (23–27) |
| `src/audio/defaultInstrument.ts` | five entries in `DEFAULT_VOICE_INSTRUMENTS` (38–42) + two stale docblocks |
| `src/components/Nodes/NodeWrapper.tsx` | five names in `SCHEMATIC_TYPES` (79), five `case` labels in the render switch (491–495) |
| `src/components/Nodes/InstrumentNode.tsx` | five `INSTRUMENT_LABELS` relabel rows (81–85) and four `NODE_TYPE_TO_CATEGORIES` rows (93–98, incl. the never-a-node-type `'guitar'`) |
| `src/utils/bundleManager.ts` | `'piano'`/`'cello'`/`'violin'` from `NODE_TYPE_NAMES` (177–179) |
| `src/engine/__tests__/menuCategories.test.ts` | the five `INTERNAL_ONLY` exemption rows (68–72) |

### 1b. `keyboard-key` — deleted outright, no migration owed

Unreachable **and** unproduced: `createKeyboardInternals` (`nodeInternals.ts:228+`) mints
ONE `keyboard-visual` carrying 31 per-key **ports**, never 31 nodes. Nothing in the app has
ever created one, so no saved document can contain one.

`src/engine/registry.ts:68` (the whole def) · `src/engine/types.ts:157,216` ·
`src/audio/ojgraph/emit.ts:125` (`STRUCTURAL_TYPES`) · `src/utils/portPositions.ts:40`
(comment retargeted to `canvas-input`, the real 80×40 nominal box) ·
`scripts/oj/checks/node-registry.ts:275` (`PURELY_VISUAL`) and `:375` (a `titleCase` example
that used `electricCello`) · `src/engine/__tests__/manifest.test.ts:183` ·
`socketGeometry.test.ts:48` (comment) · `scripts/oj/__tests__/node-registry.test.ts:164`
(parser fixture → `midi-visual`, which keeps the quoted-key case the fixture exists to test).

The `keys` **port** id on the keyboard node is untouched — that is a port, not this type.

### 1c. What stays

`strings`, `keys`, `winds` — the three live Instruments menu rows and the three targets
`Ctrl+←/→` cycles between (`InstrumentNode.INSTRUMENT_NODE_TYPES`). Their design-capture
debt moves forward in `COVERAGE.md`; they are not deletion candidates.

---

## 2. The migration — one map, five seams

**The map lives in exactly one place: `src/engine/nodeTypeMigrations.ts`.**

```
piano         -> gm-acoustic-grand-piano   (family `piano`)
cello         -> gm-cello                  (family `strings`)
electricCello -> gm-cello                  (family `strings`)
violin        -> gm-violin                 (family `strings`)
saxophone     -> gm-alto-sax               (family `reed`)
```

Each id was chosen so `voiceSynth.resolveVoiceFamily(id, name, category)` lands on the same
`VoiceFamily` the old **type string** resolved to — pinned by a test that computes both
sides rather than restating them.

`migrateLegacyInstrumentNode(node)` is pure and idempotent: a non-legacy node is returned
**by reference** (a healthy document allocates nothing and reloads byte-identical); a legacy
node comes back as a copy with `type: 'instrument'` and `data.instrumentId` seeded only when
the player has not already picked one. `data.offsets`, `activeInputs`, and the node's
**persisted ports** ride through untouched.

### The seams

I grepped every reader of a persisted document (`importWorkflow` / `deserializeWorkflow`
callers, `loadGraph` callers, the `openjammer-graph-v2` key, `manifest.graph.nodes`, and
every `as NodeType` / `as GraphNode` cast outside tests). **The brief's "two seams" is not
enough** — the project-folder and crash-recovery paths bypass both:

| # | Seam | Why it is needed |
|---|---|---|
| 1 | `store/graphStore.ts` persist `storage.getItem` → `nodes` (next to `migrateNodePorts`) | the localStorage autosave |
| 2 | `store/graphStore.ts` persist `storage.getItem` → `clipboard.nodes` (**P11b**) | the store has **no `partialize`**, so `setItem` writes `clipboard` with the rest of the state and `pasteClipboard` clones the copied node's `type` verbatim. Ctrl+C a Cello → reload → Ctrl+V pasted an inert Unknown stub. Also migrates the clipboard node's **ports** (FU-1). |
| 3 | `store/graphStore.ts` `loadGraph` | **the door every non-persist document walks through.** `AppMenuBar.handleOpenProject` / `handleOpenRecentProject` cast `manifest.graph.nodes` **straight** to `loadGraph` — no `importWorkflow`, no persist. `useCrashRecovery` (`:82`, `:174`) does the same with the emergency backup and the quarantine store. |
| 4 | `engine/serialization.ts` `importWorkflow` | so the pure, headless import contract holds without a store (`scripts/oj/song.ts`, `paperSketch`, tests). Must run **before** `getNodeDefinition`, or an old project's piano resolves to `MISSING_DEFINITION` and opens as an inert stub. |
| 5 | `collab/graphStoreBridge.applyRemoteSnapshot` | a peer on a pre-P11 build can still push one of these types into a live session. |

The paths I checked funnel into one of those five: `AppMenuBar.handleFileChange` →
`importWorkflow` → `loadGraph`; `song/spec.specToGraph` and `ai/plan` build from the
**registry**, so a deleted type is a compile error, not a runtime surprise;
`projectStore.saveProject` only validates and writes (its read path is `handleOpenProject`).
No second copy of the map, in any seam.

**I no longer claim this list is exhaustive.** The original report asserted four seams and
that "everything else is covered *because* it funnels into one of those four" — the review
disproved it by finding the clipboard. The honest statement is the one the module docblock
now carries: *every caller of `migrateLegacyInstrumentNode` is the seam list; grep it.*
`store/__tests__/legacyInstrumentSeams.test.ts` pins all five and fails loudly if a wired
seam is unwired; nothing cheap detects a **new** one. The durable fix is architectural — make
`loadGraph` the single door — and it is a follow-up, not this lane.

---

## 3. The bug fixed in the same change

`NodeWrapper.tsx:301` listed all eight legacy aliases in its ghost-port instrument check but
**omitted `'instrument'`** — the generic voice every preset rig installs. Dropping a cable on
that node's ghost port grew no port and silently did nothing: the one instrument most players
meet first could not gain an input by gesture. The list is now
`['instrument','strings','keys','winds','sampler']`.

---

## 4. Tests — and why each fails on the old code

| Test | Fails on old code because |
|---|---|
| `engine/__tests__/nodeTypeMigrations.test.ts` (10 cases) | the module did not exist; there was no migration at all, so a saved `piano` stayed a `piano` and nothing seeded an `instrumentId`. Includes: the map names only types **absent** from `nodeDefinitions`/`KNOWN_PLUGIN_IDS`; every target id is real; **every mapping preserves `resolveVoiceFamily`** (computed both ways, not restated); offsets carried; an existing picker selection never overwritten; idempotent + by-reference; does not mutate its input. |
| `store/__tests__/graphStore.test.ts` — *"migrates a saved legacy piano to `instrument`, keeping its ports and cables"* | on old code the persisted node comes back as `type: 'piano'` with no `instrumentId`. Pins the exact thing the brief asked for: composite panel port ids survive verbatim, so `connectionPortsExist` keeps both cables (keyboard→piano and piano→speaker). |
| `store/__tests__/graphStore.test.ts` — *"migrates every legacy voice through loadGraph (the project-folder / crash-recovery seam)"* | the seam the brief did not name; all four remaining voices, each asserting its own seeded id. |
| `engine/__tests__/serialization.test.ts` — *"migrates a legacy fixed-voice instrument node…"* | on post-P11 code **without** the migration the node resolves to `MISSING_DEFINITION` — the test asserts `resolveNodeDefinition(migrated).name === 'Instrument'`, i.e. a real faceplate, not a stub — and that the persisted ports keep the cable alive through `importWorkflow`'s connection filter. |
| `components/Nodes/__tests__/NodeWrapper.reconnect.test.tsx` — *"grows a ghost port on the generic instrument…"* | retargeted from `'piano'` to `'instrument'`. With `'instrument'` missing from the ghost-port list, `isInstrument` is false, no port is created, and `ports.length` never exceeds the original — the assertion that pins the §3 bug. |

**Fixture swaps (intent preserved, nothing weakened):** `emit.test.ts` (16 hits) and
`graphStore.test.ts` (~25) `'piano'` → `'instrument'`; `bundleConnections.test.ts:459` now
lists the five surviving instrument types (and adds `sampler`, which `isInstrumentNode`
really returns true for and the old list omitted); `:525`/`:593` → `'instrument'`;
`MIDIVoiceRouter.test.ts:418`, `manifest.test.ts:172` (→ `keys`, still `ui:'react'`),
`defaultInstrument.test.ts:49` (→ `strings` **and** `winds`, one more assertion than before),
`actionRegistry.test.ts:175` (→ `keys`). `voiceSynth.test.ts:182-184` keeps testing the
resolver, now through the three real family types. `voiceSynth.resolveVoiceFamily`'s keyword
tests are untouched — they test the resolver, not the node type.

**One assertion I loosened, deliberately:** `portDomContract.test.tsx:92` asserted
`TYPES.length > 30`. With 30 registered types that literal turned a legitimate deletion into
a red test. It is now `> 20` with a comment saying it is a *smoke* bound (the walk resolved),
because the registry↔`NodeType` set-equality is already pinned exactly once, in
`menuCategories.test.ts:127`. I did not add a second copy of that invariant.

---

## 5. Verification

| Gate | Result |
|---|---|
| `bunx tsc --noEmit -p tsconfig.app.json` | clean |
| `bunx eslint src scripts` | clean |
| `bun run test:cli` | 52 pass / 0 fail |
| `bun run oj doctor` (node-registry doctor) | **PASS** — *"30 NodeTypes coupled cleanly across registry, KIND_BY_TYPE (SSOT), nodeDefinition.ui, and NodeWrapper"*; 10 pass / 1 warn (`just` not installed) / 0 fail |
| `git diff --check` | clean |
| `bun run build` | succeeds (PWA precache 86 entries) |
| `bun run test:run` | 2382 pass / 1 fail — `KeybindingsPanel > should render all keybinding actions`, a 5 s timeout under full-parallel load. Re-run in isolation: **21/21 pass in 7.4 s** (that case 3.3 s). Not mine; touches nothing in this lane. |

### Browser (node Playwright, one Chromium, dev on :5230 — stopped afterwards)

Script + log + screenshots: `plans/redesign-new-dna/.scratch/w6-p11/`
(`verify.mjs`, `verify.log`, `legacy-save.json`, `w6-p11-migrated-instrument-{light,dark}.png`).

The save under test is a **real** one, not a hand-built fixture: boot fresh → skip onboarding
(which still installs the default rig) → read the autosave the app wrote → downgrade its
`instrument` node to `type: 'piano'` with `instrumentId` deleted (exactly the pre-P11 on-disk
shape) → reload. Both themes:

- **renders as `instrument` with the Instrument faceplate** — the node's own text reads
  `"Acoustic Grand Piano · INSTRUMENT · IN · AUDIO"`, not the `Unknown` stub.
- **cables survive** — 4 connections on the node before and after; 10 cable paths drawn in
  the connections layer; ports byte-identical
  (`input-panel-…:empty-…`, `output-panel-…:audio-out`).
- **it makes sound** — holding an on-screen key drives the Speaker meter
  `--oj-meter-signal` `0 → 0.736` (**−15.8 dB**) in light and `0 → 0.744` (**−15.4 dB**) in
  dark. Idle reads `0` / `−∞ dB`.
- **the migration is durable, not a render-time patch** — after one canvas gesture flushes
  zustand-persist, the document on disk reads `type: instrument`,
  `instrumentId: gm-acoustic-grand-piano`, `offsets: {"input-1":0}`, 4 cables.
- **zero console errors / page errors** in both passes.
- **rig install → Ctrl+Z → Ctrl+Y**: 13 nodes → 13 → 13, the instrument still `instrument`
  and still rendered. The ghost-port fix regressed nothing.

**Two controls I ran so the report does not over-claim** (`diag3.mjs`, `diag7.mjs`):
1. A plain reload is silent **with an unmodified save too** — on a reload no `AudioContext`
   is constructed at all, because `App.handleActivate` is reachable only from the final
   onboarding tap or the transport pill (labelled **"Start sound"** for a returning player).
   That is the product's autoplay gate, not anything the migration does; the harness now
   presses it, exactly as a returning player would.
2. The **"Sound degraded"** chip visible in both screenshots also appears on a *fresh rig
   install with an unmodified save* in this headless environment. Pre-existing, not caused by
   this change — see §7.

---

## 6. Docs

- `plans/redesign-new-dna/COVERAGE.md` — the six rows are **gone** from the matrix (they name
  types that no longer exist), with a one-line "deleted, migrated on load" note in their
  place; `strings`/`keys`/`winds` re-labelled as live menu rows and kept as capture debt; the
  MISSING list renumbered. Rows 108–116 (the W5-P8 family) flipped from
  *uncommitted / IN-FLIGHT* to **DONE `ab23a31`**, including the wave-index row.
- `plans/redesign-new-dna/MASTER-PLAN.md` — the decision recorded as a new dated follow-up
  section ("FU7 closed"), with the reasoning and the migration's location; the completeness
  inventory's node list corrected to the 30 real types (it also miscounted `audio-in` /
  `audio-out`, which are port ids).
- `docs/node-standards.md:320`, `docs/voice-engine.md` (`DEFAULT_VOICE_INSTRUMENTS`),
  `docs/creating-nodes.md:99,194` — node-type examples updated.
- `README.md:146`, `docs/assets/README.md:16-20`,
  `apps/docs/src/content/docs/play/first-patch.mdx:17-19` — these told a first-run player to
  pick **"Instruments → Keyboard → Classic Piano"**, a menu path that has not existed for a
  long time (`piano` was never in `menuCategories`). Now they say Keys / Strings / Winds,
  which is what the menu actually offers.
- No Ctrl+K or agent doc lists node types by hand — both read `menuCategories` at runtime
  (`useCommandSources.buildNodeActions`, `ai/graphAdapter.ts`), so they followed the registry
  automatically. Verified by grep.

---

## 7. What I could NOT verify

- **Native tier.** Everything here is the browser executor. `bun native` / the cpal path was
  not run; `KIND_BY_TYPE` lowering is unchanged for `instrument` (still `Sampler`), so no
  native behaviour should differ, but nobody listened to it.
- **A real human listening pass.** The proof is a meter reading (−15.4 dB peak) in headless
  Chromium with a null sink, not ears on a speaker. Per the covenant, feel needs a human.
- **The "Sound degraded" engine-health chip** seen in both screenshots. I proved it is
  *not* caused by this change (it appears on a fresh rig install with an unmodified save in
  the same environment) but I did not diagnose it. It is almost certainly the headless/no-
  audio-device environment; it deserves a look from whoever owns engine health.
- **Real project folders (File System Access).** The `loadGraph` seam that serves them is
  unit-tested, but I could not exercise an actual `project.openjammer` on disk — the picker
  needs a user gesture and a real directory handle.
- **A live two-peer collab session** across a pre-P11 and a post-P11 build. The bridge seam is
  wired and typechecks; it is not covered by a test.
- **Migrating a document that predates the *ports* persistence** (a very old save whose
  instrument node has `ports: []`). It falls back to `instrument`'s `defaultPorts`
  (`bundle-in`/`pedal`/`audio-out`) and its old cables would be dropped by
  `connectionPortsExist` — but that is the pre-existing behaviour of every node in that
  situation, not something this change introduces.

---

## 8. Risks

1. **Save-file compatibility — the real one.** The migration is *forward only*. Once a
   session is re-persisted, the document says `instrument`; an older build reading it back
   gets a type it knows, so it still opens — but it loses the `offsets`-per-alias identity
   only insofar as it now reads `instrumentId`, which older builds already honour
   (`defaultInstrument` has keyed on `instrumentId` over type for a long time). Net: round-
   trip through an old build is lossless in practice. Worst case is cosmetic (an older build
   labels the node "Instrument" instead of "Cello").
2. **Timbre is preserved by family, not byte-for-byte.** A migrated `piano` used to bind
   `getFamilyVoice('piano')` under the cache key `type:piano`; it now binds
   `getInstrumentVoice('gm-acoustic-grand-piano')` under that id. Same family, same character,
   but the per-instrument timbre variation makes it a *slightly* different waveform. A piano
   still sounds like a piano; a purist A/B would hear a difference. This is inherent to
   collapsing the alias and is pinned as a family equality, which is the honest guarantee.
3. **A hand-edited file naming a deleted type in some other field.** Only `node.type` is
   migrated. Nothing else in the codebase stored these strings (verified by grep), so this is
   theoretical.
4. **A SIXTH seam could appear and nothing would notice.** This risk was under-stated and the
   review proved it: the original four *were* five — the persisted clipboard was already the
   missed one (fixed in P11b). If someone adds another path that builds `GraphNode`s from
   JSON without going through `loadGraph`, it silently skips the migration.
   `legacyInstrumentSeams.test.ts` pins the five that are wired; **no cheap test detects a new
   one.** That is the one place this change can still rot, and the durable fix is
   architectural (one door: `loadGraph`), not another test.
5. **`INSTRUMENT_LABELS` keyed by both instrument ids and the three family type strings** is
   still a mild type/id conflation in `InstrumentNode.tsx` — reduced from eight legacy rows to
   three live ones, but not eliminated. Out of lane; noted.

---

## 9. P11b — fix round (review FIX 1, FU-1, FU-2, FU-3, §9)

The review's verdict was COMMIT-AFTER-FIXES on one substantive finding: a **fifth document
seam the lane claimed did not exist**. This round closes it, closes the pre-existing ports
gap sitting at the same call site, replaces the enumeration that rotted with a rule that
cannot, and adds the behavioural invariant the review recommended in place of the lint it
recommended rejecting. `Cargo.lock` (FIX 2) is a staging decision, not a code change, and is
left to the committer.

### What changed

| # | File:line | Change |
|---|---|---|
| FIX 1 + FU-1 | `src/store/graphStore.ts:1991-2012`, `:2023` | the persist `getItem` now migrates `clipboard.nodes` through `migrateNodePorts(migrateLegacyInstrumentNode(node))` — **type first, then ports**, the same order and the same two calls as the `nodes` path at `:1943` — and returns the rewritten `clipboard` explicitly (the `...parsed.state` spread carried it back verbatim). |
| §2 | `src/engine/nodeTypeMigrations.ts:26-38` | the hand-enumerated "four seams" list is replaced by the rule **"every caller of `migrateLegacyInstrumentNode` IS the seam list; grep it"**, one line naming the five known today, and the honest note that no test detects a NEW seam and the durable fix is making `loadGraph` the single door (follow-up). |
| §9 | `src/store/__tests__/legacyInstrumentSeams.test.ts` (new, 5-row table) | one legacy `cello` driven through persist `getItem` → `nodes`, persist `getItem` → `clipboard`, `loadGraph`, `importWorkflow`, and `GraphStoreBridge.applyRemoteSnapshot` (FU-3), each asserting `type === 'instrument'` **and** `instrumentId === 'gm-cello'`. |
| FU-2 | `apps/docs/src/content/docs/play/first-patch.mdx:14` | "Right-click empty canvas → **Keyboard → Add Keyboard Node**" (no such submenu) → "**Input → Keyboard**", matching step 2 one line below and the real `menuCategories` buckets. |
| §9 comment bloat | `src/store/graphStore.ts` (loadGraph + persist), `src/engine/serialization.ts`, `src/collab/graphStoreBridge.ts` | the four 5-8-line per-seam blocks shrunk to one line + a pointer to the module docblock. Comment-only; zero code change. |

### FU-3: how the collab seam is driven

`applyRemoteSnapshot` is private, so the test drives it the way the app does: a minimal
zustand `BridgeGraphState` store + a **projection stub** (`subscribe` / `snapshot` /
`transactLocal` / write-delete no-ops) handed to `new GraphStoreBridge(...)`, `start(false)`
(guest — no seeding), then the captured listener is fired with
`(snapshot, { remote: true })`. The stub keeps the table free of the Loro/WASM runtime; the
real `CrdtGraphProjection` is already exercised by `collab/__tests__/convergence.test.ts`.

### Tests, and why each fails on the old code

Proved by temporarily reverting FIX 1 (the clipboard block removed, `clipboard` dropped from
the returned state) and re-running — **3 failed / 41 passed**, verbatim:

```
FAIL src/store/__tests__/graphStore.test.ts > graphStore > localStorage persistence
     > migrates a legacy node sitting in the PERSISTED CLIPBOARD
AssertionError: expected 'cello' to be 'instrument' // Object.is equality
Expected: "instrument"
Received: "cello"
 ❯ src/store/__tests__/graphStore.test.ts:297:33

FAIL src/store/__tests__/graphStore.test.ts > graphStore > localStorage persistence
     > migrates the PORTS of a clipboard node too (the pre-existing gap at the same seam)
AssertionError: expected [ 'audio-in', 'audio-out', …(1) ] to deeply equal [ 'audio-in', 'audio-out' ]
- Expected
+ Received
  [
    "audio-in",
    "audio-out",
+   "sample-out",
  ]
 ❯ src/store/__tests__/graphStore.test.ts:333:49

FAIL src/store/__tests__/legacyInstrumentSeams.test.ts
     > legacy instrument types: every document seam migrates
     > 'persist storage.getItem — clipboard (…'
AssertionError: expected 'cello' to be 'instrument' // Object.is equality
Expected: "instrument"
Received: "cello"
 ❯ src/store/__tests__/legacyInstrumentSeams.test.ts:194:31

 Test Files  2 failed (2)
      Tests  3 failed | 41 passed (44)
```

| Test | Fails on the old code because |
|---|---|
| `graphStore.test.ts:275` *"migrates a legacy node sitting in the PERSISTED CLIPBOARD"* | `getItem` returned `...parsed.state` verbatim, so a `cello` copied before P11 came back as `type: 'cello'` with no `instrumentId`; `pasteClipboard` (`:1669`) clones `type` untouched, so Ctrl+V pasted an inert `MISSING_DEFINITION` stub. Also pins that `data.offsets` (`-12`) — the only thing the deleted `cello` def ever supplied — rides through. |
| `graphStore.test.ts:303` *"migrates the PORTS of a clipboard node too"* (FU-1) | the same verbatim return skipped `migrateNodePorts`, so a looper copied before that migration pasted back still carrying the dead `sample-out` port (and the retired `technical` port type). Pre-existing, same call site. |
| `legacyInstrumentSeams.test.ts:192` — the clipboard row | same seam, asserted as part of the table so the rule "every wired door migrates" has no gap in it. The other four rows pass on the old code — that is the point: the table is the regression net for the seams that *are* wired. |
| `legacyInstrumentSeams.test.ts:198` — `SEAMS` has 5 rows | a count, not an invariant. It is the nudge to add a row when someone wires a sixth caller. **It cannot detect an UNWIRED sixth seam**, and the docblock says so; nothing cheap can. |

**The three pre-existing per-seam tests are KEPT — the table does not subsume them.** It
asserts `type` + `instrumentId` only; they assert the *consequences* the review called
exemplary and that a player actually feels: `graphStore.test.ts:164` (persisted ports survive
verbatim so **both cables** stay connected through `connectionPortsExist`, `offsets`
preserved), `graphStore.test.ts:238` (all four remaining voices through `loadGraph`, each with
its own seeded id), and `serialization.test.ts` (`resolveNodeDefinition(...).name ===
'Instrument'` — a real faceplate, not `MISSING_DEFINITION` — and the cable survives
`importWorkflow`'s connection filter).

### Gates (P11b)

| Gate | Result |
|---|---|
| `bun run test:run -- src/engine src/store src/collab src/utils` | **48 files / 561 tests passed, 0 failed** (12.9 s) |
| `bunx tsc --noEmit -p tsconfig.app.json` | clean (no output) |
| `bunx eslint src/engine src/store src/collab` | clean |
| `git diff --check` on the P11b file set | clean |

### Not done / not mine

- **FIX 2 (`Cargo.lock`)** — a staging decision for whoever commits; no code change was
  possible or needed from this lane.
- **Feel.** Nothing here was heard. The clipboard path (Ctrl+C → reload → Ctrl+V) was proved
  by unit test only; per the covenant a performer's ears still owe this a pass.
- FU-4 (`INSTRUMENT_LABELS`), FU-5, FU-6, FU-7, FU-8 remain open with their listed owners.
