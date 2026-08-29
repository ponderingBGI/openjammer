# W5-P6 — shared schematic chrome + the utility / IO faceplates

Lane: Opus 5. Branch `t3code/openjammer-redesign-timeline`. Nothing committed, stashed or
checked out. Artifacts: `plans/redesign-new-dna/.scratch/w5-p6/` (screenshots, the three
Playwright harnesses, `contrast.json`, `verify.log`).

**Gates.** `bunx tsc --noEmit -p tsconfig.app.json` ✅ · `bunx eslint src/components/Nodes
src/components/params src/components/BundlePortGroup.tsx` ✅ (0 problems) · `bun run build`
✅ · scoped `bun run test:run` → **532 passed, 2 failed, both in other lanes' files**
(§9) · browser harness (node, Chromium on 5219) → **0 problems, 0 console errors, 0 page
errors** · measured contrast **55 light + 55 dark text runs, 0 failures** (§8).

---

## 1. The base-chrome decision, and its blast radius

**Decision: alias in CSS, NodeShell in the faceplates I own — not a central NodeWrapper
mount.**

`SchematicBase.css` makes `.schematic-node` a thin alias of `.oj-node`: the same surface,
the same 1px `--border-subtle` hairline, the same 14px radius, the same `--shadow-overlay`,
the same selected / dragging / focus reads, declaration for declaration. `.schematic-header`
mirrors `.oj-node__header` the same way. The alias adds exactly two things `.oj-node` cannot
own: canvas positioning (`position: absolute` + `--z-node`, because these faceplates are
placed with an inline `left/top`) and the canvas-only states (`hover-connecting`,
`clip-drop-target`, and the refusal flash).

Then **every faceplate in this lane renders THROUGH `NodeShell`** and carries both classes
(`class="oj-node schematic-node speaker-node"` — verified in the browser). So for my nine
node types there is literally one card implementation; for the families P7/P8 still own, the
alias keeps them on the same card language until they migrate.

**Why not mount `NodeShell` centrally in `NodeWrapper` for all `SCHEMATIC_TYPES`:** every
un-migrated faceplate renders its own `.schematic-header`, so a central mount would give
Keyboard / Instrument / MIDI / MiniLab / Looper / Sampler / Library **two headers each**, mid-
flight, in lanes that are running right now (P8 was editing `KeyboardVisualNode.tsx` while I
worked). The mount point stays available: when P7/P8 finish, moving the switch is a
five-line change and `SchematicBase.css` shrinks to the two canvas-only concerns.

**Blast radius (things outside my files that changed behaviour):**

| Change | Who feels it |
|---|---|
| `BaseNode.css` **deleted**; its `.port-label` rule removed | `.port-label` was declared TWICE — in `BaseNode.css` (Outfit 13px `--text-secondary`) and in `_sockets.css` (the New DNA 9.5px tracked mono micro-voice). `BaseNode.css` was imported LAST in `NodeWrapper.tsx`, so at equal specificity **it silently won**, and S3's socket-label redesign never rendered on `KeyboardNode`, `MIDINode`, `MIDIVisualNode`, `MiniLab3Node`. Deleting it restores the intended voice on P8's nodes without touching P8's files. |
| `.node-row` / `.node-label` / `.node-select` / `.node-controls` / `.loop-*` moved out of `BaseNode.css` | Into `EffectNode.css` and `RecorderNode.css` (their only emitters). `LooperNode`'s `.looper-loop-item` was always separate and is untouched. |
| `.schematic-node` `min-width` 140px → `var(--node-min-width)` (190px) | Any un-migrated family that does not set its own `min-width`. Every one of them does (checked: Keyboard 160, KeyboardVisual 600, Instrument 180, Looper 220, MIDI 160, MIDIVisual 400, Library 260, Container/Math/CanvasIO now mine). |
| Refusal classes `.flashing` / `.deletion-attempted` now have CSS | Also styles `ContainerNode`, `MathNode`, `CanvasIONode`, the panels **and** any P8 node that emits them. |
| `NodeWrapper.handlePortMouseDown` guard `e.button !== 0` → `e.button != null && e.button !== 0` | **UI-017 fix.** Every keyboard port activation in the app (panels, and anything else that casts a KeyboardEvent) was silently dead. Now Enter/Space on a socket starts a connection. Applies to all node families. |
| `_sockets.css` pruned | Removed `.math-port-row`, `.input-panel-port-row`, `.output-panel-port-row` (+ their `:hover`/`.empty-slot` variants), `.empty-slot-label`, and the `.input-panel-node:has(.bundle-port-group)` width. All had exactly one emitter, which this lane rewrote; the width rule **moved verbatim (190px)** to `PortPanelNode.css`. `.port-row`, `.bundle-port-row`, `.port-label`, the `!important` size normalizer and the bespoke socket positions (Instrument / Sampler / Library) are untouched — P7/P8 still emit them. |

Preserved exactly as required: `data-canvas-node-root` on every node root, the
`SCHEMATIC_TYPES` switch, `Port.direction`, and the `data-node-id / data-port-id /
data-port-type` contract.

---

## 2. Faceplate by faceplate

Every card below is a `NodeShell` with the grip, the Outfit title and the mono type chip;
only what is *inside* the body is described. Screenshots are
`plans/redesign-new-dna/.scratch/w5-p6/<name>-{light,dark}.png`; the whole-canvas sheets are
`00-canvas-{light,dark}.png`.

### Speaker — the handoff's Output node
`speaker-{light,dark}.png` · close-ups `closeup-speaker-{light,dark}.png`

- **Change.** Was: a 48px mute glyph, a native `<input type=range>`, a hand-rolled 6px meter
  div driven by `setState` at frame rate, and a bespoke dropdown with a global
  `querySelector` outside-click. Now: the handoff's card — a **LEVEL `Knob`** (0…1, `100%`
  readout, double-click → 100%), the **big oj-ui `Meter`** (9 bars × 5px × 44px) with a mono
  **dB readout** beside it (`-∞ dB` below −60), then a hairline, then the route: an oj-ui
  **`DeviceSelect`** + a mute `IconButton` with the slash icon and `aria-pressed`.
- **The meter and the number never touch React.** One `registerTimelineLevelWriter`
  subscription (the app's ONE shared frame, the same one the transport pill uses) writes
  `--oj-meter-signal` on the meter element and `textContent` on the readout, and the text only
  when the string changed. Browser-verified: the element carries
  `--oj-meter-height: 44px; --oj-meter-bar-width: 5px; --oj-meter-signal: 0.000;` (UI-023).
- **dB, not linear.** −60…0 dBFS mapped onto 0…1 so 0 dBFS lands exactly on 1.0 and the
  Meter's clip latch still means what it says. Same function as `Shell/masterSignal`.
- **Parts.** NodeShell, PortRow, Knob, Meter, DeviceSelect, IconButton (+IconSpeaker/IconMute),
  Chip (+IconBolt), Callout.
- **States.** default · hover · selected (`state-selected-speaker-*.png`) · dragging ·
  connected (socket core takes the audio blue) · hover-connecting · muted (danger-tinted
  button + meter reads 0) · low-latency (Chip) · no-`setSinkId` (Callout, warning).
- **Policy kept.** No auto device switching on mount (P10). The only automatic route change
  is recovery when `devicechange` says the explicitly selected output vanished — the two
  existing `SpeakerNode.test.tsx` cases still pass unchanged.
- **UI-018 fixed.** Outside-click is a per-instance ref; two Speakers no longer share one
  dropdown.

### Microphone
`microphone-{light,dark}.png`

- **Change.** Was: a 16-element array pushed into `useState` sixty times a second (the exact
  UI-023 defect), two 36px 2px-ink buttons, a hand-computed dropdown width in JS. Now: a live
  **`Meter`** (12 × 5px × 36px) + a mono **dB readout**, a mute `IconButton`, then a hairline
  and the **`DeviceSelect`**. Same two-halves structure as the Speaker, mirrored (socket right).
- **The level rides the shared frame**, imperatively, exactly like the Speaker.
- **Honest permission states.** Enumeration is classified: `granted` / `unnamed` (the browser
  withholds labels until access is allowed once) / `unavailable`. `unnamed` and `unavailable`
  each render a `Callout` inside the card; devices whose id the browser withholds are left out
  of the picker rather than listed unpickable.
- **Deviation: no monitor toggle.** The brief asks for "mute + monitor toggles". There is no
  monitoring path at the engine seam — `setMicrophoneInput` takes `{isMuted, deviceId}` and
  nothing else — so a monitor switch would be a control that does nothing (code value #8). Not
  added; flagged.
- **Meters cannot sit on `--bg-tertiary`.** The first build put the meter on an inset bed and
  it was *invisible*, because `Meter`'s idle track IS `--bg-tertiary`. Both this card and the
  Recorder now put the meter on the card surface. See §7 (oj-ui API need).

### Math (Add / Subtract)
`math-add-{light,dark}.png`, `math-subtract-{light,dark}.png`

- **Change.** Was: a bespoke `.math-header` with a 2px ink rule, bare `<Port>`s **with no
  `data-port-type`**, and a `(−)` hint span. Now: NodeShell with the operator as the mono type
  chip, three `PortRow`s (`In 1` / `In 2` / `Out`, universal, rainbow until typed), the
  operation as a **`SegmentedControl`**, and one mono explainer line (`In 1 − In 2`) — because
  which way a subtraction runs is a fact you would otherwise discover by ear.
- **The operation is now a control.** `add` and `subtract` declare identical ports, so flipping
  is one reversible `updateNodeType` and every cable survives it (unit-tested: port ids
  identical before/after, one Ctrl+Z restores `add`).
- **`data-port-type` landed**, so `add` and `subtract` left
  `NOT_YET_ON_THE_SHARED_SOCKET` in `portDomContract.test.tsx`. That set is now
  `['minilab3-visual']` — the guard's "only ever shrinks" assertion updated with it.

### Multiplier
`multiplier-{light,dark}.png`

- **Change.** Was eleven inline style objects. Now a real stylesheet: one large mono
  `ValueScrubber` (22px) and, when `in-2` is connected, a `Chip` reading "driven by In 2"
  instead of a bare grey span.
- **Why a scrubber and not a knob** (the documented rule, §6): the factor has a floor of 0 and
  **no ceiling**. A dial would have to invent a maximum and then lie about the range under the
  player's hand.
- Wheel sweeps are now one undo step (`useGestureBracket`, closed on commit / pointer-leave /
  blur / unmount).

### Canvas I/O (`canvas-input` / `canvas-output`)
Rendered inside instruments; no standalone capture (§9, UNVERIFIED-visual).

- **Change.** The port *name* is the whole reason the node exists, so it IS the title — an
  `EditableLabel` in the header (double-click, or Enter when focused). The type chip says
  `FROM PARENT` / `TO PARENT`; the socket is a `PortRow`; one sentence says what the parent
  will see. The bespoke `@keyframes flash-red` is gone — refusal is the shared treatment.
- Dead `isGhost` prop + its CSS removed (nothing ever passed it).

### Input / Output panels → one `PortPanelNode`
`closeup-input-panel-{light,dark}.png`, `closeup-output-panel-{light,dark}.png`,
`01-container-inside-{light,dark}.png`

- **Consolidated** (audit §D): `InputPanelNode.tsx` (290 lines) and `OutputPanelNode.tsx` (247)
  were the same object seen from two sides and had already drifted — only one of them knew
  about bundles. They are now one `PortPanelNode` with a `direction` that decides exactly three
  things (which port direction it lists, which way a row reads, the word in the title). The two
  original modules survive as four-line wrappers so the `NodeWrapper` switch and every importer
  are untouched.
- **The card.** NodeShell, title `Inputs`/`Outputs`, mono chip `PANEL`, full-width `PortRow`s
  with `EditableLabel` names in the micro mono voice, bundle rows via `BundlePortGroup`, and
  the always-open slot as a dashed row whose name is a **ghost `Button`** ("+ ADD INPUT") over
  a dashed placeholder well. **The 2px black header is gone.**
- **Rename is atomic (UI-032).** One `renamePort` verb inside one history gesture — port name
  and `portLabels` move in a single store write, so one Ctrl+Z puts both back. Proven twice:
  a unit test on the store+UI, and in the browser (`"Out" → "Sustain" → Ctrl+Z → "Out"`,
  `05-panel-renamed.png` / `06-panel-rename-undone.png`).
- **Keyboard.** Enter/Space on a socket starts a connection (needed the `NodeWrapper` guard
  fix); Enter/double-click on a name opens the field; Escape reverts.
- **Deviation.** The brief asks for "a mono title chip (INPUTS/OUTPUTS)". The chip says
  `PANEL` and the Outfit title says `Inputs`/`Outputs` — putting the direction in both voices
  stutters, and the chip's job everywhere else on this canvas is the *type*.

### Container
`container-{light,dark}.png`

- **Change.** Was a bespoke header with a raw `<input>` and a 2px accent border. Now: an
  `EditableLabel` title, a mono chip that counts what the player put inside (`EMPTY` /
  `N INSIDE` — the container's own plumbing panels are not things the player added, so they do
  not count), the published ports as `PortRow`s, and a full-width ghost **`Button` "Open" +
  `Kbd` E** that is the same door the `E` key opens (and refuses the same way when there is
  nothing behind it). Widened to 220px so a name is a name, not an ellipsis.

### Song
`song-{light,dark}.png`

- **Change.** The last whole-surface theme leak in this family: 16 literal colours, a fixed
  cream paper, `2px solid #2a2a2a`, and an ochre "playing" fill. All gone. Now the ordinary
  card: title, mono `n tracks · n bars · n BPM` line, and **playing as a `Chip` + `StatusDot`**
  (plus a one-pixel success edge) — not an accent fill, because on this canvas an accent wash
  means "engaged control", and a rolling song is a state you read. `Open arrangement` + `Kbd E`
  as a ghost button. `.song-node` kept (`e2e/timeline-preview.spec.ts` selects it).

### Effect
`effect-{light,dark}.png`

- **Change.** Was a native `<select>` with emoji labels, three stacked sliders and eight inline
  style objects, on chrome inherited from `BaseNode.css`. Now: the type picker is an oj-ui
  **`Menu` popover** (per-instance outside-click, Escape restores focus to the trigger), and
  every parameter is a **`Knob`** with a mono readout — the handoff's `FilterBody`/`WetBody`.
  `frequency` and `q` sweep **logarithmically**; `time` reads in ms, mixes in %, level in ×.
- Changing the effect type re-seeds its parameters as **one** reversible step.

### Recorder
`recorder-{light,dark}.png`

- **Change.** Was 11 inline style objects **plus an injected `<style>` block** carrying its own
  `@keyframes pulse` (which duplicated a "this is live" idiom the rest of the app expresses
  with a danger edge, and which the app's blanket reduced-motion rule could not reach cleanly).
  All of it is tokens and CSS now. The card is: a big mono clock in an inset bed that turns
  danger-edged while armed, the incoming level as a `Meter` on the card surface, one
  Record/Stop `Button`, and the takes as an oj-ui `List`/`ListRow` with `IconButton` actions.
- **The clock never re-renders the node** — the Recorder's `onTimeUpdate` writes a text node
  directly; only `isRecording` and the takes list are state.
- **Deviation: no waveform.** The brief asks for "the waveform via oj-ui Waveform". A
  `RecordingState` carries `{id, name, duration, timestamp}` and nothing else; drawing a trace
  would mean decoding every take's blob on the audio-visual path to invent peaks that do not
  exist yet. The live level is a `Meter` instead. Flagged as a follow-up (peaks belong on the
  Recording, next to `duration`).

### AutoParamPanel (Pan / Width / hosted plugins / AI-authored nodes)

- **Change.** 14 lines carrying two incompatible jobs. Now it declares which one it is:
  `≤ KNOB_LIMIT` (6) → **a FACE**: real dials, wrapped and centred, inside the node's own body
  padding. `> KNOB_LIMIT` → **a TABLE**: the filter, the pinned section, the scroller and the
  hosted-plugin footer, full-bleed to the card edges. The old `margin: -16px` bled the *dials*
  out of a 12/14px padding too, so a one-knob Pan hung off its own card; the bleed is now
  scoped to the table and corrected to `-12px -14px`.
- Sticky group headers, the mono param count, the unsaved-state bead and the bypass button all
  moved onto tokens (`--warning-ink` for "unsaved", `--accent-primary` for the open window).
- Also fixed here: `.plugin-window-glyph.oj-button` — the class is `oj-btn`, so that rule (and
  four I wrote before catching it) had never applied to anything.

---

## 3. The shared feedback treatment (UI-029)

`.flashing` and `.deletion-attempted` were emitted by five faceplates with **no CSS behind
them**. One treatment now lives in `SchematicBase.css`:

- The **static** state is already the full read — `--accent-danger` border + a 1px inset ring —
  and a 120 ms two-beat pulse rides on top. So `global.css`'s blanket reduced-motion rule
  (which collapses animations to 0.01ms) needs **no local override**: the refusal stops moving
  and stays legible for the ~400ms the `uiFeedbackStore` holds the class.
- The **spoken half** is a new `NodeFeedback` component: a visually-hidden
  `role="status" aria-live="polite"` span carrying the *reason* ("This node has nothing inside
  — it cannot be entered.", "This port belongs to the container — it cannot be deleted here.").
  Colour is never the only carrier.
- Browser-verified in both themes: pressing `E` on a Math node gives
  `class="… math-node add deletion-attempted"` and the live region reads the sentence
  (`state-refusal-math-{light,dark}.png`).

---

## 4. New / deleted files

**New:** `PortPanelNode.{tsx,css}` (the directional panel), `NodeFeedback.tsx`,
`nodeControls.ts` (`useGestureBracket`, `useNodeRefusal`), `EffectNode.css`,
`RecorderNode.css`, `MultiplierNode.css`, `__tests__/w5p6Faceplates.test.tsx`.

**Deleted:** `BaseNode.css` (§1) and its `NodeWrapper` import.

**Tokenized (already New-DNA-shaped from S3b, so only the last raw values):**
`BundlePortGroup.css` — `10/11/12px` font sizes → `--text-micro`/`--text-xs`,
`monospace` → `--font-mono`, `transform 0.15s ease` → `--motion-fast`. The S3b bundle-label
fix (the 90px name column and the `grid-template-columns: 22px minmax(90px, 1fr) auto 18px`
row) is untouched and still pinned by `BundlePortGroup.test.tsx`.

**Rewritten:** `SchematicBase.css`, `SpeakerNode.{tsx,css}`, `MicrophoneNode.{tsx,css}`,
`MathNode.{tsx,css}`, `CanvasIONode.{tsx,css}`, `ContainerNode.{tsx,css}`,
`SongNode.{tsx,css}`, `MultiplierNode.tsx`, `EffectNode.tsx`, `RecorderNode.tsx`,
`AutoParamPanel.{tsx,css}`, `InputPanelNode.tsx`/`OutputPanelNode.tsx` (→ wrappers).
**Pruned:** `_sockets.css`. **Touched (tests):** `portDomContract.test.tsx`,
`BundlePortGroup.test.tsx`, `Arrangement/__tests__/tokenLiteralGate.test.ts` (§9).

---

## 5. Tests

`src/components/Nodes/__tests__/w5p6Faceplates.test.tsx` — 10 tests, all green:

1. the Speaker writes `--oj-meter-signal` **and** the dB text from the shared frame, never
   state (0.5 → `-6.0 dB`; 0 → `-∞ dB`);
2. the LEVEL knob is a keyboard `slider` in the tab order and ArrowDown changes `node.data`;
3. the output route is a `combobox` that opens a `listbox` on ArrowDown;
4. mute is one reversible step and drops the meter to 0;
5. the Microphone route opens on ArrowDown and closes on Escape;
6. the Microphone meter follows the frame and reads 0 while muted;
7. `renamePort` moves name + `portLabels` together and one undo reverts both;
8. renaming through the panel UI is one gesture, undone by one Ctrl+Z;
9. Enter on a panel socket starts a connection (the UI-017 fix);
10. a refusal draws `deletion-attempted` **and** speaks it in the aria-live region; and the
    segmented control flips `add`↔`subtract` keeping every port id, reversibly.

`portDomContract.test.tsx` (110 cases) covers the "every advertised port renders
`.oj-port[data-node-id][data-port-id][data-port-type]`" requirement for all my types and is
now **stricter** by two node types.

---

## 6. The control rule (documented, as asked)

> **A bounded parameter gets a `Knob`, up to `AutoParamPanel`'s `KNOB_LIMIT` of 6 — the point
> at which a face stops being playable and starts needing to be scannable. Above it, rows.
> An UNBOUNDED value gets a mono `ValueScrubber`, because a knob needs two ends and inventing
> a maximum is a control that lies. Frequencies sweep logarithmically.**

One number, `KNOB_LIMIT`, already in `AutoParamPanel`; the Effect (≤3 params) and Pan/Width
(1 each) are all dials by it; the Multiplier is the unbounded case. No `Slider` survives in
this lane.

---

## 7. oj-ui API needs (composed only; nothing in `packages/oj-ui` was edited)

1. **`Meter` — the idle track needs to be a local custom property.** `.oj-meter__bar` hard-codes
   `background: var(--bg-tertiary)`, so a meter placed on any `--bg-tertiary` surface (an inset
   bed, a Button, a Chip) is *invisible at rest*. I hit this twice and had to restructure both
   the Microphone and the Recorder around it. Ask: `--oj-meter-track`, defaulting to
   `--bg-tertiary`.
2. **`Meter` — a horizontal/compact variant.** At 40px+ the bar row reads as a barcode because
   only the *fill* is arched; the tracks are uniform full-height. A `variant="bed"` that arches
   the tracks too (or exposes `--oj-meter-k` on the track height) would make a big meter read as
   a meter at rest.
3. **`Knob` — a `size="sm"` token.** I pass `size={44}` on the Effect; a named step beside
   `--knob-size` would keep the two sizes on the system.
4. **`Button` — the class is `oj-btn`, not `oj-button`.** Five app rules (one of them
   pre-existing, in `AutoParamPanel.css`) targeted `.oj-button` and had never applied. Worth a
   Ladle/CI note or an `oj-button` alias.
5. **`EditableLabel` — controlled mode disables keyboard entry.** When `editing` is a prop, the
   component's own `beginEditing` (double-click / Enter) becomes a no-op, so a controlled
   consumer must re-implement both. Ask: fire an `onRequestEdit` callback in controlled mode.

---

## 8. Contrast (measured, not asserted)

`contrast.mjs` renders every faceplate in both themes and walks each visible text run,
compositing the real background stack and computing the WCAG ratio from **computed styles**.
`contrast.json` has all 110 rows. **0 failures.** Representative floors (the worst cases):

| Run | Light | Dark | Floor |
|---|---:|---:|---|
| `.oj-node__type` chip (`OUT` / `SONG` / `EMPTY` / `PANEL`) | 5.22 | 4.87 | 4.5 |
| Port-row + panel names, 9.5px mono (`AUDIO IN`, `IN 1`, `+ ADD INPUT`) | 5.49 | 5.05 | 4.5 |
| `Knob` label (`LEVEL`, `AMOUNT`) | 5.49 | 5.05 | 4.5 |
| `Knob` value / `speaker-db` / `mic-db` | 7.13 | 6.93 | 4.5 |
| `math-explainer`, `song-node-summary`, `recorder-hint` | 5.49 | 5.05 | 4.5 |
| `recorder-clock__time` (22px mono) | 5.92 | 6.18 | 4.5 |
| `Segmented` inactive segment | 5.92 | 6.18 | 4.5 |
| Node titles / device labels / ghost-button labels | 14.2–17.1 | 12.8–14.4 | 4.5 |

The 9.5px micro-voice is held to the **4.5:1** small-text floor, not the 3:1 large-text one.

---

## 9. What I could NOT verify, and what is not mine

**UNVERIFIED — the Speaker meter never moved with real audio.** The rig was built through the
real UI (context menu → keyboard → Keys → Effect → Speaker), **3 cables** landed, and holding
`a` emitted a real note event (`{type:'on', row:2, keyIndex:0}` via the e2e bridge). But the
meter read `0.000` for the whole 1.5s hold — **and so did the transport pill's master meter**,
which is a different lane's component reading the same engine stream through the same shared
frame. I reproduced it headless *and* headed with a real Windows audio device. So the browser
tier's per-node level stream is producing no meter frames in this environment; it is not this
lane's plumbing. What I *did* prove in the browser is the plumbing itself: the meter element
carries `--oj-meter-signal: 0.000` written by the frame writer (an unwritten property returns
`''`), and the unit test proves the value tracks the level. **Needs the founder listening pass
with audio actually playing** — codex/harness never signs off on feel.

**UNVERIFIED — Pan / Width faceplates have no screenshot, because nothing can place them.**
`pan` and `width` are registered node types (`ui:'auto'`, real engine params) but they appear
in **no `nodeCategories` entry**, so neither the canvas context menu nor the command palette
offers them; the palette's Add list is built from the same categories. I confirmed this in the
browser and could not inject them either (`import('/src/store/graphStore.ts')` from the page
yields a *second* module instance — the bridge's graph stayed at 0 nodes). **Two shipped node
types are unreachable by any user.** `registry.ts` is not in my ownership — handing this to
P10 / the orchestrator. The `AutoParamPanel` redesign itself is covered by its 6 unit tests
and by the Effect card, which composes the identical `Knob` treatment.

**Node context menu — Canvas-owned, not mine.** The S3 review's "right-click on a node opens
nothing" is `NodeCanvas.tsx:283`: `rightClickOnCanvas.current = !isOnNode`, and the menu is
`NodeCanvas` local state with no `openContextMenu` seam exposed. `src/components/Canvas/**` is
outside this lane, so I did not wire it. Good news: the canvas menu is already the oj-ui `Menu`
(P2 landed that), so the fix is one condition plus a node-scoped item set.

**Two red tests, both in other lanes' files** (this worktree runs lanes concurrently):

- `Arrangement/__tests__/tokenLiteralGate.test.ts › uses no undeclared CSS variables` fails on
  `['--x']`. The offender is a **comment** in `src/components/Plugins/PluginsPanel.css:9`
  (W4-P9's lane) whose prose contains the literal text `var(--x)`; the gate's regex has no
  comment stripping. Not a real leak — but the gate should ignore comments.
- `Nodes/__tests__/w5p8Faceplates.test.tsx › routes Row 1 to a connected instrument as a real
  MIDI note` — P8's own new test, P8's own files.

My scoped run is otherwise green (532 passed). Two more pieces of the same cross-lane churn,
recorded so the orchestrator can tell them apart from this lane:

- The dev server briefly broke mid-run with `ReferenceError: verdict is not defined` from
  `AudioHealth/AudioHealthPanel.tsx` (W4-P9 mid-edit); I re-ran once it cleared.
- On the very last check, `bunx tsc` went from 0 to **2 errors, both in
  `src/components/Arrangement/**`** (`Cannot find module './TransportStrip'`,
  `'./trackTint'` — W4-TB mid-rename). Filtering tsc to everything outside
  `Arrangement|PianoRoll|Clips|Plugins|Shell|Settings|Guides|Export` is **empty**: no
  P6-owned type error at any point. The lane's own clean full-repo `tsc` and `bun run build`
  runs are recorded at the top of this report.

**Other deviations, collected:**

- No monitor toggle on the Microphone (§2) — no engine path exists.
- No waveform on the Recorder (§2) — no peak data exists on a `Recording`.
- Panel chip says `PANEL`, not `INPUTS`/`OUTPUTS` (§2).
- `Math` / `PortPanel` / `CanvasIO` sit **below** the shared 190px `--node-min-width` (176 /
  176 / 184) and restate `min-width` to do it. Deliberate: a two-socket utility card should not
  take an instrument's footprint ("coherence over consistency"). Every one is annotated.
- `_sockets.css` was edited (pruned, §1) — flagged as required.
- `Arrangement/__tests__/tokenLiteralGate.test.ts` was edited: its `removes the Speaker range
  input outer track` case pinned a `.speaker-volume-slider` rule for a control that no longer
  exists. Replaced with the stronger invariant that now holds — the Speaker owns no bespoke
  range styling, renders no `type="range"`, and its level control is the shared `Knob`.
- `BundlePortGroup.test.tsx` was edited: the 190px bundle-width assertion follows the rule to
  `PortPanelNode.css` (same selector shape, same value).

---

## 10. Screenshot index

`plans/redesign-new-dna/.scratch/w5-p6/`

| What | Light | Dark |
|---|---|---|
| Whole canvas, nine faceplates | `00-canvas-light.png` | `00-canvas-dark.png` |
| Inside a container (both panels) | `01-container-inside-light.png` | `01-container-inside-dark.png` |
| Speaker | `speaker-light.png` | `speaker-dark.png` |
| **Speaker close-up** | `closeup-speaker-light.png` | `closeup-speaker-dark.png` |
| Microphone | `microphone-light.png` | `microphone-dark.png` |
| Effect | `effect-light.png` | `effect-dark.png` |
| Recorder | `recorder-light.png` | `recorder-dark.png` |
| Add / Subtract | `math-add-light.png`, `math-subtract-light.png` | `math-add-dark.png`, `math-subtract-dark.png` |
| Multiplier | `multiplier-light.png` | `multiplier-dark.png` |
| Container | `container-light.png` | `container-dark.png` |
| Song | `song-light.png` | `song-dark.png` |
| **Inputs panel close-up** | `closeup-input-panel-light.png` | `closeup-input-panel-dark.png` |
| **Outputs panel close-up** | `closeup-output-panel-light.png` | `closeup-output-panel-dark.png` |
| Selected · refusal · hover-connecting | `state-*-light.png` | `state-*-dark.png` |
| Rig wired / played | `02-rig-light.png`, `03-rig-playing-light.png` | — |
| DeviceSelect opened by keyboard | `04-device-select-keyboard.png` | — |
| Panel rename + undo | `05-panel-renamed.png`, `06-panel-rename-undone.png` | — |

Harnesses (run with **node**, dev server on 5219): `verify.mjs` (the acceptance pass),
`contrast.mjs`, `states.mjs`; `measure.mjs` / `pan.mjs` / `probe-audio.mjs` are the
investigation scripts behind §9. The dev server was stopped.

---

## P6b — the review's must-fixes (M1, M2)

Two surgical fixes from `W5-P6-REVIEW.md` §6. No visual redesign work, no new
surface: a meter that agreed with its own number, and a pulse that starts on time.

### M1 — the Microphone and the Recorder meters now ride the readout's dB scale

Both drove the oj-ui `Meter` with the **raw linear** level while their readouts were
in dB. At a normal input (~0.02 RMS = −34 dB) the bars sat empty under a live number.
Both now go through the one **shared** `meterScale` — imported, not copied, from
`src/components/Shell/masterSignal.ts:40`, the module that already exports it and that
the Speaker's local copy mirrors.

| File:line | Change |
|---|---|
| `src/components/Nodes/MicrophoneNode.tsx:28` | `import { meterScale } from '../Shell/masterSignal';` |
| `src/components/Nodes/MicrophoneNode.tsx:196–206` | `setSignal(level)` → `setSignal(meterScale(level))`, plus the comment saying why a linear bar under a dB readout is a lie |
| `src/components/Nodes/RecorderNode.tsx:35` | same import |
| `src/components/Nodes/RecorderNode.tsx:81–88` | `setSignal(… levels.get(node.id) ?? 0 …)` → `setSignal(… meterScale(levels.get(node.id) ?? 0) …)`; still silent while idle |

`meterScale(0.1)` is `0.667`, not `0.100` — that difference is the whole finding.

### M2 — the refusal pulse starts immediately

`animation: oj-node-refuse 120ms var(--motion-fast) 2 alternate` expanded to
`… 120ms 120ms cubic-bezier(…) …`: the token's own duration was consumed as
**`animation-delay`**, so the two-beat pulse began 120 ms into the ~400 ms the class
is on. The token is `<duration> <easing>` and is now passed as the whole timing,
which is also how every other `animation:` in the repo uses it.

| File:line | Change |
|---|---|
| `src/components/Nodes/SchematicBase.css:133` | `animation: oj-node-refuse var(--motion-fast) 2 alternate;` (explicit `120ms` dropped) |
| `src/components/Nodes/SchematicBase.css:110–126` | comment now states that the token is the whole timing and why a duration in front of it would become a delay |

### Tests

New — `src/components/Nodes/__tests__/w5p6bMeterScale.test.tsx` (5 tests):

- `M1 — every meter is on the readout's own dB scale`
  - `Microphone: the meter is written with meterScale(level), never the raw linear level`
  - `Recorder: the armed meter is written with meterScale(level), never the raw linear level`
- `M2 — the refusal pulse starts the moment the refusal does`
  - `passes --motion-fast as the whole timing, with no duration in front of it`
  - `declares no animation-delay (or an explicit 0s)`
  - `takes its duration and easing from the motion token, not a literal`

The M1 tests push `0.1` through the captured shared-frame writer and assert the
`--oj-meter-signal` the `Meter` writes equals `meterScale(0.1).toFixed(3)` (`0.667`)
and explicitly **not** `0.100`. The M2 tests `readFileSync` the shipped
`SchematicBase.css` and assert on the declaration a browser will parse.

Updated — `src/components/Nodes/__tests__/w5p6Faceplates.test.tsx:187–191`: the
Microphone meter assertion pinned the *linear* value (`toBeCloseTo(0.6)`); it now
pins `meterScale(0.6)`. That test was the one thing holding the bug in place.

### Verification

- `bun run test:run -- src/components/Nodes` → **7 files, 151 tests, all pass**
- `bunx tsc --noEmit -p tsconfig.app.json` → **clean** (no errors from any lane)
- `bunx eslint src/components/Nodes` → **clean**

### One deliberate leftover

`SpeakerNode.tsx:79` still defines its own byte-identical `meterScale` (its comment
already says "Mirrors `Shell/masterSignal`"). `SpeakerNode.tsx` is outside this
round's ownership, so it was left alone — a two-line follow-up: delete the local
copy and import the shared one, so there is exactly one meter scale in the app.
