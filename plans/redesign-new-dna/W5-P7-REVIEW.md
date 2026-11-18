# W5-P7 REVIEW — the media faceplates: Looper, Sampler, SamplerVisual, Library

Gatekeeper: Opus 5. Read-only — **no source edits, no git writes**. Branch
`t3code/openjammer-redesign-timeline`, uncommitted worktree.
Evidence (78 captures, 4 harnesses, 6 probes, 10 result JSONs + `MEASUREMENTS.json`):
`plans/redesign-new-dna/.scratch/w5-p7-gate/`. Playwright under `node`, one Chromium,
dev server on 5226 (`bun dev --port 5226 --strictPort`), **stopped**.

---

## Verdict

# COMMIT-AFTER-FIXES

Three fixes, all small and all in this lane's own files. The rewrite is a real improvement
over what is on disk — one `NodeShell` per card, sockets as `PortRow` wells, zero native
dialogs, in-card confirms that genuinely take and return the keyboard, zero literal
colours, zero console errors in eight browser sessions — and every number the report
publishes reproduced under my own independent measurement. But the lane's contrast sweep
never rendered a **populated Library**, and that is precisely where it fails: four of four
tag chips fall below 4.5:1 in dark. Two smaller regressions (a deleted control and a lost
`aria-selected`) are undisclosed and one-line each.

---

## Gates — re-run by me, not taken on trust

| Gate | Result |
|---|---|
| `bun run test:run -- src/components/Nodes src/utils` | **19 files, 357 tests, 0 failed** on the final re-run. `w5p7Faceplates.test.tsx` **40/40 green**. (One red on my first pass — another lane's, see below — cleared while I was reviewing.) |
| `bunx tsc --noEmit -p tsconfig.app.json` | **1 error, not this lane's**: `src/engine/__tests__/nodeTypeMigrations.test.ts(86,25)` — an untracked file from the node-type-migration lane. Zero errors in any P7 file. |
| `bunx eslint src/components/Nodes src/utils` | **0 problems** |
| `git diff --check -- <11 lane paths>` | **clean** (CRLF notices only, repo-wide) |
| `tokenLiteralGate.test.ts` | **6/6 pass** |
| `grep -nE '#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\('` over the 5 lane CSS files | **empty** |
| `grep -n 'filter:\|drop-shadow'` over the 5 lane CSS files | **empty** |
| `grep -rn 'prefers-reduced-motion' src/components/Nodes/` | only the *test* that forbids it — **no component ships its own block** |
| `grep -rn 'color-mix(in srgb' src/components/Nodes/` | only the *test* that forbids it |
| `confirm(` / `alert(` / `prompt(` in the four lane TSX | **zero** (HEAD had three `confirm()` in `LibraryNode`) |
| Browser: light, dark, light+reduced-motion, 8 page loads | **0 console errors, 0 page errors, 0 native dialogs**, every run |

**The tree moved under me.** My first run had one red — `portDomContract.test.tsx > covers
every registered node type`, which asserts `TYPES.length > 30` and got exactly 30, because
the in-flight node-type-migration lane deleted six types from `src/engine/registry.ts`
(`keyboard-key`, `piano`, `cello`, `electricCello`, `violin`, `saxophone`). Neither file is
in this grant, and that lane has since adjusted the test; the final re-run is fully green.
All 15 per-type socket assertions — **including `library`, `sampler`, `sampler-visual`** —
pass. The `tsc` error is the same story: `src/engine/__tests__/nodeTypeMigrations.test.ts`
is that lane's brand-new file.

*Correction to the report's gate table:* it claims "20 files, 385 tests". On the current
tree it is **19 files / 357 tests**. The delta is other lanes moving under it, not a P7
regression, but the numbers should not be re-quoted.

---

## 1. Behaviour frozen — verified in the running app

### Ports and the DOM contract

| Card | Ports rendered | `data-node-id` / `data-port-id` / `data-port-type` |
|---|---|---|
| Looper | `audio-in`, `audio-out` (audio/audio) | 2/2 complete |
| Sampler | the panel-synced control-in + audio-out | 2/2 complete |
| Library | `sample-out` (audio) | 1/1 complete |
| SamplerVisual (10-key row wired) | `placeholder-in` + `row-<id>-key-0…9` | **11/11 complete, every one `control`** |

The Sampler's live ids are panel-derived
(`input-panel-…:empty-…` / `output-panel-…:audio-out`) rather than the registry's
`bundle-in` / `audio-out` — **identical to HEAD**, which used the same
`node.ports.find(...)` lookup. Not a lane change. The per-key id template
`` `${row.rowId}-key-${index}` `` (`SamplerVisualNode.tsx:287`) is byte-identical to
HEAD:277.

Exactly **one `.oj-node__header`** per card, on all four.

### e2e accessible names

`grep -rn "getByRole\|getByTitle\|getByLabel" e2e/ | grep -i "loop\|sampl\|librar"` returns
exactly one hit — `e2e/journeys/J2-recording-session.spec.ts:27` `getByTitle(/Enable loop/)`
— which is the **timeline transport**, not the Looper node. Nothing in `e2e/` binds to any
string this lane changed. The `LOOP → PLAY` state-chip rename is safe.

### The in-card confirms — all three, both themes

| Check | Looper: delete a layer | Looper: clear all | Library: delete a tag |
|---|---|---|---|
| `role="alertdialog"` + `aria-label` | ✅ `Delete Loop 1?` | ✅ `Delete every layer` | ✅ |
| Safe answer focused on open | ✅ `Keep` (`data-autofocus`) | ✅ `Keep them` | ✅ `Keep it` |
| Destructive answer never focused | ✅ | ✅ | ✅ |
| Escape is an answer, destroys nothing | ✅ layer survives | ✅ all layers survive | ✅ tag survives |
| Focus restored, never `<body>` | ✅ **to that row's own delete button** (`data-loop-id` matched) | ✅ to `.looper-clear`, `:focus-visible` true | ✅ to `Delete tag pads`, `:focus-visible` true |

This is the best part of the lane. The `useConfirmFocus` unforking is real and it works
under the pointer *and* the keyboard, in both themes. Zero native dialogs across every run.

### Undo — the honest answer, and it is not what a reader would assume

| Action | Undoable with Ctrl+Z? | Measured |
|---|---|---|
| Sampler: load a sample | **yes** | `Ctrl+Z` restores `tone.wav` into the slot, both themes |
| Sampler: clear the sample | **yes** | ✅ |
| Sampler / SamplerVisual: every knob + row value | **yes**, one step per sweep | `useGestureBracket` verified in code |
| Looper: loop length, MIX | **yes**, one step per sweep | ✅ |
| **Looper: layer mute** | **NO** | and `Ctrl+Z` then **deletes the whole Looper node with both recorded takes** (`probe8`: `looperNodes 1 → 0`) |
| **Looper: layer delete** | **NO** | same — `probe9` step E: `rows 1 → 0, looperNodes 1 → 0` |
| **Library: rename** | **NO** | `probe`/gate3: name unchanged after `Ctrl+Z`, both themes |
| **Library: trash / delete tag / empty trash / tag removal** | **NO** | gate3: row count unchanged after `Ctrl+Z` |

Mechanism: `graphStore`'s `set` wrapper records a history entry for **every** graph
mutation (`graphStore.ts:262-274`), so anything that writes `node.data` is undoable; but
the Looper's layers live in the engine handle and the Library's items live in
`libraryStore` — neither is in the graph undo stack. So the last graph entry is still
"add the node", and `Ctrl+Z` after a Looper action removes the card and everything on it.

**This is pre-existing** — HEAD's Looper had the same handle-only layer model and the same
`handleUndoLast` / `title="Undo last layer"`. It is not a P7 regression and I am not
blocking on it. It is, however, the single most dangerous thing on these four cards, and
the lane's new `Undo layer` ghost button sitting one keystroke away from a `Ctrl+Z` that
eats the whole performance makes it worse, not better. Founder item, ranked below.

### Keyboard operability

Tabbables per card: Looper **11**, Sampler **6**, Library **1** (empty) / 12 (populated) —
all reachable, all with `aria-label`s, `aria-pressed` on both toggles.

**But you cannot Tab to any of them.** One `Tab` from the canvas moves focus to
`.arrangement-surface` and **swaps the visible surface to Arrangement**, hiding every node
(`probe2`: `looperVisible: false`, segmented control reads `Arrangement`). This is the
app-level trap W5-P6's review already logged as F7; it is not in this grant, and I worked
around it with keyboard-modality + programmatic focus. It blocks the Wave-6 keyboard-only
pass, not this commit.

---

## 2. Visual fidelity and taste

Against `DESIGN.md` §1–6 and the handoff. Verified in the browser, both themes.

**What holds.** Sockets are 18px recessed wells in the first body row, inputs left /
outputs right; nothing glows (`filter` is `none` on every element inside all three cards);
**one** focus vocabulary — the record button reads
`inset 0 0 0 1px var(--accent-danger), var(--focus-ring)`, i.e. the ring *stacked* over the
element's own shadow with `outline: none`, exactly as §4 specifies, and there are **zero
static outlines** anywhere inside the cards; pads lift `translateY(-2px)` on hover with
`120ms/260ms` transitions and press to `scale(.94)`; motion is `--motion-fast` /
`--motion-spring` only; the drop target is the house `1.5px dashed --accent-primary` drawn
as an *outline* at `outline-offset: -1.5px`, and the box does not resize (`SamplerNode.css:48-53`,
verbatim the `WaveformView.is-drop-target` pattern at `WaveformView.css:87-90`);
`.sampler-slot.has-sample` correctly disappears so the clip card owns its single edge; the
four Knobs are 44px `role="slider"`; every selection is an **edge**, never a drench
(`.library-file-row.is-multi-selected` = `--bg-tertiary` + a 1px accent inset + an
`--accent-ink` label). The controls are the shared ones: `Button`, `Chip`, `Knob`,
`ValueScrubber`, `KeyTile`, `WaveformView`, `Waveform`, `Meter`, `List`/`ListRow`, `Input`,
`Callout`, `ProgressBar`, `NodeShell`, `PortRow`.

**Reduced motion** (`prefers-reduced-motion: reduce`, measured): the recording breath
collapses to `1e-05s`, and the state survives intact — a 12% danger wash, a **static 2px
`--accent-danger` ring**, `--danger-ink` label, the `REC` chip, the card's danger border and
the trace bed's danger hairline. The only elements still transitioning are `.oj-meter__fill`
at 120ms, which is one of the **two documented exemptions**. Correct.

### One forked control

`.looper-record` (`LooperNode.tsx:864-882`, `LooperNode.css:114-197`) is a bare `<button>`
that re-implements `--bg-tertiary`, `--radius-md`, Outfit 600/13, hover mix, `scale(.96)`
press, the focus ring and the disabled fade — i.e. `oj-ui Button variant="danger"` with a
ring and an animation on top. Everything else in the lane uses the library. Non-blocking
(it is 40 lines and it is measurably correct), but it is the one place a future token
change will silently miss.

### The three weakest moments per faceplate

**Looper** (`01/07/08/52/53`)
1. **The layer waveform is 24px wide.** Measured on a 220px row inside the 252px card:
   name 66px, actions 110px, trace **24px**. A 24px `Waveform` is a teal dash, not audio —
   and "sound is visible" is this card's own argument. Either widen the card, or drop the
   per-row trace and give the length + name the room.
2. **The trace bed is the largest object on the card and it is empty at rest** — a 46px
   grey well whose only mark, `.looper-live__base`, measures **1.09:1 light / 1.13:1 dark**
   (`--border-subtle` on `--bg-tertiary`), i.e. invisible. An idle Looper's dominant shape
   says nothing.
3. **`Record` is disabled and silent before the audio context exists.** First render is a
   greyed-out primary action with no sentence explaining why. On a first run that reads as
   broken, not as "press play first".
   *(Runner-up: `.looper-mix__hint` is three lines of prose for a knob labelled MIX.)*

**Sampler** (`02/20/21/80`)
1. **A normalised sample paints as a horizontal rule on the card's top border.**
   `oj-ui Waveform` maps a peak of 1.0 to `y = 0` with no bleed, so the flagship object —
   "the card IS the sample" — renders a loud 0.6s tone as a line hugging the edge. The lane
   fixed exactly this in its own inline trace (`TRACE_BLEED`) and could not fix it in the
   shared component. It is the most visible defect on the best idea in the lane.
2. **The four dials are always shown, the sentence is not.** The lane correctly hides the
   SPREAD explanation until a row is wired (`SamplerNode.tsx:702`) — but leaves the SPREAD
   *knob* live and turnable when it controls nothing. Hide the control on the same
   condition, or drop the conditional on the sentence.
3. **`ROOT C4` … a wide gap … a bare `✕`.** The only destructive control on the card is an
   unlabelled glyph at the same visual weight as the value beside it, with nothing between
   them.

**SamplerVisual** (`81/82`)
1. **The key map does not map keys to notes.** Pads read `1 … 10`. The card already knows
   ROOT and SPREAD (the `aria-label` says *"Key 1, +0.0 semitones"*), so it could print
   `C4 D4 E4 …` — the one question the inside view exists to answer. Today it prints an
   index.
2. **A `KeyTile` that is not playable.** The file's own docstring says a pad is "a PATCH
   POINT, not a trigger", yet it uses the component `DESIGN.md` §5 defines as *"the playable
   surface"*, hover-lift and press-scale included. It teaches the wrong affordance; there is
   no held/hit state to find (verified: `.is-active` produces no accent fill here).
3. **The stylesheet's stated geometry is not what renders.** `SamplerVisual.css:13-17`
   declares `width: 268px` and reasons about "six 32px pads"; measured, the pads are
   **48×48** and the card is **402px** wide. The comment argues for a layout that does not
   exist.

**Library** (`03/60/84/85/86/87/88`)
1. **The tag chips fail AA in dark** — see must-fix 1. The card's own rule 3 is broken by
   its own stylesheet.
2. **A long filename is squeezed to 63px by its own tags.** Measured: `kick.wav` gets a
   140px name box; `pad-long-name-that-runs-on.wav` (3 tags) gets **63px** and shows about
   eight characters — while rows 1 and 2 carry a large void between name and duration. The
   name should own the row and the tags should yield, not the reverse.
3. **The left panel spends ~45% of a 500px card on four tags**, most of it the "Drag a tag
   here to keep it at hand" pinned void; the file list — the reason the card exists — gets
   the smaller half.

---

## 3. Contrast — re-measured independently

My own WCAG implementation (canvas composite of the full ancestor background stack +
relative-luminance ratio), not the lane's helper. Both themes, real composited paint.

### Text — corroborates the report where the report looked

| Sweep | Runs | Worst | Floor |
|---|---:|---:|---|
| light — Looper + Sampler + Library, idle | 28 | **4.57** | 4.5 ✅ |
| dark — same | 28 | **4.50** | 4.5 ✅ |
| SamplerVisual key map, 10 pads wired, light / dark | 19 / 19 | 4.57 / 4.50 | ✅ |
| pad labels (10px mono), light / dark | 10 / 10 | **5.49 / 5.05** | ✅ |
| muted layer row, light / dark | — | **4.57 / 4.50** | ✅ |
| in-card confirm (all three), light / dark | — | ≥ 4.57 / 4.50 | ✅ |
| Library selected row (`is-multi-selected`), light / dark | — | ≥ 4.5 on the name (`--accent-ink`) | ✅ |
| Sampler empty-slot hint, light / dark | — | **5.92 / 6.18** | ✅ |
| Looper empty hint, light / dark | — | **7.13 / 6.93** | ✅ |
| active tag **filter** chip, light / dark | — | 17.05 / 14.36 | ✅ |
| **Library file-row tag chips, dark** | 4 | **3.46 / 3.62 / 4.29 / 4.33** | **✗ FAIL** |
| Library file-row tag chips, light | 4 | 4.97 – 5.69 | ✅ |

Disabled controls sit at `opacity .45–.50` over a 4.5 base ≈ **2.0–2.2 composited** — inside
`DESIGN.md`'s documented disabled exception. `--text-on-accent` on `--accent-primary`
measures **5.08 light / 6.27 dark**, on `--accent-secondary` **6.12 / 7.08** — the system
pair is healthy; there is no accent-filled pad state on these faceplates to spend it on. The lane's
Deviation 1 also checks out: `--text-on-accent` on a **solid** `--accent-danger` measures
**3.58 light / 4.95 dark** here, so a saturated Record slab would indeed be unreadable in
light — the 12% wash + `--danger-ink` label (measured **6.72 / 6.39**) is the right call.

### Non-text marks (WCAG 1.4.11, floor 3:1)

| Mark | Light | Dark | Report said |
|---|---:|---:|---|
| Looper playhead (`--accent-ink`) | **5.34** | **5.96** | 5.34 / 5.96 ✅ |
| Looper live trace (`--audio-connection`) | 3.02 | 5.79 | 3.02 / 5.79 ✅ |
| Looper live trace, recording (`--accent-danger`) | **3.96** | **4.28** | — |
| Socket well ring (`--border-control`) | 3.64 | 3.96 | 3.03 / 3.53 (measured against the well fill; both clear) |
| Sampler empty-slot invitation edge | 3.64 | 3.96 | ✅ |
| Sampler waveform trace | 3.27 | 7.19 | 3.27 / 7.19 ✅ |
| Muted layer trace (`--text-muted`) | 4.57 | 4.50 | — |
| **`WaveformView` card edge** | **1.31** | **1.27** | 1.31 / 1.27 ✅ (oj-ui) |
| Meter unlit track | 1.20 | 1.12 | ✅ (adjacent ground, no floor) |
| **`.looper-live__base` axis** | **1.09** | **1.13** | *not reported* |

`.looper-live__base` is a hairline the report never measured. It is arguably not a
"meaningful mark" (it is a rule, not information), so I am not scoring it a failure — but it
is why the idle trace bed reads as an empty box.

**The report's contrast table is accurate for everything it measured, and incomplete in one
place that matters: it never rendered a Library with rows.** Its harness could not seed the
store (the report says so honestly). I seeded it through the Vite module graph and the
failure appeared immediately.

---

## 4. The five oj-ui failures the lane blames on others — judged independently

| # | Claim | Real? | Blocks this commit? | One-line fix |
|---|---|---|---|---|
| 1 | `WaveformView` edge 1.31 / 1.27 | **YES** — `WaveformView.css:6` `border: 1px solid var(--border-subtle)`; I measured 1.31 / 1.27 in the running Sampler | **No** — oj-ui, W4-P3's lane, and `DESIGN.md` §2 already ruled it for `--timeline-clip-border` | `WaveformView.css:6` → `border: 1px solid var(--timeline-clip-border);` |
| 2 | `Meter` lit bar 2.61 light | **YES** — `Meter.css:39` `background: var(--accent-success)` on `--bg-tertiary`; no `variant="bed"` and no `--oj-meter-track` exist anywhere | **No** — oj-ui; belongs with W5-P6's F1 | `Meter.css:39` → `background: var(--success-ink);` |
| 3 | `Chip` label 12px sans | **YES**, but on the **root**, `Chip.css:11 font-size: 12px` (a hard literal), not `.oj-chip__label`. Reproduced in three of the four faceplates. `DESIGN.md` §5 *specifies* 12px for Chip while §3's 13px Floor forbids it — the two docs disagree | **No** — the component matches its own spec; this is a docs decision | `Chip.css:11` → `font-size: var(--text-sm);` **or** name Chip as §3's second exception |
| 4 | `IconButton` not `forwardRef` | **YES** — `IconButton.tsx:36` is a plain function while `Button.tsx:40` is `forwardRef`. `...rest` *does* reach the DOM, so `data-*`/`title`/`aria-*` survive | **No** — **zero blast radius**: no lane file passes a ref to `IconButton` | wrap `IconButton` in `forwardRef` and pass `ref` to `Button` |
| 5 | `Waveform` clips its extremes | **HALF TRUE — and the report's follow-up is wrong as written.** The mapping does land on the viewBox edge (`Waveform.tsx:110-130`, `viewBox="0 0 1000 100"`), but `Waveform.css:9` sets **`overflow: visible`** and the stroke is `vector-effect: non-scaling-stroke` at 1.5px, so the 0.75px overhang is *painted, not cut*. Nothing is clipped today | **No** | if parity is wanted: add a `TRACE_BLEED = 3` to the viewBox (`Waveform.tsx:74`). **Do not** "fix" it by adding `overflow: hidden` — that would create the bug |

The Looper's own `TRACE_BLEED` fix is still correct and still needed: `.looper-live`
(`LooperNode.css:44`) *does* set `overflow: hidden` around its inline SVG. The report should
narrow its follow-up to "the shared `Waveform` is one `overflow: hidden` ancestor away from
this bug", not "has the identical issue".

---

## 5. Report vs diff — honesty

The report is unusually candid (its "What I could NOT verify" section is exemplary) and
claims **1–5, 7, 8 and 9 all check out** against the diff. Three things do not.

**a. "Kept, unchanged" is overstated on five counts, all undisclosed:**

- **A Looper feature was removed.** HEAD opened an inline export-name field
  (`beginExportRename` / `commitExportRename`, `<input class="looper-rename-input"
  placeholder="Export name…">`, Enter commits / Escape cancels). Now `handleExport`
  (`LooperNode.tsx:577`) writes straight to the library under the layer's transient display
  name. The verb survived; the naming step did not.
- **Two Looper controls are new and unmentioned**: `handleClearAll` (`:560`) and the
  silence-all toggle (`:543` / `.looper-silence` at `:877`). §1 discusses the clear-all
  *confirm* as if the button were inherited.
- **`setWet` undo granularity changed** — per-tick `beginGesture/endGesture` (HEAD:427) →
  `useGestureBracket` (`:624`, `onCommit={mix.end}`). Better; still a change, listed under
  "Kept, unchanged".
- **`updateSamplerRow` is now gesture-bracketed** (`SamplerVisualNode.tsx:243-252`), and
  five Sampler params gained brackets (`SamplerNode.tsx:439-477`). Also better; also listed
  as "Kept".
- **The ERR-1 marker lost its accessible name**: HEAD had
  `<span aria-label="Sample failed to load">`; the Callout that replaced it has no
  equivalent, and its title *"Sample is silent"* disagrees with its own body
  (*"could not be found on this machine"*).

**b. Claim 6's number contradicts the code it ships.** The report says the playhead measures
5.34 / 5.96 (twice); `LooperNode.css:81`'s comment says *"Measured after: 5.03 light / 5.42
dark"*. My measurement is **5.34 / 5.96** — the report is right and **the shipped comment is
wrong**.

**c. The dead-CSS claim is scoped to four files and the fifth is dirty.** "zero unemitted
selectors in all four owned stylesheets" is **true** — Looper / Sampler / SamplerVisual /
Library are clean. But the lane also edits `_sockets.css`, and that file carries **four
orphan blocks (~40 lines)** with zero emitters anywhere in `src/`, `packages/oj-ui/src` or
`e2e/`: `.port-row` (+`.input`/`.output`, `:25,33,38,42`), `.port-label` (`:56`),
`.keyboard-schematic-body` (`:69-80`), `.instrument-output-port` (`:107`). Its own new
comment says *"The rules are deleted rather than kept 'just in case' (code value #8)"* while
leaving them in place, and the report's follow-up cites the wrong line (`:69-80` is
`.keyboard-schematic-body`, not `.instrument-output-port`). `.bundle-port-row` is the only
live half of the shared `:25` rule (`BundlePortGroup.tsx:83,155`).

**d. `formatSampleDuration` is honest.** Logic is byte-identical to the four copies it
replaces, plus a `!Number.isFinite || <= 0 → '0s'` guard. Nothing in `e2e/` or the unit
tests reads a duration string. No smuggled value change.

---

## Ranked must-fix (each `file:line` + the exact change)

### M1 — The Library's file-row tag chips fail AA in dark. **Blocking.**

`src/components/Nodes/LibraryNode.css:390`

```css
.library-file-row__tag.oj-chip {
    cursor: pointer;
    max-width: 76px;
    overflow: hidden;
    background: color-mix(in oklab, var(--tag-color) 22%, transparent);   /* ← line 390 */
}
```

Measured, dark, four tags, at rest and unselected (`tagcontrast-dark.json`):
`--text-secondary` `rgb(171,168,156)` on the tag-hue wash →
**drums 3.62 · pads 3.46 · soft 4.29 · warm 4.33**. Light passes (4.97–5.69).

`--tag-color` is `getTagColor(tag)` — an `hsl(hash % 360, …)` derived from arbitrary user
text. In dark those hues sit *above* `--bg-tertiary` in luminance, so a 22% wash lifts the
ground toward the text and collapses the ratio. **This cannot be made provably AA**: the
hue is unbounded user data under a fixed text token, so a different tag name gives a
different, unpredictable ratio. It also breaks the file's own docstring rule 3
(`LibraryNode.tsx:24-26`): *"A tag's colour is its identity, never its legibility."*

**Fix — delete the declaration:**

```css
/* LibraryNode.css:390 — delete this line */
    background: color-mix(in oklab, var(--tag-color) 22%, transparent);
```

The chip then sits on `--bg-tertiary` like every other chip in the app (4.57 / 4.50,
guaranteed), and the tag's identity is carried where it already is and already measures
12.81 / 14.17: the `--tag-color` dot and the tag name in the left panel
(`.library-tag__dot`, `LibraryNode.css:143-150`).

**Then check the sibling** `.library-filter-chip` (`LibraryNode.css:225`), which uses the
identical construction. It measured 17.05 / 14.36 in my run only because no `--tag-color`
was set on it in that state; the rule is the same trap. Either remove it too, or pin it with
a test.

*(Add the populated-Library case to the lane's browser sweep — its harness never rendered a
tag chip, which is why this got through.)*

### M2 — Taking a tag off a file is no longer reachable from the keyboard. **Blocking.**

`src/components/Nodes/LibraryNode.tsx:1177-1194`

HEAD rendered a real control inside each file-row tag badge:

```tsx
<button className="tag-remove-btn"
  onClick={…removeTagFromItem(item.id, tag)}
  onKeyDown={…Enter/Space → removeTagFromItem…}
  title={`Remove ${tag} tag`} aria-label={`Remove ${tag} tag`}>×</button>
```

Now the only path is `onDoubleClick` on the `Chip` (`:1190`), while the chip's own
`onKeyDown` binds Enter/Space to **filter**. So the action has no keyboard route, no
accessible name, and is discoverable only through the tooltip
*"Filter by {tag}. Double-click to take it off this file."*

**Fix — restore an explicit control inside the chip's row, next to the trash button:**

```tsx
// LibraryNode.tsx — in the `actions` cluster, after the visibleTags map (~:1200)
{visibleTags.map((tag) => (
  <IconButton
    key={`rm-${tag}`}
    variant="ghost"
    className="library-file-row__untag"
    label={`Remove the ${tag} tag from ${item.fileName}`}
    onClick={(e) => { e.stopPropagation(); removeTagFromItem(item.id, tag); }}
    icon={<IconClose size={11} />}
    title={`Remove ${tag}`}
  />
))}
```

and drop the `onDoubleClick` from the `Chip` (`:1190`) so one gesture owns one job.
(If a per-tag button is too heavy at 76px, the acceptable alternative is to keep the
double-click **and** add `onKeyDown` handling for `Delete`/`Backspace` on the focused chip
with a matching `aria-keyshortcuts` — but a labelled control is the honest answer.)

### M3 — A selected Library row no longer announces itself. **Blocking (one line).**

`src/components/Nodes/LibraryNode.tsx:1154`

HEAD: `aria-selected={isActive || isMultiSelected}` (HEAD:1022).
Now: `selected={isActive}` only — `ListRow` emits `aria-selected` from `selected`, so a row
caught by the marquee or by a plain click before its PCM arrives is visually selected
(accent inset edge + `--accent-ink` label) and **announced as nothing**. Measured live:
`class="oj-list-row library-file-row is-multi-selected"`, `aria-selected: null`, both themes.

**Fix:**

```tsx
// LibraryNode.tsx:1154
-        selected={isActive}
+        selected={isActive || isMultiSelected}
```

(`isMultiSelected` is already in scope at `:1146`. `isActive` still drives the "current
item" dot; this only widens what `aria-selected` reports.)

---

## Non-blocking follow-ups

**Owner: this lane** (cheap, do them with the must-fixes if convenient)

1. `LooperNode.css:81` — the comment says *"Measured after: 5.03 light / 5.42 dark"*. The
   real numbers are **5.34 / 5.96**. Correct the comment or delete the figures.
2. `_sockets.css` — delete the four orphan blocks the file's own comment claims were
   deleted: `.port-row` and its `.input`/`.output` variants (`:33-44`, keep the
   `.bundle-port-row` half of `:25-31`), `.port-label` (`:54-67`),
   `.keyboard-schematic-body` (`:69-80`), `.instrument-output-port` (`:106-109`).
3. `_sockets.css:82-96` — the `!important` port-size rule is now **both stale and a no-op**:
   no `<Port>` anywhere in `src/` passes an inline size (only
   `packages/oj-ui/.../Port.stories.tsx:95` does), and the rule declares the same
   `var(--port-size)` `Port.css:25-26` already declares. Delete the rule and its comment.
   This lane removed the last two offenders (Sampler and Library), so it is the right lane
   to close it.
4. `w5p7Faceplates.test.tsx:706` — the stylesheet-floor gate's `SHEETS` list covers the four
   node sheets but **not `_sockets.css`**, which this diff edits. Add it.
5. `SamplerNode.tsx:619-623` — the ERR-1 `Callout` title *"Sample is silent"* contradicts its
   own body *"could not be found on this machine"*. Title it after the fact
   (*"Sample not found"*), and restore an accessible name equivalent to HEAD's
   `aria-label="Sample failed to load"`.
6. `SamplerVisual.css:13-17` — the comment reasons about "six 32px pads" and declares
   `width: 268px`; measured, pads are 48×48 and the card renders 402px. Fix the comment or
   the geometry.
7. `LibraryNode.tsx:1160-1164` — the new `Delete`/`Backspace`-trashes-a-row shortcut is
   undocumented in the report and has no confirm. It is reversible via Restore and I am not
   blocking, but it deserves an `aria-keyshortcuts` and a line in the report.
8. Consider replacing `.looper-record`'s bespoke button with
   `<Button variant="danger" className="looper-record">` plus only the ring + breath
   overrides (`LooperNode.css:114-197`). One less place a token change can miss.
9. The three ranked taste items per faceplate in §2 — especially the **24px layer waveform**
   and the **key map that prints indices instead of notes**.

**Owner: oj-ui lane**

10. `WaveformView.css:6` → `--timeline-clip-border` (1.31/1.27 today; `DESIGN.md` §2 already
    decided this for the identical object). **This one visibly bites the Sampler's headline
    clip card**, so it should be sequenced early.
11. `Meter.css:39` lit bar → `--success-ink` (2.61 light).
12. `Chip.css:11` `font-size: 12px` → `var(--text-sm)`, **or** amend `DESIGN.md` §3 to name
    Chip as the second 12px exception. §3 and §5 currently contradict each other and three
    faceplates in this lane inherit the conflict.
13. `IconButton.tsx:36` → `forwardRef`. Also refresh its docstring, which still describes
    the retired hand-drawn language.
14. `Waveform.tsx:74` viewBox bleed — optional; nothing is clipped today
    (`Waveform.css:9 overflow: visible`).
15. `PortRow`/`KeyTile`: a `KeyTile` variant that is honestly a *patch point* rather than a
    playable surface would let `SamplerVisualNode` stop borrowing the playable component.

**Owner: founder / other lanes**

16. **No Looper action is undoable, and `Ctrl+Z` after one deletes the whole Looper node
    with every recorded take** (measured twice, `probe8`/`probe9`). Pre-existing, but it is
    the worst outcome on stage in the whole wave. Either put layer commits/mutes on the
    history seam, or make the Looper node's own deletion require a confirm while it holds
    audio.
17. **No Library action is undoable** — rename, trash, tag delete, empty trash all live in
    `libraryStore` and never reach the graph undo stack (measured, both themes). The in-card
    Callout is the entire safety net for the three permanent ones; rename and tag-removal
    have none.
18. **One `Tab` on the canvas swaps the surface and hides every node** (W5-P6 F7, still
    live). Until it is fixed no node faceplate is keyboard-reachable, which makes the
    Wave-6 keyboard pass impossible.
19. `getTagColorDark` (`src/store/libraryStore.ts:180`) lost its last consumer in this diff
    and is now a dead export (code-value #8).
20. `setLoadError` (`SamplerNode.tsx:79-85`) comments that it is "correctly non-undoable" —
    but `graphStore.ts:262-274` records a history entry for **every** graph mutation, gesture
    or not, so an ERR-1 detection at mount pushes an undo entry the player did not make.
    Pre-existing; worth an explicit `isApplyingHistory`-style suppression.
21. `e2eBridge` still has no `seedLibrary` verb. I got round it by importing
    `/src/store/libraryStore.ts` through the Vite module graph inside `page.evaluate`, which
    **does** hit the live instance (3 rows rendered) — worth adding to the bridge so the next
    gate does not have to discover it.
22. `portDomContract.test.tsx > covers every registered node type` is red because the
    node-type-migration lane took `TYPES.length` to exactly 30 against a `> 30` assertion.
    Whoever lands that lane owns the threshold.
23. The Library offers **"Delete tag trash"** alongside real tags; deleting the system trash
    tag would un-trash everything. Edge case, pre-existing, but it is a destructive
    confirm-guarded action on an internal token.

---

## What I could not verify

- **Feel.** Nothing was heard. The record path is proven to reach the engine, commit a
  layer, paint 1834 characters of live trace and ride `meterScale`, but whether the Looper
  feels right with a loop actually playing is a founder pass. A gate never signs off on feel.
- **A real ERR-1 sample.** The broken-sample state is styled and unit-reachable; I did not
  manufacture a genuinely unresolvable persisted sample in the browser.
- **Library rename persistence.** The field opens focused and commits on Enter (verified);
  a seeded library has no `FileSystemFileHandle`, so the on-disk rename cannot land in a
  harness.
- **The native tier.** Browser only; nothing in this lane is engine code.
- **The real Library scan path.** My rows were seeded through the store, not scanned from a
  folder — so the scanning/progress states and `getItemFile`-backed preview were exercised
  only as far as the store allows.
