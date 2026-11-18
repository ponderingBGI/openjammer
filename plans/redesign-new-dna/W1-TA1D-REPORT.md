# W1 TA1d final fix report

Date: 2026-08-28

## Result

The three requested timeline defects are fixed and pinned by tests. Targeted tests,
TypeScript, ESLint, `git diff --check`, and the one final full Vitest run pass. The
required Chromium journey is **UNVERIFIED** because Chromium hung on the initial launch
and timed out on the one permitted retry; no runtime screenshot claim is made.

## 1. P0 — nested velocity-wheel gesture wedge

- `src/components/PianoRoll/PianoRoll.tsx:199-220,467` centralizes wheel-burst closure and
  commits that exact gesture synchronously before a note pointer gesture begins. Its timer
  uses the same id-aware closer, so it cannot clear ownership while leaving an outer frame.
- `src/store/arrangementStore.ts:40-49,283-303,520,545-555` adds id-aware gesture commit
  and a five-second watchdog. It defers while a pointer is owned; otherwise it logs a
  warning and closes every orphaned frame instead of silently wedging history.
- Pinning tests: `src/store/__tests__/arrangementStore.test.ts:328-344` proves the burst
  and drag become two undoable entries with an empty stack; `:346-359` proves the watchdog
  closes and warns for an ownerless frame. These failed on the pre-fix code because
  `commitGesture(id)` did not exist and no watchdog closed an orphan.

## 2. P1 — play from a parked playhead

- `src/store/arrangementStore.ts:627-680` tracks whether a rewind is armed by a user Stop,
  clears that state on play/seek/end halt, and updates `playOriginTick` on every seek.
  A second explicit Stop rewinds only when the preceding Stop was user-driven and no seek
  moved the playhead afterward.
- `src/components/Arrangement/TransportStrip.tsx:35-38` and
  `src/components/Arrangement/ArrangementSurface.tsx:93` route solely on `isPlaying`:
  rolling stops, stopped plays from the parked playhead.
- Pinning tests: `src/store/__tests__/arrangementStore.test.ts:401-415` covers seek to bar
  5 then Play; `:417-428` covers play → stop → seek → Play; the existing double-Stop test
  at `:389-399` covers user stop → stop rewind. The bar-5 test failed pre-fix with
  `playOriginTick === 0`.

## 3. P2 — honest queued agent edits

- `src/store/arrangementStore.ts:306-339,461-481` returns applied/queued status, retains a
  deferred undo request for the eventual queue entry, and records
  `lastQueuedEditResult` as queued/applied/rejected. Rejection still sets
  `transportError` and does not stop later FIFO items.
- `src/ai/arrangementAdapter.ts:101,181-214` returns
  `{ ok: true, queued: true, appliedAfterGesture: true }`, explicitly says the edit will
  land after the performer's gesture, and exposes the last queue result from
  `describe_arrangement`.
- `src/ai/tools.ts:243-253,499-513,1195-1210` carries the structured fields through the
  pure tool seam. The catalogue and docs were updated at `src/ai/tools.ts:206-211`,
  `docs/agent-tools.md:117`, and `docs/timeline.md:37-38,51-53`.
- Pinning tests: `src/ai/__tests__/arrangementTools.test.ts:110-126` covers honest queued
  success and eventual result; `:128-140` covers rejected flush visibility in both
  transport and the next description. Both failed pre-fix because the adapter returned
  only an immediate “Applied” success with a no-op undo.

## Journey evidence

- Harness: `plans/redesign-new-dna/.scratch/w1-ta1d/journey-ta1d.ts`.
- Machine-readable result: `plans/redesign-new-dna/.scratch/w1-ta1d/journey.json`.
- Attempt 1: `chromium.launch()` hung; the harness process was terminated.
- Required recovery: waited 90 seconds, retried once with
  `--disable-gpu --no-sandbox`.
- Attempt 2: Chromium process launched but never connected; Playwright timed out after
  45 seconds. The process and Vite server were stopped.
- Screenshots: none, because no page was created.
- Console/page errors: UNVERIFIED, because no page was created.

## Verification

- `bun run test:run -- src/song src/components/Arrangement src/components/PianoRoll src/store src/ai`:
  53 files / 506 passed during the implementation pass; after the generated-doc correction,
  the affected doc/parity subset passed 2 files / 6 tests.
- `bunx tsc --noEmit -p tsconfig.app.json`: PASS, zero diagnostics.
- `bunx eslint src packages e2e`: PASS, zero diagnostics.
- `git diff --check`: PASS; only Git line-ending notices, no whitespace errors.
- Final `bun run test:run` (run once): PASS, 172 files / 1684 tests in 38.57 s.

## UNVERIFIED

- The single-Chromium UI journey and its requested screenshots are unverified due to the
  two launch failures above.
- Audible feel, clicks/dropouts, and native MIDI-to-audio latency were not verified in
  this headless fix round.
- Pre-existing CSS hook observations in Piano Roll and Arrangement styles were left
  unchanged because CSS was explicitly outside the allowed edit scope and unrelated to
  TA1d.

No files were staged, committed, stashed, checked out, or reset.
