# W4-S4b — the review's must-fixes, each pinned by a test

Fix round on `W4-S4-REVIEW.md` (verdict DO-NOT-COMMIT: three must-fixes + three
should-fixes). All six items are done. Every one is pinned by a test that was
**verified to fail on the pre-fix code** — each fix was temporarily reverted, the
test re-run red, then restored.

Evidence: `plans/redesign-new-dna/.scratch/w4-s4b/` — `s4b.mjs` (the new browser
gate, 12 checks), `s4b-results.json`, `s4b-0{1,2,3}-*.png`, and a re-run of the
review's own harnesses (`rerun-gate{1,2,3,6,7,8}.mjs`, `rerun-probe-*.mjs` with
their `.txt` logs), all against one Chromium on **5217** driven under `node`.

---

## 1 · `Ctrl+Z` was dead after onboarding — MUST-FIX 1

**Root cause, as the review found it.** `NodeCanvas.tsx` gated `edit.undo` /
`edit.redo` — and `canvas.copy` / `paste` / `selectAll` / `duplicate` with them —
inside `if (currentMode === 1)`. `focusRig()` leaves a first-run player in the
rig keyboard's mode (2–9) so typing plays, so from the moment a rig landed the
player's first edit was un-undoable for the rest of the session.

**Change.**

| File:line | What |
|---|---|
| `src/components/Canvas/NodeCanvas.tsx:49` | `COMMAND_ACTIONS` — the six editing actions that are *chords, not notes*. |
| `src/components/Canvas/NodeCanvas.tsx:724` | The six branches hoisted **above** the mode gate, run when `e.ctrlKey \|\| e.metaKey \|\| currentMode === 1`. |
| `src/components/Canvas/NodeCanvas.tsx:~800` | The same branches removed from inside the `currentMode === 1` block (one comment left pointing up). |

The condition is deliberately `Ctrl/Cmd **or** config mode`, not just Ctrl/Cmd:
`Ctrl` is what proves a chord cannot collide with a held note (which is exactly
why `edit.delete` already lived outside the gate), and the `currentMode === 1`
half keeps the old behaviour for anyone who has **rebound** one of these actions
onto a bare key. Note keys, `q`/`w`/`e`, `Space` and the Alt-bound zoom actions
stay mode-gated — untouched.

**Pinning tests** — `src/components/Canvas/__tests__/NodeCanvas.reliability.test.tsx`

- `:160` `runs undo|redo from a keyboard mode, not only config mode` (an `it.each`
  over `Ctrl+Z` and `Ctrl+Shift+Z`, asserting the unified history cursor **and**
  the node count, in `currentMode: 3`). **Both fail on pre-fix code.**
- `:179` `still plays a bare note key in a keyboard mode after the chord hoist` —
  the guard that the hoist did not steal `z` from the notes. Passes either way,
  by design: it exists to fail if someone later hoists too much.

**Browser** (`s4b.mjs`, real onboarding run — 3 / 1 / Light, so a rig really lands
and the app really switches mode):

```
PASS  1  - Ctrl+Z after onboarding removes the rig   history 1->0, canvas nodes 5->0
PASS  1b - Ctrl+Shift+Z puts it back                 history 0->1, canvas nodes 0->5
```

And the review's own root-cause probe, re-run verbatim
(`rerun-probe-undo2.txt`) — the line that read `UNDO DEAD` now reads:

```
after a real onboarding run:  before {"cursor":2,…} -> after Ctrl+Z {"cursor":1,…} UNDO WORKS
```

`rerun-gate1.txt` closes with `OK Ctrl+Z removes the whole rig (0 nodes)` and
`fails: 0 / checks: 23`. The three shipped statements the review called false —
`buildRig.ts`'s header, the README's *"one `Ctrl+Z` away from gone"* and Settings'
**Redo setup** copy — are true in the running app.

---

## 2 · Chrome keyboard traversal — the chrome side — MUST-FIX 2

The arbiter half (bare `Tab` falls through unless the target is `body` or inside
`[data-surface-root]`) **landed in the tree while this round was in flight** —
`src/keymap/arbiter.ts:21` `isSurfaceTabTarget` / `:52`. Not mine; verified
present and exercised below.

**Change — the chrome side.**

| File:line | What |
|---|---|
| `src/components/Shell/chromeFocus.ts` (new) | `releaseChromeFocus(event)` — blur the active element after a **pointer** activation (`event.detail !== 0`), keep focus after a keyboard one. Skips editable targets, `aria-haspopup` triggers, and anything with `aria-expanded="true"`, because those are about to need the keyboard. |
| `src/components/Shell/Topbar.tsx:22,70` | One `onClick` on the `<header>`. |
| `src/components/Shell/TransportPillHost.tsx:30,165` | One `onClick` on `.oj-transport-host`. |

Attached **once per container** rather than per control: clicks bubble, so no
button has to remember the policy and `oj-ui` stays purely presentational. The
discriminator is `event.detail`, not `:focus-visible` — Chromium raises
`:focus-visible` on the `Tab` keydown itself, which is precisely why the lane's
first attempt could not tell walking from clicking and broke 11 specs.

**Pinning tests**

- `src/components/Shell/__tests__/TransportPillHost.test.tsx:175` `releases focus
  after a pointer activation` — **fails pre-fix**; `:185` `keeps focus when the
  same control is activated from the keyboard`.
- `src/components/Shell/__tests__/Topbar.test.tsx:19` `hands focus back to the
  stage after a pointer activation` — **fails pre-fix**; `:30` keyboard case;
  `:40` `does not steal focus from a menu the same click just opened`.

**Browser** (`s4b.mjs`, with the arbiter guard in the tree, Paper Sketch loaded
and one track armed so the record zone is focusable):

```
PASS  2a - a mouse click on Play releases focus to the stage        BODY
PASS  2b - bare Tab from the stage still switches surface           surface=Arrangement
PASS  2c - Tab walks the pill in order
      ["Play","Record","Return to start","Playhead at 1.1","Tempo 84 BPM","Loop","Metronome"]
PASS  2d - Shift+Tab reverses the same order
      ["Metronome","Loop","Tempo 84 BPM","Playhead at 1.1","Return to start","Record"]
PASS  2e - traversing the pill never changed surface                surface=Arrangement
PASS  2f - Tab walks the topbar forwards   ["File","Edit","View","Arrangement","engine dot"]
PASS  2g - Enter on a chrome control keeps focus     Settings -> Settings
```

That is the review's requested order exactly: **Play → Record → Return → bar.beat
→ BPM → Loop → Metronome**, and the reverse. Two honest notes:

- **Record is only in the walk when a track is armed.** With nothing armed the
  button is `disabled`, and a disabled button is skipped by the browser's own
  focus order. That is correct behaviour, not something the pill should fight —
  `rerun-gate8.txt` (which arms nothing) therefore shows the six-control walk.
- `2b` reads the **surface switcher's selected tab**, not `querySelector(
  '[data-surface-root]')`: both roots stay mounted (the canvas is never
  unmounted), so the DOM query answers the wrong question. The review's `gate3`
  forward-Tab check has the same flaw plus a superseded expectation — see §7.

---

## 3 · `LatencyWarningBanner` deleted — MUST-FIX 3

`src/components/LatencyWarningBanner.tsx` and `.css` are **deleted**. Zero
importers before deletion, confirmed by grep over `src packages e2e` (the only
remaining mentions anywhere are two historical planning documents,
`docs/design-system-migration-plan.md` and `docs/GPU_LATENCY_STRATEGY.md`, which
describe the pre-migration world and are not mine to rewrite).

No other dead shell CSS was outstanding: the review had already confirmed zero
`.toolbar-wrapper` / `.oj-welcome` references and the deletion of `Toolbar.*` and
`SharedSurfaceChrome.tsx`.

**Pinning test** — `src/components/Shell/__tests__/retiredChrome.test.ts`

- `:34` an `it.each` asserting each of the five retired shell files is **gone from
  disk**, and `:40` a repo scan asserting nothing in `src`/`packages`/`e2e` still
  names `LatencyWarningBanner`, `SharedSurfaceChrome`, `toolbar-wrapper` or
  `oj-welcome`.
- Verified red: restoring the two banner files from `HEAD` turns 3 of the 6 cases
  red; deleting them again turns them green. It is a migration gate, so it also
  guards the four files the lane really did delete.

---

## 4 · The pill claimed **Stop** over a frozen transport

`arrangementStore.isPlaying` is optimistic: `play()` flips it before the engine
has said a word, and when the acknowledgement never arrives the 1.5 s timeout
clears `transportPending` and raises `transportError` **but leaves `isPlaying`
true**. The pill is the one place a performer looks to ask *is it running*, so it
was claiming Stop over a playhead frozen at `1.1`.

**Change** — `src/components/Shell/TransportPillHost.tsx:40,104`

```ts
const rolling = arrangement
    ? isPlaying && transportPending !== 'play' && transportError === null
    : isAudioContextReady && !isGloballyPaused;
```

The fix is entirely in the lane's own file — `arrangementStore.ts` belongs to the
timeline lane and is untouched. Four states, all honest:

| Store state | Glyph | Readout |
|---|---|---|
| `transportPending: 'play'` — start unconfirmed | **Play** | `--text-muted` (spec §2.2) |
| `transportError` — engine refused or went silent | **Play** | — |
| playing, confirmed | **Stop** | normal |
| playing, `transportPending: 'seek'` mid-scrub | **Stop** | `--text-muted` |

`'seek'` is deliberately excluded: scrubbing a rolling transport casts no doubt on
whether it is rolling, and a glyph that flickers mid-drag would be a new lie.
Confirmation is one `TransportFrame` away, so on a healthy engine the flip is a
frame; a transient error self-heals because `receiveTransportFrame` clears it.
Stopping stays instantaneous — `isPlaying` goes false with the gesture.

**Pinning tests** — `src/components/Shell/__tests__/TransportPillHost.test.tsx`
`:133` unconfirmed start → Play + `.is-pending` readout (**fails pre-fix**);
`:141` engine never acknowledged → Play (**fails pre-fix**); `:152` confirmed →
Stop; `:160` seek mid-roll → still Stop.

**Browser** (`s4b.mjs`, on the very box where the engine does not acknowledge):

```
PASS  4a - the glyph starts at Play
PASS  4b - unconfirmed start: Play + muted readout
          readout={"pending":true,"colour":"rgb(108, 105, 95)"}   ← --text-muted, light
PASS  4c - after the engine failed to acknowledge, the pill still says Play
          engine-ack-error=true  glyph=Play
```

`rerun-gate3.txt` §2 — the review's own autoplay-honesty harness, whose failure
branch is literally *"pill says ROLLING (Stop) but the readout is frozen"* — now
reports `not rolling and the pill says Play (honest)`.

**Residual, declared.** The *gesture* still routes through
`transportStore.toggleGlobalPause()`, which reads the raw `isPlaying`. So in the
frozen state the button reads **Play** and one press calls `stop()` — which is the
recovery, but the label and the act disagree for that one press. Fixing it
properly means teaching `toggleGlobalPause` (and therefore `Space`) the same
truth, and `transportStore.ts` is not in this round's ownership. Recorded for the
orchestrator rather than reached for.

---

## 5 · Deviation honesty — the rigs use `keyboard`, not `keyboard-visual`

The review's judgement stands (the choice is right, the reporting was not). Now
recorded in three places instead of nowhere:

- **`docs/shell.md`** — a new *"Honest deviation — the rigs use `keyboard`, not
  `keyboard-visual`"* block under **Preset rigs**, with the three structural
  reasons (internal + `UNDELETABLE_INTERNAL_TYPES`; only `KeyboardNode` calls
  `registerKeyboard`, so a top-level visual keyboard is a mirror that emits
  nothing; 31 unbundled per-key `control` ports at 660 × 280 px) **and the cost
  stated plainly**: a beginner is told "press the keys" while looking at a card
  with four sockets and no keys, and the beat rig shows no pads at all.
- **`plans/redesign-new-dna/MASTER-PLAN.md`** — a new `## Follow-ups (appended by
  later reviews — do not reorder)` heading, appended only, carrying the Wave 5 /
  P8 item (make `keyboard-visual` first-class playable with its own
  `registerKeyboard` + row bundling, or give the `keyboard` faceplate keys) and
  the second P8 item the review raised (retire the Keyboard node's green
  active-mode ring — green means *healthy* in the New DNA, not *selected*).
- **This report**, above.

`docs/shell.md` also gained the two other truths this round created: the
`Tab`/focus policy (under Topbar) and the pill's honest glyph table (under the
transport pill), plus a line saying `Ctrl+Z` really does remove the rig and why it
did not before.

`rerun-probe-kv.txt` re-confirms the mechanism: *"keyboard-visual has no
registerKeyboard call; KeyboardNode does."*

---

## 6 · `e2e/plugins.spec.ts` — it was the spec, and it is fixed

**Diagnosis.** The spec dispatched `openjammer:open-browser` immediately after
`expect(#root).not.toBeEmpty()`. The listener is attached by `PluginsPanelHost`'s
`useEffect` (`src/App.tsx:103`); `#root` having content only proves the first
**commit**, and React's passive effects can still be a paint behind. So the event
could be fired into a window with no listener and was simply lost — a spec-side
missing wait, not a product race. S4's real mount work (topbar, pill, meter
subscription, onboarding host) widened the window enough to lose it ~1 in 3.

**Change** — `e2e/plugins.spec.ts:27-43`: ask until it is heard.

```ts
await expect(async () => {
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('openjammer:open-browser', …)));
    await expect(browser).toBeVisible({ timeout: 500 });
}).toPass({ timeout: 15_000 });
```

Safe because both handlers are idempotent — `PluginsPanelHost` does
`setRequested(true)` and `PluginsPanel` does `setOpen(true)`; neither toggles. It
waits on the listener itself rather than on a guessed delay.

**Verified:** `bunx playwright test e2e/plugins.spec.ts --project=chromium
--repeat-each=6` → **12 / 12 passed**.

---

## Gates

| Command | Result |
|---|---|
| `bun run test:run -- src/App src/components/Toolbar src/components/Shell src/components/Onboarding src/rigs src/components/Canvas packages/oj-ui/src/components/TransportPill packages/oj-ui/src/components/Meter` | **12 files / 157 tests, all green** |
| `bun run test:run` (full) | **199 files / 2195 tests, all green** (`.scratch/w4-s4b/vitest-full.txt`) |
| `bunx tsc --noEmit -p tsconfig.app.json` | **clean** |
| `bunx eslint src packages e2e` | **clean** (the review's one error, `Canvas/ContextMenu.tsx:133`, is gone — the canvas lane landed it) |
| `bun run build` | **clean** |
| `bunx playwright test e2e/pwa-smoke.spec.ts e2e/arrangement-editing.spec.ts e2e/plugins.spec.ts --project=chromium` | **15 / 15 passed** |

Per-test Playwright:

| Spec | Result |
|---|---|
| `pwa-smoke.spec.ts` (4) — isolation/mount · "Play here" wakes the worklet · WAV export · First Light export | all **PASS** |
| `arrangement-editing.spec.ts` (8) — surface-swap teardown · mixer fader · clip drag+undo · ripple/slide · copy/paste · range delete · selection undo · record flow | all **PASS** |
| `arrangement-editing.spec.ts › S splits at the playhead` | **PASS** — the timeline lane's `RulerStack` fix landed; the review's §10 follow-up is closed |
| `plugins.spec.ts` (2) — insert-context browser · belief-1 failure card | **PASS**, and 12/12 over `--repeat-each=6` |

**Browser gate:** `s4b.mjs` — **12 / 12 checks PASS, 0 console errors, 0 page
errors** (`s4b-results.json`).

---

## 7 · Re-run of the review's own harnesses — and the three that "fail"

`rerun-gate{1,2,3,6,7,8}.txt`, `rerun-probe-{undo2,keys,kv}.txt` in
`.scratch/w4-s4b/` (the harnesses are the review's, copied verbatim with only
`5214 → 5217` and the screenshot prefix changed). `gate4`/`gate5` are the
production-build plugin probes and are superseded by the Playwright run above.

- `rerun-gate1` — **0 fails / 23 checks**, including `Ctrl+Z removes the whole rig`.
- `rerun-gate3` §1 — **meter 72 distinct over 79 frames, peak 0.871, 0 pill DOM
  mutations**. The rAF/property design is intact.
- `rerun-gate6`, `rerun-gate7`, `rerun-gate8`, `rerun-probe-keys`,
  `rerun-probe-kv` — unchanged from the review's readings.

Three harness lines report FAIL. All three are the **harness**, not the product,
and I did not touch the harnesses to make them green:

1. **`gate2` "meter static: 1 distinct value".** Section D boots *pre-answered*,
   which by design installs **no rig** — there is no keyboard on that canvas, so
   holding `q` makes no sound and the meter correctly reads `0.000`. `gate3`
   measures the same meter on a real rig and gets 72/79. Structural to the
   harness, and it would have read the same before this round.
2. **`gate3` "no pulse class before the gesture: `oj-transport__play is-attn`".**
   The check regexes for a class named `pulse|is-pulsing`; the implementation's
   class is `is-attn`, which the review itself accepted as PASS (§1, "returning
   user → pulse only pre-gesture"). Naming mismatch in the harness.
3. **`gate3` "forward Tab NEVER reaches the topbar/pill".** This encodes the
   *pre-decision* expectation. The decision the review then took (§5) is the
   opposite: `Tab` **from the stage** still toggles surfaces — that is the 99%
   case and twelve specs depend on it — and traverses only once focus is on a
   control. `s4b.mjs` checks 2b/2c/2f prove exactly that shape. Superseded, not
   regressed.

---

## Not done, and why

- **A unit test for `LatencyChip`** (review should-fix 5) and **softening the
  sound-design blurb** (should-fix 6) were not in this round's six items;
  `LatencyChip.tsx` and `presets.ts` are in the lane's files, so both are cheap
  follow-ups whenever they are asked for.
- **`transportStore.toggleGlobalPause()` does not yet share the pill's truth**
  (see §4 residual) — out of ownership.
- **Native (Tauri)** and a **founder listening pass with audio actually playing**
  remain required: this box's engine still does not acknowledge the transport
  command, on the shipped path as much as the rig's, so "already looping" is
  code-verified and browser-verified but not *heard*. Per agents.md, nothing here
  signs off on feel.
