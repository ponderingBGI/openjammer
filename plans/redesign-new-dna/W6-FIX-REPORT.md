# W6-FIX — closing the W6-CAP defects

**Lane:** W6-FIX (fix the defects the coverage-capture lane found).
**Date:** 2026-08-29 · **Branch:** `t3code/openjammer-redesign-timeline` (worktree
`t3code-2faff191`) · Windows 11, `bun` only, Playwright under `node`.

**Method.** Every item is closed by a change *plus* a test that fails on the pre-fix code,
and then re-measured in a real browser in both themes. To prove the tests are pins and not
decorations, the nine pre-fix files were restored from `HEAD` into the working tree, the
five new test files were run, and **19 assertions failed**; restoring the fixed files
turned all 75 green again. Raw evidence:

- `plans/redesign-new-dna/.scratch/w6-fix/web-surfaces-results.json` — the download page
  and two docs pages, both schemes: every text run, every border, every shadow.
- `plans/redesign-new-dna/.scratch/w6-fix/app-results.json` — the seven in-app states,
  both themes.
- Screenshots, same directory, `<slug>-{light,dark}.png` (12 web + 14 app).

**Gates.** `bunx tsc --noEmit -p tsconfig.app.json` clean · `bunx eslint src/components
public apps/docs/src` clean · `bun run build` OK · `cd apps/docs && bun run build` OK ·
`git diff --check` clean · `bun run test:run -- src/components` **1180 passed / 112 files**,
with two unrelated timeout flakes (`CommandBar.test.tsx` "Tab from search…",
`KeybindingsPanel.test.tsx` "should render all keybinding actions") that both pass on their
own — the known full-parallel flake pattern in this repo, not a regression.

---

## 1. D1 — `public/download` is the New DNA

**Was:** the file said so out loud — *"The Living Sketchbook … hard blur-free offset
shadows"* — with a private literal palette (`--oj-blue: #4A90C2`), `2px solid` ink borders
on every card and button, three zero-blur offset shadows, three text runs at **3.04–3.45:1**,
and `<meta name="color-scheme" content="light">`, so the light and dark captures were
*the same image*.

**Changed**

| File | What |
|---|---|
| `public/download/oj-tokens.css` *(new, 282 lines)* | The DTCG palette transcribed for a surface that has no React and therefore no `applyTheme()`: the theme-invariant primitives, then light on `:root`, dark under `@media (prefers-color-scheme: dark)`, then `[data-theme='dark']` / `[data-theme='light']` so an explicit choice beats the OS. |
| `public/download/download.css` | Rebuilt end to end. Every colour, radius, shadow, size and curve is now a `var(--…)`. Surfaces are `--bg-node` cards with one `--border-subtle` hairline and `--shadow-overlay`/`--shadow-raised`; buttons are the flat oj-ui construction (no border, no rest shadow, `--motion-fast` colour, `scale(var(--press-scale-btn))` press) with one accent fill on the detected-OS card and `--bg-tertiary` for the rest; the title is `clamp(var(--text-xl), 6vw, var(--text-2xl))`, so the page never leaves the type scale; the ground carries the same dot grid `.node-canvas-grid` draws, same token, same 20px pitch. |
| `public/download/index.html:11–20, 30` | `color-scheme: light dark`, two `theme-color` metas gated by `prefers-color-scheme` (the one place a custom property is impossible — both are pinned against `--bg-canvas`), and the token sheet linked before the page styles. |

Content and every download link are byte-identical.

**Measured** (`web-surfaces-results.json`, 1280×800, `deviceScaleFactor: 1`):

| | light | dark |
|---|---:|---:|
| text runs swept | 23 | 23 |
| **worst text run** | **5.08:1** | **6.27:1** |
| text runs below AA | **0** | **0** |
| zero-blur offset shadows | 0 | 0 |
| borders ≥2px | 0 | 0 |
| `filter: drop-shadow` / cursive faces | 0 / 0 | 0 / 0 |
| faces resolved | `Outfit`, `JetBrains Mono` | same |
| console + page errors | 0 | 0 |

Two deliberate non-text readings, both matching the app rather than diverging from it: the
card hairlines measure **1.31 / 1.27:1** and the footer rule **1.18 / 1.40:1**. That is
`--border-subtle` on `--bg-canvas`, which DESIGN.md §2 defines as *the hairline… this is the
default* and which the repo's own `contrast.test.ts` never holds to 3:1 (it holds
`--border-strong` and `--border-control`). The cards are separated by fill and by
`--shadow-overlay`, not by their edge; a node card in the app reads exactly the same.

**Pin:** `src/components/__tests__/webSurfaces.test.ts` parses the sheet and asserts zero
literal `#`/`rgb()`/`oklch()`, zero borders over 1.5px, zero `2px solid`, every `box-shadow`
a `--shadow-*`/`--focus-ring` token, no zero-blur offset anywhere, and no display face.
`webSurfaceTokens.test.ts` reads `packages/oj-tokens/tokens/themes/{light,dark}.json` and
asserts the token sheet declares **the whole 54-key palette, value for value, in all four
blocks**, plus the primitives verbatim, plus the two `theme-color` metas. On the pre-fix
files these fail 4× (literals, borders, shadows, both-schemes).

---

## 2. D2 — `apps/docs` is the New DNA

**Was:** the same literal palette wired straight into Starlight's scale
(`--sl-shadow-sm: var(--oj-shadow-rest)` = `2px 3px 0`), `2px` borders on cards, asides,
code frames and buttons, a second hand-maintained dark block (the one that had already
drifted), and four light-theme runs at **3.04:1**.

**Changed**

| File | What |
|---|---|
| `apps/docs/src/styles/oj-tokens.css` *(new)* | The same transcription as the download page. |
| `apps/docs/src/styles/custom.css` | Rewritten as **one** `--sl-*` → oj-token remap. Starlight's inline theme script writes `data-theme` before paint and the token sheet answers both `data-theme` and `prefers-color-scheme`, so a single bare `:root` block serves *both* themes — there is no second dark block left to drift. Asides become Callouts (one hairline, `--shadow-raised`, the 4px inline-start bar flattened to 1px, the variant tinting the **title only** via `--sl-color-asides-text-accent` → `--text-primary` / `--accent-ink` / `--warning-ink` / `--danger-ink`, matching `oj-ui`'s own Callout table). Cards, code frames and buttons get hairlines and the depth roles; `--sl-shadow-{sm,md,lg}` now point at `--shadow-raised` / `--shadow-overlay`. |
| `apps/docs/src/components/Hero.astro:29–48` | **Scope note:** this file is not in the lane's ownership list, but D2's measured defect explicitly names `.oj-hero-grid`'s 2px ink border and `3px 4px 0` shadow, no other lane owns `apps/docs`, and leaving it would have made a "D2 fixed" claim false. It is now a surface card on the token dot grid, and the two tier pills are Chips (inset pill, text tone) instead of coloured 2px rings. |
| `apps/docs/astro.config.mjs:27–31` | Comment only — the block still said "Living-Sketchbook skin". |

Two extra fixes found by measuring rather than reading:

- **The current sidebar page was a fill drench.** Starlight paints it
  `background: var(--sl-color-text-accent)` under `--sl-color-text-invert`; once the accent
  came from our tokens that measured **2.65:1** in light. DESIGN.md §6 forbids the shape
  outright (*"Don't express selection as a fill drench"*), so
  `#starlight__sidebar a[aria-current='page']` is now `ListRow`'s `is-current`: the inset
  fill with an `--accent-ink` label.
- **`kbd` was 12px sans** in Starlight's search hint ("Ctrl K") — under the floor. It is
  mono now, like `Kbd`.

**Measured** — docs home + `play/first-patch`, both schemes:

| | home light | home dark | guide light | guide dark |
|---|---:|---:|---:|---:|
| text runs swept | 35 | 35 | 151 | 151 |
| **worst text run** | **4.95** | **5.59** | **4.95** | **5.59** |
| below AA | 0 | 0 | 0 | 0 |
| sub-13px sans | 0 | 0 | 0 | 0 |
| hard shadows / ≥2px borders / glows | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| console + page errors | 0 | 0 | 0 | 0 |

**Pin:** the same `webSurfaces.test.ts` sweep over `custom.css` and the Hero's `<style>`,
plus two docs-specific assertions — every `--sl-*` value must be a `var(--…)`/`color-mix()`
(never a literal), and the file must contain **no** `:root[data-theme=…]` block at all,
because a second mapping is the shape that drifted.

---

## 3. D3 — the agent-pending ring reaches every node this lane owns

**Was:** `NodeShell` renders `.is-agent-pending`, but only when its owner passes
`agentPending`. Ten of twenty node components render their own `NodeShell` and omitted it,
so an agent that minted a Speaker, a Math node or a Song showed the player nothing.

**Changed** — `useIsAgentPending(node.id)` (the same hook `NodeWrapper` uses; no new state,
no new prop shape) added to seven components:

| File | hook | `agentPending` |
|---|---:|---:|
| `src/components/Nodes/MathNode.tsx` | `:64` | `:107` |
| `src/components/Nodes/SpeakerNode.tsx` | `:93` | `:247` |
| `src/components/Nodes/MicrophoneNode.tsx` | `:99` | `:245` |
| `src/components/Nodes/ContainerNode.tsx` | `:58` | `:147` |
| `src/components/Nodes/SongNode.tsx` | `:49` | `:66` |
| `src/components/Nodes/CanvasIONode.tsx` | `:58` | `:130` |
| `src/components/Nodes/PortPanelNode.tsx` | `:107` | `:184` |

**Verified live**, the exact state W6-CAP used (`agentSessionStore` `phase: 'running'` with
an empty `runBaseline`), on an `add` node placed from the real context menu:

```
before   oj-node schematic-node math-node add
after    oj-node is-agent-pending schematic-node math-node add     (light AND dark)
```

Screenshots: `w6-fix/node-agent-pending-add-{light,dark}.png`.

**Pin:** `src/components/Nodes/__tests__/agentPendingRing.test.tsx` — 21 assertions. Each of
the ten owned node **types** (`add`, `subtract`, `speaker`, `microphone`, `container`,
`song`, `canvas-input`, `canvas-output`, `input-panel`, `output-panel`) is mounted through
the real `NodeWrapper` dispatch, mid-run and after, plus one row proving a node the run did
*not* create never wears the ring (otherwise the ring would light the whole patch and mean
nothing). On the pre-fix `MathNode` the `add` and `subtract` rows fail.

**Follow-up for P7c** (their files, one line each, same shape):
`LibraryNode.tsx:1372`, `LooperNode.tsx:912`, `SamplerNode.tsx:517`,
`SamplerVisualNode.tsx:153`. Adding their four types to the `OWNED` list in the test above
is the whole extension.

---

## 4. D4 — the 13px sans floor

`--text-xs` is **11px** and DESIGN.md §3 assigns it to JetBrains Mono only. Each run below
is sans **prose or an actionable label**, not an uppercase mono micro-label, so each lifts
to the floor rather than changing face. (The one candidate for the mono voice —
`.oj-set-section__title`, which is already uppercase and tracked — is a section *heading*,
and the Outfit-Is-the-Voice Rule says a heading stays in the sans; it went to 13px.)

| File:line | Run | Was → is |
|---|---|---|
| `Settings/SettingsPanel.css:109` | `.oj-set-section__title` — every Settings section caption | `--text-xs` → `--text-sm` |
| `SafeMode/SafeModeScreen.css:151` | `.oj-fullscreen__link` — "Open a different project", "Send a report", onboarding's "Skip, take me in" | `--text-xs` → `--text-sm` |
| `Toolbar/HelpPanel.css:49` | `.oj-help__mode` — "Keyboard 2" / "Config" | `--text-xs` → `--text-sm` |
| `Plugins/PluginWindowShell.css:48` | `.plugin-window-identity span` — "on \<node\>" | `--text-xs` → `--text-sm` |
| `Plugins/PluginWindowShell.css:68` | `.plugin-window-dirty-label` — "Unsaved" | `--text-xs` → `--text-sm` |

**Three more the capture could not have seen**, found by the sheet test rather than the eye:

| File:line | Run | Why W6-CAP missed it |
|---|---|---|
| `Toolbar/HelpPanel.css:64` | `.oj-help__warning` — the honesty copy | only rendered when the keyboard mode is unassigned |
| `SafeMode/SafeModeScreen.css:86` (rule at `:76`) | `.oj-fullscreen__option` — the big choice cards, `16px` | not a floor break; **off the scale** (30/22/15/14/13). Now 15px. |
| `AppErrorBoundary.css` | title `18px`, mono `12px` | flagged as D7-secondary; both now on the scale (15px / 11px) |

**Measured live**, both themes, each surface reached the way a player reaches it (Settings
via `openjammer:toggle-settings` → About; Help via `openjammer:toggle-help`; Safe Mode via a
seeded 3-boot crash marker so the app's own `runRecovery` decides; the plugin strip via
`?plugin-window=` + a stubbed Tauri `invoke`): **sub-13px sans runs = 0 in all eight
captures**, and zero contrast failures, zero thick borders, zero hard shadows.

**Pin:** `src/components/__tests__/typeFloor.test.ts`. The rule is deliberately strict — a
block that sets a sub-13px size must **declare the mono face in the same block**, because
"it happens to inherit mono from an ancestor" is exactly how an 11px sans run ships. A
second assertion holds every `font-size` in the four sheets to a step that exists. On the
pre-fix files, two of the eight assertions fail.

---

## 5. D5 — green means healthy, not chosen

`src/components/CommandBar/ModelPicker.tsx:312`

```diff
-{isCurrent && <Chip tone="success">current</Chip>}
+{isCurrent && <Chip>current</Chip>}
```

The chip stays (the word is the affordance); the tone goes. The row already said "this is
the one" twice without it — `ListRow current` draws the 6px `--accent-ink` dot and sets
`aria-current` — so nothing is lost and the Signal-Not-Brand Rule is kept.

**Measured live** (`cmdbar-model-picker-{light,dark}.png`, reached through the real header
model chip with the model-catalog SWR cache seeded):

```
chipClass  "oj-chip"                                (no oj-chip--success)
chipColor  rgb(90,88,80) light · rgb(171,168,156) dark   (= --text-secondary)
rowClass   "oj-list-row is-selected is-current"
aria-current "true"
```

**Pin:** `src/components/CommandBar/__tests__/ModelPicker.test.tsx` renders the real picker
against the real `authStore` + `modelCatalogStore` with `piSessions` mocked, and asserts the
pill's class is exactly `oj-chip` **and** that the row still carries `is-current` +
`aria-current` — so a future "fix" that deletes the mark entirely fails too. Fails on the
pre-fix component.

---

## 6. D7 — the error boundary's transcription

`AppErrorBoundary.css` is literal-only on purpose: `main.tsx` mounts it outside the app
tree, so it renders exactly when `applyTheme()` may never have run. Its header says *"if the
palette moves, this file must be updated BY HAND"* — and it hadn't been.

- `:154` dark `.app-error-title` `#F84B4B` → **`#FF7771`**. `#F84B4B` is
  `--accent-danger` (the *fill*) where the *ink* belongs; the correct value is dark
  `--danger-ink` `oklch(0.785 0.21 25)`. That colour is outside sRGB, and Chromium **clips**
  rather than gamut-maps it, so the honest transcription is the clipped `#FF7771` (CSS
  Color 4 gamut-mapping would give `#FF9088`, which is not what the screen shows). On
  `#201F19`: **4.80:1 → 6.39:1**.
- `:69` title `18px → 15px`, `:82` mono `12px → 11px` — both now steps that exist.
- Header updated: the dark danger value, a pointer to the new gate, and the missing sentence
  justifying the file's own `prefers-reduced-motion` block (the blanket rule lives in
  `global.css`, which is precisely what may have failed to load here).

**Pin:** `src/components/__tests__/appErrorBoundaryTokens.test.ts` — 26 assertions. It reads
the DTCG token files, converts them the way the browser paints them, and checks **eleven
declarations across both scheme blocks** (card border/background/colour, title, message,
note, button, primary button, on-accent text). No hand copies anywhere in the test. On the
pre-fix file the dark `.app-error-title` row fails — and the light one passes, which is
exactly why the drift survived: the bug was invisible in the theme people develop in.

---

## 7. D8 — the `/resume` filter field

**Root cause, not a nudge:** `width: auto` on an `<input>` is its **intrinsic** size (~210px
from the default `size` attribute), never its parent's. The model picker's filter is
full-bleed only because it is a direct child of that picker's own flex column and
`align-items: stretch` does the work; `SessionPicker` puts the identical
`.command-bar-input` inside cmdk's root `<div>`, which is not a flex container. The fix
gives cmdk's root the same stretching column — same class, same component, no fork:

```css
.command-bar-sessions [cmdk-root] {
    display: flex; flex-direction: column; flex: 1; min-height: 0;
}
```

**Measured live**, both themes: field **606px** in a **640px** panel with a **17px** gutter
(was ~210px floating at the left). Screenshot `w6-fix/cmdbar-sessions-{light,dark}.png`.

**Also fixed on the two picker sub-views** (found by measuring them, same D4 class):

| File:line | Run | Change |
|---|---|---|
| `CommandBar.css:772` | `.command-bar-ai-hint` — "↑↓ choose · ↵ resume · Esc back" | 11px sans → `--text-sm` (the `Kbd` caps inside keep their 11px mono) |
| `CommandBar.css:883` | `.command-bar-models-help` | 11px sans → `--text-sm` |
| `CommandBar.css:979` | `.command-bar-session-current` — "· current" | 11px sans → `--text-sm` |
| `CommandBar.css:988` | `.command-bar-session-id` | 11px mono is legal, but it measured **3.93 light / 3.80 dark** on the *selected* row (whose fill is 7% deeper than the inset `--text-muted` was chosen against). Now `--text-secondary`. |

After: both sub-views report **0 contrast failures and 0 sub-13px sans** in both themes.

**Scope note — the AuthChooser twin.** `AuthChooser.tsx` puts its field inside the same cmdk
root and shares the same CSS rule, so it has the identical ~210px field. It is not this
lane's surface and W6-CAP did not flag it; the fix is one selector
(`.command-bar-auth [cmdk-root]` added to the rule above). **Follow-up.**

**Pin:** in the ModelPicker test file — `SessionPicker.tsx` must still use
`className="command-bar-input"` (no second Input), the `[cmdk-root]` rule must declare the
flex column, and none of the four runs above may name a sub-13px size. Fails on the pre-fix
sheet.

---

## 8. RelinkSamplesDialog — NEITHER wired NOR deleted; a P7 follow-up

**The evidence, in the order I gathered it.**

1. `grep -rn "Relink" src/ scripts/ e2e/` returns **only the component and its own CSS** —
   no importer, no dynamic import, no string reference, no registry entry.
2. But the state it recovers from **is real and is rendered**:
   `src/store/libraryStore.ts:53` declares `status: 'available' | 'missing' | 'loading'`;
   `src/components/Nodes/LibraryNode.tsx:1171` reads `item.status === 'missing'` and puts
   `.is-missing` on the row; `src/components/Nodes/LibraryNode.css:582` paints that row
   `--danger-ink` with a struck-through name. Someone designed this state deliberately.
3. The loop is broken at the **producer**, not at the dialog:
   `libraryStore.ts:805 checkMissingItems()` — the only thing that sets `status: 'missing'`
   at scale — **has no caller anywhere in `src/`**. `relinkItem` / `relinkLibrary`
   (`:867`, `:896`) are called only by the dead dialog. `LibraryNodeData.missingItemIds`
   (`engine/types.ts:428`) is initialised to `[]` in `engine/registry.ts:658` and then never
   read or written.

**Decision: report, do not act.** Deleting the dialog would delete the *recovery* for a
state the product still renders, leaving a struck-through red row and no way out — the
opposite of covenant #8, which is about dead weight, not about amputating the only exit from
a live failure. Wiring it is the right answer, and both ends of that wiring are inside
`LibraryNode.tsx` and `libraryStore.ts` — files this lane must not touch and which P7c is
editing right now. My instructions say to stop and report in exactly this case.

**The three-point wiring, for P7c or a Library lane:**

1. Call `checkMissingItems(libraryId)` when a library is (re)opened / rehydrated, and write
   its return into `LibraryNodeData.missingItemIds` — the field that already exists for it.
2. In `LibraryNode`'s browser, when `missingItemIds.length > 0`, surface a Callout with one
   action ("Relink N missing samples") — the honest-failure shape, reported without stealing
   focus.
3. That action renders `<RelinkSamplesDialog libraryId missingSamples onClose />`, which is
   already Modal-based and already New-DNA (W4-P9). It needs no change.

Only after that is the dialog reachable and its COVERAGE row (currently **UNREACHABLE**)
capturable.

---

## 9. What I could NOT verify

- **No audio was playing.** Nothing in this lane touches the audio path — the changes are
  four stylesheets, seven `agentPending` props, one Chip tone and one flex rule — but the
  covenant's own test ("test with audio actually playing") was not run, and a taste-tier
  human should confirm the download page and docs read right on a real display.
- **The plugin window shell was verified against a stubbed Tauri `invoke`**, not a real
  hosted plugin. The strip is the design surface and it is fully measured; the middle of
  that window cannot exist in a browser.
- **Safe Mode was reached through a seeded crash-breaker marker**, not a real 3-boot crash
  streak. The app's own `runRecovery` made the decision, but the streak was synthetic.
- **The docs build was verified, not the deployed GitHub Pages site.** `apps/docs` builds 75
  pages clean; the Pages deploy is owner-gated.
- **Print styles, mobile widths and forced-colors mode** were not swept. Every capture is
  1280×800.
- **The `astro-*` scoped classes in Starlight's own chrome** (sidebar, header, dropdowns)
  now inherit our tokens through the `--sl-*` remap, but Starlight ships CSS we do not
  control; I measured the two pages named in the task, not all 75.

## 10. Risks

1. **W6-UI is editing `packages/oj-tokens` right now.** A token was added mid-lane
   (`--accent-two-ink`), which immediately turned `webSurfaceTokens.test.ts` red and I
   re-emitted. That is the design — a stale transcription is a loud failure, not silent
   drift — but **whoever lands after a further token change must re-run the emitter**
   (`.scratch/w6-fix/emit-tokens.mjs`, or copy the values by hand and let the test judge).
   The two sheets are generated artifacts of one source, the same relationship
   `packages/oj-ui/oj-tokens.css` already has.
2. **Two static copies of the palette now exist** (download, docs) because neither surface
   can import from `packages/`. They are pinned value-for-value against the DTCG files, so
   they cannot diverge silently — but they are duplication, and the cleanest future fix is
   to have `packages/oj-tokens/build.mjs` emit them (that file is W6-UI's, so this lane did
   not).
3. **Starlight upgrades.** The `--sl-*` names, the `#starlight__sidebar` id and the
   `.starlight-aside--*` classes are Starlight's public-ish surface; a major version could
   rename them. The failure mode is cosmetic, not broken.
4. **The docs body text is still Starlight's 16px prose scale**, not the app's 14px. That is
   a deliberate call — DESIGN's type scale governs functional UI, and a docs site is
   long-form reading — but it is a judgement someone may want to revisit.
5. **`.oj-help__mode`, `.oj-set-section__title` and friends grew 2px.** No layout broke in
   any capture, but the Settings section captions are now visibly heavier; if that reads as
   shouty, the alternative is the mono micro voice at 11px (legal, and the reason the
   judgement is written down above).

---

## 11. Loose threads worth someone's time (found, not fixed)

- **`AuthChooser` has D8's twin field** — one selector, §7.
- **`packages/oj-ui` D6** (the 2px transport record dot) and **DESIGN.md D9** are W6-UI's and
  W6-DOCS's. D9 has a **second instance**: DESIGN §5 specifies the palette's menu category
  headers at **10.5px sans**, which `CommandBar.css` faithfully implements and which the
  13px floor forbids. Either the floor gains a documented "menu category header" exception
  alongside `Field` and `Chip`, or those three move.
- **`public/download/index.html:9`** still describes the app as *"a warm sketchbook
  canvas"* — the retired system's name, in the page's meta description. Copy is W6-DOCS's
  and my brief said to keep the content byte-identical, so I left it.
- **`apps/docs` `play/first-patch` says "Blue ports carry audio"** — the wiring legend moved
  to teal (`--audio-connection`); DESIGN §2 explicitly says *"if you see `#4A90C2`, it is
  stale"*. Copy, so W6-DOCS.

---

# W6-FIXb — the gate's two blockers, plus F1/F2/F6/F9/F10 and the 10.5px retirement

Round two, resuming after an interrupted run. Closes the two **COMMIT-AFTER-FIXES**
blockers from `W6-FIX-REVIEW.md` (FIX 1, FIX 2), the follow-ups the review raised against
surfaces this lane owns (F1, F2, F6, F9, F10), and the 10.5px-sans retirement W6-UI landed
in `06fa8c7`. Windows 11 · `bun` only · Playwright under `node` · one Chromium · docs
`:4331`, app `:5231`, and two throwaway static roots on `:4173` (the working tree's
`public/`) and `:4174` (a HEAD copy) so the download page could be measured before and
after in the same browser. All stopped after the run.

Evidence: `plans/redesign-new-dna/.scratch/w6-fixb/` — `measure.mjs`, `measure2.mjs`,
`font-timing.mjs`, `which-faces.mjs`, `shift-source.mjs`, `final-check.mjs`, `palette.mjs`,
`heading-contrast.mjs`, `replay-pins.mjs`, their JSON, and 14 screenshots.

## 1. FIX 1 — the blanket reduced-motion rule on the docs

`apps/docs/src/styles/custom.css:220–229` now carries the rule, after the `:focus-visible`
block, with a comment saying why it is duplicated here (this site loads no `global.css`) and
noting that neither of `global.css`'s two exemptions — the cable stroke, the meter — exists
on it.

Measured under `reducedMotion: 'reduce'`, `getComputedStyle` over every element:

```
                        before (review)   after
docs home      light    2 live            0 live
docs home      dark     2 live            0 live
docs first-patch  l/d   —                 0 live
download page     l/d   —                 0 live
```

The 11 Starlight-owned 0.2s SVG transitions the review measured are covered by the same
rule. Pin: `webSurfaces.test.ts` → *"the blanket reduced-motion rule"*, which holds **both**
sheets to the universal selector plus all four declarations — a rule scoped to one class
does not satisfy it.

## 2. FIX 2 — the dead `h1` selector, and the comment that lied

Took the review's **Option A**. `custom.css:78–96`: `.sl-markdown-content h1` →
`.content-panel h1`, verified against the built page (Starlight's `PageTitle` renders
`<h1 id="_top">` inside `ContentPanel`, above `.sl-markdown-content`). `pre.astro-code` is
deleted from what is now `:162–167`, leaving `.expressive-code .frame`. The `:77` comment is
rewritten to state the mechanism instead of the claim.

Measured live on `/play/first-patch/`, both schemes:

```
h1  30px  == var(--text-2xl) resolved on the same document   (was 42px, off-scale)
.sl-markdown-content h2  x4  ->  22px  == var(--text-xl)
document.querySelectorAll('.sl-markdown-content h1').length === 0   <- the old rule was dead
token scale as rendered: 2xl 30 | xl 22 | lg 15 | md 14 | sm 13 | xs 11
```

The heading step is now 30 -> 22 and the comment is true. (My first probe read
`document.querySelector('h2')`, which on a Starlight page is a sidebar heading — 18px. The
`.sl-markdown-content h2` figure above is the corrected one; `measure2.mjs` supersedes
`measure.mjs`.)

## 3. F1 — font preload, and the CLS attribution the review got wrong

Wired in both heads: `public/download/index.html:59–72` and `apps/docs/astro.config.mjs:54–74`
(`crossorigin: 'anonymous'`, not `true` — Astro renders `true` as the invalid
`crossorigin="true"`, which only works via the enumerated attribute's invalid-value default).

**Each surface preloads the faces it actually paints, and they are not the same two.**
Walking every text run (`which-faces.mjs`):

```
download page   renders  Outfit 400/500/600/700 + JetBrains Mono @ 500  (version string, chip)
                         never mono 400
docs, all pages renders  Outfit + JetBrains Mono @ 400 ; only some pages pull 500
```

The interrupted run had copied the docs' face list onto the download page, so that page was
preloading `jetbrains-mono-regular.woff2` — a face it never renders — while `-medium`, the
one it does, still arrived late. Fixed:

```
download  before:  outfit-variable (css)   jetbrains-mono-medium (css)     2 fetches
download  after:   outfit-variable (link)  jetbrains-mono-medium (link)    2 fetches, both painted
docs      after:   outfit-variable (link)  jetbrains-mono-regular (link)   [+ -medium (css) on home only]
```

**Discovery time**, the thing a preload actually buys:

```
outfit-variable.woff2   before  initiatorType 'css'   startTime 19ms
                        after   initiatorType 'link'  startTime  6ms   (both faces in parallel)
```

**But F1's CLS claim is wrong, and I am not repeating it.** Measured before/after, both
schemes, 3 runs each, un-throttled *and* on an emulated 300ms / 700kbps link:

```
                  un-throttled median      throttled median
before  light          0.0762                  0.0762
before  dark           0.0762                  0.0762
after   light          0                       0.0855
after   dark           0.08                    0.0876
```

The shift does not move, because it is not the FOUT. `shift-source.mjs` reads each
`layout-shift` entry's own `sources`, and they name `SECTION.oj-other`, `P.oj-browser`,
`FOOTER.oj-foot` at t≈103ms — those three sections being pushed down when `download.js`
injects the detected-OS primary card. It survives with both faces fully preloaded. The
throttled *after* is ~0.01 **higher**, for the honest reason that item 5's new caption line
makes the injected card slightly taller. Everything stays under the 0.1 "good" bar.

The review's earlier 0.084 / 0.069 was almost certainly this same injection, misattributed.
The preload is still right — it takes a real round trip off the critical path on any
connection that is not loopback — but it is not a CLS fix, and the comments in both files
now say exactly that instead of the FOUT story the interrupted run had written. Reserving
space for the injected card is a real change to the page's progressive-enhancement
strategy; see follow-up G1.

## 4. F2 — the meta description

`public/download/index.html:12–16`. One sentence, no retired name:

> Download OpenJammer — a real instrument you patch on a canvas and play live, as a native
> desktop build for macOS, Windows or Linux at the lowest latency, or zero-install in your
> browser.

Both tiers stay honest (native = lowest latency, browser = zero install). Pinned by
*"public/download/index.html speaks the New DNA"*: no `/sketchbook/i`, contains "real
instrument", one terminal full stop, names both tiers, and no retired token name anywhere in
the file.

## 5. F6 — the Recommended chip out of the button, and the version line's left edge

`index.html:113–123` + `download.js:269, 303–323, 348–358, 413` + `download.css:222–252`.
The chip is a `<p class="oj-pick">` caption above the pair — in the static HTML **and** in
the card `download.js` builds, which now share the shape (`btn()` lost its `recommended`
option entirely). `download.js:269` hides the caption when there is no Apple-Silicon asset,
so it never points at a button that isn't there. The chip is `--bg-tertiary` +
`--text-primary` in the mono micro voice, the same as `.oj-version` — the neutral inset is
the right depth in *both* themes, which `--bg-node` was not.

Measured, 1280x800:

```
                     macOS button widths     chip inside a button?
before (HEAD)            408 / 192  (2.1x)         yes
after                    346 / 236  (1.47x)        no
```

The residual difference is label length ("Apple Silicon (M1–M4)" vs "Intel") on
`flex: 1 1 auto` buttons — the surface-inside-a-control is gone and the row reads as a pair.
Screenshots: `macos-{before,after}-{light,dark}.png`; `chip-inside-{light,dark}.png` is the
mid-lane state (New DNA, chip still nested), carried over from the gate's own captures so the
comparison isolates this change rather than the whole lane.

The version line: one gutter named once on `.oj-page` (`--oj-card-pad`), taken by both card
paddings and by `.oj-version-line`'s `padding-inline`. **Text** edges (border-box left plus
that element's own left padding — the first probe measured the border box on one element and
the content box on its neighbours, which is why `measure2.mjs` supersedes `measure.mjs`):

```
                  primary heading   version line   "Other platforms"
before                  346              312             334        <- three edges
after                   345              344             345        <- one column (1px = the card hairline)
```

## 6. F10 — `AuthChooser` gets D8's rule, not a second one

`CommandBar.css:1056–1071`: the selector list is
`.command-bar-auth [cmdk-root], .command-bar-sessions [cmdk-root]` — one rule, one comment,
and the comment now says why `AuthChooser` belongs in it (its `<Command>` root wraps the same
`.command-bar-input`). `ModelPicker.test.tsx` pins the combined selector, all four
declarations, that `AuthChooser.tsx:94` really renders `className="command-bar-input"`, and
that there is **exactly one** `[cmdk-root]` block in the sheet — so forking it into a second
rule fails.

## 7. F9 — the port-colour law, settled in one place

The review called this a doc-vs-doc question, and it was: `AGENTS.md` said audio → **blue**
while DESIGN.md §2 says teal and *"if you see `#4A90C2`, it is stale"*. `AGENTS.md:161–172`
now states the law as **type → token**, with the colour name in parentheses, and says the
token is the only place a value lives:

```
- `type: 'audio'`     -> --audio-connection    (teal)    music / sound
- `type: 'technical'` -> --control-connection  (grey)    numbers / triggers
- `type: 'universal'` -> --universal-port      (violet)  adapts to what it connects to
```

The examples are kept verbatim. Downstream copy fixed to match:

| File | Was | Now |
|---|---|---|
| `apps/docs/.../play/first-patch.mdx:24` | "**Blue** ports carry audio" | teal, + one clause for the violet universal port |
| `apps/docs/.../play/troubleshooting.mdx:20` | "the instrument's blue output" | teal |
| `apps/docs/.../build/create-a-node/index.md:19` | "`audio` → blue" | "`audio` → teal" |
| `docs/README.md:14` | "The Living Sketchbook … audio-blue/control-grey ports" | "calm ground, loud signal … audio-teal/control-grey/universal-violet" |

`grep -rniE "blue port|ports are blue|blue.*audio|audio.*blue" docs apps README.md AGENTS.md`
now returns only two historical plan artifacts — `docs/design-figma-handoff.md:139` (which
already says teal and names the old blue only to retire it) and
`docs/node-migration-plan.md:137` ("the audio-blue hard ring", inside a completed migration's
KEEP/DELETE instructions). **Deliberately not edited:** those are a record of a finished
migration, not a statement of the law; rewriting them would falsify the record.

## 8. The 10.5px sans retirement (W6-UI `06fa8c7`)

Two sites in `CommandBar.css` still hard-coded the retired 10.5px sans. Both are category
headers, and both now speak the same four-line micro mono vocabulary as
`packages/oj-ui/.../Menu/Menu.css`'s `.oj-menu-category` — `--font-mono`, `--text-micro`,
`--tracking-micro`, `uppercase`, on `--text-muted`:

- `CommandBar.css:162–174` — `.command-bar-group [cmdk-group-heading]`
- `CommandBar.css:814–830` — `.command-bar-ai-slash-head`

**One correction to the brief:** `:817` was a *shared* block,
`.command-bar-ai-slash-head, .command-bar-ai-slash-empty`, and the empty row already
overrode `font-size: var(--text-sm)`. So it never rendered at 10.5px — it is a **sentence**
("No command matches /foo"), not a header. It keeps sans prose on the 13px floor, and now
says so explicitly (`font-family: var(--font-sans)` added, since the shared block turned
mono). It shared that block for the box, never for the voice.

Measured live on the running app, palette open, both themes:

```
[cmdk-group-heading] x4   JetBrains Mono   9.5px   tracking 0.76px (= 0.08em)   uppercase
contrast on --bg-node:    5.49:1 light  |  5.05:1 dark
console errors: 0 both themes
```

Mono micro is held to the **full 4.5:1 body bar**, not a large-text exemption, and both
clear it. Screenshots `palette-{light,dark}.png`. Pin: `ModelPicker.test.tsx` →
*"writes category headers in the micro mono voice"*, which holds both headers to all four
declarations, holds the empty row to sans + `--text-sm`, and asserts **no `font-size` in the
sheet is a hand-typed px step**. (Three `0.9em` / `0.92em` survive, all on `--font-mono`
runs — relative mono sizing, which the sans floor does not govern.)

## 9. Are these pins? — 11 of 12

Same method as the gate: `git show HEAD:<path>` into `.scratch/w6-fixb/pre/` (no checkout, no
stash), then replay each new assertion's own logic against the pre-fix files
(`replay-pins.mjs`).

```
11 of 12 replayed assertions FAIL on the pre-fix code.
```

The one that passes is *"leaves no retired name anywhere in the page"* — a regression guard,
not a pin, and labelled as such. Every other new assertion is something the old code
violated.

## 10. Gates

| Command | Result |
|---|---|
| `bun run test:run -- src/components/__tests__ src/components/CommandBar` | **165 passed / 13 files**, exit 0 |
| `bunx tsc --noEmit -p tsconfig.app.json` | exit 0, no output |
| `bunx eslint src/components/CommandBar src/components/__tests__` | exit 0, no output |
| `cd apps/docs && bun run build` | exit 0 — 75 pages, pagefind index built |
| `git diff --check` on the lane's files | exit 0 (only the repo's usual LF→CRLF warnings) |

Live, both schemes, `reducedMotion: 'reduce'`, docs home + docs first-patch + download page:

```
motion=0  errors=0  preloadWarnings=0  otherWarnings=0     (6 page x scheme combinations)
```

Zero preload warnings matters specifically: Chromium's *"preloaded … but not used"* is how a
`crossorigin` mismatch shows up, and it is a **warning**, never an error — an earlier probe
listened only for errors and would have missed it.

## 11. Follow-ups

| # | Item | Owner |
|---|---|---|
| **G1** | The download page's real CLS (~0.076–0.086) is `download.js` injecting the detected-OS card above `.oj-other` / `.oj-browser` / `.oj-foot`, not the FOUT. Under the 0.1 bar, so not a blocker, but F1's premise was wrong and the number will not improve until that card's space is reserved (or it is server-rendered). Reserving space costs a no-JS gap, so it is a design decision, not a one-liner. | web surfaces |
| **G2** | `apps/docs` home pulls `jetbrains-mono-medium.woff2` (mono weight 600, synthesized) while other pages do not, so it is deliberately left off the site-wide preload. If mono 600 is not intentional on the home page, it is one stray `font-weight`. | W6-DOCS |
| **G3** | Review items **F3** (`KeyTile.css:101`, 11px Outfit — `packages/**`), **F7** (dot grid under the prose column), **F8** (two accent-filled primaries in the docs hero), **F11**, **F12**, **F13** are untouched here — all outside this lane's ownership. | as the review assigned |
| **G4** | Review items **F4** and **F5** are corrections to *this report's* earlier prose (the 606px / 17px figure, and "no caller" → *transitively* dead). Left as the review states them rather than rewriting §7/§8 above. | W6-FIX |

## 12. What I could NOT verify

- **No audio was playing.** Nothing in this round touches the audio path — two stylesheets,
  two static heads, one HTML block, one JS builder, two CSS voice swaps, one selector list
  and four markdown files — but the covenant's own test was not run, and a taste-tier human
  should confirm the download page and the docs on a real display.
- **`AuthChooser` live.** Pi is unavailable in headless Chromium, so `AiPanel` renders its
  `data-available="false"` branch. F10 rests on the shipped-CSS pin plus the review's own DOM
  probe of the identical rule on `SessionPicker` (594px with it, 213px without). The command
  palette itself *was* driven live, so §8's headings are measured, not inferred.
- **The deployed Pages site.** The docs build is verified; the deploy is owner-gated.
- **Real-network CLS.** Emulated via CDP (300ms / 700kbps), not measured on a real link.
