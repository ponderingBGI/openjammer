# W4-P3c — KeyTile socket lane + TimeRuler / WaveformView should-fixes

Round: P3c, the fix round the W4-P3 gate ordered (`plans/redesign-new-dna/W4-P3-REVIEW.md`).
Owned: `packages/oj-ui/src/components/{KeyTile,TimeRuler,WaveformView}/**` only. Nothing in
`src/**` and nothing in the other lane's `Meter/`, `TransportPill/` was touched. No git write ran.

Evidence: `plans/redesign-new-dna/.scratch/w4-p3c/` — 14 screenshots, `p3c-results.json`,
`p3c.cjs` (the harness), `tests.log`, `tsc.log`, `eslint.log`, `figma.log`, `build.log`,
`ladle.log`. One Chromium, `deviceScaleFactor: 2`, Playwright under `node`, Ladle on **61009**
with the isolated vite config; Ladle stopped and the port verified free.

## Verdict

All of M1/M2/M3 and all four should-fixes are done and measured. **Zero label/socket overlap
anywhere**, in either theme, across every story and a forced 4-variant × {34,48,50,74} sweep.
Zero console errors. All five static gates green.

---

## Inherited state

The crashed codex run had landed the easy half: `justify-content: flex-end` was back on
`.oj-key-tile--key`, a `--oj-key-tile-socket-inset` variable existed, the two dead
`WaveformView.css` rules and the dead `.oj-key-tile--black:not(.is-active) …` rule were gone,
and `WaveformView.test.tsx` was in fact complete. What it had **not** done — and what P3c
actually is:

- there was **no reserved socket lane at all** (the tile still had `padding: 0 4px <inset>`),
  so M2/M3 were only avoided by arithmetic luck: the 34px pad cleared the well by 0.6px and a
  50×50 `key` with a hint still put the chip under the socket;
- the hit-chip "fix" made contrast **worse**, not better (`color-mix(--text-on-accent 36%)` on
  the accent face with `--text-on-accent` ink — `--text-on-accent` is the *dark* ink `#1D1C18`
  in **both** themes, so lightening the chip and keeping dark ink lowers the ratio);
- the piano faces were fixed but their **inks were not**: `.oj-key-tile--white` kept
  `color: color-mix(in oklab, var(--text-primary) 82%, black)`, which is near-black in light
  and **near-white in dark** — i.e. a light label on the (now correctly light) white face,
  ~1.1:1 in dark;
- the geometry test was a **false pin**: its model never included the hint chip, so the exact
  50×50 case M3 is about passed in jsdom while the browser overlapped;
- the pad's verified `padding-bottom: 5px` handoff value had silently become 2.4px.

---

## 1. M1 / M2 / M3 — the socket never overlaps the label

### The change

`packages/oj-ui/src/components/KeyTile/KeyTile.css` (rewritten; the geometry block is
lines 16–58):

| Line | Declaration | Why |
|---|---|---|
| `KeyTile.css:22` | `--port-size: clamp(12px, calc(var(--oj-key-tile-sizing-axis) * 0.375), 18px)` | the shared 18px well is kept **exactly** at the default 48px axis (48 × 0.375 = 18) and scales below it — a 34px vignette cannot spend 22 of its 34px on a socket |
| `KeyTile.css:23–27` | `--oj-key-tile-socket-inset: clamp(1px, axis * 0.05, 5px)` | size-relative corner inset (kept from the crashed run) |
| `KeyTile.css:28` | `--oj-key-tile-gap: clamp(2px, axis * 0.084, 4px)` | 4px at 48 |
| `KeyTile.css:31` | `--oj-key-tile-base: min(5px, calc(axis * 0.105))` | **restores the handoff's 5px pad baseline** at 48 (48 × 0.105 = 5.04 → 5), proportional below |
| `KeyTile.css:34–36` | `--oj-key-tile-socket-band: calc(inset + var(--port-size) + gap)` | the reserved lane |
| `KeyTile.css:43–44` | `padding: var(--oj-key-tile-socket-band) var(--oj-key-tile-socket-inset) var(--oj-key-tile-base)` | **the fix.** The band is spent as `padding-top`, so the label stack's content box *begins below the well* |
| `KeyTile.css:89–93` | `.oj-key-tile__port` stays `position: absolute` at `top/right: inset` | out of flow, inside its own band |
| `KeyTile.css:133–142` | `--key`: `justify-content: flex-end`, `gap: min(4px, axis*0.084)`, `padding-bottom: min(6px, axis*0.125)`, `font: 600 min(11px, axis*0.23)/1` | the handoff `.key` values at the default axis, size-relative below it |

**Why `padding`, not a flex rule.** The app's own `.keyboard-visual-key`
(`src/components/Nodes/SchematicNodes.css:1263`) sets `align-items: center; justify-content:
center` at the same specificity as `.oj-key-tile`. A layout that depends on the tile's own
`justify-content` can therefore be dissolved by the consumer — which is the real-world shape of
M3. Padding cannot be: whatever the consumer does to alignment, the content box still starts
below the socket. That is why the reservation is geometric rather than flexbox-y.

**The one budget limit, stated honestly:** a `key` at ≤50px tall that *also* carries a hint chip
(18px well + 13px chip + 11px label + insets ≈ 60px) does not fit and would push the stack up
into the band. The shipped consumer (`KeyboardVisualNode`, 50×50 and 300×50) passes **no hint**,
and the `Inline50` story is now consumer-faithful for exactly that reason. Nothing renders that
combination today.

### The pinning test

`packages/oj-ui/src/components/KeyTile/KeyTile.test.tsx:194` — *"reserves a size-relative socket
lane with the label anchored below it"*.

It is not a retyped model: every constant (`KeyTile.test.tsx:26–48`) is **parsed out of
`KeyTile.css` at run time** (`cssNumber()`, `KeyTile.test.tsx:19`), and the band is only applied
if the stylesheet actually spends its `padding-top` on it (`RESERVES_LANE`,
`KeyTile.test.tsx:53`; used at `:91`). It computes the port box and the bottom-anchored label
box (label modelled at the **full content width**, so only the vertical lanes can decide the
question) for eleven cases — pad 34/48/50/74, key 34×74+hint, key `size=`34/74, key 50×50, key
300×50 (spacebar), white 34×96, black 24×64 — and asserts (a) zero intersection and (b) the
stack top never rises into the band.

**Why it fails on the pre-fix code** — verified by reverting each declaration in turn:

| Regression re-introduced | Result |
|---|---|
| `padding: 0 4px …` (no reserved lane) | `AssertionError: the socket band is not what the tile spends its top padding on: expected false to be true` — the guard fires *before* the arithmetic, and it also switches the model's band to 0 so the intersection checks are never silently satisfied by a stale constant |
| `--port-size: 18px` (well not size-relative) | suite fails to load: `KeyTile.css no longer declares /--port-size:\s*clamp\(…/` |
| key `padding-bottom: 6px` fixed at `size=34` | `key size=34 (vignette): stack overflows into the socket band: expected 17.75 to be greater than or equal to 18.306` (this is how the key's legend was made size-relative) |

The `__port` `data-*` forwarding contract is untouched and still pinned at
`KeyTile.test.tsx:165`; `src/components/Nodes/__tests__/portDomContract.test.tsx` is unaffected
(no TSX change to `KeyTile.tsx` at all — this round is CSS + tests + one story).

### Measured rectangles (browser, `p3c-results.json`, both themes identical)

Story tiles — `label.top − port.bottom` = clearance, `portOverLabel: null` everywhere:

| Story / tile | tile | port (y) | label (y) | hint (y) | clearance |
|---|---|---|---|---|---|
| states — key `C4` + hint | 34×74 | 27.4–45.4 | 80–91 | 63–76 | **34.6** |
| states — key `D4` **hit** | 34×74 | 28.4–46.4 | 81–92 | 64–77 | **34.6** |
| states — pad `hit` | 48×48 | 54.4–72.4 | 83–93 | — | **10.6** |
| variants — pad `34` (vignette) | 34×34 | 88.7–**101.4** (12.7px well) | **105.4**–115.4 | — | **4.0** |
| variants — white `C` | 34×96 | 27.4–45.4 | 104–114 | — | 58.6 |
| variants — black `C#` | 24×64 | 59.4–77.4 | 104–114 | — | 26.6 |
| pad-grid — P1…P8 | 48×48 | 27.4–45.4 | 56–66 | — | **10.6** ×8 |
| inline50 — key `C4` (**M3**) | 50×50 | 27.4–45.4 | 56–67 | — | **10.6** |
| inline50 — key `SPACE` | 300×50 | 27.4–45.4 | 56–67 | — | **10.6** |
| piano-octave — white ×7 | 34×96 | 27.4–45.4 | 104–114 | — | 58.6 |

Forced sweep, every variant × every required size (`sweep--light` / `sweep--dark`, identical):

| size | pad | key | white | black |
|---|---|---|---|---|
| 34 | 4.0 | **5.5** | 4.0 | 4.0 |
| 48 | 10.6 | 8.6 | 10.6 | 10.6 |
| 50 | 12.5 | 10.5 | 12.5 | 12.5 |
| 74 | 35.3 | 33.3 | 35.3 | 35.3 |

All positive; `portOverLabel` null in all 32 rows; `labelInsideTile` true in all 32.
Compare the gate's numbers on the broken build: `key` 14.1 × 4 px overlap, `size=34`
12 × 6, `consumer50` 6.1 × 11 (label fully hidden).

Screenshots (light + dark each):
`keytile--states--{light,dark}.png`, `keytile--variants--{light,dark}.png`,
`keytile--pad-grid--{light,dark}.png`, `keytile--piano-octave--{light,dark}.png`,
`keytile--inline50--{light,dark}.png` — all in `plans/redesign-new-dna/.scratch/w4-p3c/`.

---

## 2. Should-fixes

### 2.1 Hit-state hint chip contrast (review #4)

`KeyTile.css:118–121` — the chip becomes an **inset legend** instead of a translucent wash:

```
.oj-key-tile.is-active .oj-key-tile__hint { background: var(--bg-node); color: var(--accent-ink); }
```

`--text-on-accent` is `#1D1C18` in **both** themes, so any on-accent-tinted chip fill moves the
background *toward the ink*. The library's own surface/ink pair does not have that problem, and
it reads as the keycap legend staying physical while the face lights up.

Measured (`p3c-results.json` → `keytile-hint-hit--*`):

| | before (gate) | after |
|---|---|---|
| light | **3.81:1** | **6.43:1** (`oklch(0.504 0.19 40)` on `rgb(255,255,255)`) |
| dark | 7.17:1 | **6.68:1** (`oklch(0.767 0.19 40)` on `rgb(32,31,25)`) |

Rest chip unchanged and still passing: 4.57 / 4.50. Hit **label** 5.08 / 6.27.
Pinned: `KeyTile.test.tsx:247` (asserts the `--bg-node` / `--accent-ink` pair *and* that
`--text-on-accent` is no longer the chip's colour).

### 2.2 TimeRuler bar labels inside the band (review #5)

`packages/oj-ui/src/components/TimeRuler/TimeRuler.css` — the bar label gets **its own line
above the tick** (the review's own recommendation) instead of sharing the 7px tick box:

- `TimeRuler.css:4–5` — `--oj-ruler-floor: 3px`, `--oj-ruler-bar-tick: 7px`
- `TimeRuler.css:39–44` — `.is-bar { bottom: calc(floor + tick); line-height: 1; padding-left: 3px }`
  (the fixed `height: 7px` is gone; the box is now the label's line box)
- `TimeRuler.css:46–50` — `.is-bar::before { top: 100%; bottom: auto; height: var(--oj-ruler-bar-tick) }`
  — the tick hangs off the bottom of that line, so the mark still ends 3px above the band floor.

Measured (`p3c-results.json` → `timeruler--*`, both themes identical), band `y 24–52`:

| | gate (before) | after |
|---|---|---|
| label line box | `y 40–53` → **1px below the band**, straddling the tick | `y 30.5–43.5`, glyph box `y 32.5–42` |
| tick | `y 42–49` (shared with the text) | `y 42–49`, entirely below the label |
| below band by | 1px | **0** |
| above band by | — | **0** |

Pinned: `TimeRuler.test.tsx:18`, which asserts the lifted `bottom`, the `top: 100%` tick, the
absence of the old `height: 7px`, and that floor + tick + a 9.5px line still fits the tightest
band the app ships (22px, `.arrangement-bars-row`).
Screenshots: `timeruler--bars--{light,dark}.png`.

### 2.3 Piano faces keep their meaning in dark (review #6)

`KeyTile.css:154–173` — one symmetric pair, defined once:

```
--oj-piano-white: color-mix(in oklab, var(--bg-node)    22%, white);
--oj-piano-black: color-mix(in oklab, var(--text-primary) 18%, black);
.oj-key-tile--white { background: var(--oj-piano-white); color: var(--oj-piano-black); }
.oj-key-tile--black { background: var(--oj-piano-black); color: var(--oj-piano-white); }
```

The ink of one face **is** the face of the other, which is how a real keyboard is printed, and
both are mixed toward literal white/black (with a whisper of the theme's surface so they still
belong to the canvas) rather than toward tokens that trade places between themes.

Measured (`p3c-results.json` → `piano--*`):

| | white face luminance | black face luminance | white lighter? | label contrast |
|---|---|---|---|---|
| light | 1.0000 | 0.0000 | **true** | 21.0 / 21.0 |
| dark | 0.5767 | 0.0052 | **true** | **11.36 / 11.36** |

Before, dark inverted the *faces* per the gate, and the crashed run's half-fix left the white
key's **ink** deriving from `--text-primary` — light ink on a light face in dark. Both are gone.
Pinned: `KeyTile.test.tsx:259`, including a negative assertion that neither piano rule derives
its `color` from `--text-primary` any more. Visible in `keytile--variants--dark.png`.

### 2.4 Dead CSS (review #7)

Already removed by the crashed run and verified still absent — `grep -c "aria-disabled|focus-visible"
WaveformView.css` = **0**, and `.oj-key-tile--black:not(.is-active) .oj-key-tile__label` is gone.
Pinned at `WaveformView.test.tsx:19` and `KeyTile.test.tsx:280`. Screenshots:
`waveformview--states--{light,dark}.png` (card unchanged: `10px` radius, raised).

---

## 3. Story change (the only non-CSS/test edit)

`KeyTile.stories.tsx:54–65` — `Inline50` now renders exactly what `KeyboardVisualNode` renders:
a 50×50 `key`, a 50×50 `key` in the hit state, and the 300×50 spacebar, **with no hint chip**
(the consumer passes none). It previously carried a hint, which is the one shape that does not
fit a 50px key and would have made the story unrepresentative of the defect M3 is about.

## 4. Gates

| Gate | Result |
|---|---|
| `bun run test:run -- packages/oj-ui` | **PASS** — 43 files, **358 tests** (was 353; +5 from this round's pins) |
| `bunx tsc --noEmit -p tsconfig.app.json` | **PASS** (exit 0, no output) |
| `bunx eslint packages` | **PASS** (exit 0, no output) |
| `bunx figma connect parse` | **PASS** (exit 0) |
| `bun run build` | **PASS** (exit 0) |
| Console errors / page errors in the browser harness | **0** across all 14 captures, both themes |
| Fonts | `600 14px Outfit` ✓, `600 10px JetBrains Mono` ✓ (both themes) |

## 5. Not verified here

- No audio was played; nothing in this round touches an audio path.
- The **live app** was not driven: `KeyboardVisualNode`'s 30 keys were verified through the
  consumer-faithful Ladle story (50×50 / 300×50, no hint), not through the running canvas, so
  the interaction between `.keyboard-visual-key` and the tile's own alignment is argued from the
  CSS (the reservation is padding-based and therefore immune) rather than measured in the app.
  Worth one look on the canvas when the shell lane lands.
- No assistive-technology speech test.
