# W3-P2 gate review — oj-ui surfaces & feedback

Date: 2026-08-29 · Reviewer: design-quality gate (read-only) · Lane: W3-P2
Scope reviewed: uncommitted changes in `packages/oj-ui/src/components/{Surface,Modal,Menu,Callout,Banner,Chip,StatusDot,Kbd,Spinner,ProgressBar,PanelHeader,ListRow,CodeBlock,Swatch}/**`.
`packages/oj-ui/src/index.ts` is **unmodified** (no type-name change was needed). The untracked
`packages/oj-ui/src/components/Meter/` is another lane's and was not reviewed.

## Verdict

**COMMIT** — with two token-only follow-ups (§Must-fix) to land on this lane before Wave 3 closes.

Fidelity to `new-dna.css` is exact, value-by-value, in both themes (measured in-browser, not read
off the CSS). Every app consumer compiles and keeps its meaning. Focus trap, Escape, focus restore
and menu roving nav are unchanged and were driven live. Nothing in the diff regresses a shipped
screen. The two must-fixes are non-text (graphic) contrast values on 6–8px dots; both are one CSS
custom-property change inside lane ownership, and in every current call-site the dot is
accompanied by a text label, so no screen misreads today.

## Independent evidence

Own harness (not the lane's): `plans/redesign-new-dna/.scratch/w3-p2-gate/gate.cjs`, run under
`node` against one Chromium, Ladle on port **61005** with the lane's isolated vite config; Ladle
stopped after. 34 screenshots + `gate-results.json` in `plans/redesign-new-dna/.scratch/w3-p2-gate/`.
`document.fonts.check('600 14px Outfit') === true`. **0 console errors, 0 page errors** across 30
story loads. Themes applied from `packages/oj-tokens/src/generated/themes.ts` (Light/Dark).

## 1. Fidelity, value by value (computed styles, both themes)

| Component | Handoff spec | Measured | Verdict |
|---|---|---|---|
| Menu panel | 12px radius, 6px padding, sh2, 1px `--line`, surface fill | `12px` / `6px` / `--shadow-overlay` / `1px #E3E1DA` / `#FFF` (dark `#201F19`, `#33312A`, dark sh2) | ✓ exact |
| Menu item | 500 14px Outfit, 8px 10px, 8px radius, hover inset | `14px` `500` Outfit, `8px 10px`, `8px`, hover `--bg-tertiary` | ✓ exact |
| Menu category | 600 10.5px, .1em, uppercase, 8px 10px 4px | `10.5px` `600` `letter-spacing:1.05px` (=.1em) uppercase `8px 10px 4px` | ✓ exact |
| Menu separator | 1px `--line`, margin 5px 8px | `1px`, `5px 8px`, `--border-subtle` | ✓ exact |
| Menu keycap | 500 11px mono, inset bg, 1px subtle, 5px radius, 2px 5px | `11px` `500` JetBrains Mono, `--bg-tertiary`, `1px --border-subtle`, `5px`, `2px 5px` | ✓ exact |
| Chip | pill, 600 12px, 4px 10px, inset+hairline, text-only tones, NO dot | `99px`, `12px` `600`, `4px 10px`, gap `6px`, `--bg-tertiary` + `--border-subtle`; **0** `.oj-status-dot` inside any chip | ✓ exact |
| Callout | 12px radius, 12px 14px, sh1, no side bar | `12px`, `12px 14px`, `--shadow-raised`, uniform `1px` hairline (`border-left-width == border-top-width`) | ✓ exact |
| Callout title/body | title 600 14px tinted; body 400 13px/1.45 secondary | title `14px/600` per-variant ink; body `13px/400`, line-height `18.85px` (= 13×1.45), `--text-secondary` | ✓ exact |
| Banner | same construction as Callout | `12px`, `12px 14px`, `--shadow-raised`, uniform hairline, tone on title/icon only | ✓ exact |
| Surface | raised = sh1, overlay = sh2, `--bg-node`, `--border-subtle` | both shadows match the handoff's sh1/sh2 token strings in light and dark | ✓ exact |
| Modal | overlay Surface, radius-xl, scrim + blur(14px) saturate(1.1), 260ms rise+fade | panel `20px` + `--shadow-overlay`; scrim `--overlay-scrim` + `backdrop-filter: blur(14px) saturate(1.1)`; `animation-name: oj-modal-rise, oj-modal-fade` | ✓ |
| ProgressBar | 6px pill track, indeterminate 30% segment | `height:6px`, `border-radius:99px`, `--bg-tertiary`; indeterminate fill `84px` of `280px` (= 30%), `oj-progress-slide 1s` | ✓ |
| StatusDot | 8px, no border, no pulse | `8×8`, `border-width:0`, `animation-name:none` | ✓ |
| PanelHeader | title 600 22px | `22px` `600` | ✓ |
| ListRow | 500 14px, **8px radius**, hover inset, `current` = dot | `14px` `500`, hover `--bg-tertiary`, dot present — but **`border-radius: 10px`** (`--radius-md`) | ✗ see D1 |
| CodeBlock | inset panel, 1px subtle, radius-sm, mono 12px, primary ink | `--bg-tertiary`, `1px --border-subtle`, `6px`, JetBrains Mono `12px`, `--text-primary` | ✓ |
| Swatch | 1px `--border-strong`, radius-md, name 500 13px, selected accent + ring | `1px #C8C5BB`, `10px`, `13px/500`; selected → accent border + `--focus-ring` | ✓ |

### Deviations

| # | Deviation | Justified? |
|---|---|---|
| D1 | `ListRow` radius is **10px**, not the spec'd/reported 8px. The W3-P2 report claims "8px radius" — a false claim, not a lie of substance. Menu rows are 8px, list rows 10px; the two families no longer share a corner. | **No.** Cosmetic; fix or restate. |
| D2 | `ListRow.is-current` dot uses `--accent-secondary` (the *lighter* hover accent) instead of `--accent-primary`/`--accent-ink`. Light-theme ratio **2.51:1** — below the 3:1 non-text minimum. | **No** — see must-fix #1. |
| D3 | `StatusDot` lost its `1px --border-strong` edge (per spec). Light-theme dot-vs-ground: ok **2.83**, warn **2.27**, info 3.27, bad 4.30, idle 4.95. Dark all ≥5.31. | Spec'd, but under 3:1 — see must-fix #2. |
| D4 | `.oj-chip.is-pressed` sets `color: --text-primary`, which outranks the tone inks, so a pressed danger/warning filter chip shows no tone. Rule is **unchanged** from before this lane, but it now matters more because the glyph dot that used to carry the level in `DevLogPanel` is suppressed. | Pre-existing; meaning still carried by the label text ("Warn"/"Error") and `aria-pressed`. Non-blocking. |
| D5 | The literal radii (`.oj-callout`/`.oj-banner` 12px, `.oj-menu` 12px) beat `.oj-surface--radius-*` only by **stylesheet order**, not specificity (both single-class). | Verified correct in dev *and* in the production bundle (`dist/assets/src-*.css`: `.oj-surface--radius-lg` @11407 precedes `.oj-callout` @11515, `.oj-menu` @28490, `.oj-banner` @46918). Fragile but currently sound; passing `radius` props that already match would be sturdier. |
| D6 | `.oj-menu { min-width: var(--node-min-width) }` — a *node* token sizing a menu (190px vs the handoff demo's 220px). | Container-driven in the app; harmless token misuse. Non-blocking. |
| D7 | Modal drops `backdrop-filter` under `prefers-reduced-motion` as well as `prefers-reduced-transparency`. Blur is not motion. | Harmless (the 0.45/0.55 scrim still separates), but over-eager. Non-blocking. |
| D8 | `.oj-menu-item[aria-disabled='true']:hover { color: var(--text-primary) }` flips a *disabled danger* row from danger ink to primary on hover. | Cosmetic edge case. Non-blocking. |
| D9 | `PanelHeader` back went from a ghost Button with visible `backLabel` text to an icon-only `IconButton` (`backLabel` → `aria-label`). | Spec'd by the work order; **zero app consumers use `onBack`**, so no regression today. |
| D10 | Report says "311 tests / 39 files"; actual is **317 / 40** (another lane added a suite since). | Not a defect. |

Focus-ring idiom is not uniform inside the lane: Menu and Swatch use `--focus-ring` (box-shadow),
ListRow uses a `1.5px` accent `outline`. Both were spec'd by the work order, so this is noted, not
charged against the lane — but the wave should settle on one.

## 2. Contrast (computed in-browser against the real composited ground)

**Text, AA ≥ 4.5 — all pass, both themes** (light / dark):

| Target | Light | Dark |
|---|---:|---:|
| Menu item label | 17.05 | 14.36 |
| Menu danger item | 6.72 | 6.39 |
| Keycap (`Kbd`) | **4.57** | **4.50** |
| Kbd `custom` | 5.34 | 5.96 |
| Chip neutral / success / warning / danger | 5.92 / 5.31 / 5.11 / 5.59 | 6.18 / 6.06 / 7.25 / 5.70 |
| Callout title info/success/warning/danger/tip | 17.05 / 6.39 / 6.14 / 6.72 / 6.43 | 14.36 / 6.80 / 8.12 / 6.39 / 6.68 |
| Callout body | 7.13 | 6.93 |
| Banner title info/warning/danger | 17.05 / 6.14 / 6.72 | 14.36 / 8.12 / 6.39 |
| ListRow rest / selected / disabled-ink | 15.37 / 5.34 | 15.89 / 5.96 |
| PanelHeader title / subtitle | 17.05 / 7.13 | 14.36 / 6.93 |
| CodeBlock | 14.17 | 12.81 |
| Swatch name | 17.05 | 14.36 |

Keycap text is the thinnest margin in the system (4.50 in dark at 11px) — it passes, but any future
darkening of `--bg-tertiary` or lightening of `--text-muted` will break it. Worth a token guard.

**Non-text graphics, 1.4.11 ≥ 3:1 — two failures, light theme only:**

| Graphic | Light | Dark |
|---|---:|---:|
| `ListRow` `current` dot | **2.51 ✗** | 7.59 |
| StatusDot `ok` | **2.83 ✗** | 7.35 |
| StatusDot `warn` | **2.27 ✗** | 8.99 |
| StatusDot info / bad / idle | 3.27 / 4.30 / 4.95 | 7.19 / 5.31 / 5.59 |

## 3. Motion / states / layout

- **Reduced motion (emulated):** ProgressBar indeterminate → `animation:none`, `width:280px` (100%),
  `opacity:.4`, `transform:none` — a static, meaningful "working" bar. Spinner → `animation:none`
  with the accent top-border still visible against the subtle ring. Modal → `animation-name:none`
  and `backdrop-filter:none`, scrim retained. All three collapse to static, readable states.
- **`prefers-reduced-transparency`: still unverifiable.** Playwright's `emulateMedia` has no such
  key. The CSS branch parses and ships; the lane's "unverified" note stands and is honest.
- **No layout shift:** menu-item hover `dx/dy/dw/dh = 0/0/0/0` (both themes); list-row hover
  `dx/dy/dh = 0/0/0`. ListRow reserves a `1px solid transparent` border; Chip keeps its border in
  `pressed`; Swatch's `1.5px` selected border resolves to a `1px` used width in Chromium, so
  selection is a colour change only.
- **Motion tokens:** transitions use `--motion-fast` / `--motion-spring`. Keyframe *animations* use
  literals — Modal's fade `260ms cubic-bezier(.2,.8,.3,1)` (duplicates `--motion-fast`'s curve at a
  different duration), ProgressBar `1s ease-in-out`, Spinner `600ms linear` (pre-existing). Minor.
- **State distinctness:** `is-selected` and `:hover` both fill with `--bg-tertiary`; they read apart
  only by ink (`--accent-ink` vs `--text-primary`). Legible, but a hovered row and a selected row
  share a fill — see the screenshot `list-row--states--light.png`, where the top row is hovered.

## 4. Consumer safety (verified, not claimed)

- **`bunx tsc --noEmit -p tsconfig.app.json` → PASS** (exit 0, zero errors, including the other
  lanes' in-progress files).
- **`SurfaceElevation`:** legacy `rest`/`menu`/`lifted` retained as deprecated members and
  normalized in the rendered class. App call-sites: `AudioSettingsPanel.tsx:243` and
  `UpdatesPanel.tsx:271` both pass `elevation="rest"` → render `--elevation-raised` →
  `--shadow-raised`, the *same* shadow token those surfaces had before. Intent preserved.
- **Chip `glyph`:** exactly two app call-sites.
  `AudioSettingsPanel.tsx:352` (`<IconBolt/>`) still renders — confirmed by the non-dot branch and
  its test. `DevLogPanel.tsx:251` (`<StatusDot status={LEVEL_DOT[level]}/>`) is suppressed; **no
  meaning is lost** — the chip's own children are the level word (`Trace`/`Debug`/`Info`/`Warn`/
  `Error`), `tone` still tints Warn/Error, and `aria-label` reads "Filter by Error (n)". Caveat: the
  suppression is an identity check (`glyph.type === StatusDot`), so a wrapped or re-exported
  StatusDot would slip through — acceptable for a deprecation shim.
- **Modal, driven live:** focus lands inside the panel on open; 8 consecutive `Tab` presses stay
  inside (Confirm ⇄ Cancel); `Escape` closes; focus is restored to the "Open dialog" opener. Unchanged.
- **Menu keyboard, driven live:** `ArrowDown` New Patch → Open…, `End` → last item (Export as),
  `Home` → first. Roving nav unchanged.
- **`MenuItem.danger`:** additive and currently unused by app code —
  `src/components/Canvas/ContextMenu.tsx` (another lane) and `Toolbar/DropdownMenu.tsx` (its own
  local `MenuItem` type) compile untouched. Not required, correctly optional.
- **`PanelHeader.onBack`:** no app consumer passes it, so the Button→IconButton swap breaks nothing.

## 5. Tests & gates (re-run by me)

| Gate | Result |
|---|---|
| `bun run test:run -- packages/oj-ui` | PASS — **40 files, 317 tests** |
| `bunx tsc --noEmit -p tsconfig.app.json` | PASS |
| `bunx eslint packages` | PASS |
| `bunx figma connect parse` | PASS |
| `bun run build` | PASS (tsc -b + Vite + PWA) |

New tests are **non-vacuous** — they assert the behaviour that actually changed: Surface's
deprecated→new elevation mapping via `rerender`; Menu asserting `oj-surface--elevation-overlay` and
the `--danger` modifier; Chip asserting the dot glyph is *absent* while the count survives and that
a non-dot glyph still renders; ProgressBar asserting `aria-valuenow` is null and the inline width is
empty when indeterminate; PanelHeader asserting the back control is an `oj-icon-btn` with the
`aria-label`. No snapshot-only or tautological additions found.

## 6. Taste, against the handoff rows

Looked at `menu--context-menu--{light,dark}`, `chip--tones--dark`, `callout--variants--*`,
`banner--tones--*`, `list-row--states--*`, `modal--default--dark`, `swatch--states-*` from my own run.

- **Menu** is the strongest piece — panel, 34px row rhythm, category tracking, hairline separators and
  the trailing keycap sit essentially on top of the handoff's "Menu" row. The danger row's red at
  500 weight matches the reference's inline `--bad` treatment.
- **Chips** in dark read cleanly and distinctly; the tinted-text-only construction is the handoff's
  "Status & messages" row. Nothing a musician would pause at.
- **Callout/Banner:** title tint over neutral body is calm and correct; no stripe anywhere.
- **Modal panel edge in dark** is fine: the `#33312A` hairline plus the sh2 stack separates the panel
  from the blurred, scrimmed ground.
- **Keycap weight** (500/11px mono) is right — quiet, not a toy key.
- **The `current` dot** is the one place the eye has to work in light theme; see must-fix #1.
- **ListRow rhythm:** 28px rows with `4px 8px` padding are noticeably tighter than the 34px menu rows,
  and the 10px vs 8px corner differs too. Not wrong, but the two row families no longer feel cut from
  the same block. Cosmetic.

## Must-fix (ranked) — token-only, land on this lane

1. **`ListRow` `current` dot fails non-text contrast in light (2.51:1).** `ListRow.css`
   `.oj-list-row.is-current .oj-list-row__body::before { background: var(--accent-secondary) }` uses
   the *lighter* hover accent. Swap to `var(--accent-ink)` (≈5.3:1 measured on the same ground) or at
   minimum `var(--accent-primary)`. This is the library's only "this is the live one" affordance;
   today `ModelPicker` also renders a `<Chip tone="success">current</Chip>` so nothing misreads on
   screen, but the primitive itself must carry its own state.
2. **`StatusDot` `ok` (2.83) and `warn` (2.27) fall under 3:1 in light theme** after the border was
   removed. Use the `*-ink` tokens in the light theme for those two fills (dark is already ≥7), or
   restore a hairline. Every current app site pairs the dot with a text label, so this is a primitive
   robustness fix, not a shipped-screen defect.

Recommended but not blocking: correct the report's "8px radius" ListRow claim (it is 10px) and pick
one of 8px/10px for menu rows and list rows; let `.oj-chip.is-pressed` keep the tone ink; give the
Modal fade a motion token.

## Artifacts

- This review: `plans/redesign-new-dna/W3-P2-REVIEW.md`
- Gate harness: `plans/redesign-new-dna/.scratch/w3-p2-gate/gate.cjs`
- Measurements + contrast + a11y traces: `plans/redesign-new-dna/.scratch/w3-p2-gate/gate-results.json`
- 34 screenshots (light/dark + reduced-motion): `plans/redesign-new-dna/.scratch/w3-p2-gate/*.png`
