/**
 * ONE law for keyboard mode numbers — the 2–9 a performer presses to put their
 * hands on a keyboard.
 *
 * There used to be two. A `keyboard` persisted its number and never moved; a
 * `keyboard-visual` DERIVED one by filling the lowest free slot, so every visual
 * keyboard renumbered whenever any other keyboard was added or deleted. Mid-set
 * that reads as "press 2 to play this" silently becoming "press 3" because you
 * dropped an unrelated node on the far side of the canvas. A number under a
 * player's hands is not allowed to move.
 *
 * The law, for BOTH kinds:
 *
 *  1. A keyboard-kind node's mode is ALLOCATED ONCE — the lowest free number in
 *     2–9 at the moment it enters the graph — and persisted in `data.assignedKey`.
 *     Allocation happens inside `graphStore.addNode`, i.e. inside that verb's own
 *     history entry: no phantom undo step, no mount-time write.
 *  2. Nothing renumbers it afterwards. Another keyboard arriving or leaving
 *     changes nothing; a deleted keyboard's number simply becomes free again and
 *     the next NEW keyboard takes it.
 *  3. On load or paste a collision is resolved by re-allocating the NEWER node
 *     only ({@link normalizeKeyboardModes}) — the one already on the canvas keeps
 *     what the player learned.
 *
 * Pure: every function here depends only on the nodes handed to it. Lives in
 * `store/` because the number is persisted graph state, not faceplate state —
 * the faceplates only read it.
 */

import type { GraphNode } from '../engine/types';

export const MIN_KEYBOARD_MODE = 2;
export const MAX_KEYBOARD_MODE = 9;

/** The node types that are a keyboard a player can put their hands on. */
const KEYBOARD_KINDS: ReadonlySet<string> = new Set(['keyboard', 'keyboard-visual']);

export function isKeyboardKind(type: string): boolean {
    return KEYBOARD_KINDS.has(type);
}

/**
 * A visual keyboard living inside a `keyboard` container is that keyboard's
 * MIRROR: it plays and lights through its parent and must not claim a number of
 * its own.
 */
export function isKeyboardMirror(
    nodes: Map<string, GraphNode> | ReadonlyMap<string, GraphNode>,
    node: GraphNode,
): boolean {
    if (!node.parentId) return false;
    return nodes.get(node.parentId)?.type === 'keyboard';
}

/** The mode a node has already been given, or `undefined` if it has none yet. */
export function keyboardModeOf(node: GraphNode | undefined): number | undefined {
    const value = (node?.data as { assignedKey?: unknown } | undefined)?.assignedKey;
    if (typeof value !== 'number' || !Number.isInteger(value)) return undefined;
    if (value < MIN_KEYBOARD_MODE || value > MAX_KEYBOARD_MODE) return undefined;
    return value;
}

/**
 * The lowest number 2–9 that nobody in `claimed` holds. Wraps to
 * {@link MIN_KEYBOARD_MODE} when all eight are taken: a ninth keyboard has to
 * share, and sharing the FIRST one is the predictable answer.
 */
export function lowestFreeKeyboardMode(claimed: ReadonlySet<number>): number {
    for (let n = MIN_KEYBOARD_MODE; n <= MAX_KEYBOARD_MODE; n += 1) {
        if (!claimed.has(n)) return n;
    }
    return MIN_KEYBOARD_MODE;
}

/** Every mode currently held by a keyboard in the graph (mirrors hold none). */
export function claimedKeyboardModes(
    nodes: Map<string, GraphNode> | ReadonlyMap<string, GraphNode>,
    exclude?: ReadonlySet<string>,
): Set<number> {
    const claimed = new Set<number>();
    for (const node of nodes.values()) {
        if (!isKeyboardKind(node.type)) continue;
        if (exclude?.has(node.id)) continue;
        if (isKeyboardMirror(nodes, node)) continue;
        const mode = keyboardModeOf(node);
        if (mode !== undefined) claimed.add(mode);
    }
    return claimed;
}

/** The number a keyboard entering `nodes` right now should be given. */
export function allocateKeyboardMode(
    nodes: Map<string, GraphNode> | ReadonlyMap<string, GraphNode>,
    exclude?: ReadonlySet<string>,
): number {
    return lowestFreeKeyboardMode(claimedKeyboardModes(nodes, exclude));
}

/**
 * Settle the modes of a whole set of nodes arriving at once — a loaded project,
 * a pasted selection, a rehydrated session.
 *
 * Walks `ordered` oldest-first. The first node to hold a number KEEPS it; a
 * later node holding the same number, or holding none at all, is allocated the
 * lowest free one. Returns only the ids whose number has to change, so a healthy
 * graph round-trips byte-identically and a load writes nothing.
 *
 * @param ordered  keyboard nodes oldest-first (file order, or existing-then-pasted)
 * @param seeded   modes already held by nodes NOT in `ordered` (they win)
 */
export function normalizeKeyboardModes(
    ordered: readonly GraphNode[],
    seeded: ReadonlySet<number> = new Set(),
): Map<string, number> {
    const byId = new Map(ordered.map((node) => [node.id, node]));
    const claimed = new Set(seeded);
    const changes = new Map<string, number>();

    for (const node of ordered) {
        if (!isKeyboardKind(node.type)) continue;
        if (isKeyboardMirror(byId, node)) continue;
        const mode = keyboardModeOf(node);
        if (mode !== undefined && !claimed.has(mode)) {
            claimed.add(mode);
            continue;
        }
        const next = lowestFreeKeyboardMode(claimed);
        claimed.add(next);
        changes.set(node.id, next);
    }

    return changes;
}
