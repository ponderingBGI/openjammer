# W6-T — the four product gaps the e2e lane proved, closed

**Lane:** W6-T · **Closes:** W6-E2E findings **F1–F4** · **Base:** `5b412f5`
**Owns:** `src/store/{arrangementStore,transportStore}.ts`, `src/components/Canvas/NodeCanvas.tsx`,
`src/components/Arrangement/**`, `src/components/PianoRoll/**`, `src/components/Shell/TransportPillHost.tsx`,
their tests, `docs/timeline.md`, and the four `test.fixme` flips in `e2e/timeline-tlist.spec.ts`.
**Also touched (additively, declared below):** `packages/oj-ui/src/components/TransportPill/TransportPill.tsx`.

All four gaps are fixed, each with a pinning unit test that is **red on the old code** and green
on the new, and each `fixme` is now a live test that passed **3/3** consecutive `--workers=1`
runs plus the whole T-list.

---

## 1. F1 — "stop twice and you are back where you started" was unreachable

### Root cause
`arrangementStore.stop()` always carried the whole behaviour: a second call while `!isPlaying`
seeks back to `playOriginTick`. What made it unperformable was every **caller** asking one
question too few — `if (isPlaying) stop() else play()` — in all three places a human can reach
the transport (`transportStore.toggleGlobalPause`, which is both the pill's click handler and
canvas `Space`; `arrangement.transport`; `pianoroll.transport`). The second press therefore
always played, and `stop()` was called twice only by a unit test.

### Decision, and the spec it comes from
Spec §7: *"**Stop** — `Space` / pill. The playhead **freezes where it is** (honest). A second
Stop returns it to the tick where playback last started. No 'return on stop' preference — the
double-tap covers both idioms with no settings surface."* §4.2 names the same law for the key:
*"`Space` ×2 (stop then stop) — return the playhead to where the last playback started."*

So **the gesture is a three-state grammar, not a toggle**, and the fix belongs at the callers,
not in a forked `stop()`:

| transport is | the press means |
|---|---|
| rolling | **Stop** — freeze exactly here |
| stopped, playhead ≠ where playback last started | **the second Stop** — return there |
| anything else | **Play** |

A further press then plays from the origin it just returned to (stop → rewind → play), which is
what the spec's "no preference" sentence buys: both idioms, no settings surface.

**The honesty problem this created, and what it cost.** With one Play/Stop button, an armed
second Stop would show a play triangle over a press that does *not* play — and
`TransportPillHost`'s own comment already sets the standard here (*"a Stop glyph over a frozen
playhead is the worst lie this component can tell"*). Labels alone were not enough. So
`TransportPill` gained **one optional, default-off prop** (`returnArmed`, with `returnLabel`)
that swaps the glyph and the accessible name. That is a file this lane does not own — declared
in §7 below. It is additive: every existing call site and all 16 `TransportPill` tests are
unchanged and green.

The glyph is a **new solid rewind mark**, deliberately *not* the existing hairline `ReturnGlyph`
— that one sits two controls away in the pill and means "to bar 1". Two identical arrows 40px
apart pointing at different ticks is exactly the thing a hand learns wrong once and then trusts.
Measured side by side in both themes: `F1-pill-return-armed-{light,dark}.png`.

### Change
| File | Line | What |
|---|---|---|
| `src/store/arrangementStore.ts` | 241, 446, 499, 705, 721–723, 733, 741, 754, 835 | `returnToOriginArmed` promoted from a private closure flag to store state, so the callers and the pill can read it and re-render on it. Cleared by `play`, `seek`, `record` and `haltAtEnd` exactly as before. |
| `src/store/arrangementStore.ts` | 914 | **`stopReturnsToOrigin(state)`** — the one exported predicate. |
| `src/store/transportStore.ts` | 23, 64 | `toggleGlobalPause` asks it (pill + canvas `Space`). |
| `src/components/Arrangement/ArrangementSurface.tsx` | 141 | `arrangement.transport` (`Space`) asks it. |
| `src/components/PianoRoll/PianoRoll.tsx` | 602 | `pianoroll.transport` (`Space`) asks it. |
| `src/components/Shell/TransportPillHost.tsx` | 54, 217 | the pill reads the same predicate and passes `returnArmed`. |
| `packages/oj-ui/.../TransportPill.tsx` | 76–86, 132, 414–415, 435–436, 452 | `returnArmed` / `returnLabel` props + `RewindGlyph`. |

`haltAtEnd` still does **not** arm it: the song ending is not a Stop the player pressed, and a
rewind nobody asked for is a musical accident.

### Pinning test — `src/store/__tests__/transportGesture.test.ts` (5 tests)
Drives the shipped caller (`toggleGlobalPause`), never `stop()` directly. Red on the old caller
(`if (arrangement.isPlaying) arrangement.stop()`):

```
 × press ×2 freezes honestly, press ×3 returns to where playback started
 × a fourth press plays again, from the origin it just returned to
 ✓ an end-of-song halt never arms the rewind — the next press plays
 ✓ a seek between the two Stops re-aims the transport, so the press plays
 ✓ is never armed while rolling, and never without a song
AssertionError: the third press must NOT play — it is the second Stop: expected true to be false
Tests  2 failed | 3 passed (5)
```
Green after: `5 passed`.

### e2e
`T27 — Double-stop returns` flipped and passing, driven on the pill exactly as §11 asks
(play from bar 5, click Stop, click again → `Playhead at` returns to bar 5). **3/3.**

### Browser (dev :5235, light + dark, zero console errors) — `f1.json`
| state | `aria-label` | `title` | glyph |
|---|---|---|---|
| stopped at origin | `Play` | `Play (space)` | play-triangle |
| rolling | `Stop` | `Stop (space)` | stop-square |
| second Stop armed | `Return to where playback started` | `… (space)` | **rewind-to-origin** |

and pressing it while armed: `isPlaying` stays `false`, a `seek` is issued to the origin,
`returnToOriginArmed` clears, the button goes back to `Play`.

---

## 2. F2 — canvas `E` / `Q` eaten by the computer-keyboard note row

### Root cause
`NodeCanvas` registered the note row (`ROW_KEYS[1] = q w e r t y u i o p`) in the **same binding
set** as the canvas actions and **before** them; each note entry consumed its key
unconditionally and returned `event.defaultPrevented`, so `canvas.enterNode` never ran. Worse,
`canvas.enterNode` and `canvas.exitLevel` were *also* inside a `if (currentMode === 1)` gate, so
in any keyboard mode they were dead twice over. Installing a rig calls
`focusRig → setCurrentMode(rigKeyboardMode)` so typing plays immediately, and the only preset
carrying a Song (`beat`) also carries a keyboard — so for a first-run player the two conditions
*always* coincided and §4's ladder had a dead rung in exactly the songs with somewhere to go.

### Decision, and the spec it comes from
Spec §4's level-grammar table lists `E` = *"enter selected node"* and `Q` = *"exit node level"*
for **Canvas**, unconditionally. §4.2's "Conflicts resolved" paragraph settles the priority
direction: the `note.*` letter keys are the thing other grammars **shadow**, not the other way
round (*"the arrangement's letters shadow them while the DAW is focused. That is intended"*).

So of the two shapes the brief offered, the spec supports **ordering the canvas actions first
with the note row as fall-through** — and the fall-through has to be real, or it buys one key at
the price of real playing. The rule shipped is therefore:

> `canvas.enterNode` and `canvas.exitLevel` run **before** the note row, and consume their key
> **only when they change level**. `E` when exactly one selected node can be entered (a Song
> opens the arrangement); `Q` when you are inside a node. Otherwise the key falls through and
> plays its note. Config mode (mode 1) is unchanged — both keys always belong to the canvas
> there, because there is no note behind them.

The rejected alternative — scoping the note row to a focused/armed keyboard node — was rejected
because the row is played while looking at the *whole canvas* with nothing focused; requiring
focus would have cost the core playing experience to buy one key. `canvas.transport` (`Space`)
deliberately stays **below** the row: in a keyboard mode `Space` is the sustain pedal, which the
app already documents (`TransportPillHost`'s `spaceHint`).

### Change
| File | Line | What |
|---|---|---|
| `src/components/Canvas/NodeCanvas.tsx` | 787–835 | `canvas.exitLevel` and `canvas.enterNode` lifted out of the mode-1 gate; each `preventDefault()`s only on the path that actually navigates (plus config mode, to preserve today's flash-on-failure feedback and any rebinding). |
| `src/components/Canvas/NodeCanvas.tsx` | 1076, 1089–1095 | new `levelActions` entry group registered **before** `noteActions`; `canvas.enterNode` / `canvas.exitLevel` removed from `regularActions`. |
| `docs/timeline.md` | §"Entering and leaving the DAW" | the rule, the rejected alternative and why. |

### Pinning test — `src/components/__tests__/canvasLevelGrammar.test.tsx` (5 tests)
Renders the real `NodeCanvas`, arms a keyboard mode with an assigned keyboard, and drives
`resolveKeydown`. Red with the note row registered first:

```
 × E over a selected Song node opens the arrangement, even in a keyboard mode
 ✓ E with nothing selected is still the note E — the row is the fall-through
 × Q at the root is still the note Q, and Q inside a node exits the level
 ✓ a node with nothing to enter leaves the key to the note row
 ✓ config mode is unchanged: E and Q belong to the canvas, notes do not exist
AssertionError: the fourth rung of the ladder must be reachable: expected 'canvas' to be 'arrangement'
AssertionError: inside a node Q comes back out: expected 'container-1' to be null
Tests  2 failed | 3 passed (5)
```
Green after: `5 passed`. **Both halves are pinned** — the grammar AND that real playing survives.

### e2e
`T19b — Level grammar: canvas E enters the selected Song node` flipped and passing, on a genuine
first run through the onboarding to the `beat` rig. **3/3.**

### Browser (dev :5235, zero console errors) — `f2f3f4.json` → `f2`
* after the rig installs: `currentMode: 2`, `activeKeyboardId` set — the note row really is armed;
* Song node selected + `E` → `surface: "arrangement"` (`F2-after-E-arrangement.png`);
* nothing selected + `e` → `audioStore.activeKeys` holds `<kb>-1-2`, `q` → `<kb>-1-0`, and the
  surface stays `canvas` — the row still plays (`F2-note-row-still-plays.png`).

---

## 3. F3 — a finger could not move a clip

### Root cause
Nothing in the ruled surfaces declared `touch-action`. `.arrangement-clip` computed `auto`
inside `.arrangement-scroll` (`overflow: auto`), so the moment a touch drag crossed Chromium's
slop the compositor claimed it as a scroll and fired `pointercancel`. The app's own contract was
honoured — §3's "pointer-cancel restores the exact pre-gesture document" — the gesture simply
could never complete.

### Decision, and the spec it comes from
Spec §3's first gesture law is explicit and is the normative list: *"`touch-action: none` on
clips, notes, the ruler, braces, points, faders and lane dividers; `touch-action: pan-x pan-y`
on the scroll container."* §3.2's parenthetical *"(`touch-action:none` on the lane)"* contradicts
it, and the §3 list wins: **the lane is left alone on purpose.** Empty lane ground is how a
finger pans the field, and a surface that cannot be scrolled by touch is worse than a time range
that cannot be drawn by one. Children of a `none` element (trim/fade/slip zones inside a clip)
inherit the restriction by intersection, so one declaration covers each grab target's whole
subtree.

### Change
| File | Line | What |
|---|---|---|
| `src/components/Arrangement/gestureHandles.css` | 26–53 | one documented block: `.arrangement-scroll` → `pan-x pan-y`; `none` on `.arrangement-clip`, `.arrangement-ruler-viewport`, `.arrangement-lane__resize`, `.arrangement-header-resize`, `.arrangement-track__grab`, `.arrangement-automation__point`, `.mixer-strip__fader`, `.mixer-strip__pan`. |
| `src/components/PianoRoll/PianoRoll.css` | 212, 307 | `none` on `.piano-roll__keys` and `.piano-roll__velocity` (the field and scroomer already had it), declared beside the rules they belong to rather than reached into from the Arrangement sheet. |
| `docs/timeline.md` | §"Wave 3 gesture and navigation contract" | "Who owns a finger", including why the lane is exempt. |

### Pinning test — `src/components/Arrangement/__tests__/touchAction.test.ts` (14 tests)
A CSS gate, deliberately: `touch-action` has no observable effect in jsdom (there is no
compositor to lose the gesture to), so the only honest unit-level assertion is that the
declaration exists on each grab target — and is **absent** from `.arrangement-lane`. The
behavioural half is the e2e touch probe. Red before:

```
 × a clip (and therefore its trim, fade and slip zones) takes the gesture away from the compositor
 × the ruler stack — scrub, sections, braces and marks …
 × the lane-height divider …            × the header-width divider …
 × the track reorder grip …             × an automation point …
 × a mixer fader …                      × a mixer pan scrubber …
 × the piano-roll note field …          × the piano-roll key bed …
 × the piano-roll velocity lane …
 ✓ the piano-roll scroomer …            (the one that already had it)
 × the field scroller keeps both axes for a finger on empty ground
 ✓ a lane never claims the finger it does not need
AssertionError: expected null to be 'none'   /   expected null to be 'pan-x pan-y'
Tests  12 failed | 2 passed (14)
```
Green after: `14 passed`.

### e2e
`T39 — Touch parity` flipped and passing: a 10-step CDP touch drag moves the clip and
`scrollTop` does not change. **3/3.**

### Browser (dev :5235, `hasTouch`, zero console errors)
* `f2f3f4.json → f3`: computed `clip: "none"`, `lane: "auto"`, `scroller: "pan-x pan-y"`;
  a finger drag moves `t0.c0` from `startTick 0 → 9600` with `scrollTop`/`scrollLeft` unchanged
  (`F3-touch-drag-in-flight.png`, `F3-touch-drag-committed.png`).
* `f3-scroll.json` — **the half the decision hangs on.** On a zoomed-in field
  (`scrollWidth 2317` vs `clientWidth 1100`), a one-finger horizontal drag on a point whose
  `elementFromPoint` really is `.arrangement-lane` scrolls the field (`scrollLeft 0 → 153`) and
  writes **no** selection. So the trade is exactly the one §3 describes and nothing was lost.
  *(The vertical case reads 0 because `scrollHeight === clientHeight` on Paper Sketch at that
  viewport — there is nothing to scroll vertically, confirmed by a wheel control in the same
  probe. Vertical touch pan is unverified for that reason, not contradicted.)*

---

## 4. F4 — the inline piano roll lost note selection to the lane

### Root cause
Found precisely. `ArrangementSurface`'s field `onPointerDown`
(`ArrangementSurface.tsx:357`) started the lane's range-select for any press inside
`.arrangement-lane`, excluding only `.arrangement-clip`. The inline roll (`PianoRollLane`)
renders **inside** `.arrangement-lane`, in place of the clips, and none of its elements is
`.arrangement-clip` — so every press on a note started *both* gestures. The roll's own handler
ran first and wrote `noteIds`; the lane's `finish()` ran last and either wrote a `timeRange`
(on a drag) or called `clearSelection('arrangement')` (on a click), and BC-23 exclusivity wiped
the notes. Because every roll keyboard action begins `if (!selectedNoteIds.length) return`,
transpose, velocity, nudge, duplicate and delete all went dead after any pointer contact. The
**full** roll surface has no arrangement lane above it, which is exactly why it never showed the
bug.

### Decision, and the spec it comes from
Spec §9: *"the inline lane (220px, in the track) and the surface (`PianoRollSurfaceHost`) are
**the same component** at two heights … it never gets a second interaction model."* An editor
open in a lane owns its own pointers. The fix extends the guard that already exists for clips
rather than adding a second mechanism (`stopPropagation` inside the roll would have been a
parallel path for the same law).

### Change
| File | Line | What |
|---|---|---|
| `src/components/Arrangement/ArrangementSurface.tsx` | 357 | `closest('.arrangement-clip')` → `closest('.arrangement-clip, .piano-roll')`, with the reasoning above it. |
| `docs/timeline.md` | §"Wave 3 gesture and navigation contract" | "An editor open in a lane owns its own pointers". |

`followPlayhead: false` still fires on every press in the field, before the guard — §6's
auto-disarm is untouched.

### Pinning test — `src/components/Arrangement/__tests__/inlineRollSelection.test.tsx` (3 tests)
Renders the real `ArrangementSurface` on Paper Sketch with the inline roll open and drives a real
`pointerdown` + window `pointerup`. Red before:

```
 × clicking a note selects that note, and ArrowUp transposes it
 ✓ a press on the roll's own empty grid never creates an arrangement time range
 ✓ still clears the selection when the press really is on the lane ground
AssertionError: a pointer gesture on a note leaves it selected: expected [] to deeply equal [ 'src:midi:m0.n0' ]
Tests  1 failed | 2 passed (3)
```
Green after: `3 passed`. The first test carries the **product** outcome, not just the selection:
click a note → `noteIds === [that note]` → `ArrowUp` transposes it (pitch +1).

### e2e
`X5b — a pointer gesture on a note keeps it selected in the inline roll` flipped and passing
(click → selected → ArrowUp transposes → drag → still selected, `timeRange` still null). **3/3.**
`X5` still passes unchanged, and its comment now records that its draw-first ordering is no
longer a workaround.

### Browser (dev :5235, light + dark, zero console errors) — `f2f3f4.json → f4`
Both themes: click `src:midi:m0.n0` → `noteIds: ["src:midi:m0.n0"]`, `timeRange: null`;
`ArrowUp` → pitch `57 → 58`. `F4-inline-roll-note-selected-{light,dark}.png`,
`F4-inline-roll-transposed-{light,dark}.png`.

---

## 5. Verification — every command, pasted

All on `5b412f5` + this lane's working tree. Playwright under **node**, one Chromium.

```
$ bun run test:run -- src/components/Arrangement src/components/PianoRoll src/store \
      src/keymap src/components/__tests__ src/song
 Test Files  75 passed (75)
      Tests  821 passed (821)

$ bunx tsc --noEmit -p tsconfig.app.json
TSC OK                                        (no output)

$ bunx eslint src
ESLINT src OK                                 (no output)

$ bunx eslint packages/oj-ui/src
ESLINT oj-ui OK                               (no output)

$ bun run test:run -- packages/oj-ui/src/components/TransportPill
      Tests  16 passed (16)

$ git diff --check
diff-check exit=0                             (only pre-existing repo-wide CRLF warnings)
```

### The four flipped e2e tests, 3× at `--workers=1`

Run against the production build on a **lane-private** `vite preview`
(`.scratch/w6t/playwright.w6t.config.ts`, port 5243). Reason in §7.

```
===== FLIPPED RUN 1 =====
  ok 1 › T19b — Level grammar: canvas E enters the selected Song node (3.6s)
  ok 2 › T27 — Double-stop returns (1.4s)
  ok 3 › T39 — Touch parity (1.1s)
  ok 4 › X5b — a pointer gesture on a note keeps it selected in the inline roll (1.3s)
  4 passed (8.1s)
===== FLIPPED RUN 2 =====
  ok 1 › T19b … (3.7s)   ok 2 › T27 … (1.5s)   ok 3 › T39 … (1.1s)   ok 4 › X5b … (1.4s)
  4 passed (8.6s)
===== FLIPPED RUN 3 =====
  ok 1 › T19b … (3.4s)   ok 2 › T27 … (1.3s)   ok 3 › T39 … (1.1s)   ok 4 › X5b … (1.3s)
  4 passed (7.9s)
```

### Wave-1 regression set — the whole T-list, `--workers=1`

```
$ node node_modules/@playwright/test/cli.js test --config .scratch/w6t/playwright.w6t.config.ts \
      e2e/timeline-tlist.spec.ts --workers=1
  ok 46 › X1 — a cross-track drag ghost never paints on the header or the ruler (1.7s)
  ok 47 › X2 — a drag past the right edge auto-scrolls the field (2.6s)
  ok 48 › X3 — lane divider and header-width handles are view state, not history (1.5s)
  ok 49 › X4 — the sky band never occludes the armed edit mode at 1024 or 900 (941ms)
  ok 50 › X5 — the inline roll draws, transposes and moves, and Ctrl+Z reaches from inside it (1.3s)
  ok 51 › X5b — a pointer gesture on a note keeps it selected in the inline roll (1.2s)
  ok 52 › X6 — an agent edit that arrives mid-gesture queues, then lands as its own undo (1.5s)
  ok 53 › X7 — the loop brace moves and resizes, and Ctrl+M drops a marker at the playhead (1.5s)
  ok 54 › X8 — a section chip renames in place, in one undo step (896ms)
  5 skipped
  49 passed (1.2m)
```

**49 passed · 5 skipped · 0 failed.** The named Wave-1 regression items are all green
(X1 cross-track ghost, X2 the >450px auto-scroll drag, X7 loop-brace move/resize + `Ctrl+M`,
X6 the queued agent edit), and so are `T18`/`T19` (level grammar), `T26`/`T28`/`T30` (transport),
`T43`/`T44` (teardown + nested transaction). The 5 skips are §11's gates owned by unit tests.

### Browser probes and artifacts
`plans/redesign-new-dna/.scratch/w6-t/` — 17 PNGs + `f1.json`, `f2f3f4.json`, `f3-scroll.json`.
Every probe run reported `errors: []` (both `console` and `pageerror` were collected). Scripts:
`.scratch/w6t/{lib,probe-f1,probe-f2f3f4,probe-f3-scroll}.mjs`. Dev server on 5235, stopped;
the private preview on 5243, stopped. No stray servers of this lane remain.

---

## 6. Docs

`docs/timeline.md` gained three passages, because a behaviour nobody can find is only half fixed:

* **§"Entering and leaving the DAW"** — "`E` in, `Q` out — in every mode, with the note row as
  the fall-through": the rule, why the note row is the fall-through rather than the gate, and the
  scoping alternative that was rejected.
* **§"The song document and playback"** — "The transport gesture is three states, not a toggle":
  the table, the shared predicate, what clears the arm, and why there is no preference to find.
* **§"Wave 3 gesture and navigation contract"** — "Who owns a finger" (the whole `touch-action`
  split, including why `.arrangement-lane` is deliberately exempt) and "An editor open in a lane
  owns its own pointers" (F4's law, with the full-surface roll as the tell).

---

## 7. Risks and the one boundary crossed

1. **`packages/oj-ui/TransportPill.tsx` is not this lane's file.** The brief allowed the pill's
   *title/hint*; a title alone would have left a play triangle over a press that rewinds, which
   the component's own doc comment calls the worst lie it can tell. The change is one optional
   prop pair defaulting to today's behaviour plus one new glyph — no existing call site, class,
   `aria-label`, or test changes, and `TransportPill.test.tsx` is 16/16 green. **W6-UI should be
   told, and can revert to a label-only treatment by dropping `returnArmed` from
   `TransportPillHost.tsx:217` if it disagrees with the glyph.**
2. **"A third press stays" is implemented as "a third press plays, from the origin it just
   returned to."** `stop()` itself remains idempotent (a third *`stop()`* call is a no-op — the
   arm is already cleared), but the shipped **gesture** at that point is an honest Play, because
   the button has already gone back to a play triangle. Stop → rewind → play is the loop a
   performer wants; if the intent was literally "the third press does nothing", that is a
   one-line change in `stopReturnsToOrigin`'s callers, but it would need a button that says so.
3. **F2 changes what `E` does in a keyboard mode when exactly one enterable node is selected** —
   it navigates instead of playing an E. That is the spec's grammar and the fall-through keeps
   the common case (nothing selected) playing, but it is a real behaviour change a jamming player
   could meet. Same for `Q` while inside a node level. Both are documented.
4. **Touch was proven through CDP `Input.dispatchTouchEvent` in a `hasTouch` context**, which is
   the closest a headless browser gets to a finger. It reproduces Chromium's compositor behaviour
   faithfully enough to have caught the bug, but **the fix should still be confirmed on real touch
   hardware** — particularly the lane-pan/clip-drag boundary, which is a feel question.
5. **Vertical one-finger pan on empty lane ground is unverified**, not contradicted: Paper Sketch
   at the probe viewport has `scrollHeight === clientHeight`, so nothing could scroll vertically
   either way (a wheel control in the same probe confirms it). A taller song, or the
   `hundredTracks` fixture, would close it.
6. **Two lanes were editing the tree throughout.** Mid-session, another lane's in-flight state
   broke `tsc -b` on *its own* files (`LibraryNode.tsx` + two of its tests, `updateNodeData`
   gaining a third argument in `a28f710`); that has since landed and `bun run build` is green on
   `5b412f5`. Separately, the shared `playwright.config.ts` owns port 4173 with
   `reuseExistingServer: false`, and two concurrent runs on it kill each other's server
   mid-suite — which is what produced one 27-failure run whose failures were all `page.goto`.
   Every number in §5 comes from the lane-private config on 5243 for that reason; the config
   changes nothing but the port and lives in `.scratch/`.
7. **The four flipped tests still lean on `e2e/journeys/support.ts`**, which lane W6-E2E-b is
   editing. One early `T19b` failure was in `completeOnboarding`'s
   `expect('.ob-card').toHaveCount(0)` under heavy machine load and did not recur across the
   final 3 + 1 runs; it is worth knowing that the helper is the shared dependency if T19b ever
   flakes again.

---

## 8. What could NOT be verified here — the founder's call

* **Feel.** Nothing in this lane listened. The transport grammar is asserted as *state and
  label*, never as "the rewind sounded right"; F3 is asserted as *the document moved and the
  field did not scroll*, never as "the drag tracked my finger". §7's double-tap, in particular,
  is a **rhythm** decision — whether a second press half a second later should still rewind, or
  whether it should feel like a double-tap window — and only a human with audio playing can
  settle it. The shipped rule is stateful, not timed, which matches the spec's wording and the
  store's existing contract test.
* **The engine never answers headlessly.** No `TransportFrame` comes back in Chromium here, so
  the browser probes show `transportPending: 'seek'` after the second Stop rather than an
  acknowledged playhead; the e2e uses `installEngineProbe` to mirror the frames a live W3 worklet
  would send. These prove the **UI's** transport contract, never the engine's timing. Latency and
  dropouts must not be inferred from a green run.
* **Real touch hardware** (risk 4) and **the native tier** — everything here is the browser
  executor.

---

# 9. F6 — `T33` is ~1-in-5 flaky. Diagnosis: harness, not product.

Filed by lane W6-E2E-b against this lane's in-flight work (`W6-E2E-REPORT.md` §F6):
`T33 — Draw + overlap is one batch` intermittently leaves `history().cursor` where it was —
the draw never commits. Reproduced, diagnosed to the line, and the one-line hardening is
**verified 16/16**. No product change was needed and none was made.

## 9.1 Reproduced

```
$ node node_modules/@playwright/test/cli.js test --config .scratch/w6t/playwright.w6t.config.ts \
      e2e/timeline-tlist.spec.ts --workers=1 -g "T33" --repeat-each=16
  Error: expect(received).toBe(expected)   Expected: 1   Received: 0
  - Timeout 5000ms exceeded while waiting on the predicate
      867 |  await expect.poll(() => historyLength(page)).toBe(cursor + 1);
  1 failed · 15 passed (58.1s)
```

Instrumented, on a **fresh page per repeat** through the shipped helpers
(`.scratch/w6t/f6.spec.ts`, dev server so `/src/**` modules import), across **32 unsettled
attempts**: **7 refused / 25 committed — 21.9%**. Raw rows:
`plans/redesign-new-dna/.scratch/w6-t/f6-attempts-motion.jsonl`, `…-rmconfig.jsonl`.

## 9.2 Root cause, measured

Three facts, from the 32 instrumented attempts:

1. **Every one of the 25 commits drew the same note: `{tick: 480, pitch: 57}`.**
2. **Every one of the 7 refusals resolved to `snappedTick === 0`, and the pitches already
   present at tick 0 are exactly `[57]`** — so `drawAt` hit
   `if (midiSource.notes.some((n) => n.tick === sourceTick && n.pitch === pitch)) return;`
   (`PianoRoll.tsx:376`), BC-30's *"an exact time+pitch duplicate is never minted"*. That is
   the **only** zero-verb path in `drawAt`, and it explains the signature exactly: the note
   count is unchanged, nothing is drawn, and `history().cursor` never moves.
3. So the whole outcome is one binary question: does the aim resolve to the first note's
   **end** anchor (480 → a real draw) or its **start** anchor (0 → a duplicate, refused)?

And the thing that decides it is geometry that is still moving:

| | `fieldLeft` at measurement | transform scale | refused |
|---|---|---|---|
| as `T33` runs today | **67.540 … 74.383 — a 6.84px spread**, 7 distinct values | never 1 (1.00287 … 1.015) | **7 / 32** |
| with the entry animation settled | **76.000 on every attempt — 0px spread** | exactly 1 | **0 / 16** |

`.surface-transition-in` animates the surface `scale(1.015) → scale(1)` over 180ms after a
60ms delay (`ArrangementSurface.css:78`), and `openRollSurface` waits only for the roll and
its first note to be *visible* — so the whole gesture happens while the surface is still
sliding. `xToTick` reads `field.getBoundingClientRect().left` **at handler time**, on a later
frame than the `boundingBox()` the test aimed with.

The margin is tiny by construction. At the default zoom `pxPerTick = 0.010091`, so **1px ≈ 99
ticks**. The first note is at tick 0 and is `480 × 0.010091 = 4.84px` wide, and `T33` aims at
`box.x + box.width / 2` — about **5px from the field's left edge**. The flip from "nearest
anchor 480" to "nearest anchor 0" needs only **2.42px** of drift. A 6.84px slide clears that
comfortably, about one time in five.

The settled value is the corroboration: `fieldLeft` lands on **exactly 76.000**, which is
`SCROOMER_WIDTH (12) + SURFACE_KEY_WIDTH (64)` — `geometry.ts:5` and `PianoRoll.tsx:100`,
**both untouched by this lane**. 76 is where the field's left edge belongs; every other value
observed is the animation, not the layout.

**This is exactly W6-E2E's own harness fix H1, unapplied to a second helper.** H1's words:
*"`.surface-transition-in` animates `transform: scale(1.015) → scale(1)` … and
`getBoundingClientRect` reports the scaled box … Fixed by a new `settleField()` … it now runs
inside `openPaperSketch`, so every T-item inherits it."* `openRollSurface` is a **local helper
in `timeline-tlist.spec.ts`** and never got it.

## 9.3 Is it W6-T's regression? No — and here is why, with its limits stated

**Structurally, the causal chain contains no file this lane touched:**
`openRollSurface` (no settle) → `.surface-transition-in` (`ArrangementSurface.css`, untouched)
→ `xToTick` / `snapTimeline` / `drawAt` (`PianoRoll.tsx:222`, `editingContextStore.ts:126`,
`PianoRoll.tsx:371` — all untouched). This lane's entire `PianoRoll.tsx` diff is **two lines**:
the `stopReturnsToOrigin` import and the `pianoroll.transport` guard. Its `PianoRoll.css` diff
is **two `touch-action: none` declarations**, which cannot move a `getBoundingClientRect`. F4's
guard is on `.arrangement-timeline-content` and `T33` drives the **full roll surface**, which
is not inside `.arrangement-lane` at all — and the gesture is a synthetic `dblclick` that
dispatches no `pointerdown`, so that guard cannot run. F1 and F2 touch the transport and the
canvas key order; neither is on this path, and neither can move the roll's field edge, which is
two constants wide.

**Statistically, "4/4 green before" is not evidence of a regression.** At the measured 21.9%
refusal rate, `P(4 consecutive passes) = 0.373` — better than one chance in three. W6-E2E-b's
own "1 failure in 6" has probability `0.382` under the *same* rate. The two observations are
indistinguishable; both are what a long-standing ~1-in-5 flake looks like from a handful of
samples.

**The limit, stated plainly:** I did **not** run an instrumented build with this lane's changes
reverted. The claim rests on the causal chain, the 76.000 constant, and the base rate — not on
a measured A/B. If that is not enough for the merge gate, the A/B is one `git worktree` at
`5b412f5` away and I will run it on request.

## 9.4 The one-line hardening — verified, not applied

Per the coordinator's instruction I did **not** edit the shipped spec. The change was proved in
a scratch copy of the same test (`.scratch/w6t/f6.spec.ts`, `W6T_SETTLE=1`):

```
$ W6T_SETTLE=1 node node_modules/@playwright/test/cli.js test \
      --config .scratch/w6t/playwright.f6.config.ts --workers=1 --repeat-each=16
  16 passed (53.5s)
```

`fieldLeft` = 76.000 on all 16, scale = 1 on all 16, 0 refusals. Apply to `openRollSurface` in
`e2e/timeline-tlist.spec.ts:143`:

```ts
async function openRollSurface(page: Page, clip: Locator): Promise<void> {
    await clip.click({ position: { x: 40, y: 34 } });
    await focusArrangement(page);
    await page.keyboard.press('e');
    await expect(page.locator('[data-surface-root="pianoroll"]')).toBeVisible();
    await expect(page.locator('[data-surface-root="pianoroll"] .piano-roll-note').first()).toBeVisible();
    // H1, applied here too: `.surface-transition-in` scales the surface 1.015 -> 1,
    // so every box measured during it is a moving target — and T33 aims 5px from
    // the field's left edge, where 2.4px of drift changes which anchor snap picks.
    await page.locator('[data-surface-root="pianoroll"]').evaluate(async (element) => {
        await Promise.all(element.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => undefined)));
    });
}
```

It hardens `T18`, `T19`, `T33`, `T34`, `T35` and `T36` — every T-item that goes through this
helper — not just `T33`. Say the word and I will land it; it is my file.

**Better still, and cheap:** `T33`'s aim is knife-edged *by construction* — the midpoint of a
4.8px note, equidistant between two magnetic anchors, 5px from the field edge. Even settled it
has no margin to spare. A second, independent hardening is to aim somewhere with room:
`clientX: box.x + box.width + 12` (comfortably past the note's end anchor) still tests exactly
what BC-30/BC-34 are about — draw over an existing note, one batch, truncate not duplicate —
with about a grid unit of slack instead of 0.16px. That is a judgement call for the spec's owner.

## 9.5 Two things this turned up, reported not changed

1. **The duplicate refusal is silent.** `drawAt` returns without a word when the cell is already
   occupied, while its sibling rejection right above it says *"The note would extend beyond this
   clip."* via `setRejection`. BC-30 is right to refuse; the silence is the problem — a player
   who double-clicks and sees nothing has been told nothing. One line
   (`setRejection('There is already a note there.')` on that branch) would close it. **Not
   applied**: it is outside F6's remit, it is a new visible string in a suite another lane has
   just certified green, and it would not have changed a single outcome above.
2. **For a human this is not a hazard.** A person clicks what they see, and the click
   coordinates and the handler's `getBoundingClientRect` happen in the same task — so the error
   is bounded by one frame of the slide, about 0.7px at 8px/180ms, against a 2.4px margin. The
   amplification is Playwright-specific: `boundingBox()` is a separate round trip hundreds of
   milliseconds before the dispatch. **This is not a race a fast-moving human can lose**, which
   is the question the coordinator rightly asked.

## 9.6 F6 artefacts

`plans/redesign-new-dna/.scratch/w6-t/` — `f6-attempts-motion.jsonl` (16),
`f6-attempts-rmconfig.jsonl` (16), `f6-attempts.jsonl` (16, settled), `f6-1440x900.json`,
`f6-1280x720.json`, `f6-entry-animation.json`. Scripts: `.scratch/w6t/{f6.spec.ts,
playwright.f6.config.ts, playwright.f6rm.config.ts, probe-f6.mjs, probe-f6b.mjs, probe-rm.mjs}`.
Every probe reported `errors: []`. **No `src/**` file changed during this investigation** —
`git status` is byte-identical to §5's.

## 9.7 Outcome — both finishers landed

### 1. The settle, in `openRollSurface` (`e2e/timeline-tlist.spec.ts:143`)

Applied verbatim as proposed, with the measurement that justifies it written down beside
it — the 6.84px slide, the 76px true edge, the 2.42px flip margin — so the next person to
read the helper knows the wait is load-bearing, not defensive.

```
$ node node_modules/@playwright/test/cli.js test --config .scratch/w6t/playwright.w6t.config.ts \
      e2e/timeline-tlist.spec.ts --workers=1 --repeat-each=8 -g "T18|T19|T33|T34|T35|T36"
  56 passed (2.2m)
```

Seven tests × 8 repeats (the `T19` pattern also catches `T19b`), **0 failed, 0 flaky** — against
the 21.9% refusal rate the same helper produced before. Every T-item that goes through
`openRollSurface` is hardened, not just `T33`.

### 2. The duplicate refusal now speaks (`src/components/PianoRoll/PianoRoll.tsx:376`)

```ts
// BC-30: an exact time+pitch duplicate is never minted. Refusing is right;
// refusing SILENTLY was not — a deliberate gesture that produces nothing and
// says nothing reads as a broken editor, and the branch immediately above it
// has always said why. Report without stealing focus: the same 1.2s
// `role="status"` line, no dialog, no sound, nothing to dismiss.
if (midiSource.notes.some((note) => note.tick === sourceTick && note.pitch === pitch)) {
    setRejection('That note is already there.');
    window.setTimeout(() => setRejection(''), 1200);
    return;
}
```

It reuses the mechanism its sibling rejection already owns (`setRejection` → the
`.piano-roll__rejection` `role="status"` line, `PianoRoll.tsx:684`), so there is one way a
refusal is reported in this surface, not two. BC-30 is unchanged: still zero verbs, still
nothing minted, still no history entry.

**Pinned** by three tests appended to `src/components/PianoRoll/__tests__/PianoRoll.test.tsx`.
The occupied cell is derived by inverting the roll's own geometry off a rendered note's inline
style (`left` = `(tick − leftTick) × pxPerTick`, `top` = `(range.hi − pitch) × rowHeight`), so
the aim is that note's exact tick and pitch by construction rather than by pixel luck — the
lesson from §9.2 applied to the test that pins its cousin.

Red on the silent code:

```
 × drawing on an occupied cell mints nothing, records nothing, and says why
 × reports without stealing focus, and clears itself
 ✓ erase the occupant and the identical cell draws — the guard is about duplicates only
AssertionError: expected undefined to be 'That note is already there.'
AssertionError: the refusal is reported: expected null not to be null
Tests  2 failed | 11 passed (13)
```

Green after: `13 passed`. The third test is the control, and it is deterministic rather than
hopeful: it refuses on the occupied cell, removes the occupant through the shared `eraseNotes`
op, lets the 1.2s chip expire, and then draws on the *identical* cell — proving the guard is
about duplicates and that a successful draw says nothing.

### 3. The knife-edge aim — left for the spec owner, as reported

`T33` still aims at the midpoint of a 4.8px note, equidistant between two magnetic anchors.
Settled, that is stable (56/56 above); it simply has no margin to spare, and §9.4's suggestion
(`clientX: box.x + box.width + 12`) stands as a proposal only. Not re-aimed.

### 4. Final verification — every command, pasted

```
$ bunx tsc --noEmit -p tsconfig.app.json
TSC OK                                        (no output)

$ bunx eslint src
ESLINT src OK                                 (no output)

$ bunx eslint e2e
eslint e2e exit=0                             (no output)

$ bun run test:run -- src/components/Arrangement src/components/PianoRoll src/store \
      src/keymap src/components/__tests__ src/song
 Test Files  75 passed (75)
      Tests  824 passed (824)          ← 821 + the three new duplicate-refusal tests

$ bun run test:run -- src/components/PianoRoll/__tests__/PianoRoll.test.tsx
      Tests  13 passed (13)

$ bun run build
(clean)

$ node …/cli.js test --config .scratch/w6t/playwright.w6t.config.ts \
      e2e/timeline-tlist.spec.ts --workers=1 --repeat-each=8 -g "T18|T19|T33|T34|T35|T36"
  56 passed (2.2m)                     ← 0 failed, 0 flaky

$ node …/cli.js test --config .scratch/w6t/playwright.w6t.config.ts \
      e2e/timeline-tlist.spec.ts --workers=1
  5 skipped · 49 passed (1.4m)         ← the whole T-list, Wave-1 regression set included

$ node …/cli.js test … -g "T19b|T27|T39|X5b"   ×3
  4 passed (7.8s) · 4 passed (8.0s) · 4 passed (7.9s)
```

The unit count moves 821 → 824 (the three new tests); nothing else changed. The full T-list is
unchanged at 49 passed / 5 skipped / 0 failed, so the new `role="status"` line disturbs no
existing assertion. Servers stopped; no W6-T process is listening on 5235 or 5243.

**F6 is closed.** The flake was the harness — a helper that measured a moving surface — and it
is fixed at the helper. The product change it turned up (a refusal that said nothing) is a
one-line honesty fix behind three tests, and it changes no law: BC-30 still refuses, still
silently as far as the document is concerned, and now audibly as far as the player is.
