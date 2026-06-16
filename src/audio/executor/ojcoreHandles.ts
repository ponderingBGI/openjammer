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
import { LooperAction } from '../../../packages/oj-protocol-ts/src/index';
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
/** ms between synthetic live-waveform-history ticks while recording. */
const WAVEFORM_TICK_MS = 50;

/**
 * Generate a deterministic, decaying-pulse waveform shape for visualization when
 * the real engine loop buffer is not readable back across the control seam.
 * Purely cosmetic — the audible loop is engine-rendered.
 */
function syntheticWaveform(points: number, seed: number): number[] {
    const out: number[] = new Array(points);
    let s = seed || 1;
    for (let i = 0; i < points; i++) {
        // xorshift-ish deterministic pseudo-random in [0,1)
        s ^= s << 13;
        s ^= s >>> 17;
        s ^= s << 5;
        const r = ((s >>> 0) % 1000) / 1000;
        out[i] = 0.15 + r * 0.7;
    }
    return out;
}

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

/** Build a waveform array from a real AudioBuffer (peak per segment). */
function waveformFromBuffer(buffer: AudioBuffer, points = LOOP_WAVEFORM_POINTS): number[] {
    const data = buffer.getChannelData(0);
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

/**
 * ojcore loop handle: forwards record/stop/overdub/clear to the engine looper
 * node as `RtCommand::Looper` actions (the REAL audio path), and mirrors the
 * loop-layer list + live waveform the UI displays.
 */
export class OjcoreLooperHandle implements LooperHandle {
    private duration = 10;
    private recording = false;
    private loops: LoopLayer[] = [];
    private tickId: number | null = null;
    private liveHistory: number[] = [];
    private cycleStart = 0;

    private onLoopAdded: ((loop: LoopLayer) => void) | null = null;
    private onLoopDeleted: ((loop: LoopLayer) => void) | null = null;
    private onWaveformHistory:
        | ((history: number[], playheadPosition: number) => void)
        | null = null;

    private readonly nodeId: string;
    private readonly bridge: OjcoreBridge;

    constructor(nodeId: string, bridge: OjcoreBridge) {
        this.nodeId = nodeId;
        this.bridge = bridge;
    }

    /** Send a `RtCommand::Looper` action to this node, if it is in the graph. */
    private action(action: LooperAction): void {
        const idx = this.bridge.nodeIndex(this.nodeId);
        if (idx === undefined) return;
        this.bridge.sendCommand({ Looper: { node: idx, action } });
    }

    setDuration(duration: number): void {
        this.duration = duration;
    }

    getLoops(): LoopLayer[] {
        return this.loops;
    }

    startRecording(): Promise<void> {
        if (this.recording) return Promise.resolve();
        this.recording = true;
        this.cycleStart = performance.now();
        this.liveHistory = [];
        // Drive the engine looper: arm + record.
        this.action(LooperAction.ARM);
        this.action(LooperAction.RECORD);
        this.startTick();
        return Promise.resolve();
    }

    stopRecording(): void {
        if (!this.recording) return;
        this.recording = false;
        this.stopTick();
        this.action(LooperAction.STOP);
        // The engine is now playing the captured loop. Mirror a loop layer so
        // the UI shows it (waveform synthesized; engine buffer is not read back).
        const id = `oj-loop-${Date.now()}`;
        const waveformData =
            this.liveHistory.length > 1
                ? this.liveHistory.slice(0, LOOP_WAVEFORM_POINTS)
                : syntheticWaveform(LOOP_WAVEFORM_POINTS, this.loops.length + 1);
        const layer = makeLoopLayer(id, null, waveformData);
        this.loops.push(layer);
        this.onLoopAdded?.(layer);
    }

    toggleLoopMute(loopId: string): void {
        const loop = this.loops.find((l) => l.id === loopId);
        if (!loop) return;
        loop.isMuted = !loop.isMuted;
        // v1: a single engine looper has no per-layer mute; muting the last
        // (active) layer stops the engine loop, unmuting plays it again.
        const anyAudible = this.loops.some((l) => !l.isMuted);
        this.action(anyAudible ? LooperAction.PLAY : LooperAction.STOP);
    }

    deleteLoop(loopId: string): void {
        const idx = this.loops.findIndex((l) => l.id === loopId);
        if (idx === -1) return;
        const [removed] = this.loops.splice(idx, 1);
        if (this.loops.length === 0) {
            // No layers left: clear the engine loop buffer back to silence.
            this.action(LooperAction.CLEAR);
        }
        this.onLoopDeleted?.(removed);
    }

    addLoopFromBuffer(buffer: AudioBuffer): void {
        const layer = makeLoopLayer(`oj-loop-${Date.now()}`, buffer, waveformFromBuffer(buffer));
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

    /** Drive a cosmetic live-waveform/playhead while the engine records. */
    private startTick(): void {
        if (this.tickId !== null) return;
        const tick = () => {
            if (!this.recording) return;
            const elapsed = (performance.now() - this.cycleStart) / 1000;
            const level = 0.2 + Math.abs(Math.sin(elapsed * 6)) * 0.6;
            this.liveHistory.push(level);
            if (this.liveHistory.length > LOOP_WAVEFORM_POINTS * 4) {
                this.liveHistory.shift();
            }
            const playhead = isInfiniteDuration(this.duration)
                ? 0
                : ((elapsed % this.duration) / this.duration) * 100;
            this.onWaveformHistory?.(this.liveHistory.slice(), playhead);
            this.tickId = window.setTimeout(tick, WAVEFORM_TICK_MS);
        };
        this.tickId = window.setTimeout(tick, WAVEFORM_TICK_MS);
    }

    private stopTick(): void {
        if (this.tickId !== null) {
            clearTimeout(this.tickId);
            this.tickId = null;
        }
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
