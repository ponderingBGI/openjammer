/**
 * OjcoreNativeExecutor (U17) — the native, sub-5ms audio path.
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
import type { Looper } from '../Looper';
import type { Recorder } from '../Recorder';
import type { SamplerAdapter } from '../samplers/SamplerAdapter';
import type {
    Executor,
    ConnectionChangeCallback,
    NodeChangeCallback,
    Unsubscribe,
} from './Executor';
import { emitWithIndex, remapForBackend, type NodeIdxMap } from '../ojgraph';
import { resolveKeyboardNotes } from '../ojgraph';
import type { OjGraph, RtCommand } from '../../../packages/oj-protocol-ts/src/index';

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

/** True when running inside a Tauri webview (the native desktop shell). */
export function isTauri(): boolean {
    if (typeof window === 'undefined') return false;
    return Boolean((window as unknown as { __TAURI__?: unknown }).__TAURI__);
}

/**
 * Drives audio via the native Tauri ojcore engine. Most {@link Executor} methods
 * that are Web-Audio-specific (signal metering, mic AudioNode routing, looper /
 * recorder / sampler handles) are no-ops or null here — those capabilities are
 * either engine-side or not yet bridged; the seam keeps the app from crashing.
 */
export class OjcoreNativeExecutor implements Executor {
    private invoke = getInvoke();
    private getNodes: (() => Map<string, GraphNode>) | null = null;
    private getConnections: (() => Map<string, Connection>) | null = null;
    private unsub: Unsubscribe | null = null;
    /** Last emitted GraphNode-id -> NodeIdx interning, for RtCommand addressing. */
    private index: NodeIdxMap = new Map();
    private signalCallbacks = new Set<(levels: Map<string, number>) => void>();

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
            console.warn(
                '[OjcoreNativeExecutor] Tauri global IPC bridge not found ' +
                    '(set app.withGlobalTauri=true in tauri.conf.json). Native audio disabled.',
            );
        }

        const unsubNodes = subscribeToNodes(() => this.pushGraph());
        const unsubConns = subscribeToConnections(() => this.pushGraph());
        this.unsub = () => {
            unsubNodes();
            unsubConns();
        };

        // Initial reconcile.
        this.pushGraph();
    }

    dispose(): void {
        this.unsub?.();
        this.unsub = null;
        this.signalCallbacks.clear();
        this.getNodes = null;
        this.getConnections = null;
        this.index = new Map();
    }

    /** Emit + remap + push the current graph to the native engine. */
    private pushGraph(): void {
        if (!this.getNodes || !this.getConnections) return;
        const { graph, index } = emitWithIndex(this.getNodes(), this.getConnections());
        this.index = index;
        const native = remapForBackend(graph, 'native');
        this.sendGraph(native);
    }

    private sendGraph(graph: OjGraph): void {
        if (!this.invoke) return;
        this.invoke('push_graph', { graph }).catch((err: unknown) => {
            console.error('[OjcoreNativeExecutor] push_graph failed:', err);
        });
    }

    private send(cmd: RtCommand): void {
        if (!this.invoke) return;
        this.invoke('send_command', { cmd }).catch((err: unknown) => {
            console.error('[OjcoreNativeExecutor] send_command failed:', err);
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
        if (this.signalCallbacks.size === 0) return;
        const levels = new Map<string, number>([[connectionId, level]]);
        for (const cb of this.signalCallbacks) cb(levels);
    }

    // --- Speaker output ----------------------------------------------------
    // Native master volume is engine-side; surface as a SetParam-style no-op for
    // now (the master is the host SpeakerOut, not a parameterized node yet).
    setSpeakerVolume(_nodeId: string, _volume: number, _isMuted: boolean): void {}
    setSpeakerDevice(_nodeId: string, _deviceId: string): void {}

    // --- Signal level metering --------------------------------------------

    subscribeSignalLevels(callback: (levels: Map<string, number>) => void): Unsubscribe {
        this.signalCallbacks.add(callback);
        callback(new Map());
        return () => {
            this.signalCallbacks.delete(callback);
        };
    }

    // --- Microphone --------------------------------------------------------
    // Native mic capture is an engine duplex-input concern (not wired yet); the
    // Web-Audio AudioNode handle has no meaning on the native path.
    setMicrophoneOutput(_nodeId: string, _outputNode: AudioNode): void {}

    // --- Continuous sources ------------------------------------------------
    pauseContinuousSources(): void {
        this.send('TransportPause');
    }
    resumeContinuousSources(): void {
        this.send('TransportPlay');
    }

    // --- Capability handles ------------------------------------------------
    // These return Web-Audio instances that do not exist on the native path.
    getSamplerAdapter(_nodeId: string): SamplerAdapter | null {
        return null;
    }
    waitForSamplerAdapter(_nodeId: string, _timeoutMs?: number): Promise<SamplerAdapter | null> {
        return Promise.resolve(null);
    }
    getLooper(_nodeId: string): Looper | null {
        return null;
    }
    getRecorder(_nodeId: string): Recorder | null {
        return null;
    }
    sendSampleBuffer(_sourceNodeId: string, _buffer: AudioBuffer): void {}
}
