/**
 * OjcoreNativeExecutor (U17) — the native, low-latency audio path.
 *
 * Latency honesty: on Windows over WASAPI-shared (the default cpal path) this is
 * realistically ~10 ms+, NOT sub-5 ms. True sub-5 ms needs WASAPI-exclusive or
 * ASIO, which OpenJammer does not yet route — so we never advertise the native
 * tier as sub-5 ms. (The audio health dot tooltip carries the same honest tier.)
 *
 * When OpenJammer runs inside the Tauri desktop shell, audio is rendered by the
 * native Rust `ojcore` engine on a small-buffer cpal stream (the founder's MOTU
 * M4), NOT by Web Audio. This executor is the control-plane bridge: it lowers the
 * visual graph to an `OjGraph` and `invoke('push_graph')`s it, and turns the
 * note/param/transport seam into `RtCommand`s sent via `invoke('send_command')`.
 * No audio buffer ever crosses the IPC boundary — only control-rate JSON
 * (governing principle #4), matching `src-tauri/src/engine.rs`.
 *
 * IPC. Tauri v2 exposes `invoke` either as the `@tauri-apps/api` module or, when
 * `app.withGlobalTauri` is enabled, as `window.__TAURI__.core.invoke`. To avoid
 * adding a build dependency (and because `@tauri-apps/api` is not installed), we
 * use the GLOBAL bridge. If it is absent (i.e. not actually under Tauri, or the
 * global bridge is disabled) every call degrades to a logged no-op so the app
 * never breaks — selection only routes here when Tauri is detected.
 *
 * ── FOUNDER SETUP (one-time, outside this lane) ──────────────────────────────
 * Enable the global IPC bridge so this executor can reach `invoke` without the
 * `@tauri-apps/api` package: in `src-tauri/tauri.conf.json` set
 *   "app": { "withGlobalTauri": true, ... }
 * Alternatively, `bun add @tauri-apps/api` and swap {@link nativeInvoke} to
 * `import { invoke } from '@tauri-apps/api/core'`.
 */

import type { Connection, GraphNode } from '../../engine/types';
import { DESKTOP_CAPABILITIES, type EngineCapabilities } from '../../engine/capabilities';
import type {
    Executor,
    ConnectionChangeCallback,
    NodeChangeCallback,
    Unsubscribe,
    LooperHandle,
    RecorderHandle,
    SamplerHandle,
    SignalLevelsCallback,
} from './Executor';
import { emitWithIndex, remapForBackend, type NodeIdxMap } from '../ojgraph';
import { resolveKeyboardNotes } from '../ojgraph';
import {
    DEFAULT_VOICE_INSTRUMENTS,
    getVoiceForInstrumentNode,
    instrumentUsesKarplus,
} from '../defaultInstrument';
import type {
    NodeIdx,
    OjGraph,
    RtCommand,
    EngineFrame,
    Event as EngineEvent,
} from '../../../packages/oj-protocol-ts/src/index';
import {
    OjcoreCapabilityRegistry,
    monoPcmToWavBlob,
    type OjcoreBridge,
} from './ojcoreHandles';
import { classifyLatency, type LatencyReport } from './latency';
import { logger } from '../../utils/log';
import { setEngineHealth, useEngineHealthStore } from '../../store/engineHealthStore';
import { ingestEngineEvents } from './faultPipe';

// Re-exported for back-compat: `coalesceEvents` moved to the shared `faultPipe`
// seam (Wave 4) so both executor tiers share one fault path. Existing importers
// (and tests) that reach for it here still resolve.
export { coalesceEvents } from './faultPipe';

/** Minimal shape of the Tauri global IPC bridge (`withGlobalTauri`). */
interface TauriGlobal {
    core?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
    invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
}

/** Resolve the Tauri `invoke` function from the global bridge, if present. */
function getInvoke(): ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null {
    if (typeof window === 'undefined') return null;
    const t = (window as unknown as { __TAURI__?: TauriGlobal }).__TAURI__;
    if (!t) return null;
    if (t.core?.invoke) return t.core.invoke.bind(t.core);
    if (t.invoke) return t.invoke.bind(t);
    return null;
}

/** How often (ms) to poll the engine for fresh per-node meter levels. */
const METER_POLL_MS = 50;

/**
 * How often (ms) to drain the engine's fault-event ring. SEPARATE from the meter
 * poll on purpose: meters early-return when no signal-level UI is mounted, but a
 * fault must be drained whether or not any meter is on screen — folding the two
 * would silently never surface a dropout during a set with no meter open. A
 * fault that lands one block late at 100 ms cadence is still "instant" to a human
 * ear; it does not need the 50 ms meter rate, and a slower tick keeps the ring
 * drained without churning React.
 */
const EVENT_POLL_MS = 100;

/** Scope-bound DevLog logger for this executor (routes through the L4 facade). */
const log = logger('native');

/** True when running inside a Tauri webview (the native desktop shell). */
export function isTauri(): boolean {
    if (typeof window === 'undefined') return false;
    return Boolean((window as unknown as { __TAURI__?: unknown }).__TAURI__);
}

/**
 * Drives audio via the native Tauri ojcore engine. Every {@link Executor} method
 * is now backed for REAL: notes/params/looper become `RtCommand`s; meters arrive
 * as a `meters` Tauri event stream from the engine's return ring; the looper /
 * recorder / sampler handles ({@link OjcoreCapabilityRegistry}) drive the engine
 * over NEW Tauri commands (`looper_cmd` / `load_sample` / `recorder_start` /
 * `recorder_stop` / `set_speaker_volume` / `set_speaker_device` / `set_mic` /
 * `subscribe_meters`). Capabilities never return null — the app's looper /
 * recorder / sampler / metering UI works on the native path.
 */
export class OjcoreNativeExecutor implements Executor {
    private invoke = getInvoke();
    private getNodes: (() => Map<string, GraphNode>) | null = null;
    private getConnections: (() => Map<string, Connection>) | null = null;
    private unsub: Unsubscribe | null = null;
    /** Last emitted GraphNode-id -> NodeIdx interning, for RtCommand addressing. */
    private index: NodeIdxMap = new Map();
    /** Reverse map NodeIdx -> visual node id, for routing meter frames back. */
    private reverseIndex = new Map<number, string>();
    /** Which built-in voice (family key) is currently bound per instrument node,
     *  so the picker selection re-binds but a plain re-push does not. */
    private boundVoiceKey = new Map<string, string>();
    private signalCallbacks = new Set<SignalLevelsCallback>();
    /** Latest per-node levels, keyed by visual node id (for meter delivery). */
    private levels = new Map<string, number>();
    /** Interval id for the meter poll loop (engine -> UI level stream). */
    private meterPollId: number | null = null;
    /** Interval id for the DEDICATED, unconditional fault-event drain loop. Its
     *  own timer so it drains regardless of whether any meter UI is mounted. */
    private eventPollId: number | null = null;
    /** Serialized last-pushed OjGraph, to skip redundant `push_graph` IPC when a
     *  store notification fires but the audio graph is unchanged (dedupe). */
    private lastPushedGraph: string | null = null;
    /** Latest engine loop length (samples) per looper NodeIdx, cached from the
     *  drained `Looper` frames. On a commit edge we pass it to `looper_take_pcm`
     *  so the streamed capture is trimmed to the committed cycle (Stage 3). */
    private looperLoopLen = new Map<number, number>();

    /** The engine-side seam the capability handles drive (native impl). */
    private readonly bridge: OjcoreBridge = {
        nodeIndex: (nodeId) => this.index.get(nodeId),
        sendCommand: (cmd) => this.send(cmd),
        nodeLevel: (nodeId) => this.levels.get(nodeId) ?? 0,
        loadSample: (nodeId, pcm, sampleRate, rootNote) =>
            this.loadSampleNative(nodeId, pcm, sampleRate, rootNote),
        startCapture: (nodeId) => this.recorderStartNative(nodeId),
        stopCapture: (nodeId) => this.recorderStopNative(nodeId),
    };

    private readonly caps = new OjcoreCapabilityRegistry(this.bridge);

    // --- Lifecycle ---------------------------------------------------------

    initialize(
        subscribeToConnections: (callback: ConnectionChangeCallback) => Unsubscribe,
        subscribeToNodes: (callback: NodeChangeCallback) => Unsubscribe,
        getNodes: () => Map<string, GraphNode>,
        getConnections: () => Map<string, Connection>,
    ): void {
        this.getNodes = getNodes;
        this.getConnections = getConnections;

        if (!this.invoke) {
            // We were selected as the NATIVE executor (Tauri was detected) yet the
            // global IPC bridge is missing — the engine cannot make sound. Surface
            // DEAD (not a lone console.warn) so the fault is visible, calmly.
            log.error(
                'Tauri global IPC bridge not found (set app.withGlobalTauri=true ' +
                    'in tauri.conf.json). Native audio disabled.',
            );
            setEngineHealth('DEAD', 'native IPC bridge unavailable');
        }

        const unsubNodes = subscribeToNodes(() => this.pushGraph());
        const unsubConns = subscribeToConnections(() => this.pushGraph());
        this.unsub = () => {
            unsubNodes();
            unsubConns();
        };

        // Initial reconcile.
        this.pushGraph();

        // Begin the engine -> UI meter event stream (no-op without Tauri).
        this.startMeterStream();
        // Begin the dedicated fault-event drain (its OWN cadence; see startEventDrain).
        this.startEventDrain();
    }

    /** The native (Tauri) capability row — the flagship. */
    getCapabilities(): EngineCapabilities {
        return DESKTOP_CAPABILITIES;
    }

    /**
     * Latency of the native backend: the cpal stream's negotiated buffering floor
     * over the `query_stream` IPC (`engine::StreamInfo`). THIS — not the WebView2
     * decode AudioContext — is what the MOTU is actually playing through, so it is
     * the only honest native number. `StreamInfo` serializes with serde's default
     * snake_case keys. Resolves `null` off the native tier or if the engine is not
     * up yet, so the UI simply shows no reading rather than a wrong one.
     */
    async getLatency(): Promise<LatencyReport | null> {
        const invoke = getInvoke();
        if (!invoke) return null;
        try {
            const s = (await invoke('query_stream')) as {
                running: boolean;
                sample_rate: number;
                channels: number;
                buffer_frames: number | null;
                latency_ms: number;
            };
            return {
                source: 'native',
                running: s.running,
                baseLatency: 0,
                outputLatency: s.latency_ms,
                roundTripMs: s.latency_ms,
                sampleRate: s.sample_rate,
                bufferFrames: s.buffer_frames ?? null,
                classification: classifyLatency(s.latency_ms),
                isBluetoothSuspected: false,
            };
        } catch {
            // IPC unavailable / engine down — no reading beats a wrong one.
            return null;
        }
    }

    dispose(): void {
        this.unsub?.();
        this.unsub = null;
        if (this.meterPollId !== null) {
            clearInterval(this.meterPollId);
            this.meterPollId = null;
        }
        if (this.eventPollId !== null) {
            clearInterval(this.eventPollId);
            this.eventPollId = null;
        }
        this.signalCallbacks.clear();
        this.levels.clear();
        this.looperLoopLen.clear();
        this.caps.clear();
        this.getNodes = null;
        this.getConnections = null;
        this.index = new Map();
        this.reverseIndex = new Map();
        // Forget which default voices were bound: a re-initialize starts a fresh
        // engine with NO assets, so a stale key would make `loadDefaultInstrumentVoices`
        // skip the (now-needed) re-bind and leave melodic nodes silent.
        this.boundVoiceKey.clear();
        // Reset the dedupe cache so a re-initialize re-pushes the graph.
        this.lastPushedGraph = null;
    }

    /** Enable engine metering and poll the meter return ring, fanning per-node
     *  levels out to signal-level subscribers, keyed by visual node id.
     *  Idempotent (a single poll loop). */
    private startMeterStream(): void {
        if (!this.invoke || this.meterPollId !== null) return;
        // Ask the backend to enable metering (zero-cost while no graph runs).
        this.invoke('subscribe_meters', {}).catch((err: unknown) => {
            log.error('subscribe_meters failed', { detail: String(err) });
        });
        this.meterPollId = window.setInterval(() => {
            void this.pollMeters();
        }, METER_POLL_MS);
    }

    /**
     * Poll the engine for the latest return frames. The drain is UNCONDITIONAL —
     * the single meter ring now carries both `Meter` AND `Looper` frames (one
     * consumer decodes all tags, see engine.rs drain_meters), and a looper's
     * transport frames must reach its handle whether or not a signal-level meter
     * is mounted. So we always drain, route every `Looper` frame to its handle,
     * and only fan `Meter` levels out when a signal subscriber actually exists.
     */
    private async pollMeters(): Promise<void> {
        if (!this.invoke) return;
        let frames: EngineFrame[];
        try {
            frames = (await this.invoke('poll_meters', {})) as EngineFrame[];
        } catch {
            return; // transient; next tick retries
        }
        if (!Array.isArray(frames) || frames.length === 0) return;
        const haveSignalSubs = this.signalCallbacks.size > 0;
        let changed = false;
        for (const frame of frames) {
            if (!frame || typeof frame !== 'object') continue;
            if ('Looper' in frame) {
                // Looper transport snapshot — ALWAYS routed (ungated by metering).
                const { node, state, pos, loop_len, peak } = (
                    frame as {
                        Looper: {
                            node: NodeIdx;
                            state: number;
                            pos: number;
                            loop_len: number;
                            peak: number;
                        };
                    }
                ).Looper;
                const nodeId = this.reverseIndex.get(node);
                if (nodeId === undefined) continue;
                // Cache the loop length per NodeIdx so a commit edge can trim the
                // streamed capture to the committed cycle (Stage 3 take PCM).
                if (loop_len > 0) this.looperLoopLen.set(node, loop_len);
                this.caps.looper(nodeId).onEngineFrame(state, pos, loop_len, peak);
                continue;
            }
            if (haveSignalSubs && 'Meter' in frame) {
                const { node, peak } = (
                    frame as { Meter: { node: NodeIdx; rms: number; peak: number } }
                ).Meter;
                const nodeId = this.reverseIndex.get(node);
                if (nodeId === undefined) continue;
                this.levels.set(nodeId, Math.max(0, Math.min(1, peak)));
                changed = true;
            }
        }
        if (changed) {
            const snapshot = new Map(this.levels);
            for (const cb of this.signalCallbacks) cb(snapshot);
        }
    }

    // --- Fault-event drain -------------------------------------------------
    // A DEDICATED, unconditional loop — NOT folded into the meter poll above,
    // which early-returns when no signal-level subscriber is mounted. A fault
    // must reach the DevLog whether or not a meter is on screen, so this drain
    // runs on its own cadence and only ever stops on `dispose()`.

    /** Begin draining the engine's fault-event ring on a fixed cadence.
     *  Idempotent (a single loop); self-disables (no spam) without Tauri. */
    private startEventDrain(): void {
        if (this.eventPollId !== null) return;
        this.eventPollId = window.setInterval(() => {
            void this.pollEvents();
        }, EVENT_POLL_MS);
    }

    /**
     * Drain pending engine fault events, COALESCE repeated Xrun/NodeFault, and
     * ingest the result into the DevLog ring. Coalescing happens at the drain,
     * BEFORE ingest, because a faulting node emits a NodeFault EVERY block: an
     * unfiltered firehose would evict real history from the 5000-cap ring (and
     * jank React) during the exact dropout we need to diagnose.
     *
     * Self-disabling: when the IPC bridge is absent the drain is a quiet no-op
     * (no console spam every tick) — the DEAD state was already surfaced at
     * `initialize`.
     */
    private async pollEvents(): Promise<void> {
        if (!this.invoke) return;
        let events: EngineEvent[];
        try {
            events = (await this.invoke('poll_events', {})) as EngineEvent[];
        } catch {
            return; // transient; next tick retries
        }
        if (!Array.isArray(events) || events.length === 0) return;
        // Tap the loss-proof event stream for LooperEdge transitions BEFORE the
        // fault sink: the event ring is the AUTHORITATIVE commit signal (a cycle
        // wrap / STOP), so a RECORDING|OVERDUBBING -> PLAYING edge must reach the
        // looper handle to create its row. Routing here (not in the fault pipe)
        // keeps the fault path tag-agnostic — LooperEdge is not a fault.
        this.routeLooperEdges(events);
        // The ONE shared fault sink (coalesce -> ingest -> health), identical for
        // the wasm tier — see `faultPipe.ts`. No second owner of the fault path.
        ingestEngineEvents(events);
    }

    /** ojcore `LooperState` codes mirrored for the commit-edge filter (kept in
     *  sync with the protocol enum the wasm worklet also hard-codes). */
    private static readonly LOOPER_RECORDING = 2;
    private static readonly LOOPER_PLAYING = 3;
    private static readonly LOOPER_OVERDUBBING = 4;

    /** Route any `LooperEdge` events in a drained batch to their looper handle's
     *  `onEngineEdge`. Shared shape with the wasm tier (which taps the same edge
     *  off its `events` postMessage). On a COMMIT edge (Recording|Overdubbing ->
     *  Playing) ALSO pull the just-committed take's TRUE PCM off-RT via the
     *  `looper_take_pcm` command return (Stage 3) and hand it to the handle's
     *  `onLayerPcm`, so the row gains a real AudioBuffer + true waveform. */
    private routeLooperEdges(events: EngineEvent[]): void {
        for (const ev of events) {
            const kind = ev?.kind;
            if (typeof kind !== 'object' || !('LooperEdge' in kind)) continue;
            const { node, from, to } = kind.LooperEdge;
            const nodeId = this.reverseIndex.get(node);
            if (nodeId === undefined) continue;
            this.caps.looper(nodeId).onEngineEdge(from, to);
            const committed =
                to === OjcoreNativeExecutor.LOOPER_PLAYING &&
                (from === OjcoreNativeExecutor.LOOPER_RECORDING ||
                    from === OjcoreNativeExecutor.LOOPER_OVERDUBBING);
            if (committed) void this.fetchLooperTake(node, nodeId);
        }
    }

    /**
     * Pull the just-committed take's TRUE captured PCM for `node` off the engine
     * via the `looper_take_pcm` command (the PCM rides the command RETURN, like
     * `recorder_stop` — NOT an EngineFrame, so no new wire shape). The off-RT
     * per-looper buffer keeps only the LATEST take per node (the take clears it),
     * so this must be called promptly on the commit edge. Best-effort: a null
     * result (device-less sandbox / nothing captured) simply leaves the row on
     * its meter-envelope waveform with a null buffer. The committed-cycle length
     * (cached from the drained frames) trims the streamed capture to one cycle.
     */
    private async fetchLooperTake(node: NodeIdx, nodeId: string): Promise<void> {
        if (!this.invoke) return;
        const loopLen = this.looperLoopLen.get(node) ?? 0;
        try {
            const res = (await this.invoke('looper_take_pcm', {
                node,
                loopLen,
            })) as { pcm: number[]; sample_rate: number } | null;
            if (!res || !res.pcm || res.pcm.length === 0) return;
            this.caps.looper(nodeId).onLayerPcm(Float32Array.from(res.pcm), res.sample_rate);
        } catch (err) {
            log.warn('looper_take_pcm failed', { detail: String(err) });
        }
    }

    /** Tell the engine to discard a looper's pending captured take (Stage 3) on a
     *  CLEAR / undo / delete-before-commit, so a later take never inherits a stale
     *  tail. Best-effort fire-and-forget. */
    private discardLooperTake(node: NodeIdx): void {
        if (!this.invoke) return;
        this.invoke('looper_discard_pcm', { node }).catch((err: unknown) => {
            log.warn('looper_discard_pcm failed', { detail: String(err) });
        });
    }

    /** Emit + remap + push the current graph to the native engine. */
    private pushGraph(): void {
        if (!this.getNodes || !this.getConnections) return;
        // The native engine registers a WasmHost loader per AI-authored faust node
        // (author_faust_native), so lower compiled code nodes to their real WasmHost
        // manifest — they play the actual DSP instead of the effect fallback.
        const { graph, index } = emitWithIndex(this.getNodes(), this.getConnections(), {
            codeNodesAsWasmHost: true,
        });
        // Build the next NodeIdx interning + reverse (NodeIdx -> visual id) maps as
        // LOCALS — they are committed to `this.index`/`this.reverseIndex` only once
        // the engine ACCEPTS this graph (see sendGraph). Committing them here, before
        // the IPC is accepted, would point meter-frame routing (`reverseIndex.get`)
        // and RtCommand addressing (`index.get`) at a graph the engine never adopted
        // when the push is rejected.
        const nextReverseIndex = new Map<number, string>();
        for (const [id, idx] of index) nextReverseIndex.set(idx, id);
        const native = remapForBackend(graph, 'native');
        // Dedupe: a store notification can fire without the audio graph actually
        // changing (or the same graph can be re-emitted by a re-render). The
        // OjGraph is the audio IR (no canvas positions), so a byte-identical emit
        // means "nothing to push" — skip the IPC entirely. This keeps a noisy
        // subscriber (or a render loop) from hammering the native engine.
        const serialized = JSON.stringify(native);
        if (serialized === this.lastPushedGraph) {
            // The audio IR is unchanged, but an instrument PICKER change does not
            // alter the emitted graph (the default voice is bound out-of-band via
            // load_sample, not as graph data), so a deduped push would otherwise
            // skip the voice swap and every instrument in a family would keep one
            // sound. Reconcile default voices against the current node data here,
            // off the IPC: it re-binds only when a node's selection actually changed
            // (boundVoiceKey miss) and is a cheap no-op otherwise.
            this.loadDefaultInstrumentVoices();
            return;
        }
        // Remember the prior accepted graph so a REJECTED push can roll the dedupe
        // cache back — keeping the last good audio AND letting the next store
        // notification re-attempt instead of being deduped away (held-note rule).
        const prev = this.lastPushedGraph;
        this.lastPushedGraph = serialized;
        void this.sendGraph(native, prev, serialized, index, nextReverseIndex);
    }

    private async sendGraph(
        graph: OjGraph,
        prevSerialized: string | null,
        attemptedSerialized: string,
        nextIndex: NodeIdxMap,
        nextReverseIndex: Map<number, string>,
    ): Promise<void> {
        if (!this.invoke) return;
        try {
            await this.invoke('push_graph', { graph });
        } catch (err) {
            // HELD NOTE BEATS A GLITCH: a rejected push (Compile / RingFull) does
            // NOT tear down the prior graph — the engine keeps the last good
            // program running (see engine.rs adopt(): it only swaps on success).
            // STALE-FAILURE GUARD: pushes are fire-and-forget, so an older push can
            // reject AFTER a newer one was already accepted. Only roll the dedupe
            // cache back / flip health if THIS push is still the current one
            // (`lastPushedGraph` hasn't moved on) — otherwise a stale rejection would
            // clobber the newer graph's cache and report DEGRADED on old news.
            if (this.lastPushedGraph === attemptedSerialized) {
                this.lastPushedGraph = prevSerialized;
                log.warn('push_graph rejected; keeping last good audio', { detail: String(err) });
                setEngineHealth('DEGRADED', 'graph rejected; last good sound held');
            } else {
                log.warn('stale push_graph rejected; superseded by a newer graph', {
                    detail: String(err),
                });
            }
            return;
        }
        // The push was ACCEPTED: only now is the new interning the engine's truth, so
        // commit the locals computed in pushGraph. Routing (`reverseIndex.get` for
        // meter frames) and RtCommand addressing (`index.get`) move to the graph the
        // engine actually adopted — on rejection above we touched neither, so they
        // stay pointed at the last good graph (held-note rule).
        this.index = nextIndex;
        this.reverseIndex = nextReverseIndex;
        // A graph is live and the engine accepted it, so the executor has observed
        // real recovery. Lift IDLE or DEGRADED to LIVE (the positive state
        // crash-recovery waits for); keep DEAD sticky unless a caller performs a
        // stronger explicit recovery.
        const health = useEngineHealthStore.getState().health;
        if (health === 'IDLE' || health === 'DEGRADED') {
            setEngineHealth('LIVE', 'engine active');
        }
        // Install the built-in default voice for instrument nodes that ship one,
        // so a freshly-wired Keys/Piano/… node has PCM to play (an empty
        // builtin.sampler is silent — the note routes but there is nothing to
        // sound). The ENGINE now forward-merges a bound sample across pushes
        // (engine.rs push_graph: single-owner persistence), so a plain re-push no
        // longer drops the binding and `boundVoiceKey` keeps this to a no-op unless
        // the instrument's voice family actually changed. We are NOT a second owner
        // of sample persistence — this only seeds/changes the DEFAULT voice.
        this.loadDefaultInstrumentVoices();
    }

    /** (Re)lower the built-in default voice into every instrument node that needs
     *  one, so melodic instruments are playable without a user-loaded sample.
     *  Idempotent per push; the engine sampler SR-corrects + pitches the single
     *  tone across the keyboard. A user-bound sample later simply replaces it. */
    private loadDefaultInstrumentVoices(): void {
        if (!this.invoke || !this.getNodes) return;
        for (const node of this.getNodes().values()) {
            if (!DEFAULT_VOICE_INSTRUMENTS.has(node.type)) continue;
            if (this.index.get(node.id) === undefined) continue;
            // Karplus-routed plucked strings are note-triggered; they need no PCM.
            // FORGET this node's bound voice when it leaves the sampler path: the
            // engine forward-merges a sample binding only Sampler->Sampler
            // (engine.rs forward_merge_sample_bindings), so on the way BACK to a
            // sampler instrument the asset is dropped — and a stale `boundVoiceKey`
            // would suppress the re-bind, leaving the node silent until reload.
            // Clearing it here makes any return re-bind the default voice, so a
            // picker switch (even one that passes through a Karplus instrument like
            // Harpsichord/Clavinet) never goes mute.
            if (instrumentUsesKarplus(node.type, node.data as Record<string, unknown> | undefined)) {
                this.boundVoiceKey.delete(node.id);
                continue;
            }
            const { voice, key } = getVoiceForInstrumentNode(
                node.type,
                node.data as Record<string, unknown> | undefined,
            );
            // Re-send only when the instrument selection changed, so changing the
            // picker re-binds but a plain re-push does not.
            if (this.boundVoiceKey.get(node.id) === key) continue;
            this.boundVoiceKey.set(node.id, key);
            void this.loadSampleNative(node.id, voice.pcm, voice.sampleRate, voice.rootNote);
        }
    }

    private send(cmd: RtCommand): void {
        if (!this.invoke) return;
        // Stage 3: a looper CLEAR aborts any in-flight take, so also discard the
        // off-RT captured PCM for that node — otherwise a later take could inherit
        // a stale tail. (Committed-layer delete/undo operate on layers whose PCM
        // is already in the UI; only the in-flight capture buffer needs clearing.)
        if (typeof cmd === 'object' && cmd !== null && 'Looper' in cmd) {
            const { node, action } = cmd.Looper;
            if (action === 4 /* CLEAR */) this.discardLooperTake(node as NodeIdx);
        }
        this.invoke('send_command', { cmd }).catch((err: unknown) => {
            log.error('send_command failed', { detail: String(err) });
        });
    }

    // --- Note / control input ---------------------------------------------

    noteOn(keyboardId: string, row: number, keyIndex: number, velocity: number = 0.8): void {
        if (!this.getNodes || !this.getConnections) return;
        const notes = resolveKeyboardNotes(
            keyboardId,
            row,
            keyIndex,
            velocity,
            this.getNodes(),
            this.getConnections(),
        );
        for (const n of notes) {
            const idx = this.index.get(n.targetNodeId);
            if (idx === undefined) continue;
            this.send({
                NoteOn: { node: idx, note: n.midiNote, vel: Math.round(n.velocity * 127) },
            });
        }
    }

    noteOff(keyboardId: string, row: number, keyIndex: number): void {
        if (!this.getNodes || !this.getConnections) return;
        const notes = resolveKeyboardNotes(
            keyboardId,
            row,
            keyIndex,
            1,
            this.getNodes(),
            this.getConnections(),
        );
        for (const n of notes) {
            const idx = this.index.get(n.targetNodeId);
            if (idx === undefined) continue;
            this.send({ NoteOff: { node: idx, note: n.midiNote } });
        }
    }

    // Sustain pedal: no dedicated RtCommand yet (CC handled engine-side later).
    controlDown(_keyboardId: string): void {}
    controlUp(_keyboardId: string): void {}

    // Control-signal VISUALIZATION is a UI affordance; the native path drives no
    // Web Audio analyser, so flashes are emitted as 1/0 levels to subscribers.
    activateControlSignal(connectionId: string): void {
        this.emitSignal(connectionId, 1);
    }
    releaseControlSignal(connectionId: string): void {
        this.emitSignal(connectionId, 0);
    }

    private emitSignal(connectionId: string, level: number): void {
        // Persist the cable pulse into the SHARED level map (connection ids and the
        // node-meter ids the poll writes are disjoint key spaces) and emit a MERGED
        // snapshot. NodeCanvas replaces its whole map per emit, so a single-entry
        // emit here was clobbered by the very next `pollMeters` snapshot a frame
        // later — the "glow dies while the key is held" bug. Mirrors
        // OjcoreWasmExecutor.emitSignal so both backends behave identically.
        this.levels.set(connectionId, level);
        if (this.signalCallbacks.size === 0) return;
        const snapshot = new Map(this.levels);
        for (const cb of this.signalCallbacks) cb(snapshot);
    }

    // --- Speaker output ----------------------------------------------------
    // The native master is the host SpeakerOut; volume/device are control-rate
    // host concerns surfaced via dedicated Tauri commands (the engine SpeakerOut
    // node is unparameterized, so this routes around it).
    setSpeakerVolume(nodeId: string, volume: number, isMuted: boolean): void {
        if (!this.invoke) return;
        const node = this.index.get(nodeId);
        if (node === undefined) return;
        this.invoke('set_speaker_volume', {
            node,
            volume: isMuted ? 0 : volume,
            muted: isMuted,
        }).catch((err: unknown) => {
            log.error('set_speaker_volume failed', { detail: String(err) });
        });
    }
    setSpeakerDevice(nodeId: string, deviceId: string): void {
        if (!this.invoke) return;
        const node = this.index.get(nodeId);
        if (node === undefined) return;
        this.invoke('set_speaker_device', { node, deviceId }).catch((err: unknown) => {
            log.error('set_speaker_device failed', { detail: String(err) });
        });
    }

    // --- Signal level metering --------------------------------------------

    subscribeSignalLevels(callback: SignalLevelsCallback): Unsubscribe {
        this.signalCallbacks.add(callback);
        // Ensure the engine -> UI meter stream is running for new subscribers.
        this.startMeterStream();
        // Deliver the latest snapshot immediately.
        callback(new Map(this.levels));
        return () => {
            this.signalCallbacks.delete(callback);
        };
    }

    // --- Microphone --------------------------------------------------------
    // Native mic capture is an engine duplex-input concern: the `set_mic` command
    // tells the backend which graph node should receive the mic bus. The
    // Web-Audio `outputNode` has no meaning natively (the engine owns routing),
    // so only the node id crosses the seam.
    setMicrophoneOutput(nodeId: string, _outputNode: AudioNode): void {
        if (!this.invoke) return;
        const node = this.index.get(nodeId);
        if (node === undefined) return;
        this.invoke('set_mic', { node, enabled: true }).catch((err: unknown) => {
            log.error('set_mic failed', { detail: String(err) });
        });
    }

    // --- Continuous sources ------------------------------------------------
    pauseContinuousSources(): void {
        this.send('TransportPause');
    }
    resumeContinuousSources(): void {
        this.send('TransportPlay');
    }

    // --- Capability handles ------------------------------------------------
    // Real, never-null handles backed by the ojcore engine (looper actions become
    // RtCommands; samples load via `load_sample`; recorder via capture commands).
    getSamplerAdapter(nodeId: string): SamplerHandle {
        return this.caps.sampler(nodeId);
    }
    waitForSamplerAdapter(nodeId: string, _timeoutMs?: number): Promise<SamplerHandle | null> {
        return Promise.resolve(this.caps.sampler(nodeId));
    }
    getLooper(nodeId: string): LooperHandle {
        return this.caps.looper(nodeId);
    }
    getRecorder(nodeId: string): RecorderHandle {
        return this.caps.recorder(nodeId);
    }

    /** Forward a decoded buffer from a source node to every connected sampler.
     *  Mirrors WebAudio's `sendSampleBuffer`: install the PCM into each sampler
     *  the source feeds. */
    sendSampleBuffer(sourceNodeId: string, buffer: AudioBuffer): void {
        if (!this.getNodes || !this.getConnections) return;
        const connections = this.getConnections();
        const nodes = this.getNodes();
        for (const conn of connections.values()) {
            if (conn.sourceNodeId !== sourceNodeId) continue;
            const target = nodes.get(conn.targetNodeId);
            if (target?.type === 'sampler') {
                this.caps.sampler(conn.targetNodeId).setBuffer(buffer);
            }
        }
    }

    // --- Native command backings for the capability bridge -----------------

    /** Lower mono PCM into the engine sampler for `nodeId` via `load_sample`. */
    private async loadSampleNative(
        nodeId: string,
        pcm: Float32Array,
        sampleRate: number,
        rootNote: number,
    ): Promise<void> {
        if (!this.invoke) return;
        const idx = this.index.get(nodeId);
        if (idx === undefined) return;
        try {
            // Transfer PCM as a plain number array (control-rate asset load, NOT
            // the audio thread — the engine resolves it into the AssetCatalog and
            // calls the sampler's set_sample off-RT).
            await this.invoke('load_sample', {
                node: idx,
                pcm: Array.from(pcm),
                sampleRate,
                rootNote,
            });
        } catch (err) {
            log.error('load_sample failed', { detail: String(err) });
        }
    }

    /** Start an engine-side capture of `nodeId`'s output bus. */
    private recorderStartNative(nodeId: string): void {
        if (!this.invoke) return;
        const idx = this.index.get(nodeId);
        if (idx === undefined) return;
        this.invoke('recorder_start', { node: idx }).catch((err: unknown) => {
            log.error('recorder_start failed', { detail: String(err) });
        });
    }

    /** Stop the engine-side capture and resolve the exported WAV blob. */
    private async recorderStopNative(nodeId: string): Promise<Blob | null> {
        if (!this.invoke) return null;
        const idx = this.index.get(nodeId);
        if (idx === undefined) return null;
        try {
            // The backend returns interleaved-or-mono f32 PCM + rate; encode to a
            // WAV blob client-side (off the audio thread). The native Recorder can
            // also export WAV directly via `recorder_export` for the file path.
            const res = (await this.invoke('recorder_stop', { node: idx })) as {
                pcm: number[];
                sampleRate: number;
            } | null;
            if (!res || !res.pcm || res.pcm.length === 0) return null;
            return monoPcmToWavBlob(Float32Array.from(res.pcm), res.sampleRate);
        } catch (err) {
            log.error('recorder_stop failed', { detail: String(err) });
            return null;
        }
    }
}
