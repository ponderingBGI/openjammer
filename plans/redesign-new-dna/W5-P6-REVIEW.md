# W5-P6 REVIEW — shared schematic chrome + the utility / IO faceplates

**Verdict: COMMIT.** Read-only review. Artifacts (40 screenshots, 8 harnesses, 5 JSON
result files, 4 gate logs): `plans/redesign-new-dna/.scratch/w5-p6-gate/`.
Harnesses run under `node`, one Chromium, dev server on 5223, server stopped.

Gates, re-run by me on the current worktree (not the lane's numbers):

| Gate | Result |
|---|---|
| `bun run test:run -- src/components/Nodes src/components/Canvas src/components/params packages/oj-ui` | **51 files, 527 tests, 0 failed** (the lane reported 2 red; both were other lanes' and are green now) |
| `bunx tsc --noEmit -p tsconfig.app.json` | **0 errors** — no in-progress-lane errors either; the `Arrangement` breakage the lane saw has cleared |
| `bunx eslint src/components/Nodes src/components/params` | **0 problems** |
| `bun run build` | **pass** |
| Browser (node, 5223, light + dark) | **0 console errors, 0 page errors** |

---

## 1. Base chrome — verified, and the decision was right

`.schematic-node` is a genuine declaration-for-declaration mirror of `.oj-node`
(surface, 1px `--border-subtle`, `--radius-lg`, `--shadow-overlay`, selected /
focus-visible / dragging), plus exactly two things `.oj-node` cannot own: canvas
`position: absolute` + `--z-node`, and the canvas-only states.

**Measured in the browser, all nine P6 types on one canvas plus the two panels inside a
container, in both themes:**

- **9 node roots, 19 ports, `doubleHeader = 0`** — every card renders exactly one
  `.oj-node__header`. Same inside a container: `input-panel-node` and `output-panel-node`
  each one header.
- **`data-canvas-node-root` present on every node**; the `SCHEMATIC_TYPES` switch intact.
- **All 19 `.oj-port` carry `data-node-id` + `data-port-id` + `data-port-type`** — 0 misses.
- Computed `position`: `absolute` on every `.schematic-node`; `relative` on the three
  non-schematic cards (Effect / Multiplier / Recorder), which is correct — `NodeFrame`
  positions those. The `position: absolute` vs `.oj-node { position: relative }` cascade
  collision resolves the right way in the real bundle; I checked it rather than assuming it.
- Drag/select/context-menu, mouse port drag and hover-connecting all still work
  (`gate3.json`, `gate.json`).

**Not mounting `NodeShell` centrally for all `SCHEMATIC_TYPES` was correct**, and I
verified the reason rather than accepting it: `LibraryNode.tsx`, `LooperNode.tsx` and
`SamplerNode.tsx` are the only three files that still emit `.schematic-header` from their
own markup. A central mount would have given those three two headers each. The P8
families (Keyboard / KeyboardVisual / Instrument / MIDI / MiniLab3) no longer emit it, so
they are already clean.

**The deleted `BaseNode.css`.** Its eight class families: `.port-label` now resolves to
`_sockets.css`'s New DNA micro mono voice (`--font-mono`, `--text-micro`,
`--tracking-micro`, uppercase, `--text-muted`) — confirmed rendering on the Keyboard and
MIDI families in the canvas captures. The other seven (`.node-row`, `.node-label`,
`.node-select`, `.node-controls`, `.loop-list`, `.loop-item`, `.loop-actions`) have **zero
emitters left in `src/`** — I grepped every `.tsx`. *Correction to the lane's report §1:
they were not "moved into EffectNode.css / RecorderNode.css"; they were deleted, and
nothing emits them. That is the better outcome (code-value #8) but the report's blast-radius
table is wrong about it.*

Dead-CSS scan over the ten owned stylesheets: **no orphan selectors**.

---

## 2. Per-faceplate verdicts

| Faceplate | Verdict | Note |
|---|---|---|
| **Speaker** | **PASS** | The handoff's Output card, faithfully: LEVEL `Knob` (100% / dbl-click → 100%), 9×5×44 `Meter`, mono dB readout (`-∞ dB` below −60), hairline, `DeviceSelect` + mute `IconButton` with `aria-pressed`, low-latency `Chip`, no-`setSinkId` `Callout`. Meter + readout stay out of React (one shared frame, one custom-property + one text-node write). dB scale, not linear. Per-instance outside-click (UI-018) confirmed in code. |
| **Microphone** | **PASS with must-fix M1** | Mirrors the Speaker; honest `granted`/`unnamed`/`unavailable` permission `Callout`s; devices with withheld ids are omitted, not listed unpickable. **Its meter is on the raw linear scale, not the Speaker's dB scale.** No monitor toggle — correctly declined, there is no engine path. |
| **Math (Add/Subtract)** | **PASS** | Operator is the mono chip, three `PortRow`s (universal, rainbow-until-typed), operation as a reversible `SegmentedControl` over `updateNodeType`, one mono explainer (`In 1 − In 2`). `data-port-type` now emitted — verified in the DOM. Segments legible and distinct in both themes. |
| **Multiplier** | **PASS** | Eleven inline style objects → a stylesheet. One 22px mono `ValueScrubber`, `Chip` "driven by In 2" when `in-2` lands. The scrubber-not-knob rule (floor 0, no ceiling) is right and documented. Wheel sweep = one undo step. |
| **PortPanelNode (Inputs/Outputs)** | **PASS** | Two ~270-line near-duplicates → one directional component; both old modules survive as 4-line wrappers so the switch and every importer are untouched. Rows read `[name][socket]` / `[socket][name]`, `EditableLabel` names in the micro mono voice, bundle rows via `BundlePortGroup`, ghost "+ ADD INPUT" over a dashed placeholder well. The 2px black header is gone. **Rename verified live: `Out` → `Sustain` → one Ctrl+Z → `Out`.** The `PANEL` chip instead of `INPUTS`/`OUTPUTS` is the right call — the chip's job everywhere else is the type. |
| **Container** | **PASS** | `EditableLabel` title, `EMPTY` / `N INSIDE` chip counting only what the player added, published ports as `PortRow`s, full-width ghost `Button` "Open" + `Kbd` E, 220px so a name is a name. |
| **Song** | **PASS** | **13 literal colours → 0** (measured against HEAD). Playing is a `Chip` + `StatusDot`, not an accent wash — the right read. `.song-node` kept for `e2e/timeline-preview.spec.ts`. |
| **Effect** | **PASS** | Native `<select>` + 3 sliders + 8 inline styles → an oj-ui `Menu` popover (per-instance outside-click, Escape restores focus to the trigger) and `Knob`s with mono readouts. Log sweeps on `frequency`/`q`. Type change re-seeds params as one reversible step. The dead `pitch` option is correctly gone (`EffectType` never had it). |
| **Recorder** | **PASS with must-fix M1** | No inline styles, no injected `<style>`, no bespoke `@keyframes pulse` — all tokens now. Clock writes a text node, never re-renders. Takes as `List`/`ListRow` + `IconButton`s. **Its meter is also on the raw linear scale.** No waveform — correctly declined, a `Recording` carries no peaks. |
| **CanvasIO** | **PASS** | Name-is-the-title `EditableLabel`, `FROM PARENT` / `TO PARENT` chip, one `PortRow`, one sentence. Bespoke `@keyframes flash-red` gone. Dead `isGhost` removed. Not separately capturable (renders inside instruments) — verified by code + the shared invariants pass. |
| **AutoParamPanel** | **PASS (design), UNVERIFIABLE (visual)** | The face-vs-table rule is right and the `KNOB_LIMIT = 6` threshold is the honest place to draw it; the `margin: -16px` bleed is now scoped to the table and corrected to `-12px -14px` (it matches `NodeShell`'s real body padding). Cannot be seen in the app because `pan`/`width` are unreachable — see F5. Covered by its 6 unit tests and by the identical `Knob` treatment on the Effect card. |

---

## 3. Level stream — the lane's headline UNVERIFIED is **wrong**; the stream works

The lane reported "the browser tier's per-node level stream is producing no meter frames
in this environment". I measured the whole path with the worklet `MessagePort` and the
executor both instrumented from the page (`gate3.mjs`, `gate4.mjs`, `gate5.mjs`):

- `AudioContext` = 1, `AudioWorkletNode` = 1, `ctxState: "running"`.
- Executor → worklet: `["init","meters:true","graph","load-sample","graph","command"]` —
  the meter enable is sent, and `ojcore-processor.ts:200` calls `wasm.set_metering(true)`
  because `this.ready` is already true when it arrives.
- Worklet → executor: **`meters` × 4511** in one 2.5 s window.
- `subscribeSignalLevels` delivered **238 frames**; the Speaker's own visual node id is
  **present** in the level map (`reverseIndex` is populated on the canvas by
  `pushGraphInner`, not only by `publishArrangement`).
- **With a real held key on a real wired rig: `speakerPeak = 0.409`,
  `--oj-meter-signal: "0.512"`, `.speaker-db` = `"-29.3 dB"`.** The meter moves.

**Why the lane saw zeros:** its rig wiring did not land, so the signal reaching the Speaker
was ≈ 0.00017 linear = **−75.6 dBFS**. Both `formatDb` (floor −60) and `meterScale`
(clamped at 0) then correctly report `-∞ dB` / `0.000`. That is the meter being *honest*,
not the stream being dead. The transport pill reads 0 for the same reason and by the same
correct fallback: `hasMasterKey: false` on the canvas, so `masterSignal` falls back to the
speaker ids and reports the same −76 dBFS.

**No executor follow-up lane is needed.** Nothing at HEAD~3 was broken and nothing was
regressed. The one legitimate remaining item is a founder listening pass with audio in the
room — a harness never signs off on feel.

---

## 4. UI-017, the `e.button` guard, and `oj-btn`

The guard change is `e.button != null && e.button !== 0` — a `KeyboardEvent` cast has no
`button` and now passes; a real `MouseEvent` always has one, so right-click is still
rejected. Measured live on a panel port:

| Check | Result |
|---|---|
| `Enter` on a focused port | `isConnecting = true` ✅ |
| `Space` on a focused port | `isConnecting = true` ✅ |
| Mouse drag from a port | `isConnecting = true` during the drag ✅ (not regressed) |
| **Right-click on a port** | `isConnecting = false` ✅ (guard intact) |
| Port keyboard affordance | `role="button" tabindex="0" aria-label="… port"`, in the document tab order (56 tabbables, port included, no `inert` ancestor) |
| Focus ring | **one ring**: `:focus-visible` matches under keyboard modality and paints `--shadow-inset, var(--focus-ring)` (3px accent @28%). From `Port.css:51` — nothing local, nothing duplicated |

`.oj-button` → `oj-btn`: **six** rules now apply (`AutoParamPanel`, `ContainerNode`,
`EffectNode`, `PortPanelNode`, `RecorderNode`, `SongNode`) — the report says four; it is
six, and all six are correct. Nothing else regressed. One `.oj-button` rule survives
repo-wide, in `Collab/CollabControl.css:99` (P9's lane, same never-applied bug).

---

## 5. Contrast, motion, tokens, states

- **Contrast, measured from computed styles with the real composited background stack:**
  61 text runs light / 61 dark, **0 failures**, worst run **4.57 (light) / 4.50 (dark)**
  against a 4.5 small-text floor. The 9.5px micro mono voice is held to 4.5, not the 3:1
  large-text exemption. Both themes.
- **No literal colours** in any owned CSS or TSX (the only `#` hits are the `&#8734;`
  entity for ∞). **Zero `style={{…}}`** across all eleven owned components.
- **Reduced motion:** the blanket `global.css:41` rule covers the refusal pulse; the static
  danger edge is declared outside the keyframe, so a refusal stays fully legible when it
  stops moving. No local override needed — correct. (But see M2.)
- **States, both themes:** default / hover / selected (accent edge, no size change) /
  dragging / connected (socket core takes the wire colour) / hover-connecting /
  clip-drop-target / bypassed / refusal all distinct. Refusal verified live on the Math
  node in both themes: the class lands **and** the aria-live region reads
  *"This node has nothing inside — it cannot be entered."* Colour is never the only carrier.
- **`portDomContract.test.tsx` is now strictly stronger**: `NO_SOCKETS_HERE` and
  `NOT_YET_ON_THE_SHARED_SOCKET` are both empty and the guard asserts empty.
  `Arrangement/__tests__/tokenLiteralGate.test.ts` is **not modified** in the worktree
  (the report claims it was) and passes 6/6.

---

## 6. Must-fix (ranked, all small, none blocking the commit)

1. **M1 — three meters, two scales.** `MicrophoneNode.tsx` (`setSignal(level)`) and
   `RecorderNode.tsx:84` (`setSignal(levels.get(node.id) ?? 0)`) drive the bars with the
   **raw linear** level while their own readouts are in dB and the Speaker uses
   `meterScale()`. This is the lane's own documented rule — *"a linear meter is a lie
   dressed as precision"* — violated on two of its three meters. At a normal input level
   (~0.02 RMS) the mic meter shows zero bars while its readout says −34 dB. Two lines:
   route both through the same `meterScale` (or lift it out of `Shell/masterSignal`).
2. **M2 — `SchematicBase.css:128` mis-uses the motion token in an `animation` shorthand.**
   `animation: oj-node-refuse 120ms var(--motion-fast) 2 alternate` expands to
   `… 120ms 120ms cubic-bezier(…) 2 alternate` — the token's `120ms` is consumed as
   **`animation-delay`**, so the refusal pulse starts 120 ms late inside a ~400 ms window.
   Every other `animation:` in the repo passes the token alone (correct). Drop the explicit
   duration, or spell the easing out.
3. **M3 — correct the record.** The lane's §9 "no meter frames arrive" and §1's
   "`.node-row` … moved into EffectNode.css / RecorderNode.css" are both factually wrong
   (§3, §1 above). No code change; the orchestrator should not open the executor
   follow-up lane the report asks for.

## 7. Should-fix / follow-ups (not this lane's gate)

- **F1 — `Meter` reads as a barcode at rest.** At 44 px the tracks are uniform full-height
  so the signature Speaker faceplate's most prominent element looks like a static glyph.
  This is the lane's own oj-ui ask #2 and it is the biggest remaining taste gap. Worth an
  oj-ui `variant="bed"` (arch the tracks, not only the fill) plus `--oj-meter-track` (ask #1)
  so a meter can sit on `--bg-tertiary` at all.
- **F2 — no `IconMic` in oj-ui**, so the Microphone's mute button wears a *speaker* glyph.
  Semantically wrong on an input card. Add the icon.
- **F3 — schematic faceplates never render `agentPending`.** `schematicProps` does not
  carry `isAgentPending` (pre-existing at HEAD), so a Ctrl+K-added Speaker / Song /
  Container gets no violet hairline. Now one prop away, since all nine render through
  `NodeShell`.
- **F4 — chip voice splits at the schematic boundary.** The nine schematic cards show a
  *type* chip (`OUT`, `IN`, `SONG`, `+`, `PANEL`); Effect / Multiplier / Recorder get
  `NodeWrapper`'s *category* chip (`EFFECTS`, `UTILITY`, `OUTPUT`). "EFFECTS" plural on one
  effect reads wrong.
- **F5 — `pan` / `width` are unreachable** (registry, not P6): both are registered with
  real engine params and `ui:'auto'`, but appear in no `menuCategories` entry, so neither
  the context menu nor the palette offers them. **Two shipped node types no user can
  place.** → registry / P10. Confirmed by reading `registry.ts:892-919`.
- **F6 — meter stream: nothing to do.** Retire the proposed executor lane (§3).
- **F7 — app-level focus trap (TB lane, not P6).** Tab on the canvas cycles forever between
  `.arrangement-surface song-interior` and `.surface-layer` and never reaches a node port:
  the hidden peer surface holds the tab order. UI-017's keyboard path is correct but
  unreachable by Tab until that is fixed.
- **F8 — nits.** `PortPanelNode.tsx:233` `align={direction === 'input' ? 'left' : 'left'}`
  is a dead ternary. Speaker mute is wrapped in a history gesture; Microphone mute is not.
  `DeviceSelect` truncates real device names hard at 190–232 px ("Fake Audio Outp…") —
  a `title` would help.
- **F9 — `.oj-button` survives in `Collab/CollabControl.css:99`** (P9's lane).

---

## Verdict

**COMMIT.** The base-chrome decision is right and I verified the reason for it rather than
accepting it; zero double headers on every node type in both themes; the DOM contract,
positioning, drag/select and port hit-testing are all intact; UI-017 works and did not
break the mouse path or the right-click guard; every gate is green on the current
worktree; 0 literal colours, 0 inline styles, 0 dead CSS, 122 measured text runs with no
contrast failure. The nine faceplates read as one instrument in both themes — this is the
first wave where the canvas actually looks like the handoff. M1 and M2 are four lines
between them and should land before the branch merges; they change no structure and block
nothing.
