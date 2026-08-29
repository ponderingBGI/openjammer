# W5-P7 — the media faceplates: Looper, Sampler, SamplerVisual, Library

> **Filed as `W5-P7-REPORT.md`, not `W4-P7`.** The prompt named Wave 4, but this is the
> Wave-5 faceplate wave in the master plan and every sibling on disk is `W5-*`
> (`W5-P6-REPORT.md`, `W5-P8-REPORT.md`, `w5p6/w5p7/w5p8Faceplates.test.tsx`). Screenshots
> are in `plans/redesign-new-dna/.scratch/w5-p7b/` for the same reason (`w5-p7/` already
> holds the first run's artifacts).

**Resumed run.** The previous P7 pass died mid-flight and left the four faceplates
rewritten but unreviewed in the working tree. I read every owned file against `DESIGN.md`,
the handoff and the P6/P8 gate reviews, kept what was right, fixed nine real defects, and
put the whole thing through vitest + a fresh Playwright gate in both themes.

## Gates

| Gate | Result |
|---|---|
| `bun run test:run -- src/components/Nodes src/utils` + `tokenLiteralGate` | **20 files, 385 tests, 0 failed** (was 364 — this pass adds 21) |
| `bunx tsc --noEmit -p tsconfig.app.json` | **0 errors** |
| `bunx eslint src/components/Nodes src/utils` | **0 problems** |
| `git diff --check` | clean |
| Browser (node Playwright, one Chromium, dev on 5226, both themes, 100% zoom) | **84 ok / 5 fail — all five in oj-ui components outside this grant** |
| Console / page errors | **0 app errors** in every one of the five browser sessions (corrected in P7c: `MEASUREMENTS-3.json` also carries one HARNESS probe error, `"Cannot enter node: node not found nope"`, which the gate script provoked on purpose) |

Dev server stopped. Harness: `plans/redesign-new-dna/.scratch/w5-p7b/gate2.mjs`
(run under `node`). Raw numbers: `.scratch/w5-p7b/contrast-p7b.json`.

---

## What I changed this pass

Everything below is a change I made on top of the inherited (uncommitted) rewrite. The
inherited work was good — one `NodeShell` header per card, ports as real `PortRow` wells
inside the body, no literal colours, no inline style objects, no glow, no bespoke
reduced-motion block, no native `confirm()` — so the fixes are targeted.

### 1. The in-card confirms did not take the keyboard — all three were a fork

`LibraryNode.tsx:1612`, `LooperNode.tsx:911,974`

The inherited code answered "are you sure?" with a danger `Callout role="alertdialog"` and
a `data-autofocus="true"` attribute. **`data-autofocus` is only read by `Modal.tsx:62`** —
inside a node `Callout` it is inert. So the dialog announced into nothing, `<body>` kept
the keyboard, and Tab walked the card behind the question. That is the native `confirm()`
bug with better paint, which is exactly what the shell's `Shell/confirmFocus.ts` (commit
d07c4f6) exists to prevent. Worse, the attribute was on the **destructive** button, i.e.
the opposite of the documented rule ("the safe one first and the focused one").

All three confirms now use the shell helper, unforked and identical to `AppMenuBar` /
`KeybindingsPanel`:

- `useConfirmFocus` with a ref on the SAFE answer — `LooperNode.tsx:247,260`,
  `LibraryNode.tsx:217`.
- `data-autofocus` moved to the safe answer (so it also behaves if the Callout ever
  moves into a Modal).
- **Escape is an answer** — added to all three (`LooperNode.tsx:900,969`,
  `LibraryNode.tsx:1594`); it was missing everywhere.
- Focus restore that never lands on `<body>`: the Looper's clear-all restores to the
  clear button, or to the transport when clearing disabled it; a layer delete restores to
  **that same row** via a new `data-loop-id` on the `ListRow` (`LooperNode.tsx:950`)
  because answering re-renders the action cluster either way; the Library latches the
  control that asked in `askToDelete` (`LibraryNode.tsx:223`) and falls back to the search
  field when the row it came from was just deleted.

Verified in the browser in both themes and in three new unit tests.

### 2. Nine sans runs below the 13px floor

`LooperNode.css:243,337,354` · `SamplerNode.css:94,134` · `SamplerVisual.css:92` ·
`LibraryNode.css:114,231,538`

`--text-xs` is 11px and it is the **mono** voice (DESIGN.md §3, "The 13px Floor").
Every committed faceplate uses it only with `--font-mono`; the inherited P7 files used it
for four prose blocks (`.looper-mix__hint`, `.looper-empty`, `.sampler-empty__hint`,
`.sampler-hint`, `.sampler-visual-hint`, `.library-hint`) and four small sans buttons
(`.looper-undo`, `.looper-layer__confirm .oj-btn`, `.library-add-tag`,
`.library-empty-trash`). All nine moved to `--text-sm` (13px). The one 11px run left is
`.looper-layer__name .oj-editable-label__text`, which is mono (`EditableLabel mono`).

Now pinned by a stylesheet gate (below) **and** by a browser sweep that reads computed
`font-family`/`font-size` on every rendered run.

### 3. `color-mix(in srgb …)` → `in oklab` (13 sites)

`LooperNode.css` ×4, `LibraryNode.css` ×9. The app mixes in oklab in 82 places and in srgb
in 2 (neither mine). One colour space, perceptually correct washes.

### 4. The Sampler's drop target spoke a language of its own

`SamplerNode.css:40-56`

It was `--accent-success` (solid green). Green is machine state, not an invitation
(Signal-Not-Brand Rule), and the app already has exactly one way to say "let go here": a
**1.5px dashed `--accent-primary` outline with `outline-offset: -1.5px`**
(`WaveformView.is-drop-target`, `.audio-clip.drop-target`). The empty well now says it that
way. Drawn as an *outline*, not a border, so the box does not resize under the pointer —
measured `moved: 0px` in both themes.

### 5. A doubled hairline on the loaded slot (found by measuring, not by reading)

`SamplerNode.css:33-37`

`WaveformView` draws its own `1px solid --border-subtle` + `--shadow-raised`. The slot
wrapper drew a second `1px solid --border-subtle` hard against it — a 2px muddy edge, which
the New DNA explicitly forbids, plus 2px of stolen inner width. On `.has-sample` the well
now disappears entirely (`border: none; background: transparent; padding: 0`): one object,
one edge, and it belongs to the clip card. ERR-1's warning edge moved onto the card's own
border (`SamplerNode.css:66`) so the broken state is still unmistakable and still one line.

### 6. The looper playhead was a 2.79:1 mark in light

`LooperNode.css:76-86`

`--accent-primary` on the inset measured **2.79:1**, under the 3:1 WCAG 1.4.11 floor for a
mark you must see to read the card. It now uses `--accent-ink` — the same hue, adjusted
until it clears. That is the Ink-For-Text Rule applied to a 2px line, and the same call
`DESIGN.md` already documents for `--timeline-clip-border`. **Measured after: 5.34 light /
5.96 dark.**

### 7. The live trace was half-clipped at both extremes

`LooperNode.tsx:110-115,812`

The envelope is unipolar, so silence draws **on** `y = TRACE_H` and a full peak **on**
`y = 0` — both on a viewport edge, where `overflow: hidden` eats half the stroke. A quiet
pass therefore looked like nothing was being captured, which is the opposite of "sound is
visible". Three units of bleed at each end (`TRACE_BLEED`) keep the drawing mapping
byte-identical to `oj-ui Waveform` and let the line render whole. The bottom axis was also
named `.looper-live__center` while being drawn at the baseline; renamed
`.looper-live__base`.

### 8. Two headers that said the same word twice

- **Looper**: type chip `LOOP` next to state chip `LOOP` while playing. The playing state
  is now `PLAY` (`LooperNode.tsx:149,751`), joining `ARMED / REC / DUB / PLAY`. Pinned by a
  test that asserts the two chips are never equal.
- **SamplerVisual**: header chip `10 KEYS` next to the row chip `10 keys`. The header now
  says what the card **is** — `KEY MAP` (`SamplerVisualNode.tsx:151`) — which is also
  honest when there are no rows (it used to read `INSIDE`).

This is the same "the header says the row again" defect the W5-P8 review raised (follow-up
#5); I checked for it here because of that review.

### 9. Smaller taste calls

- **Sampler**: the permanent "semitones per key" sentence now appears only when a keyboard
  row is actually wired in (`SamplerNode.tsx:704`) — an idle card stays short, and the
  sentence arrives exactly when SPREAD starts to mean something.
- **Library**: `.library-file-row__len` gets a fixed right-hung box so lengths line up
  down the list (`0.4s` / `1s` on their last digit). Same for `.looper-layer__len`, which
  additionally had the digits touching the mute glyph at 252px.
- **Library**: `.is-multi-selected` was a 12% accent drench. Selection in this system is an
  edge; it now uses `ListRow`'s own grammar (`--bg-tertiary` ground + `--accent-ink` label)
  with one 1px accent edge on top.

---

## Per node

### Looper — `LooperNode.{tsx,css}`

**Kept, unchanged:** every engine verb (`startRecording` / `stopRecording` /
`toggleLoopMute` / `deleteLoop` / `undoLast` / `setWet` / `setDuration` /
`addLoopFromBuffer`), the engine-driven transport (the UI never guesses a state that can
fail to reset), the zero-re-render frame path (a return frame writes refs; one shared
animation frame writes two SVG attributes and one custom property), drag-a-layer-out →
clip, drop-a-clip-in → layer, per-layer export to the library, the `audio-in` / `audio-out`
port ids and their `data-node-id`/`data-port-id`/`data-port-type` markers.

> **Correction (W5-P7b).** "Kept, unchanged" above was overstated on four counts, and the
> P7 gate was right to call them out. What actually changed in W5-P7 and was not disclosed:
>
> 1. **A control was removed.** HEAD opened a separate inline export-name field
>    (`beginExportRename` / `commitExportRename`, `<input class="looper-rename-input"
>    placeholder="Export name…">`). W5-P7 dropped it and `handleExport` began writing
>    straight to the library under the layer's row label. That was a real feature deletion
>    reported as "kept". It stays deleted — see W5-P7b §"The export name" below for the
>    reasoning, now written into `LooperNode.tsx`'s own docstring rather than left silent.
> 2. **Two controls are new**, and §1 above discussed the clear-all *confirm* as though the
>    button were inherited: `handleClearAll` and the silence-every-layer toggle
>    (`.looper-silence`) are both W5-P7 additions.
> 3. **`setWet`'s undo granularity changed** — HEAD called `beginGesture`/`endGesture` per
>    tick; W5-P7 moved it to `useGestureBracket` so a whole MIX sweep is one step. Better,
>    but a change, and it was listed under "unchanged".
> 4. **The ERR-1 marker lost its accessible name.** HEAD had
>    `<span aria-label="Sample failed to load">`; the `Callout` that replaced it had no
>    equivalent, and its title said *"Sample is silent"* over a body about a file that could
>    not be found. Fixed in W5-P7b.

**Design:** layer list on `ListRow` inset rows; transport as one filled control plus two
node icon-buttons; record = a `--accent-danger` **12% wash + 2px danger ring + 1200ms
breath**, which under reduced motion collapses to the wash + the static 2px ring (see
Deviations); level meter is oj-ui `Meter` driven through `meterScale` (`LooperNode.tsx:452`)
so it rides the same dB curve as the Speaker and the transport pill; sockets are `PortRow`
wells in the first body row; nothing glows.

**Browser, both themes:** idle → record → the card takes a danger edge, the trace bed takes
a danger hairline, the button becomes `Stop` with `aria-pressed=true` and `is-recording`,
the header chip reads `REC` (`DUB` when overdubbing) → stop → **1 layer row committed, the
MIX dial appears** → mute → the row takes `is-muted` (a class and a glyph, never colour
alone) → clear-all asks in the card, focuses "Keep them", Escape keeps every layer and
returns focus to the button that asked.

### Sampler + SamplerVisual — `SamplerNode.{tsx,css}`, `SamplerVisualNode.tsx`, `SamplerVisual.css`

**Kept:** `SamplerHandle` seam (`setBuffer` / `setRootNote` / `setGain` / `setAttack` /
`setRelease`), PERSIST-1 (a dropped sample is written into the project library and stored
as an itemId, never as bytes), ERR-1's honest broken-sample state, the clip drag-out
payload, `updateSamplerRow`, the `bundle-in` / audio-out ports and every
`row-N-key-M` per-key port id.

> **Correction (W5-P7b).** `updateSamplerRow` is listed as "kept" but its undo granularity
> changed: W5-P7 wrapped it in `useGestureBracket` (`SamplerVisualNode.tsx:243-252`) and
> gave five Sampler params the same bracket (`SamplerNode.tsx:439-477`). One step per sweep
> instead of one per tick is the right behaviour; it is still a change, not a keep.

**Design:** the slot is a real `WaveformView` clip card — the same object the canvas and the
library show; four bounded parameters are four 44px `Knob`s; the root note is a mono
`ValueScrubber` reading the shared `noteLabel`; the length reads through the new shared
`formatSampleDuration`. Inside, every key is a `KeyTile --pad` with its own embedded
control socket.

**Browser, both themes:** a real 0.6s WAV decoded through the node's own file picker →
`has-sample`, a 634-char trace, `0.6s`, root `C4`. Empty well: dashed `--border-control`
at rest, dashed accent + accent wash on drag-over, zero reflow. Loaded: the clip card draws
the drop edge, the well stays silent. Inside view: **10 pads at 46px, 10/10 carrying
`.oj-port[data-port-type="control"]`**, one header, and a pad hit starts a real cable in
both themes.

### Library — `LibraryNode.{tsx,css}`

**Kept:** the `sample-out` seam, UI-020 (the selection only moves to a sample that actually
arrived — a failed decode leaves the last good one playing), the resize seam reading
`data.width`/`data.height`, tags/pinning/drag-reorder, trash, the marquee, scanning
progress, the per-tag identity hue.

**Design:** rows are `ListRow`, search is the `Input` physics, durations are mono via
`formatSampleDuration`, every destructive question is one `alertdialog` `Callout` that
always renders in the same strip so the list never jumps. **Zero native dialogs** —
asserted in the browser with a `page.on('dialog')` counter and in two unit tests with a
`window.confirm` spy.

**Browser:** 3 seeded files render → search narrows to `kick.wav` → the inline rename field
opens on double-click → delete-tag asks in the card, focuses "Keep it", Escape cancels and
the tag survives → `Ctrl+Z` reverses the node add.

---

## Measured contrast (browser, real composited paint, both themes)

**Text — every run inside the four cards, swept automatically:**

| Sweep | Runs | Worst | Floor | Sans below 13px |
|---|---:|---:|---:|---|
| light — Looper + Sampler + Library | 36 | **4.57** (`LOOP` type chip, 11px mono) | 4.5 | 0 |
| dark — same | 36 | **4.50** | 4.5 | 0 |
| light — SamplerVisual (inside) | 19 | **4.57** (`KEY MAP`) | 4.5 | 0 |
| dark — SamplerVisual (inside) | 19 | **4.50** | 4.5 | 0 |

Worst runs per theme: type chips 4.57/4.50; port labels, layer count, layer length, knob
labels 5.49/5.05; the primary CTA 5.08. **9.5px micro-mono is held to 4.5, not the 3:1
large-text exemption.**

**Non-text (WCAG 1.4.11, floor 3:1 for boundaries and marks):**

| Mark | Light | Dark |
|---|---:|---:|
| Socket well ring (`--border-control`) | 3.03 | 3.53 |
| Empty-slot invitation edge | 3.03 | 3.53 |
| Looper live trace (`--audio-connection`) | 3.02 | 5.79 |
| Sampler waveform trace | 3.27 | 7.19 |
| **Looper playhead** (after the `--accent-ink` fix) | **5.34** | **5.96** |
| Meter lit bar | 2.61 ✗ | 5.93 |
| Clip card edge (`WaveformView`) | 1.31 ✗ | 1.27 ✗ |

Surface steps, reported without a floor because 1.4.11 does not apply to an adjacent
ground: socket well fill 1.20/1.12, meter unlit track 1.20/1.12, trace bed 1.20/1.12.

---

## The 5 remaining browser failures — all outside this grant

1. **`WaveformView`'s own edge is 1.31:1 light / 1.27:1 dark** (oj-ui, W4-P3's lane). This
   is the *same object* as a timeline clip, and `DESIGN.md` §2 already ruled on exactly
   this: "`--timeline-clip-border` is `--text-muted`, not a hairline… a clip edge is a
   content boundary, so WCAG 1.4.11 applies; the hairline value measured 1.73:1." The
   arrangement clip took that upgrade; `WaveformView` — the clip card on the canvas, in the
   Sampler and in the Library — still wears the hairline. **The design doc has already
   decided this; the component has not been updated.** One token swap in
   `packages/oj-ui/src/components/WaveformView/WaveformView.css:5`.
2. **`Meter`'s lit bar is 2.61:1 in light** (`--accent-success` on `--bg-tertiary`) — oj-ui,
   and it is the *signal* mark on the Speaker, the transport pill and this Looper. Belongs
   with the W5-P6 review's F1 ask (`variant="bed"` + `--oj-meter-track`).
3. **`Chip`'s label is 12px sans** (`oj-chip__label`), below the 13px floor. `DESIGN.md` §5
   specifies "Chip … 12px/600" while §3 names `Field` labels as *the one* 12px sans
   exception. Two documented rules disagree; either §3 gains a second exception or `Chip`
   moves to 13px. oj-ui + docs, not a faceplate defect.
4–5. (the same Chip finding, once per theme.)

## Other findings for the orchestrator

- **`IconButton` is not a `forwardRef`** (`packages/oj-ui/src/components/IconButton/IconButton.tsx:36`)
  while its own `Button` is, so a consumer that needs a DOM handle on an icon button — every
  in-card confirm that must restore focus to one — has to `querySelector` for it. I did
  exactly that rather than fork the component. One-line fix in oj-ui.
- **`IconButton`'s docstring still describes the retired language** — "the hand-drawn ink
  border, hard offset feel". Stale after the New DNA swap.
- **`oj-ui Waveform` clips its own extremes the same way the Looper trace did**
  (`buildPoints` maps a unipolar 0 to `y = VIEW_H`, on the viewport edge). I fixed the
  Looper's inline copy; the shared component has the identical issue on the layer rows and
  in every other consumer.
- **`_sockets.css:69-80` `.instrument-output-port` still has zero emitters** — orphaned by
  W5-P8, already on that lane's delete list. Not touched here (not my rules in that file).
- **App-level focus trap (P6 review F7) is still live**: one `Tab` on the canvas swaps the
  visible surface and hides every node. It broke my first harness; I worked around it with
  keyboard-modality + programmatic focus and asserted `:focus-visible` rather than assume
  it. Worth fixing before the Wave-6 keyboard-only pass.
- **`e2eBridge` has no library hook**, so seeding the Library from a harness goes through a
  dynamic `import()` of the store — which silently gets a *different* module instance once
  Vite has served an HMR-versioned URL, so the seed appears to work and then quietly stops.
  A `seedLibrary` verb on the bridge would make this deterministic.

## Dead CSS

A selector-vs-JSX audit (`.scratch/w5-p7/deadcss.mjs`, run over `src/`, `packages/oj-ui/src`
and `e2e/`) found **zero unemitted selectors** in all four owned stylesheets. Deletions were
made by the inherited pass and I verified each has no emitter left:

- `_sockets.css` — `.sampler-side-port`, `.sampler-side-port.input`,
  `.sampler-side-port.output`, `.library-sample-out-port` (the bespoke absolute socket
  positions; both faceplates now use `PortRow` body rows).
- `SamplerVisual.css` — `.sampler-key-port`, `.sampler-placeholder-port` (**this is the dead
  port-glow rule the earlier gate flagged**), `.sampler-row-empty`, `.sampler-empty-text`.
- `SamplerNode.css` — `.instrument-voice-error-badge` (last emitter removed by W5-P8).
- This pass additionally deleted `.sampler-slot.has-sample.is-drop-target` and the
  `has-load-error .sampler-slot` rule, both made unreachable by fix #5.

`.node-plugin-error-badge` is **kept** in `SamplerNode.css`: it is emitted by
`NodeWrapper.tsx` (the shared "(missing plugin)" mark on any node) and this is its only
stylesheet. It should move to `SchematicBase.css` next time that file is opened.

## Tests added (21)

`src/components/Nodes/__tests__/w5p7Faceplates.test.tsx` (now 40 tests, all green):

- **`in-card confirms take the keyboard`** ×3 — the safe answer holds focus on open, the
  destructive one never does, Escape is a real answer and destroys nothing, and focus
  returns to the control that asked (for a layer, to *that* row, not row one). These fail
  against the inherited code.
- **`P7 stylesheet floors`** ×12 — per stylesheet: no sans run at 11px/9.5px (a block earns
  the small sizes by declaring the mono face, or by being on a short whitelist with a
  reason); no literal colour, no `filter`/`drop-shadow`, no bespoke
  `prefers-reduced-motion` block; no `color-mix(in srgb`.
- The transport test now also asserts the type chip and the state chip are never the same
  word.

## Deviations from the brief, with reasons

1. **Record is a 12% danger wash + a 2px danger ring + the pulse, not a solid danger fill.**
   Inherited, and I kept it: `--text-on-accent` on a solid `--accent-danger` measures
   **3.01:1** in light, so a solid fill makes the word "Stop" unreadable. This is the
   library's own `Button --danger` construction (a state-colour wash with the matching ink)
   and the Ink-For-Text Rule. Under reduced motion the wash + static 2px ring remain, and
   the state is never carried by that button alone — the glyph, the word, `aria-pressed`,
   the header chip, the card edge and the trace bed all change with it. Verified:
   `looper-record-breathe 1.2s` runs, and `.is-recording` is a class, not a colour.
2. **The drop target is dashed accent, not dashed accent *and* 1.5px of rendered width.**
   Chromium rounds `outline-width` to whole device pixels, so the house 1.5px declaration
   (identical to `WaveformView` and `AudioClipVisual`) reads back as `1px` at DPR 1. The
   declaration matches the house exactly; the browser rounds it.
3. **Report path is `W5-P7-REPORT.md` and screenshots are in `.scratch/w5-p7b/`** — see the
   note at the top.

## What I could NOT verify

- **Feel.** Nothing was heard. The record path is proven to reach `startRecording` /
  `stopRecording` and to commit a layer, and the meter is proven to ride `meterScale`, but
  whether the faceplate feels right with a loop actually playing is a founder pass. Codex
  never signs off on feel and neither does a screenshot.
- **The Library rename end-to-end.** The inline field opens on double-click, takes focus and
  commits on Enter, but the seeded library has no `FileSystemFileHandle`, so the store's
  rename cannot land on disk in a harness. The UI path is verified; the persistence is not.
- **The native tier.** Browser only; nothing in this lane is engine code.
- **A real ERR-1 sample.** The broken-sample state is styled and unit-reachable, but I did
  not manufacture a genuinely unresolvable persisted sample in the browser.
- **Reduced motion re-measured per faceplate.** The blanket rule is global and the first
  P7 run measured it on `.looper-record` (`animation-duration` collapsed, wash + static ring
  intact); I did not re-measure after my changes, though nothing I changed added an
  animation.

## Risks

- `.sampler-slot.has-sample` is now completely transparent. If a future consumer renders
  something other than a `WaveformView` into a loaded slot, that thing must bring its own
  edge. The comment in the stylesheet says so.
- The Looper's layer-delete focus restore resolves the row by `data-loop-id`. If a future
  edit renames or drops that attribute, focus silently falls back to the first row — the
  test asserts the exact button, so it will fail loudly rather than drift.
- `PLAY` replaces `LOOP` as the playing chip. Any external e2e spec matching the literal
  text `LOOP` on the state chip needs updating; I found none in `e2e/`.

---

# W5-P7b — the gate's three blockers, undo, and three taste calls

Fix round on the P7 gate (`W5-P7-REVIEW.md`, verdict COMMIT-AFTER-FIXES). Same branch, same
worktree, no git writes. Evidence: `plans/redesign-new-dna/.scratch/w5-p7b-fix/`
(`MEASUREMENTS.json`, `MEASUREMENTS-2.json`, `MEASUREMENTS-3.json`, 27 screenshots).
Playwright under **node**, one Chromium, dev on **5226**, stopped afterwards.

## Gates

| Gate | Result |
|---|---|
| `bun run test:run -- src/components/Nodes src/utils src/store` | **46 files, 672 tests, 0 failed** |
| `w5p7Faceplates.test.tsx` | **62/62** (was 40; +22 in this round) |
| `bunx tsc --noEmit -p tsconfig.app.json` | **0 errors** |
| `bunx eslint src/components/Nodes src/store` | **0 problems** |
| `git diff --check` over the owned files | clean (repo-wide CRLF notices only) |
| Full `bun run test:run` | 215/216 files, 2433/2434 tests. The one red — `Settings/__tests__/KeybindingsPanel.test.tsx > should render all keybinding actions` — **passes 21/21 in isolation** and is in no file this lane touches: a parallel-run flake of the `voiceSynth` kind, not a regression. |
| Browser, both themes, 4 sessions | **0 app errors, 0 page errors** (corrected in P7c: one harness-induced probe error, `"Cannot enter node: node not found nope"`, is in `MEASUREMENTS-3.json`) |

## 1. M1 — the tag hue is identity, never a contrast ground. **Fixed.**

`LibraryNode.css:402-421` — the 22% `--tag-color` wash under `.library-file-row__tag` is
gone, and `.library-filter-chip` (`:223-230`), which had the identical construction, went
with it. `--tag-color` is a hue hashed out of arbitrary user text, so a wash under a fixed
text token gives a ratio that changes with the tag's *name*; no mix percentage can be proven
AA for every possible tag. The hue now buys exactly one thing: the 8px `.library-tag__dot`.

Measured, real composited paint, seeded 4-tag library (`MEASUREMENTS.json`):

| Mark | Light | Dark | Before (gate) |
|---|---:|---:|---|
| File-row tag chips (`drums`/`pads`/`soft`/`warm`) | **5.92** | **6.18** | 4.97–5.69 / **3.46–4.33 ✗** |
| Active filter chip | **17.05** | **14.36** | 17.05 / 14.36 (hue never applied in that state) |
| Left-panel tag names | 14.17 | 12.81 | 12.81 / 14.17 |

Every chip now measures the **same** number whatever the tag is called — which is the actual
property that was missing. The one hue wash I did **not** remove is
`.library-tag.oj-list-row.is-selected` (`:160-166`), a 24% wash under `--text-primary`
rather than `--text-secondary`: measured **13.31 light / 7.02 dark**
(`MEASUREMENTS-2.json`). At 24% over the panel ground, `--text-primary` cannot be pulled
under 4.5 by any hue, so that one is bounded and stays — it is how the card says which
filter is on.

Pinned by `P7b — M1` (two tests): no rule matching `chip|__tag` may ground text on
`--tag-color`, and the dot must still carry it.

## 2. M2 — taking a tag off a file is a labelled control again. **Fixed.**

`LibraryNode.tsx:1200-1245`. The `onDoubleClick` on the `Chip` is gone (the chip's own
Enter/Space was already spent on filtering, so the removal had no keyboard route and no
accessible name). Each visible tag now renders as a `.library-file-row__tagpair`: the `Chip`
that filters, plus an `IconButton` with `aria-label="Remove {tag} tag"`, an
`onKeyDown` for Enter/Space, and `recordLibraryEdit` around the mutation. It hides at rest
and appears on hover **or focus** (`LibraryNode.css:432-450`) so Tab reaches it.

Browser, light: focused the control by role name, pressed **Enter** →
`items.i1.tags: ['drums'] → []`; `Ctrl+Z` → `['drums']`; node map 3 → 3.
Screenshot `B-library-untag-focused-{light,dark}.png`.

## 3. M3 — a marquee-selected row announces itself. **Fixed.**

`LibraryNode.tsx:1177` `selected={isActive || isMultiSelected}`. Measured live: the caught
row reads `class="… is-multi-selected"` **and** `aria-selected="true"`; unselected rows
report `null`. Pinned by `P7b — M3`.

## 4. Undo — every Looper and Library action is one `Ctrl+Z`, and never the card

This was the gate's worst finding: no Looper action and no Library action reached the undo
stack, so `Ctrl+Z` after one replayed the last **graph** entry — still "add this node" —
and the card left the canvas with every take on it.

### The seam (no second history)

- **Looper** — the per-layer facts a player edits (membership, mute, name) now live in
  `node.data.layers` as `LooperLayerMeta` (`LooperNode.tsx:139-155`): id, flags, name, and
  the `libraryItemId` **reference**. Never PCM. That makes each of them an ordinary
  `setNodeData` graph verb — the same verb `KeyboardNode`/`InstrumentNode` data edits ride —
  bracketed into exactly one step by `beginGesture`/`endGesture` (`commitLayers`,
  `LooperNode.tsx:355-370`). `LooperNodeData` extends `NodeData`, which carries an index
  signature, so this needed **no** edit to `src/engine/types.ts` (another lane's file).
- `data.layers` is the **SSOT** for those facts and the engine is reconciled *from* it
  (`LooperNode.tsx:566-600`). Mute flows one way: a click writes metadata, the reconciler
  issues `SET_MUTE`. That is what makes an undone mute really un-mute the **audio** rather
  than only repaint the row — the history driver writes `node.data` and lands on exactly the
  path a click takes. Absent metadata means the default (unmuted), which is what makes the
  *first* mute on a card undoable (its inverse is a `data` with no `layers` key at all).
- **Library** — `src/store/libraryVerbs.ts` (new, ~175 lines) adds a fourth `EditVerb`
  domain, `{ domain: 'library'; verb: LibraryVerb }` (`historyStore.ts:42-52`, the only
  edit to that file), one registered `registerHistoryDriver`, and two opt-in recorders. It
  is a delta of `LibraryItem` records + the tag arrays — metadata and references, never
  audio (an item's PCM lives behind a `FileSystemFileHandle`, its peaks in IndexedDB).
  Opt-in per gesture rather than a `set`-wrapper diff, because `libraryStore` is also
  written by folder scans and waveform loads, and a directory scan is not an undo step.
  Because it goes through the same `record`, a gesture that touches the graph **and** the
  library inside one `beginGesture` bracket is still one entry.
- Routed through it in `LibraryNode.tsx`: rename, trash, restore (+ the filter change that
  goes with it, as one step), tag add on drop (a multi-file drop is **one** step), tag
  removal, create tag, delete tag, pin / unpin / reorder.

### What undo cannot do — precisely

A committed take's PCM is owned by the kernel on the audio thread, and
`ojproto::looper_action` is `ARM / RECORD / PLAY / STOP / CLEAR / OVERDUB / UNDO_LAST /
SET_MUTE / DELETE_LAYER` — **there is no ADD_LAYER on either tier**.
`LooperHandle.addLoopFromBuffer` looks like an inverse and is not: by its own TODO
(`ojcoreHandles.ts:442-460`) it registers a row for the visuals and drives OVERDUB, and
never transfers the PCM across the control seam. So a deleted take genuinely cannot be
restored in v1.

The consequence, made honest rather than silent: delete-a-layer, clear-all and
take-the-last-layer-off each cost **one** `Ctrl+Z` and never more (the metadata step is
consumed; the card and every surviving take stay exactly where they are), and **all three
now ask first, in the card, saying the take cannot be brought back**. `Undo layer` fired
`UNDO_LAST` straight off the click in W5-P7 — it is confirm-gated now, through the same
`useConfirmFocus` the other two use (safe answer focused, Escape is an answer, focus
restored to `.looper-undo`).

The same rule covers the Library's two irreversible actions — permanently delete and empty
trash both drop a waveform and a file handle from IndexedDB — via
`recordSealedLibraryEditAsync`: the step's inverse is its forward, so `Ctrl+Z` consumes it
and changes nothing. It neither resurrects a row whose audio is gone (a row that looks
restored and plays nothing is a lie) nor walks past it into the entry that deletes the card.

### Measured in the browser (light, seeded, `MEASUREMENTS.json`)

| Journey | Result |
|---|---|
| Looper: 2 layers → **mute** | `data.layers` `[true, false]`; engine `SET_MUTE` sent |
| … → `Ctrl+Z` | `data.layers` `[false, false]`, **engine `getLoops()` `[false, false]`**, node map 3 → 3, card present |
| … → **delete a layer** (confirm → Delete) | rows 2 → 1, node map 3 |
| … → `Ctrl+Z` | node map **3**, card present (was: `looperNodes 1 → 0`) |
| … → a **second** `Ctrl+Z` | node map **3**, card present |
| Library: **rename** `kick.wav` → `renamed.wav` | store updated |
| … → `Ctrl+Z` | `kick.wav` restored, node map 3 → 3 |
| Library: **remove tag** from the keyboard → `Ctrl+Z` | `[] → ['drums']`, node map 3 |
| Console / page errors across all of it | **0 app errors**; one harness probe error (see the gate table above) |

Pinned by 11 new tests (`P7b — Looper actions…`, `P7b — Library actions…`), each of which
does the action, calls `undo()`, and asserts both the restored state **and** that the card
is still in the graph.

*On "fails on the current code":* I could not literally re-run them against the pre-P7b
working tree (the P7 work is uncommitted, so `git show HEAD:` yields the pre-P7 file, not
the one the gate reviewed) — so this is an argument from the assertions, not an executed
experiment. Each Looper test asserts `node.data.layers`, a key the pre-P7b code never wrote
(`grep layers` over it finds only the legacy `LooperNodeData.loops` field, which nothing
reads); each undo assertion requires the node to still be in the map, and the gate measured
`looperNodes 1 → 0` on exactly this path, twice (`probe8`/`probe9`). Two of the older tests
in this file DID have to be updated for the new seam, which is the same evidence from the
other side: `mutes a layer through the engine` now needs a store-subscribed mount for the
`SET_MUTE` to reach the handle, and `undoes the last layer through the engine UNDO_LAST`
now has to answer a confirm.

## 5. Lane follow-ups

| # | Item | Done |
|---|---|---|
| 1 | `LooperNode.css:81` comment quoted 5.03/5.42 | now **5.34 light / 5.96 dark**, the number two independent runs measured; pinned by a test that also forbids the old string |
| 2 | `_sockets.css` orphan blocks | `.port-row` (+`.input`/`.output`), `.port-label`, `.keyboard-schematic-body`, `.instrument-output-port` **deleted** — verified zero emitters in `src/`, `packages/oj-ui/src`, `e2e/`. The file is 47 lines now (was 116) and keeps only `.bundle-port-row`, which `BundlePortGroup.tsx:83,155` really emits |
| 3 | the `!important` port-size rule | **deleted**. Confirmed no `<Port>` in `src/` passes an inline size — the only three call sites are `BundlePortGroup`, `InstrumentVisualNode`, `MiniLab3Visual` and none styles the socket; the rule also only restated `Port.css:25-26` |
| 4 | `_sockets.css` outside the stylesheet-floor gate | added to `SHEETS` (`w5p7Faceplates.test.tsx:706`); it now runs the 13px-floor, no-literal-colour, no-glow and oklab checks too |
| 5 | `.looper-record` forked the Button | now `<Button variant="danger" className="looper-record">`. Measured live: `class="oj-btn oj-btn--danger looper-record"`. The stylesheet keeps only what no other Button has — `flex: 1`, 30px, and the danger **ring** — 40 lines of re-declared fill/press/focus/disabled deleted. Label contrast after: **4.96 light / 5.03 dark** |
| 6 | ERR-1 `aria-label` + a title that disagreed with its body | `title="Sample not found"` (was *"Sample is silent"* over *"could not be found on this machine"*), `aria-label="Sample failed to load"` restored from HEAD. Rendered and screenshotted (`13-sampler-card-light.png`) |
| 7 | the dropped Looper export-name field | **consciously not restored, and now documented in the code** (`LooperNode.tsx` docstring, §"The export name"): one name per layer, edited in place on its row, and that is the name `handleExport` saves under. Two fields for one string is two places to disagree, and a second step in front of a live export costs a bar. W5-P7b added the half that was actually missing — the name is persisted in `data.layers` instead of transient component state, so it survives a reload and one `Ctrl+Z` puts it back |

## 6. Three taste calls (of the gate's nine)

Chosen for payoff per line, and each one fixes something a player *reads*:

**(a) The Sampler's clip card no longer paints the sample as a rule on its top border.**
`SamplerNode.css:60-73`. `oj-ui Waveform` maps a peak of 1.0 to `y = 0`, so a loud take
landed on the viewBox edge — on the flagship object of the whole lane ("the card IS the
sample"). The shared component is another lane's file, so the same headroom is taken here:
`transform: scaleY(0.94)` on `.sampler-clip .oj-waveform-view__trace` — **numerically the
Looper's own accepted `TRACE_BLEED = 3` on a 100-unit viewBox** (3/106 ≈ 2.8% a side).
Measured: `matrix(1, 0, 0, 0.94, 0, 0)`, peak now **5.5px** below the card's inner edge on a
48px trace box. Nothing is clipped (`Waveform.css` is `overflow: visible`, the stroke is
`non-scaling-stroke`).

**(b) The key map prints notes, not indices.** `SamplerVisualNode.tsx:255-330`. The card
already knew ROOT and SPREAD — its own `aria-label` was computing the offset — and printed
`1 … 10`, which is the one fact a pad's position already carries. Pads now read
`C4 D4 E4 F#4 G#4 A#4 C5 D5` (ROOT C4, SPREAD 2, measured in the browser from inside the
Sampler), with the exact offset kept in the accessible name
(`"Key 2, D4, +2.0 semitones from root"`) because a fractional spread lands between
semitones. 46px pads, **no overflow** on the 3-character names. Screenshot
`14-keymap-{light,dark}.png`.

**(c) A long filename owns its row.** `LibraryNode.css:299-315` + `LibraryNode.tsx:1200`.
`ListRow` pins its actions with `flex-shrink: 0`, which squeezed
`pad-long-name-that-runs-on.wav` to **63px** — about eight characters — while the row above
carried a void. The body now claims a **120px floor** and the trailing cluster is the side
that gives; the row shows **one** tag inline plus a `+N` count (two chips and their remove
buttons could not both stay readable and leave the name its floor — squeezed, they rendered
as empty pills, which says less than no chip at all; the count keeps the full list in its
tooltip), and a chip yields by ellipsis inside `60px…76px`, never by collapsing.

Measured, both themes: name boxes **176 / 165 / 136px** (was 140 / **63** / —), every chip
whole at 47–59px. Screenshot `A-library-{light,dark}.png`.

*Not taken, and why:* the Looper's 24px layer waveform and the empty trace bed both need the
card widened or the row re-laid-out, which is a design decision above a fix round; the
`KeyTile`-is-not-playable point needs an oj-ui variant (gate follow-up 15).

## What I could NOT verify

- **Feel.** Nothing was heard. The mute reconciliation is proven to reach
  `LooperHandle.toggleLoopMute` and the engine's own `getLoops()` reports the flip, but
  whether an undone mute *sounds* instant with a loop actually playing is a founder pass.
- **A deleted take really being unrecoverable on the native tier.** The claim rests on the
  wire contract (`ojproto::looper_action` has no ADD_LAYER) and on `addLoopFromBuffer`'s own
  TODO, both read in source; I did not run the native host.
- **Library rename on disk.** Same as W5-P7: a seeded library has no
  `FileSystemFileHandle`, so only the store path is exercised.
- **`SamplerVisual.css:13-17`'s stale geometry comment** (gate follow-up 6 — it reasons
  about "six 32px pads" and `width: 268px` while the pads measure 46px). Not in this round's
  brief and not corrected; the measurement is now in `MEASUREMENTS-3.json` for whoever takes
  it.
- **The keyboard-only pass.** W5-P6's F7 is still live (one `Tab` on the canvas swaps the
  surface), so the M2 control was reached by programmatic focus + a real `Enter`, not by
  tabbing to it.

## Risks

- `node.data.layers` persists while the engine's layers do not survive a reload. Membership
  is engine-led — rows are rendered from `LooperHandle.getLoops()` — so stale metadata is
  invisible and the next take's `mergeLayerMeta` clears it. The one visible upside is
  deliberate: a **mute** now survives a reload, because the reconciler pushes it back into a
  fresh handle.
- The sealed library steps (permanent delete, empty trash) are no-ops on `Ctrl+Z`. That is
  the intent, and both ask first — but a player who expects `Ctrl+Z` to do *something* will
  see nothing happen. The confirm is where the honesty has to live.
- `recordLibraryEdit` is opt-in. A future Library action added without it silently returns
  to the old behaviour. The seam is one call and the pattern is in every existing call site,
  but nothing mechanically enforces it.

---

# W5-P7c — the three blocking fixes, and the eleven follow-ups

Round three on the same four faceplates. The P7b gate (`W5-P7B-REVIEW.md`) returned
**COMMIT-AFTER-FIXES** with three blockers — each one falsifying a claim P7b made in its
own headline — plus eleven non-blocking items. All fourteen are done. Every one is pinned
by a test **that fails on the code as it stood**, and the three blockers are additionally
measured in a real browser in both themes.

## Gates

| Gate | Result |
|---|---|
| `bun run test:run -- src/components/Nodes src/store src/utils` | **48 files, 704 tests, 0 failed** (was 46/681; +9 in this round, and other lanes landed tests in the same scope) |
| `w5p7Faceplates.test.tsx` | **71/71** (was 62) |
| `bunx tsc --noEmit -p tsconfig.app.json` | **0 errors** |
| `bunx eslint src/components/Nodes src/store` | **0 problems** |
| `git diff --check` over the owned files + a trailing-whitespace grep over the untracked `libraryVerbs.ts` | clean (repo-wide CRLF notices only) |
| Browser — node Playwright, one Chromium, dev on `:5226`, **both themes**, canvas zoom 1 | every claim below measured; **0 app console errors, 0 page errors** |

Dev server stopped. Harness: `.scratch/p7c-browser.mjs` (run under `node`).
Artifacts: `plans/redesign-new-dna/.scratch/w5-p7c/` — `MEASUREMENTS.json`,
`RED-before-fixes.txt` (the full failing run, captured before a line of source moved),
`SAMPLER-PADS.txt`, and 13 captures.

---

## The red, first

F1 is the fix the gate could not execute, because the test double diverged from the real
handle on exactly the call that mattered. So the double was fixed **first**, the new tests
were written **against the old source**, and this is that run — `w5p7Faceplates.test.tsx`,
before any of the fixes below:

```
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 6 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  … > P7c — F1: one destructive press is ONE undo entry > clearing THREE layers costs one Ctrl+Z, not three
AssertionError: expected 4 to be 2 // Object.is equality
- Expected   2
+ Received   4

 FAIL  … > P7c — the Looper seals what it cannot bring back > one Ctrl+Z after a confirmed delete consumes the step and changes nothing
AssertionError: expected [] to deeply equal [ 'a' ]

 FAIL  … > P7c — the Looper seals what it cannot bring back > clearing every layer is sealed too
AssertionError: expected [ { id: 'b', isMuted: false, …(1) } ] to deeply equal []

 FAIL  … > P7c — the confirms say where the take goes, not that it is gone > all three name the Library trash instead of overstating the loss
AssertionError: expected '/**\n * Looper Node — the live-perfor…' not to contain 'the kernel owns their audio'

 FAIL  … > P7c — F2: the tag identity dot actually renders > the tag row lays its body out as a flex line, so an 8px dot is 8px
AssertionError: expected 'inline' to be 'flex' // Object.is equality

 FAIL  … > P7c — F3: the record button keeps its focus ring while recording > the breath rides a pseudo-element, so no animation outranks :focus-visible
AssertionError: ".looper-record.oj-btn.is-recording" animates the breath on the button itself, which outranks :focus-visible and hides the ring while recording: expected false to be true

 Test Files  1 failed (1)
      Tests  6 failed | 65 passed (71)
```

`expected 4 to be 2` is F1 in one line: three layers, three entries. Full output in
`.scratch/w5-p7c/RED-before-fixes.txt`.

---

## F1 — "Clear every layer" cost one `Ctrl+Z` per layer. **Fixed.**

`LooperNode.tsx:776` (`commitDestructive`), `:786` / `:799` / `:811` (the three callers);
test double `w5p7Faceplates.test.tsx:72`; tests `:1158`.

The gate's reading was exactly right. `LooperHandle.deleteLoop` calls `onLoopDeleted`
**synchronously**, this card's callback ends in `syncLayerMetaRef.current()`, and that
commits its own `beginGesture`/`updateNodeData`/`endGesture` — so a loop over N layers
wrote N strictly-shorter lists and closed N transactions. On stage that is N dead `Ctrl+Z`
presses before the stack reaches a step that changes anything.

The three destructive handlers now share one helper rather than each growing a bracket:

```ts
const commitDestructive = useCallback((run: () => void) => {
    beginGesture();
    try { run(); } finally { endGesture(); }
    sealLastGraphEntry();
}, [beginGesture, endGesture]);
```

`useHistoryStore.begin` is depth-counted, so every nested commit the engine callbacks fire
merges into this one entry. **Why a wrapper and not the `commitLayers(next, {sealed:true})`
the review sketched:** the entry does not exist until the OUTERMOST bracket closes, so a
`sealed` flag on an inner write would seal the *previous* entry. One helper, one place, and
the two properties (one entry, sealed) are stated together where they are both true.

**And the blind spot that hid it.** The double now reports what the real handle reports:

```ts
deleteLoop = vi.fn((id: string) => {
    const removed = this.loops.find((x) => x.id === id);
    this.loops = this.loops.filter((x) => x.id !== id);
    if (removed) this.onDeleted(removed);           // ← the real handle does this
});
```

`undoLast` too. Three new tests assert `entries.length` grows by **exactly 1** for a
clear-all of three layers, a single delete, and take-the-last-off.

**Measured in the browser**, on the real `LooperHandle` with three registered layers
(`MEASUREMENTS.json.f1`): `historyBefore.entries 4` → `historyAfter.entries 5`,
`entriesAdded: 1`, rows `3 → 0`. Captures `04-looper-3-layers-light.png`,
`04b-looper-clear-confirm-light.png`, `05-looper-after-clear-undo-light.png`.

## F2 — the tag identity dot did not render. **Fixed.**

`LibraryNode.css:156`; test `w5p7Faceplates.test.tsx:1301`.

`ListRow` puts its children in a plain inline `<span class="oj-list-row__body">`, and a
non-replaced inline box ignores `width`/`height` — so the 8px `.library-tag__dot`, the one
thing M1 spends the tag hue on, painted 0×0, and `.library-tag__name`'s ellipsis never
fired either. The review's exact rule is in, with the reason written above it.

**The pin is now a render, not a grep.** The old test matched the stylesheet text, which is
precisely the assertion a 0×0 box passes. The new one injects `LibraryNode.css` into the
document, mounts the card with a seeded tag, and asserts the computed `display` of the body
slot is `flex` and the dot computes 8px × 8px. It fails with `expected 'inline' to be
'flex'` on the old sheet.

**Measured in the browser**, at canvas zoom 1, in both themes: the dot's
`getBoundingClientRect()` is **8 × 8** and the body slot computes `display: flex`
(`MEASUREMENTS.json.themes.{light,dark}.tagDots`). Visible in `01-library-light.png` /
`01-library-dark.png` — four coloured discs down the ALL TAGS rail, which is what P7b's
own screenshots did not contain.

*One note for the integrator.* The oj-ui lane has since landed the root cause in
`ListRow.css` (review item #12). When that is in, **delete** this rule and the file-row one
below it rather than leaving two consumers restating a component default — the CSS comment
says so at the rule.

## F3 — the record button lost its focus ring exactly while recording. **Fixed.**

`LooperNode.css:154` (the button), `:165` (the ring), `:177` (the breath), `:186` (the
keyframes); test `w5p7Faceplates.test.tsx:1325`.

A running animation outranks every author-normal declaration, `:focus-visible` included, so
the keyframed `box-shadow` erased the ring in the one state where a performer most needs to
know where the keyboard is. The breath moved onto `::after` with its own outer shadow; the
button's own `box-shadow` is now free for the ring. `global.css`'s blanket reduced-motion
rule matches `*::after`, so the still frame is unchanged: the wash plus the static 2px ring.

**The pin.** jsdom has no animation cascade — a computed-style assertion there passes
either way, which is how this shipped. So the test reads the RULE out of the CSSOM
(`:focus-visible` still carries `var(--focus-ring)`) and then pins the structural law: no
rule may run `looper-record-breathe` on anything but a pseudo-element, and the keyframes may
not touch the button's `inset` ring. That is what produces the red above.

**Measured in the browser** — and this one is an A/B on live paint. With the button forced
into `:focus-visible` via CDP `CSS.forcePseudoState` while `is-recording`:

| | computed `box-shadow` of the recording, focused button |
|---|---|
| now (light) | `oklch(0.58 0.21 25) 0 0 0 2px inset, **oklab(0.66 0.145548 0.12213 / 0.28) 0 0 0 3px**` |
| P7b's cascade re-applied | `oklab(0.58 …) 0 0 0 2px inset, oklab(0.58 0.190325 0.0887498 / 0.169) 0 0 0 3.07272px` |
| now (dark) | `oklch(0.66 0.21 25) 0 0 0 2px inset, **oklab(0.72 0.145548 0.12213 / 0.35) 0 0 0 3px**` |

The bolded term IS `--focus-ring` (`0 0 0 3px color-mix(in oklab, oklch(.66 .19 40) 28%,
transparent)` in light, 35% in dark) — same alpha, same accent hue. Re-apply P7b's rule and
it is gone, replaced by the danger colour at whatever alpha the pulse happens to be on.
`buttonAnimation: "none"`, `pseudoAnimation: "looper-record-breathe"`. Captures:
`03-record-focused-{light,dark}.png`, the close-ups `03b-…`, and `03c-…-WITH-P7b-CSS.png`
for the comparison.

---

## The eleven non-blocking follow-ups

**1. The confirm copy no longer overstates the loss.** `LooperNode.tsx:1169`, `:1199`,
`:1227`. Every committed take is auto-saved to the project Library and a delete only
*trashes* that copy, so "the kernel owns their audio" was false in the direction a player
cares about. Now: *"These cannot go back into the loop — their takes stay in the Library
trash."* Phrased as where to look, never as a promise — the auto-save is best-effort and
swallows its error. Pinned at `:1268`, including a check that no wording claims the copy
*is* safe. Visible in `04b-looper-clear-confirm-light.png`.

**2. The Looper's three destructive steps are sealed.** `LooperNode.tsx:219`
(`sealLastGraphEntry`), applied by `commitDestructive`. Inverse := forward, exactly like
`libraryVerbs.ts`'s two destroyers and for the same stated reason: the kernel owns the PCM,
there is no ADD_LAYER on either tier, and a row that looks restored and plays nothing is a
lie. So "one `Ctrl+Z`, and it changes nothing" is now true by construction rather than by
the luck of an invisible ghost. Three tests at `:1213` — a confirmed delete leaves
`data.layers` byte-identical and moves the cursor back exactly one; a clear-all is the same;
and a **mute is still fully reversible**, so the seal did not leak into the reversible edits.
No deep clone: `applyGraphVerb` clones on apply and a verb is never mutated.

**3–5. `libraryVerbs.ts`.** `applyLibraryVerb` is no longer exported and its docstring no
longer claims tests use it (`:74`); `finish` opens with the `isApplyingHistory()` guard the
other two drivers have (`:148`); and `diffLibrary`'s comment now states the `itemCount` gap
and why it is harmless *only* while `emptyTrash`/`permanentlyDeleteItem` are the sealed pair
(`:93`).

**6. The crop drop is undoable.** `LibraryNode.tsx:744` — `createVirtualItem` runs inside
`recordLibraryEdit('Save crop', …)`. Recorded, not sealed, and the comment says why: a
virtual item is a frame range plus a reference to its parent file, so undoing it destroys no
audio. It was the only branch of that handler that was not undoable while the tag-only
branch one block above it was.

**7. `+N` is a disclosure, and every tag is removable again.** `LibraryNode.tsx:218`
(one row open at a time), `:1276` (the chip), `LibraryNode.css:501`. The chip keeps a
`title` that names the hidden tags, gains `role="button"`, `tabIndex`, `aria-expanded`, an
`aria-label`, click and Enter/Space — and opening it renders every tag on that row with its
own remove button. Browser: `removeButtonsAfterExpand: ["Remove pads tag", "Remove soft
tag", "Remove warm tag"]`, and clicking again collapses it. The open row is the one case
allowed to break the duration column; it wraps to a second line (capped at 208px) so the
collapse control cannot be pushed off the panel. `02-tags-expanded-light.png`.

**8. The durations line up again.** `LibraryNode.css:380` (a fixed 34px right-hung box),
`:354` (the trailing cluster stops shrinking), `:483` (the tag payload is a fixed 104px
column). The fixed box was never the whole story: the duration sits at the end of the body,
so its x is the body's right edge, and P7b's `flex-shrink: 1` on the actions cluster gave
the long-name row a 20px wider body. **Measured**: right edges were `[606.97, 587.02]`
before and are `[545.58]` — one value for all three rows — in both themes. The two numbers
in the new CSS comments are measured, not chosen: a tag pair is 74px and a `+N` is 26px, and
at the 92px I first tried, the pair kept its 60px chip and its remove button slid *on top of*
the `+N`, which Playwright caught as an unclickable control. The cost is honest: the longest
filename went 165 → ~128 CSS px. `01-library-light.png` / `01-library-dark.png`.

**9. Why the 24% wash is bounded, in the CSS.** `LibraryNode.css:181-192`. The comment now
names the load-bearing fact: `getTagColor` moves only the HUE (S/L pinned at 60%/70%), and
the text is `--text-primary` — worst case over all 360 hues is 11.43 light / 6.69 dark,
while the same wash under `--text-secondary` would be 3.23 in dark. The token, not the
percentage.

**10. `SamplerVisual.css:13` — the geometry comment checks out, and now says so.** This is
the one item where the gate's number was the artefact. 6 × 32 + 5 × 5 = 217 against a
238px content box, so six pads *do* fit. Measured in the browser: a pad is **46.13px** and
the card is **386.31px** — both exactly **1.4415×** their CSS values, because a card opened
from inside its parent is drawn at the nested view's own scale. The pad is 32.0 CSS px and
all six share one `top`. The 46px two gates have now quoted is the zoom, not a wider pad.
Evidence: `.scratch/w5-p7c/SAMPLER-PADS.txt`.

**11. "0 console errors" corrected.** `W5-P7-REPORT.md:23`, `:421`, `:539` now read **0 app
errors** and name the one harness-induced probe error (`"Cannot enter node: node not found
nope"`) that `MEASUREMENTS-3.json` carries.

---

## Browser evidence

Node Playwright, one Chromium, dev on `:5226`, canvas zoom 1, both themes.

| Claim | Measured |
|---|---|
| tag identity dot renders | **8 × 8** px, light and dark |
| tag row body slot | `display: flex`, light and dark |
| durations line up | one right edge, `545.58`, all three rows, both themes (was two: `587.02` / `606.97`) |
| tag payload column | `104px` on every row |
| `+N` names its hidden tags | `title="Also tagged soft, warm - click to remove any of them"` |
| `+N` opens them, each removable | 3 remove buttons after expanding, 0 expanded rows after collapsing |
| record + focus while recording | focus ring present in the computed `box-shadow`, both themes; absent the moment P7b's cascade is re-applied |
| breath is on the pseudo-element | `buttonAnimation: "none"`, `pseudoAnimation: "looper-record-breathe"` |
| clear 3 layers | history entries **+1**, rows 3 → 0 |
| one `Ctrl+Z` after it | `data.layers` **unchanged** (`[]`), cursor 5 → 4, node still on the canvas, node map 3 |
| app console errors / page errors | **0 / 0** |

## What I could not verify

- **Feel.** Nothing was heard. The seal and the bracket are graph-store facts; whether a
  clear-all *sounds* clean with a loop playing is a founder pass. A gate never signs off on
  feel.
- **A real `Tab` to the record button.** W5-P6 F7 is still live (one `Tab` on the canvas
  swaps the surface), so `:focus-visible` was forced through CDP — the same mechanism
  DevTools uses — rather than by tabbing. The cascade question is answered exactly; "a
  player can reach this button with the keyboard" still is not, and will not be until F7 is
  fixed.
- **The recording state itself in the browser.** The `is-recording` class was applied by the
  harness; the engine-driven state machine that sets it is pinned in the unit tests
  (`looper.frame(…, RECORDING)`), and the CSS question this round asks is only about the
  cascade once the class is on.
- **The native tier.** Browser/JS only.
- **A concurrent-worktree caveat.** Other lanes were editing this worktree during the
  browser run (`ListRow.css`, `Chip.css`, `IconButton.tsx` and ~30 more are dirty from other
  grants). Vite's HMR rewrites module URLs with a cache-busting query after an edit, which
  duplicates a Zustand store between the app and an injected harness module — twice this
  made a seeded Library render its empty state. Restarting the dev server clears it. Every
  number above is from a clean post-restart run; anyone re-running the harness on a churning
  worktree should restart Vite first.

## Risks

- **The seal is applied by rewriting the top history entry** through
  `useHistoryStore.setState` (`historyStore.ts` is another lane's file this round, so no API
  was added for it). It is a two-line, immutable replacement of `entries[cursor-1].inverse`
  immediately after the gesture closes, and it is covered by three tests — but the day the
  history store grows a real `recordSealed`, this should move onto it.
- **The fixed 104px tag column costs the filename ~12px** on every row and ~37px on the
  longest one, versus P7b. That is the trade the review asked for (a column of lengths that
  can be read as a column), and it is written into the CSS comment so the next round can
  reverse it deliberately rather than by accident.
- **`.library-tag .oj-list-row__body` is redundant** the moment the oj-ui lane's `ListRow`
  change lands. It is marked for deletion in the comment; if both land and nobody deletes it,
  it is a dormant line — code value #8.
