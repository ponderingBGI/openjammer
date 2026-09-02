/**
 * The two connection VERBS — begin a cable, land a cable — as functions.
 *
 * These bodies used to live inside `NodeWrapper`'s `handlePortMouseDown` /
 * `handlePortMouseUp` closures, which meant the only way to reach them from
 * anywhere else was to impersonate a mouse. U8's keyboard route did exactly
 * that: it dispatched a real `MouseEvent` at the socket so the card's own
 * handler would run. That got the RIGHT answer for the right reason — this is a
 * 150-line accretion (ghost ports becoming real ports, an instrument growing
 * inputs for a multi-source drop, the pending reconnect resolving, the
 * `beginGesture`/`endGesture` bracket that makes all of it one `Ctrl+Z`) and a
 * second keyboard implementation of it would be a second set of bugs forever —
 * but it shared the wrong thing. The seam is the VERB, not the event.
 *
 * So the bodies live here, the pointer handlers are two lines of event plumbing
 * around them, and the keyboard calls the same functions directly. No synthetic
 * events, byte-identical behaviour, and — the part that actually failed review —
 * ONE opinion about what is legal. The keyboard used to carry a private
 * pre-flight refusal set, which made it a second opinion: it refused a card
 * wiring to itself while the identical pointer drag created the loop. That rule
 * now lives in `graphStore.addConnection`, where both routes read it, and
 * `completeConnectionAt` reports the store's answer instead of pre-judging it.
 *
 * Everything here RE-READS the stores at call time (mutation discipline) and
 * touches no React state, so it is callable from a handler, an effect, or a test.
 */

import type { GraphNode } from '../../engine/types';
import { resolveNodeDefinition } from '../../engine/registry';
import { useCanvasStore } from '../../store/canvasStore';
import { useGraphStore } from '../../store/graphStore';
import { generateUniqueId } from '../../utils/idGenerator';

/**
 * What a landing did, in words the caller can speak.
 *
 * `ok: false` always carries a REASON. A refusal that says nothing is
 * indistinguishable from a broken key (or a broken mouse), which is the whole
 * complaint HA-07 makes about this app.
 */
export type ConnectionResult =
    | { ok: true; announcement?: string }
    | { ok: false; reason: string };

/** Node types whose control inputs grow on demand (the ghost-port families). */
const GROWS_INPUTS = ['instrument', 'strings', 'keys', 'winds', 'sampler'];

/** The words on a card, for a sentence about it. */
function cardName(nodeId: string): string {
    const node = useGraphStore.getState().nodes.get(nodeId);
    return node ? resolveNodeDefinition(node).name : 'a card';
}

/**
 * Pick up a cable at `portId`, or start a new one there.
 *
 * U5 — OUTPUTS FAN OUT. The pending-disconnect lookup is ASYMMETRIC, and that is
 * the topology rather than a special case: a cable is uniquely identified by its
 * INPUT end (an audio input holds exactly one, enforced in
 * `graphStore.addConnection`), while an output end is a fan-out point with no
 * cardinality at all. It used to be symmetric, so grabbing an output always
 * MOVED its cable and never added a second one — measured on the shipping build
 * as six connections before and six after, with the speaker silently unfed. One
 * output feeding two places is not an advanced trick; it is how a player sends
 * the same voice to the speaker and to a looper.
 */
export function beginConnectionFrom(node: GraphNode, portId: string): void {
    const canvas = useCanvasStore.getState();
    if (canvas.isConnecting) return;

    const port = node.ports.find((p) => p.id === portId);
    let pendingDisconnectId: string | undefined;
    if (port && port.direction !== 'output') {
        const existing = Array.from(useGraphStore.getState().connections.values()).find(
            (conn) => conn.targetNodeId === node.id && conn.targetPortId === portId,
        );
        if (existing) pendingDisconnectId = existing.id;
    }
    canvas.startConnecting(node.id, portId, pendingDisconnectId);
}

/**
 * Land the cable (or cables) in the air on `portId` of `node`.
 *
 * Returns a {@link ConnectionResult} rather than announcing anything itself:
 * this module has no opinion about live regions, and both call sites want the
 * same words.
 */
export function completeConnectionAt(node: GraphNode, portId: string): ConnectionResult {
    const canvas = useCanvasStore.getState();
    if (!canvas.isConnecting || !canvas.connectingFrom) return { ok: false, reason: 'No cable in hand.' };

    const sources = Array.isArray(canvas.connectingFrom) ? canvas.connectingFrom : [canvas.connectingFrom];

    // Released on the port the drag started from: keep the cable in hand, so a
    // CLICK on a port arms it and a second click elsewhere lands it.
    if (sources.length === 1 && sources[0].nodeId === node.id && sources[0].portId === portId) {
        return { ok: true };
    }

    const graph = useGraphStore.getState();
    const growsInputs = GROWS_INPUTS.includes(node.type);

    /*
     * U5's COMPENSATING GESTURE (1C-02) — moving a cable's destination.
     *
     * With the output grab now fanning out, the documented way to MOVE a cable is
     * to grab it at its input end. Measured at gate time, that gesture did
     * nothing at all: the drag's source is an input, the drop target is an input,
     * and `addConnection(input, input)` is refused by `canConnect`'s
     * same-direction rule — so the most natural DAW gesture in the app failed
     * silently, which is the exact failure mode the audit indicts.
     *
     * The cable's far end is the thing that has to travel. When an input-grab
     * armed a pending disconnect and the drop is on another input, reconnect that
     * cable's SOURCE to the new destination. One `reconnectConnection`, one undo
     * entry, and the sentence in `docs/shell.md` becomes true.
     */
    const targetPortNow = node.ports.find((p) => p.id === portId);
    const pendingId = canvas.pendingDisconnect;
    if (
        pendingId
        && sources.length === 1
        && targetPortNow
        && targetPortNow.direction === 'input'
    ) {
        const grabbed = graph.nodes.get(sources[0].nodeId)?.ports.find((p) => p.id === sources[0].portId);
        const cable = graph.connections.get(pendingId);
        if (grabbed?.direction === 'input' && cable) {
            // Dropped back on the socket it came from. Nothing failed and nothing
            // changed, so the gesture is over — but silence here reads exactly
            // like a broken drop, so it says what happened.
            if (cable.targetNodeId === node.id && cable.targetPortId === portId) {
                canvas.stopConnecting();
                return { ok: true, announcement: 'That cable is already there.' };
            }
            const from = cardName(cable.targetNodeId);
            const to = cardName(node.id);
            const moved = graph.reconnectConnection(
                pendingId,
                cable.sourceNodeId,
                cable.sourcePortId,
                node.id,
                portId,
            );
            /*
             * READ THE GRAPH BACK BEFORE SAYING ANYTHING (RG-01).
             *
             * A truthy return is not proof that anything happened.
             * `addConnection` short-circuits on a duplicate edge and hands back
             * the EXISTING connection's id without touching the graph, so when
             * one output already feeds both the grabbed input and the target,
             * `reconnectConnection` returns truthy having moved nothing. This
             * branch then announced "Moved cable from X to Y" for a move that did
             * not happen — and because the history frame committed no verbs, the
             * player's next `Ctrl+Z` undid the PREVIOUS gesture instead. A false
             * confirmation followed by an undo that lands somewhere else is the
             * exact failure class this lane exists to close.
             *
             * A real move MINTS A NEW ID (`addConnection` generates one and
             * deletes `replacingConnectionId` in the same `set()`), so the cable
             * we grabbed still being present is the discriminator, and it needs
             * no assumptions about what the new id is.
             */
            const nothingHappened = useGraphStore.getState().connections.has(pendingId);
            if (!moved || nothingHappened) {
                // No `stopConnecting()`: a refusal leaves the cable in hand and the
                // CALLER decides whether its gesture is over, exactly as everywhere
                // else in this module. The player can try the next socket.
                return {
                    ok: false,
                    reason: nothingHappened
                        ? 'That cable is already there.'
                        : `${cardName(cable.sourceNodeId)} cannot connect to ${targetPortNow.name}.`,
                };
            }
            canvas.stopConnecting();
            return { ok: true, announcement: `Moved cable from ${from} to ${to}` };
        }
    }

    /*
     * There is no `ghost-input-` branch here any more, and that is a REMOVAL, not
     * an omission (RG-05).
     *
     * The port ids it matched are emitted by nothing. `git grep ghost-input-` at
     * `HEAD` and across the working tree hits only the two lines that consumed
     * them and one test that synthesised the id itself; no faceplate produces
     * one. The live "always one empty port" affordance is `PortPanelNode`'s
     * `empty-…` socket (`PortPanelNode.tsx:257-280`), which is a real port on the
     * node and takes the ordinary path below — measured on the jam rig, whose
     * instrument exposes `input-panel-…:empty-…`.
     *
     * So roughly fifty lines — an index parse, a port-growth loop, a
     * `beginGesture`/`endGesture` bracket and a two-way `targetPort` lookup —
     * existed to serve one mock. Carrying it across verbatim was right for the
     * refactor; keeping it now is not (agents.md value #8: every production line
     * is used). Its test went with it. If the `empty-…` affordance ever wants
     * growth-on-drop, that is the branch to write, against the ids the app
     * actually emits.
     *
     * `growsInputs` survives because the OTHER user of it does: a multi-source
     * drop still expands an instrument's inputs, and that is reachable today
     * (`Ctrl+A` over a port arms every matching port, then one drop).
     */
    {
        const updatedNode = useGraphStore.getState().nodes.get(node.id) ?? node;
        const targetPort = updatedNode.ports.find((p) => p.id === portId);
        if (!targetPort) return { ok: false, reason: 'That socket is gone.' };

        // Auto-expand a growing instrument for a multi-source drop.
        if (growsInputs && targetPort.direction === 'input' && sources.length > 1) {
            const currentInputs = updatedNode.ports.filter((p) => p.direction === 'input' && p.type === 'control');
            const clickedIndex = currentInputs.findIndex((p) => p.id === portId);
            if (clickedIndex === -1) return { ok: false, reason: 'That socket is gone.' };
            const needed = clickedIndex + sources.length;
            if (needed > currentInputs.length) {
                const newPorts = [...updatedNode.ports];
                for (let i = 0; i < needed - currentInputs.length; i += 1) {
                    newPorts.push({
                        id: generateUniqueId('input-'),
                        name: `In ${currentInputs.length + i + 1}`,
                        type: 'control',
                        direction: 'input',
                    });
                }
                useGraphStore.getState().updateNodePorts(node.id, newPorts);
            }
        }

        const finalNode = useGraphStore.getState().nodes.get(node.id) ?? updatedNode;
        const finalInputs = finalNode.ports.filter((p) => p.direction === 'input' && p.type === 'control');
        const pendingDisconnect = useCanvasStore.getState().pendingDisconnect;

        let made = 0;
        let refusal: string | null = null;
        sources.forEach((source, index) => {
            let actualTargetPortId = portId;
            if (index > 0 && targetPort.direction === 'input' && growsInputs) {
                const clickedIndex = finalInputs.findIndex((p) => p.id === portId);
                if (clickedIndex === -1 || (clickedIndex + index) >= finalInputs.length) return;
                actualTargetPortId = finalInputs[clickedIndex + index].id;
            }

            const store = useGraphStore.getState();
            const wired = targetPort.direction === 'input'
                ? (pendingDisconnect && index === 0
                    ? store.reconnectConnection(pendingDisconnect, source.nodeId, source.portId, node.id, actualTargetPortId)
                    : store.addConnection(source.nodeId, source.portId, node.id, actualTargetPortId))
                : (pendingDisconnect && index === 0
                    ? store.reconnectConnection(pendingDisconnect, node.id, actualTargetPortId, source.nodeId, source.portId)
                    : store.addConnection(node.id, actualTargetPortId, source.nodeId, source.portId));

            if (wired) made += 1;
            else if (!refusal) refusal = refuseReason(source, node, targetPort);
        });

        /*
         * A REFUSAL LEAVES THE CABLE IN HAND. It is the caller that decides
         * whether the gesture is over, because the two routes genuinely differ
         * there and this is the one place that difference is legitimate: a mouse
         * drop happened with the button coming up, so its gesture has ended
         * whatever the answer; a keyboard `Enter` released nothing, so the player
         * should be able to try the next socket without re-arming. Not a rules
         * fork — the RULES are all in the store — a gesture-lifetime one.
         */
        if (made > 0 || !refusal) useCanvasStore.getState().stopConnecting();
        if (made === 0 && refusal) return { ok: false, reason: refusal };
        return { ok: true };
    }
}

/**
 * Why the store said no, in the player's words.
 *
 * Read AFTER the refusal, not before it. The keyboard route used to compute its
 * own answer up front and so became a second opinion about what is legal — it
 * refused a card wiring to itself while the identical pointer drag created the
 * loop. The rules live in `canConnect` and `addConnection`; this only translates.
 */
function refuseReason(
    source: { nodeId: string; portId: string },
    node: GraphNode,
    targetPort: GraphNode['ports'][number],
): string {
    const sourceNode = useGraphStore.getState().nodes.get(source.nodeId);
    const sourcePort = sourceNode?.ports.find((p) => p.id === source.portId);
    if (!sourcePort) return 'That socket is gone.';
    if (source.nodeId === node.id) return 'A card cannot be wired to itself.';
    if (sourcePort.direction === targetPort.direction) {
        return targetPort.direction === 'input'
            ? 'Two inputs cannot connect. Reach for an output.'
            : 'Two outputs cannot connect. Reach for an input.';
    }
    return `${sourcePort.name} cannot connect to ${targetPort.name}.`;
}
