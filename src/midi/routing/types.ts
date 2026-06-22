/**
 * Types for the MIDI -> voice routing service (U13, control-side).
 *
 * The router is decoupled from concrete singletons (graphStore, the audio
 * Executor, MIDIManager) via the {@link RoutingContext} dependency seam. This
 * keeps the resolution logic pure and unit-testable: tests supply fakes, while
 * production wiring (see `index.ts`) injects the real graph/executor/MIDI.
 */

import type { Connection, GraphNode } from '../../engine/types';
import type { MIDIEvent } from '../types';

/** The subset of the audio {@link Executor} the router drives. */
export interface VoiceExecutor {
    /** Trigger a note from an input node's row/key (velocity 0-1). */
    noteOn(keyboardId: string, row: number, keyIndex: number, velocity?: number): void;
    /** Release a previously triggered note. */
    noteOff(keyboardId: string, row: number, keyIndex: number): void;
    /** Light a connection cable to visualize signal flowing through it. */
    activateControlSignal(connectionId: string): void;
    /** Begin the fade-out of a connection cable's signal-flow glow. */
    releaseControlSignal(connectionId: string): void;
}

/** A subscription handle that can be unsubscribed. */
export interface MIDISubscriptionLike {
    unsubscribe: () => void;
}

/** The subset of MIDIManager the router subscribes through. */
export interface MIDISource {
    /** Subscribe to parsed events from a specific device id. */
    subscribe(deviceId: string, callback: (event: MIDIEvent) => void): MIDISubscriptionLike;
    /** Subscribe to parsed events from every device. */
    subscribeAll(callback: (event: MIDIEvent) => void): MIDISubscriptionLike;
}

/** Read access to the current node graph. */
export interface GraphAccess {
    /** All nodes at all levels (flat). */
    getNodes(): Map<string, GraphNode>;
    /** All connections at all levels (flat). */
    getConnections(): Map<string, Connection>;
}

/** Everything the router needs to resolve and emit voices. */
export interface RoutingContext {
    graph: GraphAccess;
    executor: VoiceExecutor;
    midi: MIDISource;
}

/**
 * A fully resolved routing decision for a single note event: which input node to
 * drive and the row/key/velocity to play.
 */
export interface ResolvedVoice {
    /** The input node id the executor should drive (`keyboardId`). */
    nodeId: string;
    /** 1-indexed row. */
    row: number;
    /** 0-indexed chromatic key (0-11). */
    keyIndex: number;
    /** Normalized velocity (0-1). */
    velocity: number;
}
