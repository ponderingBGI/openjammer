# Wave 3 — TA2c gate review (adversarial)

Date: 2026-08-29. Worktree `t3code-2faff191`, branch `t3code/openjammer-redesign-timeline`.
Read-only: no file in `src/`, `docs/`, `pi-openjammer-graph/`, and no git state, was modified.
Evidence: `plans/redesign-new-dna/.scratch/w3-ta2c-gate/` — `probe-gate{,2,3,4}.{ts,json}`,
`gate-final.png`, `gate2-final.png`, `gate3-final.png`, `gate4-final.png`,
`tsc.txt`, `eslint.txt`, `vitest.txt`, `e2e.txt`, `dev.log`.
Browser: one Chromium, `node --experimental-strip-types`, dev server on **5211** (stopped after
the run; port verified free). Concurrent lanes' files (App/Toolbar/Shell/Onboarding/SafeMode/
CommandBar/ContextMenu/oj-ui) were excluded from judgment.

## Verdict

**DO NOT COMMIT.**

The round is real, and most of it is good. Six of the eight findings are genuinely closed and
browser-proven, including the two the previous gate could not verify at all: **automation
gestures now pass all four laws live** (add / drag / Escape / range = 1, 1, 0-and-restored, 1)
and the **playhead makes zero new store subscriptions per published tick** while playing *and*
stopped. The threshold fork is gone, `COPY_DRAG_X_THRESHOLD_PX` has exactly one definition, the
snap-unification test now pins four distinct hand-computed laws, the resize handles are 5 px/6 px
and actually drag, the loop bracket tracks its ticks through scroll *and* zoom with zero drift,
and the brace row creates, moves and resizes ranges at one entry each. TA2b's blocking must-fix 1
— dead Ctrl+Z in a focused inline roll — is closed and pinned (`57 → 58 → 57 → 58`, one entry).

But the mechanism chosen to close it — unconditional inside-out fall-through, with every
piano-roll `run` returning `true` — introduced **four browser-proven regressions**, two of them
destructive song edits, and the 64 px ruler landed without its dependent offsets, which
**breaks a shipped e2e test** and misaligns the playhead by 18 px. By this gate's own standing
rule, regressions do not get the incompleteness carve-out.

Six must-fixes. Four are a few lines each; the ruler-offset one is a CSS parcel that must ship
with this diff, not after it.

## Gates

| Gate | Result |
|---|---|
| `bunx tsc --noEmit -p tsconfig.app.json` | **PASS** (exit 0) |
| `bunx eslint src` | **PASS** (exit 0) |
| `bun run test:run` (full, once) | **PASS** — 194 files, 2097 tests, no retry. No other lane left a transient failure |
| `git diff --check` | clean (CRLF notices only) |
| New `any` / `console.*` / `TODO` / `debugger` in scope | none |
| `gestureHandles.css` structural only | **yes** — geometry, `z-index`, `cursor` only; no colour, font, shadow or radius |
| `bunx playwright test e2e/arrangement-editing.spec.ts --project=chromium` | **FAIL — 8 passed, 1 failed** (`S splits at the playhead and selects both halves`) |
| Console + page errors across four browser journeys | **1 reproducible** — uncaught `verb: location cannot start below zero` (must-fix 4). Zero passive-wheel errors anywhere; `probe-gate3` and `probe-gate4` were 0/0 |

The report's own claim of "194 files, 2097 tests" is accurate. Its claim of "zero console/page
errors" is accurate for the paths it drove and false for the `I`-then-`O` path.

## 1. The eight findings

| # | Item | Verdict | Evidence |
|---|---|---|---|
| 1 | Keymap inside-out resolution | **PARTIALLY FIXED — must-fixes 1, 2, 3** | See §2 |
| 2 | Handles reachable + Alt / double-click / Escape | **FIXED** | `.arrangement-lane__resize` 5 px `ns-resize`, `.arrangement-header-resize` 6 px `col-resize` at x=197, h=796. Drag 72→132; Alt-drag → all three lanes 172; double-click → 72; header 200→260 (`probe-gate.json → resizeHandles`) |
| 3 | Loop bracket from ticks incl. scroll/zoom; brace gestures | **FIXED (positioning) — must-fixes 5, 6 (its side effects)** | Bracket x/width match the tick computation exactly at scrollLeft 0, 400, and after a 2× zoom (drift 0 in all three), `pointer-events:none` preserved. Brace body move 3840→4224 = 1 entry; start handle moves both directions, 1 entry each; Alt-drag on the empty row creates a punch, 1 entry (`probe-gate3.json → loopBracket`, `braces`) |
| 4 | Markers | **FIXED for creation — must-fix 3 for rename** | Ctrl+M at the playhead 4→5, one entry, Ctrl+Z → 4. No collision: `matchesKeyCombo` compares ctrl/shift/alt **exactly**, and bare `m` (metronome) is the only other `m` in `src`. Chip empty band and uncovered marks row each create a marker under a real mouse dblclick. `addMarker` parity across `EDIT_OPS`, `TimelineOp`, `arrangementAdapter`, Pi schema. **But the label dblclick now creates a stray marker instead of renaming** |
| 5 | Forks gone | **FIXED** | `grep -rn COPY_DRAG_X_THRESHOLD_PX src` → **one** definition (`pointerGestureLifetime.ts:63`). `dragController.ts` is `DragAxis` + `autoScrollDelta` only. `scrollVelocityEditing` has zero references repo-wide. (`DRAG_THRESHOLD_PX` in `Nodes/InstrumentNode.tsx` is an unrelated canvas constant, not a timeline fork.) The six stray-indent lines in `pi-openjammer-graph/index.ts` are fixed |
| 6 | Snap test asserts hand-computed values | **FIXED** | Four inputs that each pin a *different* law, hand-checked against the 12 px radius: `94/grid100 → 100 (grid)`; `106/grid100/anchor112 → 112 (anchor wins the 6-tick tie)`; `19/grid20 @0.1 px/tick → 17 (grid disabled below 3 px/unit, anchor survives)`; `51/no-grid/anchor48 → 48`. Not satisfiable by an arbitrary function |
| 7 | Playhead subscription stable; no passive-wheel errors | **FIXED** | `Playhead` deps are `[isPlaying, pxPerTick]`. Measured **0** new `useArrangementStore.subscribe` calls per published tick across 12 ticks playing and 12 stopped (`probe-gate3.json → subscribeChurn`). Both `preventDefault`-ing wheel handlers are native `{ passive:false }` (`PianoRoll.tsx:265`, `PianoRollSurfaceHost.tsx:52`). Zero passive-wheel console errors in four runs |
| 8 | Automation add / drag / Escape / range | **FIXED — newly browser-proven** | add `+1` point / 1 entry · point drag 1 entry and moved · Escape 0 entries and byte-restored · Shift-range drag 1 entry and moved (`probe-gate3.json → automation`). This is the family TA2b could not drive at all |

## 2. Finding 1 in detail — every binding reasoned, then driven

`arbiter.ts:55-67` walks `document.activeElement` outward, filtering each surface to the focused
`data-keymap-set-id`, then appends the app surface if absent, then global. For a focused **inline**
roll the path is `[pianoroll:<clipId>, arrangement]` — so any key the roll does not consume reaches
the arrangement. For the **full** roll surface it is `[pianoroll]` only, so nothing leaks there.
Modals remain exclusive (`arbiter.ts:47-49`, untouched), the text-field guard is untouched
(`isEditableTarget` short-circuit at line 26), and the arbiter unit tests pass.

Every piano-roll entry returns `true` unconditionally, so leakage happens only where a **guard**
fails. Exhaustively, from a focused inline roll:

| Key | Guard | Falls through to | Live result |
|---|---|---|---|
| **`s`** | step letter, needs Step armed | **`arrangement.split`** | **clips 3 → 4, 1 entry — it splits the clip you are editing** |
| **`0`** | not a roll key | **`arrangement.muteClips`** | **mutes the clip you are editing, 1 entry** |
| `r` | not a roll key | `arrangement.toggleRipple` | `slide` → `ripple` |
| `e` | step letter, needs Step armed | `arrangement.enter` | surface `arrangement` → `pianoroll` (navigates out mid-edit) |
| `m` / `p` / `f` / `l` / `[` / `]` | not roll keys | metronome / punch / follow / loop / grid | all fire |
| `a w d g y h u j` | step letters | nothing bound | inert |
| **`v b x k` with Step ARMED** | tool keys, need Step disarmed | **`arrangement.tool.*`** | **arrangement tool `select` → `knife`** |
| `t` | covered by `pianoroll.tool.step` when disarmed, by the step letter when armed | — | correctly consumed in both states |
| `Delete` / `Backspace` | consumed unconditionally | — | **safe** — clips 3 → 3 with no notes selected |
| all arrows (bare/Shift/Alt/Ctrl) | consumed unconditionally | — | safe |
| `Space`, `Ctrl+Z/Shift+Z/A/C/X/V/D/Q`, `,`, `.` | consumed | — | safe |
| **`q`**, **`Escape`** | consumed, but call `onClose?.()` which is **undefined** for inline rolls | blocked | **dead: neither closes the roll nor reaches `arrangement.exit` / `arrangement.escape`** |

Evidence: `probe-gate.json → inlineFallthrough` (per-key state diff, 20 keys),
`probe-gate.json → inlineUndoAndStep` (`toolBefore:"select"` → `toolAfter:"knife"`,
`deleteSafe:true`, `stepInserted:3`), `probe-gate3.json → inlineRoll`
(`qClosesRoll:false`, `escapeClosesRoll:false`, `afterQ.surface:"arrangement"`).

`TrackLaneView.tsx:110` passes no `onClose` to the inline `PianoRollLane` — which is also why the
inline roll has no `⌃` close button (`PianoRoll.tsx:614` renders it only when `onClose` exists).

## 3. Regression hunt

| Family | Result | Evidence |
|---|---|---|
| Cross-track ghost, one drop target, all lanes alive, +450 px continuation, one undo | **PASS** | 1 ghost, 1 `is-drop-target`, 3 lanes during; owner 0→1, start 0→1440, **1** entry; Ctrl+Z restores owner and tick exactly (`probe-gate2.json → crossTrack`) |
| Loop toggles mid-play (`L`/`I`/`O`), `isPlaying` held | PASS behaviourally | but `I`→`O` at tick 0 throws — must-fix 4 |
| Double-Stop | **PASS** | `probe-gate.json → wave1.transport.finalStopped` |
| Seek → Space | **PASS** | plays and re-arms `followPlayhead:true` |
| Queued agent edit during a live gesture | **PASS** | `queued:true`, `Bass` during, `Agent` after (`probe-gate3.json → queuedAgentEdit`) |
| Pan typed | **PASS** | 0 → 0.5, 1 entry (`probe-gate.json → wave1`) |
| Ctrl+wheel notch | **PASS** | 0.3125 → 0.397 px/tick |
| Inline roll transpose + undo + redo | **PASS** | 57→58→57→58, 1 entry |
| Step entry with `T` armed | **PASS** | `a w s` inserted exactly 3 notes; but see the `v b x k` leak above |
| Escape cascade | **PARTIAL FAIL** | clears the selection, then dead-ends — must-fix 3 |
| Snap hairline appears | **PASS** | 1 `.arrangement-snap-indicator`, `indicatorTick 3840`, clip snapped exactly `+3840`, indicator `null` on release (`probe-gate4.json → hairline`) |
| Escape aborts a clip drag | **PASS** | tick unchanged, **0** entries, `dragActive:false` |
| Trim preserves the window | **PASS** | start `0→3840`, `sourceStart 0→3840`, end held at 61440, 1 entry |
| Window listener counters | **PASS** | `pointermove/pointerup/pointercancel/blur/keydown` all return to **0** after a full drag (`probe-gate2.json → listenerBalance`) |
| B draw-a-clip · Alt-marquee vs range | **not re-driven** — Paper Sketch's lane 0 has no uncovered span at any zoom my scanner tried. Both were browser-proven in TA2b and the code paths are unchanged this round |
| Copy-drag | not re-driven; my harness used the wrong modifier (**copy is `Alt`**, `useClipGesture.ts:196`; `Ctrl` is snap-invert). TA2b proved T7 |

## 4. Must fix before commit (ranked)

1. **A key pressed inside an inline piano roll destructively edits the arrangement.**
   Browser-proven, new this round. `s` splits the very clip being edited (clips 3→4, one entry);
   `0` mutes it; `r`, `m`, `p`, `f`, `l`, `e`, `[`, `]` all leak too; and with Step armed,
   `v b x k` change the arrangement's tool — defeating exactly the symmetric guard TA2b's
   finding 2 installed. Fall-through is the right architecture; **unfiltered** fall-through is not.
   Fix: give the piano-roll set a terminal "swallow every unmodified printable key" entry when a
   roll owns focus, or mark the destructive arrangement entries (`split`, `muteClips`,
   `toggleRipple`, tools) as not-inheritable by a child surface. Whatever the mechanism, an
   editor must not be able to cut the thing it is editing.

2. **The 64 px ruler shipped without its dependent offsets, and it breaks a shipped e2e test.**
   `gestureHandles.css` raises `.arrangement-ruler-shell` / `-content` from 46 px to 64 px, but the
   seven `top: 46px` rules in `ArrangementSurface.css` are untouched: `.arrangement-field-ground`,
   `.arrangement-grid-anchor`, `.arrangement-playhead`, `.arrangement-loop-wash`,
   `.arrangement-range-selection`, `.arrangement-marquee.is-range` (`top:46px !important`) and
   `.arrangement-record-error`. Measured: ruler 154–218, first lane top **218**, but ground,
   grid anchor and playhead all top **200** — the playhead line and every grid line are **18 px
   too high**, bleeding into the bar-numbers row and stopping 18 px short of the last lane
   (`probe-gate.json → rulerGeometry`, `alignedWithLanes:false`). This is perception, not polish.
   Second consequence: the new 14 px `.arrangement-braces-row` (176–190) occupies exactly where the
   old 46 px ruler's bars row was, and `beginRange` calls `event.stopPropagation()` before its 4 px
   threshold — so **a plain click anywhere in that band does nothing at all**: no seek, no range.
   Measured: click at y=35 → `pendingSeekSample 0`; at y=50 (the real bars row) → `48000`; press-drag
   scrub works and commits. `e2e/arrangement-editing.spec.ts:75` clicks the ruler at `y: 35`, so
   **`S splits at the playhead` fails (8 passed, 1 failed)**. Fix both halves: move the seven offsets
   to a shared token driven by the same constant as `RULER_HEIGHT`, and make a threshold-less click
   on the braces row fall through to the scrub seek.

3. **`Q` and `Escape` are dead inside a focused inline piano roll, and chip rename is gone.**
   (a) `pianoroll.exit` / `pianoroll.escape` call `onClose?.()`, which `TrackLaneView.tsx:110`
   never supplies for inline rolls, yet both `run` return `true` — so they consume the key and
   block `arrangement.exit` / `arrangement.escape`. Measured: two Escapes and a `Q` left
   `expandedPianoRolls` at 1 and the surface at `arrangement`. There is no keyboard way out of an
   inline roll; spec §4's one level grammar is broken on the surface this round exists to repair.
   Return `false` when there is nothing to close, or pass `onClose` from the lane.
   (b) A real double-click on `.arrangement-section-chip__label` now creates a stray marker
   (locations 4→5) instead of opening the rename input (`renameInputs: 0`), even though
   `elementFromPoint` at the label centre returns `SPAN.arrangement-section-chip__label` with
   `pointer-events: auto`. Inline section rename regressed from working (TA2b) to unreachable.

4. **`arrangement.loopOut` emits an invalid verb and throws an uncaught page error.**
   New this round. `startTick: Math.min(loop?.startTick ?? 0, tick - 1)` yields `-1` when the
   playhead is at 0, and `verbs.ts` throws: `Uncaught Error: verb: location cannot start below zero`
   — a page error, twice reproduced (`probe-gate.json → consoleErrors`,
   `probe-gate2.json → loopOutError`). Clamp to `Math.max(0, …)` and let the verb reject quietly.

5. **`addMarker` is invisible to the agent.** It is in `EDIT_OPS`, `TimelineOp`,
   `arrangementAdapter` and the Pi schema, and `piToolParity` passes — but the `edit_timeline`
   description in `src/ai/tools.ts` and `docs/agent-tools.md` names only `createClip`. The agent
   cannot use an op it is never told about. Add it to both strings (one line each).

6. **Make `docs/timeline.md` true.** Four claims are false against the running app:
   "The ruler chrome is 64 px" (true of the ruler, false of every field overlay — must-fix 2);
   "Q exits and Escape closes … then exits on successive presses" (false in an inline roll —
   must-fix 3); "double-click fits the lane's current content" (it resets to 220/72, it measures
   nothing); and the honest fall-through sentence — "unhandled keys in an inline roll therefore
   reach the enclosing arrangement" — does not disclose that this includes `s` (split) and `0`
   (mute). Also record two spec deviations that remain unrecorded: §4.3 assigns `K` to **Velocity**
   while the code binds it to `knife`, and §4.2 assigns `M` to the **mixer** while the code binds
   it to the metronome. Copy-drag's modifier (`Alt`) is documented as a distance but never named.

### Should fix (not blocking)

7. `arrangement.moveTrackUp/Down` and `markerPrevious/Next` still `return true` unconditionally,
   so bare `ArrowUp`/`ArrowDown` `preventDefault()` and kill native arrow scrolling with nothing
   selected. Carried from TA2b #11, unaddressed.
8. Location ticks are not rounded on brace resize — a start handle drag produced `startTick 4235.2`.
9. Once Step is armed the only way out is the toolbar button (carried from TA2b #12); now made
   worse, since the keys that would be the natural escape hatch leak to the arrangement instead.
10. `.arrangement-bars-row` (190–218) overflows `.arrangement-ruler-viewport` (154–216) by 2 px.

## 5. Carried forward to Wave 4 TB

**CSS parcel (one hand-off).** `.arrangement-braces-row` + `.arrangement-loop-brace` /
`-punch-brace` visual treatment · the `.arrangement-loop-bracket` `[`/`]` glyphs (the box is
correct; the two spans need the flex/space-between that only `ArrangementSurface.css` supplies)
· `.arrangement-snap-indicator` hairline · `.arrangement-track__level-bead` ·
`.arrangement-lane__resize` grip · `.arrangement-header-resize` divider ·
`.arrangement-track__rename` input · `.arrangement-clip--draw` ghost ·
`.arrangement-section-chip__label` (currently zero rules) · replace the raw `<input type="color">`
in every track header with the 8-swatch popover (§2.4) · **and, inseparably, the 46 px → 64 px
offsets of must-fix 2** — `field-ground`, `grid-anchor`, `playhead`, `loop-wash`,
`range-selection`, `marquee.is-range` (`!important`), `record-error`. That last item must land
*with* this diff, not after it.

**Settings catalogue.** ~25 binding-set-local ids (`arrangement.tool.*`, `arrangement.grid*`,
`arrangement.marker*`, `arrangement.nudgeBar*`, `arrangement.moveTrack*`,
`arrangement.selectSpatial*`, `arrangement.home/end/loop/loopIn/loopOut/punch/metronome/muteClips/
follow/fitSong/zoomIn/zoomOut/snapToggle/enter/exit/playFromSelection`, `pianoroll.step.*`,
`pianoroll.tool.*`, `pianoroll.undo/redo/escape/exit/transport`) still appear neither in Settings
nor in conflict detection. `docs/timeline.md` discloses this honestly.

**RT automation preview.** Still authored-document re-conduction at a bounded 20 Hz; a direct RT
parameter-preview command needs an executor/audio protocol seam. Legitimately outside this lane.

**Group-edge magnetic anchors.** The dragged selection's own edges are still not candidates.

**DOM pins.** Key-bed / scroomer, velocity paint / Alt-ramp, the inline-roll fall-through matrix
(once must-fix 1 lands, pin that `s` does **not** split from a focused roll), the inline-roll
`Q`/`Escape` exit, and the ruler-row → seek mapping that the e2e test implicitly depended on.

**Also open.** Gate-4 #9 (`previewGesture` re-arms the watchdog) · T24 pixel-lock · T25
virtualization at 100 tracks · T26/T27/`Home`/`End`/stopped-only audible scrub with real audio ·
T28/T29/T31–T33/T37/T38 · T39 through real CDP touch · T40–T44 · sky band.

## 6. UNVERIFIED

- Real audio feel: no-click / no-dropout latency judgment, stopped-only audible ruler scrub, and
  T27 against delivered engine frames. **Headless Chromium delivers no engine frames; this needs a
  human with sound playing.** `codex`-class harnesses cannot sign it off.
- B draw-a-clip and Alt-marquee-vs-range were not re-driven this round (no uncovered lane span in
  Paper Sketch at the zooms tried); both were browser-proven in TA2b against unchanged code.
- Copy-drag (`Alt`) not re-driven; proven in TA2b.
- Track-colour input driven by hand (React's value tracker blocks synthetic events).
- Everything CSS-owned: the visual judgment for the brace row, bracket glyphs, hairline, level
  bead and resize grips.
