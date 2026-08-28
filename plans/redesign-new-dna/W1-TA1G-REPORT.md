# W1 TA1g — stable clip gesture previews

Date: 2026-08-28

## Result

TA1g is fixed. Clip move and slip previews are now functions of the pointerdown arrangement plus the total pointer delta. Repeated pointer reports no longer compound an already-previewed absolute clip position/window.

## Root cause

`useClipGesture` read the live `useArrangementStore.getState().arrangement` on every pointer move. After the first preview this is already mutated. `moveClips` emits an absolute `startTick`, and `slipClips` emits an absolute `sourceStart`; `previewGesture` applies each absolute verb to the store's pointerdown `previewBase`. Consequently each new verb was calculated as `previous preview + total pointer delta`, making travel depend on pointer report count.

## Change

- `src/components/Arrangement/useClipGesture.ts:12` adds the pointerdown arrangement as `Gesture.previewBase`.
- `src/components/Arrangement/useClipGesture.ts:100` computes slip verbs from that base.
- `src/components/Arrangement/useClipGesture.ts:116` and `:121` compute both final and source-lane move previews from that base, preserving snap, clamping, axis lock, ripple behavior, and track delta semantics.
- `src/components/Arrangement/useClipGesture.ts:190` captures the arrangement once on pointerdown.
- No change was needed in `dragController.ts` or `arrangementStore.ts`. Trim and Alt-copy were intentionally untouched.

## Pinning tests

`src/components/Arrangement/__tests__/useClipGesture.previewBase.test.tsx:45-79` adds three hook-through-DOM tests against the real arrangement/editing/history stores:

1. Twenty-five `pointermove` events at the same +100 px coordinate leave `startTick` unchanged after the first preview.
2. Ten reports at +100 px with `pxPerTick = 1` land at exactly +100 ticks, commit one history entry, and one undo restores the origin.
3. Twenty-five identical slip reports leave `sourceStart` at base +100 rather than compounding.

On the old code, test 1 would advance on every report; test 2 would land around +1,000 ticks instead of +100 (about 10x); and the slip test would accumulate `sourceStart` in the same way. The focused file passes: 3/3 tests.

## Browser proof

Run with one Chromium under `node --experimental-strip-types` against `bun dev -- --port 5196 --strictPort`, default zoom, and `scrollLeft = 0`. Grid tolerance was one adaptive grid unit = 1,920 ticks. Raw artifact: `.scratch/w1-ta1g/probe-ta1g.json`.

| Pointer dx | Expected `dx / pxPerTick` | Actual delta | Error | Within one grid | History | Undo |
|---:|---:|---:|---:|:---:|:---:|:---:|
| 20 px | 1,981.94 | 1,920 | -61.94 | yes | +1 | restored |
| 60 px | 5,945.81 | 5,760 | -185.81 | yes | +1 | restored |
| 100 px | 9,909.68 | 9,600 | -309.68 | yes | +1 | restored |
| 450 px | 44,593.55 | 44,160 | -433.55 | yes | +1 | restored |

The held-pointer case sent 100 duplicate reports over approximately three seconds at +100 px. First preview, held preview, and committed tick were all 9,600: zero creep. It created one history entry and one Ctrl+Z restored tick 0. Browser console errors: 0. Page errors: 0.

The dev server's Vite child survived the first Ctrl+C, so its exact command/PID was verified and stopped. Port 5196 was then verified free.

## Verification

- `bun run test:run -- src/components/Arrangement/__tests__/useClipGesture.previewBase.test.tsx`: PASS, 1 file / 3 tests.
- `bunx eslint src/components/Arrangement src/store`: PASS, no diagnostics.
- `bun run test:run -- src/components/Arrangement src/store`: TA1g tests and 261 other tests PASS; blocked by two token-retheme-lane failures. Re-run once as requested, with the same external failures: missing `packages/oj-tokens/tokens/themes/cream.json`, and undeclared `--border-subtle-width` (the first run additionally observed `--shadow-raised` and `--shadow-overlay` while that lane was changing).
- `bunx tsc --noEmit -p tsconfig.app.json`: blocked by the same concurrent lane: deleted `cream.json` plus generated `bgCanvasAlt` keys not yet represented in `ThemeValues`.

## UNVERIFIED

- Audible behavior, clicks/dropouts, and MIDI-to-audio latency: headless browser proof cannot sign off on performer feel.
- Native executor, physical MIDI/audio hardware, device-loss behavior, and macOS.
- A fully green combined Arrangement/store test and app TypeScript gate after the concurrent token retheme reaches a consistent state. The failures are outside TA1g's allowed files and were not edited.
