# W6-FIX — adversarial gate review

**Lane reviewed:** W6-FIX (coverage-defect fixes D1/D2/D3/D4/D5/D7/D8 + 5 new pinning tests).
**Reviewer scope:** `public/download/**`, `apps/docs/src/{styles,components/Hero.astro}`,
`apps/docs/astro.config.mjs`, the 7 node components, `SettingsPanel.css`,
`SafeModeScreen.css`, `HelpPanel.css`, `PluginWindowShell.css`, `AppErrorBoundary.css`,
`CommandBar.css`, `ModelPicker.tsx`, the 5 new test files, `W6-FIX-REPORT.md`,
`W6-CAP-REPORT.md`. **No source file was edited by this gate.** Everything under
`packages/**`, `src/keymap/**`, `src/components/Shell/**`, `src/components/PianoRoll/**`,
`src/components/Arrangement/**`, `e2e/**` was ignored (W6-UI / W6-E2E).
**Evidence:** `plans/redesign-new-dna/.scratch/w6-fix-gate/` (scripts, JSON, 26 screenshots).
Windows 11 · `bun` only · Playwright under `node` · one Chromium · app `:5231`, docs `:4331`
(both stopped after the run).

---

## VERDICT — **COMMIT-AFTER-FIXES**

Two small, precisely-specified edits, both in one file the lane already owns
(`apps/docs/src/styles/custom.css`). Every substantive claim in `W6-FIX-REPORT.md` that I
could test independently reproduced — several to the decimal. The blockers are not the
fixes; they are a floor the lane's own change opened on the docs site, and a rule whose
comment claims something it does not do.

---

## The two blocking fixes

### FIX 1 — the docs site now has motion under `prefers-reduced-motion: reduce`

`apps/docs/src/styles/custom.css:168–184` gives `.sl-link-button.primary` a
`transition: background var(--motion-fast), transform var(--motion-spring)` plus a
`transform: scale(var(--press-scale-btn))` press. `apps/docs` loads **no `global.css`** —
the very reason the lane (correctly) carried the blanket rule into
`public/download/download.css:344–353` and defended `AppErrorBoundary.css`'s own copy in its
header. The docs sheet did not get one.

Measured (`.scratch/w6-fix-gate/rm.mjs`, `reducedMotion: 'reduce'`, docs home, both schemes):

```
docs home  light  2 live transitions  A.sl-link-button.primary  0.12s, 0.26s  (background, transform)
docs home  dark   2 live transitions  same
download   light  0 live transitions  (blanket rule present — clean)
```

DESIGN.md §3 line 562 makes "one blanket reduced-motion rule" one of the three *structural*
floors, alongside the one focus ring and the 13px floor. A lane-introduced `transform`
animation on a surface with no blanket rule is the floor being newly broken, not inherited.

**Change:** append to `apps/docs/src/styles/custom.css` (after the closing `}` of the
`:focus-visible` rule at `:202`):

```css
/* The blanket reduced-motion rule, carried here because the docs load no
   global.css (same reasoning as public/download/download.css). Neither of
   global.css's two exemptions — the cable stroke and the meter — exists here. */
@media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
        scroll-behavior: auto !important;
    }
}
```

(This also silences the 11 Starlight-owned 0.2s SVG transitions I measured on the guide
page — pre-existing, but the same rule covers them.)

### FIX 2 — `.sl-markdown-content h1` is dead, and its comment claims otherwise

`apps/docs/src/styles/custom.css:77` says *"type: Outfit at every size, **headings pinned to
the token scale**"*, then `:78`/`:84` pin `h1` to `--text-2xl`. Starlight renders the page
title in a `<h1>` that sits in the content **header**, outside `.sl-markdown-content`, so
the rule matches nothing on any page.

Measured (`.scratch/w6-fix-gate/codeframe.mjs`):

```
/openjammer/play/first-patch/   h1  class="astro-2sm4b3ln"  fontSize 42px  Outfit
                                document.querySelectorAll('.sl-markdown-content h1').length === 0
                                h2 → 22px  (the h2 half of the rule DOES work)
```

So headings step 42 → 22 → …: `h1` is off the scale (30/22/15/14/13) and the file says it
isn't. Also dead in the same sheet: `pre.astro-code` at `:157` — the docs render code
through expressive-code only (`.expressive-code .frame` = 2 matches on
`/build/contributing/`, `pre.astro-code` = 0 on every page swept).

**Change (either is acceptable; pick one and make the comment true):**

- *Option A (pin it):* `apps/docs/src/styles/custom.css:78` and `:84` — change the selector
  in both rules from `.sl-markdown-content h1` to
  `.sl-markdown-content h1, .content-panel h1` (verify the class against the built page; the
  title lives in Starlight's `<ContentPanel>` header). Then `h1` really is `--text-2xl`.
- *Option B (be honest):* delete `:78`'s `h1,` and the whole `:84–87` block, and amend the
  `:77` comment to *"h2 pinned to the token scale; the page title stays Starlight's
  long-form 42px, like the 16px body"* — which is the same judgement the lane already
  documented for body prose (report §10.4).

And in the same pass, delete `pre.astro-code` from `:157` (leave `.expressive-code .frame`).

---

## Evidence, claim by claim

### 1. `public/download` — D1 — **VERIFIED**

| Claim | Result |
|---|---|
| content + links byte-identical to HEAD | ✅ `git diff public/download/index.html` touches **only** the head: `color-scheme: light dark`, two media-gated `theme-color` metas, one `<link>` to the token sheet. Body untouched. |
| tokens-only CSS, zero literal colours | ✅ `grep -nE '#[0-9a-f]{3,8}\|rgba?\(\|oklch\(\|hsla?\(' public/download/download.css` → **0 matches**. |
| the token sheet equals today's generated palette | ✅ Independent parse (`verify-tokens.mjs`): **54/54 keys match `tokens/themes/light.json` and `dark.json` value-for-value in all four blocks** (`:root` light, `@media prefers-color-scheme: dark`, `[data-theme='dark']`, `[data-theme='light']`), and the theme-invariant primitives block is **byte-equal to the generated `packages/oj-ui/oj-tokens.css`**. `apps/docs/src/styles/oj-tokens.css` is the same file modulo one comment line — ALL MATCH there too. |
| both schemes via `prefers-color-scheme` **and** `[data-theme]` | ✅ both blocks present and correct; the two rendered captures are genuinely different images. |
| fonts load like `src/styles/fonts.css` | ✅ same three `@font-face`s, same self-hosted `/fonts/*.woff2` paths, `font-display: swap`. Files exist in `public/fonts/`; the absolute paths resolve from `/download/` — both faces reported `loaded` in-page, and every text run resolved to `Outfit` / `JetBrains Mono` only. (Difference from `fonts.css`: no `unicode-range`. Harmless, and unchanged from HEAD.) |
| worst text run 5.08 light / 6.27 dark, 0 below AA | ✅ **exact reproduction**: 23 runs each scheme, min **5.08** light (`.oj-btn` "Windows (x64 installer)"), **6.27** dark (same run). 0 AA failures. |
| 0 hard shadows / 0 ≥2px borders / 0 display faces / 0 sub-13px sans | ✅ all zero in both schemes. |
| console + page errors | ✅ 0 in both schemes. |
| non-text marks 1.31/1.27 (cards), 1.18/1.40 (rule) | ✅ I measure card hairlines **1.18 light / 1.40 dark** and the `.oj-plat` divider **1.27 dark**. Same values, different labels. The lane's defence (this is `--border-subtle`, which `contrast.test.ts` never holds to 3:1, and separation is carried by fill + `--shadow-overlay`) is correct and matches how a node card reads in the app. |
| no dead CSS introduced | ✅ class-name diff HEAD→now: **no selector removed**; the only "new" tokens are comment text. Every class in `index.html`/`download.js` still has a rule (`oj-primary-slot` is a JS mount point and had no rule at HEAD either). |

**Layout shift on font load** (asked for, not claimed): CLS **0.084 light / 0.069 dark** —
under the 0.1 "good" bar, one shift caused by the `swap` FOUT. Identical mechanism to HEAD,
so not a regression. See follow-up F1.

**Looking at it (`download-{light,dark}.png`):** yes, it is the same product as the app —
warm neutral ground with the canvas's own dot grid at the same 20px pitch, white `--bg-node`
cards on one hairline with soft layered depth, one accent fill for the detected OS and inset
fills for the rest, accent-ink links. **The weakest moment is the `Recommended` chip inside
the "Apple Silicon" button.** It is the one place the page nests a surface inside a control:
it makes that button visibly wider than its "Intel" peer (the row stops being a pair), and
its `--bg-node` fill reads as *lifted* in light but *recessed* in dark, because `--bg-node`
(#201F19) is darker than the button's `--bg-tertiary` (#2A2822). A close second is the
orphan `Version v0.0.3` line floating on the ground between two cards, left-aligned to
neither card's text edge (the two cards also disagree on inner padding, so
"Download for Windows" and "Other platforms" don't share a left edge).

### 2. `apps/docs` — D2 — **VERIFIED, with FIX 1 + FIX 2**

| Claim | Result |
|---|---|
| ONE `--sl-*` remap serving both themes | ✅ single bare `:root`; `grep ':root\[data-theme='` → 0; every `--sl-*` right-hand side is `var(--…)` or `color-mix()`; `--sl-shadow-{sm,md,lg}` → `--shadow-raised`/`--shadow-overlay`. |
| Hero de-2px'd, tokens only | ✅ `Hero.astro` `<style>` has no literal colour, 1px hairline, `--shadow-overlay`, and the `:global([data-theme='dark'])` block is **gone** (the tokens flip it). |
| asides → Callouts | ✅ live: `.starlight-aside--tip` = `--bg-node` fill, **1px** `--border-subtle`, `--shadow-raised`, title `--accent-ink` (oklch(0.504 0.19 40) light / oklch(0.767 0.19 40) dark), inline-start bar flattened. |
| sidebar current = `ListRow is-current` | ✅ live: `bg rgb(236,234,228)` = `--bg-tertiary`, `color` = `--accent-ink`. No fill drench. |
| `kbd` mono | ✅ `"JetBrains Mono"` in both themes (12px — mono, so legal). |
| min 4.95 light / 5.59 dark, 0 below AA | ✅ **exact reproduction on all three pages**: home 39 runs, guide 162 runs, components-with-code-and-asides 298 runs — min **4.95 / 5.59** everywhere, **0 AA failures**, **0 sub-13px sans**, **0 hard shadows / ≥2px borders / drop-shadows / display faces**, **0 console + page errors**, faces `Outfit` + `JetBrains Mono` only. |
| `cd apps/docs && bun run build` | ✅ 75 pages, exit 0. |
| search modal / TOC / pagination / footer / code frames | ✅ all inherit the remap. Search dialog dark: `--bg-tertiary` fill, `--border-strong` hairline, `--shadow-overlay`. Pagination cards: 1px `--border-strong` + `--shadow-raised`. `.expressive-code .frame`: 1px `--border-subtle`, `--shadow-raised`, 10px radius, both themes. Footer/TOC on tokens. **Nothing left in the retired language** — `grep '4A90C2\|oj-blue\|oj-pine\|oj-ochre\|oj-paper\|Living Sketchbook'` over `public/` + `apps/docs/src` returns exactly one hit, the download page's meta description (follow-up F2). |
| keyboard focus rings | ✅ `Tab` → `box-shadow: 0 0 0 3px` in `--focus-ring`, both themes, `outline: none`. |
| reduced motion | ❌ **FIX 1** — 2 lane-introduced live transitions (incl. `transform`), 11 Starlight-owned. |
| dead CSS | ⚠️ **FIX 2** — `.sl-markdown-content h1` (never matches) and `pre.astro-code` (0 matches site-wide). The other 22 selectors are live or pseudo-classes. |

**Looking at it:** the docs read as the instrument — same ground, same card, same callout,
same ink. Two taste notes, both non-blocking: the dot grid runs *under the prose column*, not
just the page ground, so there is texture behind long-form reading (in the app the grid is
the canvas's signature and panels sit on solid surfaces); and the hero shows **two**
accent-filled primaries side by side, where the download page is disciplined about exactly
one accent fill per view.

### 3. D3 — agent-pending on the 7 node components — **VERIFIED LIVE, both themes**

Live, on the running app (`app-check2.mjs`), by importing the real stores through the Vite
dev graph, adding all 10 owned node types and driving the real
`agentSessionStore` to `phase: 'running'` with an empty `runBaseline`:

```
light AND dark, 10/10 added cards wear the ring:
  oj-node is-agent-pending schematic-node math-node add
  oj-node is-agent-pending schematic-node math-node subtract
  oj-node is-agent-pending schematic-node speaker-node
  oj-node is-agent-pending schematic-node microphone-node
  oj-node is-agent-pending schematic-node container-node
  oj-node is-agent-pending schematic-node song-node
  oj-node is-agent-pending schematic-node canvas-io-node canvas-input
  oj-node is-agent-pending schematic-node canvas-io-node canvas-output
  oj-node is-agent-pending schematic-node port-panel input-panel-node
  oj-node is-agent-pending schematic-node port-panel output-panel-node
after the run: 0 cards pending
```

The diffs are the minimal shape — one `useIsAgentPending(node.id)` (the hook `NodeWrapper`
already uses; no new state, no new prop) and one `agentPending={…}`. No fork.
`agentPendingRing.test.tsx` mounts all ten through the real `NodeWrapper` dispatch, in both
states, plus the baseline row — 21 tests, green.

### 4. D4 — the 13px floor — **VERIFIED (in scope)**

Static: every one of the five reported lifts is in the diff, each with a one-line reason, and
the three extra finds (`.oj-help__warning`, `.oj-fullscreen__option` 16px → 15px,
`AppErrorBoundary` 18/12 → 15/11) are real.

Live sweep (`getComputedStyle` on every visible text node, per surface, both themes):

```
Settings  light/dark : 22 runs, sizes {13, 14, 22}px, sub-13 sans = 0, overflow = 0
Help      light/dark : 31 runs, sizes {11, 13, 14, 15}px  (11px is mono Kbd), sub-13 sans = 0, overflow = 0
download  light/dark : sub-13 sans = 0
docs ×3   light/dark : sub-13 sans = 0
```

No wrapping or clipping appeared after the lifts (scrollWidth vs clientWidth on every leaf:
0 overflows; screenshots `app-settings-*`, `app-help-*`). Safe Mode, the plugin shell and the
error boundary are covered statically by `typeFloor.test.ts` /
`appErrorBoundaryTokens.test.ts`, which now hold every `font-size` in those four sheets to a
step that exists — I confirmed the pre-fix sheets fail those assertions (below).

**Out of scope but real, found by the sweep:** `.oj-key-tile__label` renders **11px Outfit**
on the default canvas (the on-screen keyboard's key caps, `packages/oj-ui/src/components/KeyTile/KeyTile.css:101`).
That is W6-UI's file, so it is not this lane's — but the "13px floor is clean" story is not
true app-wide until it is fixed. See follow-up F3.

### 5. D5 / D7 / D8

**D5 — VERIFIED.** `ModelPicker.tsx:312` is `<Chip>current</Chip>`; the tone is gone and the
chip stays. The row's doubled mark survives — `ModelPicker.test.tsx` renders the real picker
against the real `authStore` + `modelCatalogStore` and asserts `className.trim() === 'oj-chip'`
**and** `is-current` + `aria-current="true"`, so deleting the mark entirely also fails. Green.
(I could not reach the picker live in this environment — Pi is unavailable headless, so
`AiPanel` renders its `data-available="false"` branch — but the component test exercises the
real component and the real stores, which is the same evidence.)

**D7 — VERIFIED, including the contested oklch claim.** The lane argues Chromium *clips*
rather than gamut-maps `oklch(0.785 0.21 25)`. I tested that empirically in Chromium rather
than trusting it: a 1×1 canvas painted with `fillStyle = 'oklch(0.785 0.21 25)'` and read back
with `getImageData` gives **`#FF7771`** — in every one of the 8 page contexts I probed, light
and dark. Not `#FF9088`. The transcription is right, and the contrast arithmetic is exact:

```
#FF7771 on #201F19 = 6.39:1     (the fix)
#F84B4B on #201F19 = 4.80:1     (what shipped)
#BB0015 on #FFFFFF = 6.72:1     (the light block, which was already correct)
```

`appErrorBoundaryTokens.test.ts` reads the DTCG files and re-derives all eleven declarations —
no hand copies — and holds the file to `prefers-color-scheme` only (`not.toContain('data-theme')`),
which is the correct contract for a card that renders when `applyTheme()` may never have run.

**D8 — VERIFIED in substance; one number I could not reproduce.** I could not reach the real
`/resume` view (Pi unavailable headless), so I measured the shipped CSS directly: inject
`SessionPicker`'s exact DOM shape (`.command-bar-sessions` → `[cmdk-root]` → `input.command-bar-input`)
into the live command bar, measure, then delete the new rule from the CSSOM and re-measure:

```
with the rule     input 594px   [cmdk-root] display: flex, column   gutters 16 / 16 px
without the rule  input 213px   [cmdk-root] display: block
removed rule      .command-bar-sessions [cmdk-root] { display:flex; flex-direction:column; flex:1 1 0%; min-height:0px; }
```

The root cause and the fix are exactly as described, and the field keeps the palette's own
physics — same `.command-bar-input`, 14px Outfit, `9px 12px`, `--radius-md`, the same
`border-color 0.12s cubic-bezier(.2,.8,.3,1)` transition as the palette search (626px in the
640px container). **The report's "606px … 17px gutter" is not what my probe measures (594 / 16);**
the difference is my synthetic ancestor chain, not a defect — but the report should say which
container the 606 was measured in. See follow-up F4.

### 6. RelinkSamplesDialog — **CONFIRMED DEAD; the plan is right**

```
grep -rn "RelinkSamplesDialog" src/ e2e/ scripts/   → only the component + its own CSS
grep -rn "missingItemIds"                           → engine/types.ts:428 (declared),
                                                       engine/registry.ts:658 (initialised to [])
                                                       — never read, never written
grep -rn "checkMissingItems"                        → libraryStore.ts:228 (type), :793 (impl),
                                                       :904 (called by relinkLibrary)
grep -rn "relinkItem|relinkLibrary"                  → the dead dialog only
```

So: `missingItemIds` is genuinely never written, and `checkMissingItems` is **transitively**
dead — reachable only from `relinkLibrary`, which is reachable only from the dead dialog.
(The report's "has no caller anywhere in `src/`" is one word too strong; the conclusion is
unaffected. See follow-up F5.)

**The judgement is correct: report, don't act.** The `missing` state is *rendered* —
`libraryStore.ts:53` declares it, `LibraryNode.tsx:1171` puts `.is-missing` on the row,
`LibraryNode.css:582` paints it `--danger-ink` and strikes the name. Deleting the dialog
would leave a red struck-through row with no exit, which is not what covenant #8 is about;
and both wiring points are in `LibraryNode.tsx` / `libraryStore.ts`, which this lane must not
touch. The three-point plan (call `checkMissingItems` on library open/rehydrate → write
`missingItemIds` → surface a Callout with one "Relink N missing samples" action that renders
the already-New-DNA dialog) is the right shape and is the honest-failure pattern the covenant
asks for. **Wire it; do not delete it.** Owner: P7c / a Library lane.

### 7. Are the tests pins, or decorations? — **PINS**

The task allows reading them and judging. I did better: I dumped the twelve pre-fix files
with `git show HEAD:<path>` into `.scratch/w6-fix-gate/pre/` (no checkout, no stash) and
**replayed each test's own assertion logic against them** (`replay-pins.mjs`). Result:

```
24 of 30 replayed assertions FAIL on the pre-fix code.
```

Highlights: `download.css` → 13 hex + 4 `rgb()` literals, a 2px border, untokenised shadows;
`custom.css` → 45 hex + 7 `rgb()`, a 14px border, a `:root[data-theme=` block, literal
`--sl-*` values; `Hero.astro` → 6 hex + 3 `rgb()`, a 50px border-radius false-positive plus a
real 2px border; `typeFloor` → `.oj-set-section__title`, `.oj-fullscreen__link` (+16px off the
scale), `.oj-help__mode` **and** `.oj-help__warning`, `.plugin-window-identity span` **and**
`.plugin-window-dirty-label`; `appErrorBoundary` → dark title `#F84B4B` and `18px, 12px`;
`ModelPicker` → `<Chip tone="success">`; `agentPendingRing` → `MathNode` has no
`agentPending=`; `index.html` → `<meta name="color-scheme" content="light" />`.

Three of my six "already passed" rows were **my own** heredoc mangling a backslash, not the
tests': I verified by `od -c` that the real
`src/components/CommandBar/__tests__/ModelPicker.test.tsx:100` builds
`/\.command-bar-ai-hint\s*\{([^}]*)\}/` correctly, and the pre-fix `CommandBar.css:772/883/979`
all carry `font-size: var(--text-xs)`. So those three fail on HEAD too — effectively **27/30**.
The report's own figure (19 failing assertions) is a different, stricter count of test *cases*;
directionally confirmed either way. Every new test asserts something the old code violated.

### 8. Gates

| Command | Result |
|---|---|
| `bun run test:run -- src/components` | **1181 passed / 1 failed / 112 files.** The one failure is `Settings/__tests__/KeybindingsPanel.test.tsx > should render all keybinding actions` — a 5000 ms timeout. **Re-run alone: 21/21 green in 10s.** Known full-parallel flake pattern in this repo (MEMORY has the same for `voiceSynth`). Not a regression: the only lane change in that tree is `SettingsPanel.css` `--text-xs` → `--text-sm`, which jsdom does not lay out. |
| `bun run test:run --` (the 6 new/updated files only) | **94 passed / 6 files**, exit 0. |
| `bunx tsc --noEmit -p tsconfig.app.json` | exit 0, no output. |
| `bunx eslint src/components public apps/docs/src` | exit 0, no output. |
| `bun run build` | exit 0. |
| `cd apps/docs && bun run build` | exit 0 — 75 pages, pagefind index built. |
| `git diff --check -- <lane files>` | exit 0 (only the repo's usual LF→CRLF warnings). |

### 9. Lean / taste

- **Dead CSS, download sheet:** none. Class-name diff HEAD→now removes nothing and adds
  nothing unused; all 35 classes are in `index.html` or `download.js`.
- **Dead CSS, docs sheet:** two selectors — `.sl-markdown-content h1` (`:78`, `:84`) and
  `pre.astro-code` (`:157`). Both in **FIX 2**. The remaining 22 are live.
- **Comment bloat:** high but earned, and it is the house style in this repo. Every comment
  states a *reason* (why `--bg-node` for the chip, why `[cmdk-root]` needs the flex column,
  why `--text-xs` is the mono step) rather than restating the code. Two comments now make
  claims the code does not honour (`custom.css:77` "headings pinned to the token scale";
  `download.css:207` "the lifted chip … oj-ui's `is-pressed`" — in dark, `--bg-node` is
  *darker* than the button it sits on, so it recesses). FIX 2 covers the first; the second is
  follow-up F6.
- **Anything forked that should reuse oj-ui:** no. The docs Hero's tier pills are a Chip
  *shape* rendered in Astro (oj-ui is React — it cannot be imported there), and the download
  page is a no-React static file, so both are legitimately hand-built to the same recipe. The
  two static palette copies are duplication, but they are pinned value-for-value against the
  DTCG source by `webSurfaceTokens.test.ts`, which makes a drift a loud failure — the same
  relationship `packages/oj-ui/oj-tokens.css` already has. **The transcription values equal the
  generated sheet today; I verified all 54 keys × 4 blocks + the primitives.** When W6-UI lands
  the emitter, these two files should become generated artifacts (the lane says so, risk #2).

---

## Non-blocking follow-ups

| # | Item | Owner |
|---|---|---|
| **F1** | Download page CLS is **0.084 / 0.069** from the `swap` FOUT. One `<link rel="preload" as="font" type="font/woff2" crossorigin href="/fonts/outfit-variable.woff2">` in `public/download/index.html`'s head (head wiring, so within the byte-identical-content rule) removes the larger shift. Same for the docs. | W6-FIX / web surfaces |
| **F2** | `public/download/index.html:9` still describes the app as *"a warm sketchbook canvas"* — the retired system's name, in the page's meta description (and therefore in search results and link previews). The lane correctly left copy alone. | W6-DOCS |
| **F3** | `.oj-key-tile__label` is **11px Outfit** on the default canvas (`packages/oj-ui/src/components/KeyTile/KeyTile.css:101`) — a live 13px-floor break in the most-looked-at surface in the app. Either lift to `--text-sm` or move to the mono micro voice. | W6-UI (`packages/**`) |
| **F4** | `W6-FIX-REPORT.md` §7 says the sessions field measures **606px / 17px gutter**; my faithful DOM probe measures **594px / 16px**. Not a defect — state which container the 606 was measured in, or re-measure. | W6-FIX |
| **F5** | Same report, §8 point 3: "`checkMissingItems()` … has no caller anywhere in `src/`" — it has one, `libraryStore.ts:904` (`relinkLibrary`), itself dead. Say *transitively* dead. | W6-FIX |
| **F6** | `download.css` `.oj-chip` uses `--bg-node`, which is *lighter* than `--bg-tertiary` in light and *darker* in dark, so the same pill reads lifted in one theme and recessed in the other. Also makes "Apple Silicon" visibly wider than its "Intel" peer. Consider `--bg-secondary`, or move "Recommended" out of the button. | W6-FIX / web surfaces |
| **F7** | The docs dot grid runs under the prose column, not only the page ground — texture behind long-form reading. In the app the grid is the canvas's signature and panels sit on solid surfaces. Consider scoping it to `body` outside `.content-panel`. | W6-FIX / W6-DOCS |
| **F8** | The docs hero shows **two** accent-filled primaries side by side; the download page keeps exactly one accent fill per view. Demote "Download for desktop" to the inset variant. | W6-DOCS (frontmatter) |
| **F9** | `apps/docs` copy still says *"**Blue** ports carry audio"* (`play/first-patch.mdx:24–25`, `troubleshooting.mdx:20`, `build/create-a-node/index.md:19`). Note the tension: `agents.md`'s own port-colour law also still says **blue**, so this is a doc-vs-doc question, not just a stale-copy one — settle it in one place. | W6-DOCS |
| **F10** | `AuthChooser` has D8's twin (~210px field inside the same cmdk root). One selector: add `.command-bar-auth [cmdk-root]` to the rule at `CommandBar.css:1052`. | command-bar lane |
| **F11** | Four P7 files still lack `agentPending` (`LibraryNode.tsx:1372`, `LooperNode.tsx:912`, `SamplerNode.tsx:517`, `SamplerVisualNode.tsx:153`), one line each; extending `OWNED` in `agentPendingRing.test.tsx` is the whole test change. | P7c |
| **F12** | Wire `RelinkSamplesDialog` per §6 above, or the `missing` row in the Library browser stays a dead end. | P7c / Library lane |
| **F13** | Not swept by either lane: print styles, mobile widths, forced-colors. Everything is 1280×800. | a later pass |

---

## What I could NOT verify

- **No audio was playing.** Nothing in this lane touches the audio path (four stylesheets,
  seven props, one Chip tone, one flex rule), but the covenant's own test was not run, and
  a taste-tier human should confirm the two web surfaces on a real display.
- **The model picker and the sessions picker live.** Pi is unavailable in headless Chromium,
  so `AiPanel` renders its `data-available="false"` branch. D5 rests on the component test
  against the real stores; D8 rests on a faithful DOM probe of the shipped CSS with the rule
  present and removed.
- **Safe Mode and the plugin window shell live.** Covered statically by `typeFloor.test.ts`;
  I did not re-seed the crash-breaker or stub Tauri.
- **The deployed Pages site.** The docs build is verified, the deploy is owner-gated.
- **Starlight's other 72 pages.** I measured four (home, a guide, a components page with code
  and asides, a page with fenced code frames) plus the search modal.
