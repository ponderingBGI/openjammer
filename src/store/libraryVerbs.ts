/**
 * The library's half of the undo seam — the same shape `graphVerbs.ts` gives the
 * graph, and for the same reason.
 *
 * The gate measured it plainly: **no Library action was undoable**. Rename,
 * trash, restore, tagging and tag deletion all live in `libraryStore`, which is
 * not the graph, so none of them ever reached the history stack — and `Ctrl+Z`
 * after one of them replayed the last GRAPH entry instead, which on a fresh
 * canvas is still "add the Library node". The card left the screen.
 *
 * The fix follows the existing pattern rather than forking a second history:
 * one verb, applied by one registered `registerHistoryDriver` driver, recorded
 * through the SAME `useHistoryStore.record(forward, inverse, label)` the graph
 * uses — so a step that touches the graph AND the library inside one
 * `beginGesture` bracket is still one entry and one `Ctrl+Z`.
 *
 * Two properties this file exists to keep:
 *
 *  1. **Metadata only, never audio.** A `LibraryItem` is the record card for a
 *     sample (name, tags, duration, handle KEY, crop frames) — its PCM lives
 *     behind a `FileSystemFileHandle` and its peaks in IndexedDB. So a patch
 *     carries references, and undoing "trash a file" restores the reference, not
 *     a copy of the audio.
 *  2. **Opt-in, never a blanket wrapper.** `libraryStore` is written to by
 *     folder scans, waveform loads and relink passes as well as by players. A
 *     `set`-wrapper diff (the graph's trick) would push undo entries for a
 *     directory scan. So a caller opts in per gesture with
 *     {@link recordLibraryEdit}, and everything else stays out of history.
 */

import { useLibraryStore, type LibraryItem } from './libraryStore';
import { isApplyingHistory, registerHistoryDriver, useHistoryStore, type EditVerb, type HistoryScope } from './historyStore';

/**
 * A reversible delta over the library's *player-owned* state.
 *
 * `items` maps an item id to its whole record, or to `null` for "this item is
 * not there". Whole records rather than field patches because the inverse then
 * needs no schema knowledge — the same reason `GraphVerb.setNodeData` carries
 * the whole `data` object. The three tag fields are present only when the
 * gesture actually moved them, so undoing a rename never also snaps the
 * player's current filter back.
 */
export type LibraryVerb = {
    kind: 'patchLibrary';
    items: Record<string, LibraryItem | null>;
    allTags?: string[];
    pinnedTags?: string[];
    activeFilterTag?: string | null;
};

interface LibrarySnapshot {
    items: Record<string, LibraryItem>;
    allTags: string[];
    pinnedTags: string[];
    activeFilterTag: string | null;
}

function snapshot(): LibrarySnapshot {
    const state = useLibraryStore.getState();
    return {
        items: state.items,
        allTags: state.allTags,
        pinnedTags: state.pinnedTags,
        activeFilterTag: state.activeFilterTag,
    };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Apply a patch. The driver at the bottom of this file is its ONLY caller, so
 *  it stays module-private: a UI edit goes through {@link recordLibraryEdit},
 *  which is what puts the step on the stack in the first place. */
function applyLibraryVerb(verb: LibraryVerb): void {
    const state = useLibraryStore.getState();
    const items = { ...state.items };
    for (const [id, item] of Object.entries(verb.items)) {
        if (item === null) delete items[id];
        else items[id] = item;
    }
    useLibraryStore.setState({
        items,
        allTags: verb.allTags ?? state.allTags,
        pinnedTags: verb.pinnedTags ?? state.pinnedTags,
        activeFilterTag: verb.activeFilterTag === undefined ? state.activeFilterTag : verb.activeFilterTag,
    });
}

/** The reversible pair for a change that already happened. `null` when nothing
 *  the player owns actually moved.
 *
 *  It covers `items` and the three tag fields — the player-owned state. It does
 *  NOT cover `libraries[id].itemCount`, which `emptyTrash` and
 *  `permanentlyDeleteItem` both mutate. That is harmless only because those two
 *  are exactly the SEALED pair: their inverse is their forward, so nothing is
 *  restored and no count can drift. The first RECORDED action that changes an
 *  item count has to add it here, or undo will leave the sidebar counting
 *  files that are back. */
function diffLibrary(
    before: LibrarySnapshot,
    after: LibrarySnapshot,
): { forward: LibraryVerb; inverse: LibraryVerb } | null {
    const forwardItems: Record<string, LibraryItem | null> = {};
    const inverseItems: Record<string, LibraryItem | null> = {};
    for (const id of new Set([...Object.keys(before.items), ...Object.keys(after.items)])) {
        const was = before.items[id] ?? null;
        const now = after.items[id] ?? null;
        if (same(was, now)) continue;
        forwardItems[id] = now;
        inverseItems[id] = was;
    }
    const forward: LibraryVerb = { kind: 'patchLibrary', items: forwardItems };
    const inverse: LibraryVerb = { kind: 'patchLibrary', items: inverseItems };
    let moved = Object.keys(forwardItems).length > 0;
    if (!same(before.allTags, after.allTags)) {
        forward.allTags = after.allTags;
        inverse.allTags = before.allTags;
        moved = true;
    }
    if (!same(before.pinnedTags, after.pinnedTags)) {
        forward.pinnedTags = after.pinnedTags;
        inverse.pinnedTags = before.pinnedTags;
        moved = true;
    }
    if (before.activeFilterTag !== after.activeFilterTag) {
        forward.activeFilterTag = after.activeFilterTag;
        inverse.activeFilterTag = before.activeFilterTag;
        moved = true;
    }
    return moved ? { forward, inverse } : null;
}

/**
 * `sealed` steps are for a gesture whose payload is destroyed OUTSIDE the store
 * and cannot come back: permanently deleting an item, or emptying the trash,
 * both of which drop the item's waveform and file handle from IndexedDB. The
 * step's inverse is its forward, so `Ctrl+Z` consumes it and changes nothing: it
 * neither resurrects a record whose payload is gone (a row that looks restored
 * and plays nothing is a lie) nor walks past it into the entry that would delete
 * the card. Both callers ask first, in the card.
 */
function finish(before: LibrarySnapshot, label: string, scope: HistoryScope, sealed: boolean): void {
    // The same guard `graphStore` and `arrangementStore` open their recorders
    // with. Replaying history must never record history. No call site can reach
    // it that way today — every one is a DOM handler, and the driver writes
    // through `setState` rather than through a recorder — but this is the line
    // that keeps that true when a future caller runs inside an effect.
    if (isApplyingHistory()) return;
    const delta = diffLibrary(before, snapshot());
    if (!delta) return;
    const forward: EditVerb = { domain: 'library', verb: delta.forward };
    const inverse: EditVerb = sealed
        ? structuredClone(forward)
        : { domain: 'library', verb: delta.inverse };
    useHistoryStore.getState().record([forward], [inverse], label, scope);
}

/**
 * Run one player gesture against the library and put it on the undo stack as
 * ONE step.
 *
 * `scope` stays `'graph'` because these gestures are driven from the Library
 * card on the canvas, so an undo should return the player's attention there.
 * Inside an open `beginGesture` bracket this merges into that bracket, which is
 * what makes a graph edit and a library edit in one gesture one `Ctrl+Z`.
 */
export function recordLibraryEdit(label: string, mutate: () => void, scope: HistoryScope = 'graph'): void {
    const before = snapshot();
    mutate();
    finish(before, label, scope, false);
}

/** The sealed recorder for the two asynchronous destroyers (`emptyTrash`,
 *  `permanentlyDeleteItem`): the snapshot is taken before the await so the step
 *  still lands even though the store settles a tick later. */
export async function recordSealedLibraryEditAsync(
    label: string,
    mutate: () => Promise<void>,
    scope: HistoryScope = 'graph',
): Promise<void> {
    const before = snapshot();
    await mutate();
    finish(before, label, scope, true);
}

registerHistoryDriver((verbs) => {
    for (const item of verbs) {
        if (item.domain === 'library') applyLibraryVerb(item.verb);
    }
});
