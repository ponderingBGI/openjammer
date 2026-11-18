# W2-S2 review — the atomic token swap

Reviewer: Opus 5 (design-systems gatekeeper). Read-only: no source file was edited. `bun run tokens`
was re-run twice (the instructed idempotency check) — that is the only write, and it is a no-op.

**Verdict: DO-NOT-COMMIT as-is — 4 small must-fixes, then commit.** The token layer itself is
faithful and the gates are green; the blockers are two pieces of outright broken code, one missing
required deliverable, and one wrong ink/boundary mapping that visibly inverts three overlays in dark.
None is a rework; all four are ≤10 lines.

---

## Verdict per item

| # | Item | Verdict |
|---|---|---|
| 1 | Token correctness | **PASS** (one judged deviation accepted, 2 value notes) |
| 2 | Mechanical rewrite quality | **PASS with defects** — D2 (scrim inversion) is a must-fix |
| 3 | `index.html` boot shell | **PASS with defect** — D5 (light hairlines not switched in dark) |
| 4 | Settings theme picker | **FAIL** — behaviour is correct and verified in-browser, but the required test does not exist |
| 5 | `contrast.test.ts` | **PASS with defects** — D3 (phantom dep) is a must-fix; D8 coverage gap |
| 6 | Fonts | **PASS** — clean |
| 7 | Gates | **PASS** — tsc / lint / focused tests / build all green |
| 8 | Browser (12 screenshots, both themes) | **PASS** — zero console/page errors, no light flash, `--sketch-black` gone |

---

## 1 — Token correctness

- **Key sets identical.** 53 keys, same order, both themes; no key contains a digit (verified
  programmatically, and `contrast.test.ts` now asserts it).
- **Values match audit §1.2/§1.4 and the handoff `new-dna.css` exactly**, light and dark, including
  the D5 corrections (`textOnAccent #1D1C18` both themes, light `textMuted #6C695F`, dark `#928E83`,
  the five `*Ink` keys at the audit's exact lightnesses, `borderControl`, the five per-theme
  shadow/focus roles, `overlayScrim`). Cross-checked against `new-dna.css` `--sh1/--sh2/--ring` and
  the `.nj-sock` / `.nj-pad.hit` inset shadows.
- **Retired keys are gone** from DTCG, `types.ts` (`ThemeColors` → `ThemeValues`), and every
  consumer. The mandated sweep
  `grep -rn -- "--sketch-\|--shadow-node\|--shadow-menu\|--shadow-sketch\|--border-sketch\|--bg-canvas-alt\|--audio-input\|--audio-output\|--control-input\|--control-output\|font-sketch" src packages .ladle index.html`
  returns **empty**.
- **Primitives emit the exact expected names**: `--text-micro 9.5px`, xs/sm/md/lg/xl/2xl
  11/13/14/15/22/30, `--radius-pill 99px`, `--motion-fast`, `--motion-spring`, `--press-scale-btn`,
  `--press-scale-pad`, `--hover-lift`, `--knob-size 52px`, `--key-tile-size 48px`,
  `--tracking-micro`, `--port-size 18px`, `--node-min-width 190px`. `port.spacing` and
  `node.header-height` removed (0 consumers), `overlay.scrim` moved per-theme.
- **`bun run tokens` is idempotent** — md5 of `dist/variables.css`, `src/generated/themes.ts` and
  `packages/oj-ui/oj-tokens.css` unchanged across a second run.

### `timelineClipBorder` deviation — judged CORRECT, keep it

The report deviates from the audit table (`--line2`) and uses `--text-muted` (`#6C695F` / `#928E83`).
That is exactly the audit's own option (a) in §6.3, and it is the right call:

- A clip edge is a **content boundary**, so WCAG 1.4.11 applies; the table's `--line2` gives
  **1.73:1** on white. The shipped value gives **5.49:1** light / **5.05:1** dark.
- Option (b) (fill-delta instead of stroke) would force `timelineClipBg` off `--surface` and change
  the clip's whole visual identity — a Wave-4 redesign decision, not a token swap.
- On a projector a 1px `#C8C5BB` clip edge on white is invisible. `--text-muted` reads at a glance.

The only cost is that clip edges now sit slightly heavier than the New DNA hairline vocabulary. That
is a legible-first trade the covenant supports. **Accept.**

### Value notes (not blockers)

- **D8 — dark `dangerInk` is 4.29:1 on `--bg-tertiary`**, below the 4.5 the `*Ink` pair exists to
  guarantee. The audit's "dark `-ink` = base, everything clears 4.5" claim is simply wrong for `bad`
  on `inset` (§6.4 itself prints the 4.3 minimum). Inherited faithfully rather than introduced.
  Fix: `dark.json` `dangerInk` → `oklch(0.69 0.21 25)`.
- **D9 — `--border-control` under-delivers on the surface it was invented for.** 3.07:1 on
  `--bg-node` (the audit's figure) but **2.77:1 light / 3.38:1 dark on `--bg-canvas`**, and
  **2.56 / 2.73 on `--bg-tertiary`** — and the handoff socket well sits on `--inset`
  (`.nj-sock{background:var(--inset)}`), while today's `Port.css:12` sits on `--bg-canvas`. Land the
  correct value with the S3 socket redesign (light ≈ `#8A8779`, dark ≈ `#807C6F`).
- **D10 — `--transition-fast` and `--motion-fast` now hold the identical value** (`primitive.json`),
  with 115 consumers on the old name and 0 on the new one. That is the parallel path code-value #2
  forbids; the audit asked for "rename in place, no alias". Either mechanically rename
  `--transition-fast` → `--motion-fast` (and `--transition-normal`/`--motion-spring`) in a follow-up
  increment, or delete `motion.*` until W3 consumes it. Same for the 7 zero-consumer primitives
  (`--press-scale-*`, `--hover-lift`, `--knob-size`, `--key-tile-size`, `--tracking-micro`,
  `--text-micro`) and the 6 zero-consumer theme tokens (`--shadow-inset`, `--shadow-pressed`,
  `--focus-ring`, all five `*-ink`) — acceptable only because W3–W5 consume them; if a wave closes
  without them, covenant #8 says delete.

---

## 2 — Mechanical rewrite quality

Sampled the full diff plus these 15+ files: `SchematicNodes.css`, `CommandBar.css`,
`ArrangementSurface.css`, `NodeShell.css`, `Port.css`, `Button.css`, `Slider.css`, `Toggle.css`,
`Menu.css`/`DropdownMenu.css`, `global.css`, `Toolbar.css`, `Guide.css`, `MIDIVisualNode.css`,
`Surface.css`, `KeyTile.css`, `SegmentedControl.css`, `AppErrorBoundary.css`, `Swatch.css`,
`index.html`, `.ladle/components.tsx`.

**What is right.** The 190 `--sketch-black` sites split correctly by role: `border:` →
`--border-strong`, ink fills / `color:` / `color-mix` washes → `--text-primary`. Shadows map
sensibly (node/card/keycap → `--shadow-raised`, menu/modal/popover → `--shadow-overlay`).
**Zero** hard-offset `box-shadow: Npx Npx 0` literals survive (grep clean). `--border-control` is
used on exactly the two sanctioned sites: `Port.css:11` (socket ring) and `Slider.css:54,66` (thumb,
webkit + moz). The universal-port rainbow gradient and its keyframes are gone. No `:active
translateY` rule was left depending on a deleted hard shadow (`Button.css:31`, `KeyTile.css:34-38`,
`Toggle.css:65-71` all still read correctly on the soft shadow).

### Defects

**D1 (must-fix) — `.ladle/components.tsx:69`: undefined variable, border silently dropped.**
```
border: 'var(--border-subtle-width) solid var(--text-primary)',
```
`--border-sketch-width` was find-and-replaced into `--border-subtle-width`, which does not exist
anywhere. An invalid `var()` in a shorthand is invalid-at-computed-value-time, so the Ladle
"View in Figma" chip loses its border entirely. This is the **only** new undeclared `var()` in the
change set (I audited every `var(--x)` in `src`, `packages/oj-ui/src`, `.ladle`, `index.html`
against all declarations + JS `setProperty` + the generated theme keys; the other 32 undeclared
names all pre-date this wave and all carry fallbacks).
*Fix:* `border: '1px solid var(--border-subtle)'`.

**D2 (must-fix) — three full-screen scrims invert in dark.** `--sketch-black` → `--text-primary` is
right for ink, wrong for a scrim: in dark `--text-primary` is `#F1EFE8`, so the scrim becomes a
**white wash** and the studio behind the modal goes light grey. Visible in
`dark-03-settings-theme.png` and `dark-05-commandbar.png`.
- `src/components/Settings/SettingsPanel.css:13` — `color-mix(in srgb, var(--text-primary) 45%, transparent)`
- `src/components/CommandBar/CommandBar.css:20` — `… var(--text-primary) 28% …`
- `src/components/Settings/KeybindingsPanel.css:173` — `… var(--text-primary) 50% …`

D4 created `--overlay-scrim` for exactly this and it currently has **one** consumer (Modal).
*Fix:* all three → `background: var(--overlay-scrim);` (and drop the now-false "Clean ink scrim"
comment). While there: `src/components/Clips/WaveformEditorModal.css:12` (`rgba(0,0,0,0.7)`) and
`src/components/Nodes/MIDIVisualNode.css:360` (`var(--bg-overlay, rgba(250,250,250,0.9))`) are
pre-existing literals with the same failure mode.

**D3 (must-fix) — `contrast.test.ts` imports a phantom dependency.** `colorjs.io@0.5.2` is not in
`package.json`; it resolves only because it is a hoisted transitive dep of `style-dictionary`. Any
`style-dictionary` bump or a hoisting change turns the a11y gate into an import error.
*Fix:* `bun add -d colorjs.io` (MIT; add the THIRD-PARTY row if the policy requires it).

**D4 (should-fix) — `packages/oj-ui/src/components/Port/Port.tsx:49`: latent colourless port.**
```
: direction && `oj-port--${colorKind}`,
```
Now that direction is out of the class name, the `direction &&` guard is a leftover: a `<Port
kind="audio" />` without `direction` renders with no kind class and no colour. No live regression
(only `MathNode.tsx:52` omits `direction`, and it is `universal`), but it is a trap for S3.
*Fix:* drop the guard — `` : `oj-port--${colorKind}` ``.

**D5 (should-fix) — `index.html:53,93`: dark boot card keeps light hairlines.** The card border
`#E3E1DA` and the dot border `#C8C5BB` are hardcoded literals that the dark inline script does not
override, so a dark cold start draws a near-white 1px ring on a `#201F19` card.
*Fix:* add `--oj-boot-line`/`--oj-boot-line2` to the `:root` block and to the dark script (and
optionally swap the light-tinted `rgba(24,22,16,…)` boot shadow).

**D6 (should-fix, semantics) — mixer fader keeps a 2px ink construction.**
`ArrangementSurface.css:289-292`: track and thumb are `border: 2px solid var(--text-primary)`. This
is a control boundary, not ink — it should be `1px solid var(--border-control)` like every other
thumb. It is the single loudest leftover of the old language on the arrangement surface.

**D7 (nit) — `SegmentedControl.css:~62`: `box-shadow: inset calc(-1 * 1px) 0 0 0 var(--text-primary)`.**
Mechanical residue of `calc(-1 * var(--border-sketch-width))`. Should be `inset -1px 0 0 0
var(--border-subtle)` (it is a divider, not ink).

**D11 (should-fix, covenant #5) — 32 CSS/TSX files still document the retired system.** e.g.
`Slider.css:1-4` now says "the sketchbook hand … a 2px `--text-primary` ink border" over code that is
1px `--border-control`; `Button.css:2` "2px ink border … Caveat label"; `Swatch.css:1-2`
"2px ink border, Caveat name" + "Hard-Shadow Rule"; `SettingsPanel.css:32` "sticker pressed on
paper". The find-and-replace rewrote the *tokens inside the prose*, which made the comments
confidently wrong rather than merely stale — and Wave 3–5 builders read these first.

---

## 3 — `index.html` boot shell

PASS apart from D5. Light values are the `:root` default; the inline script is 1 line, wrapped in
`try{}catch{}`, does nothing but `setProperty`, and cannot throw; a single `outfit-variable.woff2`
preload; no cream literals remain. Verified in-browser at `DOMContentLoaded` with
`localStorage['openjammer-theme']='dark'`: `--oj-boot-paper` = `#161510`, `--bg-canvas` = `#161510`,
`document.body` computed background `rgb(22,21,16)` — **no light flash** (`dark-00-boot.png`).

## 4 — Settings theme picker

Behaviour is correct and browser-verified: real `role="radiogroup"` + two `role="radio"` swatches
with `aria-checked`, roving `tabIndex` (`0` on the checked one, `-1` on the other — confirmed live in
both themes), Arrow Left/Right/Up/Down wrap and re-focus, Space activates (and `aria-pressed` is
explicitly nulled out so the radio isn't double-typed). It uses oj-ui `Swatch`, and `selectedTheme`
now follows external changes via a new `openjammer:theme-change` CustomEvent from
`oj-tokens/src/index.ts:68` plus a `storage` listener. The duplicate `applyTheme` effect in
`App.tsx` is correctly deleted (`main.tsx` remains the single pre-paint path).

**FAIL on the deliverable:** `src/components/Settings/__tests__/` contains only
`KeybindingsPanel.test.tsx` and `UpdatesPanel.test.tsx`. There is **no** test for the theme picker,
so none of the above is regression-guarded. That was an explicit item-4 requirement.
*Fix:* `SettingsPanel.test.tsx` — render, assert `radiogroup` + two `radio`s + `aria-checked`, press
ArrowRight → checked moves and `saveThemeId` is called, dispatch `openjammer:theme-change` → the
selection follows.

## 5 — `contrast.test.ts`

Parser verified by hand: `oklch(0.66 0.19 40)` → **#ee5e23**, matching the audit's `#EE5E23`. Hex,
`rgb()/rgba()` and `oklch()` all go through `colorjs.io`; `color-mix(in oklab, X n%, transparent)` is
regex-matched and alpha-blended against the resolved background. Runs over **both** themes via
`describe.each`. Floors are §6.3's, with `timelineSelection` tightened 2.9 → 3 and the retired
`sketchBlack` assertion re-pointed to `textPrimary`. The token-schema test (same key set, digit-free)
is present.

Would it fail on a bad value? Yes: option (b)'s `#C8C5BB` on `#FFFFFF` computes 1.73 against a floor
of 3, and an unparseable value yields `NaN`, which fails `toBeGreaterThanOrEqual`. Measured margins:

| pair | floor | light | dark |
|---|---:|---:|---:|
| textPrimary / laneBg | 4.5 | 17.05 | 14.36 |
| textSecondary / chromeBg | 4.5 | 6.77 | 6.69 |
| textMuted / clipMutedBg | 4.5 | 4.57 | 4.50 |
| clipBorder / laneBg & clipBg | 3 | 5.49 | 5.05 |
| noteFill / laneBg | 3 | 3.65 | 6.50 |
| playhead / laneBg | 3 | 4.29 | 6.06 |
| selection / clipBg | 3 | 3.36 | 6.06 |
| gridBar / laneBg | 1.5 | 1.66 | 1.94 |

**D8 (should-fix) — the three D5 corrections are the only things NOT guarded.** `textOnAccent` ×
`accentPrimary` (5.07 / 6.26), the five `*Ink` × `bgTertiary` (light 4.57–4.69; dark 4.29–7.25), and
`borderControl` are all absent from the suite — i.e. the exact values D5 exists to protect can
regress silently, and `dangerInk` dark is already 4.29. *Fix:* three more `it.each` rows.

## 6 — Fonts

Clean. Exactly one `outfit-variable.woff2` in `public/fonts/` and in `apps/docs/public/fonts/` (the
four static weights are deleted in both). Exactly one `@font-face` with `font-weight: 400 700` in
each of `src/styles/fonts.css`, `apps/docs/src/fonts.css` and `.design-sync/fonts.css`. One preload
in `index.html`. `.design-sync/config.json` `extraFonts` collapsed to the single file.
`THIRD-PARTY-LICENSES.md` updated to "One latin-subset variable WOFF2 (wght 400–700)". In-browser:
`document.fonts.check('400 15px Outfit')` and `('700 15px Outfit')` both **true**, and exactly
**one** Outfit network request per page load.
*Note:* `.design-sync/figma-scripts/*.js` and `.design-sync/conventions.md` still name Caveat/Inter —
generated artifacts, D15/Wave-6 territory, correctly out of scope here.

## 7 — Gates

| gate | result |
|---|---|
| `bun run tokens` | PASS, idempotent (2 themes emitted) |
| `bunx tsc --noEmit -p tsconfig.app.json` | **PASS** |
| `bun run lint` | **PASS** (clean now that `plans/**` is ignored) |
| `bun run test:run -- packages …contrast…tokenLiteralGate…envTools…Settings` | **PASS — 43 files / 319 tests** |
| `bun run build` | **PASS** (Vite + PWA) |

Logs: `plans/redesign-new-dna/.scratch/w2-gate/{tsc,lint,test,build}.log`. The ~8 red tests in the
concurrent Arrangement/song/Pi lane are out of scope and were not re-run.

## 8 — Browser

`bun dev -- --port 5198 --strictPort`, one Chromium, harness
`plans/redesign-new-dna/.scratch/w2-gate/verify.mjs` run under `node`. **Dev server stopped; port
5198 confirmed free.** 14 screenshots in `plans/redesign-new-dna/.scratch/w2-gate/`
(`{light,dark}-0{0..6}-*.png`): boot, canvas+help, Keyboard→Keys→Speaker (3 nodes added, 1 cable,
context menu confirmed closed), settings/theme, arrangement (Paper Sketch), command bar, context
menu.

Assertions: **0 console errors, 0 page errors** in both themes ·
`getComputedStyle(document.documentElement).getPropertyValue('--sketch-black') === ''` in both ·
dark cold start with **no light flash** · exactly one Outfit request · `document.fonts.check` 400 &
700 true · resolved tokens correct in both themes (`--radius-pill 99px`, `--text-md 14px`,
`--font-sans` Outfit, `--border-control` present).

### Still reads as the old sketchbook (taste-wave input, not blockers)

| # | What | Where | Shot |
|---|---|---|---|
| V1 | First-run toast is a **light card in dark theme** — `<Toaster>` (`App.tsx:728`) has no `theme` prop, so Sonner's `light` defaults beat the `[data-sonner-toaster]` var overrides. The most glaring dark break; one-line fix. | `App.tsx:728` | `dark-02-graph.png` |
| V2 | Modal scrims wash the studio **lighter** in dark (defect D2) | Settings, Keybindings, CommandBar | `dark-03`, `dark-05` |
| V3 | Ink-filled actives: `Canvas`/`Arrangement` segment and `Collaborate` are solid near-black with white text — the retired ink-fill state, not the New DNA `--surface`-on-`--inset`+`--sh1` | topbar | `light-02-graph.png` |
| V4 | Section chips are `2px solid var(--timeline-section-marker)` — bright 2px outlines in dark | `ArrangementSurface.css:147` | `dark-04-arrangement.png` |
| V5 | Speaker volume slider renders as **two stacked bars** (orange fill + a full-width `--text-muted` track hairline below); thumb sits half outside the rail. Handoff `.nj-range` has no track border at all. | `Slider.css:23-40` | `light-02`, `dark-06` |
| V6 | Ports are still flat 18px discs clipped on the card edge, not recessed wells; connected ports still carry `box-shadow: 0 0 8px` — **D7 says no glow on ports ever** | `Port.css:26,32` | `*-02-graph.png` |
| V7 | Instrument ("Keys") body renders an italic `Pedal` label struck through by a rule plus a stray spinner glyph — reads broken | `SchematicNodes.css` | `light-02-graph.png` |
| V8 | Ruler bar numbers clipped at the top of the row | `ArrangementSurface.css:140` (`.arrangement-bars-row` 22px) | `*-04-arrangement.png` |
| V9 | Arrangement lanes stop ~380px down; the rest of the viewport is bare ground | Arrangement | `*-04-arrangement.png` — likely the concurrent timeline lane, verify after it lands |
| V10 | Latency banner collides with the transport row in the sky band | Arrangement | `*-04-arrangement.png` |
| V11 | Command-bar placeholder appears clipped at the panel's left edge | `CommandBar.css` | `dark-05-commandbar.png` |
| V12 | `--radius-pill: 99px` unused on the chips that should be pills (Ripple/Mix/Export/BPM) | Arrangement chrome | `*-04-arrangement.png` |
| V13 | 2px literal borders survive in 18 files (`SchematicNodes` 18, `ArrangementSurface` 18, `ResizeHandles` 8, `MIDIVisualNode` 7 …) — expected, W3–W5 | — | — |
| V14 | Welcome copy still says "A sketchbook you can play" | `App.tsx` | `dark-00-boot.png` |

Nothing is **unreadable**. Two behavioural observations, both pre-existing and out of S2 scope:
**Escape does not close the Settings panel**, and the add-node **submenu can open underneath the
help panel**, which then swallows the click (Playwright: "`.help-panel` intercepts pointer events").
Both belong to `03-canvas-app-reliability-audit.md`.

---

## Ranked must-fix (all small)

1. **D3** — `bun add -d colorjs.io`. The a11y gate currently depends on a hoisted transitive dep.
2. **D2** — three scrims → `var(--overlay-scrim)` (`SettingsPanel.css:13`, `CommandBar.css:20`,
   `KeybindingsPanel.css:173`). Wrong ink/boundary call; visibly inverts dark.
3. **D1** — `.ladle/components.tsx:69` → `border: '1px solid var(--border-subtle)'`. Undefined
   variable, dead declaration.
4. **Item 4's missing test** — add `src/components/Settings/__tests__/SettingsPanel.test.tsx`
   (radiogroup, `aria-checked`, arrow keys, external `openjammer:theme-change` sync).

Then re-run `bun run lint && bun run test:run -- packages src/components/Settings …` and commit as
`feat(design): New DNA tokens — light + dark replace the sketchbook themes`.

**Strongly recommended in the same commit** (one-liners, all visible): **V1**
(`<Toaster theme={…}>`), **D5** (`index.html` dark hairlines), **D4** (`Port.tsx` guard).
Queue for W3: D6, D7, D8, D9, D10, D11.
