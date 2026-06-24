// src/song/types.ts — the ONE shared song document. A human GUI drag, the in-app
// Pi agent, and a headless cloned agent all author THIS (no second format). Its
// `graph` half is the existing `oj author` / WorkflowPlan node+connection shape
// verbatim (a strict subset); its time half (tracks reference graph nodes, clips,
// notes at PPQN ticks, automation lanes, sections, tempo) is pure Tier-4. `conduct`
// lowers it to the flat OjGraph + event schedule the engine already plays, so a
// bounce is bit-identical to a live take and ojcore gains ZERO timeline lines.

import type { GraphSpec } from './spec';

/** A note inside a clip, timed in PPQN ticks RELATIVE to the clip start. */
export interface ArrangementNote {
    /** Onset in ticks from the clip start. */
    tick: number;
    /** Length in ticks. */
    durTick: number;
    /** MIDI pitch (0..127). */
    pitch: number;
    /** MIDI velocity (0..127); defaults to 100. */
    vel?: number;
}

/** A clip placed on a track's timeline, timed in absolute PPQN ticks. */
export interface ArrangementClip {
    /** Clip start in absolute ticks from bar 1 beat 1. */
    startTick: number;
    notes: ArrangementNote[];
}

/** One automation breakpoint (value at a tick). */
export interface AutomationPoint {
    tick: number;
    value: number;
}

/**
 * An automation lane targets a node param. `param` is the numeric param id (as the
 * engine addresses it in `setParam`); a name->id resolver is a later convenience.
 * Lowered to STEPPED `setParam` events that ride the engine's per-sample smoothers.
 */
export interface AutomationLane {
    /** The graph node ref whose param is automated. */
    ref: string;
    /** Numeric param id. */
    param: number;
    points: AutomationPoint[];
}

/** A track plays one instrument node (`ref`) over time via its clips. */
export interface ArrangementTrack {
    name?: string;
    /** The graph node ref this track plays (must survive lowering — an instrument). */
    ref: string;
    clips: ArrangementClip[];
    automation?: AutomationLane[];
    /** Muted tracks emit no notes (the always-correct gate). */
    mute?: boolean;
}

/** A named arrangement section (metadata for the UI + the agent's read surface). */
export interface ArrangementSection {
    name: string;
    /** 1-based bar where the section begins. */
    startBar: number;
}

/**
 * An agent-AUTHORED DSP node: a faust source the agent dreamed up, spliced into a
 * track's signal path as a mono effect (instrument -> authored -> consumers).
 * `conduct` injects it into the IR; the render bin compiles it to a native .dll and
 * hosts it as a real WasmHost node (--code-node), through the permanent OutputGuard.
 * This is the agent's PRIMARY creative mode — building its own instrument, not just
 * arranging presets.
 */
export interface CodeNode {
    /** The WasmHost manifest id (e.g. "ai.wasm.lofi-bass-sat"). */
    id: string;
    /** The faust source (a 1-in / 1-out effect). */
    faustSource: string;
    /** The track ref whose instrument output this effect is inserted right after. */
    onTrack: string;
}

/** The whole song. */
export interface Arrangement {
    name: string;
    tempoBpm: number;
    /** Pulses per quarter note. Default 960. */
    ppq?: number;
    /** [beatsPerBar, beatUnit]. Default [4, 4]. */
    timeSignature?: [number, number];
    /** Render sample rate. Default 48000. */
    sampleRate?: number;
    /** Render block size. Default 256. */
    blockSize?: number;
    sections?: ArrangementSection[];
    /** The graph half — the instruments/effects/routing (the `oj author` spec). */
    graph: GraphSpec;
    tracks: ArrangementTrack[];
    /** Agent-authored DSP nodes spliced into track signal paths (the agent's own
     * instruments). Compiled + hosted device-free by the render bin's --code-node. */
    codeNodes?: CodeNode[];
}

/**
 * A lowered control event at a wall-clock time (seconds) — EXACTLY the shape the
 * `ojcore-native` render bin's `SchedEvent` deserializes (serde tag `cmd`,
 * camelCase). `node` is the IR `NodeIdx`. This is `conduct`'s output, never an
 * authoring surface.
 */
export type ScheduleEvent =
    | { at: number; cmd: 'noteOn'; node: number; note: number; vel: number }
    | { at: number; cmd: 'noteOff'; node: number; note: number }
    | { at: number; cmd: 'setParam'; node: number; param: number; value: number };
