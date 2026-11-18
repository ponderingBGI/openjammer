# W1 TA1e — timeline precision fix round

Date: 2026-08-28

## Outcome

All four requested logic fixes are implemented and pinned. The targeted suite, TypeScript, ESLint, diff check, and the one permitted full Vitest run pass. The requested Chromium journey is **UNVERIFIED**: Chromium/harness hung twice without producing output, including the mandated retry after killing Chromium, waiting 90 seconds, and relaunching with `--disable-gpu --no-sandbox`. The dev server was stopped and port 5192 was verified free.

## 1. P0 — clip `lostpointercapture`

**Root cause.** Preview rendering can make the clip lose pointer capture during a normal long move (the review measured the failure at +300 px). `useClipGesture` treated that browser/React capture transition as cancellation even though the physical gesture was already owned by window listeners, so `finish(false)` restored the preview base and discarded history.

**Change.** `src/components/Arrangement/pointerGestureLifetime.ts:7` adds the minimal shared pointer lifetime owner. `src/components/Arrangement/useClipGesture.ts:192` uses window `pointermove`/`pointerup`/`pointercancel` plus blur for the complete gesture; `src/components/Arrangement/useClipGesture.ts:202` makes capture loss explicitly non-terminal. Escape and unmount still abort.

**Pin.** `src/components/Arrangement/__tests__/ArrangementSurface.test.tsx:82` moves a clip, dispatches `lostpointercapture`, proves the gesture remains open, continues moving, then releases on `window` and asserts one history entry. On the reviewed code this fails immediately because `onLostPointerCapture` calls `finish(false)`, leaving no open gesture or entry.

## 2. P0 — piano-roll pointer gesture ownership

**Root cause.** Note moves/resizes and velocity lollipops committed only through the original React element's `onPointerUp`; marquee completion similarly depended on the field. A re-render, release outside the element, or capture loss could miss teardown and leave `open: "Move notes"` until the watchdog.

**Change.** `src/components/PianoRoll/PianoRoll.tsx:236`, `:367`, `:379`, and `:631` use the same pointer lifetime owner for note move/resize, draw, marquee, and velocity lollipop gestures. Window release commits, window cancel/Escape-equivalent blur/unmount aborts, and capture loss is ignored (`:549`, `:631`). Cleanup removes every global listener and restores previews on abort.

**Pins.** `src/components/PianoRoll/__tests__/PianoRoll.test.tsx:50` releases a moved note on `window` after capture loss and asserts one entry with no open gesture. `:66` cancels on `window` and asserts the original note plus zero entries. The reviewed implementation fails the first because no window release listener calls `endDrag`; the gesture remains open until the watchdog.

## 3. P2 — seek then immediate play

**Root cause.** `play()` used the last acknowledged `playheadTick`, overwriting the pending seek origin before its transport frame arrived.

**Change.** `src/store/arrangementStore.ts:628` derives the origin from `pendingSeekSample` through the arrangement tempo map while `transportPending === 'seek'`; otherwise it uses the confirmed playhead.

**Pin.** `src/store/__tests__/arrangementStore.test.ts:417` seeks to tick 1,920 without acknowledging it, immediately plays, and asserts origin tick 1,920 / preview sample 48,000. The reviewed implementation starts at tick/sample zero.

## 4. P2 — six-second velocity wheel burst

**Root cause.** Wheel input has no active pointer. Only `beginGesture` armed the five-second watchdog, so a continuous burst was force-committed at five seconds. The component retained its stale base/id and subsequent `previewGesture` calls were dropped until the 180 ms pause.

**Change and policy.** `src/store/arrangementStore.ts:526` refreshes gesture liveness on every successful preview. Policy: a continuous wheel burst separated by less than 180 ms is one undo entry, regardless of duration; the pause commits it.

**Pin.** `src/components/PianoRoll/__tests__/PianoRoll.test.tsx:78` sends 60 notches at 100 ms intervals over six seconds, then asserts the exact cumulative velocity, exactly one history entry, and no open gesture. The reviewed implementation loses the post-watchdog notches and cannot produce the expected final velocity.

## Verification

- `bun run test:run -- src/song src/components/Arrangement src/components/PianoRoll src/store src/ai` — PASS, 55 files / 512 tests.
- `bunx tsc --noEmit -p tsconfig.app.json` — PASS.
- `bunx eslint src packages e2e` — PASS.
- `git diff --check` — PASS (line-ending warnings only).
- `bun run test:run` — PASS, 173 files / 1,689 tests / 38.28 s.
- Dev server — stopped; `PORT_5192_FREE` verified.

## Journey evidence

Harness adapted at `plans/redesign-new-dna/.scratch/w1-gate2/journey-gate2.ts` for port 5192 and output directory `plans/redesign-new-dna/.scratch/w1-ta1e/`. It includes the gate-2 regression set plus +300 px clip drag, outside-note release, immediate seek/play, and 60 real wheel notches over six seconds.

No runtime verdict is claimed. First launch and the single safe retry each hung for more than two minutes with a zero-byte `plans/redesign-new-dna/.scratch/w1-ta1e/journey.log`. The safe retry followed the required 90-second wait and Chromium flags. Therefore +300 px browser commit, outside-note browser commit, transport UI race, six-second browser wheel behavior, regression-set status, and zero console/page errors remain **UNVERIFIED in Chromium**.

## Other unverified items

- Audible behavior, clicks/dropouts, and MIDI-to-audio latency require a human with audio playing.
- Native executor, physical device loss, and macOS.
- The Impeccable hook reported two pre-existing `PianoRoll.css` design findings. CSS was explicitly out of scope and was not edited; they are unrelated to TA1e logic.
