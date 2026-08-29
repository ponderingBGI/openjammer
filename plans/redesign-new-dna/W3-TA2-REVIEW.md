# Wave 3 — TA2 gate review (adversarial)

Date: 2026-08-29. Worktree `t3code-2faff191`, branch `t3code/openjammer-redesign-timeline`.
Read-only review: no file in `src/`, `docs/`, `pi-openjammer-graph/` or git state was modified.
Evidence: `plans/redesign-new-dna/.scratch/w3-ta2-gate/` (`probe-a.ts|json`, `probe-b.ts|json`,
`probe-c.ts|json`, `a-final.png`, `b-final.png`, `c-pianoroll.png`, `dev.log`).
Browser runs: one Chromium, `node --experimental-strip-types`, dev server on **5199** (stopped after the run).
CSS / tokens / `packages/**` / `index.html` / Settings were out of scope for this review by instruction.

## Verdict

**DO NOT COMMIT as-is.**

The lane's *new* work is largely sound and well-pinned — the unified controller, the preview-base fix,
the per-surface registry, the ghost height, pinned drag lanes, the shared rAF, the virtualization
rewrite, `moveTrack` / `setTrackColor` / `createClip`, and the note hit-testing fix all verify. Nine of
the seventeen gate-4 follow-ups are genuinely fixed.

But the piano-roll keymap "migration" **detached `onKeyDown` from the shared piano-roll root and only
re-entered a subset of it**, which silently deletes three performer paths that worked before this diff
(browser-proven, below), and the clip gesture now **re-arms follow-playhead on every drop**, which is the
opposite of the rule the same commit writes into `docs/timeline.md`. Those are regressions, not
incompleteness, so the "partially complete but non-regressing" carve-out does not apply.

The four blockers in §"Must fix before commit" are small and local (roughly a half-day). With them fixed
and the two parity failures closed, this state becomes committable — most of the punch list below is
honest incompleteness that TA2b can carry.

## Gates

| Gate | Result |
|---|---|
| `bunx tsc --noEmit -p tsconfig.app.json` | **PASS** (exit 0) |
| `bunx eslint src packages e2e` | **PASS** (exit 0) |
| `bun run test:run -- src/song src/components/Arrangement src/components/PianoRoll src/store src/keymap src/ai` | **2 failed / 562 passed**, 1 failed file |
| `git diff --check` | clean |
| New `any`, `console.*`, `debugger`, `TODO` in scope | none |
| Console/page errors in the browser journeys | **0** (probe C); probe B's 2 errors are artefacts of the synthetic-touch probe, see T39 |

Both test failures are in `src/ai/__tests__/piToolParity.test.ts` and share one root cause: the Pi
extension does not declare `createClip`. **Confirmed as the only reason.**

Correction to the TA2 report: the blocking file is **`pi-openjammer-graph/index.ts` at the repo root**,
not `packages/pi-openjammer-graph/index.ts`. The work order excluded `packages/**`; this path is not
under `packages/`, and no concurrent lane owns it. The report's "BLOCKED by explicit ownership" is
therefore not accurate — TA2 could and should have closed its own gate. Two lines are needed at
`pi-openjammer-graph/index.ts:433` and in the op union:
`Type.Object({ op: Type.Literal('createClip'), trackId: Type.String(), startTick: Type.Number(), lengthTick: Type.Number(), name: Type.Optional(Type.String()) })`.

## Per-deliverable verdict

### 1. One gesture controller — **MOSTLY FIXED, one gesture family not migrated**

FIXED. `src/components/Arrangement/pointerGestureLifetime.ts:24-55` owns pointer id, window
move/up/cancel, blur, Escape and a **per-surface** abort registry (gate-4 #6 closed;
`ArrangementSurface.tsx:183` now aborts only `'arrangement'`, pinned by
`__tests__/pointerGestureLifetime.test.ts:40-43`). `lostpointercapture` is ignored everywhere.
Thresholds (4 px, ×1.75 coarse, 12 px copy-X) and the axis frozen at threshold are correct
(`:57-71`, consumed once at `useClipGesture.ts:83-92`). One rAF preview via `createRafPreview`.
Auto-scroll stops 400 ms after the last motion (`useClipGesture.ts:169`).
Migrated: clip move/copy/trim/slip, ruler scrub, loop/punch brace, automation point + range, mixer
fader + pan, piano-roll note move/resize/draw/marquee/velocity lollipop, track reorder, lane resize,
header-width. Browser: **T1, T2, T3 pass** (one entry, byte-identical undo; 3 px does nothing; Escape
restores byte-exactly with `dragActive` false and zero entries).

**DEFECT 1.1 — the empty-lane range/marquee gesture was never migrated.**
`ArrangementSurface.tsx:256-310` still uses raw React `onPointerDown/Move/Up` with
`setPointerCapture` and **no `pointercancel`, no `blur`, no `Escape`**. Because pointer-down calls
`beginSelectionOp('arrangement')` (`:268`) and only pointer-up calls `commitSelectionOp` (`:307`), a
cancelled marquee leaks the selection-op depth permanently, after which selection history stops
recording. Fix: wrap it in `ownPointerGesture` and call `abortSelectionOp('arrangement')` on abort.
(Browser check `W1_marqueeCancel` in `probe-a.json` did not reach a conclusive read because probe A
crashed earlier; the code path is unambiguous.)

**DEFECT 1.2 — `abortSelectionOp` is dead production code.** Declared and implemented
(`editingContextStore.ts:287-294`), tested, and **called from nowhere**. Value #8.

**DEFECT 1.3 — unguarded `setPointerCapture`.** `useClipGesture.ts:225` runs *after* the listeners are
registered and *before* `beginGesture`; when it throws, the gesture is left half-built (observed live in
probe B: `NotFoundError` from `useClipGesture.ts:226`). Wrap in try/catch — capture is an optimisation
here, the window listeners are the real contract.

Nit (gate-4 #13, carried, still open): `onLostPointerCapture={() => undefined}` at `ClipView.tsx:107`,
`PianoRoll.tsx` note + lollipop. A no-op handler is a dead line; the comment belongs in the source.

### 2. Snap per D1/D3 — **MIXED: radii correct, hairline is a stub, three forked implementations**

FIXED (behaviour): the clip drag implements 12 px grid / 18 px anchor with anchors winning ties, grid
off below 3 px/unit, live Ctrl inversion and Alt+Shift relative offset — `useClipGesture.ts:100-113`.
Browser-proven: **T4 pass** (1 bar = 200 px, +210 px lands exactly on the bar), **T5 pass** (Ctrl during
motion → raw 4032 ticks), **T6/T7/T8/T9 pass**.

**DEFECT 2.1 (blocker) — `snapIndicatorTick` is never written; the hairline can never render.**
`setSnapIndicatorTick` (`editingContextStore.ts:250`) has **zero call sites**. `ArrangementSurface.tsx:323`
reads it — and reads it via `useEditingContextStore.getState()` *during render*, so it is also
non-reactive and would not re-render even if something did set it. Browser: `snapIndicatorTick: null`,
`.arrangement-snap-indicator` count `0` at the exact moment the snap displaced the clip by a full bar
(`probe-b.json` → `T4.hairlineElements`). `docs/timeline.md` documents this hairline as shipped.

**DEFECT 2.2 — three parallel snap implementations, two of them dead.** Value #2 ("extend, never fork"):
- `snapTimelineTick` (`editingContextStore.ts:120-142`) — the spec-shaped one, **used only by its own test**.
- `snapTick` (`:109-115`) — the old flat 12 px one, **used only by `editingContracts.test.ts`**.
- the real one, inlined in `useClipGesture.ts:100-113`.
- a fourth, different rule in `RulerStack.tsx:42-51` (plain `Math.round(raw/step)*step`, no radius, no anchors).
`snapTimelineTick` also disagrees with the shipped rule: it returns raw when `gridUnitTicks` is null
(`:132`), so with grid `none` **anchors stop snapping entirely** — the inline version correctly disables
only the grid. Collapse to one function and call it from the clip drag, the ruler and the piano roll.

### 3. Selection §5 + D2 — **DEFECT: D2 is not implemented, and the docs claim it is**

FIXED: `sectionIds` written by clicking chips (`RulerStack.tsx:102`, Ctrl toggles); `Delete` on a selected
section emits `removeLocation` (`ArrangementSurface.tsx:105`) — **browser-proven, T11 delete path passes
with exactly one history entry**. Ctrl/Shift track-header selection works (`TrackLaneView.tsx:68`).
Selection exclusivity **T15 passes**; clipboard survives Delete, **T16 passes**.

**DEFECT 3.1 (blocker-adjacent) — `Alt`+drag is not the object marquee.**
`ArrangementSurface.tsx:264` decides range vs marquee by *vertical position in the lane*
(`(clientY-laneTop)/laneHeight < 0.5 ? 'range' : 'object'`); `altKey` is never read. Browser: **T13 fails** —
Alt+drag on an empty lane produced `timeRange {38400,67200}` and `clipIds: 0`; the bottom-half drag
produced `clipIds: 1`, `timeRange: null`. Spec D2 and the new `docs/timeline.md` paragraph both say Alt.
Either implement Alt or change the spec and the doc — do not ship the mismatch.
(T12, the empty-lane time range, **passes**.)

INCOMPLETE: keyboard spatial selection `Ctrl+Alt+←/→/↑/↓` (+Shift) — not implemented (report admits).

### 4. Piano roll — **REGRESSIONS: two dead keyboard paths, one dead Escape; scroll model still wrong**

FIXED: a real `surface: 'pianoroll'` BindingSet exists (`PianoRoll.tsx:479-522`); the arbiter's
`isEditableTarget` guard is intact (`arbiter.ts:25`). Browser: **T18 pass** (Space from the piano roll
starts the transport — the gap named in the spec is closed), **T19 pass** (arrangement `E` → pianoroll,
`Q` → arrangement), **T20 pass** (typing "sss" into the rename input changes nothing and adds no history),
**T34 pass** (3-note transpose, one entry, intervals held), **T35 pass** (velocity clamps, nothing > 127),
**T36 pass** (Ctrl+Q ≤ 1 entry). ResizeObserver host ✓ (`PianoRollSurfaceHost.tsx:32-40`, TL-19). Minimum
row height 6 px ✓ (`geometry.ts:27`, D18). Beyond-clip-end draw/step is rejected ✓ (`PianoRoll.tsx:291,414`,
TL-23) — though silently, with no visible feedback, while the doc says "visibly rejected".

**GATE-4 #10 FIXED — note hit-testing.** `probe-c.json` → `noteHitTest: { total: 128, ok: 128 }`: every
note on the piano-roll surface is hit-testable at its own centre (was 0/156 at gate 4).

**REGRESSION 4.1 (blocker) — the inline lane piano roll lost its entire keyboard.**
`PianoRoll.tsx:538` removed `onKeyDown={onKeyDown}` from the shared root, and the replacement BindingSet
is gated by `if (mode !== 'surface') return null;` (`:482`). In `mode: 'inline'` (i.e. `PianoRollLane`, the
lane-expanded roll used from `TrackLaneView.tsx:107`) there is now **no keyboard handling at all**:
delete notes, arrows/nudge, transpose, velocity, Ctrl+C/X/V/D, quantize. Browser-proven: `probe-c.json`
→ `laneModeKeyboard` — ArrowUp on a lane roll with three notes selected leaves pitches `[57,60,64]`
unchanged. Fix: register a `surface: 'arrangement'` binding set for inline mode, or keep `onKeyDown` on
the root for `mode !== 'surface'`.

**REGRESSION 4.2 (blocker) — keyboard step entry is dead on both modes.**
The BindingSet re-enters `onKeyDown` only through the 22-entry `canonical` map (`:484-508`). The step-entry
letters (`a w s e d f t g y h u j`), the step `Space` advance and the step `Backspace` retreat
(`PianoRoll.tsx:397-424`) are not in it and `onKeyDown` is no longer attached, so nothing can reach them.
Browser-proven: `probe-c.json` → `stepEntry` — with `stepEntry.trackId` armed, pressing `a` then `s`
leaves the note count at 204. Secondary collision: the new tool keys `v b x k t` claim five of the twelve
step-entry letters, so even once step entry is re-wired, `t` (F♯) and `b`/`x`/`k`/`v` need an ordering rule.

**REGRESSION 4.3 (blocker) — Escape no longer closes the piano-roll surface.**
`PianoRollSurfaceHost.tsx:49` dropped `onKeyDown={… Escape → close()}` and nothing replaced it (there is a
`pianoroll.exit` on `q`, no Escape entry, and `canvas.escape` is canvas-scoped). Browser-proven:
`probe-b.json` → `T19_escape` — surface stays `pianoroll` after Escape. `Tab` still exits, so this is
recoverable, but it is a removed path.

**DEFECT 4.4 — the scroll model is still the one TL-03 asked to replace.**
`PianoRoll.tsx:539` keeps `scrollVelocityEditing` (default **true**) as the primary condition, so a plain
wheel over the roll with notes selected still edits velocity instead of scrolling. Browser-proven:
`probe-b.json` → `T22` — plain wheel moved velocities 64 → 63 and `scrollTop` did not change. Alt+wheel now
*additionally* forces velocity; that is the only change. `Ctrl+Shift+wheel` row height is **not implemented**
at all (`probe-c.json` → `rowHeightWheel`: row height 18 px before and after). Both are claimed in
`docs/timeline.md`.

**DEFECT 4.5 — the binding set is rebuilt on every render.** `pianoRollBindings` is an IIFE, not a
`useMemo`, and `useBindingSet` re-registers on identity change (`useKeymap.ts:13-18`). During a note drag
the roll re-renders per frame, so the registry array is spliced and re-pushed per frame — an allocation on
a hot path and a constantly changing binding-set precedence order. Wrap in `useMemo`.

**DEFECT 4.6 — the piano-roll playhead still owns a private rAF loop** (`PianoRoll.tsx:631`), outside the
D16 shared loop.

Also unmigrated (report admits): scroomer / key-bed drags, paint / ramp gestures.

### 5. Navigation §6, D6/D7 — **PARTIAL, plus a follow-playhead regression**

Verified working in the browser (`probe-c.json` → `navKeys`): `Shift+Z` zoom-to-selection,
`Ctrl+0` fit song, `Alt+G` snap toggle. `+`/`-` zoom around the playhead, `E`/`Q`, `Shift+Space`,
`Ctrl+A`, `Ctrl+E`, `Ctrl+Shift+Backspace`, `L/I/O/P/M/F/0` are all present in the binding set
(`ArrangementSurface.tsx:96-143`). `Ctrl+wheel` zoom holds its anchor: **T21 pass** (0.48 px drift).

**REGRESSION 5.1 (blocker) — every clip drag re-arms follow-playhead.**
`useClipGesture.ts:208` snapshots `followPlayheadBefore` and `:63` restores it on *both* commit and abort.
Because the clip's own `onPointerDown` calls `stopPropagation()` (`:178`) before the surface handler can
disarm, the snapshot is almost always `true`. Browser-proven: `probe-b.json` → `T23` —
`duringDrag: false, afterDrag: true`. Spec §6 and the new doc paragraph both say a drag disarms follow
and only play-from-stopped or `F` re-arms. Fix: drop the restore; leave follow disarmed after a gesture.

INCOMPLETE (browser-proven absent, `probe-c.json` → `navKeys`):
- `[` / `]` grid unit — grid stays `adaptive`.
- `Ctrl+←/→` marker traversal — playhead unchanged.
- `↑`/`↓` move clips across tracks — clip stays on `t0`.
- `V B X K T` tool keys on the arrangement — **none of them change the tool** (`arrangementToolKeys`: all five leave `select`).

UNVERIFIED (harness limitation, not a defect claim): `Home`/`End` and T27 double-stop. `seek()` sets
`transportPending: 'seek'` and only publishes `playheadTick` when an engine frame returns
(`arrangementStore.ts:680-693`); headless Chromium without audio never delivers one, so
`playheadTick` reads 0 regardless. Re-probe via `currentTick()` with audio actually running.

`PlayheadLayer.tsx:17` also hard-codes the header width as `200` for the page-mode maths while the header
is now user-resizable 160–320 (`trackLaneViewStore.setHeaderWidth`); same hard-coded `200`/`46` in the
auto-scroll edges at `useClipGesture.ts:161-162`.

### 6. Shared rAF (D16) — **FIXED for the three named owners**

`sharedAnimationFrame.ts` is one loop, cancels at zero subscribers, writes to refs (never React state),
pinned by `__tests__/sharedAnimationFrame.test.ts`. `PlayheadLayer`, `RecordGhost` and
`SharedSurfaceChrome` all subscribe. INCOMPLETE: meter / level-bead writers and the piano-roll playhead
(4.6) are not on it. Minor: `PlayheadLayer`'s effect lists `playheadTick` in its deps, so it
unsubscribes/resubscribes on every published tick while playing.

### 7. Track headers + vocabulary — **FIXED for the verbs, INCOMPLETE for the callers**

FIXED: inline rename (`TrackLaneView.tsx:69`, Enter/Escape/blur), drag reorder through the new
`moveTrack` verb, lane-height drag with 28–480 clamp and `Alt` = all lanes plus exact abort,
header-width divider with 160–320 clamp and exact abort (`ArrangementSurface.tsx:241`).
`moveTrack` and `setTrackColor` have exact inverses (`verbs.ts:211-218,233-235`) — the `moveTrack`
inverse is genuinely exact in both directions (index recomputed after removal); pinned in
`verbs.test.ts`. `createClip` is a proper compound (`ops.ts:66-88`) in `EDIT_OPS`, wired to the agent
port (`arrangementAdapter.ts:116`) and pinned by `__tests__/createClip.test.ts`.

**DEFECT 7.1 (blocker) — the Draw tool has no UI caller, and the empty lane advertises it anyway.**
`TrackLaneView.tsx:136` now reads *"drag audio here · press B and draw"*, but `B` is not bound on the
arrangement, `viewports.arrangement.tool` never becomes `'draw'`, and nothing calls `createClip` from the
UI. Browser-proven: **T14 fails** (`probe-a.json`), `arrangementToolKeys.b === 'select'` (`probe-c.json`).
This is a performer-facing instruction for a feature that does not exist. Either implement it or revert
the hint string.

**DEFECT 7.2 — `setTrackColor` is unreachable.** No UI caller, not in `EDIT_OPS`, not in the agent's verb
list (`ai/tools.ts:211`). Dead production code (value #8).

INCOMPLETE: `moveTrack` reorder gives no drag affordance — nothing moves until release.
Double-click on the lane divider resets to 72 px rather than "fit" as specified.
Rename's `onBlur` applies `setTrackName` unconditionally, so blurring an unchanged name still emits a verb.

### 8. Hot paths — **FIXED, with one behavioural caveat**

FIXED: the synchronous full-document `JSON.stringify` is gone from the gesture commit path
(`arrangementStore.ts:586`, replaced by a verb↔inverse comparison). Virtualization rewritten with explicit
half-open boundaries (`geometry.ts:45-51`) and the boundary cases covered in `__tests__/geometry.test.ts`.
The dragged clip's lanes stay mounted while `dragActive` (`ArrangementSurface.tsx:225-228`, gate-4 #4).
The ghost carries the clip's real height (`ClipView.tsx:79` → `useClipGesture` → `DragGhost.tsx:14`,
gate-4 #5). `finish()` no longer allocates unconditionally (gate-4 #7).

**Caveat 8.1** — `shallowVerbEqual` compares values with `Object.is`, so a verb carrying a nested object
(`setLoopRange { location: {...} }`, `addClip { clip: {...} }`) can never equal its inverse. A brace drag
returned exactly to its origin now records an empty history entry where the old stringify check caught it.
Compare structurally, or keep a cheap structural equality for the ≤ 2-verb case.

INCOMPLETE: automation preview still authors whole preview documents (audit §C 6). Gate-4 #8 (the
unbounded `while (gestureDepth > 0)` watchdog loop, `arrangementStore.ts:308`) and #9 (previews refreshing
watchdog liveness) are untouched. Gate-4 #15 (`is-drop-target` outlines the source lane on every plain
move) is untouched — `useClipGesture.ts:145` still sets `hoveredTrackId ?? trackId`.

### 9. Docs — **DEFECT: `docs/timeline.md` documents behaviour that does not exist**

The two new sections are well written and cover D1–D18, but at least eight statements are false against
this diff — a doc that over-claims is worse than no doc, because the next lane will believe it:

| Doc claim | Reality |
|---|---|
| "Alt+drag is object marquee" | lane top-half/bottom-half; `altKey` never read (T13) |
| "The snap hairline appears only when snap displaced … at least 1 px" | `snapIndicatorTick` is never written (T4) |
| "Draw tool B creates … one `createClip` … double-click is one bar" | `B` is unbound on the arrangement (T14) |
| "colours use `setTrackColor`" | no caller |
| "Scrubbing … is audible only while stopped" | no such gating in `RulerStack.tsx:80-95` |
| "Plain wheel scrolls, Alt+wheel edits velocity" | plain wheel still edits velocity (T22) |
| "Ctrl/Cmd+Shift+wheel changes row height" | not implemented (probe C) |
| "play from stopped or F re-arms it" | only `F` and `Shift+Space` re-arm; plain `Space` does not — and a drag wrongly re-arms (T23) |
| "Drawing or step entry beyond the active clip is **visibly** rejected" | silently rejected, no feedback |

## Journey results

Legend: PASS / **FAIL** / n-v = not verifiable in this harness.

| T | Subject | Result | Evidence |
|---|---|---|---|
| T1 | one gesture = one undo | PASS | `probe-a.json` — 1 entry, snapshot byte-identical after Ctrl+Z |
| T2 | 3 px threshold | PASS | 0 entries, tick unchanged |
| T3 | Escape aborts | PASS | byte-identical, `dragActive:false`, 0 entries |
| T4 | 12 px magnet | PASS (snap) / **FAIL (hairline)** | `probe-b` — +210 px → exactly +1 bar; `snapIndicatorTick:null`, 0 hairline elements |
| T5 | Ctrl override during motion | PASS | raw 4032 ticks |
| T6 | Shift axis lock | PASS | track held, tick changed |
| T7 | copy-drag 12 px X threshold | PASS | 8 px → 0 clips/0 entries; 220 px → +1 clip/1 entry; one undo restores |
| T8 | trim preserves the window | PASS | `probe-a` — start +960, `sourceStart` +960, end held |
| T9 | slip | PASS | `sourceStart` 0→2304, start and length held |
| T10 | loop brace creation | **FAIL** | `.arrangement-braces-row` exists but computes to **height 0px** → unreachable by pointer; no loop created (`probe-b.T10`) |
| T11 | marker lifecycle | **PARTIAL** | select + `Delete` → `removeLocation`, 1 entry, PASS. Double-click on the sections row creates **nothing**; no rename, no marker drag |
| T12 | empty-lane drag = time range | PASS | `timeRange {67200,78720}`, `clipIds: 0` |
| T13 | Alt+drag = object marquee | **FAIL** | Alt+drag produced a time range; only the lane bottom half marquees |
| T14 | draw a clip with `B` | **FAIL** | tool stays `select`, clip count unchanged — UI caller missing |
| T15 | selection exclusivity | PASS | `timeRange:null`, `clipIds:1` |
| T16 | Delete preserves the clipboard | PASS | 3→2 on Delete, 2→3 on paste |
| T17 | range delete keeps outside material | PASS | 1 entry; one undo restores everything except `idCounter` (correct — ids must not be reused). My first probe's byte-equality was too strict; diagnosis in `probe-c.T17_diag` |
| T18 | Space from the piano roll | PASS | `isPlaying` false → true |
| T19 | E / Q level grammar | PASS | arrangement `E` → `pianoroll`; `Q` → `arrangement` |
| T19b | Escape closes the piano roll | **FAIL (regression)** | surface stays `pianoroll` |
| T20 | text-field guard | PASS | typed "sss" into the rename input, 0 history entries |
| T21 | Ctrl+wheel zoom anchor | PASS | 0.48 px drift at x=600 |
| T22 | plain wheel scrolls the piano roll | **FAIL** | velocities 64→63, `scrollTop` unchanged |
| T23 | follow disarms on touch | **FAIL** | `followPlayhead` true again after the drop |
| T27 | double stop returns | n-v | `seek()` is engine-pending; `playheadTick` stays 0 headless |
| T30 | edit while playing | PASS | `isPlaying` true before / during / after a full clip drag; no page errors |
| T34 | multi-note move is one clamped delta | PASS | `[57,60,64]`→`[56,59,63]`, 1 entry |
| T35 | velocity rejects wholly | PASS | 20× Ctrl+↑ never exceeds 127 |
| T36 | Ctrl+Q quantize | PASS | ≤ 1 entry, no error |
| T39 | touch parity | n-v | synthetic-touch pointer ids make `setPointerCapture` throw (`useClipGesture.ts:226`) — see DEFECT 1.3; needs a CDP touch harness |
| — | note hit-testing (gate-4 #10) | PASS | **128/128** notes hit-testable at their own centre |
| — | Wave-1 cross-track ghost | PASS | ghost mounts, source lane stays mounted, +450 px drag survives (re-confirmed from gate-4 evidence + T30) |
| — | listener balance | inconclusive | `pointermove`/`pointercancel`/`blur`/`keydown` all return to baseline; window `pointerup` ends **+1**. Appears only after the synthetic-touch probe that threw inside the pointer-down handler, so it is most likely an artefact of DEFECT 1.3 rather than a controller leak — TA2b should re-measure without the synthetic touch |

## Must fix before commit (ranked)

1. **Restore the inline piano roll's keyboard.** `PianoRoll.tsx:482` + `:538`. Register a binding set for
   `mode !== 'surface'` (surface `'arrangement'`) or keep `onKeyDown` on the root for inline mode.
   *Regression, browser-proven.*
2. **Restore keyboard step entry.** Add the step-entry grammar to the binding set (or route unmatched keys
   back into `onKeyDown`) and settle the `v b x k t` ↔ step-letter collision. `PianoRoll.tsx:397-424`.
   *Regression, browser-proven.*
3. **Stop re-arming follow-playhead after a gesture.** Delete the `followPlayheadBefore` restore at
   `useClipGesture.ts:63` (and the snapshot at `:208`). *Regression against spec §6 and this commit's own doc.*
4. **Restore Escape on the piano-roll surface.** Add a `pianoroll.escape` entry (or reinstate the host
   handler) — `PianoRollSurfaceHost.tsx:49`. *Regression.*
5. **Make `docs/timeline.md` true.** Either implement or delete each of the nine over-claims in §9. Docs are
   part of the feature; a false doc is worse than none.
6. **Revert or implement the "press B and draw" hint.** `TrackLaneView.tsx:136`. Do not advertise a missing
   feature to the performer.
7. **Close the parity gate yourself.** `pi-openjammer-graph/index.ts` is in scope; add the `createClip`
   schema and the suite goes green.
8. **Wire `setSnapIndicatorTick`** (and make `ArrangementSurface.tsx:323` a reactive subscription), or remove
   the state, the setter and the element. Half a feature is worse than none.
9. **Migrate the empty-lane marquee onto `ownPointerGesture`** and abort with `abortSelectionOp` — today a
   pointercancel permanently leaks the selection-op depth. `ArrangementSurface.tsx:256-310`.

## TA2b punch list (everything still incomplete)

**Gestures**
- Empty-lane range/marquee not on the controller; no Escape/cancel/blur abort; `abortSelectionOp` unused.
- Scroomer / key-bed drags, piano-roll paint and ramp not migrated.
- `setPointerCapture` unguarded at `useClipGesture.ts:225` (and the same shape in `RulerStack`, `TrackLaneView`, `MixerDrawer`).
- Ruler gestures have no 4 px threshold: a bare click in the brace row creates a 1-tick loop and an undo entry (`RulerStack.tsx:107` + `:69`).
- Ruler scrub is not gated to "audible only while stopped" (TL-09).
- `ownPointerGesture`'s Escape does not `stopPropagation`, so Escape both aborts and reaches surface actions.
- A local `defaultBinding` cannot be explicitly unbound: `getBinding` returns `undefined` for `UNBOUND_KEY`, and `arbiter.ts:14` then falls back to the local default.

**Snap**
- Collapse `snapTick`, `snapTimelineTick`, the `useClipGesture` inline rule and the `RulerStack` rule into one function; fix `snapTimelineTick`'s grid-`none` bail-out that also kills anchors.
- Snap hairline: write it, subscribe to it, and let the CSS lane style `.arrangement-snap-indicator`.
- Anchors are not yet complete: loop/punch edges and the dragged selection's own edges are not in the candidate list (`useClipGesture.ts:195-199` covers clip edges, locations and the stopped playhead only).

**Selection**
- D2 Alt+drag marquee (or a spec amendment + doc fix).
- `Ctrl+Alt+←/→/↑/↓` keyboard spatial selection (+Shift extends).

**Piano roll**
- Inline-mode keyboard; step entry; Escape (blockers above).
- TL-03 scroll model: plain wheel must scroll; `Ctrl+Shift+wheel` row height is missing entirely.
- `useMemo` the binding set (`PianoRoll.tsx:479`).
- Move the piano-roll playhead onto `sharedAnimationFrame` (`PianoRoll.tsx:631`).
- Give the beyond-clip-end rejection visible feedback.
- `erase` fires on any button when `tool === 'erase'` (`PianoRoll.tsx:282`).

**Navigation**
- `[` / `]` grid unit; `Ctrl+←/→` marker traversal; `↑`/`↓` clips across tracks; `V B X K T` on the arrangement.
- Register the new local `defaultBinding` actions in the keybindings catalogue so they appear in Settings and participate in conflict detection.
- Replace the hard-coded `200` header width in `PlayheadLayer.tsx:17` and `useClipGesture.ts:161-162` with `useTrackLaneViewStore.headerWidth`.
- Re-verify `Home`/`End`, `L`, and T27 with audio actually running.

**Ruler / markers**
- The brace row computes to `height: 0` — hand the CSS lane the 64 px ruler split so T10 becomes reachable; then re-run T10.
- Marker creation (double-click the sections row), rename, and drag — `addLocation` / `setLocationName` / `moveLocation` are the missing half of T11.
- `.arrangement-ruler-viewport` carries `aria-hidden="true"` while containing focusable section chips and brace handles — an a11y violation.
- `RulerStack.tsx:101` reads the store with `getState()` inside `map` during render (works only because the parent re-renders).

**Vocabulary / agent**
- `pi-openjammer-graph/index.ts`: add `Type.Literal('createClip')` with `trackId` / `startTick` / `lengthTick` (+ optional `name`). **This is the whole of the red test suite.**
- `setTrackColor` needs a UI caller (a colour picker) or removal.
- `createClip` needs its Draw-tool caller (`B` + drag on an empty lane; double-click = one bar).
- Add `moveTrack` / `setTrackColor` to the agent verb documentation in `ai/tools.ts:211`.

**Hot paths / hygiene**
- Automation preview still rebuilds authored preview documents per move (audit §C 6).
- Gate-4 #8: bound `while (gestureDepth > 0) get().commitGesture();` (`arrangementStore.ts:308`).
- Gate-4 #9: previews refresh watchdog liveness; an orphan parked at a scroll edge never times out.
- Gate-4 #13: `onLostPointerCapture={() => undefined}` dead handlers.
- Gate-4 #15: `is-drop-target` outlines the source lane on every plain move (`useClipGesture.ts:145`).
- `shallowVerbEqual` misses round-trips on verbs with nested payloads (Caveat 8.1).
- `PlayheadLayer`'s effect re-subscribes on every published `playheadTick`.
- Track rename `onBlur` emits `setTrackName` even when unchanged.
- Re-measure the window-listener balance without the synthetic-touch probe.

**Harness**
- T39 needs a real touch path (CDP `Input.dispatchTouchEvent`), not synthetic `PointerEvent`s.
- T27 / `Home` / `End` need a probe on `currentTick()` with the engine actually delivering frames.
