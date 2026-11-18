# W6-E2E — the §11 acceptance list, driven for real

**Lane:** W6-E2E · **Owns:** `e2e/**` (additive), `playwright.config.*`, this file.
**Never touched:** any `src/**` file. Four tests are `test.fixme` over product gaps
rather than patched around; each carries its evidence.

---

## 1. What shipped

| File | What it is |
|---|---|
| `e2e/timeline-tlist.spec.ts` | one `test()` per §11 T-item (`T1`–`T44`), plus `X1`–`X8` for the redesign behaviours §11's table does not number, plus `T19b` / `X5b` which isolate two product gaps |
| `e2e/journeys/J-onboarding.spec.ts` | the first run: three steps over the blurred studio, skip **and** complete, keyboard-only, reduced motion, persistence, once-only |
| `e2e/visual-baselines.spec.ts` | 18 `test.skip` shells — 6 surfaces × {light, dark, reduced-motion} — with the enabling recipe in the header |
| `e2e/journeys/support.ts` | additive helpers only: `settleField`, `visibleSurface`, `completeOnboarding`, `onboardingOverlay`, `openSongRig`, `songEndTick` (on top of the T-list vocabulary the earlier pass added) |

`playwright.config.ts` is **unchanged** — no reason arose to touch it.

---

## 2. T-item → test → status

`spec` = `plans/redesign-new-dna/02-timeline-interaction-spec.md` §11.
All tests live in `e2e/timeline-tlist.spec.ts` unless noted, and every one is named
`T<n> — <the spec's own title>` — so `…` in the Test column means "the same title again".

| T | Spec title | Test | Status |
|---|---|---|---|
| T1 | One gesture = one undo | `T1 — One gesture = one undo` | pass |
| T2 | Drag threshold | `T2 — Drag threshold` | pass |
| T3 | Escape aborts | `T3 — Escape aborts` | pass |
| T4 | Magnetic snap radius | `T4 — Magnetic snap radius` | pass |
| T5 | Snap override | `T5 — Snap override` | pass |
| T6 | Axis lock (BC-12) | `T6 — Axis lock (BC-12)` | pass |
| T7 | Copy-drag threshold | `T7 — Copy-drag threshold` | pass |
| T8 | Trim preserves the source window (BC-17) | `T8 — …` | pass |
| T9 | Slip (BC-19) | `T9 — Slip (BC-19)` | pass |
| T10 | Loop brace creation | `T10 — Loop brace creation` | pass *(was failing; harness fix H1)* |
| T11 | Marker lifecycle | `T11 — Marker lifecycle` | pass |
| T12 | Empty-lane drag selects time | `T12 — …` | pass |
| T13 | Alt+drag on empty = marquee | `T13 — …` | pass |
| T14 | Draw a clip | `T14 — Draw a clip` | pass |
| T15 | Selection exclusivity (BC-23) | `T15 — …` | pass |
| T16 | Delete preserves the clipboard (BC-27) | `T16 — …` | pass |
| T17 | Range delete keeps outside material (BC-25) | `T17 — …` | pass |
| T18 | Space plays from the piano-roll surface | `T18 — …` | pass |
| T19 | Level grammar | `T19 — Level grammar` (three rungs) | pass |
| T19b | …the fourth rung: canvas `E` → Song node | `T19b — …` | **`fixme` — finding F2** |
| T20 | Text-field guard | `T20 — Text-field guard` | pass |
| T21 | Ctrl+wheel zooms around the cursor | `T21 — …` | pass *(harness fix H2)* |
| T22 | Wheel scrolls the piano roll | `T22 — …` | pass |
| T23 | Follow-playhead disarms on touch | `T23 — …` | pass *(was failing; harness fix H3)* |
| T24 | Pixel-lock | `T24 — Pixel-lock` | pass |
| T25 | Virtualization | `T25 — Virtualization` | pass |
| T26 | Honest stop at the end | `T26 — …` | pass *(was failing; harness fix H4)* |
| T27 | Double-stop returns | `T27 — Double-stop returns` | **`fixme` — finding F1** |
| T28 | Tempo scrub = one verb | `T28 — …` | pass |
| T29 | Record needs an arm | `T29 — …` | pass |
| T30 | Edit while playing holds the sound | `T30 — …` | pass |
| T31 | Reduced motion | `T31 — Reduced motion` | pass |
| T32 | Empty state paths | `T32 — Empty state paths` | pass |
| T33 | Draw + overlap is one batch (BC-30/34) | `T33 — …` | pass |
| T34 | Multi-note move is one clamped delta (BC-31) | `T34 — …` | pass |
| T35 | Velocity / transpose reject wholly (BC-33/35) | `T35 — …` | pass |
| T36 | Quantize (BC-37) | `T36 — Quantize (BC-37)` | pass |
| T37 | Agent parity | `skip` → `src/ai/__tests__/piToolParity.test.ts` | owned elsewhere |
| T38 | Verb replay convergence | `skip` → `e2e/journeys/J3-editors-hour.spec.ts` | owned elsewhere |
| T39 | Touch parity | `T39 — Touch parity` | **`fixme` — finding F3** |
| T40 | Contrast floors | `skip` → `Arrangement/__tests__/contrast.test.ts` | owned elsewhere |
| T41 | Token purity | `skip` → `Arrangement/__tests__/tokenLiteralGate.test.ts` | owned elsewhere |
| T42 | Ruler ladder | `skip` → `song/__tests__/rulerMarks.test.ts` + `rulerStack.test.tsx` | owned elsewhere |
| T43 | Surface teardown | `T43 — Surface teardown` | pass |
| T44 | Gesture transaction (BC-01) | `T44 — …` | pass |

Five T-items are `test.skip` on purpose. §11 names them as gates over pure functions,
CSS files and one existing journey — T38's own row says *"already asserted; keep as the
regression gate"*. Re-implementing them here would fork a gate the covenant says to
extend, not duplicate. Each `skip` names its owner in the body.

### The redesign behaviours §11 does not number

| X | What it holds to account | Status |
|---|---|---|
| X1 | a cross-track drag ghost never paints on the header or the ruler (intersected with `[data-field-overlay]`, so an ancestor's `overflow:hidden` cannot flatter it) | pass |
| X2 | a drag past the right edge auto-scrolls the field — measured **>450px** | pass |
| X3 | lane divider + header-width handles: plain drag = one lane, **Alt** = every lane, **dblclick** = fit to 72px, and none of it is history | pass |
| X4 | the sky band never occludes the armed edit mode at **1280 / 1024 / 900** — zero overlap area, armed control is topmost by `elementFromPoint`, utility cluster unclipped | pass |
| X5 | the inline roll draws, transposes and moves, and `Ctrl+Z` reaches from inside it — three edits, three steps, byte-identical restore | pass |
| X5b | …and a pointer gesture on a note keeps it selected | **`fixme` — finding F4** |
| X6 | an agent edit arriving mid-gesture queues, then lands as its own undo (`cursor + 2`) | pass |
| X7 | the loop brace moves and resizes (length preserved on move), and `Ctrl+M` drops a marker | pass |
| X8 | a section chip renames in place, in one undo step | pass |

### `J-onboarding.spec.ts`

| Test | Holds |
|---|---|
| three steps over the blurred studio… | `01/03`→`03/03`, the `Step n of 3` live region, all three options + skip, `body.oj-onboarding-open`, `.surface-layer` and `.oj-topbar` computed `filter: blur(5px)`, `pointer-events: none`, and Back preserving the answer |
| completing it stores…installs a rig… | nothing in `oj-onboarding-v1` before the last tap; `{exp:'pro',goal:'beat',theme:'light'}` after; overlay gone; blur gone; the `beat` rig's Song node on the canvas |
| a skip keeps the answers already given | answer step 1 only → skip → `exp:'pro'` survives, `goal` defaults to `jam`, rig still installs |
| Escape is a skip too | `Escape` finishes with `exp:'some'` kept |
| the whole run is reachable from the keyboard alone | focus lands on the first option unasked; Tab is trapped inside `.ob-card` over 6 presses; `3`,`2`,`1` completes and stores |
| under reduced motion nothing blurs and nothing animates | `filter: none` on the studio, `backdrop-filter: none` on `.ob`, `animation-name: none` on the card and the options — and the run still completes |
| it runs once | reload → no overlay, answers intact |

Deliberately **not** asserted: that the beat rig starts rolling. `OnboardingHost` waits
for `engineHealth === 'LIVE'`, and headless Chromium never produces the `TransportFrame`
that would set it. Claiming "it plays" here would be claiming something this environment
cannot see (see §6).

---

## 3. Findings — product gaps, with evidence

Each is reproduced by the `test.fixme` named beside it; artifacts are in
`plans/redesign-new-dna/.scratch/w6-e2e/`.

### F1 — "Stop twice and you are back where you started" is unreachable from the product
*Spec §7 / T27. Severity: medium — a named §7 behaviour no player can perform.*

`arrangementStore.stop()` implements it in full: a second call while `!isPlaying` seeks
back to `playOriginTick` (`src/store/arrangementStore.ts:708-716`). Every caller guards
it with the same toggle, so the second press always **plays**:

* `transportStore.toggleGlobalPause()` — the pill's only handler:
  `if (arrangement.isPlaying) arrangement.stop(); else arrangement.play();`
  (`src/store/transportStore.ts:54-65`)
* `arrangement.transport` (Space) — `src/components/Arrangement/ArrangementSurface.tsx:137`
* `pianoroll.transport` (Space) — `src/components/PianoRoll/PianoRoll.tsx:602`

A repo-wide search finds no other caller; the only place `stop()` is called twice is
`src/store/__tests__/arrangementStore.test.ts`. Measured on the pill, three presses:

| after | `aria-label` | `Playhead at` |
|---|---|---|
| play, ~1s | `Stop` | `4.2.153` |
| first Stop | `Play` | `4.2.691` (frozen where it was — correct) |
| second press | `Stop` | `6.4.499` (**rolling again**, not returned) |
**Evidence:** `.scratch/w6-e2e/findings.json` → `F1`,
`F1-after-first-stop.png`, `F1-after-second-press.png`.
**Fix shape (product decision, not a test fix):** a dedicated Stop affordance, or a
`transport.returnToOrigin` action bound to the second press.

### F2 — canvas `E` is eaten by the computer-keyboard note row
*Spec §4 level grammar / T19b. Severity: medium — one rung of the ladder is dead in
exactly the rigs that have somewhere to go.*

`NodeCanvas` registers the note row (`ROW_KEYS[1] = q w e r t y u i o p`) in the **same
binding set** as the regular canvas actions and **before** them
(`src/components/Canvas/NodeCanvas.tsx:1031-1045`); each note entry's `run` returns
`event.defaultPrevented`, so under `audioStore.currentMode > 1` it consumes the key and
`canvas.enterNode` (line 932) never runs. Every preset rig carrying a Song (`beat`, the
only one — `src/rigs/presets.ts:162`) also carries a keyboard, so the two conditions
always coincide.

Measured on a real first run of the `beat` rig, with the Song node selected
(`.song-node` has `is-selected`): one press of `e` produces
`__openjammerE2E.noteEvents() === [{type:'on',row:1,keyIndex:2}, {type:'off',…}]`
and the visible surface stays `canvas`. `Ctrl+A` on the same canvas works, so the
binding set is live — only this key is intercepted. The node's own **Open** button does
reach the arrangement, so the destination exists.
**Evidence:** `.scratch/w6-e2e/findings.json` → `F2`,
`F2-canvas-E-stays-on-canvas.png`, `probe13.mjs`.
**Note:** `Q` sits on the same row and is at the same risk on the canvas.

### F3 — a finger cannot move a clip: no `touch-action` anywhere in the field
*Spec §3 / T39. Severity: high for touch hardware — the whole timeline is
pointer-only in practice.*

Measured computed styles: `.arrangement-clip` → `touch-action: auto`,
`.arrangement-lane` → `touch-action: auto`, inside `.arrangement-scroll` →
`overflow: auto`. So the moment a touch drag crosses Chromium's slop the compositor
claims it as a scroll. The event trace of a 12-step, 96px touch drag on `t0.c0`:

```
pointerdown(touch) → .arrangement-clip gains "is-dragging"
pointercancel(touch)
lostpointercapture
touchend
```

and `t0.c0.startTick` is unchanged (0 → 0). The app's own contract is honoured —
§3's "pointer-cancel … restore the exact pre-gesture document" — the gesture simply
can never complete. Two stream shapes were tried (`touchEnd` with and without the
released point); both cancel identically.
**Evidence:** `.scratch/w6-e2e/findings.json` → `F3`, `F3-touch-drag-cancelled.png`,
`probe9.mjs`/`probe9.json`.
**Fix shape:** `touch-action: none` (or `pan-y`) on the clip / lane — a `src/**` CSS
change this lane may not make.

### F4 — inside the inline roll, touching a note destroys the note selection
*Spec §9 / X5b. Severity: medium — every keyboard note action dies after any pointer
contact with a note, and the inline roll is the roll most players meet first.*

On Paper Sketch's first clip, inline roll open:

| gesture | `selection().noteIds` | `selection().timeRange` | `ArrowUp` |
|---|---|---|---|
| draw a note | `['note-3']` | `null` | transposes ✔ (75 → 76) |
| click that note | `[]` | `null` | no-op (75 → 75) |
| drag that note | `[]` | `{fromTick:21120,toTick:26880,trackIds:['t0']}` | no-op (75 → 75) |

The note *does* move on the drag, so the roll's pointer edit path runs — but the
arrangement lane's range-select is reading the same pointer stream and writes the
surface selection last. The **full** piano-roll surface, driven through the identical
sequence, keeps working (75 → 76 → 77), so this is specific to the roll nested in a
lane. Every roll keyboard action begins `if (!selectedNoteIds.length) return`
(`PianoRoll.tsx:530`), so transpose, velocity, nudge, duplicate and delete all go dead.
**Evidence:** `.scratch/w6-e2e/findings.json` → `F4`,
`F4-inline-roll-selection-lost.png`, `probe9.json` / `probe10.json` (the surface-roll
control).
**Workaround in the suite:** `X5` draws → transposes → moves, in that order, because
drawing is the one gesture that leaves its note selected.

### Documented gaps re-confirmed (no new finding)
* `docs/timeline.md:399` — *"bare `ArrowUp`/`ArrowDown` are consumed by the clip
  track-move binding"*: consistent with F4's symptom on the arrangement side.
* `docs/timeline.md:387` — `shouldAutoDetectDrums` false-positives on Paper Sketch's
  chord clip; the inline roll does open `is-drums` in every run here. It does not affect
  any assertion, but it is why the roll screenshots show drum rows.

---

## 4. Harness fixes — failures that were the test's fault, not the app's

The previous pass left 7 red. Three were the app (F1/F2 above plus F3, F4); four were
mine, and each had one root cause worth writing down because it will bite again.

* **H1 — `T10`, and a whole class of geometry flake.** `.surface-transition-in` animates
  `transform: scale(1.015) → scale(1)` over 180ms after a 60ms delay
  (`ArrangementSurface.css:78-88`) and `getBoundingClientRect` reports the **scaled**
  box. `fieldMetrics` captured during it read `headerRight = 197.04` instead of `200` —
  exactly `200 / 1.015` — making every derived `pxPerTick` 1.5% short and the loop wash
  look 3.95px out of place on a surface that is in fact exact (re-measured: **0.00px**).
  Fixed by a new `settleField()` that waits for `getAnimations()` on the visible surface
  to finish and then requires two agreeing readings of the whole field signature; it now
  runs inside `openPaperSketch`, so every T-item inherits it.
* **H2 — `T21`.** Zoom writes the scale and the scroll offset on different frames.
  `expect.poll(pxPerTick).not.toBe(before)` resolves in between, pairing the **new**
  `pxPerTick` with the **old** `scrollLeft` and reporting a 328.85px miss. Direct
  measurement of the same gesture shows the anchoring is correct to **0.15px** and the
  preserved column is x=599 for a probe at x=600. Fixed with `settleField` after the
  wheel. (This one only surfaced *after* H1 made the earlier steps faster — it was
  latent, not new.)
* **H3 — `T23`.** The grab point sat 12px into the field, inside the 28px edge
  auto-scroll band, and the origin sample was taken before the press rather than after
  it. Fixed by grabbing ≥60px into the field and sampling on `mousedown`; `scrollLeft`
  then holds at 739 across the whole gesture and `.arrangement-follow` reads
  `aria-pressed="false"`.
* **H4 — `T26`.** The end-of-song stop is a **wall-clock** timer —
  `setTimeout(onEnd, remainSec * 1000 + 80)` in `startPreview`
  (`arrangementStore.ts:130`) — so a 50× stub engine cannot shorten it and the 30s
  per-test timeout always won. Fixed by seeking to 92% of the song first; the honest
  stop then lands in ≈5.8s with no `.arrangement-sky__alert` and no `pageerror`.

None of these required an app change, and none was papered over with a sleep or a
loosened tolerance.

---

## 5. Runs, timings and flakiness

Iteration ran against a production build served by `vite preview` on **127.0.0.1:5233**
(the build the engine's real wasm worklet loads), driven by
`node node_modules/@playwright/test/cli.js` — Playwright is run under **node**, never
under bun, which hangs `chromium.launch()` on this box. One Chromium project.

### The three deliverable files

| Run | Workers | Result | Wall clock |
|---|---|---|---|
| 1 | 1 | 52 passed · 27 skipped · **0 failed** | 1.4m |
| 2 | 1 | 52 passed · 27 skipped · **0 failed** | 1.3m |
| 3 | 1 | 52 passed · 27 skipped · **0 failed** | 1.4m |
| 4 | 4 | 52 passed · 27 skipped · **0 failed** | 1.1m |

**Flakiness: zero.** Every new test passed 3 consecutive `--workers=1` runs and the
`--workers=4` run — 4/4 identical outcomes, no retries configured, no test needed one.
`T21` was additionally hammered at `--repeat-each=4` while being fixed: 4/4 red before
the fix (identical value every time — a frame race that is deterministic on this
machine, not a coin flip), 4/4 green after.

The 27 skips are: 18 visual-baseline shells, 5 gates owned by unit tests, 4 `fixme`
findings.

Slowest tests, `--workers=1`: `T26` 8.9s (it waits out a real wall-clock timer by
design), `T23` 4.5s (waits for the follow-playhead to page), `T35` 2.6s (28 keypresses),
`X2` 2.5s (24 edge-jitter frames). Everything else is under 2s.

### The whole `e2e/` directory, once, `--workers=1`

103 tests · **62 passed · 14 failed · 27 skipped · 8.8m**.

**None of the 14 is this lane's.** No failing spec imports anything this lane changed:
`arrangement-editing.spec.ts` has its **own** local `openPaperSketch` (it imports only
`bootApp`, untouched), and the journeys use `activateBrowser` / `openStarter`, whose
behaviour is unchanged. `settleField` appears in no failure trace. Triage:

| Failing | Count | Cause | Whose |
|---|---|---|---|
| `arrangement-editing.spec.ts` (all 8) | 8 | its local helper presses `Tab` while focus is still on `.oj-menu-item` — see below | W6-UI (Tab semantics), or e2e maintenance |
| `J1-first-song`, `J2-recording-session` | 2 | they look the pill up by `getByTitle('Play')` / `getByTitle('Stop')`, but `TransportPill.tsx:418` now appends the shortcut hint to the title (`Play (Space)`), so the exact-title lookup finds nothing | W6-UI (`packages/oj-ui`) |
| `J3-editors-hour` | 1 | `s` split produced 32 clips, expected 33 | unknown — needs its own look |
| `J5-offline` | 1 | expects `503` from the origin-outage fixture; my iteration server is a plain `vite preview` without `OJ_E2E_ORIGIN_OUTAGE=1` | environmental (my harness, not the app) |
| `J7-collab` | 1 | second context does `page.goto('http://localhost:4173')`, the real config's port | environmental |
| `plugins.spec.ts` | 1 | the mocked hosted plugin never appears in the Browser | not investigated |

**The `arrangement-editing` break, diagnosed.** Its helper does
`getByRole('menuitem', {name: /Add Song/i}).click()` and then `page.keyboard.press('Tab')`
with no wait between. Measured: at the moment of that `Tab`, `document.activeElement` is
`div.oj-menu-item` — focus is still inside the just-dismissed menu, not on the body.
Under W6-UI's new rule (*Tab toggles surfaces only from `document.body` or the surface
ROOT*) that press is a no-op, the empty state never opens, and every one of the 8 tests
times out on `Start from 'Paper Sketch'`. It is a **race**, not a hard break: the same
sequence run by hand sometimes wins, and this spec was **already listed as flaky on
exactly this line** in the W4-TBc gate log (`.scratch/w4-tbc/e2e.txt`: *"4 flaky"*, same
`arrangement-editing.spec.ts:12`). W6-UI's change turns a long-standing race into a
reliable failure.

**The one-line fix, verified:** wait for the node, then press Tab from the body —

```ts
await page.getByRole('menuitem', { name: /Add Song/i }).click();
await page.waitForSelector('.song-node');          // the menu is gone, the node is in
await page.evaluate(() => document.body.focus());  // Tab from the body, per the new rule
await page.keyboard.press('Tab');
```

Measured with that change: `activeElement === document.body`, surface becomes
`arrangement`, the starter button is reachable. It is correct under the old rule too.
**I did not apply it** — this lane's e2e ownership is *additive*, W6-UI's Tab semantics
are still landing, and patching an existing spec against a moving rule is churn. It
needs an owner before the merge gate goes green. Evidence: `.scratch/w6-e2e/probe17.mjs`,
`probe16.mjs`.

**Not re-run at `--workers=4`:** with 14 pre-existing reds the parallel number would say
nothing this lane could act on. The four runs that matter — this lane's three files — are
above, and they are 4/4 clean at both widths.

---

## 6. What cannot be covered headlessly

* **The engine never answers.** Chromium runs the real wasm worklet, but no
  `TransportFrame` comes back, so the store honestly refuses to claim it is playing
  ("The audio engine did not acknowledge the transport command"). Every
  transport-dependent test therefore installs `installEngineProbe`, which mirrors the
  frames a live W3 worklet would send. That means these tests prove the **UI's**
  transport contract, never the engine's timing. Latency, dropouts and the `<5ms`
  threshold are not measurable here and must not be inferred from a green run.
* **Sound itself.** Nothing here listens. "A held note beats a glitch" is asserted as
  *the transport does not stop and no `pageerror` fires during an edit* (`T30`) — which
  is the observable shadow of the law, not the law.
* **The first-run rig starting.** `OnboardingHost` waits for `engineHealth === 'LIVE'`;
  headless never gets there, so J-onboarding asserts the rig **lands** and stops short of
  asserting it **rolls**.
* **Real touch hardware.** `T39` drives CDP `Input.dispatchTouchEvent` in a `hasTouch`
  context, which is the closest a headless browser gets to a finger. F3 is consistent
  with how Chromium treats a real finger over `touch-action: auto`, but the fix should
  still be confirmed on a device.
* **Native tier.** Everything here is the browser executor. The Tauri/cpal path, its
  device-loss recovery and its `<5ms` claim are outside this suite entirely.
* **Visual truth.** `visual-baselines.spec.ts` is deliberately inert until W6-UI lands.
  Until then nothing in this lane defends composition — only geometry (`T24` pixel-lock,
  `X1` ghost containment, `X4` sky-band occlusion) and the contrast gates in
  `src/components/Arrangement/__tests__/contrast.test.ts`.

---

## 7. Risks

1. **The baselines are a promissory note.** 18 skipped tests defend nothing. If W6-UI
   lands and nobody deletes the `.skip`, the redesign ships with no visual gate at all.
   The enabling recipe is in the file header; someone has to run it.
2. **The shared suite is 14 red, and 10 of those are W6-UI's blast radius — nobody owns
   them yet.** 8 in `arrangement-editing.spec.ts` (the Tab-from-a-menu-item race, one-line
   fix given above) and 2 in `J1`/`J2` (`getByTitle('Play')` against a `TransportPill`
   that now appends a shortcut hint to its `title`). None is this lane's, all of them are
   e2e files, and all of them will sit red at the merge gate until someone lands the
   updated selectors. This is the single most actionable thing in this report.
3. **Two lanes were editing the tree during these runs.** W6-UI owns `packages/**` and
   `src/keymap/**` (Tab semantics, `inert` on hidden surfaces, the transport pill),
   W6-FIXb owns `public/download`, `apps/docs` and `CommandBar.css`. All four runs of this
   lane's files used **one** production build taken at the start of the session, so they
   are internally consistent — but they are a snapshot of a moving tree. This suite also
   leans on `Tab` to reach the arrangement empty state (`openStarter`) and on
   `[data-surface-root]` `hidden`/`inert` (`T43`); `openStarter` survives today because it
   presses Tab with focus on the transport button rather than inside a menu, but it is the
   first thing to re-check when W6-UI's Tab rule settles.
4. **`fixme` is not a to-do list anyone owns.** F1–F4 are real product gaps found by this
   lane, not test debt. If they are not routed to an owner they will sit green-ish
   forever, because a `fixme` does not fail.
5. **`settleField` is a load-bearing helper now.** It sits inside `openPaperSketch`, so a
   surface that never stops animating would hang every T-item at its 1.5s budget rather
   than fail loudly. It throws `The field never stopped moving` after 30 samples, which is
   the right failure, but it is worth knowing where that message comes from.
6. **The inline roll opens in drum mode on Paper Sketch** (`docs/timeline.md:387`). No
   assertion depends on it today, but a future note-geometry assertion would silently be
   measuring drum rows.

---
---

# W6-E2E-b — the shared suite, taken to green

Follow-on lane. The Tab and transport-pill semantics landed (`06fa8c7`, `25c8dca`), so the
14 reds W6-E2E documented but deliberately did not touch were now fixable against a settled
API. **All 14 are closed.** Same rules: `e2e/**` only, no `src/**` edit, Playwright under
node, servers stopped.

## 1. The 14, and what each one actually was

Every one turned out to be e2e-side. Nothing needed a new `test.fixme`.

| # | Where | Root cause | Fix |
|---|---|---|---|
| 1–8 | `arrangement-editing.spec.ts` (all 8) | its local `openPaperSketch` pressed `Tab` while `document.activeElement` was still the `div.oj-menu-item` just dismissed. `Tab` switches surface **only** from `document.body` or a `[data-surface-root]` itself (docs/shell.md); inside a surface it walks controls. So the empty state never opened. | wait for `.song-node`, focus the body, then `Tab` |
| 9 | `J1-first-song` | two faults at once: `getByTitle('Play')`/`('Stop')` against a title that now carries the shortcut hint (`Play (Space)`), **and** no engine mirror — the pill refuses to show `Stop` until the engine confirms motion, which headless never does | `installEngineProbe` + `getByRole('group', {name:'Transport'}).getByRole('button', {name:'Play', exact:true})` |
| 10 | `J2-recording-session` | `getByTitle('Count-in: off, 1 bar, or 2 bars')` — that control no longer exists. The click and its count-in are one metronome toggle now, with the count-in on a hold/right-click menu | drive the real control: right-click, then `getByRole('menu', {name:'Count-in'})`, then `menuitemradio '1 bar'`, then toggle; assert via `toHaveAccessibleName` / `aria-pressed` |
| 11 | `J3-editors-hour` | **three** faults, stacked. (a) the ruler scrub clicked at `y:24` — the **brace row**; `denseEdit` carries a loop range whose brace covers that x, and "a press on an existing brace owns the pointer outright", so the playhead stayed at tick 0 and `s` split nothing. (b) a fixed 30px click offset, but after the range delete the first clip is a sliver. (c) a click aimed at `clips.nth(1)` intercepted by an overlapping clip | (a) scrub at `y:50`, the bars row; (b) width-aware `clickClip()`; (c) change the selection with `Ctrl+A` — a real binding with no geometry in it |
| 12 | `J5-offline` | its final line asserted the onboarding overlay **returns** after the offline reload. It cannot: the test skips onboarding near the top, and onboarding runs once. The assertion contradicted the shipped law | assert what is actually worth proving — no overlay, and the answers, the shell and the surfaces all survived a reload with no origin, with no `pageerror` |
| 13 | `plugins.spec.ts` | `getByRole('option', {name: /Velvet.*Acme Audio.*Synth.*CLAP/i})`. The row carries an explicit `aria-label` = `[name, vendor, format, benched]`, and an explicit label **is** the accessible name — the family ("Synth") is visible text and can never appear in it | match the published name `'Velvet, Acme Audio, CLAP'`, assert the family with `toContainText`, and scope `Insert` to the row (retiring a `.first()`) |
| 14 | `J7-collab` | nothing. It was environmental: it needs the preview-only loopback-STUN fixture and `localhost:4173`. Given a faithful server it passes untouched | no change |

### The systemic half of #1–#8

The `Tab` rule breaks *every* helper that means "show me the other surface", because
`bootApp` finishes by **clicking** a button and leaves the focus on a control. So rather
than patch one spec, `support.ts` gained

```ts
export async function tabToOtherSurface(page: Page): Promise<void> {
    await page.locator('body').focus();   // back to the stage floor
    await page.keyboard.press('Tab');
}
```

and `openStarter`, `loadFixture`, `pwa-smoke` (twice), `J5-offline` and `timeline-tlist`'s
T32 were routed through it; `timeline-preview` got the same two lines inline. Those were
latent bombs — they happened to still work only because focus sometimes fell back to the
body in time.

## 2. F1–F4 are closed — by lane W6-T, not by this lane

The four product gaps W6-E2E raised were fixed in `src/**` while this lane ran, and the
four `test.fixme`s in `timeline-tlist.spec.ts` were converted back to live tests. They now
**run and pass in every run below**: `T19b` (canvas `E` enters the selected Song node —
W6-T lifted `canvas.enterNode` above the computer-keyboard note row and made it fall
through when it has nowhere to go), `T27` (double-Stop returns), `T39` (touch parity), and
`X5b` (a pointer gesture on a note keeps it selected in the inline roll). Each is pinned by
a unit test on their side (`canvasLevelGrammar.test.tsx`, `touchAction.test.ts`,
`inlineRollSelection.test.tsx`). That file is theirs now, and this lane did not edit it
after the hand-off.

One consequence worth naming: with #11 fixed, **J3's verb-replay convergence assertion —
the owner of §11's T38 — actually executes again**. It had been dead behind the split
failure, so the byte-for-byte replay gate was silently not running.

## 3. Runs

Two independent setups, because one of them is not reliable on this box:

* **the shipped `playwright.config.ts`** (`bun run build && bun run preview` on 4173, with
  the origin-outage and loopback-STUN fixtures) — the real gate;
* **a pinned build plus a server this lane starts** with the identical env
  (`VITE_OJ_E2E_STUN_URL` at build; `OJ_E2E_ORIGIN_OUTAGE=1 OJ_E2E_STUN_PORT=3478` at
  serve; `--host 0.0.0.0 --port 4173`) — so a *series* of runs measures one build instead
  of re-building into a tree two other lanes are still editing.

| Run | Setup | Workers | Result | Wall |
|---|---|---|---|---|
| A | shipped config | 1 | **INVALID** — `vite preview` died after test 11; 69 x `ERR_CONNECTION_REFUSED` | 6.2m |
| B | shipped config | 1 | **80 passed · 23 skipped · 0 failed** | 4.4m |
| C | shipped config | 1 | 79 passed · 1 failed (`T33`) · 23 skipped | 4.1m |
| D | shipped config | 1 | **INVALID** — the machine ran out of process handles mid-run (`bash: fork: Resource temporarily unavailable`); tests 19+ recorded at 0ms | — |
| 1 | pinned build | 1 | **80 passed · 23 skipped · 0 failed** | 3.1m |
| 2 | pinned build | 1 | **80 passed · 23 skipped · 0 failed** | 3.1m |
| 3 | pinned build | 1 | **80 passed · 23 skipped · 0 failed** | 3.0m |
| 4 | pinned build | **4** | 79 passed · 1 failed (`T33`) · 23 skipped | 55.8s |

Three consecutive clean full runs at `--workers=1` on one build, plus a clean full run of
the **real** `bun run test:e2e` path (B). 103 tests; the 23 skips are the 18
visual-baseline shells and the 5 gates owned by unit tests — no `fixme` remains anywhere in
the suite. The one red is explained below.

`tsc -b` exits 0 and `eslint .` reports nothing in `e2e/**`.

## 4. New findings

### F5 — `vite preview` dies mid-run on this box, and takes the suite with it
*Severity: high for anyone trusting a single local run. Not a test defect.*

In run A the server exited **255** about 40s in, right after the 11th test, with no
diagnostic beyond `error: script "preview" exited with code 255`. Every subsequent test
failed with `page.goto: net::ERR_CONNECTION_REFUSED` — 69 of them. The same thing killed a
manually started server earlier in the session. Runs B and 1–4 were unaffected, so it is
intermittent, and it is **indistinguishable from a mass test regression** unless you read
the `[WebServer]` lines: the tell is `exited with code` in the log plus every failure being
`ERR_CONNECTION_REFUSED`. Worth a `grep` during CI triage before anyone bisects 69
"failures". Evidence: `.scratch/w6-e2e/b-full-w1-A.log` (line 27, against the failures that
follow it).

### F6 — `T33` (draw a note over an existing one) is ~1-in-8 flaky against W6-T's in-flight piano roll
*Severity: medium. Handing to W6-T — it is their file and their surface.*

Measured on the pinned build: **1 failure in 6** at `--workers=1`, **0 in 6** at
`--workers=4`, plus 1 across the four full runs — about 2 in 16 executions. It is therefore
a race, not a parallelism artifact. The failure is always the same: after the double-click
that draws a note on top of an existing one, `history().cursor` never reaches `cursor + 1`
— the draw simply did not commit.

The reason to look at it rather than retry it: **this test was 4/4 green in lane W6-E2E**
against the pre-W6-T build, and it only began flickering against a build carrying W6-T's
uncommitted `PianoRoll.tsx` / `ArrangementSurface.tsx` work. Not patched here: this lane was
asked not to touch `timeline-tlist.spec.ts`, and the fix belongs in the draw path anyway,
not in the assertion.

## 5. Risks

1. **The build under test is a moving target.** Every run above includes W6-T's
   *uncommitted* `src/**` changes (transport, canvas, piano roll). The pinned series is
   internally consistent — one build taken at `2026-08-31T14:16Z`, tree at `5b412f5` plus
   their working copy — but it is a snapshot. Re-run once they commit.
2. **F6 will cost someone a bisect if it is left.** A ~12% flake in the merge gate reads as
   "the suite is unreliable" long before anyone reads the failure.
3. **F5 makes a single green run weaker evidence than it looks.** Treat one clean local run
   as necessary, not sufficient, and check the `[WebServer]` lines.
4. **The 18 visual baselines are still inert.** Unchanged from W6-E2E — except that the
   blocker named there (W6-UI landing) is now gone, so someone can delete the `.skip` and
   capture. Until then nothing in this suite defends composition.
5. **`e2e/timeline-tlist.spec.ts` now has two authors.** W6-E2E wrote it; W6-T edited it to
   close F1–F4. It is theirs. This lane's later `Tab` hardening went into `support.ts` and
   the other specs precisely to avoid a collision.
