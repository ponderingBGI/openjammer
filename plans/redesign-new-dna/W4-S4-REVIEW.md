# W4-S4 review — app shell, transport pill, first run, preset rigs

Reviewer: Opus 5 (product-design gate, read-only). Evidence:
`plans/redesign-new-dna/.scratch/w4-s4-gate/` (`gate1…gate8.mjs`, `probe-*.mjs`, `g-*.png`,
gate logs). Chromium driven under `node` against the dev server on 5214 and — for the
questions that only a real bundle can answer — `vite preview` on 4174.

## Verdict: **DO-NOT-COMMIT** — three must-fixes, all small, none architectural.

This is the strongest first-run work in the effort so far. The overlay, the rigs, the
pill's zone honesty and the meter are all genuinely well made, and the meter in particular
is exactly right (73 distinct values over 80 frames, **zero** DOM mutations in the pill
subtree while it runs). What blocks the commit is that two of the lane's own headline
promises are false in the running app — `Ctrl+Z` does not remove the rig, and the transport
pill cannot be traversed by keyboard — plus a claimed deletion that did not happen.

---

## 1. Onboarding — PASS (one honesty nit)

| Claim | Verdict | Evidence |
|---|---|---|
| Overlay over the blurred REAL studio | PASS | `.surface-layer` `filter: blur(5px)`, `pointer-events: none`; scrim `oklab(… / 0.55)` + `backdrop-filter: blur(14px) saturate(1.05)`, z 2000 |
| One labelled `aria-modal` dialog | PASS | exactly 1 on cold load; `aria-labelledby` → the question |
| Three steps, one tap each, `01/03` counter | PASS | counter walks 01→02→03 |
| Number keys 1–3 | PASS | `2`,`2` walks to the theme step |
| Number keys guarded against fields | PASS | a focused `<input>` swallows `2`; the step does not advance (also guarded on Ctrl/Meta/Alt) |
| Esc / "Skip, take me in" keeps answers given | PASS | Esc at step 3 stored `{"exp":"some","goal":"beat","theme":"light"}` |
| Back button preserves | PASS | |
| Staggered spring entrances | PASS | `ob-in` at 0 / 70 / 140 / 210 ms, matching the prototype |
| Reduced motion → instant, no blur | PASS | `animation-duration 1e-05s`, `.surface-layer` filter `none`, scrim backdrop `none` |
| Focus trap both directions | PASS | 6 forward + 3 backward Tabs all stayed in `.ob-card` |
| Finishing click unlocks audio synchronously | PASS (code + behaviour) | `Onboarding.chooseTheme` → `finish` → `OnboardingHost.finish` calls `onActivate()` before any `await`; `App.handleActivate` constructs the context inside `void (async …)` on the same stack. Audio is live afterwards (the meter reads 0.865 on a held note) |
| Persistence `oj-onboarding-v1`, strict parse | PASS | |
| Returning user → no overlay; pulse only pre-gesture, never rolling | PASS | `is-attn` before the first gesture → gone after; `is-playing` while rolling; the two classes never coexist |
| Native/Tauri copy path | PASS | with `__TAURI__` mocked the theme step reads *"Your rig is ready either way."* and the pulse is browser-only |
| "Redo setup" in Settings clears + re-runs | PASS | persona `SegmentedControl` + Redo setup; storage → `null`, overlay returns |
| Beginner hint bubble + HelpPanel persona default | PASS | `first` → bubble + help open with 5 rows; `some`/`pro` → collapsed, no bubble |
| Old `.oj-welcome` + first-run toast gone | PASS | zero references to `oj-welcome`, `toolbar-wrapper`, `SharedSurfaceChrome` anywhere |
| SafeMode restyled | PASS (code) | `.oj-fullscreen` + real focus trap; could not force a crash-recovery state in the browser |
| Contrast in both themes | PASS | every word on the scrim is `--text-primary` (`rgb(29,28,24)` light / `#F1EFE8` dark); cards are opaque `--bg-node`. Worst case is the lane's audited 4.93:1 (dark, over the accent) |

**Honesty nit (not a blocker).** The deleted welcome screen was the only place the browser
tier's *honest* `~15–25 ms` latency and the desktop app's `<5 ms` were stated to a new user
(agents.md belief 1: "we say so"). Nothing in the new first run says either. The latency
chip only appears when latency is bad. Consider one line under the theme step, or a
follow-up in the docs/download path.

`index.html`'s boot copy now reads *"Three questions and you'll be playing"* on **every**
load, including the 99% where there are no questions. Low priority.

---

## 2. Rigs — PASS on construction, FAIL on the undo promise

`installRig` is exactly right: `addNode`/`addConnection` inside one
`beginGesture`/`endGesture`, ports resolved against the LIVE node with the cable's signal as
the fallback. Nothing is faked with timers.

| Goal / persona | Nodes wired through | One history entry | Undo removes the rig | Playable |
|---|---|---|---|---|
| jam / first | `keyboard→instrument→effect(delay)→speaker` (14 nodes incl. internals, 65 cables) | YES (`{cursor:1,entries:1,scopes:["graph"]}`) | **store: YES · `Ctrl+Z`: NO** | YES — `q` and `a` emit real note events through `emitKeyboardSignal` |
| jam / pro | + `width` (17 nodes) | YES | store YES | YES |
| beat / some | + `song`; real `Arrangement` — 1 track, 1 clip, 96 BPM, a `loop` location | YES | store YES | grid YES, autoplay UNPROVEN (below) |
| beat / grid | 3 × 8 = 24 cells over the real clip | note count 12→13 on click, 13→12 on second click, both through `drawNotes`/`eraseNotes`; the topbar Undo removes it | **`Ctrl+Z`: NO** | |
| sound / pro | `keyboard→instrument(pad)→effect(filter)→pan→width→speaker`, two real `Knob`s | YES | store YES | knob drag moved `pan` −0.25 → +0.283 through the store |
| sound / first | no `pan`, no `width` | YES | store YES | — density ordering correct |

### MUST-FIX 1 — `Ctrl+Z` is dead for every first-run user

`focusRig()` switches the app into the rig keyboard's mode (2–9) so typing plays. But
`NodeCanvas.tsx:697` gates `edit.undo` / `edit.redo` **inside `if (currentMode === 1)`** —
config mode only. So the moment a rig lands, `Ctrl+Z` does nothing, and it stays dead for
the rest of the session unless the player presses `1`.

Proven, not inferred (`probe-undo2.mjs`):

```
pre-answered (no overlay ever):  cursor 1 -> after Ctrl+Z: 0   UNDO WORKS
after a real onboarding run:     cursor 2 -> after Ctrl+Z: 2   UNDO DEAD
```

Everything else still resolves (`Tab`, `Ctrl+K` both fine), and the **topbar Undo button
works** — so this is precisely the mode gate, not a stuck modal binding set.

This falsifies, in the running app, three separate statements this lane ships:
`buildRig.ts`'s own header ("a single `Ctrl+Z` takes it away again"), the README's "one
`Ctrl+Z` away from gone", and the Settings copy under **Redo setup** ("the new rig lands
beside it and Ctrl+Z removes it"). It also breaks D12.

**Fix (one line, cross-lane).** Hoist the `edit.undo` / `edit.redo` branches out of the
`currentMode === 1` block in `NodeCanvas.tsx` — they carry `Ctrl`, so they can never collide
with a note key, and `edit.delete` already sits outside the gate for exactly that reason.
`NodeCanvas.tsx` is untouched in this worktree; it belongs to the canvas/P10 lane, so the
orchestrator should place it. If it cannot be placed now, the alternative inside S4's own
files is for `focusRig` not to leave the player in a mode where their first edit is
un-undoable — but that costs "typing plays immediately", which is the better promise to
keep. Hoist the shortcut.

### Keyboard-visual (coordinator's question) — deviation is CORRECT, but was never declared

(a) **All three rigs use `type: 'keyboard'`**, not `keyboard-visual` (`presets.ts` refs
`keys` / `pads` / `keys`). Confirmed in the live graph and visible in `g-10-beat-first-light.png`:
a card headed *Keyboard 2* with four sockets — `ROW 1 / ROW 2 / ROW 3 / PEDAL`. A beginner
told "press the keys" is shown four sockets and no keys; the beat rig has no pads at all.

(b) **`keyboard-visual` is not viable at top level**, and this is structural, not cosmetic:

- It is an *internal* node. `nodeInternals.createKeyboardInternals()` mints one inside every
  `keyboard` container; `graphStore.ts:1525` lists it in `UNDELETABLE_INTERNAL_TYPES`; it is
  not offered anywhere in the add menu.
- **It cannot emit a note.** Only `KeyboardNode` calls `registerKeyboard(assignedKey, nodeId)`
  (`KeyboardNode.tsx:60`), which is what `audioStore.activeKeyboardId` and the whole typing
  path resolve against. `KeyboardVisualNode` is a *mirror* — it reads `activeKeys` and lights
  up; it emits nothing. A top-level one would glow when some *other* keyboard was played.
- Its 31 outputs are per-key `control` ports with no row bundling, and it is 660 × 280 px.

Making it playable means giving it its own registration + row bundling — a node-faceplate
change, i.e. **Wave 5 / P8 (Keyboard / KeyboardVisual)**, not S4.

(c) **Judgement:** the choice is right; the *reporting* is not. D12 names `keyboard-visual`
explicitly and the report's §7 "Deviations" lists seven items without mentioning it, while
§3 discusses `keyboard` port resolution as if it had always been the plan. A silent
deviation from a settled decision is the one thing the delegation contract asks builders not
to do. **Not a blocker** (no viable alternative exists in S4's scope) — recorded as a
**high-priority Wave 5 follow-up**: the beginner's rig must show something to press.

**Recorded, not a blocker:** the green "active mode" ring + green badge on the Keyboard node
is old faceplate styling (and reads as `--success`, which in the New DNA means "healthy",
not "selected"). Wave 5.

### Beat-rig autoplay — still UNPROVEN, but **not** attributable to S4

On the **production build** the beat rig does not roll: readout frozen at `1.1`, and the
arrangement shows *"The audio engine did not acknowledge the transport command."*
(`g-19-arrangement-dark.png`). The lane's attribution holds — the **shipped** path fails
identically here: Paper Sketch + the arrangement's own Play is also frozen with the same
error on the same build. And `timeline-preview.spec.ts` passes only because it *injects* a
fake worklet transport frame, so it never proved real motion. This is a headless-Chromium
engine-frame condition, not a lane regression. **Founder listening pass required** before
the "already looping" copy can be trusted.

One thing that *is* in scope: while frozen, the pill shows **Stop** — i.e. it claims to be
rolling. `isPlaying` is optimistic in `arrangementStore` (pre-existing, `TransportStrip` did
the same), but the pill is now the single place a performer looks. Worth a follow-up:
`transportPending`/`transportError` should reach the play glyph, not only the readout.

### Sound-design rig — the blurb points at the wrong knobs

*"Turn the knobs while you hold a key."* The two real `Knob`s are **PAN** and **WIDTH**;
the controls that actually sculpt the sound — the filter's **Frequency 900** and **Q 2.40** —
render as sliders on the `Effect` faceplate (`g-07-sound-pro-light.png`). The knobs are
stereo placement. Copy or faceplate should meet; the faceplate is Wave 5, so soften the
copy. Not a blocker.

---

## 3. TransportPill + Meter — PASS on truth, FAIL on keyboard

| Zone | Canvas (no song) | Arrangement | Verdict |
|---|---|---|---|
| play/stop | present, 44px pill, `Start sound` | `Play` | PASS |
| record | **absent** | present | PASS — matches the lane's decision |
| return to start | absent | present | PASS |
| bar.beat readout | absent | `Playhead at 1.1`, click-to-type | PASS |
| BPM | present but **disabled**, `title="Add a Song node to set the tempo"` | live | PASS — honest |
| loop / metronome | absent | present | PASS |
| meter | present | present | PASS |
| `space` hint | conditional | shown | PASS |

- **BPM grammar:** a 30 px drag moved 84 → 94 BPM (Δx/3, exact), and produced **one**
  history entry on release. PASS.
- **Meter:** 73 distinct `--oj-meter-signal` values over 80 frames on a held note, peak
  0.865, and **0 mutation records** on the pill subtree over the same window. This is the
  rAF/property design working exactly as specified. PASS.
- **Space and the pill agree:** `Start sound` ↔ `Hold all sound` flips on Space. PASS.
- **Geometry:** topbar 46 px (1 px rule), pill top 52 px — a 6 px gap, no overlap; on the
  arrangement the pill bottom is 96 px and the ruler top 154 px, so the sky band is
  genuinely reserved. PASS.
- `TransportStrip` no longer duplicates transport; `SharedSurfaceChrome` and the old
  `Toolbar.css` are gone; zero `.toolbar-wrapper` / `.oj-welcome` references remain. PASS.

### MUST-FIX 2 — the pill cannot be traversed by keyboard, and Tab inside it changes surface

The unit test asserts DOM order; the live app does not deliver it. Starting focused on the
pill's play button, nine Tabs never reach a second pill control (`gate8.mjs`):

```
["Stop", "surface-layer [OUT]", "Arrangement [OUT]", "surface-layer [OUT]", …]
```

`view.toggleArrangement` is bound to bare `Tab` globally, so from inside the transport, Tab
**switches surface** instead of moving to Record / Return / BPM / Loop / Metronome. Shift+Tab
walks backwards into the chrome, so the controls are technically reachable — but only
backwards, and the forward key does something destructive and surprising. For a keyboard-only
performer this is not a nicety.

See §5 for the recommendation.

### MUST-FIX 3 — `LatencyWarningBanner.{tsx,css}` was NOT deleted

The report §1 states *"Deleted: … `src/components/LatencyWarningBanner.{tsx,css}`."* Both
files are still on disk, unmodified, with **zero importers** — `git status` shows only
`SharedSurfaceChrome.tsx`, `Toolbar.tsx`, `Toolbar.css` and `Toolbar.shortcuts.test.tsx` as
deleted. That is dormant production code (value #8) and a legacy path left behind after a
migration (value #7), and the report is inaccurate about it. Delete both files.

---

## 4. Topbar — PASS

- 46 px `--bg-node-header` band, 1 px `--border-subtle` rule. PASS.
- Menus render the oj-ui `Menu` family; **every** keycap reads the live keymap
  (File 6 rows / 2 keycaps, Edit 3 / 3, View 6 / 5). PASS.
- Breadcrumbs in the left cluster; surface switcher is a real `role="tablist"` with the live
  `Tab` keycap. PASS.
- Undo/redo correctly disabled on an empty history. PASS.
- Engine dot, project chip, offline chip, collab, theme toggle, settings (sliders glyph —
  the right call next to the sun). PASS.
- **Latency chip** does appear when latency is genuinely high (`132 ms` in
  `g-10-beat-first-light.png`) and is absent when it is not — honest. The popover carries
  **Fix now / Ask AI / Dismiss** over the same store and the same localStorage key as the
  old banner (code-verified; I could not force the high-latency state in a headless context
  long enough to open it). Note: unlike the rest of the lane, `LatencyChip` has **no unit
  test**. Worth one.
- **Cold-start dark stays dark:** `--bg-canvas` = `#161510` on first paint. PASS.
- **Nothing overlaps.** Pill (52–96 px, x 610–830) clears the topbar (0–46) and the palette
  panel (top 108, x 400–1040). Toasts remain `position="top-left" offset="80px"` — x 16–372,
  y 80+ — which clears the pill, the topbar and the palette panel horizontally. **The P5
  z-order concern does not reproduce with the new chrome.** PASS.

---

## 5. Bare `Tab` — recommendation

The report's §8 offers (a) blur chrome buttons after a mouse activation then guard on chrome
containment, or (b) move the surface toggle off bare `Tab`.

**Take (a), corrected — and the correction is why the lane's attempt failed.**

The lane guarded on a *negative* condition ("focus is walking the chrome") and used
`:focus-visible` to detect it; Chromium raises `:focus-visible` on the Tab keydown itself, so
the guard could not distinguish walking from clicking, and 11 of 13 specs broke. The audit's
TL-25 / spec §4 wording is a *positive* condition and needs no `:focus-visible` at all:

1. In `arbiter.resolveKeydown`, beside the existing precedent
   (`if (event.key === 'Tab' && isFocusableInOpenDialog(event.target)) return false;`), add:
   **`Tab` falls through to the browser unless the event target is `document.body` or inside
   `[data-surface-root]`.** Deterministic, target-based, no focus heuristics.
2. Pair it with: chrome controls (`Topbar`, `TransportPill`) blur themselves after a
   **pointer** activation, detected with `event.detail !== 0` — the standard, cross-browser
   discriminator between a mouse click and Enter/Space. That is what keeps `bootApp`'s
   "click Play, then press Tab" working, and it is what the lane's `:focus-visible` attempt
   was reaching for.

Result: Tab still toggles surfaces from the stage (the 99% case, and after any click on the
canvas), and traverses normally the moment focus is on a control — including forward through
the topbar and *within* the pill.

Reject (b): the `Tab` keycap is advertised in the topbar, in the record button's disabled
reason, in `docs/shell.md`, in the README and in twelve specs. Rebinding it is a larger,
louder change than a target guard.

---

## 6. e2e — `bunx playwright test pwa-smoke · arrangement-editing · timeline-preview · plugins --project=chromium`

**14 passed, 2 failed.**

| Spec | Result |
|---|---|
| `pwa-smoke.spec.ts` (4) — isolation/mount, "Play here" brings the worklet to life, WAV export, First Light export | all PASS |
| `arrangement-editing.spec.ts` (8) — surface swap teardown, mixer fader, clip drag+undo, ripple/slide, copy/paste, range delete, selection undo, record flow | 7 PASS |
| `arrangement-editing.spec.ts` — **"S splits at the playhead"** | **FAIL** — expected 4 clips, got 3 |
| `timeline-preview.spec.ts` (1) — Play publishes the timeline | PASS |
| `plugins.spec.ts` — belief-1 failure card | PASS |
| `plugins.spec.ts` — **"Browser interleaves built-ins and mocked hosted plugins"** | **FAIL** (flaky: 2 of 3 on re-run) |

**"S splits at the playhead" — the lane's attribution is CORRECT, and I verified it in
`RulerStack.tsx` rather than taking the claim.** The seek is *not* missing: line 99, the
`.arrangement-ruler-viewport` `onPointerDown` calls `arrangementStore.seek(locationTick(...))`.
What shadows it is line 130 — the new `.arrangement-braces-row`, whose own `onPointerDown`
fires `beginRange(…, 'create')` when the target is the row itself. At the spec's
`y: 35` inside the now-64px ruler stack, the click lands in the braces row and creates a loop
range instead of seeking. Entirely inside `Arrangement/**`. **Lane TB.**

**`plugins.spec.ts` — not the onboarding overlay, but S4 makes it more likely.** I first
suspected the new `aria-modal` overlay hid the dialog from the a11y tree; it does not —
with the overlay up, `getByRole('dialog', {name:'Browser'})` still resolves (`gate4.mjs`).
The real shape is a race the spec has always had: it dispatches `openjammer:open-browser`
right after `expect(#root).not.toBeEmpty()`, while the listener attaches in an effect
(`App.tsx:103`). S4 adds real mount work (onboarding host, topbar, pill, meter subscription),
widening that window — hence 1 failure in 3. `plugins.spec.ts` is in the lane's "PR-lane
specs" scope and was **not** run by the lane (its gate table lists only two spec files).
Harden it (`waitForFunction` on the listener, or retry the dispatch) before merge.

---

## 7. Gates

| Command | Result |
|---|---|
| `bunx tsc --noEmit -p tsconfig.app.json` | **clean** |
| `bunx eslint src packages e2e` | **1 error, not this lane** — `Canvas/ContextMenu.tsx:133` `react-hooks/purity` (canvas lane, in flight) |
| `bun run test:run` | **194 files / 2105 tests — 1 failed, not this lane**: `Canvas/__tests__/ContextMenu.test.tsx › scopes typeahead to the open submenu` (canvas lane regressed after the lane's run). Every S4 test green |
| `bun run build` | **clean** |
| Playwright (4 specs) | 14 / 16 — see §6 |

---

## 8. Taste — side by side with `App Prototype.html`

The onboarding is a faithful, in some ways better, recreation. Compared with
`proto-06-onboarding-over-studio.png`:

- **Option cards, glyphs, counter, question weight** — matched. 30px/700 question, 15px sub,
  16px/500 titles, 13px details, the `01 / 03` mono counter, the numeric keycap on the right
  of each card, the ghost skip under the options, the dot rail. The mini pads/keys/dials read
  correctly at 15px and stay `aria-hidden`.
- **Better than the prototype:** the first option is focused on open, so the keyboard path
  and the pointer path start in the same place; the prototype leaves focus nowhere.
- **The 55% scrim + primary ink** (deviation 2) is the right call and I would not take the
  handoff's 45% back.
- Dark is as good as light (`g-17-onboarding-dark.png`).
- **The pulse as an expanding ring rather than a growing button** is correct and should be
  kept — a hit target whose box oscillates is a worse target, and the lane's Playwright
  "element is not stable" is the machine version of a hand missing it.

The studio:

- **Pill proportions are right** — 44 px, three zones on the canvas, five on the arrangement,
  hairline dividers, meter last. It never competes with the patch.
- **Meter bar rhythm** — the arched per-bar coefficients and the dB scale are both correct;
  a linear meter would read as silence on a real 0.02 RMS note.
- **Topbar density** is good: three clusters, two hairline rules, nothing shouting. The one
  thing that *is* loud is the **`Collaborate` pill** — it is the widest, highest-contrast
  object in the right cluster, above undo/redo and the engine dot in visual weight, for a
  feature most sessions never use. Consider the icon-button treatment the rest of the cluster
  uses. Not a blocker.
- **The hint bubble** is well judged: it sits with the thing it describes, it stays until
  dismissed, and it is shown to `first` only. A pro never sees it — nothing patronising.

**What a beginner would hesitate at**, in order:

1. The `Keyboard` node shows four sockets and no keys (§2). They are told "press the keys"
   by a bubble and a help card while looking at a patch bay.
2. The `Instrument` node's **"No parameters"** and an unlabelled orphan socket at its foot —
   the busiest node in every rig, and its body says it has nothing (pre-existing; Wave 5).
3. The Song node's **"1 track · 1 bars · 96 BPM"** (pre-existing; Wave 5).
4. On the beat rig, `Tab` currently lands them on an **engine error banner** over the ruler
   (§2, environment).

**What a pro would find patronising:** nothing. `pro` gets a collapsed help card, no bubble,
two real knobs and the denser chain. The density ladder is honest.

---

## 9. Ranked must-fixes

1. **`Ctrl+Z` dead after a rig lands.** Hoist `edit.undo`/`edit.redo` out of the
   `currentMode === 1` gate in `NodeCanvas.tsx:697` (cross-lane — orchestrator to place).
   Three shipped statements are currently false without it.
2. **`Tab` cannot traverse the pill / the topbar, and switches surface from inside them.**
   Apply the corrected fix (a) in §5: a positive `[data-surface-root]`-or-body target guard
   in `arbiter.resolveKeydown`, plus blur-on-`event.detail !== 0` in `Topbar` / `TransportPill`.
3. **Delete `src/components/LatencyWarningBanner.{tsx,css}`** — dead, zero importers, and the
   report claims they are already gone.

Should-fix before merge (not blocking on their own):
4. Harden `e2e/plugins.spec.ts` against the mount race it now loses ~1 in 3.
5. A unit test for `LatencyChip` — it is the only new Shell component without one.
6. Soften the sound-design blurb, or note that the sculpting controls are the filter's
   sliders, not the two knobs.

---

## 10. Follow-ups for other lanes

**Lane TB (timeline).**
- **Ruler seek is shadowed, not missing.** `RulerStack.tsx:130` — `.arrangement-braces-row`
  consumes the pointerdown at the spec's `y: 35` and creates a loop range; the seek at
  line 99 never runs. Fixes `arrangement-editing.spec.ts › S splits at the playhead`.
- `--oj-topbar-height` (Topbar.css) and `--oj-surface-top` (ArrangementSurface.css, 102px)
  must move together until TB replaces the latter with the real sky band.
- The ruler's bar numbers are running together (`12345678910111213…`) at default zoom —
  `g-19-arrangement-dark.png`.
- Consider surfacing `transportPending` / `transportError` on the pill's play glyph so the
  pill cannot show **Stop** while the playhead is frozen.

**Lane P9 (panels/Settings).**
- Settings → Graphics now owns **First run** (persona `SegmentedControl` + **Redo setup**).
  Keep it; its copy currently promises `Ctrl+Z` removes the new rig — true again once
  must-fix 1 lands.
- The theme picker in the same tab is still the older `Swatch` grid; unify it with the
  onboarding's two-up swatches so the two places a player chooses a theme look like the
  same product.
- `LatencyChip` replaced `LatencyWarningBanner` — drop the banner from P9's list.

**Wave 5 (faceplates), high priority.**
- The `keyboard` node must show something to press (or `keyboard-visual` must become a
  first-class playable node with its own `registerKeyboard` + row bundling). This is D12's
  intent and the one place the first run currently under-delivers.
- Retire the Keyboard node's green active-mode ring/badge (old styling; green means healthy
  in the New DNA).
- `AutoParamPanel`'s "No parameters" on `instrument`; the Song node's "1 bars".

---

## 11. Artefacts

`plans/redesign-new-dna/.scratch/w4-s4-gate/` — `gate1.mjs` (onboarding + jam),
`gate2.mjs` (rigs + pill zones), `gate3.mjs` (meter, autoplay, pulse, motion, topbar, Tab),
`gate4.mjs` / `gate5.mjs` (production build: autoplay, plugins repro, Tauri copy),
`gate6.mjs` (theme, personas, redo setup, z-order), `gate7.mjs` (toast geometry),
`gate8.mjs` (pulse + pill traversal), `probe-undo.mjs` / `probe-undo2.mjs` / `probe-keys.mjs`
(the undo root cause), `g-01…g-22*.png`, `tsc.txt`, `eslint.txt`, `vitest.txt`, `build.txt`,
`e2e.txt`, `e2e-plugins.txt`.
