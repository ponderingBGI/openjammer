/**
 * What just happened, in words — the missing half of every verb in this app.
 *
 * `HistoryEntry.label` is written by every gesture and, measured, was rendered
 * NOWHERE (HEURISTIC-AUDIT HA-09): the Undo button said only "Undo (Ctrl+Z)",
 * and one press after a failed port drag removed ten cables and a whole rig with
 * no name, no warning and no announcement. HA-07 is the same hole from the other
 * side — no user-facing verb produced a visible confirmation at all.
 *
 * Two things stopped a straight `label` render from being enough:
 *
 *  1. Every graph edit records the SAME label. `graphStore`'s `set()` wrapper
 *     diffs the store and records `'Edit graph'` for adding a node, wiring a
 *     cable, moving a card and deleting a rig alike. "Edit graph" is not an
 *     answer to "what did I just undo?".
 *  2. The information is nevertheless all there — in the VERBS. A graph entry
 *     carries the node it added, the connection it made, and (in its `inverse`)
 *     the node it removed. So the phrase is derived from the verbs first and
 *     falls back to the label, rather than the other way round.
 *
 * Deliberately NOT in `graphStore`: this is presentation, it is read by the
 * topbar title and the live region only, and the store's diff seam has no
 * business knowing English. Pure and synchronous, so it is testable as itself.
 */

import type { EditVerb, HistoryEntry } from '../store/historyStore';
import type { GraphVerb } from '../store/graphVerbs';
import type { GraphNode } from '../engine/types';

/**
 * The two shapes a phrase is needed in.
 *
 * `name` is the IMPERATIVE, the way a menu names a command — it is what reads
 * correctly after the words "Undo" and "Redo" ("Undo Add Sampler"). `done` is
 * the PAST, which is what an announcement of a completed action has to be
 * ("Added Sampler"). One derivation, two grammatical faces; picking one and
 * bending it at the call site is how you end up with "Undo Added Sampler".
 */
export interface HistoryPhrase {
    name: string;
    done: string;
}

/** Labels the stores write when they have nothing specific to say. */
const GENERIC_LABELS = new Set(['Edit graph', 'Edit', '']);

/**
 * Imperative -> past, for the leading word of a label.
 *
 * Every label written in this codebase is an imperative phrase ("Install beat
 * rig", "Delete selection", "Paste nodes", "Move cable"), which is the
 * right grammar for a menu and the wrong one for an announcement. One small
 * table beats a stemmer: these are OUR strings, there are a dozen of them, and a
 * word that is not in the table is simply left alone rather than mangled.
 */
const PAST_TENSE: Record<string, string> = {
    add: 'Added',
    close: 'Closed',
    connect: 'Connected',
    delete: 'Deleted',
    disconnect: 'Disconnected',
    duplicate: 'Duplicated',
    edit: 'Edited',
    install: 'Installed',
    load: 'Loaded',
    move: 'Moved',
    paste: 'Pasted',
    reconnect: 'Reconnected',
    remove: 'Removed',
    rename: 'Renamed',
    split: 'Split',
    trim: 'Trimmed',
};

/**
 * A label that is really a MACHINE word — a verb `kind` that leaked into the UI.
 *
 * `arrangementStore` records `verbs.length === 1 ? verbs[0].kind : 'Edit timeline'`,
 * so a single-verb timeline edit is titled `addClip`, `moveClip` — or, when the
 * gesture wrapped itself, the bare word **`compound`**, which the UX-1B gate saw
 * the topbar render as "Undo compound". That store is another lane's file and
 * this is presentation anyway: a machine word is detected here (one lowercase
 * token, no spaces) and turned back into English.
 */
function isMachineLabel(label: string): boolean {
    return /^[a-z][A-Za-z0-9]*$/.test(label);
}

/** `addClip` -> `Add clip`; `removeTracks` -> `Remove tracks`. */
function humaniseKind(kind: string): string {
    const words = kind.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The leading verb of a label, for building a past-tense phrase around a name. */
function firstWord(label: string): string {
    return label.split(' ')[0];
}

/** "Install beat rig" -> "Installed beat rig"; unknown verbs pass through. */
function toPast(name: string): string {
    const [first, ...rest] = name.split(' ');
    const past = PAST_TENSE[first.toLowerCase()];
    return past ? [past, ...rest].join(' ') : name;
}

/**
 * The English name for an entry whose label is a machine word.
 *
 * `compound` says nothing at all, so it is resolved to the FIRST verb inside it
 * — a compound entry must phrase as its label or its first verb, never as the
 * word "compound".
 */
function nameFromMachineLabel(entry: HistoryEntry, label: string): string {
    if (label !== 'compound') return humaniseKind(label);
    for (const item of entry.verbs) {
        if (item.domain !== 'arrangement') continue;
        const verb = item.verb as { kind: string; verbs?: Array<{ kind: string }> };
        const inner = verb.kind === 'compound' ? verb.verbs?.[0]?.kind : verb.kind;
        if (inner && inner !== 'compound') return humaniseKind(inner);
    }
    return 'Edit timeline';
}

const graphVerbs = (verbs: readonly EditVerb[]): GraphVerb[] =>
    verbs.filter((v): v is Extract<EditVerb, { domain: 'graph' }> => v.domain === 'graph').map((v) => v.verb);

/**
 * A node's display name for a sentence. Prefers the node carried by the entry
 * itself (an `addNode` verb, or the `addNode` that inverts a `removeNode`), so a
 * DELETED node can still be named after it is gone — the case that matters most,
 * because that is the one the player wants to undo.
 */
function nodeNamer(entry: HistoryEntry, lookup: (nodeId: string) => string | undefined) {
    const carried = new Map<string, GraphNode>();
    for (const verb of [...graphVerbs(entry.verbs), ...graphVerbs(entry.inverse)]) {
        if (verb.kind === 'addNode' || verb.kind === 'replaceNode') carried.set(verb.node.id, verb.node);
    }
    return (nodeId: string): string => lookup(nodeId) ?? titleCase(carried.get(nodeId)?.type ?? 'node');
}

function titleCase(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * The phrase for one history entry.
 *
 * `lookupNodeName` resolves a node id to the words printed on its card (the
 * caller owns that — it is the registry's business, not history's). Anything the
 * verbs cannot explain falls back to the entry's own label, and only a generic
 * label falls all the way through to "Edit graph".
 */
export function describeHistoryEntry(
    entry: HistoryEntry,
    lookupNodeName: (nodeId: string) => string | undefined,
): HistoryPhrase {
    const verbs = graphVerbs(entry.verbs);
    const named = nodeNamer(entry, lookupNodeName);
    const labelledPhrase = GENERIC_LABELS.has(entry.label)
        ? null
        : (isMachineLabel(entry.label) ? nameFromMachineLabel(entry, entry.label) : entry.label);
    const adds = verbs.filter((v) => v.kind === 'addNode');
    const removes = verbs.filter((v) => v.kind === 'removeNode');
    const wires = verbs.filter((v) => v.kind === 'addConnection');
    const unwires = verbs.filter((v) => v.kind === 'removeConnection');
    const moves = verbs.filter((v) => v.kind === 'moveNode');
    const rootAdds = adds.filter((verb) => (verb.node.parentId ?? null) === null);

    /*
     * A gesture that touched several things is named by its LABEL if it has one —
     * "Install Beat rig" beats any list this could assemble, and "Duplicate
     * nodes" is what the menu row and the shortcut both call the command.
     *
     * The two faces are not the same sentence, though. `name` is the command, so
     * it reads correctly after "Undo" ("Undo Duplicate nodes"). `done` is what
     * happened, and when the gesture produced exactly ONE card it can say which
     * ("Duplicated Sampler"). That is the difference between a button, which
     * names what it will do, and an announcement, which names what occurred.
     */
    if (labelledPhrase) {
        const only = rootAdds.length === 1 ? named(rootAdds[0].node.id) : null;
        const past = only ? toPast(`${firstWord(labelledPhrase)} ${only}`) : null;
        return { name: labelledPhrase, done: past ?? toPast(labelledPhrase) };
    }

    /*
     * Adding ONE card is often several `addNode` verbs: a Looper arrives with its
     * own internal nodes, a Sampler with four. "Added 3 nodes" is true and
     * useless — the player added a Looper. So the CARD is the add whose parent is
     * the canvas; the rest are its insides, and nobody asked about those.
     */
    const headline = rootAdds.length === 1 ? rootAdds[0] : adds.length === 1 ? adds[0] : null;
    if (headline && removes.length === 0) {
        /*
         * The wires an add brings WITH it are the card's insides, not a separate
         * verb. Requiring `wires.length === 0` here is what produced the
         * ungrammatical "Added 1 nodes" for every pre-wired card (measured on
         * `Add Sampler`, whose internal `addConnection`s land in the same
         * entry) — HA-09's exact defect surviving inside the feature built to
         * close it. A card that arrives already wired says so, briefly.
         */
        const name = named(headline.node.id);
        const wired = wires.length > 0 ? ', wired' : '';
        return { name: `Add ${name}`, done: `Added ${name}${wired}` };
    }
    if (removes.length === 1 && adds.length === 0) {
        const name = named(removes[0].nodeId);
        return { name: `Delete ${name}`, done: `Deleted ${name}` };
    }
    if (wires.length === 1 && adds.length === 0 && removes.length === 0) {
        const { sourceNodeId, targetNodeId } = wires[0].connection;
        const from = named(sourceNodeId);
        const to = named(targetNodeId);
        return { name: `Connect ${from} to ${to}`, done: `Connected ${from} to ${to}` };
    }
    if (unwires.length >= 1 && wires.length === 0 && adds.length === 0 && removes.length === 0) {
        const count = unwires.length;
        const cables = count === 1 ? 'cable' : `${count} cables`;
        return { name: `Disconnect ${cables}`, done: `Disconnected ${cables}` };
    }
    if (moves.length > 0 && adds.length === 0 && removes.length === 0 && wires.length === 0) {
        const cards = moves.length === 1 ? named(moves[0].nodeId) : `${moves.length} nodes`;
        return { name: `Move ${cards}`, done: `Moved ${cards}` };
    }
    if (adds.length > 1 || removes.length > 1) {
        // Count the CARDS, not their insides — a rig is "13 nodes" only if it
        // really put thirteen things on the canvas. And a count of one is never
        // a count: name the card instead, and never write "1 nodes". The word is
        // "nodes" because that is what the app's own labels say ("Paste nodes",
        // "Select All Nodes") — one word for one concept (U10).
        if (adds.length > 1 && rootAdds.length === 1) {
            const name = named(rootAdds[0].node.id);
            return { name: `Add ${name}`, done: `Added ${name}${wires.length > 0 ? ', wired' : ''}` };
        }
        const count = adds.length > 1 ? (rootAdds.length || adds.length) : removes.length;
        const noun = count === 1 ? 'node' : 'nodes';
        const verb = adds.length > 1 ? ['Add', 'Added'] : ['Delete', 'Deleted'];
        return { name: `${verb[0]} ${count} ${noun}`, done: `${verb[1]} ${count} ${noun}` };
    }

    return { name: 'Edit graph', done: 'Edited the graph' };
}
