/**
 * Which number key (2-9) focuses a keyboard.
 *
 * `KeyboardNode` persists its `assignedKey` in node data — `graphStore.addNode`
 * hands it out when a `keyboard` is created. `KeyboardVisualNode` cannot do
 * that: a mount-time `updateNodeData` would push a phantom entry into the
 * player's undo stack, and a fixed `defaultData` value would give every visual
 * keyboard mode 2. So its number is DERIVED — pure, stable, and never written.
 *
 * Lives beside the faceplates rather than inside one so the module stays a
 * component module (react-refresh) and the rule is unit-testable on its own.
 */

import type { GraphNode } from '../../engine/types';

export const MIN_KEYBOARD_MODE = 2;
export const MAX_KEYBOARD_MODE = 9;

/**
 * A visual keyboard living inside a `keyboard` container is that keyboard's
 * MIRROR: it plays and lights through its parent and must not claim a number of
 * its own.
 */
export function isKeyboardMirror(nodes: Map<string, GraphNode>, node: GraphNode): boolean {
    if (!node.parentId) return false;
    return nodes.get(node.parentId)?.type === 'keyboard';
}

/**
 * The number key that focuses `nodeId`.
 *
 * An explicit `assignedKey` in node data always wins (that is how `keyboard`
 * works, and how a project file or an agent can pin one). Otherwise: reserve
 * every number the `keyboard` nodes have already claimed, then hand the rest to
 * the playable visual keyboards in a stable id order — the same answer on every
 * render, every reload, and on every client of a collab session.
 */
export function deriveKeyboardNumber(nodes: Map<string, GraphNode>, nodeId: string): number {
    const self = nodes.get(nodeId);
    const explicit = (self?.data as { assignedKey?: number } | undefined)?.assignedKey;
    if (
        typeof explicit === 'number' &&
        explicit >= MIN_KEYBOARD_MODE &&
        explicit <= MAX_KEYBOARD_MODE
    ) {
        return explicit;
    }

    const claimed = new Set<number>();
    const playable: string[] = [];
    for (const candidate of nodes.values()) {
        if (candidate.type === 'keyboard') {
            claimed.add((candidate.data as { assignedKey?: number }).assignedKey ?? MIN_KEYBOARD_MODE);
        } else if (candidate.type === 'keyboard-visual' && !isKeyboardMirror(nodes, candidate)) {
            playable.push(candidate.id);
        }
    }
    playable.sort();

    let next = MIN_KEYBOARD_MODE;
    for (const id of playable) {
        while (claimed.has(next) && next <= MAX_KEYBOARD_MODE) next += 1;
        if (id === nodeId) return next <= MAX_KEYBOARD_MODE ? next : MIN_KEYBOARD_MODE;
        claimed.add(next);
    }
    return MIN_KEYBOARD_MODE;
}
