# W4-P5 REVIEW — Ctrl+K palette + AI panel + canvas context menu → oj-ui Menu

Reviewer: Opus 5 (product-design gatekeeper, read-only). Verified against the working tree on
`t3code/openjammer-redesign-timeline`, one Chromium on port 5210 under `node`, both themes.

**Verdict: DO-NOT-COMMIT — one contained must-fix (context-menu typeahead escapes the open
submenu). Everything else in the lane is verified and commit-ready; the fix is ~8 lines in
`ContextMenu.tsx:onRootKeyDown`.**

Artifacts: `plans/redesign-new-dna/.scratch/w4-p5-gate/` — `gate.mjs` / `gate2.mjs` / `gate3.mjs`
(re-runnable), `gate-log.txt` / `gate2-log.txt` / `gate3-log.txt`, `gate-results.json`, 30
screenshots (light + dark).

---

## Gates (re-run by me, not taken from the report)

| Gate | Result |
|---|---|
| `bun run test:run -- src/components/CommandBar src/components/Canvas` | ✅ 6 files / **68 tests** pass |
| `bunx tsc --noEmit -p tsconfig.app.json` | ✅ exit 0, **no** errors (not even other lanes') |
| `bunx eslint src/components/CommandBar src/components/Canvas` | ✅ 0 problems |
| `bun run build` | ✅ exit 0 |
| Console / page errors during the whole browser pass | ✅ none |

---

## 1. Palette

**Menu physics — exact.** Measured from `getComputedStyle`, both themes:

| Handoff `.nj-menu` | Measured |
|---|---|
| panel `padding:6px; border-radius:12px` | `6px` / `12px` ✅ |
| row `500 14px`, `8px 10px`, `radius 8px` | `500 14px`, `8px 10px`, `8px` ✅ |
| category `600 10.5px`, `.1em`, uppercase | `600 10.5px`, `1.05px`, uppercase ✅ |
| keycap `500 11px` mono | `500 11px` **JetBrains Mono** ✅ |
| input = `.nj-input` | surface fill, `--border-strong`, `radius-md`, `500 14px`, accent border + `--focus-ring` on focus ✅ |

**Ranking — verified live, both themes.**

| Query | Top rows | Verdict |
|---|---|---|
| `speak` | **Add Speaker** [selected] · Add Sampler · Open Settings | ✅ exact-word-prefix first |
| `keyb` | **Add Keyboard** [selected] · Add Midi · Add Sampler · Add Keys | ✅ |
| `looper` | **Add Looper** [selected] · Loop from time selection · … | ✅ |
| `speaker` | **Add Speaker** [selected] · Add Sampler | ✅ |
| learned-vs-exact: trained `prefixWins['key'] → Add Keys` (3 real picks), then typed `keyboard` | **Add Keyboard** first | ✅ the exact tier (1 000 000) beats the learned prefix win (100 000) |
| …and typing only `key` after the same training | **Add Keys** first | ✅ the learned preference still wins a *partial* query — the two tiers are correctly ordered |

The top row is always the controlled selection (`aria-selected="true"` on row 0 in every query).
`exactnessBoost()` is a pure, unit-tested 30-line module; the boost is applied once at
`CommandBar.tsx:283`.

**Disabled rows never default-selected** — code (`ranked.find(r => !r.action.disabledReason)`,
`CommandBar.tsx:343`) + unit test (`CommandBar.test.tsx:262`). *Live-unverified*: no disabled
action surfaced in the browser tier during the pass (the two `disabledReason` producers live in
another lane's `Shell/TransportPillHost.tsx` and were not registered). Not a gap in this lane.

**"Ask AI" is a footer, not a result** — verified: `.command-bar-ask` is a `<button>` outside any
`[cmdk-item]`; on an empty set there are **0** `[cmdk-item]`s. Browser tier shows the honest
`The agent runs in the desktop app`; desktop tier shows `Ask the agent` + a `Tab` keycap.
**Enter on an empty set hands off** — verified with capabilities rewritten to the desktop row:
`zzzqq` → Enter → `data-mode="ai"`. In the browser tier Enter correctly does nothing (no agent to
hand to) and the empty state teaches `Try a node name — Speaker, Looper, Effect.` instead of
pointing at an agent that cannot run. This is the right call.

**Esc cascade + focus restore** — Escape from search closes; from AI returns to search, second
Escape closes (verified in both tiers, including from the AuthChooser detail: detail → chooser →
search → closed). Focus is restored to the exact pre-open element (probe button regained focus
after Escape in both themes). The document-level backstop bails on `defaultPrevented`, so it
cannot double-fire.

**No note-key leak** — with a Keyboard node on the canvas, typing `qwerty` into the palette
produced `noteEvents() === []` and the text landed in the input. ✅

**z-order** — `.command-bar-overlay` = `--z-top` (10000) > onboarding `--z-modal` (2000) >
topbar / transport pill / help panel `--z-panel` (100) > `--z-popover` (1000). Nothing in the app
sits between. The one thing above it is the Sonner toaster (`999999999`, sonner's own default) —
correct in principle, but see finding 4.

---

## 2. AI panel

- **Browser tier**: `PanelHeader` "Ask the agent" + back chevron, an oj-ui `Callout`
  ("AI requires the desktop app… nothing about your session leaves your machine"), a primary
  *Get the desktop app* and a ghost *Back to search*. **0 inputs** — no dead composer. The panel
  **hugs** (215px tall, not a half-screen of empty box). Tone is honest and calm. ✅
- **Escape with no text field** works (this was the audited dead-Escape case). ✅
- **Desktop tier** (capabilities route-rewritten): Tab from search hands off; AuthChooser renders
  with focus already inside the palette, `PanelHeader`, 15 provider rows, arrow nav, Enter into
  the detail. Detail = danger `Callout` (non-dismissible training notice), `oj-field`, **mono**
  `oj-input--mono` password input ("Paste your API key, then press Enter…"), primary *Save key*.
  ✅
- **Contrast — every rendered text pair clears AA in both themes.** Measured from real computed
  colours with oklch resolved through a canvas (the lane's script measured token sources; this
  measures the pixels):

  | Pair | light | dark |
  |---|---:|---:|
  | keycap glyph on a rest row (**tightest**) | 4.57 | **4.50** |
  | category heading / footer hint / agent-off note | 5.49 | 5.05 |
  | selected row label (accent ink on the fill) | 5.34 | 5.96 |
  | mono type chip (rest / selected row) | 5.92 / 7.13 | 6.18 / 6.93 |
  | rest row label, input text | 17.05 | 14.36 |
  | auth: training-notice title / body | 6.72 / 7.13 | 6.39 / 6.93 |
  | auth: keychain hint, *Save key* on accent | 5.49 | 5.05 |

  The report's claim of "tightest 4.50 dark keycap" is **confirmed exactly**.
- **Reduced motion**: palette and menu both compute `animation-name: none` under emulation. ✅
- **UNVERIFIED (accepted)**: populated model picker, `/resume` session list, slash rows with a
  live session, rewind rows with real turns, streaming, YOLO sheet, and the post-`storeKey`
  handoff all need a native Pi run. The lane declared these; I confirm they are unreachable from
  a browser and that their empty/loading shapes are correct.

---

## 3. Context menu

- Right-click on empty canvas → oj-ui `Menu`; panel `6px`/`12px`/`min-width 200px`, rows
  `500 14px` `8px 10px` `radius 8px`, category `600 10.5px` uppercase. ✅
- **Keyboard**: first row focused on open · ArrowDown/ArrowUp · End → *Cancel* · Home → *Input* ·
  typeahead `e` → *Effects* · ArrowRight → discloses exactly one submenu and focuses *Add
  Keyboard* · ArrowLeft → closes and returns focus to the category row. ✅
- **Escape cascade**: first Escape closes only the submenu (menu still open, 0 disclosed),
  second closes the menu; the graph/selection is untouched (node count unchanged). ✅
- **Focus restore** on unmount ✅ (unit-tested; live behaviour consistent).
- **Click a category discloses and does not close** — verified, including a *second* click on the
  same row (touch double-tap): still open, never toggled shut. ✅ Disclosure is `data-open`, not
  `:hover`, so touch and keyboard reach it exactly as a mouse does.
- **Portal + flip/clamp at all four corners** — measured boxes fully inside the 1280×800 viewport:
  TL `20,90 → 220,402`; TR `1060,90 → 1260,402` (submenu flipped left, `881→1061`); BR
  `1060,468 → 1260,780` (submenu flipped, `881→1061`); BL `20,478 → 220,789`. Root and submenu
  `inside === true` in every case, both themes. ✅ (The BL probe failed to open in run #1 only
  because a node from an earlier step sat under the cursor — see below.)
- **Right-click on a NODE still opens nothing.** Pre-existing gap, unchanged: `NodeCanvas.tsx`
  gates the menu on `rightClickOnCanvas.current`. `NodeCanvas.tsx` is **untouched** by this lane
  (`git status` clean for it), which is correct scope discipline. Carry to W5-P10.
- **Command list is the same curated subset** — the menu still reads `queryActions(ctx, {surface:
  'menu'})` from the untouched registry; `commandRegistry.ts`, `actionContext.ts`,
  `paletteScore.ts`, `paletteLearningStore.ts`, `useCommandSources.ts` are all unmodified, so the
  palette's command-id set is provably unchanged.
- **Reduced motion**: explicit `animation: none` block; computed `none`. ✅

---

## 4. Regression hunt

| Check | Result |
|---|---|
| Node added from the menu lands at the click point | ✅ right-click at client `(700,500)`, canvas rect top `46` → Speaker created at graph `(700,454)` — exact |
| Keyboard inside the menu never triggers canvas bindings | ✅ typing `qwe` → 0 note events; `Delete` inside the menu → node count unchanged |
| Escape closes only the menu, not the selection | ✅ graph snapshot identical across the cascade |
| `NodeCanvas` right-click wiring | ✅ file untouched |
| `useCommandSources` / registry semantics | ✅ untouched (no diff) |
| Console / page errors | ✅ none in either theme, any flow |

---

## 5. Taste (vs the handoff Menu row, vs Raycast/Linear)

Genuinely good. The row rhythm, the inset group hairlines, the mono type chip pinned right, the
`↑↓ / ↵ / Esc` footer with the agent affordance on the opposite edge — this is the first surface
in the redesign that would survive a screenshot next to Raycast. The browser-tier AI state is the
best copy in the wave: it explains *why* rather than apologising, and it hugs.

Three notes, none blocking:

- **Selected vs rest is carried almost entirely by hue.** The selected fill is only **1.12:1
  (dark) / 1.20:1 (light)** against the panel; the ink flips to accent (5.34/5.96:1). Because cmdk
  syncs selection to pointer-move there is never a hover/selected conflict — I checked, exactly
  one row is ever filled. But on a glare-lit stage, or with a red-green deficiency, "which row
  does Enter run" rests on a colour shift alone. A 2px leading accent bar, or one more step of
  inset fill, would make it unmistakable without adding motion.
- **The search field's focus ring is permanently lit** (the input is always focused while the
  palette is open), so the loudest element in the panel is a state indicator that never changes
  state. Raycast/Linear let the panel edge do that work. D5's input construction justifies it —
  worth one deliberate look rather than inheritance.
- **The emoji category glyphs** (⌨️🎻🔄✨🔧🔊) are the one un-DNA element left in the menu; they
  read as heritage next to the otherwise monochrome system. Deliberate and documented — flagging
  for the coverage matrix, not for this lane.

---

## 6. Must-fix (ranked)

1. **Context-menu typeahead escapes the open submenu.** `ContextMenu.tsx:364-385` — the root
   panel's `onRootKeyDown` handles *every* printable key regardless of which panel owns focus, and
   a submenu row's keydown bubbles to it (the submenu is a DOM child of the category `MenuItem`).
   Reproduced live in **both** themes: focus *Add Keyboard* inside the **Input** submenu, press
   `o` → focus silently jumps to the root **Output** row while the Input submenu stays open, with
   no visual cue that focus left the panel. Any of `i r e u o c` does this (they prefix the root
   categories) — i.e. reaching for "Organ", "Effect", "Reverb" inside a submenu yanks you out.
   The same handler also swallows the key, so submenu typeahead — the one place it is most useful
   ("s" for Speaker inside Output) — never works at all.
   *Fix:* bail out of the root typeahead when `document.activeElement.closest('.context-menu-submenu')`,
   and run the same routine over the focused submenu's own rows. ~8 lines, unit-testable.
   *Why it blocks:* the gate's own bar — it breaks a keyboard path this lane introduced, and it
   misdirects focus without telling the player.

## 7. Should-fix / carry-forward (not blocking this commit)

2. **No focus containment while the palette is open** (pre-existing — `HEAD`'s CommandBar has no
   trap either). From the AI/auth view, one `Tab` walks focus out to `BODY` and then into the
   topbar behind the scrim (File / Edit / View / engine-health dot are all reachable and
   activatable under a scrim that says they aren't). Search mode is fine because `Tab` there is
   the agent handoff. A containment that exempts search-mode `Tab` would close this without
   touching the lane's Decision 1 (not adopting `Modal`).
3. **Sonner toasts overlap the palette.** Toaster is `z-index: 999999999`, `position="top-left"`,
   `offset="80px"` (`App.tsx:664`, another lane's file); the palette's top-left corner is at
   `(320, 96)`. A toast will land on the search field while the player is typing into it. A toast
   *over* a palette is defensible; a toast *on the input* is not. Orchestrator call — reposition
   the toaster or cap it below `--z-top` while the palette is open.
4. **Right-click on a node opens nothing** (UI-003-adjacent, pre-existing, correctly out of scope
   here). W5-P10.
5. `--border-strong` on `--bg-node` measures 3.35:1 (light) / 6.07:1 (dark) as a non-text
   boundary — the lane's D4 flag reported this as 1.73/1.78 from token sources; measured against
   real pixels it clears 3:1 in both themes. **The flagged concern is not real** — no action.

---

## Recommendation

**DO-NOT-COMMIT** as-is; **COMMIT immediately after must-fix 1**. The lane's report is accurate
on every claim I could check independently — ranking tiers, the 4.50 keycap, the corner clamps,
the portal fix, the honest browser tier, the untouched registry. The typeahead scoping is the
single defect, and it is contained to one function.
