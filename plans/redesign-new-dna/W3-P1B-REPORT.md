# Wave 3 P1b fix report — oj-ui controls + Knob

Date: 2026-08-29

## Outcome

All seven requested P1b fixes are implemented inside the assigned ownership. The requested
targeted test suite, app typecheck, Figma Code Connect parse, token regeneration/idempotency,
and real Chromium/Ladle checks pass. Ladle was run on port 61003 and is stopped; the port is
free.

## Changes by review item

1. **Primary / armed hover contrast**
   - `packages/oj-tokens/tokens/themes/light.json:17` sets `accentSecondary` to
     `oklch(0.71 0.19 40)` and documents why the light hover lifts when the label is ink.
   - `packages/oj-tokens/tokens/themes/dark.json:17` retains `oklch(0.78 0.19 40)` and carries
     the matching ink-label rationale.
   - `src/components/Arrangement/__tests__/contrast.test.ts:58-64` enforces
     `textOnAccent` on both `accentPrimary` and `accentSecondary` at 4.5:1 in both themes.

2. **Tinted state-label contrast**
   - Retuned lightness only, preserving each hue/chroma:
     `packages/oj-tokens/tokens/themes/light.json:50-54` and
     `packages/oj-tokens/tokens/themes/dark.json:50-54`.
   - `src/components/Arrangement/__tests__/contrast.test.ts:20-36` implements opaque
     `color-mix(in oklab, ...)` composition with colorjs.io.
   - `src/components/Arrangement/__tests__/contrast.test.ts:66-75` checks accent, success,
     warning, danger, and audio ink against their own 10% rest and 18% hover washes in both
     themes at 4.5:1.
   - `bun run tokens` regenerated `packages/oj-tokens/src/generated/themes.ts` and
     `packages/oj-ui/oj-tokens.css`; a second run produced identical hashes.

3. **Field accessibility**
   - `packages/oj-ui/src/components/Field/Field.tsx:38-68` now renders an explicit label,
     generates/stabilizes control and message ids, merges `aria-describedby`, sets
     `aria-invalid` when an error exists, and renders the error with `role="alert"`.
     Description/error text is outside the `<label>`.
   - `packages/oj-ui/src/components/Field/Field.test.tsx:57-76` proves the control's accessible
     name is exactly `Tempo`, the description/error ids resolve to the correct text, and the
     invalid/alert semantics are present.

4. **Knob commit coalescing**
   - `packages/oj-ui/src/components/Knob/Knob.tsx:54,116-133` adds one 180ms quiet timer for
     wheel and keyboard streams.
   - `packages/oj-ui/src/components/Knob/Knob.tsx:163-184,224,325` flushes the pending commit
     on window/control blur, pointer-down, and unmount. Pointer drag still commits once through
     its existing release/cancel gesture boundary.
   - `packages/oj-ui/src/components/Knob/Knob.test.tsx:285-315` proves 20 wheel notches and 20
     held `ArrowUp` events each produce 20 `onChange` calls and one `onCommit`; lines 318-339
     cover blur, pointer-down, and unmount flushes.

5. **Mono-Means-Exact flags**
   - `src/components/Export/ExportDialog.tsx:176` marks tail seconds mono.
   - `src/components/Export/ExportDialog.tsx:182` marks the destination path mono.
   - `src/components/CommandBar/AuthChooser.tsx:274` marks the API key mono.
   - The exact-value grep also found the OpenAI-compatible base URL; it is now mono at
     `src/components/CommandBar/AuthChooser.tsx:265`.
   - Flagged but not changed because it is outside P1b ownership:
     `src/components/Collab/CollabControl.tsx:121-123` contains an exact join code.
     All other app `<Input>` sites found were prose/name/search values.

6. **Ladle fonts**
   - `.ladle/components.tsx:3` imports `src/styles/fonts.css`.
   - In Ladle Chromium, `document.fonts.check('600 14px Outfit')` and the JetBrains Mono check
     returned true; `document.fonts` reported Outfit and JetBrains Mono 500 loaded.
   - Browser resource timing recorded successful loads from
     `/fonts/outfit-variable.woff2` and `/fonts/jetbrains-mono-medium.woff2`.
   - Computed families were Outfit on the Field label and JetBrains Mono on the numeric input.

7. **Fresh light/dark captures and browser measurements**
   - One Chromium instance drove Ladle at `http://localhost:61003`; the Playwright harness ran
     under `node`.
   - Captures are in `plans/redesign-new-dna/.scratch/w3-p1b/`:
     - `button-variants--{light,dark}.png`
     - `button-primary-hover--{light,dark}.png`
     - `button-danger-hover--{light,dark}.png`
     - `button-success-hover--{light,dark}.png`
     - `field-description-error--{light,dark}.png`
     - `knob--{light,dark}.png`
   - `capture.mjs` is the rerunnable single-Chromium evidence harness.

## Measured browser contrast

All values are WCAG 2.1 ratios from Chromium computed foreground/background colors after the
120ms hover transition settled.

| State | Light | Dark | Floor |
|---|---:|---:|---:|
| Primary / armed hover | 6.152:1 | 7.954:1 | 4.5:1 |
| Danger label, rest (10% wash) | 5.159:1 | 6.067:1 | 4.5:1 |
| Danger label, hover (18% wash) | 4.685:1 | 5.445:1 | 4.5:1 |
| Success label, rest (10% wash) | 5.061:1 | 5.194:1 | 4.5:1 |
| Success label, hover (18% wash) | 4.722:1 | 4.530:1 | 4.5:1 |

## Verification

| Gate | Result |
|---|---|
| `bun run tokens` | PASS; second run hash-identical |
| `bun run test:run -- packages/oj-ui src/components/Arrangement/__tests__/contrast.test.ts src/components/Export src/components/CommandBar` | PASS — 48 files, 402 tests |
| `bunx tsc --noEmit -p tsconfig.app.json` | PASS — exit 0, no output |
| `bunx figma connect parse` | PASS — exit 0 |
| `git diff --check` | PASS; only Windows LF/CRLF notices |
| Ladle fonts + screenshots | PASS — local fonts loaded, 12 PNGs captured |
| Ladle shutdown | PASS — port 61003 free |

The exact requested `bunx eslint packages src .ladle` command cannot lint this repository as
configured: ESLint exits because `.ladle` is globally ignored. `bunx eslint packages src`
passes. Forcing `.ladle/components.tsx` with `--no-ignore` exposes the pre-existing
`react-refresh/only-export-components` violation at line 14; the assigned ownership permits a
font import only, so that structural provider split was not changed.

The targeted suite also prints one existing React `act(...)` warning from
`src/components/CommandBar/__tests__/AiPanel.test.tsx`; all CommandBar tests pass.

## UNVERIFIED / intentionally out of scope

- Firefox, Safari, and touch input were not exercised; the requested browser scope was one
  Chromium.
- Audio was not played because these changes affect visual controls, accessibility metadata,
  and commit callbacks rather than the audio path.
- The Collab join-code mono flag remains for its owning lane.
- DESIGN.md still names the retired font set, while approved master-plan D3 makes Outfit
  authoritative; DESIGN.md is outside this lane. The design hook's existing Knob `2px` radius
  finding is the indicator tick cap, not a component corner, so no radius change was made.
