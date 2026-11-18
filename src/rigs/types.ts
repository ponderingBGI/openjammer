/**
 * Preset rigs — the shape of a starting patch.
 *
 * A rig is described the same way a person reads one off the canvas: nodes by a
 * symbolic `ref` and a registry `type`, wires by the PORT NAME printed beside the
 * socket. It deliberately mirrors `src/song/spec.ts`'s `SpecNode`/`SpecConn` and
 * the agent's `WorkflowPlan` rather than inventing a third vocabulary — but it
 * resolves port names against the LIVE node after creation, because the ports
 * that matter here (a keyboard's `Row 1`) only exist once the node is on the
 * canvas.
 */

import type { NodeType, Position } from '../engine/types';
import type { Persona, RigGoal } from '../store/onboardingStore';

/** One node in a rig: a symbolic ref, a real registry type, a real position. */
export interface RigNode {
    /** Symbolic id used by this rig's wires. Never a real node id. */
    ref: string;
    type: NodeType;
    /** Canvas position. Rigs are laid out left-to-right, signal-flow order. */
    position: Position;
    /** Merged over the registry's `defaultData` exactly as `addNode` does. */
    data?: Record<string, unknown>;
}

/**
 * One wire. Endpoints are `"ref"` or `"ref:Port Name"` and are resolved against
 * the LIVE node, because several node types replace their declared ports the
 * moment they are added: a keyboard's outputs become its internal panel's
 * `Row 1…3`, and an instrument's input becomes an expanding bundle panel. So a
 * name is a HINT, and `signal` — the thing that actually travels down the cable —
 * is what resolution falls back to. Grey for numbers and triggers, blue for
 * sound: the same legend the player reads off the canvas.
 */
export interface RigWire {
    from: string;
    to: string;
    /** What travels down this cable. Defaults to `audio`. */
    signal?: 'audio' | 'control';
}

export interface RigSpec {
    /** Stable id — the goal it answers. */
    id: RigGoal;
    /** Shown in the topbar chip: "Jam rig". */
    label: string;
    /** One honest line about what this rig actually is. */
    blurb: string;
    nodes: RigNode[];
    wires: RigWire[];
    /**
     * The rig installs a Song (an Arrangement) as well as a patch. Only the beat
     * rig does; it is what makes "already running" true without a timer.
     */
    song?: 'beat-loop';
}

/** Build the rig for a goal at a persona's density. */
export type RigFactory = (persona: Persona) => RigSpec;
