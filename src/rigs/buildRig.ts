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
 * The beat rig's Song is inside that same bracket. It is not a document the
 * player opened, it is half of the patch they asked for, so it leaves and comes
 * back with the nodes — and with its loop arm — on one Ctrl+Z / one
 * Ctrl+Shift+Z; see `arrangementStore.setArrangement`'s `preserveHistory` and
 * `transport` options. That undo STOPS playback, which is intended: taking the
 * Song back is a document swap, and the song that was playing is gone.
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
import { useHistoryStore } from '../store/historyStore';
import { useArrangementStore } from '../store/arrangementStore';
import { useAudioStore } from '../store/audioStore';
import { isKeyboardKind, keyboardModeOf } from '../store/keyboardModes';
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
    const ids: Record<string, string> = {};
    const unwired: string[] = [];

    /*
     * NAME the gesture. `beginGesture()` opens the history frame with the
     * generic `'Edit graph'`, which is right for an anonymous edit and wrong for
     * the biggest single thing a first-run player ever does: it made the undo
     * button read "Undo Add 4 cards" for a thirteen-node install, and the live
     * region say the same. `begin`/`commit` are exactly what `beginGesture`/
     * `endGesture` wrap — the only difference here is that the frame carries the
     * rig's own name, so one Ctrl+Z is announced as "Undo Install Beat rig".
     */
    useHistoryStore.getState().begin(`Install ${spec.label}`, 'graph');
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

        // The song half, INSIDE the same gesture. A rig's Song is not a document
        // the player opened — it is half of the patch they asked for, so it has
        // to leave on the same Ctrl+Z as the nodes. `preserveHistory` keeps the
        // command-log (the default swap CLEARS it, which used to wipe the rig's
        // own entry a line after making it) and records the arrangement that was
        // open as the inverse, so undo puts the previous document back.
        //
        // The loop arm rides WITH the swap rather than following it. This rig's
        // whole identity is a looping one-bar pattern, so an arm that did not
        // travel in the snapshot meant redo gave a different sound than the
        // action it replayed — one bar, then silence — which a performer reads
        // as "the app lost my patch". Now the `document` verb carries the arm:
        // redo comes back armed, undo restores the switch the player had.
        // Transport is still not an edit — nothing else about it (play, click,
        // count-in) is in the log; this is one document's loop travelling with
        // that document, because `setArrangement` is what resets it.
        if (spec.song === 'beat-loop') {
            useArrangementStore.getState().setArrangement(buildBeatSong(), {
                preserveHistory: true,
                // `loopOn` is the engine's echo of a loop actually running; the
                // transport is stopped here, so only the arm is true.
                transport: { loopEnabled: true, loopOn: false },
            });
        }
    } finally {
        // Always close the gesture: a half-open history frame would swallow the
        // player's NEXT edit into the rig's undo step.
        useHistoryStore.getState().commit();
    }

    if (unwired.length) log.warn('rig installed with unwired cables', { rig: spec.id, unwired });

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
    // 2–9 are the keyboards; mode 1 is config. Either keyboard kind can be the
    // rig's keyboard (the presets install the on-screen one), and both carry the
    // number `addNode` allocated them, so ask the node — not the type.
    const rigIds = new Set(Object.values(installed.ids));
    const keyboard = [...graph.nodes.values()].find(
        (node) => rigIds.has(node.id) && isKeyboardKind(node.type),
    );
    const assigned = keyboardModeOf(keyboard);
    if (assigned !== undefined) useAudioStore.getState().setCurrentMode(assigned);
}

/** Build and install the rig for a goal at a persona's density. */
export function installRigFor(goal: RigGoal, persona: Persona): InstalledRig {
    return installRig(rigFor(goal, persona));
}
