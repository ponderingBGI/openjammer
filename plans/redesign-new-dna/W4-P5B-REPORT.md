# W4-P5B REPORT — Ctrl+K palette + canvas context menu, gate fix round

Scope: `src/components/CommandBar/**` and `src/components/Canvas/ContextMenu.{tsx,css}` + their
tests, only. Work order: `plans/redesign-new-dna/.codex-prompt-w4-p5b.md` (items 1–4), ordered by
`plans/redesign-new-dna/W4-P5-REVIEW.md`.

**Status: all four items done, pinned, and verified live in both themes.** A previous `codex` run
had landed most of the delta and died on a usage limit mid-test-writing; this round judged that
work, **fixed three real defects it left behind** (below), completed the tests, and measured
everything against real painted pixels.

Artifacts: `plans/redesign-new-dna/.scratch/w4-p5b/` — `gate.mjs` (re-runnable, both themes),
`gate-log.txt`, `gate-results.json`, `probe2.mjs` (the fill sweep), `mutate.py` (the non-vacuity
proof), 16 screenshots.

---

## Gates

| Gate | Result |
|---|---|
| `bun run test:run -- src/components/CommandBar src/components/Canvas` | ✅ 6 files / **75 tests** (68 at the P5 gate → **+7** P5b tests) |
| `bunx tsc --noEmit -p tsconfig.app.json` | ✅ exit 0, no errors (none from other lanes either) |
| `bunx eslint src/components/CommandBar src/components/Canvas` | ✅ 0 problems |
| Browser pass, `node` harness, one Chromium on **5213**, light + dark | ✅ **ALL CHECKS PASS** |
| Console / page errors across the whole browser pass | ✅ **none** (the harness fails the run on any) |

Every one of the 7 new tests was proven **non-vacuous**: `mutate.py` reverts each fix in turn and
re-runs its test. All 7 go **RED**, then every file is restored:

```
item 1  - submenu typeahead scoping                            RED (test catches it)
item 1b - typeahead matches the node name, not the "Add" verb  RED (test catches it)
item 2  - Tab containment                                      RED (test catches it)
item 2b - Tab pulled back in from outside the panel            RED (test catches it)
item 3  - measured inset fill                                  RED (test catches it)
item 4  - ring gated in CSS                                    RED (test catches it)
item 4b - ring lights on Tab, never on typing                  RED (test catches it)
```

---

## Item 1 — MUST-FIX: context-menu typeahead scoped to the focused panel

**Change** — `src/components/Canvas/ContextMenu.tsx`

| Line | What |
|---|---|
| `140–171` | `focusTypeaheadMatch(key, rows, active, scope)` — one buffered routine, run over **whichever panel owns focus**. Wrapped in `useCallback` (the `react-hooks/purity` rule rejects a bare `Date.now()` in a render-scope helper). |
| `392–411` | `onSubmenuKeyDown` now claims printable keys and runs the routine over `activeElement.closest('.context-menu-submenu')`'s own `:scope > .oj-menu-item` rows. |
| `380–388` | `onRootKeyDown` still bails on `e.defaultPrevented` first, so a submenu keystroke can never reach the root typeahead. |
| `129–133`, `148`, `346` | The buffer carries a **scope** (`root` / `submenu:<name>`); crossing panels starts a fresh word instead of bleeding a half-typed one across. |
| `165–166` | Matches the literal label **or** the label with the `Add ` verb stripped. Every submenu row is phrased "Add <node>", so without this `s` for Speaker inside Output could never work — the exact case the review called out as "never works at all". |

**Pinning tests** — `src/components/Canvas/__tests__/ContextMenu.test.tsx`
- `302` *scopes typeahead to the open submenu that owns focus* — Input submenu open, press `o` →
  focus is the **Add Oscillator** menuitem, never the root **Output** row.
- `330` *types ahead by the node name inside a submenu, not by the "Add" verb* — Output submenu,
  focus on Add Recorder, press `s` → **Add Speaker**.

Both assert on **element identity**, not text: a category row's `textContent` contains its whole
submenu, so the text form of these assertions passes while focus is still outside the submenu
(codex's original `waitFor` had exactly that hole; it is fixed).

**Measured live (both themes)** — with the Input submenu open and focus on *Add Keyboard*, each of
`o i r e u c` (every key that prefixes a root category — the whole regression class) leaves focus
**inside the submenu**, `dataset.category === null`, in light and dark:

```
Input submenu: Add Keyboard | Add Midi | Add Microphone | Add Library
typing "o"/"i"/"r"/"e"/"u"/"c"  → focus stays "Add Keyboard", category=null   ✅ ×6 ×2 themes
Output submenu: Add Speaker | Add Recorder ; typing "s" → "Add Speaker"       ✅
root typeahead "e" → "Effects" (unchanged)                                    ✅
```

Screenshots: `p5b-01-menu-root--{light,dark}.png`, `p5b-02-menu-submenu--{light,dark}.png`.

---

## Item 2 — Focus containment in the palette / AI panel

**Defect found in the inherited work.** codex's trap only wrapped when `activeElement === first`
or `=== last`. Live, one Tab from the search field is the *agent handoff*: the AI panel replaces the
content, the focused input unmounts, focus lands on `<body>` — **outside** the panel, where neither
branch can fire. The very next Tab walked into `File` in the topbar behind the scrim. Reproduced:

```
before:  Tab from the last control -> {"tag":"body", inPanel:false}
         next Tab                  -> {"tag":"button", text:"File", inPanel:false}   ✗
```

**Change** — `src/components/CommandBar/CommandBar.tsx`

| Line | What |
|---|---|
| `89–90` | `FOCUSABLE` — the selector kept byte-identical to oj-ui `Modal`, so overlays share one containment contract. |
| `259–290` | `onOverlayKeyDown` — the trap. Wraps `last → first` / `first → last`, and **claims Tab on containment alone when focus is already outside the panel**, pulling it back to `first` (or `last` on Shift+Tab). Empty panel → focuses the `tabIndex={-1}` container. |
| `296–312` | New effect: entering AI mode, once the lazy panel has painted, moves focus to the panel's first focusable **only if focus is not already inside** — so a composer or list that autofocused itself keeps it. Fixes the `<body>` hole at the source as well as at the Tab. |
| `469–476` | The container is `role="dialog" aria-modal="true"` with an accessible name and `tabIndex={-1}`. |

Search-mode `Tab` is untouched: the input's own handler claims it (the agent handoff, W4-P5's
decision), and the trap bails on `defaultPrevented`.

**Pinning tests** — `src/components/CommandBar/__tests__/CommandBar.test.tsx`
- `376` *contains Tab focus inside the palette in both directions* — asserts
  `fireEvent.keyDown(...) === false`, i.e. the handler called `preventDefault`. That call **is** the
  containment; without it the browser moves focus regardless of where we put it.
- `402` *pulls Tab back in when focus has already fallen outside the palette* — blurs to `<body>`,
  fires Tab on the overlay, asserts focus is the search input and never the button behind the scrim.

**Measured live (both themes)**

| Check | light | dark |
|---|---|---|
| focusables inside the panel, search mode | 1 (`.command-bar-input`) | 1 |
| search mode: 8 × Shift+Tab | never leaves the panel | never leaves |
| entering AI mode | focus lands **inside** (`.oj-panel-header__back`) | inside |
| AI-mode focusables | 3 (back chevron · *Get the desktop app* · *Back to search*) | 3 |
| AI mode: 12 × Tab | cycles `Get the desktop app → Back to search → ⌄back → …`, never leaves | never leaves |
| AI mode: 12 × Shift+Tab | cycles in reverse, never leaves | never leaves |
| any topbar control (File/Edit/View) reached | **never** | **never** |

Screenshots: `p5b-03-palette-open--{light,dark}.png`, `p5b-08-ai-panel--{light,dark}.png`.

---

## Item 3 — Selected-vs-rest delta: inset fill + `--shadow-raised`, no side stripe

**Defect found in the inherited work.** codex chose
`color-mix(in oklab, var(--text-primary) 14%, var(--bg-tertiary))` without measuring the ink on top
of it. Measured against real painted pixels, 14% drops the selected row's `--accent-ink` label to
**3.914:1 (light) / 4.192:1 (dark)** — i.e. it would have shipped a **new AA failure** on the one
row the player is about to run, on a surface the P5 gate had verified at 5.34 / 5.96.

`probe2.mjs` sweeps the mix 0–16% against resolved token pixels in both themes. The two constraints
— fill ≥ 1.3:1 vs a rest row, and `--accent-ink` ≥ 4.5:1 on the fill — overlap at **exactly one**
integer step:

```
light   4–7 %   (8 % drops the label to 4.467)
dark    7–11 %  (6 % drops the fill  to 1.289)
                                     ── intersection: 7 % ──
```

**Change** — `src/components/CommandBar/CommandBar.css`

| Line | What |
|---|---|
| `201–215` | Comment recording the measurement and the two windows, so the number is re-derivable rather than folklore. |
| `216–220` | `.command-bar-item[data-selected='true']` — `background: color-mix(in oklab, var(--text-primary) 7%, var(--bg-tertiary))`, `color: var(--accent-ink)`, `box-shadow: var(--shadow-raised)`. **No** `border-left`/`border-right`. |
| `188–190` | `box-shadow` added to the existing colour transition — paint only, the row never reflows. |
| `227–236` | A disabled row now refuses the **selected** fill exactly as it already refused the hover fill. It is the only row that paints `--text-muted` directly on the fill (its `disabledReason` hint), which the deeper fill would push under AA — and it is never the thing Enter runs. |

**Pinning test** — `CommandBar.test.tsx:426` *raises the selected row over the measured inset fill
without a side stripe*: pins the literal `7%` (a "harmless" nudge either way breaks one of the two
constraints), asserts the fill is a real step off the hover fill, asserts `--shadow-raised` and
`--accent-ink`, asserts **no** `border-left|right`, and asserts the disabled-row carve-out.

**Measured live, from real painted pixels** (query `spea`, top row selected):

| | light | dark |
|---|---|---|
| selected row fill | `rgb(220,218,212)` | `rgb(54,52,46)` |
| rest row (panel) | `rgb(255,255,255)` | `rgb(32,31,25)` |
| **fill delta selected ↔ rest** | **1.398:1** ✅ (was 1.20) | **1.327:1** ✅ (was 1.12) |
| `--shadow-raised` present | `0 1px 2px …/.05, 0 2px 6px …/.06` ✅ | `0 1px 2px …/.3, 0 2px 8px …/.25` ✅ |
| side stripe | `border-left/right: 0px` ✅ | `0px` ✅ |
| selected label ink (`--accent-ink` on the fill) | **4.599:1** ✅ AA | **5.033:1** ✅ AA |
| selected mono type chip | 7.127:1 ✅ | 6.931:1 ✅ |
| rest label ink (unchanged) | 17.052:1 | 14.355:1 |

Keycaps and type chips are already forced onto `--bg-node` on a filled row, so the deeper fill does
not touch them — confirmed by the measurements above.

Screenshots: `p5b-06-selected-row--{light,dark}.png` (panel crop),
`p5b-05-palette-results--{light,dark}.png`.

---

## Item 4 — The search field's ring gated on keyboard focus, accent border kept on open

**Defect found in the inherited work.** codex set the keyboard-focus marker on **every** keydown in
the overlay, so the 3px ring lit on the first character typed — trading an always-on indicator for
one that pops on and then stays on, which is the same complaint one keystroke later.

**Change**

| File · line | What |
|---|---|
| `CommandBar.tsx:259–261` | The marker is set **only by Tab** — the only key that moves DOM focus inside the palette. A ring says "focus landed here by keyboard", not "someone is typing". |
| `CommandBar.tsx:243–245` | Reset to `false` on open / on returning to search (programmatic autofocus). |
| `CommandBar.tsx:464–466` | Reset to `false` on `pointerdown` — a mouse-driven focus is not a keyboard focus. |
| `CommandBar.css:124–128` | `:focus` → `outline: none`, `border-color: var(--accent-primary)`, `box-shadow: none`. The field still **reads as focused** on open. |
| `CommandBar.css:135–137` | `:focus-visible[data-keyboard-focus='true']` → `box-shadow: var(--focus-ring)`. |

**Pinning tests**
- `CommandBar.test.tsx:452` — the CSS contract (accent border with `box-shadow: none` on `:focus`;
  the ring only behind the marker).
- `CommandBar.test.tsx:465` *lights the search ring on a focus-moving Tab, never on typing* — the
  behaviour: `false` after autofocus, still `false` after `l`, `o`, ArrowDown, ArrowUp, and `true`
  after Shift+Tab.

**Measured live (both themes)**

| | light | dark |
|---|---|---|
| on open — focused | `true` | `true` |
| on open — border | `oklch(0.66 0.19 40)` = `--accent-primary` ✅ | `oklch(0.72 0.19 40)` = `--accent-primary` ✅ |
| on open — ring | `box-shadow: none` ✅ | `none` ✅ |
| after typing `spea` | `none` ✅ | `none` ✅ |
| after a focus-moving Shift+Tab | `oklab(0.66 … / 0.28) 0 0 0 3px` ✅ | `oklab(0.72 … / 0.35) 0 0 0 3px` ✅ |

(In search mode the field is the only focusable and forward Tab is the agent handoff, so the
focus-moving key that lands back on the field is Shift+Tab — it wraps onto itself.)

Screenshots: `p5b-04-input-open-no-ring--{light,dark}.png`,
`p5b-07-input-ring-after-tab--{light,dark}.png`.

---

## Notes for the orchestrator

- **Nothing outside the lane was touched.** `git status` for this lane covers only
  `Canvas/ContextMenu.{tsx,css}`, `Canvas/__tests__/ContextMenu.test.tsx`, `CommandBar/**`. No
  git add/commit/stash/checkout/reset was run.
- **The accent tokens leave almost no room.** Item 3's two constraints intersect at a single
  integer percent. If `--accent-ink`, `--bg-tertiary` or `--bg-node` move, re-run
  `probe2.mjs` — the pinned `7%` will need re-deriving, and the CSS comment says so.
- **Carried forward, unchanged (from W4-P5-REVIEW §7):** the Sonner toaster still overlaps the
  palette (`App.tsx`, another lane), and right-click on a *node* still opens nothing (W5-P10).
- **Still browser-tier only:** the desktop AI paths (populated model picker, `/resume`, streaming,
  YOLO sheet) remain unverifiable here. The AI-mode containment above was measured on the honest
  browser-tier panel; the desktop chat/auth views have their own autofocus, which the new effect
  explicitly does not override.

Dev server on 5213 stopped.
