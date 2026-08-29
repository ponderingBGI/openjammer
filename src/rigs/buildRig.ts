/**
 * Install a preset rig — through the SAME reversible verbs a player drives by
 * hand and the agent emits.
 *
 * There is no bespoke graph-seeding path here: every node is `graphStore.addNode`
 * and every cable is `graphStore.addConnection`, bracketed by ONE
 * `beginGesture()`/`endGesture()` so the whole rig is a single history entry and
 * a single `Ctrl+Z` takes it away again. A first-run patch a player cannot undo
 * would be the one edit in the app that is not theirs.
 *
 * Wires resolve against the LIVE node after it is created, never against the
 * registry's static `defaultPorts`. That is not a nicety: several types REPLACE
 * their declared ports the moment they are added — a `keyboard`'s outputs become
 * its internal panel's `Row 1…3`, and an `instrument`'s single `Bundle` becomes
 * an expanding input panel — so a registry-name lookup (the agent's plan path)
 * cannot wire a playable keyboard at all. A name is a hint; the signal the cable
 * carries is the fallback.
 */

import { useCanvasStore } from '../store/canvasStore';
import { useGraphStore } from '../store/graphStore';
import { useArrangementStore } from '../store/arrangementStore';
import { useAudioStore } from '../store/audioStore';
import { logger } from '../utils/log';
import type { GraphNode } from '../engine/types';
import { buildBeatSong } from './beatSong';
import { rigFor } from './presets';
import type { RigSpec } from './types';
import type { Persona, RigGoal } from '../store/onboardingStore';

const log = logger('rigs');

/** Split `"ref"` or `"ref:Port Name"`. */
function splitEndpoint(endpoint: string): { ref: string; portName?: string } {
    const at = endpoint.indexOf(':');
    if (at < 0) return { ref: endpoint.trim() };
    return { ref: endpoint.slice(0, at).trim(), portName: endpoint.slice(at + 1).trim() };
}

/**
 * Resolve an endpoint to a real port id on a LIVE node.
 *
 * The declared name wins when it is there. When it is not — and for several node
 * types it will not be, because adding them replaces their ports with the ones
 * their internal panels synthesise — fall back to what the cable CARRIES. That
 * is the honest key: a keyboard's `Row 1` and an instrument's expanding `Input`
 * are both control ports whatever their labels happen to say this frame.
 */
function resolvePort(
    node: GraphNode,
    portName: string | undefined,
    direction: 'input' | 'output',
    signal: 'audio' | 'control',
): string | undefined {
    const candidates = node.ports.filter((port) => port.direction === direction);
    if (portName) {
        const byName = candidates.find((port) => port.name === portName);
        if (byName) return byName.id;
    }
    const byRole = candidates.find((port) => port.type === signal || port.type === 'universal');
    return (byRole ?? candidates[0])?.id;
}

export interface InstalledRig {
    spec: RigSpec;
    /** ref -> the real node id the store minted. */
    ids: Record<string, string>;
    /** Cables that could not be made, by `"from -> to"`. Empty on a good build. */
    unwired: string[];
}

/**
 * Apply a rig to the live graph. Returns what was actually built, including any
 * cable that did not land — the caller reports honestly rather than assuming.
 */
export function installRig(spec: RigSpec): InstalledRig {
    const graph = useGraphStore.getState();
    const ids: Record<string, string> = {};
    const unwired: string[] = [];

    graph.beginGesture();
    try {
        for (const node of spec.nodes) {
            ids[node.ref] = useGraphStore
                .getState()
                .addNode(node.type, { ...node.position }, null, node.data ?? {});
        }

        for (const wire of spec.wires) {
            const from = splitEndpoint(wire.from);
            const to = splitEndpoint(wire.to);
            const state = useGraphStore.getState();
            const source = ids[from.ref] ? state.nodes.get(ids[from.ref]!) : undefined;
            const target = ids[to.ref] ? state.nodes.get(ids[to.ref]!) : undefined;
            const signal = wire.signal ?? 'audio';
            const sourcePortId = source && resolvePort(source, from.portName, 'output', signal);
            const targetPortId = target && resolvePort(target, to.portName, 'input', signal);
            if (!source || !target || !sourcePortId || !targetPortId) {
                unwired.push(`${wire.from} -> ${wire.to}`);
                continue;
            }
            const id = state.addConnection(source.id, sourcePortId, target.id, targetPortId);
            if (!id) unwired.push(`${wire.from} -> ${wire.to}`);
        }
    } finally {
        // Always close the gesture: a half-open history frame would swallow the
        // player's NEXT edit into the rig's undo step.
        useGraphStore.getState().endGesture();
    }

    if (unwired.length) log.warn('rig installed with unwired cables', { rig: spec.id, unwired });

    // The song half. `setArrangement` is the same call the arrangement's own
    // "Start from …" buttons make, so installing a rig's Song behaves exactly
    // like choosing a starter — including that it replaces the open song rather
    // than joining the graph's undo stack.
    if (spec.song === 'beat-loop') {
        const arrangement = useArrangementStore.getState();
        arrangement.setArrangement(buildBeatSong());
        arrangement.setLoopEnabled(true);
    }

    return { spec, ids, unwired };
}

/**
 * Bring the rig into view and put the player's hands on it: fit the canvas to
 * the new nodes and switch to the rig keyboard's mode so typing plays it
 * straight away. Called after the graph has rendered, never inside the gesture.
 */
export function focusRig(installed: InstalledRig): void {
    const graph = useGraphStore.getState();
    const bounds = graph.getNodesBounds();
    if (bounds && typeof window !== 'undefined') {
        useCanvasStore.getState().fitToNodes(bounds, window.innerWidth, window.innerHeight);
    }

    // Typing is how this rig makes sound, so select the keyboard's mode. Modes
    // 2–9 are the keyboards; mode 1 is config. The keyboard registers its number
    // on mount, which is why this runs after the graph has painted.
    const keyboard = graph
        .getNodesByType('keyboard')
        .find((node) => Object.values(installed.ids).includes(node.id));
    const assigned = (keyboard?.data as { assignedKey?: number } | undefined)?.assignedKey;
    if (typeof assigned === 'number') useAudioStore.getState().setCurrentMode(assigned);
}

/** Build and install the rig for a goal at a persona's density. */
export function installRigFor(goal: RigGoal, persona: Persona): InstalledRig {
    return installRig(rigFor(goal, persona));
}
