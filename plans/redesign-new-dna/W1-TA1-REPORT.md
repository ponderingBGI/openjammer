# Wave 1 TA1 — timeline logic reliability report

Date: 2026-08-28

## Outcome

The owned unit scope passes: **45 test files, 386 tests**. The implementation repairs the requested transport watchdog and acknowledgement behavior, transaction-local copy IDs, mixer transaction ownership, coalesced viewport writes, clip gesture cleanup, recording start/completion generations, lane-height restoration, velocity burst commits, audition voice ownership, repeated step-entry rejection, and meter-aware exclusive clip labels.

The final browser/type/lint/full-suite gate is **UNVERIFIED** because Windows stopped launching any new process with `0xC0000142` after Playwright attempted to launch Chromium. The targeted test gate completed before that host failure. Claims below distinguish tested behavior from source inspection.

## Findings

- **TL-01** — `src/store/arrangementStore.ts:69`: initial publication and rolling republication no longer arm the non-loop end watchdog while loop is enabled; enabling loop while rolling clears an existing watchdog. Pinned by `TL-01 keeps loop playback rolling past the non-loop end watchdog`. Verified by Vitest.
- **TL-05 / TL-06** — `src/store/arrangementStore.ts:460`, `src/components/Arrangement/useClipGesture.ts:75`, `src/components/PianoRoll/PianoRoll.tsx:190`: IDs minted inside an open gesture advance the captured transaction base; note copying begins the transaction before reserving IDs; clip copy templates retain stable IDs and apply the same relative track-index delta as normal moves. Persistence is pinned by `stores IDs allocated during a gesture in the committed document and after reload`. Vertical hover mapping was source-reviewed but its browser journey is UNVERIFIED.
- **TL-12** — `src/components/Arrangement/MixerDrawer.tsx:17`: pointer pan owns begin/preview/commit; the following `ValueScrubber.onCommit` is consumed instead of creating a second entry, while non-pointer commits still apply normally. Pinned by `owns pan pointer commit once and records exactly one undo entry`. Verified by Vitest.
- **TL-13** — `src/components/Arrangement/ArrangementSurface.tsx:59`: scroll and zoom share one pending rAF; wheel factors coalesce, current `pxPerTick` is read at flush time, the cursor anchor is preserved through `zoomAt`, and the frame is canceled on unmount. Anchor math is pinned by `keeps the tick beneath the pointer invariant`. rAF coalescing was source-reviewed; browser execution is UNVERIFIED.
- **TL-14** — `src/components/Arrangement/useClipGesture.ts:34`, `src/components/Arrangement/ClipView.tsx:105`: cleanup uses a stable finish ref, unmount calls `finish(false)`, duplicate mouse listeners were removed, `pointercancel` aborts, and `lostpointercapture` is exposed and wired. The public hook return shape adds `onLostPointerCapture`; existing inputs remain unchanged. Browser lifecycle execution is UNVERIFIED.
- **TL-15** — `src/store/arrangementStore.ts:45`, `src/store/arrangementStore.ts:480`: play/seek publication failures clear pending state with an actionable error while preserving the last confirmed tick; pending commands have a 1.5 s bound; seek acknowledgement tolerates one 256-sample engine block; stale timeout generations cannot clear newer commands. Pinned by `TL-15 clears a failed seek honestly while preserving the last confirmed tick` and `accepts a seek acknowledgement within one engine block`. Verified by Vitest.
- **TL-16** — `src/store/arrangementStore.ts:565`: recording state is published only after successful conduct/start and at least one armed binding; failure restores prior play state and records an actionable error. Pinned by `TL-16 enters recording only after lowering and engine start succeed`. Verified by Vitest.
- **TL-17** — `src/store/arrangementStore.ts:264`: recording completion captures document and record-session generations across `stopArrangementRecording()` and explicitly rejects a mismatch without applying capture to the replacement song. Pinned by `TL-17 rejects recording completion from an earlier document generation`. Verified by Vitest.
- **TL-18** — `src/store/trackLaneViewStore.ts:20`: `previousLaneHeights` is separate from expanded height; switching expanded clips does not overwrite it; close restores and clears it. Pinned by `restores the separately remembered lane height when the piano roll closes` and `does not replace the remembered height when switching the expanded clip`. Verified by Vitest.
- **TL-22** — `src/components/PianoRoll/PianoRoll.tsx:104`, `src/components/PianoRoll/PianoRoll.tsx:414`: wheel input begins once, previews cumulative velocity from a stable base, and commits once after a 180 ms quiet period; cleanup cancels the timer and terminates the gesture. Pure velocity bounds remain covered by BC-33. Component burst timing is UNVERIFIED.
- **TL-24** — `src/components/PianoRoll/actions.ts:28`, `src/components/PianoRoll/PianoRoll.tsx:148`: auditions are tokenized; pending native timers cancel; each sounding voice releases idempotently; cleanup releases all voices; releases remain valid after playback starts; audition never calls `stopArrangementPreview`. Pinned by `keeps overlapping voices independently owned and releases each exactly once`, `releases a voice after playback starts without stopping the transport`, and `cancels pending and sounding voices on close cleanup`. Verified by Vitest.
- **TL-26** — `src/components/PianoRoll/PianoRoll.tsx:326`: repeated keydown events are rejected inside step entry before insertion or cursor movement. Source-reviewed; dedicated DOM key test is UNVERIFIED.
- **TL-28** — `src/components/Arrangement/geometry.ts:14`, `src/components/Arrangement/ClipView.tsx:99`: labels use `timebase` and `tickToBarBeat`. Policy is explicitly end-exclusive: `[startTick, endTick)`, so an exact boundary belongs to the preceding occupied bar. Pinned by `uses the arrangement timebase for a non-4/4 meter` and `treats the clip end as exclusive at an exact bar boundary`. Verified by Vitest.

## Cross-cutting repairs

- Editing-context selection is authoritative in PianoRoll; synchronous legacy `arrangementStore.selectNotes` double-writes were removed.
- `editingContextStore` now keeps entries/index/depth/before independently for every `SurfaceId`. `historyStore` resets the selection baseline for the surface implied by the history scope. Pinned by `keeps arrangement and piano-roll depth, branches, undo, and redo independent` and the updated BC-26 branch test.
- ID counter changes are carried by the open gesture base and survive JSON save/reload.
- Arrangement viewport writes use one coalesced controller/rAF and canonical tick/pixel anchor math.
- Playback, recording, and audition have separate ownership: transport command generations, document/record-session generations, and audition voice tokens.
- Transport store actions added: `playOriginTick`, `returnToStart()`, and `setTempo(number)`. Stop freezes; a second Stop seeks to `playOriginTick`; `returnToStart()` seeks zero; `setTempo` clamps to 20–300 and applies a normal document verb. Pinned by `first Stop freezes and second Stop returns to the play origin; returnToStart locates zero` and `clamps tempo through the document verb path`.

## Public API changes for Wave 3

- `ArrangementStore`: adds `transportError`, `playOriginTick`, `returnToStart()`, and `setTempo()`.
- `useClipGesture`: adds returned `onLostPointerCapture`; consumers should wire it alongside pointer cancel. Existing arguments and handlers remain stable.
- Piano-roll audition: `auditionPianoRollNote(..., 'on')` now returns a voice token; optional exact release is available through `releasePianoRollAudition(token)`, and surface teardown should call `cancelPianoRollAuditions()`.
- `editingContextStore`: replaces global selection-history fields with `selectionHistoryBySurface`.
- `trackLaneViewStore`: adds `previousLaneHeights`.

## Verification evidence

Targeted command:

```text
bun run test:run -- src/song src/components/Arrangement src/components/PianoRoll src/store
Test Files  45 passed (45)
Tests       386 passed (386)
```

New test names:

- `TL-01 keeps loop playback rolling past the non-loop end watchdog`
- `TL-15 clears a failed seek honestly while preserving the last confirmed tick`
- `accepts a seek acknowledgement within one engine block`
- `stores IDs allocated during a gesture in the committed document and after reload`
- `first Stop freezes and second Stop returns to the play origin; returnToStart locates zero`
- `clamps tempo through the document verb path`
- `TL-16 enters recording only after lowering and engine start succeed`
- `TL-17 rejects recording completion from an earlier document generation`
- `keeps arrangement and piano-roll depth, branches, undo, and redo independent`
- `owns pan pointer commit once and records exactly one undo entry`
- `restores the separately remembered lane height when the piano roll closes`
- `does not replace the remembered height when switching the expanded clip`
- `uses the arrangement timebase for a non-4/4 meter`
- `treats the clip end as exclusive at an exact bar boundary`
- `keeps overlapping voices independently owned and releases each exactly once`
- `releases a voice after playback starts without stopping the transport`
- `cancels pending and sounding voices on close cleanup`

Owned-file ESLint completed successfully before the host failure. Earlier full-app TypeScript reached two concurrent-lane errors outside TA1 (`src/components/Canvas/NodeCanvas.tsx` and `src/store/graphStore.ts`); a later retry could not start due to `0xC0000142`. Full `bun run lint`, final full-app TypeScript, and full `bun run test:run` are therefore UNVERIFIED.

## Runtime smoke and risks

The requested harness is at `plans/redesign-new-dna/.scratch/w1-ta1/smoke.ts`. Neither bundled Chromium nor system Chrome reached page navigation. The final system-Chrome attempt exited `-1073741502` (`0xC0000142`, DLL initialization failure), after which PowerShell, `cmd`, Bun, TypeScript, ESLint, and process-control launches failed identically. No screenshots were produced; all runtime assertions, console/page-error checks, and the final Vite shutdown are UNVERIFIED. PID 34064 was the requested port-5178 Vite process, but Windows would not launch `Stop-Process`, so shutdown is also UNVERIFIED.

Risks remaining:

- TL-06 vertical multi-track copy, TL-13 burst coalescing, TL-14 lost-capture/unmount, TL-22 wheel debounce, and TL-26 repeated DOM keydown need the blocked browser/component journey before release sign-off.
- Physical audio feel, dropout behavior, and latency were not heard and remain human/audio-hardware verification items.
- The design hook flagged existing side-border/radius rules in `ArrangementSurface.css` and `PianoRoll.css`. CSS belongs to the concurrent visual lane and was explicitly out of scope, so those findings were not modified or suppressed.
