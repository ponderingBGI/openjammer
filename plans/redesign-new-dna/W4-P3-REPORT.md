# Wave 4 P3 — Canvas & Media report

Date: 2026-08-29  
Scope: `oj-ui` KeyTile, Waveform, WaveformView, WaveformCanvas, Marquee, OffscreenPointer, TimeRuler, LaneButton, DeviceSelect, EditableLabel, plus the P2 ListRow/StatusDot repairs.  
Result: **complete; all requested static gates pass and the two-theme visual run has zero browser console errors.**

## Component results

| Component | Change | API additions | Tests | Visual evidence |
|---|---|---|---:|---|
| ListRow | Current dot moved to `--accent-ink`; row radius is exactly 8px. | None. | 8 | `.scratch/w4-p3/primitives--listrow--{states,with-actions}--{light,dark}.png` |
| StatusDot | `ok`/`warn` use `--success-ink`/`--warning-ink`; all five fills clear 3:1 in both themes. | None. | 6 | `.scratch/w4-p3/primitives--statusdot--statuses--{light,dark}.png` |
| KeyTile | New DNA 48px pad, compact 34px vignette, 34×74 key, retained piano faces, bottom mono label, inset hint, spring lift/press, solid accent hit, pressed shadow, no glow, and connected Port core. Canvas data attributes remain on `__port`; pointer handlers remain on the tile. | `hint?: ReactNode`; `size?: number`. | 9 | Four stories per theme plus `key-tile--{hover,pointer-active,hit,disabled}--{light,dark}.png` |
| LaneButton | 24×24 inset pill; pressed surface/raised shadow; semantic mute/solo/armed/recording glyph treatments; 1200ms recording pulse; reduced-motion danger ring. Focus is one pseudo-element ring and does not erase state shadows. | None. | 3 | `lane-button--state-matrix--{light,dark}.png` |
| TimeRuler | Micro uppercase mono labels; bar/beat/sub timeline tokens; crisp 1px pseudo-element ticks aligned at 0.5px without blurring labels. | Exported `TimeRulerProps` type from `index.ts`. | 2 | `time-ruler--bars--{light,dark}.png` |
| Waveform | Audio-connection trace, 1.5px accent playhead, subtle centre line, danger recording trace/pulse, static full-opacity danger trace under reduced motion. | None. | 11 | Three stories per theme: `.scratch/w4-p3/composites--waveform--*--{light,dark}.png` |
| WaveformView | Surface card with hairline/radius/raised shadow; Outfit name and mono duration; inset selected/drop edges; 96% drag compression/overlay shadow; explicit Chip-like “Cropped” badge. | None. | 7 | `.scratch/w4-p3/composites--waveformview--{states,single}--{light,dark}.png` |
| WaveformCanvas | Kept unchanged as requested; existing peak and missing-data rendering retained. | None. | Existing coverage; no lane edit. | `.scratch/w4-p3/waveform-canvas--{peaks,missing}--{light,dark}.png` |
| Marquee | Neutral proposal treatment: 1px dashed `--border-strong` and 6% `--text-primary` wash; no accent and no pointer interception. | None. | 6 | `.scratch/w4-p3/primitives--marquee--{default,sizes}--{light,dark}.png` |
| OffscreenPointer | Surface pill, subtle edge, overlay shadow, Outfit 600/12, value-only arrow rotation, spring hover/press, focus and disabled states. | None. | 7 | `.scratch/w4-p3/primitives--offscreenpointer--directions--{light,dark}.png` |
| DeviceSelect | Input-physics trigger, Menu panel, ListRow-like options, visible bolt + “low latency” text, disabled state, select-only combobox semantics, active descendant, arrows/Home/End/Enter/Space/Escape and 500ms prefix typeahead. Active state is tracked by stable ID and reconciles controlled value/reorder/removal changes. | `disabled?: boolean`. | 12 | Five stories per theme plus `device-select--keyboard--{light,dark}.png` |
| EditableLabel | Outfit 500 display and matching Input overlay; Enter/blur commit, Escape revert without a follow-on blur commit; same mounted box metrics; mono and disabled variants. | `mono?: boolean`; `disabled?: boolean`. | 14 | Six stories per theme plus `editable-label--edit--{light,dark}.png` |

Every owned Code Connect example now supplies required props and parses. Stories cover rest, state, disabled and relevant interactive variants. No existing prop was removed.

## Measured visual proof

The machine-readable manifest is [`visual-results.json`](.scratch/w4-p3/visual-results.json). It records 60 complete story screenshots plus 12 dedicated interaction screenshots, one Chromium, both themes, `document.fonts.check('600 14px Outfit') === true`, and zero console errors.

| Measurement | Light | Dark |
|---|---:|---:|
| KeyTile label, idle | 5.49:1 | 5.05:1 |
| KeyTile label, hit | 5.08:1 | 6.27:1 |
| LaneButton mute | 6.14:1 | 8.12:1 |
| LaneButton solo | 6.43:1 | 6.68:1 |
| LaneButton armed | 6.72:1 | 6.39:1 |
| LaneButton recording | 3.58:1 | 4.95:1 |
| StatusDot ok | 5.76:1 | 7.52:1 |
| StatusDot warn | 5.54:1 | 8.99:1 |
| StatusDot bad | 4.30:1 | 5.31:1 |
| StatusDot idle | 4.95:1 | 5.59:1 |
| StatusDot info | 3.27:1 | 7.19:1 |
| ListRow current dot | 5.34:1 | 5.96:1 |

EditableLabel display→edit delta was `0×0px` in both themes. Reduced-motion inspection reported LaneButton `animation-name: none` with a 2px danger ring and Waveform `animation-name: none`, opacity `1`, danger stroke. DeviceSelect keyboard inspection reached “RØDE NT-USB”; Enter and Escape both closed it in light and dark.

The KeyTile pad/state captures were visually compared against the handoff “Pads & keys” row. The face, label anchoring, lift, compression, solid hit and lack of glow match the chosen default hit variant. The alternative vB/vC/vD hit treatments were not shipped. The WaveformView crop glyph initially read ambiguously and was replaced with the explicit “Cropped” badge before the final capture run.

## Verification

| Gate | Final result |
|---|---|
| `bun run test:run -- packages/oj-ui` | PASS — 43 files, 353 tests |
| `bunx tsc --noEmit -p tsconfig.app.json` | PASS |
| `bunx eslint packages` | PASS — zero output |
| `bun run build` | PASS — TypeScript project build, Vite and PWA output |
| `bunx figma connect parse` | PASS |
| Ladle / node Playwright | PASS — 72 PNGs, one Chromium, both themes, zero console errors |

Ladle used the required isolated command on port 61006 and was stopped afterward; the port was verified free. Playwright ran under `node`, never Bun.

## Adversarial review

The repo-mandated independent `gpt-5.6-sol` read-only review found no P0. Two P1 DeviceSelect findings were reproduced and fixed:

1. `aria-activedescendant` was invalid on the un-roled native button. The trigger is now a select-only `role="combobox"`; a test pins it.
2. Index state could stale across controlled `value/items` changes. Active state now uses a stable item ID plus a value/item context; rerender tests cover value change, reorder/removal and Enter selection.

Its P2 Marquee finding was rejected after source triage: it followed audit row 17’s older accent treatment, while this lane’s explicit work order supersedes that row with D19’s neutral “proposal” treatment. The implementation and tests intentionally pin the work order.

The Impeccable design hook’s literal-radius findings were also triaged, not ignored: DeviceSelect’s 12px menu and 8px option radii intentionally match the committed Menu/ListRow handoff physics; KeyTile’s 4px hint radius matches the provided app-styles keycap. They are fixed geometry, not colors or retired tokens.

## Deviations and boundaries

- Marquee intentionally follows the explicit D19 lane instruction rather than audit row 17: neutral 1px/6%, not accent 1.5px/10%.
- `StatusDot` uses ink variants in both themes. In dark, those values already meet or closely preserve the base semantic hues and measure 7.52:1/8.99:1.
- DeviceSelect’s popup remains absolutely positioned to preserve the existing DOM/API. A consumer with a clipping overflow ancestor may need a later portal integration; no such owned consumer change was authorized in this lane.

## UNVERIFIED

- No human NVDA/JAWS/VoiceOver session was performed; the semantic combobox structure and keyboard state were tested, but real assistive-technology speech remains unverified.
- No real microphone/speaker enumeration or device switch was performed; DeviceSelect is a controlled presentation primitive.
- No full-app physical keyboard integration was exercised because app consumers are owned by concurrent lanes.
- Audio was not played. Audible clicks/dropouts, MIDI→audio latency and performer feel cannot be claimed from this component-library lane and require the founder/listening pass mandated for Wave 6.
- No PR was opened or merged. No git add/commit/stash/checkout/reset operation was performed.
