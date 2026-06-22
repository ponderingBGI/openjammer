# Looper Record Reliability Plan

## Context
- This is not a new looper node. The goal is to clean up the existing looper, make the record control feel responsive, and make the command path reliable.
- The current symptom is that pressing the existing looper record button appears to do nothing.
- The looper UI lives in `src/components/Nodes/LooperNode.tsx` and is intentionally engine-driven: committed transport state comes from `LooperState` return frames and `LooperEdge` commit events, not synthetic local playback.
- The looper capability handle is `OjcoreLooperHandle` in `src/audio/executor/ojcoreHandles.ts`; both `OjcoreNativeExecutor` and `OjcoreWasmExecutor` expose non-null handles and route engine looper frames/events back to it.
- Primary finding: `startRecording()` sets a private handle flag before it knows the command can actually reach the engine. If the node has not been interned yet, the native graph has not been accepted yet, or the wasm worklet is not ready, the command silently no-ops while the handle remains internally `recording = true`. Because the UI derives `isRecording` only from engine return frames, the button still looks idle; later clicks call `startRecording()` again and are ignored by that stale flag. This can permanently wedge the record button until remount/dispose.
- UI polish finding: the CSS already has an unused `.looper-record-btn.armed` animation. The button lacks `type="button"`, an accessible label, and `onMouseDown` propagation isolation, while many neighboring node controls already stop propagation. This is an opportunity to make the existing control cleaner without changing the audio model.

## Approach
- Keep the existing looper and engine-driven transport model; do not replace it with a parallel Web Audio looper or a new node.
- Remove the stale private-recording wedge by making command dispatch return an explicit “sent / not sent” result and by deriving record/stop behavior from engine state plus a small pending intent, not a blind local boolean.
- Make early clicks safe: if record is clicked before the node is command-ready, show a short armed/pending state and retry once when the executor reports the graph/worklet is ready; if the node disappears, clear the pending intent.
- Clean the UI by using the existing armed/recording styling intentionally, adding accessible button labels/tooltips, preventing canvas drag/selection interference on the record button, and keeping all failure feedback inline/non-modal.
- Keep the polished existing features intact: duration scrub/edit, true PCM waveform upgrades, loop rows, mute/delete/export/undo, wet balance, and engine-authoritative commit rows.
- Add targeted unit/integration coverage for the failure window: clicking record before graph/worklet/native interning is ready must either queue/retry safely or show a recoverable pending state, never permanently wedge the handle.

## Files to modify
- `src/audio/executor/ojcoreHandles.ts`
- `src/audio/executor/OjcoreWasmExecutor.ts`
- `src/audio/executor/OjcoreNativeExecutor.ts`
- `src/components/Nodes/LooperNode.tsx`
- `src/components/Nodes/SchematicNodes.css`
- `src/audio/executor/__tests__/ojcoreLooperHandle.test.ts`
- `src/audio/executor/__tests__/ojcoreExecutors.test.ts`
- `src/audio/executor/__tests__/wasmParity.test.ts`

## Reuse
- `LooperState`, `LooperAction`, and `LOOPER_MUTE_FLAG` from `packages/oj-protocol-ts/src/index.ts`.
- Existing looper handle callbacks: `setOnWaveformHistoryUpdate`, `setOnLoopAdded`, `setOnLoopDeleted`, `setOnLoopUpdated` in `src/audio/executor/ojcoreHandles.ts`.
- Existing native return paths: `pollMeters()` for `EngineFrame.Looper`, `routeLooperEdges()` for `LooperEdge`, and `fetchLooperTake()` in `src/audio/executor/OjcoreNativeExecutor.ts`.
- Existing wasm return paths: `onLooperFrames()`, `onLooperTake()`, and `routeLooperEdges()` in `src/audio/executor/OjcoreWasmExecutor.ts`.
- Existing looper UI styles in `src/components/Nodes/SchematicNodes.css`, especially `.looper-record-btn.recording` and the currently-unused `.looper-record-btn.armed`.
- Existing `@openjammer/oj-ui` primitives already available to the node: `Port`; optionally `Waveform`, `ProgressBar`, `ValueScrubber`, and `Button` if we choose to reduce the custom inline SVG/control markup during cleanup.
- Existing engine state machine in `crates/ojcore/src/looper.rs`; no first-pass kernel changes are expected because `RECORD`/`STOP` already transition correctly when delivered.

## Steps
- [ ] Replace the handle’s private `recording` boolean with a small transport-intent model (`idle`, `record-pending`, `stop-pending`) that is reconciled by engine frames/edges.
- [ ] Make `OjcoreBridge.sendCommand`/looper `action()` report whether a command was actually accepted for sending; return `false` when no `NodeIdx`, no native IPC bridge, wasm not ready, or the worklet node is absent.
- [ ] Add executor readiness notification for graph/index availability: native after `push_graph` acceptance commits `index`, wasm after worklet ready + graph send/ack. The looper handle can retry one pending record command when readiness flips true.
- [ ] If record is clicked while not ready, set a bounded pending/armed state; if the engine reports `RECORDING`/`OVERDUBBING`, clear pending; if the node remains unavailable or disappears, clear pending and leave an inline hint/title.
- [ ] Update `LooperNode.tsx` so the button class reflects `armed`/pending and `recording`, uses `type="button"`, `aria-label`, richer `title`, and `onMouseDown={(e) => e.stopPropagation()}`.
- [ ] Clean the looper render structure without changing behavior: extract small helpers for transport labels/tooltips and waveform rendering; optionally swap inline waveform/duration pieces to existing `Waveform`/`ProgressBar`/`ValueScrubber` primitives if that stays low-risk.
- [ ] Preserve the current engine-driven behavior for actual recording, commit rows, true PCM waveform upgrades, mute/delete/undo, wet balance, and duration `SetParam` updates.
- [ ] Add tests covering command-not-ready, repeated clicks after a dropped early command, successful record->stop command send, pending-to-recording reconciliation, commit-edge row creation, and both native/wasm return routing.

## Verification
- Unit: `bun test:run src/audio/executor/__tests__/ojcoreLooperHandle.test.ts src/audio/executor/__tests__/ojcoreExecutors.test.ts src/audio/executor/__tests__/wasmParity.test.ts`
- Type/build: `bun run build`
- Engine: `cargo test -p ojcore looper` and `cargo test -p ojproto wire_shapes` to keep the `RtCommand::Looper` state/protocol contract pinned.
- Manual native path: microphone/instrument -> looper -> speaker; click record, see immediate armed/REC feedback, stop/commit, confirm row appears and plays.
- Manual browser/wasm path: same graph after activation; verify an early click before worklet readiness does not wedge and later record works.
- Regression checks: overdub, clear/delete/undo, mute, loop balance, drag/export recorded layer, duration edit/scrub, and no focus-stealing modal/toast during performance.

## Decisions
- Treat this as cleanup/reliability of the existing looper, not a replacement.
- Prefer one queued/pending record intent over a dead-feeling disabled button, because it makes early clicks safe while still showing a clear armed state.
- Do not change the Rust looper kernel unless verification proves `RECORD`/`STOP` delivery works but the kernel state machine does not.
