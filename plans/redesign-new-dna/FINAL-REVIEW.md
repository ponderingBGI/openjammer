# W6-FINAL — capstone review of `t3code/openjammer-redesign-timeline`

Adversarial pass before the PR to `canari`. Base is `git merge-base HEAD canari` =
`42682a6` (33 commits, 691 files, +76 252 / −19 200). `main` is *not* the base — it is
far behind; `git log main..HEAD` returns ~150 commits and is the wrong diff.

Everything below was measured, not read off a report. Browser work: one headless
Chromium against `bun dev --port 5237 --strictPort`, driven by node + Playwright
(`plans/redesign-new-dna/.scratch/w6-final/sweep*.mjs`). Captures in
`plans/redesign-new-dna/.scratch/w6-final/`.

---

## Verdict — **SHIP AFTER FIXES**

One blocker class, four sites, all mechanical. Everything else in this document is a
follow-up, not a gate.

The blocker is the one thing `src/store/graphStore.ts:144-147` names as forbidden:
undo spending itself on bookkeeping mid-set. `W6-Z` found and fixed exactly this in
`pluginLoadError.ts` — and wrote down, in that file, that the belief which caused it
("a write outside `begin/endGesture` stays out of history") is false. **Four siblings
still carry that disproven comment verbatim and still record.**

### Blockers — fix before merge

| # | file:line | exact change |
|---|---|---|
| B1 | `src/audio/executor/voiceLoadError.ts:32` | `store.updateNodeData<InstrumentNodeData>(nodeId, { voiceLoadError: hasError }, { record: false });` — and correct the comment at `:30-31`, which asserts the belief `pluginLoadError.ts:16-22` documents as false. |
| B2 | `src/audio/executor/faultPipe.ts:133` | `useGraphStore.getState().updateNodeData(visual, { pluginFaultKind: kind.NodeFault.fault, pluginBypassed: true }, { record: false });` — the `setNodePluginLoadError(visual, true)` on the line *above* was fixed in `a28f710`; this one was missed, so a hosted-plugin crash still mints one undo entry instead of two. |
| B3 | `src/audio/executor/OjcoreNativeExecutor.ts:525` | `store.updateNodeData(visualId, { [HOSTED_PLUGIN_STATE_KEY]: blob }, { record: false });` — and fix `:524`'s comment. This runs in `capturePluginStates()`, i.e. **on every save**, once per hosted plugin. |
| B4 | `src/components/Nodes/SamplerNode.tsx:85` | `store.updateNodeData<SamplerNodeData>(nodeId, { sampleLoadError: value }, { record: false });` — and fix the comment at `:78-79` ("set outside any gesture, so it is correctly non-undoable"), which is the same false claim. |

Why these are blockers and not nits: `graphStore`'s `set` wrapper (`:275-279`) diffs and
records **every** graph mutation that is not a history replay. B1 fires when a built-in
voice fails mid-performance; B2 when a hosted plugin crashes mid-performance; B3 on
every `Ctrl+S`. In all three the player's next `Ctrl+Z` — reaching for the edit they
just made — un-flags a badge or un-bypasses a crashed node instead. That is the
failure mode `a28f710` shipped to fix, left in place in three-quarters of its own
blast radius.

Add a regression test alongside `src/components/Nodes/__tests__/pluginErrorBadge.test.tsx`
asserting `useHistoryStore.getState().entries.length` is unchanged across each of the
four paths. There is no such assertion today for any of them.

---

## 1. Cross-lane seams

### (a) `TransportPill.returnArmed` — landed in `456239c`, after its W3/W4 gate

**API — good.** `returnArmed?: boolean` + `returnLabel?: string`
(`packages/oj-ui/src/components/TransportPill/TransportPill.tsx:74-84`). Read only when
stopped (`:435 const rewind = !playing && returnArmed`), so a stop square can never sit
over a rolling transport. The glyph is deliberately *not* `ReturnGlyph`; the comment at
`:125-131` argues the case (two identical arrows 40 px apart meaning different ticks is
a thing a hand learns wrong once and then trusts). Filled bar + filled triangle vs a
hairline neighbour is the right call and reads correctly at 13 px in both themes
(`02-canvas-rig-light-1280.png`, `02-canvas-rig-dark-1280.png`).

**Title honesty — verified honest.** `title` and `aria-label` both resolve through
`transportName` (`:436`), so an armed pill says *"Return to where playback started
(space)"*. Space genuinely does the same thing: `stopReturnsToOrigin()`
(`src/store/arrangementStore.ts`, above the history driver) is a single exported
predicate read by the key path *and* the button, precisely so the two cannot disagree.
The prop is fed from `src/components/Shell/TransportPillHost.tsx:54,217`. No lie found.

**Gap — the prop shipped with no unit test and no story.**
`TransportPill.test.tsx` has 19 `it(...)` blocks, none touching `returnArmed`;
`TransportPill.stories.tsx` has 5 stories (`Song`, `CanvasWithoutASong`,
`AwaitingFirstGesture`, `RecordDisabled`, `Recording`), none armed. A three-state
button whose third state has neither is exactly what "gained a prop after its gate"
costs — and it means the coverage sheet has no light/dark capture of the armed glyph
either. **Follow-up:** one story + two assertions (glyph swaps, accessible name
becomes `returnLabel`, and `returnArmed` is ignored while `playing`).

### (b) `historyStore.ts` end to end after three extensions — still one system

Read in full. 172 lines, four domains (`graph` / `arrangement` / `document` /
`library`) on one `begin`+`record`+`commit`+`undo` spine. **No consolidating refactor
is needed** — each extension documents itself where it lives (`:12-23` transport
snapshot, `:25-41` the document verb and why it carries a snapshot rather than a delta,
`:47-55` why library is a fourth *domain* and not a fourth *history*). This is the
small, trustworthy core the covenant asks for. Two notes:

1. **`abort()` is asymmetric with `undo()`.** `:143-148` dispatches the inverse but,
   unlike `:149-157`, calls neither `beginSelectionOpHistory` nor
   `useClipboardStore.getState().resetPasteContext()`. An aborted gesture leaves the
   selection-history and paste-depth cursors where the now-reverted edit put them.
2. **Cross-domain ordering is not expressible, and one driver already needs it.**
   `dispatch` (`:73-80`) hands the *whole* verb list to *every* driver; each filters to
   its own domain. `arrangementStore.ts:918-948` goes to real trouble — with a
   genuinely good comment — to preserve relative order between `document` and
   `arrangement` verbs. But that is ordering *within one driver*. A `graph` verb
   sequenced *after* a `document` verb in the same entry is still applied *before* it,
   because `graphStore.ts:2084-2101` runs as one unit at whatever position the `drivers`
   `Set` (insertion-ordered by module import) gives it. Harmless today — the domains are
   disjoint — and a trap the moment a graph verb depends on the swapped document.
   **Follow-up:** one sentence above `dispatch` saying so out loud.

### (c) `{ record: false }` sweep (W6-Z's Z4)

The four sites are the blockers above. For completeness, the callers I checked and
**cleared** as genuinely player-driven: `MIDIIntegration.tsx:128,252,259` and
`midiStore.ts:494,503` (device plug/unplug — arguably environment-driven, but they
create/rename a node the player then sees and owns, so an undo entry is defensible);
`MicrophoneNode.tsx:158` / `SpeakerNode.tsx:136` (device-gone → `deviceId: 'default'`)
are the borderline pair — environment-driven, currently recording, low blast radius.
Worth a decision, not a blocker.

### (d) The keymap as one system — order-dependences a future binding will trip over

The arbiter itself (`src/keymap/arbiter.ts`) is sound: Tab narrowing (`:34-39`, a
positive `matches()` test on the event target, with the reasoning for why
`:focus-visible` cannot carry it), drag consumption (`:70-76`), top-most-modal-only
(`:78-82`), inside-out surface walk with allowlisted fall-through (`:84-105`). Five
things are load-bearing and undocumented:

1. **`BindingSet.entries` order is the only tiebreaker, and nothing says so.**
   `runSets` (`:41-55`) returns on the first matching entry. `src/keymap/types.ts:23-28`
   documents `id`/`scope`/`surface`/`entries` with no word about precedence. The canvas
   set depends on it critically: `NodeCanvas.tsx:1076-1119` orders `levelActions`
   (`e`, `q`) **before** `noteActions` — which own 29 letter keys including `e` and `q`
   — **before** `regularActions`. A future canvas action bound to any of those 29
   letters and appended at the end, as every existing one was, is silently dead whenever
   `currentMode > 1`. **Fix: one sentence on `entries` in `types.ts`.**
2. **The fall-through protocol is a side channel.** `NodeCanvas.tsx:1092-1095` returns
   `event.defaultPrevented` — "handled" means "the handler happened to call
   `preventDefault`". That is how `e` correctly falls through to `note.e`; it is also
   how a future action that mutates state without preventing default will double-fire
   with a note.
3. **`mode` is declarative-only.** `keybindingsStore.ts:38-45` promises two actions with
   different `mode` on one surface "can never be live at the same time", and `:525-526`
   uses it to *suppress the Settings conflict warning*. Nothing enforces it at runtime:
   the real exclusion is a hand-written `stepEntry.trackId === trackId` /
   `!== trackId` guard repeated ~17 times across `PianoRoll.tsx:600-620`. Declare
   `mode: 'step'` and forget the guard and you get a silent shadow **and** a silenced
   conflict warning. No test ties the two. **Follow-up: a catalogue test asserting every
   `mode`-carrying action's registered entry has a guard.**
4. `arbiter.ts:103`'s `(!entry.setId || set.id === entry.setId)` narrowing makes every
   *other* set for that surface invisible at that depth. One set per surface today.
5. `registry.ts:6` is `sets.push` — order between two same-scope, same-surface sets is
   React mount order. Latent today.

Everything I could construct that *should* work, does: `Ctrl+Z` in step mode is not
eaten by `pianoroll.step.octaveDown` (bare `z`), because `matchesKeyCombo`
(`keybindingsStore.ts:318-326`) is strict on all three modifier groups.

---

## 2. App-wide taste — the five weakest moments, ranked

Walked at 1280×800, 1440×900 and 1920×1080, both themes: onboarding on a fresh
profile, canvas with the installed beat rig, arrangement on the Paper Sketch starter,
inline and full roll, command palette, settings, and Looper/Library/Sampler faceplates.

The whole *does* read as one instrument. Quiet ink, wells, teal on the audio path,
and — measured across every focus stop I walked — **exactly one focus ring**
(`solid 2px oklch(0.72 0.19 40)`, no variants). The five below are places where each
lane was individually fine and the seam shows.

**1. Nodes added from the command palette all land on one point and stack.**
`src/components/CommandBar/useCommandSources.ts:81` via `addNodeFromCtx` →
`viewportCenter()` (`:76`). The right-click path correctly uses `ctx.point`; the
palette path has no cascade, no offset, no "find free space". Adding Looper → Library →
Sampler puts three cards at the same coordinate, the first two ~90 % occluded, and the
stack half off the viewport bottom (`13-canvas-looper-library-sampler.png`). The
palette lane (`041ff72`) and the faceplate lane (`79c71b4`) were each fine; together,
adding a node is broken. This violates "design for instant" more directly than anything
else on the branch — the player watches the change land *on top of the last one*.

**2. The roll opens the shipped starter's melodic clip in drum mode.**
`src/components/PianoRoll/geometry.ts:60-63`: drums are detected as
`pitches.size <= 16 && every pitch in [35, 81]` — which is *most tonal music*. Paper
Sketch's "Nylon Chords" (a karplus chord part) matches. Consequences, all visible in
`05-inline-roll-light.png`: the key gutter mixes two vocabularies, because
`PianoRoll.tsx:693` is `GM_DRUM_NAMES[pitch] ?? pitchName(pitch)` — the shipped starter
reads `D5 · C#5 · … · Low bongo · High bongo · Ride · A#3 · Crash · Cowbell`; and
`:708` collapses every note to a 10 px diamond, so a 480-tick note and a 60-tick note
are indistinguishable. **Pre-existing** — `git show 42682a6:…/geometry.ts` is
byte-identical — so not a regression, but the New DNA roll, the new inline roll and the
new Paper Sketch starter together put it on the first-run path. Recoverable (the
`Drums` toggle owns a local override, `PianoRoll.tsx:144-148,677`). Ranked #2 because it
is the first thing a new player sees when they open a clip.

**3. The beat rig's step sequencer is an uncarded strip welded to the viewport bottom.**
`02-canvas-rig-light-1280.png` / `-dark-1280.png`. HAT/SNR/KICK rows sit directly on the
canvas paper with no card, no title bar, no well — the one element on the surface that
is not in the card language every one of the 14 faceplates speaks. It **clips the "Beat
rig" `SONG` card it belongs to**, and its hint ("click cells to edit the groove") is
right-aligned ~500 px away from the cells it describes, in a voice used nowhere else.
Its active cells are accent-orange — the same hue as the focus ring and the armed
transport — so content is wearing the state colour. This is what a "Build a beat"
first-run user is looking at three taps in.

**4. `#4a90c2` still ships.** `src/components/Arrangement/TrackLaneView.tsx:107` — the
track-colour `<input type="color">` fallback. `AGENTS.md:172`, `DESIGN.md:474` and this
branch's own commit `5b412f5` all declare that hex retired. The guard
(`src/components/__tests__/webSurfaces.test.ts:245`) only scans the download-page HTML,
so nothing catches it. Use `--universal-connection` (see docs §6 for the token twist).

**5. The same two ports are named three different ways on neighbouring cards.**
Measured in the live DOM across five faceplates side by side: the audio input is
`Audio In` on Speaker and Effect, `Input` on Sampler, `IN` on Instrument
(`src/components/Nodes/InstrumentNode.tsx` `socket(port, 'IN')`); the audio output is
`Audio Out` on Effect but `AUDIO` on Sampler, Instrument (`InstrumentNode.tsx:529`) and
InstrumentVisual (`InstrumentVisualNode.tsx:167`). All render uppercase, so it is not a
casing break — it is a *vocabulary* break, and all three are visible at once in
`02-canvas-rig-light-1280.png` (`IN`/`AUDIO` · `AUDIO IN`/`AUDIO OUT` · `AUDIO IN`).

**Checked and cleared** (my eye was wrong; verified in the DOM before writing): the
faceplate type slot is *consistent* — every card uses `.oj-node__type` with identical
computed style (`bg rgb(236,234,228)`, `4px 7px`, `radius 6px`, `11px`). Some read as
bare text only because that chip fill is nearly the card's own value in the light
theme. That low contrast is a real, smaller nit — not the idiom break it looks like.

Honourable mentions: the arrangement's region below the last track is untinted white
with a hard full-width edge where the paper stops (`04-arrangement-papersketch-*.png`);
the arrangement's left tool column speaks in letters (`V B X`) while its right speaks in
words (`Slide · Ripple · Mix · Export`), with a lone `P` between them; the Library
faceplate ships the only solid-filled accent button among otherwise ghost controls; and
the `space` keycap leaves the transport pill the instant the beat rig lands (mode 2 →
Space is the sustain pedal). That last one is *correct and well-argued*
(`TransportPillHost.tsx:161-169` — "an advertised key that does nothing is worse than
no hint") but its product consequence is that a first-run player's pill loses its only
keyboard affordance immediately.

---

## 3. Keyboard-only session (fresh profile)

| step | result |
|---|---|
| Complete onboarding | **works** — dialog buttons are reachable and activate. |
| Add nodes (keyboard→instrument→speaker) | **works** — `Ctrl+K`, type, `Enter`. All three land (and stack; see taste #1). |
| **Wire them** | **DEAD END.** 0 of 84 ports are tabbable (measured). `plans/redesign-new-dna/03-canvas-app-reliability-audit.md:41` (UI-017, P1) also records that the keyboard route into `startConnecting` fails on `button === 0`. A keyboard-only player can build a rig's nodes and cannot connect them. |
| Play a note | not exercised headlessly (no audio device); the key path is covered by `noteEvents()` in the e2e bridge. |
| Open the arrangement | **works** — `Tab` from the stage floor. |
| Move a clip with keys | **works** — `ArrowRight` moved clip `t0.c0` from tick 0 → 1920. |
| Undo it | **works** — `Ctrl+Z` restored tick 0 exactly. |

Two structural findings:

- **Forward `Tab` from the stage floor is a permanent two-cycle.** 20 of 20 presses
  alternated canvas root ↔ arrangement root and never reached chrome. Cause: after
  `view.toggleArrangement` fires, focus lands on the newly-shown `[data-surface-root]`
  element, which `isSurfaceTabTarget` (`arbiter.ts:34-39`) accepts, so the next `Tab`
  toggles again. **This is deliberate and documented** (`arbiter.ts:24-28`), and the
  escape works — measured: `Shift+Tab` walks File · Edit · View · Canvas · health ·
  Collaborate · theme · Settings · Start sound · keyboard help. One correction:
  `arbiter.ts:26-27` says "a backwards `Tab` from the stage floor walks into the
  chrome"; it takes **two** presses — the first lands on `document.body`.
- **Ports are not tabbable, and it is *not* recorded as a product decision.** The only
  place it appears is `03-canvas-app-reliability-audit.md:41` as an **open P1 defect**.
  `docs/shell.md:51-52` discusses the old Tab bug that made ports unreachable and says
  `matches()` fixed the surface swap — it never says ports are intentionally out of the
  tab order. **This needs one line in `docs/shell.md`, whichever way it goes.** Right
  now the branch is shipping a known P1 as if it were settled.
- **The piano roll is a tab trap.** `PianoRoll.tsx:708` renders every note as a
  `<button>` with no roving tabindex. The starter's first clip has 128 notes and all 128
  are `tabIndex 0` — tabbing *into* a roll costs one press per note to get out. Worse
  than the port gap in practice, because the notes *invite* the keyboard and then hold
  it. (The aria labels are excellent — `"A3, tick 0, duration 480, velocity 64"`.)

---

## 4. Reduced motion — **PASS**

Emulated `prefers-reduced-motion: reduce` and enumerated `document.getAnimations()`
filtered to `playState === 'running'`, on canvas, arrangement, palette (both surfaces)
and fresh onboarding.

- Under `reduce`: **`[]` on every one of them.** Nothing moves that carries no meaning.
- Under `no-preference` the only running animation anywhere was `oj-transport-attn`
  (1600 ms, on `.oj-transport__play.is-attn`) — the cold-load "the browser has not let
  sound through yet" pulse, which is meaning, not decoration.
- **Meaning is preserved, not dropped**, which is the part most codebases get wrong.
  Each rule substitutes a static equivalent: the pulse becomes a fixed
  `transform: scale(1.24); opacity: .55` ring; the recording dot holds `opacity: 1`; the
  recording lane button keeps a `box-shadow` ring; the recording waveform switches to
  `--accent-danger`.
- The blanket rule (`src/styles/global.css:41-46`) deliberately exempts `.oj-cable`,
  `.oj-meter` and its children, so signal-carrying motion survives a reduced-motion
  preference. That is the right call and it is the reason the sweep is clean without
  being deaf.

Two nits: an **empty** `@media (prefers-reduced-motion: reduce) { }` block ships
(dead CSS); and `packages/oj-ui/src/components/Slider/Slider.css:131-135` *re-adds*
`transition: box-shadow var(--motion-fast)` under `reduce`.

---

## 5. Gates — all six green (fresh, this working tree)

```
bun run test:run            232/233 files, 2661/2662 tests   [1 known flake — see below]
bunx tsc --noEmit -p tsconfig.app.json     exit 0
bun run lint                $ eslint .                        exit 0
bun run test:cli            52 pass, 0 fail, 163 expect()     exit 0
bunx figma connect parse    parsed OK                         exit 0   (CLI v1.4.8; v2.0.0 available)
bun run build               built in 3.55s · PWA 87 precache entries · exit 0
```

The one failure was the known flake and it is confirmed as one:

```
FAIL src/components/Settings/__tests__/KeybindingsPanel.test.tsx
     > rendering > should render all keybinding actions
     Error: Test timed out in 5000ms.        (full parallel run)

bunx vitest run src/components/Settings/__tests__/KeybindingsPanel.test.tsx
     ✓ 21/21 passed        'should render all keybinding actions'  3222ms
```

3.2 s against a 5 s budget in isolation — it fails only under full parallel load. Not a
regression. It is also a genuine 1.6× margin, so it will keep firing; raising that one
test's `testTimeout` is the honest fix.

Raw output: `.scratch/w6-final/gate-test.txt`, `.scratch/w6-final/gate-rest.txt`.

---

## 6. Docs truth-check (5+ spot-checks per document, verified against shipping code)

**`AGENTS.md` port law — two of its three rows are wrong, and this file loads every
session.**

- `AGENTS.md:168` says `type: 'technical'` → `--control-connection`. `'technical'` is a
  **retired type name**: the shipping union is `'audio' | 'control' | 'universal'`
  (`src/engine/types.ts:12`, `packages/oj-ui/…/Port/Port.tsx:4`), and `graphStore.ts:59`
  + `:1969-1974` actively *migrate it away*. The CSS hook is `.oj-port--control`; nothing
  keys off `'technical'`. The examples at `AGENTS.md:175-177` propagate the dead name.
- `AGENTS.md:169` says `universal` → `--universal-port`. Ports use
  **`--universal-connection`** (`Port.css:68-70`). `--universal-port` is declared once
  (`packages/oj-ui/oj-tokens.css:70`) and has **zero consumers** — a dormant token,
  against code-value #8. Either wire it or delete it; either way the law must name the
  token that is real.
- `AGENTS.md:172` / `DESIGN.md:474` "if you see `#4A90C2` it is stale" — it ships
  (taste finding #4).
- `AGENTS.md:157` cites `audioUtils.ts` as the camelCase exemplar. No such file exists
  anywhere in the repo. The convention holds; the example is a ghost.
- `AGENTS.md:152-154` file-structure claims — **all five verified.**

**`DESIGN.md`** — `--audio-connection` teal legend **verified** end to end (token
`oj-tokens.css:66` → socket `Port.css:64-66` → cable `Cable.css:35-36` → waveform
`Waveform.css:17`). Outfit self-hosted variable woff2 **verified** (`fonts.css:9-16`,
asset present). `--focus-ring` value and the `ListRow` 1.5 px exception **verified
verbatim**. Component count "44 folders → 48 named + 12 icons" **verified exactly**.
Two stale: the "53 semantic tokens" count is now **54** (`accentTwoInk` landed in
`06afd7`-era work, `themes/light.json:51`); and `DESIGN.md:676` / `:951`'s rule "no
component ships its own `prefers-reduced-motion` block" is broken by **13+**
stylesheets, one of which (`Slider.css:131`) re-adds a transition under `reduce`.

**`docs/timeline.md`** — the "exactly seven inheritable arrangement actions" claim
(`:313-314`) is **verified exactly** against `ArrangementSurface.tsx` (`:141,142,143,155,
172,173,196` and no others). Ruler/sky 64 px + 56 px single-declaration claim
**verified** (`gestureHandles.css:22` ↔ `ArrangementSurface.tsx:39,46`, pinned by two
tests). `E` in / `Q` out **verified**. The honest gap at `:450-451` (bare arrows
consumed by track-move even with nothing selected) is **verified real** —
`ArrangementSurface.tsx:199` returns `true` regardless. Three stale: `:116` says `M`
opens the mixer (it is the metronome, `:194`; the mixer has no key — only the sky-band
button, `SkyBand.tsx:96`); `:65`/`:262` say `+`/`-` zoom (bindings are bare `=` and `-`,
and `matchesKeyCombo` is strict on shift, so `+` does nothing); and `:447-449` still
lists `--accent-two-ink` as a gap when it **shipped** (`themes/light.json:51`,
consumed at `PianoRoll.css:34`, asserted by `contrast.test.ts:224`).

**`docs/shell.md`** — topbar 46 px band **verified** (`Topbar.css:13,21`); the
right-cluster order **verified in that exact sequence** (`Topbar.tsx:88-124`); the
segmented switcher reading the *live* `Tab` binding **verified**
(`SurfaceSwitcher.tsx:31`); the onboarding storage key/persona/goal shapes **verified**
(`onboardingStore.ts:24,30,33,35-39`); "renders over the real studio, blurred 5px"
**verified** (`Onboarding.css:55`). One wording nit: `:96` quotes the record-disabled
reason as *"Arm a track first"*; the shipped string is *"Arm a track first — open the
arrangement with Tab"* (`TransportPillHost.tsx:225`). And see §3 — shell.md is the file
that should state the port-tabbability decision and does not.

---

## 7. Founder checklist — what this review could not judge

Everything below needs a human with audio actually playing. Per the covenant, no model
signs off on feel.

- [ ] **Looper undo feel** — one gesture, one `Ctrl+Z`, with a loop running.
- [ ] **The redone beat rig loops** — `8ed983e`'s `TransportSnapshot` claims redo brings
      an armed rig back armed. Verify by ear: install the beat rig, `Ctrl+Z`,
      `Ctrl+Shift+Z`, confirm it loops rather than playing its bar once.
- [ ] **`Ctrl+Z` of a rig stops the transport** cleanly — no stuck voice, no click.
- [ ] **Double-Stop rhythm** — the `returnArmed` glyph is correct on screen; the
      *timing* of the second press (does it land where you expect, does it declick) is
      unjudged.
- [ ] **Dark-theme note-ink paleness** — `05-inline-roll-dark.png` still reads faint to
      me against the tinted clip; the 3:1 assertion is a number, not a verdict.
- [ ] **The 9.5 px menu micro-voice** — legible on real hardware at real distance?
- [ ] **Touch drag of a clip** on real hardware (`456239c`'s touch fix is asserted by
      e2e only).
- [ ] **Native tier** — everything above is the browser tier at ~116 ms measured
      latency. The `<5 ms` claim lives on the native path and is untested here.
- [ ] **A listening pass with audio** — the only test that matters.

Plus two decisions this review surfaced but cannot make:

- [ ] **Are canvas ports meant to be keyboard-reachable?** If yes, `03-canvas-app-
      reliability-audit.md`'s UI-017 is an open P1 shipping unfixed. If no, say so in
      `docs/shell.md`.
- [ ] **`--universal-port`**: wire it or delete it, and fix the port law either way.
