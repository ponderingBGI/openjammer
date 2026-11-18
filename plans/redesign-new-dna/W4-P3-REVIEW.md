# W4-P3 gate review — Canvas & Media (oj-ui)

Reviewer: independent design-quality gate (read-only; no file in `packages/` or `src/` was edited, no git write ran).
Date: 2026-08-29.
Scope: uncommitted changes in `packages/oj-ui/src/components/{KeyTile,Waveform,WaveformView,Marquee,OffscreenPointer,TimeRuler,LaneButton,DeviceSelect,EditableLabel,ListRow,StatusDot}/**` + `packages/oj-ui/src/index.ts`. `src/**` and the untracked `Meter/`,`TransportPill/` (lane S4) were ignored.
Evidence: `plans/redesign-new-dna/.scratch/w4-p3-gate/` — 70 own screenshots, `gate-results.json`, `gate2-results.json`, `gate3-results.json`, `gate4-timeruler.json`, `tests.log`, `tsc.log`, `eslint.log`, `figma.log`, `build.log`. One Chromium, Ladle 61007 with the isolated vite config, Playwright under `node`, Ladle stopped and the port verified free.

## Verdict

**DO-NOT-COMMIT** — one blocking legibility defect (M1) plus two directly-related geometry defects (M2, M3) that a performer sees on the canvas. Everything else in the lane is genuinely good and, once M1–M3 land, this is a commit.

The defects are narrow: they are all the same missing declaration and its knock-on. The rest of the lane (LaneButton, DeviceSelect, WaveformView, Waveform, Marquee, OffscreenPointer, EditableLabel, ListRow, StatusDot) verified clean against the handoff in both themes.

---

## 1. Fidelity, value by value

### KeyTile — **FAIL** (pad correct, `key` and vignette broken)

Pad face, measured live (`gate-results.json` → `pad-computed--{light,dark}`):

| Handoff `.nj-pad` | Measured | |
|---|---|---|
| 48×48 | `48 × 48` | ✓ |
| `--r-md` 10px | `10px` | ✓ |
| surface | `--bg-node` (`#FFF` / `#21201A`) | ✓ |
| 1px `--line2` | `1px solid var(--border-control)` | ✓ |
| `sh1` | `--shadow-raised` | ✓ |
| bottom `600 10px` mono, `padding-bottom:5px` | `600 10px/10px JetBrains Mono`, `padding-bottom: 5px`, `align-items: flex-end` | ✓ |
| hover `translateY(-2px)` spring | `matrix(1,0,0,1,0,-2)` on `--motion-spring` | ✓ |
| active `scale(.94)` | `matrix(0.94,…)` | ✓ |
| hit = solid accent + on-accent + `translateY(1px)` + `inset 0 2px 6px rgba(0,0,0,.28)` | `--accent-primary` / `--text-on-accent` / `translateY(1px)` / `--shadow-pressed` (which *is* that exact inset) | ✓ |
| no glow | no `filter`/`drop-shadow` anywhere; pinned by test | ✓ |

`__port` forwards `data-node-id` / `data-port-id` / `data-port-type` — verified in `KeyTile.test.tsx` and against the app-wide contract in `src/components/Nodes/__tests__/portDomContract.test.tsx` (which accepts "marker is, or wraps, an `.oj-port`"). ✓

**Deviations — not justified:**

- **M1 — the `key` variant's socket sits on top of the note name.** The handoff `.key` (app-styles.css:61) is `flex-direction:column; align-items:center; justify-content:flex-end; gap:4px; padding-bottom:6px`. The implementation ported every one of those **except `justify-content:flex-end`**, so the base rule's `justify-content:center` survives and the label+hint stack floats to the vertical middle — straight into the 18px port well pinned at `top:5px; right:5px`.
  Measured (both themes, `gate-results.json` → `overlap`): tile `34×74`, port `y 30–48`, label `y 44–55` → **`portOverLabel: 14.1 × 4 px`**. Visually the top third of "C4"/"D4"/"E4" is under the socket. Confirmed in my own `composites--keytile--states--{light,dark}.png` and in the lane's own `.scratch/w4-p3/composites--keytile--states--light.png`.
  This is the crash-resume fingerprint: one declaration from the handoff line was dropped mid-edit.
- **M2 — the 34px vignette is smaller than its own socket + label.** `<KeyTile variant="pad" size={34}>`: port `y 92–110`, label `y 104–114` → **overlap `12 × 6 px`** (`gate2-results.json` → `vignette34`). Over half the glyph height is under the well. 48px works because the well ends at 23 and the label starts at 32; 34px has no such room. The `size` prop ships a geometry it cannot satisfy.
- **M3 — the live `KeyboardVisualNode` regresses.** `src/components/Nodes/KeyboardVisualNode.tsx` renders `variant="key"` with an inline `style={{width:50,height:50}}`. Under the new column+centre layout the label lands **entirely** under the socket: measured overlap `6.1 × 11 px` on a label that is 11px tall (`gate2-results.json` → `consumer50`). At HEAD the same tile overlapped by ~3px; this lane roughly quadruples it and hides the letter. That is 30 keys on the Keyboard node whose letters a performer can no longer read.

**Fix for all three (one change):** add `justify-content: flex-end` to `.oj-key-tile--key` (the handoff's own value) so label+hint anchor at the bottom, clear of the well; and give the pad/key a reserved socket lane so the label can never sit under it at any `size` — e.g. `.oj-key-tile { padding-top: calc(var(--port-size) + 8px) }` on the variants that host a port, or scope a smaller `--port-size` below ~44px. Keep the `__port` `data-*` forwarding and the tile-level pointer handlers exactly as they are; this is a layout-only fix.

**Deviations — justified / accepted:**

- `key` radius is `--radius-md` (10px) where the handoff `.key` is 8px; token over literal, consistent with the rest of the library. Accepted.
- `key` carries `--shadow-raised` at rest where the handoff `.key` has none. Accepted — it matches the pad family.
- Piano faces: `white` = `--bg-node`, `black` = `--text-primary` with a `--bg-node` label. This is literally what the work order asked for and it is correct in light (17.05:1 / 5.49:1 labels). **In dark it inverts** — the white key renders dark and the black key renders near-white (see `composites--keytile--variants--dark.png`). Contrast still passes (14.23:1 / 4.99:1) so it is not an a11y failure, but a pianist reading an inverted keyboard is a real pause. A piano face is a physical object and should not theme-swap; it wants a fixed `--piano-white` / `--piano-black` pair. **Not a blocker** (the work order prescribed the tokens) — logged as a should-fix for whoever owns the token set.
- `key`-variant hint chip on the hit state measures **3.81:1** in light (`keytile-hint-hit--light`) — below 4.5:1 for a 9px letter. Dark is 7.17:1. Should-fix; the `color-mix(--text-primary 18%)` chip fill on accent is too light.

### LaneButton — **PASS**

24×24 pill (measured `24×24` ×7), `--radius-pill`, `--bg-tertiary` inset at rest. Pressed = `--bg-node` + `--shadow-raised` + tone ink: mute `--warning-ink` + `line-through`, solo `--accent-ink`, armed `--danger-ink` + `inset 0 0 0 1.5px`, recording = `--accent-danger` fill + `oj-lane-recording` `1.2s` (measured `animationName: oj-lane-recording`, `1.2s`). Reduced-motion emulation: `animation-name: none` + `0 0 0 2px var(--danger-ink)` in **both** themes. All seven states visually distinct (`lane-button--state-matrix--{light,dark}.png`).

Accessible names unchanged — `LaneButton.tsx` is untouched, only CSS + stories; the new test pins `getByRole('button', { name: 'Mute drums', pressed: true })`. The e2e J2 title/label selectors are safe. The extra `.is-recording[aria-pressed="true"]` selector is correct and necessary: `TrackLaneView.tsx:76` sets `className="… is-recording"` with no `tone`.

Contrast: mute 6.14/8.03, solo 6.43/6.60, armed 6.72/6.28, default-off 4.57/4.50. Recording glyph is **3.58:1 light** — below 4.5:1 as text, but the glyph is a "●" whose meaning is carried by the accessible name and the fill, so the 3:1 non-text floor applies. Accepted, noted.

Minor observation (systemic, not this lane): in dark, `--bg-node` is *darker* than `--bg-tertiary`, so "pressed = raised" reads slightly recessed. Same relationship as the committed SegmentedControl. Not a finding against P3.

### TimeRuler — **PASS with a should-fix**

Micro labels: `--text-micro` (9.5px) mono 600, uppercase, `letter-spacing: 0.76px` (= `--tracking-micro`), `--text-muted` (5.49 / 5.05). Ticks are crisp 1px `::before` pseudo-elements at `left: 0.5px` with `--timeline-grid-{bar,beat,sub}` — no more blurred `border-left` under the text. `TimeRulerProps` exported.

Should-fix: the bar label overflows its own 7px mark box and the ruler band. Measured (`gate4-timeruler.json`): band `y 24–52`, mark `y 42–49`, **text line `y 40–53` → 1px below the band, and the line box straddles the tick**. `timeruler-zoom.png` shows the bar numbers hanging off the bottom of the lane. Structurally inherited from HEAD (which was worse, at 14px), so not a regression — but the timeline lane is being rebuilt right now and this should be corrected while it is cheap: give the label its own line above the tick rather than sharing the 7px tick box.

### Waveform — **PASS**

Trace `--audio-connection`, playhead `--accent-primary` at `stroke-width: 1.5`, centre `--border-subtle`, recording trace `--accent-danger` with a 1.2s opacity pulse. Reduced-motion emulated: `animation-name: none`, `opacity: 1`, danger stroke retained — the meaning survives the motion removal, in both themes (`rm-waveform--{light,dark}.png`).

### WaveformView — **PASS**

Surface card, 1px `--border-subtle`, `--radius-md`, `--shadow-raised`; name Outfit 500 (7.13 / 6.93), duration mono `--text-muted`. Selected = `outline: 1.5px solid var(--accent-primary); outline-offset: -1.5px` (inset — zero box change), drop-target = the same dashed, dragging = `scale(0.96)` + `--shadow-overlay`, cropped = an inset Chip-like pill reading **"Cropped"** (5.11 / 7.25). All five states read distinctly side by side (`composites--waveformview--states--{light,dark}.png`). Replacing the `⟩⟨` glyph with a word was the right call.

Hygiene note below (dead `aria-disabled` / `:focus-visible` rules).

### Marquee — **PASS** (D19 honoured)

`1px dashed var(--border-strong)` + `color-mix(in oklab, var(--text-primary) 6%, transparent)`, `pointer-events: none` — measured live. No `--accent-primary` anywhere; the test pins its absence. The lane correctly followed the explicit D19 work order over audit row 17's older accent treatment; I agree with that call and with the report's rejection of the codex P2.

### OffscreenPointer — **PASS**

Surface pill, `--radius-pill`, 1px `--border-subtle`, `--shadow-overlay`, Outfit 600/12 (17.05 / 14.19). Arrow rotates purely from `--oj-pointer-rotation` (a value, no animation — pinned by test). Hover `translateY(var(--hover-lift))`, press `scale(--press-scale-btn)`, one focus ring, disabled state added.

### DeviceSelect — **PASS**

Trigger = committed Input physics (surface, 1px `--border-strong`, `--radius-md`, accent border + `--focus-ring` on focus/open). Panel = Menu physics (12px radius, 6px padding, `--shadow-overlay`, `z-index: 1000`). Options = ListRow physics (8px radius, `--bg-tertiary` on hover/active). Low-latency = bolt **plus** the words "low latency" in `--accent-ink` — never colour alone. ✓

Combobox semantics, verified live in both themes (`gate3-results.json`):

- `role="combobox"` + `aria-haspopup="listbox"` + `aria-expanded` + `aria-controls` on a select-only button — the APG select-only pattern. The earlier `aria-activedescendant`-on-a-roleless-button P1 is genuinely fixed.
- `aria-activedescendant` **resolves to a real element** (`exists: true`) and only exists while open.
- Keyboard: ArrowDown from closed **opens** (`ds-arrow-opens: true`), Arrow moves, Home/End move (unit test), typeahead `r` → "RØDE NT-USB", Escape closes, Enter selects and the trigger updates to "RØDE NT-USB". All in both themes.
- `disabled` blocks the click and the key handler; the trigger is natively `disabled`.
- Controlled `value`/`items` reconciliation is by stable item id, with rerender tests for value change, reorder and removal. The staleness P1 is genuinely fixed.

Contrast: option 17.05 / 14.23, selected option 5.34 / 5.96, latency mark 6.43 / 6.68, trigger 17.05 / 14.36.

Popup clipping: the panel is `position: absolute` inside `.oj-device-select`. No clipping ancestor in the stories (`clipper: null`). The risk the report flags is real but latent — there is no owned app consumer today (`grep '<DeviceSelect' src/` → none), so nothing is broken. Accepted as a documented future portal item.

Minor: pressing Space while closed both starts a typeahead buffer and fires the native click. Harmless (the buffer clears in 500ms and no label starts with a space) — not worth a change.

### EditableLabel — **PASS**

Display = Outfit 500, `--radius-md`, same `9px 12px` box as Input; edit renders the committed `Input` absolutely over the same box. **Measured delta display→edit = `0 × 0 px` in both themes**, and input-vs-text = `0 × 0`. Commit/revert verified by driving the real browser (`gate3-results.json` → `editable-flow`): Escape → "Reverb Bus" (reverted, and the `suppressNextBlur` ref correctly stops the follow-on blur from re-committing), Enter → "Renamed", blur → "Blurred". Both themes. `mono` and `disabled` added; no prop removed. Text contrast 14.17 / 12.81.

The resting box grew (`4px 8px` → `9px 12px`). **No consumer is affected** — there is no `<EditableLabel` in `src/` or elsewhere in `packages/` (only PortRow's story). Safe.

### ListRow / StatusDot (P2 follow-ups) — **PASS**

- ListRow radius: measured `8px` in both themes ✓ (matches the menu row).
- ListRow current dot → `--accent-ink`: **5.79 light / 7.39 dark** (measured on the `::before` pseudo against its composited ground) — well clear of 3:1 ✓.
- StatusDot fills, all five, both themes: ok 5.76/7.52, warn 5.54/8.99, bad 4.30/5.31, idle 4.95/5.59, info 3.27/7.19. **All ≥ 3:1** ✓ (info light at 3.27 is the tightest and it passes).

---

## 2. Crash-resume hygiene

The lane is mostly clean. One half-applied edit, and it is the cause of M1.

| Check | Result |
|---|---|
| Half-applied edit | **FOUND — 1.** `.oj-key-tile--key` ports 4 of the 5 layout declarations from the handoff `.key` and silently drops `justify-content: flex-end`. This is M1/M2/M3. |
| Duplicated rules | None. The five "duplicate selectors" the sweep reports (`.oj-key-tile.is-active`, `.oj-waveform-view.is-selected`, `.oj-device-select.is-open`, `.oj-editable-label--center`, `.oj-editable-label.is-disabled`) are all base-rule + descendant/state pairs, i.e. intentional. |
| Orphaned classes | None — every `oj-*__*` class in every owned stylesheet is emitted by its component. |
| Stories referencing removed props | None. `bunx tsc` clean; no prop was removed anywhere in the lane. |
| Dead CSS | **Two minor.** `WaveformView.css` adds `.oj-waveform-view[aria-disabled='true']`, `:hover:not([aria-disabled='true'])` and `:focus-visible`, but `WaveformView.tsx` renders a plain `<div>` with no `tabIndex` and never sets `aria-disabled` — both are unreachable unless a consumer opts in, and there is no consumer. Against code-value #8. Also `.oj-key-tile--black:not(.is-active) .oj-key-tile__label { color: var(--bg-node) }` restates the parent's own `color`. |
| `DeviceSelect.tsx` coherence | **Coherent.** Read end to end: single `useState` for active item keyed on a stable `context + id` string, one `useId`-derived list id, one keydown handler, typeahead timer cleaned up on unmount. No fragments of the deleted version survive. Its 12 tests exercise real behaviour, not shape. |

## 3. Product bar — both themes, own screenshots

- **Screenshots:** 70 PNGs in `.scratch/w4-p3-gate/`, one Chromium, `deviceScaleFactor: 2`, every owned story × light + dark, plus hover/press/focus, DeviceSelect keyboard, EditableLabel edit, and reduced-motion.
- **Console:** **zero** errors and zero page errors across all three harness runs.
- **Fonts:** `document.fonts.check('600 14px Outfit') === true`, `'600 10px JetBrains Mono' === true`.
- **Every state distinct:** verified visually per component (LaneButton 7-up matrix, WaveformView 5-up, KeyTile states, DeviceSelect open/closed/placeholder/disabled).
- **Contrast:** every measurement listed above. All text ≥ 4.5:1 except the two called out (KeyTile hit hint 3.81 light; LaneButton recording glyph 3.58 light, accepted as non-text). All fills ≥ 3:1.
- **One focus ring:** measured on the focused element in both themes — KeyTile pad, KeyTile hit, OffscreenPointer, DeviceSelect trigger and EditableLabel text all render the identical `0 0 0 3px color-mix(--accent-primary 28%)` ring with `outline: none`, composed additively with each component's own resting shadow (`--shadow-raised` / `--shadow-pressed` / `--shadow-overlay` are preserved, not erased). LaneButton puts the same ring on a `::after` pseudo so the tone shadow survives. ✓
- **No layout shift:** KeyTile hover is `transform: matrix(1,0,0,1,0,-2)` and press is `matrix(0.94,…)`; the neighbouring pad's box is byte-identical before and after hover (`reflow: false`, both themes). ✓
- **Motion tokens only:** transforms on `--motion-spring`, colour/shadow on `--motion-fast`, everywhere in the owned CSS.
- **Reduced motion (emulated, `reducedMotion: 'reduce'`):** LaneButton recording → `animation-name: none` + `0 0 0 2px var(--danger-ink)`; Waveform recording → `animation-name: none`, `opacity: 1`, danger stroke. Both themes. The meaning survives. ✓

## 4. Consumer safety

- `bunx tsc --noEmit -p tsconfig.app.json` — **PASS**, exit 0, no output. No interference from the concurrent lanes.
- `<LaneButton>` consumers (`MixerDrawer.tsx`, `TrackLaneView.tsx`): component TSX untouched, `aria-label`/`title` unchanged, `.is-recording` className path explicitly supported. E2E J2 selectors safe. ✓
- `<TimeRuler>` consumer (`RulerStack.tsx:129`): props unchanged, additive type export only. ✓
- `<StatusDot>` / `<ListRow>` consumers (6 + 4 call sites): colour-only changes. ✓
- `<KeyTile>` consumer (`KeyboardVisualNode.tsx`, 2 call sites, 30+ tiles): **M3 above.** The inline `50×50` override survives (component style is spread after the size var, so the consumer wins) and `portDomContract.test.tsx` still passes because the marker now *is* the `.oj-port`. But the cable's landing point moves from the 50px tile centre to the 18px socket at the tile's top-right — arguably more correct, worth a look in the app — and the label is now hidden under that socket. **MIDIVisual / MiniLab3Visual do not use KeyTile** (bare divs, per the migration list), so they are unaffected.
- `<EditableLabel>` / `<DeviceSelect>` / `<OffscreenPointer>` / `<WaveformView>` / `<Marquee>`: **no app consumers**. The padding growth and the popup-positioning risk hit nothing today.

## 5. Gates

| Gate | Result |
|---|---|
| `bun run test:run -- packages/oj-ui` | **PASS** — 43 files, **353 tests**, matching the claim. |
| Non-vacuous? | **Yes.** The new CSS-text assertions are narrow and would fail on the exact regression they name (`scale(var(--press-scale-pad))`, `is-active` → accent + `--shadow-pressed`, `not.toMatch(glow)`, `--accent-ink` on the current dot, `prefers-reduced-motion → animation: none` + `2px var(--danger-ink)`). The behavioural tests are stronger still: KeyTile now asserts the `data-*` moved off the button *and* onto the port, LaneButton pins the accessible name + pressed state + click, DeviceSelect drives real keydowns and rerenders. |
| `bunx tsc --noEmit -p tsconfig.app.json` | **PASS** (exit 0) |
| `bunx eslint packages` | **PASS** (exit 0, zero output) |
| `bunx figma connect parse` | **PASS** (exit 0) |
| `bun run build` | **PASS** (exit 0) |

## 6. Taste — against the handoff "Pads & keys" row

- **Pad face depth:** right. `--shadow-raised` + the 1px `--border-control` reads as a physical pad on both canvases, and the hit's `inset 0 2px 6px` genuinely reads as *pressed in* rather than *highlighted*. This is the single best thing in the lane.
- **Label anchoring:** correct on the pad (bottom, 5px, mono, muted — exactly `.nj-pad`). Wrong on the `key` — see M1. A key's label should sit at the bottom like a real keycap; centring it made it collide with the socket and also loses the keycap read.
- **Hit weight:** correct. Solid accent, on-accent label, 1px down, no glow. The vB/vC/vD alternates were correctly not shipped.
- **Hover lift:** −2px on the spring is the right amount — present but not springy enough to feel like a toy, and measurably reflow-free.
- **Key hint chip:** the right idea and the right values (`500 9px` mono, inset, 4px radius). Its hit-state variant is 0.7 points short of AA in light.
- **What a drummer would pause at:** (1) the socket sitting on the note name on the tall keys — that is the pause, and it is the whole point of the tile; (2) at 34px the socket eats the pad; (3) in dark, the piano's white key is black and the black key is white. Nothing else in the lane would slow anyone down.

---

## Ranked must-fix

1. **M1 — `.oj-key-tile--key` is missing `justify-content: flex-end`.** Add it (the handoff `.key` value). Measured `14.1 × 4 px` of the 18px port well sitting over the note label, both themes.
2. **M3 — `KeyboardVisualNode`'s 50×50 `key` tiles hide their letter entirely** (`6.1 × 11 px` overlap on an 11px label) as a consequence of M1. Fixed by M1, but re-measure at 50×50 to confirm, since the app overrides the height.
3. **M2 — `size={34}` puts the label under the socket** (`12 × 6 px`). Reserve a socket lane on the pad (`padding-top: calc(var(--port-size) + 8px)`) or scope a smaller `--port-size` below ~44px, so no `size` value can produce a collision.

## Should-fix (not blocking)

4. KeyTile hit-state hint chip: **3.81:1** in light (9px text). Darken the chip fill or use a stronger label colour.
5. TimeRuler bar labels overflow the ruler band by 1px and share the 7px tick box; give the label its own line above the tick.
6. Piano faces invert in dark (`white` → dark, `black` → near-white). Wants a fixed `--piano-white` / `--piano-black` token pair rather than `--bg-node` / `--text-primary`.
7. Dead CSS: `WaveformView`'s `[aria-disabled='true']` / `:focus-visible` rules are unreachable (plain `div`, no `tabIndex`, never sets the attribute); `.oj-key-tile--black:not(.is-active) .oj-key-tile__label` restates its parent's `color`.

## Confirmed accurate in W4-P3-REPORT.md

Test count (353/43), all five static gates, zero console errors, the `0×0` EditableLabel delta, the reduced-motion statics, the DeviceSelect keyboard walk to "RØDE NT-USB", the D19 Marquee call, and every contrast figure I could re-derive (my numbers land within 0.1 of the report's on 11 of 12 shared measurements). The report's two claimed DeviceSelect P1 fixes are real and verified.

## Not verified here

Audio was not played; no assistive-technology speech test; no real device enumeration. Those remain correctly listed as UNVERIFIED in the lane report.
