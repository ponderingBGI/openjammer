/**
 * Per-node default-voice load-error surface (ERR-1, non-focus-stealing).
 *
 * When an instrument node's BUILT-IN default voice fails to load (a bad PCM
 * build, a buffer-creation throw), the engine continues past it (a held note
 * beats a glitch) and flags the FAILING node so its UI shows a small "!" badge
 * — never a modal, never a toast storm. The flag lives on `node.data` so a
 * recovered voice clears it.
 *
 * SSOT + REV-1: written through `useGraphStore.getState().updateNodeData` with
 * `{ record: false }`, and only when the value actually changes — so a transient
 * engine-side load error never lands in the user's undo history.
 *
 * This file used to say "outside any begin/endGesture, so it stays out of
 * history". That was false: `graphStore`'s `set` wrapper diffs and records EVERY
 * graph mutation that is not a history replay, gesture or no gesture. So a
 * built-in voice failing mid-set minted an undo entry, and the player's next
 * `Ctrl+Z` — reaching for the note or cable they just made — un-flagged a badge
 * instead. Corrected in W6-SHIP with the same opt-out `pluginLoadError.ts` took.
 *
 * Shared by BOTH executors (native + wasm) so there is one error path, not a
 * fork (code-value #2: extend the pillar, never a parallel version).
 */

import { useGraphStore } from '../../store/graphStore';
import type { InstrumentNodeData } from '../../engine/types';

/** Set/clear `voiceLoadError` on an instrument node, off the undo history. */
export function setNodeVoiceLoadError(nodeId: string, hasError: boolean): void {
    const store = useGraphStore.getState();
    const node = store.nodes.get(nodeId);
    if (!node) return;
    const current = (node.data as InstrumentNodeData | undefined)?.voiceLoadError ?? false;
    // Only write on a real change — avoids churning the store (and re-renders) on
    // every graph push when the state is unchanged.
    if (current === hasError) return;
    // Engine-derived runtime state, not a user edit, so it must NOT create an
    // undo entry — said out loud, in the call.
    store.updateNodeData<InstrumentNodeData>(nodeId, { voiceLoadError: hasError }, { record: false });
}
