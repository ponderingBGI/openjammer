# W1-TA1 — adversarial review of the timeline reliability change set

Reviewer: principal-DAW-engineer pass, read-only.
Date: 2026-08-28.
Scope reviewed: `src/store/{arrangementStore,editingContextStore,historyStore,trackLaneViewStore}.ts`,
`src/components/Arrangement/*`, `src/components/PianoRoll/*`, `src/song/__tests__/wave4bEditing.test.ts`,
`src/audio/executor/timelinePlayback.ts` (unchanged), plus the four untracked test files.
Canvas-lane files were ignored as instructed.

## Gates actually run

| Gate | Result |
|---|---|
| `bun run test:run -- src/song src/components/Arrangement src/components/PianoRoll src/store` | **PASS** — 45 files, 386 tests, 25.9 s. |
| `bunx tsc --noEmit -p tsconfig.app.json` | **PASS** — zero errors (including the concurrent canvas lane). |
| Browser drive, Chromium headless, `bun dev --port 5182` | **RAN** — four harnesses, `plans/redesign-new-dna/.scratch/review-ta1/drive{,2,3,4}.ts`, screenshots `00`–`13`. Chromium launched fine on this host; the report's `0xC0000142` blocker did not recur. |

Dev server stopped (port 5182 free).

**Environment caveat that bounds every audio claim below:** in headless Chromium the wasm executor
emitted **zero** `Transport` frames in 8 s of playback (`frames: 0`, `motion: 0`, `playheadTick: 0`).
So nothing in this review verifies *heard* audio, loop continuity, or engine-side timing. What it does
verify is the store/UI behaviour when acknowledgements are slow or absent — which is exactly the TL-15
failure mode, and it fired on the ordinary happy path here.

---

## Verdict per finding

### TL-01 — loop watchdog — **INCOMPLETE (one new P1 hole, one new regression path)**

Correct parts (`src/store/arrangementStore.ts:110`, `:127`, `:532-541`): `startPreview` and
`republishPreview` both read `state.loopEnabled` at arm time, so republish-while-rolling and
tempo/mute edits while looping no longer re-arm the watchdog; `setLoopEnabled(true)` while rolling
clears a live timer; `setLoopEnabled(false)` while rolling republishes and therefore *re-arms*
correctly (the `set()` precedes the `republishPreview`, so the flag it reads is already `false`).
Browser: loop pill on, 8 s of play, still `isPlaying: true` — the watchdog did not fire.

**DEFECT 1 — loop enabled with no `loop` location silently disables the only end-of-song truth.**
`arrangementStore.ts:110`. Paper Sketch (the shipped starter) has **no `loop` location**
(`hasLoopLocation: false`, measured). One click on the loop pill therefore arms nothing in the engine
*and* suppresses the end watchdog. Playback runs off the end and `isPlaying` stays `true` forever
unless a `motion: 0` frame arrives — which is the inverse of the lie TL-01 was raised to remove.
*Fix:* gate on an actual loop range, not on the UI flag —
`const looping = state.loopEnabled && (arr.locations ?? []).some(l => l.kind === 'loop' && l.endTick !== undefined);`
and use `looping` for both `startPreview` and `republishPreview`. The audit's own suggestion
("reconcile from authoritative engine frames") is still unimplemented.

**DEFECT 2 — the end watchdog now rewinds the song.** `arrangementStore.ts:494-498` + `:616-643`.
`receiveTransportFrame` sets `isPlaying: false` on `motion === 0` but **never calls `clearEndTimer()`**.
The end timer is armed at `remainSec*1000 + 80`, i.e. it fires *after* the engine's own stop frame.
It then calls `stop()`, which now takes the new `!isPlaying` branch and issues
`seek(playOriginTick)`. So a song that reaches its end freezes honestly for ~80 ms and then jumps
back to where playback started. This directly contradicts spec §7 ("the playhead freezes where it is").
*Fix:* call `clearEndTimer()` inside `receiveTransportFrame` whenever the frame reports `motion === 0`,
and make `onEnd` a dedicated `stopAtEnd()` that never seeks.

### TL-05 / TL-06 / §C4 — transaction-local ids — **CORRECT (TL-05, TL-06) / INCOMPLETE (§C4 overlap)**

`arrangementStore.ts:468-474`: `mintId` now advances `previewBase.idCounter`, so an id minted inside
an open gesture survives `commitGesture` (which rebuilds from `previewBase`) *and* `abortGesture`
(which restores `previewBase`, counter included). Verified: the new
`stores IDs allocated during a gesture…` test fails on the old code (old `commitGesture` rebuilt from a
`previewBase` whose `idCounter` was still stale, so the reloaded document re-minted the same id).

`useClipGesture.ts:97-106` now applies the same relative track delta to copy templates.
**Verified live:** Alt-drag from track `t0` onto the lane below produced a second clip on `t1`
(`{t0:1, t1:2, t2:1}`), one history entry, and one `Ctrl+Z` removed it. TL-06 is genuinely fixed.

Collision safety: `idCounter` is a single module-level counter incremented synchronously, so two
overlapping gestures cannot mint the same id.

**INCOMPLETE — overlapping gestures still corrupt each other's transaction.** Not an id collision, a
verb collision:
- `beginGesture` (`arrangementStore.ts:401`) early-returns when `previewBase` is set, so a second
  concurrent gesture silently *joins* the first; its `commitGesture` closes the first one.
- `previewGesture` (`:410`) does `previewVerbs = verbs` — it **replaces**, not appends. A mixer pan
  drag or a piano-roll wheel burst starting during a clip drag throws away the clip drag's verbs.
- `apply()` with an open gesture (`:369-395`, unchanged) writes onto `previewBase`, then sets
  `previewBase = null` **without** closing the open `historyStore` transaction — so an agent
  `edit_timeline` arriving mid-gesture leaves `historyStore.open` dangling and the gesture's own
  `commitGesture` then no-ops.
*Fix (minimum):* have `beginGesture` reject (or force-abort) while another gesture is open and have
`apply()` refuse to run while `previewBase !== null` (queue it, or abort the gesture first and say so).

### TL-12 — MixerDrawer "consume the following onCommit" — **DEFECT (P0, silent lost edit)**

`src/components/Arrangement/MixerDrawer.tsx:26-32, 66-84`.

The trick is unsound because **the pan drag never produces an `onCommit` at all**. `ValueScrubber`
fires `onCommit` only from the inline typed editor (`ValueScrubber.tsx:62-66`, and only when
`parsed !== value`). The pointer path is `onPointerDown → onPointerMove → onPointerUp`. So
`suppressPanCommit` is set `true` and then **never consumed** — it latches until the next *legitimate*
typed commit eats it.

Worse: `onPointerDown` sets `panGesture.current` on **any** press, including a plain click. A single
click on the pan readout therefore runs `finish()` → `suppressPanCommit = true`, and the very editor
that click just opened is guaranteed to be swallowed on Enter.

**Measured in the browser (three independent attempts, `drive3.ts`):**
- clean state, click pan → type `0.4` → Enter → `cursor: 0`, `pan: undefined` (nothing happened);
- again with `-0.3` → still `cursor: 0`;
- after a pan drag (`cursor: 1`, `pan: 0.5`), typing `0.9` then `0.1` → `cursor: 1`, `pan: 0.5`.

**Typing a pan value is now completely non-functional.** It worked before this change. This is an
edit that disappears with no error — the worst class of bug in a document editor.

Also unfixed: `editorOpenedByDrag: 1` — a pan *drag* still ends by popping the inline number editor
open, which was the visible half of TL-12.

*Fix:* drop the suppression flag. Own the click instead: track whether the pointer moved past a
threshold during the gesture, and if it did, swallow the *click* (`onClickCapture` →
`event.stopPropagation()` / `preventDefault()`) so the editor never opens after a scrub. Then
`onCommit` is unambiguously the typed path and can always `apply`. Add the missing reset on
`onPointerCancel` too (`:77` clears `gesture`/`panGesture` but not `suppressPanCommit`).

Fader (gain) path is fine: one drag → one `Adjust track gain` entry (measured).

### TL-13 — single-rAF viewport controller — **PARTLY CORRECT / DEFECT (P1, visible)**

`src/components/Arrangement/ArrangementSurface.tsx:59-77, 195, 200-207`.

Correct: scroll and zoom share one rAF; the frame is cancelled on unmount (`:137`); `pxPerTick` is
re-read from the store at flush time (the stale-closure fix is real); **wheel coalescing is exact** —
4 notches dispatched in one frame produced `pxPerTick` ratio `0.3828928859751119` against an expected
`exp(-120*0.002)^4 = 0.3828928859751119` (measured).

The anchor invariant in the store is correct: `zoomAroundPointer` (`editingContextStore.ts:70-76`)
holds `leftTick + pointerPx/pxPerTick` constant, i.e. the tick under the cursor is preserved.

**DEFECT — the rAF body destroys that invariant by round-tripping through the DOM.** Lines 68-76 do
`zoomAt(...)` → `scroll.scrollLeft = next.leftTick * next.pxPerTick` → then immediately read
`scroll.scrollLeft` back and write `setViewport({ leftTick: scroll.scrollLeft / currentScale })`.
The assignment happens in the *same* rAF as the store update, before React has committed the new
`contentWidth`, so the browser clamps/rounds it and the clamped value is written straight back into
the document of record.

**Measured (`drive4.ts`, synthetic wheel so no confound from native page zoom):**
`leftTick 28910.6, scrollLeft 8399, pxPerTick 0.29052` → **one** zoom-out notch →
`leftTick 0, scrollLeft 0`. Drift **−28 096 ticks**. The same jump reproduced with a real
`mouse.wheel` in `drive2.ts` (`27797 → 0`). One zoom notch throws the arrangement back to bar 1.

*Fix:* never derive `leftTick` from `scrollLeft` in a flush that performed a zoom. Write the store from
`next` only, and defer the DOM `scrollLeft` write until after React has committed the new content
width (a `useLayoutEffect` keyed on `pxPerTick`, or a second `requestAnimationFrame`), then re-clamp
`leftTick` from the *authoritative* store value, not from the element.

Interaction with `PlayheadLayer`: acceptable — `PlayheadLayer.tsx:16` only writes `scrollLeft` on a
page flip, not every frame, so it does not fight the controller continuously. It can still race a zoom
that lands in the same frame; low priority.

Related, pre-existing but blocking a real fix: `event.preventDefault()` in the React `onWheel`
(`:199`) is a no-op — React 19 registers `wheel` passively. Chromium logged
`Unable to preventDefault inside passive event listener invocation` on every Ctrl+wheel, and the
browser performs its own page zoom on top of the app zoom. TL-13 cannot be called done until the
handler is a non-passive native listener (`addEventListener('wheel', h, { passive: false })`).

### TL-14 — `useClipGesture` lifecycle — **DEFECT (P0 regression: cross-track clip move is dead)**

`src/components/Arrangement/useClipGesture.ts:56-63`.

The duplicate `mousemove`/`mouseup` listeners are correctly gone, `finishRef` is stable and assigned
before the escape effect runs (declaration order at `:54` vs `:56`), and StrictMode's mount→unmount→
mount is harmless because `gesture.current` is null at that point.

But the new unmount cleanup `if (gesture.current) finishRef.current(false)` aborts the gesture whenever
the *dragged component* unmounts — and a cross-track move **causes exactly that**: the preview verb
reassigns the clip to the hovered track, React moves it into the other `TrackLaneView`, the source
`ClipView` unmounts, and the gesture aborts mid-drag.

**Measured (`drive3.ts`, `beginGesture`/`commitGesture`/`abortGesture` instrumented):**

| moment | log | history cursor |
|---|---|---|
| after threshold (same lane) | `["begin:Move clips"]` | – |
| after crossing into lane 2 | `["begin:Move clips", "abort"]` | – |
| after pointerup | `["begin:Move clips", "abort"]` | **0** |

Control, pure horizontal drag: `["begin:Move clips", "commit"]`, cursor 1, `style.left` `0px → 716.875px`,
one `Ctrl+Z` → `0px`. So the gesture machinery is fine; only the vertical case dies.

Before this change the same unmount leaked the window listeners (the actual TL-14 bug) but the gesture
survived and committed. **This is a regression: dragging a clip to another track no longer works at all.**

*Fix:* move the gesture out of the per-clip component's lifetime. Either (a) own the gesture in
`ArrangementSurface` / a small store so a ClipView remount cannot abort it, or (b) keep the hook but
tear down only the *listeners* on unmount and let a surface-level effect own the terminal
`finish(false)`. If (b), guard with a "the node moved, it did not go away" check — e.g. only abort when
`useEditingContextStore.getState().dragActive` is false or the surface itself is unmounting.

Two smaller items in the same file:
- `onLostPointerCapture` (`:181`) is safe on the normal path (the window `pointerup` listener runs
  during bubbling and nulls `gesture.current` before `lostpointercapture` is dispatched), but it is
  the *same* hazard as above once the node is detached. Fold it into whatever fix (a)/(b) lands.
- `onPointerCancel: () => finish(false)` (`:180`) is unguarded, unlike `onLostPointerCapture`. A stray
  pointercancel on a clip with no local gesture calls `abortGesture()` and can kill an unrelated open
  transaction. Add `if (gesture.current)`.
- TL-08 remains unfixed (out of TA1 scope but now more reachable): the autoscroll rAF still fabricates
  `shiftKey:false, altKey:false` at `:124`, so an Alt-copy or Shift-lock drag silently changes mode as
  soon as edge autoscroll starts.

### TL-15 — acknowledgement generations + bounded timeout — **INCOMPLETE (P1) + one DEFECT**

Correct: `seek`/`play` failures are caught and clear pending without losing the last confirmed tick
(`:484-491`, `:518-524`); the seek tolerance is one engine block (`:623`, `> 256`); a stale generation
cannot clear a newer command (`:54`).

Answering the question that was asked — *can a slow engine be reported as failed while it then starts
anyway?* Partly, and the code recovers:
- **play**: the timeout at `:55` clears `transportPending` and sets `transportError`, but leaves
  `isPlaying: true`. A late `motion: 1` frame passes the `!pending && !isPlaying` guard and is accepted,
  clearing the error. Self-healing.
- **stop**: after the timeout, a late `motion: 1` frame is dropped (`:621`), so the UI stays stopped
  while the engine may still be rolling. In this environment that is not hypothetical — see below.
- **count-in makes the timeout fire by construction.** `Motion::CountIn = 5`
  (`crates/ojcore/src/transport.rs:40`), and `receiveTransportFrame` rejects any frame with
  `motion !== 1` while `pending === 'play'`. Two count-in bars at 84 BPM ≈ 5.7 s ≫ 1.5 s, so every
  count-in recording start now raises "the audio engine did not acknowledge". Same for
  `DeclickToLocate(3)`/`WaitingForLocate(4)` on a slow locate.
- **seek while stopped never gets acknowledged here at all.** Measured: `seek(1920)` → at 400 ms
  `pending: 'seek'`, at 2000 ms `pending: null`, `transportError` set, **`playheadTick` still 0**. The
  playhead does not move and the user is told the engine failed. (`playheadTick` is only ever written
  by `receiveTransportFrame`.)
- On the ordinary Play in this environment the timeout fired every time: after 8 s,
  `transportError: "The audio engine did not acknowledge…"` with `isPlaying: true`.

**DEFECT — `transportError` is never rendered.** `grep` finds no consumer outside the store and its
test; `TransportStrip.tsx:81` renders `recordError` only. The "honest error" TL-15 asked for is written
to a field nobody reads, so the user still sees a silent wedge. *Fix:* surface it next to
`recordError` (`role="status"`), or fold it into the existing transport banner.

**DEFECT — `play()`'s catch does not stop the engine.** `:489-491` sets `isPlaying: false` but, unlike
`record()` (`:595`), never calls `stopPreview()`. If `startArrangementPreview` throws *after* publishing
the graph, the UI says stopped while the engine keeps rolling — the exact stage-worst-case. *Fix:* add
`stopPreview();` as the first statement of the catch.

**INCOMPLETE — the acknowledgement filter should be motion-set-aware, not `=== 1`.**
`timelinePlayback.ts:76` already exports `isRollingMotion` (1, 3, 4) and nothing uses it. Accept
`isRollingMotion(frame.motion) || frame.motion === 5` as a play acknowledgement, and treat
`CountIn`/`DeclickTo*` as "still working" rather than restarting the 1.5 s clock against them.

Also: `startPreview`'s doc comment (`:60-66`) still claims it is "wrapped so a lowering/engine hiccup
NEVER breaks the transport — the playhead still moves". The `try`/`catch` was removed; the behaviour is
now fail-closed. Docs are part of the feature — update it. (The de-indented block left behind at
`:91-109` should also be reflowed.)

### TL-16 — recording fails closed — **CORRECT**

`:591-602`. Bindings are produced before any recording state is published; a throw or zero armed
bindings restores the prior play state, calls `stopPreview()`, and journals an actionable message.
The pinning test fails on the old code (the old `startPreview` swallowed the throw and the store had
already set `isRecording: true`). Not exercised in the browser.

### TL-17 — recording completion generations — **CORRECT (with one gap)**

`:258-259, 285-290`. Document and record-session generations are captured before the await and the
capture is rejected on mismatch, with the journal cleared. `setArrangement` bumps both (`:332-334`).
Test genuinely exercises the interleaving.

Gap: the mismatch branch does not restore `isPlaying`/transport state beyond clearing
`transportPending`; if the song was swapped mid-capture the transport is left stopped, which is
probably right, but it is untested and undocumented.

### TL-18 — lane-height restoration — **CORRECT**

`trackLaneViewStore.ts:57-92`. `previousLaneHeights` is separate, is not overwritten when the expanded
clip changes on the same track, and is cleared on close. Both new tests fail on the old code. Minor
nit: `72` is now a magic literal in three places — hoist a `COLLAPSED_LANE_HEIGHT`.

### TL-22 — wheel velocity debounce — **INCOMPLETE (untested in the browser; two real holes)**

`PianoRoll.tsx:104-108, 143-148, 413-431`. The structure is right: one `beginGesture`, cumulative
delta previewed from a stable base, one commit after 180 ms of quiet, timer cleared and gesture
committed on unmount.

Holes:
1. **Surface unmount during the quiet period commits, clip change does not reset.** The unmount effect
   (`:143-148`) commits, which is defensible. But when `props.clipId` changes without unmounting,
   `velocityWheelBase`/`velocityWheelDelta`/the timer are **not** reset, so a wheel burst started on
   clip A and continued on clip B keeps accumulating against A's base and A's `selectedNoteIds`.
   *Fix:* reset the burst in an effect keyed on `[props.clipId, props.trackId, selectionSurface]`
   (commit first, then clear).
2. **`beginGesture` silently joins an open gesture** (see §C4). A trackpad wheel during a note drag
   will overwrite the drag's `previewVerbs` and commit only the velocity change.
3. The `onWheel` is passive, so the `preventDefault` there is also a no-op — the surface will scroll
   underneath a velocity edit.

No component-level test exists for the burst. The report's claim that "component burst timing is
UNVERIFIED" is accurate and still true after this review.

### TL-24 — audition tokens — **INCOMPLETE (P1)**

`PianoRoll/actions.ts:28-103`. The token machinery is correct in isolation: one map entry per voice,
pending native timers cancelled, `sounding` guards a double note-off, a voice that never sounded is
dropped when playback starts, releases stay valid after playback starts, and `stopArrangementPreview`
is gone from the audition path. The three tests are good and fail on the old code.

But **production never uses the tokens.** `PianoRoll.tsx:164` wraps the helper and every call site
(`:186, :216, :240-241, :344-345`) passes only `(pitch, velocity, phase)`, so every release goes through
the `find(trackRef && pitch)` fallback. Consequences:
- The token API and `releasePianoRollAudition` are dead production code (code-value #8).
- The tested property ("each voice released exactly once") is proved for an API the app does not call.
- A note-drag audition (`:186` on) has **no off on pointercancel / lost capture** — only
  `endNoteDrag` (`:216`) and the unmount sweep release it. TL-20 was not in scope, but the brief's
  "every note-on has exactly one note-off on every path" is not met.
- `cancelPianoRollAuditions()` is wired only to unmount; the transport starting does not sweep held
  voices.

**Behaviour change worth a decision, not just a note:** removing `executor.stopArrangementPreview()`
from the off path also removed the only teardown of the `updateArrangementPreview` publication
(`actions.ts:56-57`). In `OjcoreWasmExecutor`, `stopArrangementPreview()` is `TransportPause` +
`resync()` — the call that restores the canvas graph. After an audition the arrangement's conducted
graph now stays published indefinitely. Separating audition from transport ownership was right;
replacing the teardown was skipped. *Fix:* have `cancelPianoRollAuditions()` (and the last-voice
release) call the executor's graph resync, or give the executor an explicit
`releaseAuditionGraph()` that does not touch transport.

Perf: `auditionPianoRollNote(...,'on')` runs a full `conduct(arrangement, …)` **per note-on**, on the
pointer path. Unchanged by TA1 but now unbounded across overlapping voices.

### TL-26 — repeated step entry — **CORRECT, UNTESTED**

`PianoRoll.tsx:324` — `if (event.repeat) return;` is placed inside the step-entry branch before both
insertion and cursor movement. Correct. No DOM keydown test; the report says so.

### TL-28 — end-exclusive bar labels — **CORRECT logic / DEFECT in the wiring**

`geometry.ts:15-20` is right and consistent with the rest of the app: `tickToBarBeat` is the same
1-based helper `formatBarBeat` and `getGridLadder` build on, so a non-4/4 meter now labels correctly
and `[startTick, endTick)` is honoured.

**DEFECT — `ClipView` now subscribes to the whole arrangement.** `ClipView.tsx:75`
(`useArrangementStore((state) => state.arrangement)`) makes **every visible clip re-render on every
document change — including every `previewGesture` frame of a drag** (which replaces the arrangement
object on each pointermove). That is a per-pointer-move re-render of the whole lane set, on the
interaction path the redesign is meant to make feel instant. It also rebuilds
`timebase(arrangement ?? { … })` from a fresh object literal each render.
*Fix:* pass `timebase` (or `startBar`/`endBar`) down as a prop — `ArrangementSurface` already computes
`const tb = timebase(arrangement)` at `:165` and `TrackLaneView` is already in the chain.

Cosmetic: for a one-bar clip the label span is now `startBar === endBar`; confirm the JSX collapses
`1–1` to `1`.

### §C2 — editing-context selection authoritative — **CORRECT**

The seven synchronous `arrangementStore.selectNotes(...)` double-writes are gone from `PianoRoll.tsx`.
No production reader of `arrangementStore.selectedNoteIds` remains (`TrackLaneView.tsx:32` and
`PianoRoll.tsx:81` both read the editing context; `ai/arrangementAdapter.ts:183` writes the editing
context). The now-unused `selectedNoteIds`/`selectNotes` on `ArrangementStore` (`:185, :228, :477`)
should be deleted — "migrate fully, remove legacy paths".

### §C3 — selection history per surface — **INCOMPLETE**

Per-surface storage is correct (`editingContextStore.ts:43-48, 185-249`), the state is not persisted
(no `persist()` wrapper), so serialisation is a non-issue, and the migrated BC-26 test still passes.

But the routing is only two-thirds done:
- `historyStore.ts:61` maps `graph → 'canvas'` and everything else → `'arrangement'`. Piano-roll edits
  record with `scope: 'arrangement'` (`arrangementStore.ts:392, :452`), so document undo/redo resets
  the **arrangement** baseline and leaves the `pianoroll` surface's selection history stale forever.
  `HistoryScope` has no piano-roll member; either add one or carry the originating `SurfaceId` on the
  entry.
- `Ctrl+Alt+Z` semantics are **not** preserved for the full piano roll: the only bindings are
  `ArrangementSurface.tsx:87-88` with a hard-coded `'arrangement'`, and the full surface uses
  `selectionSurface === 'pianoroll'` (`PianoRoll.tsx:80`). Selection undo in the full piano roll
  therefore acts on the wrong surface. (TL-02 already says the piano roll has no binding set; this is
  the same gap.)
- `editingActions.ts:139` still hard-codes `'arrangement'`.

### §C5 — coalesced viewport writes — see TL-13 (partly correct, one measured defect).

### §C7 — separate audition / playback / recording ownership — see TL-15/16/17/24. The generations are
real and correct; audition ownership is only half-adopted.

### Transport additions (spec §7) — **INCOMPLETE / DEFECT**

- `playOriginTick` (`:483, :487, :601`) is set correctly, but **`returnToStart()` and `setTempo()` have
  no production callers.** `TransportStrip.tsx:38` still calls `seek(0)` directly and `:62` still calls
  `apply({ kind: 'setTempo', tempoBpm })` **unclamped**. So spec §7's "clamp 20–300" is *not* enforced
  on the only path a user can reach; the clamp lives in dead code that only the unit test calls.
  *Fix:* point `TransportStrip` at `store.setTempo` / `store.returnToStart`, or delete the store
  actions. `setTempo` also republishes immediately on every call via `apply` → `republishPreview`; the
  spec's "≤ 20 Hz republish while rolling" requires the tempo scrub to go through
  `beginGesture/previewGesture/commitGesture` (which is already 20 Hz-bounded at `:416-422`), not
  through `apply`.
- **The "second Stop returns to origin" rule is unreachable from the UI and dangerous where it *is*
  reachable.** Both stop paths guard on `isPlaying`
  (`ArrangementSurface.tsx:84`, `TransportStrip.tsx:36`), so a user can never invoke `stop()` twice.
  The only callers that reach the new branch are internal — chiefly the end-of-song watchdog, which is
  how it becomes the rewind bug described under TL-01 DEFECT 2. Measured: calling `stop()` while
  stopped issues a `seek` (`pending: 'seek'`).
  *Fix:* implement the double-tap where the spec puts it (the transport pill / `Space` handler, with a
  short window), and keep the store's `stop()` idempotent and side-effect-free when already stopped.
- Loop/record interaction: `stop()` while recording routes to `finishRecording()` before the new
  branch, so record is unaffected. Loop is unaffected. No problem found there.

---

## Regressions introduced by this change set

| # | Regression | Where | Evidence |
|---|---|---|---|
| R1 | Dragging a clip to another track aborts on lane crossing and commits nothing | `useClipGesture.ts:56-63` | instrumented browser run: `begin → abort`, cursor 0 |
| R2 | Typing a pan value never applies (any click on the readout latches the suppressor) | `MixerDrawer.tsx:28, 78-84` | 3 attempts, cursor never advanced |
| R3 | One Ctrl+wheel zoom notch snaps the horizontal view back to tick 0 | `ArrangementSurface.tsx:68-76` | `leftTick 28910 → 0` (synthetic *and* real wheel) |
| R4 | End-of-song auto-stop rewinds the playhead to the play origin | `arrangementStore.ts:494-498` + missing `clearEndTimer` in `receiveTransportFrame` | source-verified |
| R5 | Loop enabled with no loop range disables the only end-of-song truth | `arrangementStore.ts:110` | starter has `hasLoopLocation: false` |
| R6 | Every visible clip re-renders on every preview frame of a drag | `ClipView.tsx:75` | source-verified |
| R7 | `startPreview` no longer keeps the transport alive through a lowering hiccup; `play()`'s catch leaves the engine rolling | `arrangementStore.ts:87-112, 489-491` | source-verified |

---

## Must fix before commit (ranked)

1. **R1 — cross-track clip move.** P0, a core DAW gesture is dead. Move gesture ownership above the
   per-clip component, or make the unmount cleanup distinguish "node moved" from "surface gone".
2. **R2 — typed pan is silently swallowed.** P0 lost edit. Delete `suppressPanCommit`; suppress the
   post-drag *click* instead.
3. **R4 + TL-01 DEFECT 2 — end-of-song rewind.** P0 against spec §7 honesty. `clearEndTimer()` in
   `receiveTransportFrame` on `motion === 0`, and give the watchdog a `stopAtEnd()` that cannot seek.
4. **R3 — zoom throws the view to bar 1.** P1, hit on the first zoom gesture. Stop round-tripping
   `leftTick` through `scroll.scrollLeft` in a zoom flush.
5. **R7 — `play()` catch must call `stopPreview()`.** P1 stage-worst-case (UI stopped, engine rolling).
6. **R5 — gate the watchdog on a real loop range, not the UI flag.** P1.
7. **TL-15 — render `transportError`**, and stop reporting `CountIn`/`DeclickTo*` as a failed
   acknowledgement (use `isRollingMotion`, extend the window for count-in). P1.
8. **§7 tempo — wire `setTempo`/`returnToStart` into `TransportStrip` or delete them**; the 20–300
   clamp is currently unreachable. P1 + code-value #8.
9. **§C4 — reject or force-abort overlapping gestures** in `beginGesture`/`apply`. P1.
10. **TL-24 — either use the tokens in `PianoRoll.tsx` or drop the token API**, and restore an explicit
    graph teardown for the audition preview publication. P1 + code-value #8.
11. **R6 — pass `timebase` into `ClipView` as a prop.** P2 but it is a hot-path regression in a
    performance-first surface.
12. **§C3 — route selection-history resets to the originating surface** and bind `Ctrl+Alt+Z` in the
    piano roll. P2.
13. Cleanups: delete `selectedNoteIds`/`selectNotes` from `ArrangementStore`; fix the stale
    `startPreview` doc comment and the de-indented block at `arrangementStore.ts:91-109`; guard
    `onPointerCancel` in `useClipGesture.ts:180`; hoist the `72` lane-height literal.

---

## Must add tests

Ordered by the risk they would have caught.

1. **Cross-track clip move (component or e2e).** Drag a clip into the lane below; assert the clip's
   `trackId` changed, exactly one history entry, one `Ctrl+Z` restores it. Would have caught R1.
2. **Pan typed commit (component).** `MixerDrawer`: click the pan readout, type a value, press Enter →
   assert `pan` changed and cursor +1; then repeat *after* a pointer drag and assert it still lands.
   Would have caught R2. **The existing `MixerDrawer.test.tsx` passes on the old code** — it never
   fires a click and therefore never reaches `onCommit`, so it pins nothing.
3. **End-of-song ordering (store).** Fake timers: play, deliver a `motion: 0` frame, then advance past
   the watchdog → assert `seekArrangement` was **not** called and `playheadTick` did not move.
   Would have caught R4.
4. **Zoom anchor through the DOM (component/e2e).** Scroll to the middle, one Ctrl+wheel notch, assert
   the tick under the cursor is preserved within a tick or two. Would have caught R3.
5. **Loop with no loop location (store).** `setLoopEnabled(true)` on a document with no `loop` location,
   play, advance past the end → assert the transport does not claim to be playing forever.
6. **`play()` failure teardown (store).** `startArrangementPreview` throws → assert `stopArrangementPreview`
   was called.
7. **Count-in / non-1 motion acknowledgement (store).** `pending: 'play'` + `motion: 5` frame, advance
   past 1.5 s → assert no false `transportError`.
8. **Overlapping gestures (store).** `beginGesture('A')`, `previewGesture(v1)`, then `beginGesture('B')`
   + `previewGesture(v2)` + `commitGesture()` → assert A's verbs are not lost and history is coherent.
   Also `apply()` while a gesture is open.
9. **Velocity wheel burst (component).** Three wheel events inside 180 ms → one history entry; a fourth
   after 300 ms → a second entry; unmount mid-burst → exactly one entry, no leaked timer. Currently the
   only TL-22 coverage is the pure `lowerVelocity` unit.
10. **Audition through the production call shape.** Call `auditionPianoRollNote` *without* a token (as
    `PianoRoll.tsx` does) for overlapping voices, then assert on/off parity; plus a pointercancel
    mid-note-drag.
11. **Selection history routing.** A piano-roll note edit + undo → assert the `pianoroll` baseline (not
    `arrangement`) was reset.
12. **`ClipView` wiring for TL-28.** The current test only exercises the pure `clipBarSpan`; render a
    `ClipView` inside a 3/4 arrangement and assert the rendered label.
13. **Tempo clamp on the real path.** `TransportStrip` tempo `onCommit(999)` → assert the document
    lands at 300.

---

## Verified-good (do not re-litigate)

- TL-06 vertical Alt-copy: lands on the hovered track, one undo step (browser-verified).
- TL-05 id persistence across a gesture and a save/reload round-trip (test genuinely fails on old code).
- TL-13 wheel-factor coalescing: exact, to the last significant digit (browser-verified).
- Horizontal clip drag: one history entry, exact `Ctrl+Z` restore (browser-verified).
- Mixer gain fader drag: exactly one `Adjust track gain` entry (browser-verified).
- TL-16, TL-17, TL-18, TL-26, §C2: correct as claimed.
- Zero page errors and zero non-passive console errors across all four browser runs.
- `tsc` and the 386-test suite are green.

## Artifacts

`plans/redesign-new-dna/.scratch/review-ta1/` — `drive.ts`, `drive2.ts`, `drive3.ts`, `drive4.ts`,
`run2.json`, screenshots `00-song.png` … `13-zoom.png`, `dev.log`.
