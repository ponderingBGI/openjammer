# Wave 1 TA1b — timeline logic reliability report

Date: 2026-08-28

## Outcome

The TA1b source, TypeScript, ESLint, targeted tests, and the one permitted full Vitest run are green. The required runtime journey is **UNVERIFIED**: Chromium hung inside `chromium.launch()` before creating a page on the first attempt and again after the required 60-second cooldown. No screenshots were produced. The Vite server was stopped and port 5184 was confirmed free.

## Review defects

- **R1 / TL-14 cross-track drag** — `src/components/Arrangement/useClipGesture.ts:30-120` keeps the previewed ClipView on its source lane during the pointer stream, retains the final cross-track verbs, then applies them atomically before the single commit. Pointer cancel is guarded. Pin: `moves a clip across tracks as one history entry and one undo restores it`. It dispatches the real component pointer stream; on old TA1 the preview reparent unmounted ClipView and aborted, leaving cursor 0.
- **R2 / TL-12 pan** — `src/components/Arrangement/MixerDrawer.tsx:17-87` removes the consume-next-commit latch. Pointer movement owns one transaction and suppresses only the post-drag click; typed commits always apply. Pins: `applies a typed pan value through the real inline editor` and `owns pan pointer commit once, suppresses the post-drag editor, and still accepts later typing`. Both click the real ValueScrubber and press Enter; old TA1 swallowed that commit.
- **R4 / TL-01 end freeze** — `src/store/arrangementStore.ts:497-505,615-643` makes stopped `stop()` idempotent and clears the end timer on motion 0. Pin: `freezes at an engine-reported song end and cancels the later watchdog`; it advances beyond the watchdog and proves no seek and no playhead movement. Old TA1 called Stop again and sought to `playOriginTick`.
- **R3 / TL-13 zoom** — `src/components/Arrangement/ArrangementSurface.tsx:61-82,134-148` preserves store `leftTick` as canonical during zoom, delays the DOM write, and uses a native non-passive wheel listener. Pin: `keeps the canonical left tick through one zoom notch even when DOM scroll reads stale`; the test forces a stale zero DOM read, which reset old TA1 to bar 1.
- **R5 loop without a range** — policy: loop enablement without a valid loop location behaves as non-loop playback and stops honestly at song end. `src/store/arrangementStore.ts:99-110,128-130`. Pins: `loop enabled without a range still stops honestly at song end` and `TL-01 keeps a real loop range rolling past the non-loop end watchdog`. Old TA1 disarmed the watchdog solely from the UI flag.
- **R7 / TL-15 playback failure and acknowledgement** — `src/store/arrangementStore.ts:488-492` tears down a partially published preview, logs through the song logger, and exposes `transportError`; `src/components/Arrangement/TransportStrip.tsx:20,81` renders it. `src/store/arrangementStore.ts:619` accepts rolling/declick motions and CountIn. Pins: `tears down a partially started preview when play publication throws` and `accepts count-in as a valid play acknowledgement`. Old TA1 left the preview alive and rejected motion 5.
- **Transport callers** — `src/components/Arrangement/TransportStrip.tsx:39,64` uses `returnToStart()` and clamped `setTempo()`. Pin: `clamps a typed tempo through the production TransportStrip path`; old TA1 applied 999 unclamped.
- **Overlapping transactions** — `src/store/arrangementStore.ts:368-405` deterministically force-aborts an open gesture before a new gesture or atomic apply. Pins: `force-aborts an overlapping gesture before starting the next transaction` and `force-aborts an open gesture before applying an atomic edit`.
- **TL-24 audition ownership** — `src/components/PianoRoll/PianoRoll.tsx:103,145-180` retains exact audition tokens, passes them on release, and cancels auditions on clip/surface teardown. Existing action tests pin independent overlapping voices, release after playback starts, and terminal cancellation. A separate executor-level graph restoration primitive does not exist in the owned file set; explicit restoration of the pre-audition canvas graph is **UNVERIFIED**.
- **R6 / TL-28 hot path** — `src/components/Arrangement/ClipView.tsx` no longer subscribes to the whole arrangement; `TrackLaneView.tsx:109` passes the computed timebase. Pin: `wires a 3/4 arrangement timebase into the rendered ClipView label`; old TA1's component wiring subscribed every clip to preview frames.
- **Selection history** — `src/store/historyStore.ts` adds `pianoroll` history scope; PianoRoll document edits and gestures identify their originating surface, and Ctrl+Alt+Z/Y routes selection undo/redo there. Existing store coverage passes; a dedicated DOM selection-routing test is **UNVERIFIED**.
- **Velocity burst lifecycle** — `src/components/PianoRoll/PianoRoll.tsx:145-152` commits and resets a pending burst when clip, track, surface, or component lifetime changes. A dedicated component burst timing test is **UNVERIFIED**.
- **Cleanup** — removed dormant arrangement note selection state, updated fail-closed preview documentation, guarded stray clip pointer cancellation, and hoisted `COLLAPSED_LANE_HEIGHT` in `src/store/trackLaneViewStore.ts:9`.

## Test evidence

```text
bun run test:run -- src/song src/components/Arrangement src/components/PianoRoll src/store
Test Files  46 passed (46)
Tests       408 passed (408)

bunx tsc --noEmit -p tsconfig.app.json
PASS (zero diagnostics)

bunx eslint src packages e2e
PASS (zero diagnostics)

bun run test:run
Test Files  171 passed (171)
Tests       1670 passed (1670)
```

The full suite was run exactly once at the end. Expected negative-path stderr remains present in unrelated tests; the command exited 0.

## Runtime journey

Harness: `plans/redesign-new-dna/.scratch/w1-ta1b/journey.ts`.

- First attempt: hung in `chromium.launch()` before page creation; manually terminated after more than 60 seconds.
- Cooldown: 60 seconds.
- Retry: again hung in `chromium.launch()` before page creation; manually terminated.
- Cross-track move, zoom-at-bar-8, end freeze, pan type/drag, loop-without-range, and zero-console-error browser assertions: **UNVERIFIED**.
- Screenshots: **UNVERIFIED / none produced**.
- Vite: exact listener PID stopped; port 5184 verified free.

## Public API changes

- `ArrangementStore.apply` accepts optional `surface: 'arrangement' | 'pianoroll'`.
- `ArrangementStore.beginGesture` accepts the originating surface.
- `HistoryScope` adds `pianoroll`.
- `PianoRollProps.onAudition` may return and receive a `PianoRollAuditionToken`.
- `ClipView` requires an explicit `timebase` prop.
- `COLLAPSED_LANE_HEIGHT` is exported by `trackLaneViewStore`.

## Risks and proof boundary

- Browser behavior and actual audible playback/latency/dropout feel remain **UNVERIFIED** because Chromium never launched. Component/store tests do not substitute for performer/audio-hardware judgment.
- Audition publication restores note ownership but explicit restoration of the canvas graph remains **UNVERIFIED** within the available executor contract.
- Dedicated velocity-burst, audition-through-PianoRoll, selection-history DOM, and repeated-step-entry component tests remain **UNVERIFIED**; the associated source paths compile and the broader targeted/full suites pass.
- Impeccable reported pre-existing CSS findings in ArrangementSurface.css and PianoRoll.css. CSS was explicitly outside TA1 ownership, so they were classified out of scope and not changed or suppressed.
