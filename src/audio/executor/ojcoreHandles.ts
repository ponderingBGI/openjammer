/**
 * ojcore capability handles (U-EXEC-PARITY).
 *
 * Real, never-null implementations of the {@link LooperHandle} /
 * {@link RecorderHandle} / {@link SamplerHandle} capability interfaces backed by
 * the ojcore engine, SHARED by both ojcore backends (native Tauri + wasm
 * worklet). The two backends differ only in HOW a control message reaches the
 * engine — sending an `RtCommand`, loading sample PCM, capturing recorder
 * output — so that variation is abstracted behind {@link OjcoreBridge}; the
 * stateful handle logic (loop layers, recordings, sampler config, the UI
 * callbacks the components subscribe to) lives here, once.
 *
 * WHY a client-side state mirror. The UI/engine seam is strictly CONTROL-RATE
 * (governing principle #4): only `OjGraph` / `RtCommand` JSON cross it, never
 * audio buffers. The engine's looper buffer and live sampler PCM therefore are
 * not readable back across the seam without a dedicated return ring (a wider
 * protocol change owned by a later wave). So these handles drive the engine for
 * REAL (record/stop/clear become `RtCommand::Looper`; sample-load lowers PCM
 * into the engine; recorder capture taps the engine output), and MIRROR the
 * state the visual layer needs (loop list, waveform, config) on the client. The
 * audio is engine-rendered; the visuals are mirrored. Founder-verified output.
 */

import { audioBufferToWAV } from '../wav';
import { getAudioContext } from '../audioContext';
import type { NodeIdx } from '../../../packages/oj-protocol-ts/src/index';
import {
    LooperAction,
    LooperState,
    LOOPER_MUTE_FLAG,
} from '../../../packages/oj-protocol-ts/src/index';
import type { RtCommand } from '../../../packages/oj-protocol-ts/src/index';
import {
    isInfiniteDuration,
    type LooperHandle,
    type LoopLayer,
    type RecorderHandle,
    type RecordingEntry,
    type SamplerHandle,
} from './capabilities';

/**
 * The minimal engine-side seam the capability handles drive. Implemented once
 * per ojcore backend (native invoke vs wasm worklet message port).
 */
export interface OjcoreBridge {
    /** Resolve a visual node id to its interned `NodeIdx`, or undefined. */
    nodeIndex(nodeId: string): NodeIdx | undefined;
    /** Send one realtime command to the engine (note/param/looper/transport). */
    sendCommand(cmd: RtCommand): void;
    /** Latest per-node output level (0..1 peak) cached from the engine meter
     *  stream — for driving REAL node visuals (e.g. the looper's live waveform)
     *  instead of synthetic motion. Returns `0` when the node has no recent
     *  level (no signal, or metering not currently streaming): an honest empty
     *  state, never a fabricated one. */
    nodeLevel(nodeId: string): number;
    /**
     * Lower decoded mono PCM into the engine as the sample for `nodeId`'s
     * `builtin.sampler` (native: `load_sample` Tauri command -> AssetCatalog ->
     * set_sample; wasm: transfer PCM into the worklet). Best-effort; resolves
     * when the engine has accepted (or dropped) the buffer.
     */
    loadSample(
        nodeId: string,
        pcm: Float32Array,
        sampleRate: number,
        rootNote: number
    ): Promise<void>;
    /** Begin capturing `nodeId`'s output bus on the engine side. */
    startCapture(nodeId: string): void;
    /** Stop capturing and resolve the captured interleaved WAV blob (or null). */
    stopCapture(nodeId: string): Promise<Blob | null>;
}

// ---------------------------------------------------------------------------
// Looper handle
// ---------------------------------------------------------------------------

/** Number of synthetic waveform points generated for a captured loop layer. */
const LOOP_WAVEFORM_POINTS = 100;
/** ojcore `looper_param::LOOP_SECS` id (kernel param 0): quantized loop length in
 *  seconds (<= 0 => free-run). Mirrors crates/ojcore/src/looper.rs. */
const LOOPER_LOOP_SECS_PARAM = 0;
/** ojcore `looper_param::WET` id (kernel param 1): the gain applied to the summed
 *  loop layers — the loop-level balance control. Mirrors crates/ojcore/src/looper.rs. */
const LOOPER_WET_PARAM = 1;

/**
 * Construct a full `Loop`-shaped {@link LoopLayer}. The Web-Audio-only
 * bookkeeping fields (`gainNode` / `sourceNode` / `startTime` / pause state) are
 * nulled — the audible loop is engine-rendered, so they carry no meaning on the
 * ojcore path; only the read fields (`id` / `buffer` / `isMuted` /
 * `waveformData` / `libraryItemId`) matter to the UI.
 */
function makeLoopLayer(
    id: string,
    buffer: AudioBuffer | null,
    waveformData: number[]
): LoopLayer {
    return {
        id,
        buffer,
        isMuted: false,
        waveformData,
        startTime: 0,
        gainNode: null,
        sourceNode: null,
        isPaused: false,
        pausedAtOffset: 0,
    };
}

/** Build a waveform array from raw mono PCM (peak per segment). The shared core
 *  used by {@link waveformFromBuffer}; usable without an AudioContext (headless /
 *  before the context is resumed) so the TRUE shape is honest either way. */
function waveformFromPcm(data: Float32Array, points = LOOP_WAVEFORM_POINTS): number[] {
    const seg = Math.max(1, Math.floor(data.length / points));
    const out: number[] = [];
    for (let i = 0; i < points; i++) {
        const start = i * seg;
        const end = Math.min(start + seg, data.length);
        let peak = 0;
        for (let j = start; j < end; j++) {
            const a = Math.abs(data[j]);
            if (a > peak) peak = a;
        }
        out.push(peak);
    }
    return out;
}

/** Build a waveform array from a real AudioBuffer (peak per segment) — its mono
 *  channel through the shared {@link waveformFromPcm}. */
function waveformFromBuffer(buffer: AudioBuffer, points = LOOP_WAVEFORM_POINTS): number[] {
    return waveformFromPcm(buffer.getChannelData(0), points);
}

/**
 * ojcore loop handle: forwards record/stop/overdub/clear to the engine looper
 * node as `RtCommand::Looper` actions (the REAL audio path), and mirrors the
 * loop-layer list + live waveform the UI displays.
 */
export class OjcoreLooperHandle implements LooperHandle {
    private duration = 10;
    /** Loop-level wet gain (0..1) applied to the summed layers — the balance
     *  control that tames the "loop adds on top" loudness. Kernel default 1.0. */
    private wet = 1;
    /** Optimistic "a pass was started" intent: set on `startRecording` so an
     *  immediate `stopRecording` commits, and RECONCILED from the engine state on
     *  every return frame/edge (see `onEngineFrame`/`onEngineEdge`). Reconciling
     *  against the SSOT means it can NEVER latch out of sync — a pass that never
     *  reaches the engine is corrected by the next frame, instead of wedging every
     *  later click. */
    private recording = false;
    /** UI rows in commit order: `loops[i]` mirrors kernel layer index `i`. */
    private loops: LoopLayer[] = [];
    /** Live trace amplitudes (peak per engine frame), driven by `onEngineFrame`. */
    private liveHistory: number[] = [];
    /** Latest engine looper state (drives the record/overdub edge semantics). */
    private engineState: LooperState = LooperState.IDLE;

    private onLoopAdded: ((loop: LoopLayer) => void) | null = null;
    private onLoopDeleted: ((loop: LoopLayer) => void) | null = null;
    private onWaveformHistory:
        | ((history: number[], playheadPosition: number) => void)
        | null = null;
    private onLoopUpdated: ((loop: LoopLayer) => void) | null = null;

    /**
     * Committed layers that do not yet carry their TRUE captured PCM, oldest
     * first — the front of the FIFO is the next take whose PCM is expected
     * (Stage 3). A take's PCM (`onLayerPcm`) and its commit edge (`onEngineEdge`)
     * cross the control seam on DIFFERENT paths (command return / postMessage vs
     * the event ring), so either can land first. We match by COMMIT ORDER: the
     * Nth committed layer <-> the Nth take PCM for this node.
     */
    private layersAwaitingPcm: LoopLayer[] = [];
    /**
     * Take PCM that arrived BEFORE its commit edge created the row (the PCM seam
     * raced ahead of the event ring), oldest first. Drained onto the next
     * committed layer that still lacks a real buffer.
     */
    private pcmAwaitingLayers: { pcm: Float32Array; sampleRate: number }[] = [];

    private readonly nodeId: string;
    private readonly bridge: OjcoreBridge;

    constructor(nodeId: string, bridge: OjcoreBridge) {
        this.nodeId = nodeId;
        this.bridge = bridge;
    }

    /**
     * Send a `RtCommand::Looper` action to this node, if it is in the graph.
     * `arg` addresses a layer for the indexed actions (`SET_MUTE` /
     * `DELETE_LAYER`) and is ignored by the transport actions; it defaults to 0.
     * Coerced through `>>> 0` so a packed `MUTE_FLAG` arg stays an unsigned
     * 32-bit value on the wire (matching the Rust `u32`).
     */
    private action(action: LooperAction, arg = 0): void {
        const idx = this.bridge.nodeIndex(this.nodeId);
        if (idx === undefined) return;
        this.bridge.sendCommand({ Looper: { node: idx, action, arg: arg >>> 0 } });
    }

    setDuration(duration: number): void {
        this.duration = duration;
        // Drive the kernel's LOOP_SECS immediately so a duration change takes
        // effect without waiting for a full graph re-emit (RT-3: a continuous
        // control sends a SetParam, not a recompile). Infinite (< 0) -> 0 =
        // free-run; clamped to the kernel's 60 s ceiling. No-op until the node is
        // in the graph — its baked param then applies on first compile.
        const idx = this.bridge.nodeIndex(this.nodeId);
        if (idx === undefined) return;
        const secs = isInfiniteDuration(duration) ? 0 : Math.max(0, Math.min(60, duration));
        this.bridge.sendCommand({
            SetParam: { node: idx, param: LOOPER_LOOP_SECS_PARAM, value: secs },
        });
    }

    getLoops(): LoopLayer[] {
        return this.loops;
    }

    /** The set loop cycle length in seconds (`< 0` == infinite / free-run). */
    getDuration(): number {
        return this.duration;
    }

    /** The latest engine looper state (IDLE/ARMED/RECORDING/PLAYING/OVERDUBBING),
     *  driven by the return frames — the SSOT for transport UI. */
    getEngineState(): LooperState {
        return this.engineState;
    }

    /** The current loop-level wet gain (0..1). */
    getWet(): number {
        return this.wet;
    }

    /**
     * Set the loop-level wet gain (0..1) and drive it into the kernel as
     * `SetParam(WET)` immediately (RT-3: a continuous control sends a SetParam,
     * not a recompile). This is the balance knob for the summed loop layers — it
     * is how the user tames the "loop adds on top" loudness. No-op until the node
     * is in the graph; the baked param then applies on first compile.
     */
    setWet(wet: number): void {
        this.wet = Math.max(0, Math.min(1, wet));
        const idx = this.bridge.nodeIndex(this.nodeId);
        if (idx === undefined) return;
        this.bridge.sendCommand({
            SetParam: { node: idx, param: LOOPER_WET_PARAM, value: this.wet },
        });
    }

    startRecording(): Promise<void> {
        if (this.recording) return Promise.resolve();
        this.recording = true;
        this.liveHistory = [];
        // Drive the engine looper: RECORD only — NEVER ARM (ARM clears existing
        // layers; the new flow keeps them). A from-scratch first take records;
        // a take begun while layers exist is handled by the kernel as an
        // OVERDUBBING pass that layers a new, phase-locked row on commit.
        this.action(LooperAction.RECORD);
        return Promise.resolve();
    }

    stopRecording(): void {
        if (!this.recording) return;
        this.recording = false;
        // Tell the engine to commit the pass. The actual ROW is created in
        // `onEngineEdge` when the engine reports RECORDING|OVERDUBBING -> PLAYING
        // (the AUTHORITATIVE cycle-wrap commit), not here — so the row appears at
        // the engine's real loop boundary, and on a manual stop alike.
        this.action(LooperAction.STOP);
    }

    /**
     * Engine return frame for this looper node (drained by the executor each
     * block). Drives the REAL playhead from the engine's sample position and the
     * live trace from the engine peak — replacing the old synthetic local-clock
     * tick entirely (the engine is the single source of truth for transport).
     */
    onEngineFrame(state: number, pos: number, loop_len: number, peak: number): void {
        this.engineState = state as LooperState;
        const recording =
            state === LooperState.RECORDING || state === LooperState.OVERDUBBING;
        // Reconcile the optimistic intent against the engine SSOT so it can never
        // latch (a started-but-unreached pass is corrected here, not wedged).
        this.recording = recording;
        // Accumulate the live trace only while a pass is being recorded; the
        // peak is the engine's real per-block amplitude for THIS looper node.
        if (recording) {
            this.liveHistory.push(peak);
            if (this.liveHistory.length > LOOP_WAVEFORM_POINTS * 4) {
                this.liveHistory.shift();
            }
        }
        // REAL playhead: engine sample position over the loop length (0..100).
        const playhead = loop_len > 0 ? (pos / loop_len) * 100 : 0;
        this.onWaveformHistory?.(this.liveHistory.slice(), playhead);
    }

    /**
     * Engine state-machine edge for this looper node. A transition from
     * RECORDING|OVERDUBBING -> PLAYING is the AUTHORITATIVE commit of a captured
     * pass (cycle wrap or manual STOP): the new layer now exists in the kernel,
     * so we create its mirror ROW HERE — in commit order, so `loops[i]` lines up
     * with kernel layer index `i`.
     */
    onEngineEdge(from: number, to: number): void {
        this.engineState = to as LooperState;
        // Reconcile the optimistic intent against the authoritative edge: a commit
        // to PLAYING ends the pass, a start edge begins one — never latches.
        this.recording =
            to === LooperState.RECORDING || to === LooperState.OVERDUBBING;
        const committed =
            to === LooperState.PLAYING &&
            (from === LooperState.RECORDING || from === LooperState.OVERDUBBING);
        if (!committed) return;
        const id = `oj-loop-${Date.now()}-${this.loops.length}`;
        // Use the live meter trace gathered during the pass. If the pass was too
        // short to gather one, leave it empty — an honest flat line until the TRUE
        // captured PCM lands on its separate seam and upgrades the row's shape (we
        // never fabricate a waveform the audio doesn't have).
        const waveformData =
            this.liveHistory.length > 1
                ? this.liveHistory.slice(0, LOOP_WAVEFORM_POINTS)
                : [];
        const layer = makeLoopLayer(id, null, waveformData);
        this.loops.push(layer);
        // Reset the trace for the next overdub pass.
        this.liveHistory = [];
        // Stage 3: this layer's TRUE captured PCM arrives on a SEPARATE seam
        // (the command return / `looper-take` postMessage). If it already raced
        // ahead of this edge, attach it now; otherwise queue the layer to receive
        // it (commit-order matching: Nth layer <-> Nth take PCM).
        const buffered = this.pcmAwaitingLayers.shift();
        if (buffered) {
            this.attachPcm(layer, buffered.pcm, buffered.sampleRate);
        } else {
            this.layersAwaitingPcm.push(layer);
        }
        this.onLoopAdded?.(layer);
    }

    /**
     * Stage-3 finalize-PCM. The engine captured this take's TRUE per-sample PCM
     * and shipped it across the control seam (NATIVE: the `looper_take_pcm`
     * command return; WASM: the worklet `looper-take` postMessage). Build a real
     * AudioBuffer, compute the TRUE waveform shape, and SET both on the layer the
     * matching commit edge created — in COMMIT ORDER, so the Nth PCM upgrades the
     * Nth still-unbuffered layer. If the PCM raced ahead of its edge, buffer it
     * until the row exists. With a non-null buffer the row's drag-to-library and
     * export paths light up and it renders the real shape instead of the meter
     * envelope.
     */
    onLayerPcm(pcm: Float32Array, sampleRate: number): void {
        if (!pcm || pcm.length === 0) return;
        const layer = this.layersAwaitingPcm.shift();
        if (layer) {
            this.attachPcm(layer, pcm, sampleRate);
        } else {
            // The PCM seam beat the commit edge — hold it for the next row.
            this.pcmAwaitingLayers.push({ pcm, sampleRate });
        }
    }

    /**
     * Build a real AudioBuffer from the take PCM, compute the true waveform, and
     * set both on `layer`, then notify the UI so the row swaps its live
     * meter-envelope trace for the real shape. No AudioContext (headless / not
     * yet resumed) means no AudioBuffer can be built; the buffer stays null but
     * the TRUE waveform is still set from the raw PCM so the shape is honest.
     */
    private attachPcm(layer: LoopLayer, pcm: Float32Array, sampleRate: number): void {
        // Copy into a fresh ArrayBuffer-backed view: the source may be a
        // transferred / SAB-backed buffer that `copyToChannel` rejects.
        const samples = new Float32Array(pcm.length);
        samples.set(pcm);
        const ctx = getAudioContext();
        if (ctx && typeof ctx.createBuffer === 'function') {
            const buffer = ctx.createBuffer(1, samples.length, sampleRate);
            buffer.copyToChannel(samples, 0);
            layer.buffer = buffer;
            layer.waveformData = waveformFromBuffer(buffer);
        } else {
            // No context: keep the buffer null (drag/export need a real
            // AudioBuffer) but still upgrade the waveform to the true shape.
            layer.waveformData = waveformFromPcm(samples);
        }
        this.onLoopUpdated?.(layer);
    }

    toggleLoopMute(loopId: string): void {
        const idx = this.loops.findIndex((l) => l.id === loopId);
        if (idx === -1) return;
        const loop = this.loops[idx];
        loop.isMuted = !loop.isMuted;
        // Indexed per-layer mute: SET_MUTE packs the layer index in the low 31
        // bits and the muted state in the high MUTE_FLAG bit.
        const arg = loop.isMuted ? (idx | LOOPER_MUTE_FLAG) >>> 0 : idx;
        this.action(LooperAction.SET_MUTE, arg);
    }

    deleteLoop(loopId: string): void {
        const idx = this.loops.findIndex((l) => l.id === loopId);
        if (idx === -1) return;
        const [removed] = this.loops.splice(idx, 1);
        // Drop it from the PCM-awaiting FIFO too, so a future take's PCM never
        // lands on a row that no longer exists (commit-order matching stays sound).
        this.dropAwaitingLayer(removed);
        // Indexed delete: tell the kernel to drop layer `idx`. The kernel
        // compacts its layers, so the remaining UI rows (already spliced) stay
        // aligned with kernel indices.
        this.action(LooperAction.DELETE_LAYER, idx);
        this.onLoopDeleted?.(removed);
    }

    /**
     * Undo the most-recently committed layer (LIFO). The kernel pops its last
     * layer; we drop the last UI row to match, and report it as deleted.
     */
    undoLast(): void {
        if (this.loops.length === 0) return;
        const removed = this.loops.pop()!;
        this.dropAwaitingLayer(removed);
        this.action(LooperAction.UNDO_LAST);
        this.onLoopDeleted?.(removed);
    }

    /** Remove `layer` from the PCM-awaiting FIFO if it is still queued (it was
     *  deleted/undone before its TRUE PCM arrived). */
    private dropAwaitingLayer(layer: LoopLayer): void {
        const i = this.layersAwaitingPcm.indexOf(layer);
        if (i !== -1) this.layersAwaitingPcm.splice(i, 1);
    }

    addLoopFromBuffer(buffer: AudioBuffer): void {
        const layer = makeLoopLayer(
            `oj-loop-${Date.now()}-${this.loops.length}`,
            buffer,
            waveformFromBuffer(buffer)
        );
        this.loops.push(layer);
        // Overdub the dropped buffer into the engine loop (best-effort: the PCM
        // is not transferred to the looper node across the control seam in v1, so
        // this records the layer for visuals + drives the engine into overdub so
        // subsequent live input layers on top). Marked for the buffer-transfer
        // upgrade below.
        // TODO(wasm-parity)/TODO(native-parity): transfer the dropped PCM into the
        // engine looper buffer (needs a sample->looper load seam, a later wave).
        this.action(LooperAction.OVERDUB);
        this.onLoopAdded?.(layer);
    }

    setOnLoopAdded(callback: (loop: LoopLayer) => void): void {
        this.onLoopAdded = callback;
    }

    setOnLoopDeleted(callback: (loop: LoopLayer) => void): void {
        this.onLoopDeleted = callback;
    }

    setOnWaveformHistoryUpdate(
        callback: (history: number[], playheadPosition: number) => void
    ): void {
        this.onWaveformHistory = callback;
    }

    /** Notified when an existing layer is upgraded in place (Stage 3: its TRUE
     *  captured PCM/waveform arrived after the row was created). */
    setOnLoopUpdated(callback: (loop: LoopLayer) => void): void {
        this.onLoopUpdated = callback;
    }
}

// ---------------------------------------------------------------------------
// Recorder handle
// ---------------------------------------------------------------------------

/**
 * ojcore recorder handle: starts/stops a capture of the node's output on the
 * engine side via the bridge, and surfaces the resulting WAV blob the UI can
 * download / save (identical UX to the Web Audio `Recorder`).
 */
export class OjcoreRecorderHandle implements RecorderHandle {
    private recording = false;
    private startTime = 0;
    private timer: number | null = null;
    private recordings: RecordingEntry[] = [];

    private onComplete: ((recording: RecordingEntry) => void) | null = null;
    private onDeleted: ((recording: RecordingEntry) => void) | null = null;
    private onTimeUpdate: ((time: number) => void) | null = null;

    private readonly nodeId: string;
    private readonly bridge: OjcoreBridge;

    constructor(nodeId: string, bridge: OjcoreBridge) {
        this.nodeId = nodeId;
        this.bridge = bridge;
    }

    getIsRecording(): boolean {
        return this.recording;
    }

    getRecordings(): RecordingEntry[] {
        return [...this.recordings];
    }

    startRecording(): void {
        if (this.recording) return;
        this.recording = true;
        this.startTime = Date.now();
        this.bridge.startCapture(this.nodeId);
        this.timer = window.setInterval(() => {
            if (this.recording) {
                this.onTimeUpdate?.((Date.now() - this.startTime) / 1000);
            }
        }, 100);
    }

    stopRecording(): void {
        if (!this.recording) return;
        this.recording = false;
        if (this.timer !== null) {
            clearInterval(this.timer);
            this.timer = null;
        }
        const duration = (Date.now() - this.startTime) / 1000;
        const startedAt = this.startTime;
        void this.bridge.stopCapture(this.nodeId).then((blob) => {
            const recording: RecordingEntry = {
                id: `oj-rec-${Date.now()}`,
                blob: blob ?? new Blob([], { type: 'audio/wav' }),
                duration,
                timestamp: startedAt,
                name: `Recording ${this.recordings.length + 1}`,
            };
            this.recordings.push(recording);
            this.onComplete?.(recording);
        });
    }

    downloadRecording(recordingId: string): void {
        const rec = this.recordings.find((r) => r.id === recordingId);
        if (!rec) return;
        const url = URL.createObjectURL(rec.blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${rec.name.replace(/\s+/g, '_')}.wav`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    deleteRecording(recordingId: string): void {
        const idx = this.recordings.findIndex((r) => r.id === recordingId);
        if (idx === -1) return;
        const [removed] = this.recordings.splice(idx, 1);
        this.onDeleted?.(removed);
    }

    renameRecording(recordingId: string, newName: string): void {
        const rec = this.recordings.find((r) => r.id === recordingId);
        if (rec) rec.name = newName;
    }

    getRecordingBlob(recordingId: string): Blob | null {
        return this.recordings.find((r) => r.id === recordingId)?.blob ?? null;
    }

    async saveRecordingToProject(
        recordingId: string,
        projectHandle: FileSystemDirectoryHandle
    ): Promise<{ path: string; duration: number; sampleRate: number } | null> {
        const rec = this.recordings.find((r) => r.id === recordingId);
        if (!rec) return null;
        try {
            const libraryDir = await projectHandle.getDirectoryHandle('library', { create: true });
            const ts = new Date(rec.timestamp)
                .toISOString()
                .replace(/[:.]/g, '-')
                .replace('T', '_')
                .slice(0, 19);
            const safe = rec.name.replace(/[^a-zA-Z0-9\s\-_]/g, '').replace(/\s+/g, '_') || 'Recording';
            const suffix = Math.random().toString(36).slice(2, 6);
            const filename = `${safe}_${ts}_${suffix}.wav`;
            const fileHandle = await libraryDir.getFileHandle(filename, { create: true });
            const writable = await fileHandle.createWritable();
            try {
                await writable.write(rec.blob);
                await writable.close();
            } catch (err) {
                await writable.abort().catch(() => {});
                throw err;
            }
            const ctx = getAudioContext();
            return {
                path: `library/${filename}`,
                duration: rec.duration,
                sampleRate: ctx?.sampleRate ?? 48000,
            };
        } catch (err) {
            console.error('[OjcoreRecorderHandle] save to project failed:', err);
            return null;
        }
    }

    setOnRecordingComplete(callback: (recording: RecordingEntry) => void): void {
        this.onComplete = callback;
    }

    setOnRecordingDeleted(callback: (recording: RecordingEntry) => void): void {
        this.onDeleted = callback;
    }

    setOnTimeUpdate(callback: (time: number) => void): void {
        this.onTimeUpdate = callback;
    }
}

// ---------------------------------------------------------------------------
// Sampler handle
// ---------------------------------------------------------------------------

/** Default sampler config, mirroring the Web Audio `SamplerAdapter` defaults. */
const SAMPLER_DEFAULTS = { rootNote: 60, gain: 1.0, attack: 0.01, release: 0.1 };

/**
 * Param ids on the engine `builtin.sampler` we drive via `SetParam`. The PCM
 * root-note param mirrors `ojinstrument::sampler::SAMPLER_PCM_PARAM` (16); the
 * gain/attack/release ids mirror the shared instrument envelope param ids.
 */
const SAMPLER_PARAM = {
    GAIN: 0,
    ATTACK: 1,
    RELEASE: 3,
    ROOT_NOTE: 16,
} as const;

/**
 * ojcore sampler handle: lowers a decoded buffer into the engine's
 * `builtin.sampler` (via {@link OjcoreBridge.loadSample}) and mirrors the
 * root/gain/attack/release config as `SetParam`s. `getBuffer` returns the
 * last-installed buffer so the UI's waveform render works.
 */
export class OjcoreSamplerHandle implements SamplerHandle {
    private buffer: AudioBuffer | null = null;
    private config = { ...SAMPLER_DEFAULTS };

    private readonly nodeId: string;
    private readonly bridge: OjcoreBridge;

    constructor(nodeId: string, bridge: OjcoreBridge) {
        this.nodeId = nodeId;
        this.bridge = bridge;
    }

    private setParam(param: number, value: number): void {
        const idx = this.bridge.nodeIndex(this.nodeId);
        if (idx === undefined) return;
        this.bridge.sendCommand({ SetParam: { node: idx, param, value } });
    }

    getBuffer(): AudioBuffer | null {
        return this.buffer;
    }

    setBuffer(buffer: AudioBuffer | null): void {
        this.buffer = buffer;
        if (!buffer) return;
        // Downmix to mono PCM and lower it into the engine sampler.
        const channels = buffer.numberOfChannels;
        const len = buffer.length;
        const mono = new Float32Array(len);
        for (let ch = 0; ch < channels; ch++) {
            const data = buffer.getChannelData(ch);
            for (let i = 0; i < len; i++) mono[i] += data[i] / channels;
        }
        void this.bridge.loadSample(this.nodeId, mono, buffer.sampleRate, this.config.rootNote);
    }

    setRootNote(midiNote: number): void {
        this.config.rootNote = Math.max(0, Math.min(127, midiNote));
        this.setParam(SAMPLER_PARAM.ROOT_NOTE, this.config.rootNote);
    }

    setGain(gain: number): void {
        this.config.gain = Math.max(0, Math.min(2, gain));
        this.setParam(SAMPLER_PARAM.GAIN, this.config.gain);
    }

    setAttack(attack: number): void {
        this.config.attack = Math.max(0.001, Math.min(1, attack));
        this.setParam(SAMPLER_PARAM.ATTACK, this.config.attack);
    }

    setRelease(release: number): void {
        this.config.release = Math.max(0.01, Math.min(2, release));
        this.setParam(SAMPLER_PARAM.RELEASE, this.config.release);
    }
}

// ---------------------------------------------------------------------------
// Per-executor handle registry
// ---------------------------------------------------------------------------

/**
 * Lazily creates + caches one handle of each capability per node id, so repeated
 * `getLooper(id)` / `getRecorder(id)` / `getSamplerAdapter(id)` calls from the
 * UI return the SAME stateful handle (the components rely on this to keep their
 * loop/recording lists). Shared by both ojcore executors.
 */
export class OjcoreCapabilityRegistry {
    private loopers = new Map<string, OjcoreLooperHandle>();
    private recorders = new Map<string, OjcoreRecorderHandle>();
    private samplers = new Map<string, OjcoreSamplerHandle>();

    private readonly bridge: OjcoreBridge;

    constructor(bridge: OjcoreBridge) {
        this.bridge = bridge;
    }

    looper(nodeId: string): OjcoreLooperHandle {
        let h = this.loopers.get(nodeId);
        if (!h) {
            h = new OjcoreLooperHandle(nodeId, this.bridge);
            this.loopers.set(nodeId, h);
        }
        return h;
    }

    recorder(nodeId: string): OjcoreRecorderHandle {
        let h = this.recorders.get(nodeId);
        if (!h) {
            h = new OjcoreRecorderHandle(nodeId, this.bridge);
            this.recorders.set(nodeId, h);
        }
        return h;
    }

    sampler(nodeId: string): OjcoreSamplerHandle {
        let h = this.samplers.get(nodeId);
        if (!h) {
            h = new OjcoreSamplerHandle(nodeId, this.bridge);
            this.samplers.set(nodeId, h);
        }
        return h;
    }

    /** Drop every cached handle (on dispose). */
    clear(): void {
        this.loopers.clear();
        this.recorders.clear();
        this.samplers.clear();
    }
}

/** Encode mono f32 PCM as a 32-bit-float WAV blob (for recorder export paths). */
export function monoPcmToWavBlob(pcm: Float32Array, sampleRate: number): Blob {
    // Copy into a fresh ArrayBuffer-backed view (the source may be transferred /
    // SAB-backed, which `copyToChannel` / `Blob` reject).
    const samples = new Float32Array(pcm.length);
    samples.set(pcm);
    const ctx = getAudioContext();
    if (ctx) {
        const buf = ctx.createBuffer(1, samples.length, sampleRate);
        buf.copyToChannel(samples, 0);
        return audioBufferToWAV(buf);
    }
    return new Blob([samples.buffer], { type: 'audio/wav' });
}
