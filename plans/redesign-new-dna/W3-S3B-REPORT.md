# W3 S3b report — socket/node surgical fixes

## Outcome

All three requested S3 review fixes are implemented and pinned. The requested unit/type/lint gates pass. A Node-launched Playwright run used one Chromium against Vite on port 5206, built and connected a Keyboard → Keys instrument → Speaker rig, connected all four Keyboard bundles, expanded `Keyboard Row 1`, and captured both themes with zero console errors and zero page errors. The dev server was stopped afterward; port 5206 is no longer listening.

## 1. M1 — bundle identities no longer truncate

- `src/components/BundlePortGroup.css:17-19` changes left bundle rows to a four-column grid: 22px disclosure, `minmax(90px, 1fr)` identity, intrinsic count, and 18px socket.
- `src/components/BundlePortGroup.css:57-67` preserves the required 9.5px tracked uppercase mono voice, removes ellipsis/hidden overflow, and reserves a 90px label minimum.
- `src/components/Nodes/_sockets.css:62-64` widens only input panels that actually contain bundle groups to 190px, leaving ordinary input panels unchanged.
- Pin: `src/components/BundlePortGroup.test.tsx:36-58` renders `Keyboard Row 1`, asserts no `text-overflow`/hidden overflow, pins the grid and conditional panel width, and mocks the 90px browser requirement to assert `scrollWidth <= clientWidth`.

Browser measurements, identical in light and dark:

| Label | clientWidth | scrollWidth | Fully visible |
|---|---:|---:|---|
| Keyboard Row 1 | 90px | 90px | yes |
| Keyboard Row 2 | 92px | 92px | yes |
| Keyboard Row 3 | 90px | 90px | yes |
| Keyboard Pedal | 92px | 92px | yes |

The expanded panel measured 273.87px after its channel list established the content width. Every bundle identity remained fully legible, with `overflow-x: visible` and no ellipsis.

Screenshots:

- `plans/redesign-new-dna/.scratch/w3-s3b/light-keyboard-bundles.png`
- `plans/redesign-new-dna/.scratch/w3-s3b/dark-keyboard-bundles.png`

## 2. Selected node — 1.5px edge, focus ring only on keyboard focus

- `packages/oj-ui/src/components/NodeShell/NodeShell.css:27-41` renders selection as the existing 1px accent border plus a 0.5px inset accent edge, with no layout shift. `--focus-ring` now appears only in `:focus-visible` rules; selected + keyboard-focused nodes retain both states.
- Pin: `packages/oj-ui/src/components/NodeShell/NodeShell.test.tsx:54-63` reads the computed rule contracts, verifies selected contains the inset edge but no focus ring, and verifies both focus-visible selectors contain the focus ring.

Browser measurements:

- Light: 1px accent border + 0.5px inset accent edge; selected shadow contains no 3px focus ring.
- Dark: 1px accent border + 0.5px inset accent edge; selected shadow contains no 3px focus ring.

Screenshots:

- `plans/redesign-new-dna/.scratch/w3-s3b/light-selected-node.png`
- `plans/redesign-new-dna/.scratch/w3-s3b/dark-selected-node.png`

## 3. Socket core — true 8px

- `packages/oj-ui/src/components/Port/Port.css:35-39` changes the socket `::after` core from percentage sizing to fixed `8px × 8px`.
- Pin: `packages/oj-ui/src/components/Port/Port.test.tsx:16-21` asserts exact 8px width/height and rejects percentage width/height.

Browser `getComputedStyle(socket, '::after')`, both themes:

- Well: 18px × 18px.
- Core: 8px × 8px.

Screenshots:

- `plans/redesign-new-dna/.scratch/w3-s3b/light-socket-closeup.png`
- `plans/redesign-new-dna/.scratch/w3-s3b/dark-socket-closeup.png`

## Verification

| Gate | Result |
|---|---|
| `bun run test:run -- packages/oj-ui src/components/Canvas src/components/Nodes src/utils src/engine` | PASS — 61 files, 662 tests |
| `bunx tsc --noEmit -p tsconfig.app.json` | PASS — exit 0 |
| `bunx eslint src packages` | PASS — exit 0 |
| Browser: Node Playwright, one Chromium, port 5206 | PASS |
| Browser console errors | 0 |
| Browser page errors | 0 |
| Dev server stopped / port 5206 released | PASS |

The passing Vitest run still prints pre-existing test-environment diagnostics for unavailable IndexedDB and a few React `act(...)` warnings; these are outside S3b and do not fail the suite.

Machine-readable browser measurements are in `plans/redesign-new-dna/.scratch/w3-s3b/results.json`; the Node Playwright harness is `plans/redesign-new-dna/.scratch/w3-s3b/gate.mjs`.

## Scope note

The Impeccable hook re-reported the pre-existing literal `3px` radius on the bundle scrollbar thumb (`src/components/BundlePortGroup.css:103`). It is unrelated to the three requested fixes, so it was intentionally left unchanged and no ignore was persisted.
