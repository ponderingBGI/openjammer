# W6-SHIP-REVIEW — adversarial gate on the W6-SHIP lane

Reviewed: every uncommitted file except `e2e/visual-baselines.spec.ts`, its snapshot dir,
`COVERAGE.md`, `W6-BASE-REPORT.md`, `FINAL-REVIEW.md`, `PR-DESCRIPTION.md`,
`plans/ux-intuitive/*` and `.scratch/*`. Base `8809c77`.

Everything below was measured, not read off the report. Browser work: headless Chromium
(node + Playwright) at 1440×900 against `bun dev --port 5238 --strictPort`, both themes
forced through the app's own `openjammer-theme` key so the semantic tokens really swap.
Scripts and JSON: `.scratch/w6-ship-gate/{canvas,arr,marks,tint,drums2,rc2,ports2,typescan}.mjs`
and the matching `*.json`. **No product file was edited**; the one gate-proof edit
(finding evidence for item 2) was made, run, reverted and byte-diffed back to identical.
The dev server on 5238 is stopped.

---

## Verdict — **SHIP AFTER FIXES**

The lane's central work is real and largely excellent. B1–B4 and the Z4 sweep are correct,
well-argued and pinned. The drum heuristic, the contrast repairs, the docs pass, the type
floor and the `returnArmed` coverage all verify against the code, the tests and a live
render. All six gates are green on this tree, freshly re-run.

But **three of the thirteen items are not actually closed**, and two of them are closed
*in the report* rather than in the product:

- **Item 4 does not fix the card FINAL-REVIEW named.** The Sampler still reads
  `Input` / `Audio` in the live DOM, beside `IN`/`OUT` on the Instrument one card over —
  the exact three-vocabulary screen the item existed to close. The new gate cannot see it,
  because the port names come from `nodeInternals.ts` / `portSync.ts`, not from
  `nodeDefinitions`.
- **Item 4 also breaks the agent's wire contract.** `resolvePlanPort` matches port names
  exactly, and `docs/agent-tools.md` still teaches `"port": "Audio Out"`. Every documented
  plan now fails validation.
- **Item 6 moves the tab trap rather than removing it.** The roll has **139 tab stops**,
  128 of them `.piano-roll__lollipop`. Forty `Tab` presses from the tabbable note never
  leave the roll, in both themes.

None of these is unfixable and none invalidates the rest of the lane. But shipping as-is
would put a report on record claiming three closures that a two-minute render disproves.

**Ruling on the MIDI-bus disagreement: the lane is right, FINAL-REVIEW was wrong.** Detail
in §"Ruling" below.

---

## Findings

| id | sev | file:line | what is wrong | exact fix |
|---|---|---|---|---|
| **F1** | **HIGH** | `src/utils/nodeInternals.ts:452,473,1226,1247`; `src/utils/portSync.ts:145,165,203` | The Sampler card renders `Input` / `Audio` — measured in the live DOM (`.scratch/w6-ship-gate/canvas.json`, `ports2.mjs`). A fresh `sampler` node's ports are `…:empty-…:Input` and `…:audio-out:Audio`, derived by `portSync` from internal children whose port names are hard-coded `'Audio'` (nodeInternals) or default to `'Input'`/`'Output'` (portSync). The registry rename never reaches them, and `portVocabulary.test.tsx` only walks `nodeDefinitions[type].defaultPorts`, so the gate agrees the vocabulary is unified while the screen says otherwise. | Rename `name: 'Audio'` → `'Out'` at `nodeInternals.ts:452,1226` and → `'In'` at `:473,1247`; change the `\|\| 'Input'` / `\|\| 'Output'` fallbacks in `portSync.ts:145,165,203` to `'In'` / `'Out'`. Then extend `portVocabulary.test.tsx` to assert on `emitPortsFromInternals`/`nodeInternals` too, or better, on the ports of a node actually added through `useGraphStore.addNode` for every `canEnter` type. |
| **F2** | **HIGH** | `src/engine/dynamicRegistry.ts:142,145,190,191` | Hosted VST3/AU/CLAP nodes and AI-authored effect nodes still get `Audio In` / `Audio Out`. `EFFECT_DYNAMIC_PORTS`'s own comment says it "mirrors the static `effect` definition's `defaultPorts`" — after this lane it no longer does. Every hosted plugin card therefore reads `AUDIO IN`/`AUDIO OUT` next to a built-in reading `IN`/`OUT`. Worse: `graphStore.migrateNodePorts` *does* reach these ids on load, so the same card reads `AUDIO IN` when added and `IN` after a reload. | Rename all four to `'In'` / `'Out'`. Add `dynamicRegistry`'s two port sets to the `portVocabulary` gate. |
| **F3** | **HIGH** | `docs/agent-tools.md:54,145,146`; `src/ai/plan.ts:11,63`; contract at `src/ai/planAdapter.ts:36`, validator at `src/ai/planValidator.ts:215` | `resolvePlanPort` is `ports.find(p => p.name === portName)` — exact match. The rename made `looper.audio-out` = `Out` and `speaker.audio-in` = `In`, so the *worked example in the agent's own contract doc* (`{"port": "Audio Out"}` → `{"port": "Audio In"}`) now fails `validate_plan`'s "ports exist" check. The report does not mention the agent path at all. | Update `docs/agent-tools.md`'s prose and JSON example, and `plan.ts`'s two doc comments, to `"Out"` / `"In"`; **and** add a backwards-compatible alias in `resolvePlanPort` (`Audio Out`→`audio-out`, `Audio In`→`audio-in`, `Output`→`out`, `Input`→`in`) so plans an agent already learned keep resolving. Pin with a test in `src/ai/__tests__/plan.test.ts` using the REAL registry, not the local `PORTS` fixture (which is why the suite stayed green). |
| **F4** | **HIGH** | `src/components/PianoRoll/PianoRoll.tsx:880` | Item 6 fixed the notes and left the identical trap one row down. Measured on the shipped starter, both themes: the roll contains **139 tab stops** — `BUTTON`×5, `grid-chip`×1, `tool`×1, `close`×2, `scroomer`×1, `piano-roll-note`×1, **`piano-roll__lollipop`×128**. Starting from the one tabbable note, 40 consecutive `Tab` presses never leave `.piano-roll` (`marks.json → pressesToLeaveRoll`). The report's own browser table records the evidence — "Tab from a note leaves the note field: yes → `piano-roll__lollipop`" — and scores it a pass. | Give the velocity lane the same roving tabindex the notes got: one tabbable lollipop, the rest `-1`, arrows move the roving focus. The `rovingNoteId`/`focusableNoteId`/`moveRovingFocus` machinery at `PianoRoll.tsx:158-163,648-683` generalises directly. |
| **F5** | **MED** | `src/components/Arrangement/TrackLaneView.tsx:87-91` | `trackTintHex()` is resolved in a `useEffect` keyed on `[track, tint]`. Neither changes when the **theme** changes, so the swatch goes stale. Measured (`tint.mjs`): light → `--track-tint` computes to `oklch(0.72 0.15 80)` = `#d59800`, input value `#d59800` ✓; after clicking "Switch to the dark theme" the lane computes `oklch(0.78 0.15 80)` = `#e9ab2b` while the input still holds `#d59800`. The report's claim "the picker now opens on the colour the lane is actually wearing" is true only until the player toggles the theme — the same class of defect the fix was for. | Resolve lazily instead of eagerly: drop the effect and compute `trackTintHex(track, laneRef.current)` in an `onPointerDown`/`onFocus` handler on the `<input type="color">` (writing it into the state that feeds `value`), or add the live theme id to the effect deps. Lazy is better anyway — it also removes a `getComputedStyle` + canvas allocation from every lane's mount. |
| **F6** | **MED** | `src/utils/spawnPlacement.ts:26-27`; `src/components/CommandBar/useCommandSources.ts:87` | `CASCADE_STEP`'s comment claims the step is "small enough that a run of eight stays on screen at the default zoom". Measured at 1440×900 with the brief's own sequence (Looper → Library → Sampler): positions are distinct and 26px apart ✓, but the **2nd and 3rd cards leave the viewport** — Library `y=523 h=381` → bottom **904**, Sampler `y=549 h=378` → bottom **927**, against a 900px viewport (`canvas.json → paletteInViewport`). Without the cascade all three sat at `y=496` and fit. The cascade made containment slightly worse, and the code asserts the opposite. | Either clamp in `freeSpawnPoint` (reject a candidate whose `desired + card height` leaves the viewport and wrap the lap early), or fix the real cause — `viewportCenter()` puts the card's *top-left* at the centre, so any card taller than ~400px overflows before any cascade. At minimum, correct the comment so it does not assert something measurement contradicts. |
| **F7** | **MED** | `src/components/__tests__/typeFloor.test.ts:47-56` | The lane correctly diagnosed the gate's second blind spot as "it scanned only the four surfaces W6-CAP happened to measure" — and then fixed it by adding four more names to the same hard-coded list. It now scans **8 of 115** stylesheets under `src` + `packages/oj-ui/src`. Running the lane's own widened `MICRO`/`DECLARES_MONO` regexes over the other 107 sheets finds **39 further candidate declarations** (`typescan.mjs`), e.g. `CommandBar.css .command-bar-ai-slash-desc`, `MIDIDeviceBrowser.css .midi-browser-section h3`, `Guide.css .guide-latency-label` — all `var(--text-xs)` explicitly paired with `var(--font-sans)`. The sibling gate written in the same lane (`reducedMotionContract.test.ts:38`) *does* walk `src` and `packages/oj-ui/src` whole, so the pattern was available. | Replace `SHEETS` with the same recursive walker `reducedMotionContract.test.ts` uses, and land or triage the resulting offenders. If the 39 are too big for this lane, say so and file it — but do not leave a floor gate covering 7% of the surface while the report says the blind spot is closed. |
| **F8** | **LOW** | `src/store/graphStore.ts:88-95` | `RETIRED_PORT_NAMES` is keyed by name alone and is direction-blind: a saved port with `id: 'audio-in'` and `name: 'Audio'` migrates to **`Out`**. Nothing in the shipping registry produces that pair today, but `nodeInternals.ts:473/1247` produces exactly `{ id: 'audio-out', name: 'Audio', direction: 'input' }`, so the shape exists in the tree. | Key the map on `(direction, name)`, or gate the `'Audio' → 'Out'` row on `port.direction === 'output'`. |
| **F9** | **LOW** | `src/engine/nodeStandards.ts:113,122`; `docs/node-standards.md:223,232`; `docs/creating-nodes.md:154` | The node-authoring standard and both authoring guides still name `Audio In` / `Audio Out` as the canonical port names. A community node written from the docs today ships the retired vocabulary. Code-value #7 ("migrate fully, remove legacy paths"). | Update all five sites to `In` / `Out`. |
| **F10** | **LOW** | `.design-sync/conventions.md:32`; `.design-sync/NOTES.md:77` | `--universal-port` was deleted from the token JSON, both generated sheets and `types.ts`, and correctly rewritten in `AGENTS.md`/`DESIGN.md` — but these two design-sync docs still list it as a live token and `NOTES.md:77` still describes the retired rainbow-gradient behaviour. | Drop `--universal-port` from the conventions token list; correct or delete the NOTES line. |
| **F11** | **LOW** | report §1 "Pins" vs the test tree | The report says `entries.length` "grows by zero on **each** path". Three of the ten reclassified sites have no such pin: `MicrophoneNode.tsx:160`, `MiniLab3Node.tsx:77`, `MIDIIntegration.tsx:135`. (`environmentWritesOffHistory.test.tsx` covers SamplerNode, `MIDINode`'s child fan-out and `midiStore`'s bus auto-connect; `SpeakerNode.test.tsx` covers the speaker.) The claim is broader than the coverage. | Either add the three assertions (they are three copies of an existing shape) or narrow the sentence. |

---

## Claims verified — evidence per item

### Item 1 · B1–B4 and the Z4 sweep — **VERIFIED**

- All four blockers carry `{ record: false }` and the disproven comment is rewritten in
  each: `voiceLoadError.ts:39` (+ file header), `faultPipe.ts:138`,
  `OjcoreNativeExecutor.ts:530`, `SamplerNode.tsx:88`. Read in the diff.
- `voiceLoadError.test.ts` no longer enshrines the bug: the assertion is
  `toBe(before)`, not `before + 2`, and a second test proves the player's own last edit
  survives a voice failure.
- **Nothing player-driven was taken off history.** `grep -rn "record: false" src packages
  --include=*.ts --include=*.tsx` (tests excluded) returns exactly 12 call sites: the four
  blockers, the six Z4 sites, `pluginLoadError.ts:56` and `LibraryNode.tsx:211` — i.e.
  precisely the report's table and nothing else. Every knob, picker, rename,
  `NodeWrapper` ghost-port drop, `AudioSettingsPanel`, `PortPanelNode`, `PluginsPanel` and
  `ai/tools.ts:642` still record.
- Pins land: `entries).toHaveLength(0)` at `capturePluginStatesHistory.test.ts:108`,
  `environmentWritesOffHistory.test.tsx:122,179,208`, plus the two new
  `routeRuntimeFaults` tests and one in `SpeakerNode.test.tsx`. Each also asserts the write
  LANDED and that a prior player edit is still the one thing undo reaches — that second
  half is the assertion that makes these tests worth keeping. See **F11** for the gap.

### Item 2 · `trackTintHex()` — **VERIFIED, with F5**

- Correct in both themes at rest, measured on the Paper Sketch starter: for all three
  lanes the `<input type="color">` `value` is byte-identical to the canvas-resolved
  computed `--track-tint` (light: `#d59800` / `#ff6e37` / `#17a750`;
  `arr.json → swatches`). No `#4a90c2` anywhere in the DOM.
- **Per render, not per keystroke** — the effect is keyed on `[track, tint]`, both of which
  are stable across the scroll/zoom re-renders that dominate this component. It runs once
  per lane per tint change. But it is also stale across a theme swap (**F5**).
- **Survives jsdom/SSR.** `typeof document === 'undefined'` and a null `getContext('2d')`
  both fall through to `UNSET_SWATCH_HEX = '#000000'`, a valid `<input type="color">`
  value. jsdom has no 2D context and there is no canvas mock in `setupTests.ts`, so this is
  the live path under vitest; 238/238 files pass.
- **The widened gate really catches the hex in TSX — proven, not assumed.** I injected
  `useState('#4a90c2')` into `TrackLaneView.tsx`, ran the gate, and got two failures:
  `authors no colour literal in TS/TSX either` and `names the retired blue nowhere`, both
  with `+ ["src/components/Arrangement/TrackLaneView.tsx"]`. The file was restored and
  `diff` against the pre-edit copy is empty.

### Item 3 · Palette spawn cascade — **VERIFIED, with F6**

Ctrl+K → Add Looper → Add Library → Add Sampler, both themes:
three distinct coordinates, minimum separation **26px** on screen (28 canvas px at the
default ~0.93 zoom), no occlusion. Right-click still lands at the pointer: a right-click at
screen (900, 620) followed by *Add Multiplier* placed the node at canvas
(883.75, 400.03) — the pointer's canvas point, not the viewport centre (`rc2.mjs`). The
one failure is viewport containment (**F6**).

### Item 4 · Port vocabulary — **NOT CLOSED.** See F1, F2, F3, F8, F9

What *did* land, measured in the live DOM (`canvas.json → portLabels`): Instrument
`IN`/`OUT`, InstrumentVisual `OUT`, Effect `In`/`Out`, Speaker `In`, Looper `In`/`Out`,
Microphone `Out`, MIDI keeps its real names (`Keys`, `Pitch Bend`, `Mod Wheel`). Accessible
names stay verbose. The registry's seven renames and the two faceplate literals are correct.
The migration seam is `graphStore.migrateNodePorts` (called at `:1997` and `:2062`), i.e.
the same load seam `migrateLegacyInstrumentNode` uses — but it is **not table-tested**:
`portVocabulary.test.tsx` never exercises `migrateNodePorts` at all, and no test in
`legacyInstrumentSeams.test.ts` or `nodeTypeMigrations.test.ts` covers the port-name rows.

### Item 5 · Drum heuristic — **VERIFIED**

- Paper Sketch's "Nylon Chords" opens **melodic** in both themes: `is-drums false`,
  mode note "Pitched notes", **zero** GM drum names in the gutter, which reads
  `D♯5 · D5 · C♯5 · C5 · B4 · A♯4` (`arr.json → roll`).
- A kit signal flips it and **the inline roll and the full roll agree**: renaming the track
  to `Drums` in the live app puts *both* into `is-drums: true` / "Drum rows auto-detected"
  (`drums2.mjs`). That is the fork the item closed — `TrackLaneView` now passes the same
  `DrumDetectionContext` `PianoRoll` does.
- The shipped beat rig is drum-detected on three independent signals by code inspection
  (`beatSong.ts`: track `Kit` and instrument `gm-synth-drum` both match `KIT_WORDS`; pitches
  36/38/42 are all in `GM_DRUM_NAMES`; `durTick` 240 == `HIT_TICKS` at PPQ 960). I could not
  drive the onboarding "Build a beat" goal headlessly to render it — see "could not verify".
- `GM_DRUM_NAMES` now lives once, in `geometry.ts`, imported by `PianoRoll.tsx`. The
  five new `geometry.test.ts` tests are built from the real `buildPaperSketch()`.

### Item 6 · Roving tabindex — **PARTIALLY VERIFIED.** See F4

Verified by render, both themes: 128 notes, exactly **1** tabbable, **127** at `-1`.
`ArrowRight` walks the roving focus and takes focus with it — `A3, tick 0` → `C4, tick 480`
→ `E4, tick 960` — and exactly one note remains tabbable throughout. The `<section>` root
carries a plain `tabIndex="0"` (the surface tab target), **not** the roving expression: the
crash the lane admits shipping is repaired, confirmed on a real render with **zero console
and page errors** in both themes. The unfixed half is the velocity lane (F4).

### Item 7 · `returnArmed` — **VERIFIED**

`TransportPill.stories.tsx` gains `ReturnArmed` ("Second Stop armed"), in the shape of the
existing five. `TransportPill.test.tsx` gains a `the second Stop` block of four tests
asserting: the glyph swaps play → rewind (identified by geometry — 1 path + 1 rect — not by
the styleless `is-return-armed` class); both marks are `fill="currentColor"`; the
accessible name and `title` become `returnLabel`; `returnArmed` is ignored while `playing`
(glyph is `stop`, name is `Stop`, class absent); and the unarmed default is unchanged.

### Items 11–13 · type floor and the two marks — **VERIFIED, with F7**

**All twelve reported sites measured in the live DOM through the real cascade, both
themes** (`arr.json → typeFloor`). Every one is ≥13px sans or 11px JetBrains Mono:

| site | size | face |
|---|---:|---|
| `.arrangement-section-chip` | 13 | Outfit |
| `.arrangement-instrument-chip button` | 13 | Outfit |
| `.arrangement-track__lane-menu` | 13 | Outfit |
| `.arrangement-track__lane-menu button` | 13 | Outfit |
| `.arrangement-automation__interp .oj-seg__btn` | 13 | Outfit |
| `.arrangement-time-prompt label` | 13 | Outfit |
| `.piano-roll__mode-note` | 13 | Outfit |
| `.arrangement-instrument-chip__swap` | 11 | JetBrains Mono |
| `.arrangement-bars-row .oj-time-ruler` | 11 | JetBrains Mono |
| `.arrangement-clip__fault` | 11 | JetBrains Mono |
| `.piano-roll.is-drums .piano-roll__key` | 11 | JetBrains Mono |
| `.oj-waveform-view__crop` | 11 | JetBrains Mono |

Contrast, resolved through a 1×1 canvas (never a regex over `oklch`), composited at the
declared opacity over the real ground:

| mark | theme | measured | report | floor |
|---|---|---:|---:|---:|
| scroomer note map | light | **7.77** | 7.76 | 4.5 |
| scroomer note map | dark | **7.01** | 7.01 | 4.5 |
| record-ghost captured notes | light | **8.15** | 8.23 | 4.5 |
| record-ghost captured notes | dark | **7.24** | 7.20 | 4.5 |

**The item-13 deviation is right, and I would have made it.** The two renames are provably
free: `--timeline-automation-line` and `--universal-connection` are byte-identical in both
themes (`oklch(0.66 0.19 300)` light, `oklch(0.72 0.19 300)` dark — read off the live root),
so the draw ghost and the step cursor change name and not one pixel. The two marks that
have to be *read* took inks instead, and the numbers above are why: the automation-line
violet would have landed both at ~3, which is W6-BASE's B2/B3 all over again with a
different token name. Naming law satisfied either way; legibility satisfied one way.

### Item 8 · honesty items — **VERIFIED**

`historyStore.ts:73-92` (per-driver apply order), `keymap/types.ts:23-40` (`entries` order
is the only tiebreaker), `Slider.css:130-152` (`transition: none`), and
`KeybindingsPanel.test.tsx` at `15000` with the reasoning and the "a failure *at* 15s IS a
regression" clause. `reducedMotionContract.test.ts` is a genuine repo-wide sweep of `src`
and `packages/oj-ui/src` — no empty rules, no re-added durations, the two exemptions pinned.

### Item 9 · docs truth — **VERIFIED, with F9/F10**

- `AGENTS.md`: `'technical'` → `'control'` in the law *and* in both trailing examples;
  `--universal-port` → `--universal-connection`; the `audioUtils.ts` ghost replaced with
  `spawnPlacement.ts` (which exists); the retired-hex clause now names the enforcing test.
- **Token removal is consistent.** `git grep` finds `--universal-port` in no shipping
  source, sheet or generated file. Re-running `bun run tokens` leaves `git diff --stat`
  **byte-for-byte identical** — the four generated artefacts really are what the JSON says.
- **DESIGN.md's "53" is correct**: `Object.keys(light.json.color).length === 53`, dark 53,
  key sets identical. Both front-matter palettes and the legend row are clean.
- The reduced-motion claim is restated rather than patched, and both halves are gated.
- `docs/timeline.md`: `M` reattributed to the metronome with the Mix-button pointer;
  bare `=`/`-` at both `:65` and `:262` with the `matchesKeyCombo` reason; the
  `--accent-two-ink` gap removed as shipped; the drum gap removed; the bare-arrow gap
  re-verified and marked.
- `docs/shell.md`: the record-disabled reason is quoted **verbatim** —
  `TransportPillHost.tsx:225` is `'Arm a track first — open the arrangement with Tab'`;
  the two-press `Shift+Tab` correction; and ports-not-tabbable is recorded as an open P1
  decision with both branches spelled out, which is the honest shape.

### Item 10 · Gates — **all six green, re-run fresh on this tree**

```
bunx tsc --noEmit -p tsconfig.app.json                              exit 0
bun run lint                       $ eslint .                       exit 0
bun run test:run                   238 files / 2711 tests passed    exit 0
bun run build                      PWA precache · rolldown          exit 0
bun run test:cli                   52 pass, 0 fail, 163 expect()    exit 0
bunx figma connect parse (oj-ui)   parsed OK (CLI v1.4.8)           exit 0
```

The KeybindingsPanel flake did not reproduce. The suite is genuinely green.

---

## Ruling — the MIDI-bus disagreement

**The lane is right; FINAL-REVIEW §1(c) was wrong, and its stated reason is factually
incorrect.**

FINAL-REVIEW cleared `MIDIIntegration.tsx:128` and `midiStore.ts:494,503` on the grounds
that "they create/rename a node the player then sees and owns, so an undo entry is
defensible". Read against the code, they do neither:

- `midiStore.handleDeviceConnected` (`:487-512`) iterates
  `useGraphStore.getState().nodes.values()` and only enters either branch when it has
  already **found an existing node** matching the device id or its signature. It writes
  `{ deviceId, isConnected: true }` and returns. If no node matches it falls through to
  `pendingDevices` — a toast — and creates nothing.
- `MIDIIntegration`'s reconnect effect (`:107-137`) is guarded by `if (!data?.deviceSignature) continue`
  and only writes for a node it already found in the store.
- The node-CREATING paths are `handleAddDevice` (`:184-232`) and `handleSelectDevice`'s
  fall-through — both go through `addNode`, both untouched, both still record. The
  browser's own device picker (`MIDIIntegration.tsx:254,261`) also still records, which is
  right: that is the player choosing.

So the writes are pure re-arming of a card the player already owns, triggered by a physical
event on the bus. Undoing one would mark a plugged-in controller disconnected — a lie about
the hardware, spent out of the player's undo budget mid-set. `{ record: false }` is the
correct call on all four sites, and the same reasoning carries `MicrophoneNode.tsx:160`
and `SpeakerNode.tsx:139`, which FINAL-REVIEW left as "worth a decision": an unplugged
interface recovering to `default` is the environment repairing itself, and undo must not
offer to re-select a device that no longer exists.

The lane's risk #4 ("if the reviewer disagrees, those four call sites revert
independently") does not need to be exercised.

---

## Claims I could not verify

- **The beat rig rendered in drum mode.** I confirmed the kit path end to end in the live
  app by renaming a track (both rolls flip together), and the beat rig's three signals by
  code inspection, but I could not drive the onboarding "Build a beat" goal headlessly —
  the goal buttons did not respond to a `getByRole('button', {name: /beat/i})` walk, and
  `window.__openjammerE2E` was absent on that reloaded page. The claim is very likely
  correct; it is inference plus an adjacent render, not the render the brief asked for.
- **Anything a performer hears.** No audio device. FINAL-REVIEW §7's founder checklist is
  still owed in full, including double-Stop *timing*.
- **The native tier.** Everything here is the browser tier.
- **The armed-glyph appearance in both themes.** Asserted by geometry in jsdom and by one
  Ladle story; no light/dark capture.
- **Visual baselines.** The lane is right that its type-size and two mark-colour changes
  **will** move pixels in the arrangement, the roll and the waveform view.
  `e2e/visual-baselines.spec.ts-snapshots/` was captured at `8809c77`, before these edits.
  **The baselines must be re-captured before merge, and the diff must be looked at rather
  than accepted.** F1/F2/F4/F5, if fixed, will move more.
- **`.arrangement-instrument-chip__swap` and `.arrangement-section-chip` at their new
  sizes.** Both compute correctly (11px mono / 13px sans) but whether a 13px name still fits
  a 17px chip with a 15px line box, and whether an 11px mono chevron still reads as a
  chevron, is a taste judgement on a real screen. Flagged for the founder pass, not
  measured as a defect.

---

## Recommended order to land the fixes

1. **F1 + F2 + F9** together — one vocabulary pass across `nodeInternals`, `portSync`,
   `dynamicRegistry`, `nodeStandards` and the two authoring docs, with the
   `portVocabulary` gate widened to see all three sources. Anything less leaves the
   screen FINAL-REVIEW photographed unchanged.
2. **F3** — it is the agent's shipped contract; the alias is four lines and the doc fix is
   three.
3. **F4** — the roll's second trap; mechanically identical to the fix already written.
4. **F5, F6, F7, F8, F10, F11** — all small, all independent.
5. **Re-capture the 18 visual baselines last**, in the same commit as the CSS-touching
   fixes, per W6-BASE risk #4.

---

## One thing that is not the lane's, and must not be swept into its PR

**A second lane is writing Rust into this same working tree, live, during this review.**
At the start of this pass `git status --short` listed no `crates/**` and no `Cargo.lock`.
By the end it listed nine:

```
 M Cargo.lock
 M crates/ojcore-dsp/src/guards.rs      (+50)
 M crates/ojcore-dsp/src/lib.rs         (+29/-…)
 M crates/ojcore/src/exec.rs
 M crates/ojcore/src/lib.rs             (exports SanitizeReport)
 M crates/ojcore/src/resilience.rs      (+108)
 M crates/ojhost/src/node.rs
 M crates/ojhost/tests/robustness.rs
 M crates/ojinstrument/src/sampler.rs
```

These are substantive feature edits, not build artefacts, and **they are not W6-SHIP's**.
I did not touch them and I have not reviewed them. Two consequences:

1. Whoever stages the `canari` PR must **not** `git add -A`. The W6-SHIP change set is the
   TS/CSS/docs/tokens files listed at the top of this document and nothing else.
2. The six gate results above were measured against a tree that has since grown a Rust
   delta. They are TypeScript gates and none of them compiles the crates, so the exit codes
   stand — but `cargo test` / `cargo clippy` were **not** run by this review and the Rust
   side is unmeasured.
