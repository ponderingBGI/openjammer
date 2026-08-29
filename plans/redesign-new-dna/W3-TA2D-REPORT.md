# Wave 3 — TA2d report (fix round on the TA2c gate review)

Date: 2026-08-29. Worktree `t3code-2faff191`, branch `t3code/openjammer-redesign-timeline`.
Nothing was staged, committed, stashed or checked out.

Artifacts: `plans/redesign-new-dna/.scratch/w3-ta2d/` —
`probe-ta2d.{ts,json}` (the TA2d-specific proof), `regress{1,2,3,4}.{ts,json}` (the four TA2c
gate harnesses re-pointed at 5215, run verbatim so the two rounds diff key-for-key),
`probe-chip.ts`, `ta2d-final.png`, `regress{1,2,3,4}-final.png`, `e2e.txt`, `tsc.txt`,
`eslint.txt`, `gitcheck.txt`, `vitest-full.txt`, `dev.log`.

Browser: **one** Chromium, `node --experimental-strip-types`, dev server on **5215**,
stopped at the end (port verified free). Zero console errors and zero page errors across all
five browser runs.

## Gates

| Gate | Result |
|---|---|
| `bun run test:run -- src/song src/components/Arrangement src/components/PianoRoll src/store src/keymap src/ai` | **PASS** — 66 files |
| `bunx tsc --noEmit -p tsconfig.app.json` | **PASS** (exit 0) |
| `bunx eslint src` | **PASS** (exit 0) |
| `git diff --check` | **clean** (exit 0; CRLF notices only) |
| `bun run test:run` (full, once) | 198/199 files, **2194/2195 tests**. The one failure is `src/components/Shell/__tests__/retiredChrome.test.ts › nothing in the app still names the retired components` — a **foreign lane's file**, a 5000 ms timeout on a repo-wide source scan under full parallel load. It passes in isolation in 236 ms / 275 ms (two runs) and was already at 5018 ms in the pre-fix full run. Not caused by this diff; I did not edit another lane's test |
| `bunx playwright test e2e/arrangement-editing.spec.ts --project=chromium` | **PASS — 9 passed (24.8s)**, including `S splits at the playhead and selects both halves`, the test TA2c broke |
| Console + page errors, five browser journeys | **0 / 0** |

---

## 1. Keymap fall-through is allowlisted, not blanket

**Change.** `BindingEntry` gains an opt-in `inherit?: boolean`
(`src/keymap/types.ts:18`, documented in place). `runSets` takes an `inheritedOnly` flag and
skips every unflagged entry (`src/keymap/arbiter.ts:28,32`); the surface walk passes
`depth > 0`, so only the **innermost** surface runs its whole set and every enclosing surface
contributes just its inheritable entries (`src/keymap/arbiter.ts:91`). Inside-out resolution,
modal exclusivity, the editable-target guard and the drag guard are untouched.

Exactly seven arrangement entries are flagged (`src/components/Arrangement/ArrangementSurface.tsx`):
`arrangement.transport` (:104), `arrangement.undo` (:105), `arrangement.redo` (:106),
`arrangement.escape` (:118), `arrangement.exit` (:135), `arrangement.playFromSelection` (:136),
`arrangement.addMarker` (:159). Global sets (palette, save, export, panels, `Tab`) still always
run. `v b x k` with Step armed need no extra code: the roll's tool entries already guard on
Step, and the arrangement's tool entries are no longer inheritable, so the keys are simply inert.

**Pinning tests.**
- `src/components/Arrangement/__tests__/inlineRollKeymap.test.tsx` — one table of **43** arrangement
  bindings, each pressed from a focused inline roll, each asserting a JSON fingerprint of
  (document, playhead, transportPending, punch, click, tool, pxPerTick, leftTick, clip/track/section
  selection, timeRange, grid, snap, editMode, followPlayhead) is byte-identical, plus history cursor
  unchanged and surface still `arrangement`. Second test: `v b x k` with Step armed leave **both**
  viewport tools at `select`. Third test: undo / redo / Ctrl+M / Space / Shift+Space all still work
  from that same focus.
- `src/keymap/__tests__/arbiter.test.ts` — `TA2d: an enclosing surface lends ONLY its
  inherit-flagged entries to a focused child` (a parent `s` is skipped and `defaultPrevented`
  stays false; a parent `inherit: true` Ctrl+Z runs).
- Updated the pre-existing `falls through the focused child surface…` case to flag its parent
  entry `inherit: true` — the behaviour it pinned is exactly what changed, so it now pins the
  new law by name.

**Why they fail on TA2c's code.** Reverting `depth > 0` to `false` (nothing else) turns **22**
of the 43 rows red, and both new arbiter tests, and both Q/Escape tests — the exact set the
review drove live: `s 0 r m p i o [ ] Enter Alt+←/→ Ctrl+→ Ctrl+Alt+↓ Shift+Z = - Home End Alt+G`
plus the Step-armed tool leak.

**Browser proof** (`regress1.json → inlineFallthrough`, diffed against TA2c's `probe-gate.json`):

| Key | TA2c | TA2d |
|---|---|---|
| `s` | `clips 3 → 4`, `cursor 0 → 1` — it split the clip being edited | **inert** |
| `0` | `muted 0 → 1`, `cursor 0 → 1` | **inert** |
| `r` | `ripple slide → ripple` | **inert** |
| `e` | `surface arrangement → pianoroll` | **inert** |
| `v b x k` (Step armed) | `toolAfter: knife`, `toolKeysContained: false` | `toolAfter: select`, **`toolKeysContained: true`** |

`probe-ta2d.json → inlineFallthrough` presses the fuller 38-combo set live: every arrangement
letter, `Enter`, and every modified arrow that belongs to the arrangement is `inert`; the arrows,
`Delete`/`Backspace` and `Ctrl+D` change only note state, which is the roll doing its own job.
`inlineInherited` shows `57 → 58 → 57 → 58`, marker `0 → 1` on Ctrl+M, and Space playing then
stopping — from the focused roll. `inlineStepArmedTools`: tools stay `select`, and `a w s` still
insert exactly 3 notes.

**Doc.** `docs/timeline.md` gains a `### Key resolution and the inherit allowlist` section: the
full ordered ladder, the seven flagged ids by name, and the explicit list of what can no longer
reach the arrangement from a roll.

## 2. Ruler height is one variable; the brace row never swallows a click

**Change.** `gestureHandles.css:13` declares `--arrangement-ruler-height: 64px` with the reason
in place; `:41` and `:46` drive `.arrangement-ruler-shell` / `-content` from it. Eight offset
rules in `ArrangementSurface.css` now read it — `.arrangement-record-error` (:86),
`.arrangement-field-ground` (:172), `.arrangement-song-end` (:173), `.arrangement-grid-anchor`
(:174), `.arrangement-marquee.is-range` (:343, `!important` kept), `.arrangement-range-selection`
(:344), `.arrangement-playhead` (:354), `.arrangement-loop-wash` (:355). The review listed seven;
`.arrangement-song-end` had the same literal and is included.

`RulerStack.tsx:80` — `beginRange` only calls `stopPropagation()` for `move` / `start` / `end`.
A press on the **empty** brace row keeps bubbling to the ruler scrub, so a threshold-less click
seeks exactly like the bars row. When the drag crosses the 4 px threshold it takes the pointer and
calls `cancelScrub.current?.()` (`:91-93`), which restores the playhead and tears the scrub down;
`abort()` does the same (`:103`), so Escape before the threshold also restores. The scrub's
canceller is installed at `:140` and cleared in `finish` at `:131`. `POINTER_DRAG_THRESHOLD_PX` is
now imported rather than re-spelled (`:6`).

**Pinning tests.** `src/components/Arrangement/__tests__/rulerStack.test.tsx`:
- reads the shipped CSS, asserts the variable is declared at 64px, that the shell/content read
  it, that the three rows still sum to 64 (22 + 14 + 28), that **each** of the eight rules
  contains `top: var(--arrangement-ruler-height)` and **no** `46px`, and that `RULER_HEIGHT` in
  `ArrangementSurface.tsx` equals the CSS number (the JS/CSS twin that drifted);
- a press on the empty brace row sets `transportPending: 'seek'` with zero history entries;
- a drag on the empty brace row still creates a loop as **one** entry and leaves the playhead
  where it was;
- a press **on** an existing brace does not seek.

Reverting `mode !== 'create'` to an unconditional `stopPropagation()` fails the seek test;
restoring one literal `top: 46px` fails the offsets test.

**Browser proof.** `regress1.json → rulerGeometry`, diffed against TA2c:
`alignedWithLanes false → **true**`; ground / grid-anchor / playhead top `200 → **218**`, i.e.
`groundTopMinusLaneTop`, `anchorTopMinusLaneTop`, `playheadTopMinusLaneTop` all `-18 → **0**`.
`probe-ta2d.json → rulerGeometry` confirms the computed `--arrangement-ruler-height` is `64px`,
shell 64, rows 154/176/190, first lane 218, all three overlays 218.
`regress3.json → rulerSeek`: `atBraces28` `pendingSeekSample 0 → **48000**`, `atOldBars35`
`0 → **48000**` (that is the e2e's `y: 35`), `atBars50` unchanged at 48000.
`probe-ta2d.json → rulerRowClicks` drives all four bands; `braceGestures` shows a brace drag
creating `{960, 1792}` as **1** entry with `playheadHeld: true`.
`regress3.json → braces` is byte-identical to TA2c: move `3840 → 4224` = 1 entry, both start-handle
directions 1 entry each, Alt-punch 1 entry.
**e2e: 9/9.**

## 3. `Q` and `Escape` in an inline roll

**Change.** `TrackLaneView.tsx:113` passes `onClose={closeInlineRoll}`, memoized at `:42` with
`useCallback` — a fresh closure would re-register the piano roll's whole binding set on every
render, which is exactly the churn the gate measures. `closePianoRoll` restores the previous lane
height (TL-18). `PianoRoll.tsx:575-576`: `pianoroll.escape` clears the selection and returns true;
otherwise, with no handler, it returns **false**; `pianoroll.exit` returns **false** when there is
nothing to close — so the arrangement's inheritable `escape` / `exit` still runs and no key is
dead. `PianoRoll.tsx:618` keeps the roll's own `⌃` for the full surface only; the inline lane menu
already ships one with the same label, and two identical controls 20 px apart is not an affordance.

**Pinning tests.** `inlineRollKeymap.test.tsx` — `Q` closes the inline roll and restores lane
height to 72 with the surface still `arrangement`; `Escape` clears the note selection first and
keeps the roll, then closes it on the second press; the lane's close button works. Reverting
`return false` to `onClose?.(); return true` and removing the lane's `onClose` fails both.
Full-surface: `PianoRollSurfaceHost.tsx:67` already supplies `onClose`, and the same entries are
driven by the existing `PianoRoll.test.tsx` set (all green).

**Browser proof.** `regress3.json → inlineRoll`, diffed against TA2c:
`qClosesRoll false → **true**`, `escapeClosesRoll false → **true**`, `afterQ.expanded 1 → **0**`,
`esc1.notes 0 → **1**` (one level per press). `probe-ta2d.json → inlineExit`:
`afterQ {rolls: 0, laneH: 72, surface: 'arrangement'}`, `afterEsc1 {rolls: 1, noteIds: 0}`,
`afterEsc2 {rolls: 0}`.

## 4. Section-chip rename vs marker creation

**Root cause (new finding).** Pointer capture retargets the synthesized `click`/`dblclick` to the
capturing element. The chip captures the pointer in its own `pointerdown`, so a double-click on
the label arrived on the **chip**, `closest('.arrangement-section-chip__label')` was null, and the
chip dropped a stray marker. The old handler could not have worked; it was reading a target the
browser had already rewritten.

**Change.** One decision point on the ruler viewport (`RulerStack.tsx:113-121`):
`onPointerDownCapture` records the true press target (capture phase, so children's
`stopPropagation` cannot hide it); `onDoubleClick` reads that target — inside a chip label →
rename that section (found via the new `data-location-id` on the chip, `:151`); else inside the
sections row (chip empty band or uncovered strip) → drop a mark; else nothing. The chip's own
`onDoubleClick` and the sections row's `onDoubleClick` are gone.

**Pinning tests.** `rulerStack.test.tsx → section chip: rename vs marker` — four cases (label,
chip empty band, uncovered marks strip, bars row), each simulating the real retarget: press the
element, then deliver the `dblclick` to the capturing element. Reverting `pressTarget.current` to
`event.target` fails the label and strip cases.

**Browser proof.** `regress3.json → chipRename`, diffed against TA2c: `renameInputs 0 → **1**`,
locations `4 → 5` becomes `4 → **4**`, `renameReachable false → **true**`,
`noStrayMarker false → **true**`. `regress4.json → chipHitTest`: same flip.
`probe-ta2d.json → chipRenameVsMarker`: label → rename opens, 0 marks; chip empty band →
`0 → 1` mark, no rename; uncovered strip → `0 → 1` mark.

## 5. `arrangement.loopIn` / `loopOut` clamp

**Change.** New pure helper `loopRangeForEdge(current, tick, edge, gridUnitTicks)` in
`src/song/ops.ts:107` — clamps the tick to ≥ 0, forces a range of at least one grid unit, and
pulls the far edge in rather than inverting. Both bindings now share one code path
(`ArrangementSurface.tsx:145-156`), using the live grid unit (falling back to one bar).

**Pinning tests.** `src/song/__tests__/loopEdges.test.ts` — six cases including tick 0 both edges,
song end both edges, a zero / negative / NaN grid unit and a negative tick, and a round-trip
through the real `applyVerb` asserting it never throws. `ArrangementSurface.test.tsx` adds a DOM
case pressing `o` then `i` with the playhead at 0 and asserting no throw plus a legal range.
TA2c's expression `Math.min(loop?.startTick ?? 0, tick - 1)` is `-1` at tick 0, which is precisely
what `verbs.ts` rejects.

**Browser proof.** `regress2.json → loopOutError`, diffed against TA2c:
loop `{startTick: 0, endTick: 1}` + **2 page errors** → `{startTick: 0, endTick: 3840}` and
**`newErrors: []`**. Whole-run `consoleErrorCount 2 → **0**` in both `regress1` and `regress2`.
`probe-ta2d.json → loopEdges`: `atZeroOut {0, 3840}`, `atZeroIn {0, 3840}`, `newErrors: []`.
**Honest limit:** the *song-end* case did not really exercise in the browser — `seek()` only sets
`pendingSeekSample` and `currentTick()` still returned 0 with no engine attached, so `atEnd` also
reads `{0, 3840}`. The song-end path is covered by the unit test, not by that browser row.

## 6. Agent honesty

`src/ai/tools.ts:217` and `docs/agent-tools.md:117` now both read
"… `createClip { … }` (the same atomic empty-lane Draw gesture), **`addMarker { atTick, name? }`
(the same marker Ctrl+M and a ruler double-click drop)**, moveClips, …" — identical strings, so the
verbatim doc-drift test still holds. New case in `src/ai/__tests__/agentToolsDoc.test.ts`: for
`createClip` and `addMarker`, each must be in `EDIT_OPS`, in the `edit_timeline` description, and
in the doc. `bun run test:run -- src/ai` → 95 passed, `piToolParity` included.

## 7. `docs/timeline.md`

- "The ruler chrome is 64 px" → now states the single `--arrangement-ruler-height` token, names
  every overlay that reads it, and names `RULER_HEIGHT` as its JS twin.
- "Q exits and Escape closes … then exits on successive presses" → replaced with what the app does:
  Q closes the roll (restoring the lane height), Escape clears then closes, and both return `false`
  when there is nothing left to close so the arrangement's inherited entry runs.
- "double-click fits the lane's current content" → "restores the default height — 220 px while an
  inline piano roll is open, 72 px otherwise — it does not measure content".
- The fall-through sentence → the new `### Key resolution and the inherit allowlist` section, which
  names the seven inheritable ids and lists what can no longer reach the arrangement.
- Recorded deviations: spec §4.2 `M` = mixer vs the code's metronome; spec §4.3 `K` = Velocity vs
  the code's knife; copy-drag's modifier named as **Alt** (Ctrl inverts snap).
- Also documented: the brace-row click fall-through, the chip label-vs-band rule and *why*
  (pointer-capture retarget), the `I`/`O` clamp, and the new S4 Tab rule.
- Honest gaps now also list: the ~25 unrebindable binding-set-local ids; the CSS still owed (brace
  row and glyphs, section-chip label, resize grips, track-colour popover, snap hairline, level
  bead, inline rename) **and** the 2 px bars-row overflow; bare `↑`/`↓` consumed by the clip
  track-move binding; and that Step is only disarmed from the toolbar.

## 8. S4 add-on — the transport pill can be walked with `Tab`

**Change.** `src/keymap/arbiter.ts:21` adds `isSurfaceTabTarget()`: a positive target test —
`document.body`, or anything inside a `[data-surface-root]`, is a surface Tab; a focus-trapped
dialog is not; everything else (the floating pill, the topbar, panels) is native traversal.
`:53` replaces the old dialog-only early return with `!isSurfaceTabTarget(event.target)`.
`:focus-visible` is explicitly not used, and the reason is written in the doc comment.
`TransportPillHost` is mounted in `App.tsx:608`, outside every `[data-surface-root]`, so it
qualifies as chrome by construction.

**Pinning test.** `arbiter.test.ts → S4: bare Tab only toggles surfaces from the song surfaces
themselves` — from a pill button, bare Tab and Shift+Tab both return false with
`defaultPrevented === false` and the global toggle never runs; from inside a surface root and from
`document.body` it toggles. Restoring the old `isFocusableInOpenDialog` line fails it.

**Browser proof.** `probe-ta2d.json → pillTabOrder`: starting on **Play**, six Tabs walk
`Return to start → Playhead at 1.1 → Tempo 84 BPM → Loop → Metronome →` out of the pill, and
`useUiViewStore.surface` reads `arrangement` at every step (`surfaceStableInPill: true`). From the
arrangement surface root, one Tab still gives `arrangement → canvas` (`toggledFromRoot: true`).

## 9. Regression set

The four TA2c gate harnesses were re-run verbatim (only URL and output paths changed) and the
JSON diffed key-for-key against `w3-ta2c-gate/`. **Every key is byte-identical except the ones this
round was meant to change:**

| Harness | Keys that changed | Keys byte-identical |
|---|---|---|
| `regress1` | `rulerGeometry` (aligned), `inlineFallthrough` (`s`/`0`/`r`/`e` now inert), `inlineUndoAndStep` (`toolKeysContained` true), `markers.ctrlM` (`click` false), `consoleErrors` 2 → 0 | `boot`, `loopBracket` (drift 0 at scroll 0 / 400 / after 2× zoom), `braces`, `resizeHandles` (5 px / 6 px, 72→132, Alt-all 172, dblclick 72, header 200→260), `automation`, `subscriptions`, `wave1` (loop toggles mid-play, double-Stop `finalStopped`, seek→Space `follow: true`, Ctrl+wheel 0.3125 → 0.3973), `misc` |
| `regress2` | `loopOutError`, `misc.escapeCascade` (`expanded` 1 → 0), `consoleErrors` 2 → 0 | `crossTrack` (1 ghost, 1 drop target, 3 lanes, owner 0→1, tick 0→1440, **1** entry, undo exact), `listenerBalance` (pointermove/up/cancel/blur/keydown all back to **0**), `rulerSeek`, `inlineTranspose`, `chipDoubleClick`, `braceDrag`, `automation2`, `queuedAgentEdit`, `subscribeChurn` |
| `regress3` | `rulerSeek`, `inlineRoll`, `chipRename` | `braces`, `automation` (add / drag / Escape-restored / range = 1, 1, 0, 1), `queuedAgentEdit` (`queued: true`, `Bass` during, `Agent` after), `fieldGestures`, `subscribeChurn` (**0** new subscriptions across 12 published ticks playing *and* 12 stopped) |
| `regress4` | `chipHitTest` | `hairline` (1 indicator, tick 3840, clip snapped exactly +3840, indicator null on release, 1 entry), `trimSlipCopy` |

Console/page errors: **0** in all four harnesses and in `probe-ta2d`.

Several harness rows carry `pass: false` in *both* rounds (`regress2`'s `chipDoubleClick`,
`braceDrag`, `automation2`, `inlineTranspose`, `drawClip`, `selection`, `hairlineAndEscape`, the
`rulerSeek` / `queuedAgentEdit` harness errors, and `regress1`'s `wave1.crossTrackDrag`,
`automation`, `braces`). Those are stale expectations and setup artifacts inside the TA2c
harnesses, byte-identical across the two runs; each of those families is genuinely proven by the
`regress3` / `regress4` version of the same probe, which passes.

## What is NOT done / carried forward

1. **`.arrangement-ruler-shell` and `.arrangement-ruler-content` in `ArrangementSurface.css`
   (lines 113 and 153) still say `height: 46px`.** They are dead — `gestureHandles.css` imports
   last and wins, and the browser measures 64 — but they are a live trap if import order ever
   changes. My mandate limited `ArrangementSurface.css` to the offset rules, so I left them.
   **One-line hand-off for the CSS lane: delete both declarations.**
2. **Should-fix #10 (2 px overflow)** — `.arrangement-bars-row` (190–218) still overflows
   `.arrangement-ruler-viewport` (154–216), because the shell's 2 px bottom border is inside its
   64 px box. Fixing it means editing the shell's border or its height, both outside my offsets
   mandate. Now recorded in `docs/timeline.md`'s honest gaps.
3. **Should-fix #7** — `arrangement.moveTrackUp/Down` still `return true` unconditionally, so bare
   `↑`/`↓` `preventDefault()` with nothing selected. Unchanged, now documented. (It cannot leak
   from a roll any more: the roll consumes both arrows.)
4. **Should-fix #8** — brace-resize ticks are still unrounded (`startTick: 4235.2` in
   `regress3.json → braces`). Unchanged from TA2c.
5. **Should-fix #9** — no key disarms Step; only the toolbar button. Now documented.
6. The **song-end** row of the browser `loopEdges` probe is not real evidence (see §5); the unit
   test is.
7. `retiredChrome.test.ts` (Shell lane) is a 5 s timeout flake under the full parallel run.
8. **UNVERIFIED, and not verifiable here:** real audio feel — no-click / no-dropout latency,
   stopped-only audible ruler scrub, T27 against delivered engine frames. Headless Chromium
   delivers no engine frames; a human with sound playing has to sign that off.
