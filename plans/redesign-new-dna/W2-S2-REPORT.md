# Wave 2 S2 — atomic token swap report

## Token map applied

- Replaced Cream/Cyberpunk/Midnight with Light/Dark and regenerated all three token artifacts.
- Applied the audit §1.2 values and retirements atomically across app and oj-ui CSS. Directional port color variables collapse into the audio/control connection roles; directional CSS class names also collapse to kind-only classes.
- Applied D5 exactly: Light `textOnAccent #1D1C18`, Light `textMuted #6C695F`, Dark `textMuted #928E83`, and per-theme accessible `*Ink` roles.
- Deliberate audit-table deviation: `timelineClipBorder` uses text-muted (`#6C695F` Light, `#928E83` Dark), not the decorative hairline, because the table values fail the required 3:1 non-text boundary floor.
- Added `borderControl` (`#969389` / `#6E6A5E`) only to port wells and slider thumbs. Added per-theme elevation/focus/scrim roles and invariant motion/press/size primitives.
- Removed zero-consumer `port.spacing` and `node.header-height`, all legacy sketch/directional/shadow primitives, and the universal-port rainbow.

## Files changed by area

- Tokens/runtime: `packages/oj-tokens/{tokens,src,dist,build.mjs,README.md}`, generated `packages/oj-ui/oj-tokens.css`, AI theme docs/tests, Ladle defaults, and duplicate App theme initialization.
- UI/CSS: semantic rewrites across `src/**/*.css`, `packages/oj-ui/src/**/*.css`, relevant TSX inline styles/stories, Port kind classes, Slider control borders, and Settings theme radiogroup.
- Boot/fonts: `index.html`, all three Outfit font stylesheets, both public font directories, download CSS, design-sync config, and third-party license.
- Tests/tooling/docs: two-theme contrast/schema tests, eslint `plans/**` ignore, GuideStep type split, token/UI READMEs, and Figma handoff theme wording.
- Browser evidence: `plans/redesign-new-dna/.scratch/w2/verify.mjs` and the screenshots/results beside it.

## Minimal shape fixes made

- `index.html:50-56,93,129`: boot card, indicators, divider, and elevation changed from 2px/hard-offset construction to 1px/soft New DNA construction so the pre-React shell does not flash the retired shape language.
- `packages/oj-ui/src/components/Port/Port.css:6-47`: one control-ring boundary and kind-only connection fills prevent deleted directional variables from leaving duplicate/broken selectors.
- `packages/oj-ui/src/components/Slider/Slider.css:54,66`: thumb borders use the expressly reserved `borderControl` role.
- Hard-offset `box-shadow: Npx Npx 0 …` declarations were mechanically replaced with `shadowRaised`; active transforms remain otherwise unchanged.

## Known unrefined rules for taste waves

- `packages/oj-ui/src/components/Button/Button.css`: retains the old component construction; only tokens/borders/shadows were swapped, as S2 requires.
- `packages/oj-ui/src/components/NodeShell/NodeShell.css`: coherent palette/elevation but not the S3 socket/header redesign.
- `src/components/CommandBar/CommandBar.css` and `src/components/Nodes/SchematicNodes.css`: mechanically coherent, still dense and awaiting component-specific taste work.
- `src/styles/global.css`: welcome/help chrome still carries the old layout and copy rhythm; palette/depth only changed.

## Verification

- `bun run tokens`: PASS; emitted `dist/variables.css`, `src/generated/themes.ts`, and `oj-ui/oj-tokens.css` for 2 themes.
- `bunx tsc --noEmit -p tsconfig.app.json`: PASS.
- `bun run lint`: PASS.
- Focused token/UI suite: PASS, 65/65.
- `bun run build`: PASS (Vite/PWA production build).
- Full `bun run test:run`: 1725 passed, 8 failed. The failures are in the concurrently changing Arrangement/song/Pi lane (`ArrangementSurface` gesture/virtualization tests, `editingContracts` snap behavior, and `piToolParity` missing `createClip` schema). They reproduced on the required rerun and are unrelated to token/CSS files.
- Zero-consumer sweep: PASS; only generated `--overlay-scrim` and its Modal declaration/consumers remain. No legacy theme IDs remain in TSX.
- Browser script ran with Node as required, produced zero console/page errors, found no `--sketch-black`, verified Dark at DOMContentLoaded and after load (`#161510`), and verified exactly one Outfit request. `document.fonts.check()` passed for 400 and 700.
- Runtime contrast: Light muted/tertiary 4.565:1, Light on-accent/accent 5.069:1; Dark muted/tertiary 4.504:1, Dark on-accent/accent 6.256:1.
- Screenshots: `light-canvas.png`, `dark-canvas.png`, `dark-domcontentloaded.png`, `dark-loaded.png`, `dark-arrangement.png`, `light-arrangement.png` under `plans/redesign-new-dna/.scratch/w2/`.
- Dev server stopped; port 5180 listener explicitly terminated.

## Could not verify

- Headless Playwright cannot sign off on audible playback, clicks/dropouts, or performer feel. The browser engine initialized without page errors, but a human audio pass with headphones remains required by the covenant.
- The scripted menu path left the add-node context menu open in the captured canvas image, so the screenshots prove palette/theme/boot behavior but do not provide reliable visual proof that the requested three-node connection landed. This should be repeated after the concurrent Arrangement lane stabilizes.

## Risks

- The worktree contains concurrent non-S2 Arrangement/PianoRoll/song/AI changes. Their eight failing tests are the only remaining automated red state and can change independently of this wave.
- This is intentionally mechanical and unrefined. Component-specific hover/press/focus behavior should be reviewed in S3+ rather than expanded here.
- The old `DESIGN.md` still describes the retired sketchbook system by explicit Wave-6 instruction; Impeccable therefore flags exact handoff values as outside that stale palette. Those findings are contextual false positives, not token drift.
