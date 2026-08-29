# Wave 3 — TA2d gate review (adversarial)

Date: 2026-08-29. Worktree `t3code-2faff191`, branch `t3code/openjammer-redesign-timeline`.
Read-only: nothing in `src/`, `docs/`, `pi-openjammer-graph/`, `e2e/` was modified; no git
add / commit / stash / checkout. Only `plans/redesign-new-dna/.scratch/w3-ta2d-gate/` was written.

Evidence: `plans/redesign-new-dna/.scratch/w3-ta2d-gate/` — `gate{1..7}.{ts,json}`,
`gate{1..7}-final.png`, `tsc.txt`, `eslint.txt`, `vitest-full.txt`, `e2e.txt`, `dev.log`.
Browser: **one** Chromium at a time, `node --experimental-strip-types`, dev server on **5220**,
stopped at the end (port verified free). Seven browser journeys, **0 console errors, 0 page
errors** in every one.

Concurrent lanes' files (`App.tsx`, `Toolbar/**`, `Shell/**`, `Onboarding/**`, `rigs/**`,
`Nodes/**`, `NodeCanvas.tsx`, `params/**`, `packages/oj-ui/**`) were excluded from judgment.

## Verdict

**COMMIT.**

All eight TA2c findings are closed and browser-proven, including the two destructive ones. The
`inherit` allowlist is real and exhaustive: **54 distinct key combinations driven live from a
focused inline roll** — every one of the 31 non-inherited arrangement combos is byte-for-byte
inert on a 24-field arrangement fingerprint, and the 23 the roll consumes touch note state and
nothing else. The seven inherited entries all work from that same focus, globals still run,
modals stay exclusive, and the text-field guard holds. The ruler is one variable and every
overlay is pixel-aligned with the first lane (delta 0, was −18). The brace row seeks on a plain
click at every y in the band, including the e2e's `y: 35`, and still creates a loop as one entry
with the playhead held. `Q`/`Escape` are a live cascade. Chip label → rename, chip band → mark.
`I`/`O` clamp with no page error. `addMarker` is in the tool description and the doc, verbatim.
`docs/timeline.md` is true on every claim I spot-checked.

Four gates green, e2e 9/9, full regression set green, listener counters flat. **No must-fix.**

The two dead `height: 46px` lines the lane flagged are genuinely dead (one import site, correct
order, browser measures 64) and stay a carried-forward CSS chore, not a blocker.

## Gates

| Gate | Result |
|---|---|
| `bunx tsc --noEmit -p tsconfig.app.json` | **PASS** (exit 0) |
| `bunx eslint src` | **PASS** (exit 0) |
| `bun run test:run` (full, once) | **PASS — 199 files, 2195 tests, 0 failures, 50.9 s.** `Shell/__tests__/retiredChrome.test.ts` passed in **160 ms**; the lane's reported timeout did not reproduce |
| `bunx playwright test e2e/arrangement-editing.spec.ts --project=chromium` | **PASS — 9 passed (23.8 s)**, including `S splits at the playhead and selects both halves` |
| `git diff --check` | **clean** (exit 0; CRLF notices only) |
| New `any` / `as any` / `console.*` / `TODO` / `FIXME` / `debugger` / `@ts-ignore` in scope | **none** (added lines across the whole scoped diff) |
| `gestureHandles.css` structural only | **yes** — the file is 103 lines of geometry, `z-index`, `cursor`, `display:flex`, `justify-content`. No colour, font, shadow, radius, or border |
| Console + page errors, seven browser journeys | **0 / 0** |

## 1. The eight TA2c findings

| # | Item | Verdict | Evidence |
|---|---|---|---|
| 1 | `inherit` allowlist | **FIXED** | §2 |
| 2 | One ruler variable + brace-row click + e2e | **FIXED** | §3 |
| 3 | `Q` / `Escape` close the inline roll | **FIXED** | §4 |
| 4 | Chip label renames, band drops a mark | **FIXED** | §5 |
| 5 | `loopIn` / `loopOut` clamp | **FIXED** | §6 |
| 6 | `addMarker` named to the agent | **FIXED** | §7 |
| 7 | `docs/timeline.md` true | **FIXED** (one small omission, §8) | §8 |
| 8 | S4 Tab positive-target guard | **FIXED** | §9 |

## 2. Finding 1 — the allowlist, enumerated and driven

`arbiter.ts:91` passes `depth > 0` as `inheritedOnly`; `runSets:32` skips every entry without
`inherit`. The arrangement set has **57 effective entries** (30 literal `actionId:` lines plus
the spread groups: delete×2, nudge×4, zoom×2, loopIn/Out, tools×5, grid×2, marker×2, nudgeBar×2,
moveTrack×2, selectSpatial×4). Exactly **seven** carry `inherit: true` —
`arrangement.transport` (:104), `.undo` (:105), `.redo` (:106), `.escape` (:118), `.exit` (:135),
`.playFromSelection` (:136), `.addMarker` (:159). That matches the report and the doc.

**Live proof, 54 combos, one Chromium.** Each row: reset song → open the inline roll → focus it →
snapshot a 24-field fingerprint (clips, tracks, locations, loop, punch location, note count,
muted count, track order, history cursor + entry count, playhead, transportPending,
pendingSeekSample, isPlaying, punchEnabled, clickEnabled, tool, pxPerTick, leftTick, clip /
track / section selection, timeRange, grid, snap, editMode, followPlayhead, surface, open-roll
count, lane height, step target, the edited note's pitch, note-selection size) → press → re-snapshot.

- `gate1.json → inlineFallthrough` — **31 non-inherited combos, `changed: []` on all but one**:
  `s 0 r m p f l e i o [ ] = - Home End Shift+Z Ctrl+0 Ctrl+E Alt+G Enter Alt+← Alt+→ Ctrl+← Ctrl+→
  Ctrl+Shift+Backspace v b x k`. The one exception is `Ctrl+A`, which changed **only** `noteSel`
  1 → 128 — the roll's own select-all; `clipSel` did not move, so `arrangement.selectAll` did not fire.
  TA2c's four destructive leaks are dead: `s` no longer splits (clips 3 → 3), `0` no longer mutes,
  `r` no longer flips ripple, `e` no longer navigates out.
- `gate7.json → rollOwnedKeysTouchOnlyNotes` — the **23 combos the roll consumes**
  (`Delete Backspace Ctrl+D`, all four bare arrows, Shift/Alt/Ctrl arrows, `Ctrl+Alt+↓`,
  `Ctrl+C/X/V`, `, .`, `Ctrl+Q`, `t`, `z`, `Shift+z`) changed only `notes` / `pitch` / `cursor` /
  `entries`. `arrangementLeak: []` on all 23 — with one honest note: `t` set `stepEntry.trackId`,
  which is the roll's own `pianoroll.tool.step`, not a leak.
- `gate1.json → inlineFallthroughStepArmed` — with Step armed on the edited track,
  `v b x k s e` leave the arrangement tool at `select` and clips at 3; only `notes` moved
  204 → 206, which is step entry doing its job.
- `gate1.json → inlineInherited` — from that same focus: transpose 57 → **58** → Ctrl+Z **57** →
  Ctrl+Shift+Z **58**; Ctrl+M locations 4 → **5**, Ctrl+Z → **4**; Space plays then stops;
  Shift+Space plays.
- `gate1.json → fullSurfaceFallthrough` — from the **full** roll surface, all 29 non-roll-owned
  combos pressed in sequence: `changed: []`. Nothing leaks there either.
- `gate1.json → globalsFromRoll` — Ctrl+K opens the palette from a focused inline roll, Escape
  closes it and **only** it (the roll is still open). Modal exclusivity intact.
- `gate1.json → textFieldGuard` — typing `sxk0` into the inline track-rename input changed
  nothing (clips, tool, history all identical) and the characters landed in the field.

## 3. Finding 2 — one ruler variable, brace row, e2e

`gestureHandles.css:13` declares `--arrangement-ruler-height: 64px` with the reason in place;
`:41`/`:46` drive the shell and content. Eight rules in `ArrangementSurface.css` read it
(`record-error`, `field-ground`, `song-end`, `grid-anchor`, `marquee.is-range` with `!important`,
`range-selection`, `playhead`, `loop-wash`). `grep -rn "46px" src/components/Arrangement` returns
only the two dead `height: 46px` lines and the test that forbids the literal in the offsets.

`gate1.json → rulerGeometry`: computed `--arrangement-ruler-height` = **64px**; shell 154–218 h64;
sections 22, braces 14, bars 28; first lane top **218**; ground / grid-anchor / playhead top all
**218** — `groundMinusLane`, `anchorMinusLane`, `playheadMinusLane` all **0** (TA2c: −18).

`gate1.json → rulerRowSeek`: a threshold-less click seeks in every band —
braces `y=28` → `pendingSeekSample` **34286**, `y=35` (the e2e's coordinate) → **34286**,
bars `y=50` → **34286**, and **0 history entries** in all of them. `y=10` in the sections row
hits a section chip, which correctly `stopPropagation`s and selects instead of seeking; no stray
marker (`entries: 0`).

`gate1.json → braceDragCreates`: a drag on the empty brace row creates
`{startTick 800, endTick 1440}` as **1** history entry, with `playheadTick` held at **0** — the
scrub is cancelled and restored when the brace drag passes the 4 px threshold, exactly as
`RulerStack.tsx:91-93` claims.

`gate3.json → loopBracketDrift`: bracket x and width match the tick computation exactly at
DOM `scrollLeft` 0, 400, and after a 2× zoom — **drift 0 / width drift 0** in all three,
`pointer-events: none` preserved.

**e2e 9/9.** The test TA2c broke passes.

## 4. Finding 3 — `Q` and `Escape`

`TrackLaneView.tsx:40` memoizes `closeInlineRoll` with `useCallback([trackId])` and passes it at
`:113`, so the roll's `useMemo` binding set does not churn. `PianoRoll.tsx:575-576` return `false`
when there is nothing to close.

`gate1.json → inlineExit`: `afterQ {rolls: 0, laneH: 72, surface: 'arrangement'}` — the roll closes
and the lane height is restored. `afterEsc1 {rolls: 1, noteSel: 0}` — one level, selection only.
`afterEsc2 {rolls: 0}` — the roll closes on the second press. `afterEsc3` — surface still
`arrangement` (the arrangement's inherited `escape` clears; it does not exit). One level per press,
no dead key.

## 5. Finding 4 — chip rename vs marker creation

The capture-retarget fix (`RulerStack.tsx:113` `onPointerDownCapture` records the true press
target; `:116` and `:121` decide from it; `:151` `data-location-id`) is robust across all the
cases the task asked for:

| Case | Result | Evidence |
|---|---|---|
| dblclick the chip **label** | rename input **1**, marks 0 → **0** | `gate2.json → chipRenameVsMarker.label` |
| dblclick the chip **empty band** | rename **0**, marks 0 → **1** | `gate3.json → chipRecheck.chipBand` (and `gate2 → strip`) |
| dblclick the uncovered **marks strip** | rename **0**, marks 0 → **1** | `gate2.json → chipRenameVsMarker.strip` |
| dblclick the **bars row** | rename **0**, marks 0 → **0** | `gate2.json → chipRenameVsMarker.barsRow` |
| **a drag that starts on a label**, then a dblclick on that label | drag = **1** entry, then rename input **1**, marks 0 → **0** | `gate6.json → renameAfterDrag` |

The drag-then-rename case failed twice in my earlier harnesses (`gate2`, `gate3`, `gate4`) — that
was **my** artifact, not the product's: the chip label is centred in the chip, so after a move the
label's centre sat at x ≈ 2021 in a 1600 px viewport. `gate5.json → renameAfterDragDiag` proves it
(`elementFromPoint` → `null`, zero events reached the viewport). Re-run at 120 px/bar with the
label on screen (`gate6`), rename opens and drops no marker, identical to the no-drag control.

## 6. Finding 5 — `loopIn` / `loopOut` clamps

`loopRangeForEdge` (`src/song/ops.ts:107`) is one pure helper both bindings share.
`gate2.json → loopEdgeClamps`, all with `newErrors: []`:

| Playhead | Key | Loop |
|---|---|---|
| tick 0 | `o` | `{0, 3840}` |
| tick 0 | `i` | `{0, 3840}` |
| tick 1 | `o` | `{0, 3840}` |
| song end (`currentTick()` = 61440, real store tick, not a pending seek) | `o` | `{57600, 61440}` |
| song end | `i` | `{61440, 65280}` |

TA2c's uncaught `verb: location cannot start below zero` is gone; **0 page errors** across the
whole run. Unlike the lane's report, the song-end case is exercised for real here — I set
`playheadTick` directly so `currentTick()` returned 61440 rather than 0. Note that `i` at the song
end pushes `endTick` 3840 ticks past the end; that is legal, throws nothing, and the doc promises
only "at least one grid unit long and never starts below zero", so it is honest, not a defect.

## 7. Finding 6 — agent honesty

`src/ai/tools.ts:217` and `docs/agent-tools.md:117` carry the identical string, naming
`createClip { trackId, startTick, lengthTick, name? }` **and**
`addMarker { atTick, name? }`. `agentToolsDoc` + `piToolParity` + `arrangementTools` all pass in
the full run.

Live: `gate4.json → queuedAgentEdit` drives the real port. Mid clip-drag,
`createArrangementPort().applyOps([{op:'addMarker', atTick:19200}])` returns
`{ok: true, queued: true, appliedAfterGesture: true}`; marks stay **0 during** the gesture and
become **1 after** pointerup. The queued-edit contract and the newly-advertised op are both real.

## 8. Finding 7 — `docs/timeline.md`

Five claims spot-checked against the running app, all **true**:

1. "The ruler chrome is 64 px — sections 22, braces 14, bars 28" → measured 64 / 22 / 14 / 28.
2. "Every ruled field overlay … reads that same variable, so the playhead and the grid start
   exactly where the ruler ends" → all three deltas **0**.
3. "A press on the *empty* brace row does not swallow the click … a click without a drag still
   seeks" → `pendingSeekSample` 34286 at `y=28`.
4. "double-click restores the default height — 220 px while an inline piano roll is open, 72 px
   otherwise — it does not measure content" → `afterDblclick` lane heights `[72, 172, 172]`.
5. "`I` and `O` clamp … at least one grid unit long and never starts below zero" → §6.

The `### Key resolution and the inherit allowlist` section names the seven ids correctly and its
"cannot reach" list matches what I drove. Spec deviations (`M` = metronome vs spec mixer, `K` =
knife vs spec Velocity) and the honest-gaps list (25 unrebindable ids, the CSS still owed, the
2 px bars-row overflow, bare arrows consumed, Step disarm) are all present.

**One omission (should-fix, not blocking):** the report claims "the new S4 Tab rule" is documented.
It is not. Line 15 still describes Tab as an unconditional surface toggle, and line 151 lists
`Tab` among global sets that "always run", without the positive-target qualification that
`arbiter.ts:21` now enforces. One sentence.

## 9. Finding 8 — the Tab positive-target guard

`arbiter.ts:21-26` `isSurfaceTabTarget()` is a positive test (`document.body`, or inside
`[data-surface-root]`), with the `:focus-visible` reasoning written in place; `:53` uses it.

`gate1.json → pillTabOrder` — starting on **Play**, six Tabs walk
`Play → Return to start → Playhead at 1.1 → Tempo 84 BPM → Loop → Metronome`, and
`useUiViewStore.surface` reads `arrangement` at **every** stop inside the pill. The surface only
toggles on the seventh Tab, once focus has already left the pill and landed on `document.body` —
which is correct by the rule.

`gate1.json → tabFromSurfaceRoot` — from the arrangement surface root: `arrangement → canvas →
arrangement`; from `document.body`: toggles. `gate1.json → tabInsideInput` — inside the track
rename input, Tab does **not** toggle (`before === after === 'arrangement'`).

One observation outside this lane: **Record** did not appear in the pill's Tab order in the state
I drove (the walk goes Play → Return to start). `TransportPill.tsx:435` renders it conditionally,
and both that file and `TransportPillHost` belong to the S4 lane. The guard routed to this lane —
that Tab traverses the pill instead of throwing the performer to the other surface — is satisfied.

## 10. Regression set

| Item | Result | Evidence |
|---|---|---|
| Cross-track ghost, 1 drop target, all lanes alive, **+450 px** continuation, one undo | **PASS** | 1 ghost, 1 `is-drop-target`, 3 lanes during; owner 0 → 1, start 0 → 2080, **1** entry; Ctrl+Z restores owner **and** tick exactly (`gate2 → crossTrackDrag`) |
| 7 s still drag stays live | **PASS** | `dragActive` true at 0 s and after 7 s of no movement; resumes, commits **1** entry, clip moved (`gate2 → stillDrag7s`) |
| Loop toggles mid-play both ways | **PASS** | `l l i o` pressed while rolling: `isPlaying` **true** at every step; `i`/`o` set `{0, 3840}` (`gate2 → transport`) |
| Double-Stop | **PASS** | second `stop()` leaves `{playing: false, pending: 'stop'}`, no error |
| Stop → seek → Space | **PASS** | plays and re-arms `followPlayhead: true` |
| Queued agent edit `queued: true` → applied | **PASS** | §7 |
| Pan typed **and** dragged | **PASS** | typed 0 → **0.5**, 1 entry; dragged 0.5 → **0.8**, 1 entry (`gate3 → pan`) |
| Ctrl+wheel notch | **PASS** | 0.3125 → **0.397265** px/tick (`gate2 → mixerPanAndZoom`) |
| Inline transpose + Ctrl+Z (+ redo) | **PASS** | 57 → 58 → 57 → 58 (`gate1 → inlineInherited`) |
| Step entry with `T` armed; `v b x k` inert | **PASS** | 2 notes inserted, both viewport tools stay `select` (`gate1`) |
| Escape cascade | **PASS** | roll: selection → roll → arrangement, one level per press (`gate1 → inlineExit`); automation drag: **0** entries, byte-restored; mid-drag Escape leaves listener counters at 0 |
| `B` draw-a-clip, one undo | **PASS** | tool `draw`, clips 3 → **4**, **1** entry, Ctrl+Z → 3 (`gate4 → drawClip`) |
| Alt-marquee vs range | **PASS** | plain drag → 1 range rect, 0 object marquee, `timeRange {0, 3840, [t1]}`; Alt drag → 0 range, **1** object marquee, `timeRange null` (`gate4 → marqueeVsRange`) |
| Snap hairline | **PASS** | 1 `.arrangement-snap-indicator`, `snapIndicatorTick` **3840**, clip snapped exactly **+3840**, indicator `null` on release, 1 entry (`gate3 → snapHairline`) |
| Handles: drag / Alt / double-click / header divider | **PASS** | `.arrangement-lane__resize` 5 px `ns-resize`, drag 72 → **132**; Alt-drag → all three **172**; double-click → **72**; `.arrangement-header-resize` 6 px `col-resize` at x=197 h=796, 200 → **260** (`gate2 → resizeHandles`) |
| Loop-bracket drift after scroll + zoom | **PASS** | drift **0** at scrollLeft 0 / 400 / 2× zoom (`gate3`) |
| Ctrl+M marker + undo | **PASS** | 4 → 5 → 4 from a focused inline roll (`gate1`) |
| Automation add / drag / Escape / range | **PASS — 1 / 1 / 0 / 1** | add +1 point, **1** entry; point drag **1** entry and moved; Escape **0** entries and byte-restored; Shift-drag creates the range rect, dragging it = **1** entry and moved (`gate4 → automation`, `gate5 → automationRange`) |
| Velocity 60-notch burst = one entry | **PASS** | 60 `altKey` wheel events on the roll root → **exactly 1** history entry labelled `Adjust note velocity`, `vel` 64 → 124, Ctrl+Z restores. Re-run seeded at `vel: 80`, where +60 would exceed 127: the burst is rejected **atomically** — 0 entries, values untouched (`gate6 → velocityBurst`) |
| Window listener counters | **PASS** | after 3 clip drags, a ruler scrub, a brace drag and an Escape-aborted drag: `pointermove / pointerup / pointercancel / blur / keydown` net **0, 0, 0, 0, 0** (`gate3 → listenerBalance`) |
| Console + page errors | **0 / 0** across all seven journeys |

## 11. Diff sweep

- No `any`, `as any`, `console.*`, `TODO`, `FIXME`, `debugger`, `@ts-ignore` on any added line in
  `src/store/{arrangement,editingContext,history,trackLaneView,transport}Store.ts`,
  `src/components/Arrangement/**`, `src/components/PianoRoll/**`, `src/song/**`, `src/keymap/**`,
  `src/ai/{arrangementAdapter,tools}.ts`, `pi-openjammer-graph/index.ts`.
- New untracked files in scope are clean and all used: `gestureHandles.css`,
  `sharedAnimationFrame.ts` (6 prod imports), `timelineSignalLevels.ts` (6 prod imports), plus
  eight new test files.
- No orphaned references: `scrollVelocityEditing` has **0** occurrences repo-wide. The two hits
  each for `SharedSurfaceChrome` / `LatencyWarningBanner` are the Shell lane's *retirement* test
  asserting those files are gone — intentional.
- `git diff --check` exit 0.
- `gestureHandles.css` is structural only (verified by reading all 103 lines).

## 12. Should-fix (not blocking)

1. **Document the S4 Tab rule in `docs/timeline.md`** (§8). The report claims it is there; it is
   not. Line 151's "`Tab` … always run" is now qualified by `isSurfaceTabTarget`.
2. **The two dead `height: 46px` lines** (`ArrangementSurface.css:113,153`). Verified dead —
   single import site, `gestureHandles.css` imported last, equal specificity, browser measures 64,
   and `rulerStack.test.tsx` pins the variable and forbids the literal in the eight offset rules.
   But the shell/content rules themselves are **not** pinned against the literal, so if import
   order ever changes the ruler reverts to 46 while every overlay stays at 64 — TA2c's bug,
   inverted. One-line deletion for the CSS lane; add the assertion while you are there.
3. **Location ticks are still unrounded on a chip/brace drag** — a section drag produced
   `startTick: 4038.4`. Carried from TA2c #8, unchanged and now confirmed on the chip path too.
4. `pianoroll.escape` / `pianoroll.exit`'s `return false` branch is unreachable in the shipped app
   (both inline and full rolls now supply `onClose`). `docs/timeline.md` describes it as a live
   path. Harmless — the guarantee it delivers is real — but the sentence overstates.
5. `arrangement.moveTrackUp/Down` still `return true` unconditionally (carried TA2c #7, documented).
6. No key disarms Step (carried TA2c #9, documented).

## 13. Carried forward to Wave 4 TB

**CSS parcel.** `.arrangement-lane__resize` grip · `.arrangement-header-resize` divider ·
`.arrangement-braces-row` + `.arrangement-loop-brace` / `-punch-brace` and their `[`/`]` glyphs ·
`.arrangement-loop-bracket` glyph layout · `.arrangement-snap-indicator` hairline ·
`.arrangement-track__level-bead` · `.arrangement-track__rename` input ·
`.arrangement-section-chip__label` (and the rename `<input>` that borrows the chip class) ·
`.arrangement-clip--draw` ghost · replace the raw `<input type="color">` in every track header
with the 8-swatch popover (§2.4). **Plus:** delete the two dead `height: 46px` declarations, and
fix the **2 px bars-row overflow** (bars 190–218 vs viewport 154–216 — the shell's 2 px bottom
border is inside its 64 px box; measured again this round, `barsOverflowPx: 2`).

**Unrounded brace / location ticks** on resize and chip drag.

**Settings keybinding catalogue** for the ~25 binding-set-local ids
(`arrangement.tool.*`, `arrangement.grid*`, `arrangement.marker*`, `arrangement.nudgeBar*`,
`arrangement.moveTrack*`, `arrangement.selectSpatial*`,
`arrangement.home/end/loop/loopIn/loopOut/punch/metronome/muteClips/follow/fitSong/zoomIn/zoomOut/snapToggle/enter/exit/playFromSelection`,
`pianoroll.step.*`, `pianoroll.tool.*`, `pianoroll.undo/redo/escape/exit/transport`) — neither
rebindable nor conflict-checked. Now includes the newest actions. Honestly disclosed in the doc.

**RT automation preview** — still authored-document re-conduction at a bounded 20 Hz; a direct RT
parameter-preview command needs an executor/audio-protocol seam. Outside this lane.

**Group-edge magnetic anchors** — the dragged selection's own edges are still not snap candidates.

**Also open.** Bare `↑`/`↓` consumed with nothing selected · no key disarms Step · T24 pixel-lock ·
T25 virtualization at 100 tracks · T26/T27/`Home`/`End`/stopped-only audible scrub with real audio ·
T28/T29/T31–T33/T37/T38 · T39 through real CDP touch · T40–T44 · sky band.

## 14. UNVERIFIED

- **Real audio feel** — no-click / no-dropout latency, stopped-only audible ruler scrub, T27
  against delivered engine frames. Headless Chromium delivers no engine frames; a human with sound
  playing has to sign this off. No harness of any class can.
- Track-colour `<input type="color">` (React's value tracker blocks synthetic events).
- Everything CSS-owned: the visual judgment for the brace row, bracket glyphs, hairline, level
  bead, resize grips and chip label.
- One environmental note for the record: mid-run the dev server served a stale HMR module URL for
  another lane's `InputPanelNode.tsx`, which broke app boot. Restarting the dev server cleared it
  and all subsequent journeys were clean. Not attributable to this diff.
