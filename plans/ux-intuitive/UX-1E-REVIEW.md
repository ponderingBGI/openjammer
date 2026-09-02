# UX-1E — adversarial review

Gate for lane **UX-1E** (U11, U14, U15, HA-18, HA-20, HA-22) against
`plans/ux-intuitive/UX-1E-REPORT.md`. Worktree
`C:\Users\olimt\.t3\worktrees\openjammer\t3code-2faff191`, branch
`t3code/openjammer-redesign-timeline`. Everything below was driven live on a dev
server on `:5254` (lane-local Vite config ignoring `.scratch/**`, because another
lane's Chromium profile kills the watcher with `EBUSY`), headless Chromium under
**node**, `--autoplay-policy=no-user-gesture-required`. Scratch, scripts and
screenshots: `.scratch/ux-1e-gate/`. No product file was edited; no git write was
made. Diffs under `src/components/Nodes/**`, `src/components/Canvas/**`,
`src/a11y/**`, `src/keymap/**`, `src/store/graphStore.ts`, `packages/oj-ui/**`
are UX-1C's and were ignored.

---

## Verdict

# SHIP-AFTER-FIXES

**10 findings + 5 nits.** One is blocking.

This is a strong lane. U11 is genuinely shipped — Erase and Knife work on both
surfaces, in both themes, click and sweep, one gesture = one `Ctrl+Z`, a stroke
over nothing writes nothing, and both undo to a byte-identical document. I proved
all of that live, not from the report. U14 is proven live end to end, including
the thing the report said it could not prove: I forced a real render crash and
watched Escape recover, the repeat crash arrive as the corner chip, and the
Keybindings confirms stop Escape with Settings still open. U15 is the cleanest
piece of work in the lane — 0 px overlap with every node of the beat rig at both
sizes in both themes, the lit cell resolving to exactly `--accent-two-ink`, the
type floor held, and still a thin view over the clip's notes.

What blocks is **HA-18's chosen remedy**. Giving the inline lane its own opening
axis makes the notes grabbable, but it also makes the lane's time axis disagree
with the ruler 60 px above it by **4.95×** — bar lines at 192 px in the roll,
38.7 px in the ruler and in every sibling lane — while the lane has
`overflow: hidden` and no scroller, so 77 of 128 notes are drawn outside the
field with no in-lane way to reach them. On a surface whose stated law is "a clip
edge must land *exactly* on its grid line at every zoom" (spec §2.1) and whose
playhead is derived per-component from `tick × pxPerTick`, that is a ruler that
lies. It has to be resolved before this lands.

---

## Findings

| id | sev | file:line | what | exact fix |
|---|---|---|---|---|
| **F1** | **S1 — blocking** | `src/components/PianoRoll/PianoRoll.tsx:132-141`, `:965`, `:1049` | **The inline roll no longer shares the Song's time axis.** `pxPerTick = max(props.pxPerTick, inlineOpeningPxPerTick(ppq))` makes the lane draw at **0.05 px/tick** while the ruler, the clips in every other lane and the `.arrangement-playhead` that runs through the whole field are at **0.0101 px/tick** — a **4.95×** disagreement. Measured live at 1440×900 on Paper Sketch: roll bar lines every **192 px**, ruler bars every **38.7 px**; roll content **3264 px** inside a **1184 px** field, `overflow: hidden`, `scrollWidth 3445 / clientWidth 1223`, **51 of 128 notes visible** and no scroller in the lane. The lane's own `<Playhead pxPerTick={pxPerTick}>` and the arrangement's full-height playhead therefore advance at different speeds through the same viewport. Screenshot: `.scratch/ux-1e-gate/inline-roll-light.png` (ruler reads 1–32 above a roll showing ~6 bars). Violates spec §2.1 (pixel-lock) and §1.3 ("the grid never lies about what it did"). | Two honest options. **(a) Keep the shared axis, fix the note instead:** floor the *rendered* note box and its hit target at `MIN_RESIZE_EDGE_WIDTH_PX` in `clippedNoteGeometry`'s consumer for `mode === 'inline'` only, leaving `left` on the Song's axis — the note stays where the ruler says it is and becomes trimmable. (Note FINAL-REVIEW §2.2 already dislikes a fixed-width note in drum mode, so pair it with a min that only applies below the floor.) **(b) Make the lane an honest second viewport:** give `.piano-roll--inline .piano-roll__field` its own `overflow-x: auto`, draw a thin bar-number strip *inside* the lane, and suppress the arrangement playhead across the expanded lane. (a) is the smaller change and the one the spec argues for. |
| **F2** | S2 | `src/components/PianoRoll/PianoRoll.tsx:640` vs `:116` | **The tool keys are dead inside the inline roll.** The binding set writes `setViewport('pianoroll', { tool })`; the inline roll reads `viewports[mode === 'surface' ? 'pianoroll' : 'arrangement'].tool`. Proven live: with focus on an inline-roll note, `X` then `V` leaves the Song strip on `Erase tool=true` — `V` did nothing the lane can see. The wiring is pre-existing, but U11 is what makes it load-bearing: this is HA-13's "a key that does nothing" reintroduced one level down, on the surface a first-run player meets first. | In the `pianoroll.tool.*` entries, write to the same viewport the toolbar's `onClick` already picks: `useEditingContextStore.getState().setViewport(mode === 'surface' ? 'pianoroll' : 'arrangement', { tool: nextTool })`. `mode` is in scope; add it to the `useMemo` deps. |
| **F3** | S2 | `src/song/ops.ts:604-625` | **`splitNotes` has no minimum-length guard.** The no-op test is exact-tick equality (`at > note.tick && at < end`), so with `Ctrl` suspending the snap a click **1 px** inside a note's left edge mints a real fragment. Measured live on the full roll surface at the opening zoom: a `{tick: 0, dur: 480}` note became `{tick: 0, dur: 99}` + `{tick: 99, dur: 381}` — a 99-tick note that renders ~1 px wide, cannot be grabbed, and is below `noteDragFloor`. The report's claim "a split at a note's edge is a no-op, not a zero-length note" is true only for the exact tick. | Reject when either half would fall under the floor the Draw tool already uses: `if (at - note.tick < noteDragFloor(ppq) \|\| end - at < noteDragFloor(ppq)) { skipped.push(id); continue; }`, and let the roll's existing notice say why (the "grid moved that cut" branch is already there). |
| **F4** | S3 | `src/components/Arrangement/TrackLaneView.tsx:259`, `src/components/PianoRoll/PianoRollSurfaceHost.tsx:81` | **The full roll surface still opens un-trimmable.** Measured live: opening a Paper Sketch clip with `E` renders **128/128 notes at exactly 4.8 px**, every one below `MIN_RESIZE_EDGE_WIDTH_PX`. HA-18's core symptom ("at the default zoom a note cannot be trimmed at all") survives untouched on the surface the `E` key opens, and the report never mentions it. | Seed `viewports.pianoroll.pxPerTick` with the same floor when the surface opens: `Math.max(arrangementViewport.pxPerTick, inlineOpeningPxPerTick(ppq))` at `TrackLaneView.tsx:259` (and wherever else the roll surface is entered). The full surface *has* its own scroller and its own ruler, so it does not carry F1's alignment problem. |
| **F5** | S3 | `src/components/AppErrorBoundary.tsx:52-55` (`componentDidUpdate`) | **A repeat crash steals focus into the corner chip.** `componentDidUpdate` focuses `primaryRef` on every `null → error` transition; once `collapsed` is true that ref is the chip's `Recover` button. Proven live: after Escape-recover with the fault still armed, the chip appeared and `document.activeElement` was inside it (`focusInChip: true`). This contradicts the chip's own comment ("`role="status"` … takes no focus") and belief #1's "report without stealing focus". Focusing the *card* is right; focusing the *chip* is the thing HA-14 exists to prevent. | `if (!previous.error && this.state.error && !this.state.collapsed) this.primaryRef.current?.focus();`. Keep the explicit focus in `collapse()` (that one is deliberate focus continuity from the `Hide` button). Add the negative assertion to `appErrorBoundaryEscape.test.tsx`'s "never takes the whole stage twice". |
| **F6** | S3 | `src/song/ops.ts:569`, `src/song/__tests__/pianoRollContracts.test.ts:84-87` | **Two disagreeing implementations of BC-32, and the dead one holds the gate.** `noteResizeZone` is called by nothing in production, only by `pianoRollContracts.test.ts` — and after HA-18 it now *contradicts* `resizeEdge` at exactly 10 px (`!(widthPx > 10)` vs `width < 10`). Code value #8 ("every production line is used") and #7 ("remove legacy paths") both say delete it now; the lane named it and deferred it on the grounds that `ops.ts` was additions-only for this lane — which is a self-imposed rule, not a covenant one. | Delete `noteResizeZone` (6 lines) and point the three `pianoRollContracts` assertions at `resizeEdge` with the corrected argument order and the inclusive floor. ~10 lines total. |
| **F7** | S3 | `src/song/ops.ts:8-15` (`EDIT_OPS`), `src/ai/arrangementAdapter.ts:147-151` | **`splitNotes` is the only shipped gesture with no agent-side op.** Spec §1.8: "If a gesture cannot be expressed as a `Verb` (or an `EDIT_OPS` op), it is not shippable." The Song's knife lowers to `splitAt`, which *is* an `EDIT_OP`; the roll's knife has no entry. `piToolParity.test.ts` is one-way (`EDIT_OPS → extension`), so nothing catches the gap. The deferral is defensible in size but not in principle — this is the covenant's own shippability test. | Four small edits, one coherent change: `'splitNotes'` in `EDIT_OPS`; `\| { op: 'splitNotes'; noteIds: string[]; atTick: number }` in `TimelineOp`; `case 'splitNotes': result = splitNotes(projected, operation.noteIds, operation.atTick, store.mintId); break;` in `arrangementAdapter.ts`; and the matching `Type.Literal('splitNotes')` branch in `pi-openjammer-graph/index.ts`. |
| **F8** | S4 | `docs/timeline.md:314` | **The new `### The tools` section swallows the paragraph after it.** The Time-tool paragraph now runs straight into unrelated arrangement prose: "…rather than rebound (code-value #8). Track names edit inline (Enter/changed blur commits, Escape restores), tracks reorder with `moveTrack`…". The section boundary that existed before the insertion is gone. | Close the section after "…code-value #8." with a blank line, and restore the following prose to its own paragraph (or give it back the heading it lost). |
| **F9** | S3 (process) | `plans/ux-intuitive/UX-1E-REPORT.md` §0, §11 | **The `splitNotes` addition is not uncommitted — it is inside another lane's commit.** `git log -S "export function splitNotes" -- src/song/ops.ts` → **`7e5a94e2`**, "fix(shell,song,persistence): the first run tells the truth…", i.e. UX-1B's commit, whose message says nothing about a knife. That commit's `--stat` also carries `src/song/ops.ts +36` and `src/components/Shell/HintBubble.css −5` — both claimed by this report as its own uncommitted work. Nothing is lost, but "commits: atomic and focused — one reversible idea each" is broken and this lane's op can no longer be reverted independently of UX-1B's persistence work. | No code fix. Correct §11 of the report to say which files are already committed and where, so the next reader is not looking for a diff that isn't there. If the branch is squashed before merge this is moot; if it is not, note it in the PR description. |
| **F10** | S3 (gate accuracy) | `plans/ux-intuitive/UX-1E-REPORT.md` §7 / §8.1 | **The `test:run` red is not the one the report names.** On this box the full suite is **1 failed / 3268 passed (257 files)**, and the failure is `src/components/CommandBar/__tests__/CommandBar.test.tsx > "Tab from search sends the typed prompt to AI"` — `Test timed out in 5000ms` under a 240 s parallel run. It passes in **803 ms** when re-run alone. `transportBlame.test.ts` produced **no** unhandled rejections in either run and is 16/16 green — and while this review was running, commit **`b14c21d5`** ("test(store): transportBlame drives the store with the complete executor stub, so the record path no longer rejects unhandled") landed from the owning lane, closing §8.1 outright. So the gate row's stated cause is now doubly wrong: it was not reproducible for me, and it no longer exists. Neither failure is this lane's. | Re-state the gate honestly: the suite is green on content and flaky on timing under full parallelism (`CommandBar` M2 case, and `voiceSynth` per the standing note). Nothing for this lane to fix in code. |

### Nits (S4, no action required to ship)

| id | file | what |
|---|---|---|
| N1 | `src/components/Arrangement/RulerStack.css` (via `.arrangement-tool button`) | The strip's buttons measure **26 × 22 px** live — under spec §1.7's `≥ 24 × 24 px` fine-pointer floor. Pre-existing idiom, but the lane added `K` at that size, so it is now four undersized targets instead of three. |
| N2 | `src/components/Arrangement/useClipGesture.ts:196` | `finishEraseStroke` calls `setDragActive(false)` although the erase path never sets it `true`. Harmless today (only one pointer gesture can be live) but asymmetric. |
| N3 | `src/components/PianoRoll/PianoRoll.tsx:407` | `say()`'s `window.setTimeout` is never cleared on unmount. |
| N4 | `src/components/AppErrorBoundary.tsx:151-161` | Card action order is `Hide · Reload app · Try to recover` — the primary (and autofocused) action is last in both DOM and visual order. |
| N5 | `src/song/ops.ts:620` | `splitNotes` uses `index: source.notes.length` computed from the pre-batch state for *every* added half, so a multi-note cut inserts later halves mid-array. Functionally harmless (undo is by id) but the resulting note order is arbitrary. |

---

## Claims verified, with evidence

### U11 — Erase and Knife ship; the Time tool dies

All driven through the shipped **buttons**, on Paper Sketch, live (`walk.mjs`,
`walk2.mjs`, `walk5.mjs`).

**Song surface**

| claim | result |
|---|---|
| Erase click deletes a clip | `clips 3 → 2`, `history 0 → 1` ✔ |
| Erase drag sweeps N clips into ONE entry | `clips 3 → 0`, `history 0 → 1` ✔ |
| a stroke over nothing records nothing | `history 0 → 0` ✔ |
| Knife click splits at the pointer with snap | `clips 3 → 4`, `history 0 → 1`; halves `[0, 30720] + [30720, 30720]`, abutting, sum **=** the original `61440` ✔ |
| both undo exactly | erase: document JSON byte-identical after `Ctrl+Z` ✔; knife: `flatClips` identical (the `idCounter` legitimately moves — the T46 comment is right about that) ✔ |
| Knife on a clip edge writes nothing | `history 0 → 0` ✔ |
| `K` has a button | `Tool — Song` strip is `V B X K`, all four `tabIndex 0`, none disabled, `aria-pressed` toggles ✔ |

**Piano roll**

| claim | result |
|---|---|
| Erase click deletes a note | `notes 204 → 203`, `history 0 → 1`, notice `"Note erased."` ✔ |
| Erase sweep = one entry | `notes 203 → 191` (12 notes), `history 1 → 2`, notice `"8 notes erased."` on a separate 8-note sweep ✔ |
| stroke over nothing | `history 1 → 1` ✔ |
| undo | sweep undo restored `203` ✔ |
| Knife splits at the pointer, `Ctrl` suspends snap | `notes 203 → 204`, `history 1 → 2`, notice `"Note split."`; snapped click on a grid-unit note reports *"The grid moved that cut to the note edge — hold Ctrl to cut anywhere."* ✔ |
| `splitNotes` = `editNote` + `addNote`, halves carry pitch/vel/length | verified in `src/song/__tests__/splitNotes.test.ts` and in the live document: `{0,240,p60,v64}` from `{0,480,p60,v64}`; the six unit cases assert the pair spans exactly the original, both halves keep pitch and vel, the left half keeps the original id, and one inverse restores the whole note ✔ |
| a split at a note's **edge** is a no-op | true at the exact tick (`at > tick && at < end`), **false 1 px in with `Ctrl`** — see **F3** ✖ |

**The Time tool is gone everywhere.** `grep -rn "tool.time\|'time'" src/` returns
nothing in the tool union, the catalogue or the binding set:
`keybindingsStore.ts:233` entry deleted (replaced by a comment naming why),
`ArrangementSurface.tsx:217` binding-set entry deleted,
`editingContextStore.ts:80` union narrowed to
`'select' | 'draw' | 'erase' | 'knife'`, `docs/timeline.md` §2.3 now `V B X K`
and the shortcut list `V/B/X/K`. Nothing else in `src/` references it.

**Both themes.** Verified at 1440×900 with `openjammer-theme` actually applied
(`--accent-primary` = `oklch(0.66 0.19 40)` light / `oklch(0.72 0.19 40)` dark —
I re-ran after catching that the onboarding-localStorage shortcut does *not* set
the theme). Song strip, inline lane and roll surface all correct in both;
zoom-control ink `rgb(90,88,80)` on `rgb(236,234,228)` light,
`rgb(171,168,156)` on `rgb(42,40,34)` dark. Screenshots
`.scratch/ux-1e-gate/{song,inline-roll,roll-surface}-{light,dark}.png`.

**T45–T49 are not vacuous.** Read line by line against `HEAD`:

- **T45** arms `Erase tool` from the strip and asserts `aria-pressed=true` then a
  clip disappears. At HEAD `ArrangementSurface.tsx:372` was the only reader of
  the arrangement tool and tested `=== 'draw'`, so the click would have selected,
  not deleted → red.
- **T46** locates a `Knife tool` button inside `Tool — Song`. At HEAD
  `ARRANGEMENT_TOOLS` was `['select','draw','erase']` → the locator fails → red.
- **T47/T48** address the roll strip as `Tool — piano roll`; at HEAD its
  `aria-label` was `Tool` → red. T48 additionally drives the `Zoom the piano
  roll` group, which did not exist.
- **T49** filters `role="group"` labels starting with `Tool` inside the visible
  surface root. At HEAD the inline lane rendered its toolbar and hid it with
  `display:none`, so the DOM held a second `Tool` group → `['Tool','Tool']` →
  red. It also correctly scopes to `[data-surface-root]:not([hidden])`, which is
  the only honest definition of "on screen" in this shell.

All five pass on my run (below).

### U14 — no un-Escapable overlay

**A live render crash was forced** (the report said it could not be). There is no
debug hook in `src/test/e2eBridge.ts`; I crashed the app by making
`HTMLCanvasElement.prototype.getContext` throw and then pressing `=`, which
re-runs `GridLayer`'s draw effect — React 19 routes an effect throw to the
nearest boundary.

| claim | result |
|---|---|
| the card appears | `role="alertdialog"`, buttons `["Hide","Reload app","Try to recover"]` ✔ |
| the primary action holds focus from the first frame | `document.activeElement` = `Try to recover` ✔ |
| Escape = *Try to recover* | overlay gone, app repainted ✔ |
| a repeat crash arrives as the chip | with the fault still armed, `Recover` re-mounted and immediately re-crashed → **chip**, `role="status"`, text *"Something broke — your audio may still be playing."*, `Recover` + `Reload` both `tabIndex 0`, box `465 × 43` at the bottom-right, **no overlay, no dialog** ✔ (screenshot `.scratch/ux-1e-gate/chip.png`) |
| the chip does not steal focus | **✖ — it does.** `focusInChip: true`, `activeElement` = `Recover`. See **F5**. |
| Escape on the chip | correctly does nothing (the chip is not blocking) ✔ |

**The three confirms.** Keybindings driven live at 1440×900: Settings opened
(1 `role="dialog"`), a shortcut rebound so *Reset all* enabled, the confirm
opened (`role="alertdialog"` named `Reset every shortcut`), **Escape → confirm
closed, `settingsStillOpen: 1`** ✔. The mechanism is sound for all four: the
`oj-ui` `Modal` closes on a React `onKeyDown` bubble handler, and
`SyntheticEvent.stopPropagation()` calls the native one, so the confirm's handler
genuinely stops it reaching the Modal. Updates rollback and the AI YOLO gate are
desktop-tier and render the honest "this lives on the desktop app" state in the
browser — their unit tests (`UpdatesPanel.test.tsx +1`,
`AiPanel.test.tsx +1`, each asserting the Escape never reached `document`) are
accepted as sufficient, as the brief allows.

### HA-18 — roll zoom

| claim | result |
|---|---|
| every note ≥ ~24 px for a half-beat at the inline roll's opening zoom | **128/128 notes at exactly 24.0 px** ✔ |
| `resizeEdge` trims a 10 px note | `resizeEdge(1, 10) === 'start'`, `resizeEdge(9, 10) === 'end'`, `resizeEdge(1, 9) === null` — pinned in `geometry.test.ts`, and `inlineOpeningPxPerTick(ppq) × ppq/2 === 24` for ppq 96/480/960/1920 ✔ |
| `− +` controls and the `Ctrl+wheel` title | `Zoom out — Ctrl+wheel` / `Zoom in — Ctrl+wheel`, `aria-label`s `Zoom the piano roll out/in`, 24 × 24 each, inside a `role="group"` named `Zoom the piano roll` ✔ |
| `Ctrl+wheel` inside the lane zooms the roll not the Song | song clip width `1324 → 1324`, roll note width `24 → 36` ✔ |
| the full roll's opening zoom | **unchanged — 128/128 notes at 4.8 px, all under the resize floor.** See **F4**. |
| both themes | ✔ (above) |
| **not claimed, and it matters** | the lane's axis now disagrees with the ruler by 4.95× — **F1** |

The zoom strip covers ~1 152 px² of the note field in the lane's top-right
corner (the report says ~1 680 px²; measured smaller). It reads as chrome and I
do not think it is a problem.

### HA-20 — the live region

- **Empty at rest**: `[{ text: "", live: "polite", hiddenAncestor: false }]` on a
  freshly opened Paper Sketch ✔ (was `aria-live="assertive"` permanently
  containing *"Recording stopped"*).
- **Written only on a transition**: implemented as
  `useArrangementStore.subscribe((state, previous) => …)` comparing
  `isRecording`, so mount says nothing ✔.
- **No leak**: `useEffect(() => useArrangementStore.subscribe(...), [])` — the
  subscribe return *is* the cleanup, and the dep array is empty, so exactly one
  subscription per mount and it is disposed ✔.
- **No double-announce**: two `.arrangement-record-live` nodes exist once the
  roll surface is open (`SkyBand` is rendered by both hosts), but the inactive
  one is inside a `[hidden]` subtree (`inHidden: true`), so it is out of the a11y
  tree ✔. The other two live regions in the shell carry different content —
  `TransportPillHost`'s `role="status"` holds only `transportError`, and UX-1C's
  `src/a11y/LiveAnnouncer.tsx` holds history phrases. Nothing else announces
  recording ✔.

### HA-22 — one tool strip

| context | strips inside the visible surface root |
|---|---|
| Song | `["Tool — Song"]` ✔ |
| Song + inline roll open | `["Tool — Song"]` ✔ |
| Roll surface | `["Tool — piano roll"]` ✔ |

Verified in both themes. The `display: none` rule is gone from `PianoRoll.css`
and the toolbar is genuinely not rendered in `mode === 'inline'`, so it is a
structural guarantee rather than a CSS one ✔. Strip controls are keyboard
reachable (`tabIndex 0`, not disabled) ✔. Caveat: because the inline lane reads
`viewports.arrangement.tool`, the Song's strip is now the *only* control for the
lane's tools — which is the lane's stated decision #2, and is exactly why **F2**
(the dead tool keys inside the lane) matters more than it would otherwise.

### U15 — the step card

Measured on a real first run (`Build a beat`), all four combinations:

| shot | card box | overlap with the `SONG` card ("Beat rig") | max overlap with **any** rig node | lit cell |
|---|---|---:|---:|---|
| light 1280×800 | 440,587 → 840,776 | **0** | **0** | `oklch(0.3 0.16 300)` |
| dark 1280×800 | 440,587 → 840,776 | **0** | **0** | `oklch(0.88 0.068 300)` |
| light 1440×900 | 520,687 → 920,876 | **0** | **0** | `oklch(0.3 0.16 300)` |
| dark 1440×900 | 520,687 → 920,876 | **0** | **0** | `oklch(0.88 0.068 300)` |

Colours resolved through a 1 × 1 canvas, never by regexing `oklch()`. The lit
cell is byte-identical to `--accent-two-ink` in both themes, and
`--accent-primary` in the same frames is `oklch(0.66 0.19 40)` /
`oklch(0.72 0.19 40)` — nothing on the card wears it ✔.

- Title bar ✔ (`Steps`), `BEAT RIG` chip ✔, well ✔, grid inside the well ✔, hint
  inside the well ✔ (`"Click a cell to add or remove a hit."`), `.oj-step-grid`
  (the full-bleed strip) gone ✔.
- **Still a thin view over the clip's notes**: toggling cell 4 gave
  `aria-pressed true → false`, `history 1 → 2`, **notes 12 → 11**, and one
  `Ctrl+Z` restored both ✔.
- **Type floor holds**: title `600 15px Outfit`, hint `500 13px Outfit` (the sans
  floor), type chip `500 11px JetBrains Mono` uppercase, row labels
  `600 9.5px JetBrains Mono` uppercase — all inside DESIGN.md §3's sans-13 floor
  or the mono micro voice ✔.
- **`presets.ts` move**: the Song node at `{ KEYS_AT.x, 500 }` measures
  72,547 → 234,666 at 1280×800 — clear of the card (440,587) and of Keys, Synth
  Drum, Effect, Width and Speaker, all at 0 px overlap ✔.
- The two dead `body:has(.oj-step-grid)` rules are genuinely gone
  (`HelpPanel.css`, and `HintBubble.css` in commit `7e5a94e2`) ✔.

Screenshot `.scratch/ux-1e-gate/step-card-light-1280x800.png`. This reads as the
same instrument as the fourteen faceplates beside it. Good work.

### The `git stash` incident (report §0)

- `git stash list` is **empty** ✔.
- `git status --short` is **71** entries against the report's 69 — the delta is
  exactly `plans/ux-intuitive/UX-1E-REPORT.md` and
  `plans/ux-intuitive/UX-1C-REVIEW.md`, both created after the report was
  written ✔.
- Every file UX-1C's report names as touched is present in the working tree —
  `docs/shell.md`, the five `packages/oj-ui` components, `Canvas/ContextMenu.tsx`,
  `Canvas/NodeCanvas.{tsx,css}`, `CommandBar/useCommandSources.ts`,
  `Nodes/NodeWrapper.tsx`, `Shell/Topbar.tsx`, `keymap/{arbiter,useKeymap}.ts`,
  `utils/spawnPlacement.ts`, and the whole untracked `src/a11y/` tree ✔.
- `git reflog` shows only commits plus one `reset: moving to HEAD` (a mixed reset
  to the same commit — index-only, working tree untouched). `git fsck` dangling
  objects are ordinary worktree churn, none of them a stash entry.

**Nothing was lost.** The real find here is **F9**: the ops.ts work is committed,
not uncommitted.

**Re-checked at the end of the review.** Two commits landed while I worked —
`b14c21d5` (transportBlame stub) and `10affe46` (UX-1C's canvas grammar, which
swept in all of that lane's files), taking `git status --short` from 71 entries
to 42. Every UX-1E file is still present and uncommitted: `docs/timeline.md`,
`e2e/timeline-tlist.spec.ts`, `AppErrorBoundary.{tsx,css}`,
`Arrangement/{ArrangementSurface,RulerStack,SkyBand,useClipGesture}`,
`CommandBar/AiPanel.tsx`, `PianoRoll/{PianoRoll.tsx,PianoRoll.css,geometry.ts}`,
`Settings/{KeybindingsPanel,UpdatesPanel}.tsx`, `Shell/StepGrid.{tsx,css}`,
`Toolbar/HelpPanel.css`, `rigs/presets.ts`,
`store/{editingContextStore,keybindingsStore}.ts`, and all five new test files.
`git stash list` is still empty.

### Gates

| gate | result |
|---|---|
| `bunx tsc --noEmit -p tsconfig.app.json` | **clean**, exit 0 |
| `bun run lint` | **clean** (`$ eslint .`, no output), exit 0 |
| `bun run test:run` | **1 failed / 3268 passed, 257 files** — the failure is `CommandBar.test.tsx > "Tab from search sends the typed prompt to AI"`, `Test timed out in 5000ms` under a 240 s parallel run. Re-run alone: **36/36 passed in 17 s**, that case in 803 ms. `transportBlame.test.ts`: **16/16, no unhandled rejections** in either run. See **F10**. No other red. |
| `bun run build` | **green** — `precache 87 entries (6693.95 KiB)`, `dist/sw.js` written, exit 0 |
| Playwright (node), `e2e/timeline-tlist.spec.ts` + `e2e/arrangement-editing.spec.ts` | **63 passed, 5 skipped (58.3 s)**, exit 0 — including **T45, T46, T47, T48, T49**. Run on a lane-local config (`.scratch/ux-1e-gate/playwright.gate.config.ts`) pointing `baseURL` at `:5254` instead of building and serving on 4173. |

Dev server killed (`:5254` returns nothing).

---

## Not verifiable

1. **Audio actually playing.** Every check above was headless Chromium. Erase,
   Knife and the step card are document edits republished through the existing
   gesture path, so no new audio path was introduced — but nobody has heard them,
   and **F1**'s two-playheads consequence is exactly the kind of thing that only
   shows up with the transport rolling. A human should open a clip inline and
   press play before this merges.
2. **Touch / pen for the new strokes.** The erase sweep uses the shared
   `ownPointerGesture` lifetime, and T39 (touch parity) is green, but it was not
   extended to Erase or Knife. `document.elementFromPoint` behaves the same for
   touch, so the risk is low; it is untested.
3. **The Updates rollback confirm and the AI YOLO confirm in a browser.** Both
   are `__TAURI__`/`DESKTOP_CAPABILITIES`-gated; the browser build renders the
   honest desktop-only state. Their unit tests are accepted, per the brief.
4. **The hint bubble / shortcut-card overlap** the report measures at 0. My
   selectors found neither element on the first-run beat rig, so I could not
   confirm or deny it. The rig-node overlaps (all 0) are measured.
5. **F1 option (a)'s side effects.** I have not built the min-note-width variant,
   so I cannot say what it does to two adjacent short notes at the Song's axis.
   That is the lane's call to make and re-measure.

---

## What the report got right that I checked and could not fault

- Every behavioural claim in §1–§6 reproduced except the two named in **F3** and
  **F4** and the focus detail in **F5**.
- The erase stroke correctly aborts on `Escape` — `ownPointerGesture` wires
  `keydown`/`blur`/`pointercancel` to `abort`, so spec §1's "aborting restores
  the pre-gesture document exactly" holds without the lane adding anything.
- The decision to route both tools through `useClipGesture` rather than
  `ArrangementSurface` (§10.7) is right: the clip's own press already
  `stopPropagation`s, so a surface-level implementation would have forked the
  press.
- `getDerivedStateFromError` deliberately not resetting `collapsed` is correct
  and well argued, as is §10.4 (the chip does not re-render `children`, because a
  boundary cannot catch its own render's throw).
- The `Ctrl`-suspends-snap knife plus the "the grid moved that cut" notice is a
  genuinely good piece of product judgement — the honest answer to a press that
  appears to do nothing.
- The new unit tests are specific and non-vacuous. `splitNotes.test.ts`'s
  "one inverse puts the note back whole" and `geometry.test.ts`'s
  "it is a FLOOR, not a target" both pin the *reason*, not the number.
