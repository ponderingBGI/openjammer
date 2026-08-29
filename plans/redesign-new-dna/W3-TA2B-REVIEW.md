# Wave 3 — TA2b gate review (adversarial)

Date: 2026-08-29. Worktree `t3code-2faff191`, branch `t3code/openjammer-redesign-timeline`.
Read-only: no file in `src/`, `docs/`, `pi-openjammer-graph/` and no git state was modified.
Evidence: `plans/redesign-new-dna/.scratch/w3-ta2b-gate/` — `probe-g1/g2/g3/pr/w1/misc.{ts,json,log}`,
`tsc.txt`, `eslint.txt`, `vitest.txt`, `g1-final.png`, `g2-draw-ghost.png`, `g2-snap-drag.png`,
`g2-final.png`, `pr-final.png`, `w1-final.png`, `misc-final.png`.
Browser: one Chromium at a time, `node --experimental-strip-types`, dev server on **5204** (stopped
after the run), React **StrictMode** on. CSS / tokens / `packages/**` / `src/components/Canvas/**` /
`src/components/Nodes/**` / `src/engine/registry.ts` / `src/utils/portPositions.ts` are lanes S3/P1 and
were excluded.

## Verdict

**DO NOT COMMIT.**

The fix round is real work, not paperwork. All four TA2 blockers are genuinely closed and pinned, the
gesture families are clean under the browser (every family commits exactly one history entry, aborts
byte-exactly on Escape, and the window-listener counters return to **zero**), and the snap fork is
collapsed to one function with five call sites. Twenty-eight of the thirty T-numbers I could automate
pass.

But the lane again shipped **one new browser-proven regression** — fixing the inline piano roll's
keyboard by resolving the keymap surface from DOM focus made **Ctrl+Z dead inside a focused inline
piano roll**, on the surface this very round was built to repair — and `docs/timeline.md` states three
things as shipped that are false against the running app (lane-divider resize, header-width resize,
double-click marker creation), while a fourth (the ruler loop bracket) silently regressed from a
correctly-positioned indicator to two stray glyphs. By the previous gate's own standard, regressions
and false docs do not get the incompleteness carve-out.

Five must-fixes; four are a doc edit or a decision, and the first is roughly five lines. This becomes
committable in well under a day.

## Gates

| Gate | Result |
|---|---|
| `bunx tsc --noEmit -p tsconfig.app.json` | **PASS** (exit 0) |
| `bunx eslint src packages e2e` | **PASS** (exit 0, no warnings) |
| `bun run test:run` (full, once) | **PASS** — 181 files, 1923 tests |
| `git diff --check` | clean (exit 0; CRLF notices only) |
| New `any` / `console.*` / `TODO` / `debugger` in scope | none |
| Console + page errors in the browser journeys | **2** — both `Unable to preventDefault inside passive event listener invocation` from the piano-roll `onWheel` (see #10). `probe-g1`, `probe-pr`, `probe-w1`, `probe-misc` were all **0** |

The report's ESLint note is accurate: `bunx eslint … pi-openjammer-graph` fails as a repo-configuration
error (the directory is globally ignored), not a lint failure. `src packages e2e` is clean and the
`pi-openjammer-graph` change is covered by `tsc` plus `piToolParity.test.ts`.

## 1. The four TA2 blockers, plus stubs / D2 / fork / parity

| # | Item | Verdict | Evidence |
|---|---|---|---|
| 1 | Inline-roll keyboard | **FIXED — but see must-fix 1** | The `mode !== 'surface'` gate is gone; `PianoRoll.tsx:557-558` marks the root `data-keymap-surface="pianoroll"` / `data-keymap-set-id="pianoroll:<clipId>"` and `arbiter.ts:51-55` resolves the surface (and the specific set) from `document.activeElement`. Browser: focused inline roll, ArrowUp → `[57,60,64]` → `[58,61,65]`, one entry (`probe-g2.json → inlineRoll`) |
| 2 | Step entry + `V B X K` vs step letters | **FIXED** | Only `t` actually collides (`v b x k` are not step letters). Resolved symmetrically: step letters/Space/Backspace/`Z` guard on `stepEntry.trackId === trackId`, tool keys and `pianoroll.transport` on `!==`. Browser: with T armed, `v b x k` left the tool at `select`, `a w s` inserted exactly 3 notes, Space advanced the cursor (`probe-g2.json → stepPriority`) |
| 3 | Drag disarms follow; release does not restore | **FIXED** | `followPlayheadBefore` and its restore are deleted (`useClipGesture.ts`); `onPointerDown` sets `followPlayhead:false`. Browser: after-down `false`, during `false`, after-release `false`, clip actually moved (`probe-g2.json → T23`). Re-arm is explicit on play-from-stopped / `Shift+Space` / `F` — confirmed `followAfterPlay:true` in `probe-misc.json → loopAndTransport` |
| 4 | Escape cascade | **FIXED** | `pianoroll.escape` clears selection then calls `onClose`; `PianoRollSurfaceHost` blurs an editable target first via `onKeyDownCapture`. Browser: 1st Escape → still `pianoroll`, 0 notes selected; 2nd → `arrangement` (`probe-g2.json → escapeCascade`) |
| 5 | Snap hairline real + reactive | **FIXED (TypeScript half)** | `snapIndicatorTick` is a reactive selector (`ArrangementSurface.tsx:53`) and the element renders. Browser: during the drag `indicatorTick = 3840`, `.arrangement-snap-indicator` count `1`; `null` on release (`probe-g1.json → T4`, `g2-snap-drag.png`). The element is in-flow and invisible until the CSS lane styles it — measured **no layout shift** (`probe-g2.json → snapIndicatorLayout.shifted:false`), so it is inert, not harmful |
| 6 | D2 Alt-marquee vs range | **FIXED** | The vertical-half switch is gone (`event.altKey ? 'object' : 'range'`). Browser: plain drag → `timeRange {71040,84480}`, 0 clips; Alt-drag → `timeRange null`, 3 clips (`probe-g2.json → T12/T13`). Escape mid-marquee aborts and `selectionHistoryBySurface.arrangement.depth` returns to 0 — the leaked selection-op depth is closed and `abortSelectionOp` now has a real caller |
| 7 | `B` draw-a-clip, one undo | **FIXED** | tool → `draw`, one `[data-draw-ghost]`, clips 3→4 and sources 3→4, **1** history entry, one Ctrl+Z restores both counts (`probe-g2.json → T14`, `g2-draw-ghost.png`) |
| 8 | One snap implementation | **FIXED in source; its pinning test is vacuous** | `snapTick` and `snapTimelineTick` are deleted. Repo-wide grep: `snapTimeline` is the only implementation, with exactly five call sites — `useClipGesture.ts:101`, `RulerStack.tsx:53`, `AutomationLaneView.tsx:32`, `ArrangementSurface.tsx:270`, `PianoRoll.tsx:177`. **But** the test the report cites as proof (`editingContextStore.test.ts`, "routes clip, note, and ruler snapping through the same implementation") calls `snapTimeline` three times with *identical arguments* and asserts the three results equal each other — it would pass against any function and pins nothing. The three former call sites are proven identical by the source, not by that test. BC-06 was correctly **amended** per D1 rather than worked around |
| 9 | Pi parity | **FIXED** | `createClip` added to the Pi op union, `EDIT_OPS`, `arrangementAdapter`, `ai/tools.ts` and `docs/agent-tools.md`; `setTrackColor` / `moveTrack` / `setLocationName` added to the agent verb list. Full suite green |

### Punch-list "Done" claims

| Claim | Verdict |
|---|---|
| Keyboard spatial selection `Ctrl+Alt+arrows` (+Shift) | Present and pinned. No modifier collision: `matchesKeyCombo` requires **exact** modifier equality, so bare `ArrowUp` (moveTrack) and `Ctrl+Alt+ArrowUp` (spatial) cannot shadow each other |
| `Ctrl+←/→` markers, `[` / `]`, `↑`/`↓` across tracks, `Alt` bar nudge | Present, pinned by `ArrangementSurface.test.tsx` "pins the remaining arrangement navigation and spatial-selection keys" |
| Colour caller | Real (`<input type="color">` → `setTrackColor`), pinned in vitest (1 entry, colour applied). Browser-**unverified**: driving a native colour input past React's value-tracker is not possible from a synthetic event — probe artefact, not a defect |
| Key-bed / scroomer + velocity paint / Alt-ramp on the controller | **Verified live**: key-bed press pans the range and auditions, scroomer pans, lollipop drag = 1 entry, empty-lane velocity paint = 1 entry (`probe-pr.json`). The report listed these as UNVERIFIED — they now are verified, but still have no DOM pin |
| Meters + level beads on the shared rAF | Yes — `timelineSignalLevels.ts` holds one executor subscription and one frame writer, consumed by `MixerDrawer` and `TrackLaneView` |
| Bounded gesture unwinding | Yes (`arrangementStore.ts`, `for` loop bounded by `framesToClose`) |
| 400 ms edge auto-scroll stop | **Verified live**: parked at the right edge, `scrollLeft` froze at 44 and did not move for 3.5 s (`probe-w1.json → wave1Drag.autoScrollStopped`) |
| `setPointerCapture` guards | Yes, every timeline call site is `try/catch`ed |
| Arbiter "unbound local default" | **Verified live and safe.** With `arrangement.tool.draw` set to `UNBOUND_KEY`, `b` is inert; clearing the custom binding restores `draw` (`probe-g2.json → arbiterUnbind`). It **breaks no existing default binding**: for catalogue actions `getBinding()` still falls back to `keybindingActions[].defaultBinding`, so the new branch is only reached for binding-set-local ids. Arbiter tests + full suite green |

## 2. Regression hunt

Every gesture family below was driven end-to-end in the browser under StrictMode.

| Family | One entry | Escape / cancel / blur | Leak |
|---|---|---|---|
| Clip move / copy / trim / slip | ✔ (T1, T7, T8, T9) | ✔ byte-identical (T3) | — |
| Empty-lane range + Alt marquee | ✔ selection-stack only | ✔ + selection-op depth returns to 0 | — |
| Ruler scrub | transport, not history ✔ | ✔ Escape restores the pre-scrub tick (`probe-misc.json → rulerScrubAbort`) | — |
| Brace drag | controller exists; row is 0 px | — | **does not swallow the bars row** — `elementFromPoint` at the bars row returns `DIV.oj-time-ruler`; the sections/bars rows are `position:absolute` and paint above the static brace row. See must-fix 3 for what it *does* do |
| Marker create / rename / drag / delete | rename ✔, drag ✔ (1 entry), select ✔, Delete → `removeLocation` ✔ | ✔ | **create is unreachable** — must-fix 4 |
| Automation point / range | **browser-UNVERIFIED** (see below) | — | — |
| Mixer fader / pan | ✔ 1 entry per drag | ✔ Escape aborts, value restored exactly (`probe-g3.json → mixerFader`) | — |
| Note move / resize / draw / erase / marquee / velocity / paint | ✔ all exactly 1 entry | ✔ Escape restores byte-exactly | — |
| Track reorder (`moveTrack`) | ✔ 1 entry, order changed | ✔ | — |
| Lane / header resize | store logic ✔ | ✔ | **handles unreachable** — must-fix 2 |

**Window-listener balance: clean.** After the full G2 journey and again after unmounting the
arrangement mid-drag, `pointermove`, `pointerup`, `pointercancel`, `blur` and `keydown` are all back to
**0** (`probe-g2.json → listeners` / `listenersAfterUnmount`). The previous gate's +1 window `pointerup`
is gone. Unmounting the surface during a live drag leaves `dragActive:false`.

**Wave-1 regression set — all green.** Cross-track ghost mounts, the source lane stays mounted
(3 lanes before and during), exactly **one** `is-drop-target` (the hovered lane, not the source —
gate-4 #15 closed), a +450 px drag survives, a 3.5 s still pointer at the edge stops auto-scroll,
selection history survives, a queued agent edit during a live gesture returns `status:"queued"`, does
not land mid-gesture (`nameDuring:"Bass"`) and applies atomically after (`nameAfter:"Agent"`),
`L`/`I`/`O`/`P` loop-punch policies work, seek → `Space` plays and re-arms follow, and editing while
playing keeps `isPlaying` true across the whole gesture (T30) with no page errors.

**Automation lane is the one family I could not drive.** Three attempts hung, then the boot itself
started timing out with a dev-server `404` — the concurrent S3/P1 lane was mid-rename in
`packages/oj-ui/**` and the app would not boot. I retried once per the harness rule. Code review is
clean: `AutomationLaneView` moved point-drag, range-drag and field-selection onto `ownPointerGesture`
with explicit `abort` paths and guarded capture, and the unit suite is green — but it is **not**
browser-proven and Wave 4 should re-run it.

## 3. Whole-diff sweep

- `git diff --check` clean; no new `any`, `console.*`, `TODO` or `debugger` in scope.
- **Dead / forked code introduced.** `dragController.ts` is now a parallel version of the threshold
  rule: `crossedDragThreshold`, `dominantAxis`, `DRAG_THRESHOLD_PX` and `COPY_DRAG_X_THRESHOLD_PX` have
  **zero production callers** (the shipped rule is `pointerGestureLifetime.thresholdAxis` /
  `gestureThreshold`), and `COPY_DRAG_X_THRESHOLD_PX` is now declared in *both* files with the same
  value. `editingContracts.test.ts` (BC-12) still pins the dead one. This is the same fork the previous
  gate ordered collapsed for snap, recreated for thresholds. Values #1, #2, #8.
- **`scrollVelocityEditing` is now dead store state** — declared and defaulted in
  `editingContextStore.ts`, its only remaining reference is a test that sets it. Value #8.
- `.arrangement-loop-bracket` CSS is now dead (its JSX was deleted).
- `pi-openjammer-graph/index.ts` gained inconsistent indentation (one extra leading space on six lines
  around the new `createClip` object).
- Removed behaviour, checked: `onLostPointerCapture={() => undefined}` no-ops removed (correct — capture
  loss is non-terminal), `RulerStack`'s `onSeek` prop replaced by internal ownership (correct), the
  ruler's `aria-hidden="true"` removed (an a11y fix). `PianoRollSurfaceHost` now measures with a
  `ResizeObserver` instead of `window.innerWidth/Height`.
- **`docs/timeline.md` is much better than TA2's, and mostly true**: the ruler *is* 46 px, follow
  defaults on with the 15 %/⅙ page rule as described, the snap radii and Ctrl-inversion match, the
  Escape cascade matches, the wheel model matches. Three claims are false against the running app —
  must-fixes 2, 3, 4 — plus one imprecision: "Ctrl toggles" for empty-lane selection applies only to the
  Alt marquee (range mode computes `exactToggle` and never uses it). The honest-gaps list is otherwise
  accurate but incomplete: it names the brace row, hairline and level bead as CSS-blocked, and omits the
  lane divider, the header-width divider and the track rename input, which are equally CSS-blocked.
- Unrecorded spec deviation carried from TA2: spec §4.2 gives `M` to the mixer drawer; the code binds
  `m` to the metronome and the mixer has no key at all (only the `Mix` button).

## 4. Journey results (spec §11)

Legend: PASS / **FAIL** / n-v = not verifiable in this harness.

| T | Subject | Result | Evidence |
|---|---|---|---|
| T1 | one gesture = one undo | PASS | 1 entry; Ctrl+Z byte-identical (`probe-g2`) |
| T2 | 3 px threshold | PASS | 0 entries, tick unchanged (`probe-g1`) |
| T3 | Escape aborts | PASS | 0 entries, `dragActive:false`, byte-identical |
| T4 | 12 px magnet **+ hairline** | PASS | +210 px → exactly +1 bar (3840); hairline count **1**, `indicatorTick 3840`, `null` after release |
| T5 | Ctrl override during motion | PASS | raw 4032 ticks |
| T6 | Shift axis lock | PASS | track held, tick changed |
| T7 | copy-drag 12 px X | PASS | 8 px → 0 clips; 220 px → +1 clip, 1 entry, one undo restores |
| T8 | trim preserves the window | PASS | start +960, `sourceStart` +960, end held |
| T9 | slip | PASS | `sourceStart` 0→7680, start and length held |
| T10 | loop brace creation | **FAIL** | `.arrangement-braces-row` computes to height 0 (21 px with a loop, but unpositioned at the top of the ruler). Unreachable — CSS-owned, disclosed in the doc |
| T11 | marker lifecycle | **PARTIAL FAIL** | rename → `setLocationName` ✔, drag → `moveLocation` ✔, click → `sectionIds` ✔, Delete → `removeLocation` ✔ (locations 4→3). **Create by double-click produced 0 markers** — must-fix 4 |
| T12 | empty-lane drag = time range | PASS | `timeRange {71040,84480}`, 0 clips |
| T13 | Alt+drag = object marquee | PASS | `timeRange null`, 3 clips |
| T14 | draw a clip with `B` | PASS | ghost 1, +1 clip +1 source, 1 entry, one undo removes both |
| T15 | selection exclusivity | PASS | `timeRange null`, 1 clip |
| T16 | Delete preserves the clipboard | PASS | 3 → 2 on Delete, 2 → 3 on paste |
| T17 | range delete keeps outside material | PASS | 1 entry, no clips lost |
| T18 | Space from the piano roll | PASS | `isPlaying` false → true |
| T19 | E / Q level grammar | PASS | arrangement `E` → pianoroll, `Q` → arrangement, `Q` → canvas |
| T20 | text-field guard | PASS | typed "sss" into the rename input, 0 entries |
| T21 | Ctrl+wheel zoom anchor | PASS | 0.43 px drift at x = 600 |
| T22 | plain wheel scrolls the roll | PASS | velocities `[64,64,64]` unchanged. Alt+wheel does edit them (`[65,65,65]`) and `Ctrl+Shift+wheel` does rescale rows (`{56,75}` → `{57,74}`) |
| T23 | follow disarms on touch | PASS | false at press, during and after |
| T27 | double stop returns | n-v | headless Chromium delivers no engine frames; `currentTick()` stays 0 regardless. Needs real audio |
| T30 | edit while playing | PASS | `isPlaying` true before / during / after; no page errors |
| T34 | multi-note move, one clamped delta | PASS | `[57,60,64]` → `[56,59,63]`, 1 entry |
| T35 | velocity rejects wholly | PASS | 20 × `Ctrl+↑` capped at 124, never > 127 |
| T36 | Ctrl+Q quantize | PASS | ≤ 1 entry, no error |
| — | note move / resize / draw / erase / marquee / lollipop / paint | PASS | 1 entry each; Escape restores byte-exactly; 83 notes marquee-selected (`probe-pr`) |
| — | key bed + scroomer | PASS | both pan the pitch range through the shared controller |
| — | mixer fader | PASS | 1 entry per drag; Escape aborts and restores the value exactly |
| — | track reorder | PASS | `[t0,t1,t2]` → `[t1,t2,t0]`, 1 entry |
| — | queued agent edit during a gesture | PASS | `queued`, lands after release |
| — | listener balance | PASS | all window counters return to 0 |
| — | **Ctrl+Z in a focused inline roll** | **FAIL (regression)** | must-fix 1 |
| — | automation point / range | n-v | dev-server 404 from the concurrent lane; retried once |

## 5. Must fix before commit (ranked)

1. **Ctrl+Z / Ctrl+Shift+Z are dead while an inline piano roll has focus. Browser-proven, new this
   round.** `arbiter.ts:51-55` now derives the surface from `document.activeElement` and filters to the
   focused set id, so with an inline roll focused the *arrangement* set never runs — and the
   `pianoroll` set has no undo/redo entry while there is no global one (`arrangement.undo` at
   `ArrangementSurface.tsx:100` is the only caller of `useHistoryStore.undo`). Before this diff
   `uiViewStore.surface` was `'arrangement'` in that state and Ctrl+Z worked.
   Evidence `probe-g2.json → inlineRoll`: ArrowUp transposed `[57,60,64]` → `[58,61,65]` and committed
   **1** history entry; Ctrl+Z left the pitches at `[58,61,65]` (`undoWorks:false`).
   This breaks spec §1 principle 1 ("one release = one Ctrl+Z") on the exact surface this round exists
   to repair. Fix: add `pianoroll.undo` / `pianoroll.redo` canonical entries, or let an unconsumed key
   fall through to the parent surface's set.

2. **The lane-divider and header-width drag handles are unreachable, and the doc says they ship.**
   Measured (`probe-g2.json → unstyledElements`, `probe-misc.json → resizeHandles`):
   `.arrangement-lane__resize` is `200 × 0` px at the lane bottom, `.arrangement-header-resize` is
   `1600 × 0` px at y=116 with its inline `left: headerWidth` ignored (`position: static`). Both drags
   fail. `docs/timeline.md` states "lane height clamps to 28–480 px (Alt applies all), and header width
   clamps to 160–320 px" in the *shipped-behaviour* paragraph and omits them from the honest-gaps list.
   Either add both to the CSS-blocked gaps or hand the CSS lane the rules — do not ship the mismatch.

3. **The ruler loop bracket regressed from a correct indicator to two stray glyphs.**
   `.arrangement-loop-bracket` (absolutely positioned, `pointer-events:none`, real CSS) was deleted from
   the sections row; the replacement `.arrangement-braces-row` has no CSS at all, so with a loop at
   ticks 3840–19200 the `[` and `]` buttons render at ruler **x = 200, y = 117, 4.7 × 18 px each**,
   unrelated to the loop's position (`probe-g2.json → braceRowWithLoop`). It does **not** swallow
   bars-row clicks, and the row is 0 px with no loop — so it is cosmetic, not functional. But the
   shipped state now shows a *wrong* loop indicator where it previously showed a right one, and the doc
   only says brace *manipulation* is unshipped. Keep the old bracket until the CSS lane lands the 64 px
   ruler split, or say plainly that the loop indicator is gone.

4. **Marker creation by double-click is unreachable in any song whose sections span the ruler.**
   `.arrangement-sections-row`'s `onDoubleClick` requires `event.target === event.currentTarget`, but a
   section chip spans from its start to the next section or `songEnd`, so on Paper Sketch the row is
   fully covered by chips. Browser: double-click on the sections row created **0** markers (locations
   4 → 4, `probe-g1.json → T11`). `docs/timeline.md` claims "Double-clicking the chip row creates a
   marker". Fix: accept a double-click on a chip's empty span (or past `songEnd`), or correct the doc.

5. **Make `docs/timeline.md` true.** Items 2, 3 and 4 above, plus "Ctrl toggles" for empty-lane
   selection, which only applies to the Alt marquee. Docs are part of the feature.

### Should fix (not blocking)

6. Collapse the new threshold fork: `dragController.ts`'s `crossedDragThreshold` / `dominantAxis` /
   `DRAG_THRESHOLD_PX` / `COPY_DRAG_X_THRESHOLD_PX` have no production caller and duplicate
   `pointerGestureLifetime`. Point BC-12 at the shipped function. (Keep `autoScrollDelta` / `DragAxis`.)
7. Remove `scrollVelocityEditing` from `editingContextStore` — dead state with a test-only reference.
8. `PianoRoll.tsx`'s inner `Playhead` still lists `playheadTick` in its effect deps, so it
   unregisters/re-registers on the shared rAF on **every published tick while playing**. The report's
   "piano and arrangement playheads do not resubscribe per tick" is true only of `PlayheadLayer`.
9. Replace the vacuous snap-unification test with one that actually exercises the three former call
   sites (or delete it and let the grep-provable single implementation stand on its own).
10. Two console errors from the piano-roll `onWheel`: React attaches `wheel` passively, so
    `event.preventDefault()` is a no-op and logs. Pre-existing shape, but the new `Ctrl/Cmd+Shift+wheel`
    path adds a second occurrence — the roll scrolls while it rescales rows. Use a native
    `{ passive: false }` listener.
11. `arrangement.moveTrackUp/Down` and `markerPrevious/Next` always `return true`, so bare
    `ArrowUp`/`ArrowDown` `preventDefault()` and kill native arrow-key scrolling on the arrangement even
    with nothing selected. Return `false` when there is nothing to move.
12. Once Step is armed there is no keyboard way out (`v b x k` and `t` are all guarded off); only the
    toolbar `Step` button disarms. Give `Escape` or a re-press of `t` the disarm.
13. Fix the six extra-space indentation lines in `pi-openjammer-graph/index.ts`.
14. Record the `M` deviation: spec §4.2 assigns `M` to the mixer drawer; the code binds it to the
    metronome and the mixer has no key.

## 6. Carried forward to Wave 4

**CSS-owned (hand to the CSS lane as one parcel).** `.arrangement-braces-row` + the 64 px ruler split
(D10, unblocks T10 and must-fix 3) · `.arrangement-snap-indicator` hairline · `.arrangement-track__level-bead` ·
`.arrangement-lane__resize` grip · `.arrangement-header-resize` divider · `.arrangement-track__rename`
input · `.arrangement-clip--draw` ghost · replace the raw `<input type="color">` in every track header
with the 8-swatch popover (§2.4) · `.arrangement-marquee.is-range`'s hard-coded `top: 46px !important`
must follow the new ruler height.

**Settings catalogue.** ~25 new binding-set-local action ids (`arrangement.tool.*`, `arrangement.grid*`,
`arrangement.marker*`, `arrangement.nudgeBar*`, `arrangement.moveTrack*`, `arrangement.selectSpatial*`,
`arrangement.home/end/loop/loopIn/loopOut/punch/metronome/muteClips/follow/fitSong/zoomIn/zoomOut/snapToggle/enter/exit/playFromSelection`,
`pianoroll.step.*`, `pianoroll.tool.*`, `pianoroll.escape/exit/transport`) are unlisted, so they neither
appear in Settings nor participate in conflict detection.

**RT automation preview.** Still authored-document re-conduction at a bounded 20 Hz; a direct RT
parameter-preview command needs an executor/audio protocol seam. Legitimately outside this lane.

**Group-edge magnetic anchors.** The dragged selection's own edges are still not in the candidate list
(clip edges, locations and the stopped playhead are).

**DOM pins.** Key-bed / scroomer and velocity paint / Alt-ramp are now browser-verified but still have
no test pin. Add them, plus a pin for the inline-roll undo path once must-fix 1 lands.

**Also open.** Gate-4 #9 — `previewGesture` re-arms the gesture watchdog, so a parked orphan never times
out (mitigated now that auto-scroll stops at 400 ms) · automation point/range browser verification ·
T24 pixel-lock · T25 virtualization at 100 tracks · T26/T27/`Home`/`End`/stopped-only audible scrub and
latency feel with real audio · T28/T29/T31/T32/T33/T37/T38 · T39 through real CDP
`Input.dispatchTouchEvent` · T40/T41/T42/T43/T44 · the transport pill (D9) and sky band, not attempted
this round.

## 7. UNVERIFIED

- Real audio feel: no-click/no-dropout latency judgment, stopped-only audible ruler scrub, `Home`/`End`
  and T27 double-stop against delivered engine frames. **`codex`-class harnesses cannot sign this off —
  it needs a human with sound playing.**
- Automation lane pointer gestures in the browser (dev-server 404 from the concurrent lane; retried
  once).
- Track-colour input driven by hand (React value-tracker blocks synthetic events; covered by vitest).
- T39 touch parity through real CDP touch.
- Everything CSS-owned: the visual judgment for the brace row, hairline, level bead and resize grips.
