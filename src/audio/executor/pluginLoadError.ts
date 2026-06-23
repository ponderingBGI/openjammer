/**
 * Per-node degraded-plugin surface (invariant #4a, non-focus-stealing).
 *
 * When a node degrades to a labeled passthrough stub — a hosted VST3/CLAP/AU
 * plugin that is MISSING or `abi`-incompatible on load, or a code node whose
 * kernel trapped — the engine keeps the project running (a held note beats a
 * glitch) and flags the affected node so its UI shows a small "(missing plugin)"
 * badge. Never a modal, never a toast storm. The flag lives on `node.data` and
 * clears automatically the moment the plugin resolves again (a rescan/auto-rebind
 * re-pushes a clean graph).
 *
 * SSOT + REV-1: written through `useGraphStore.getState().updateNodeData` OUTSIDE
 * any begin/endGesture and only when the value actually changes — so this
 * engine-derived runtime state never lands in the user's undo history.
 *
 * Shared by BOTH executors (native degraded_stubs + wasm last_degraded_node_ids)
 * so there is one degraded path, not a fork (code-value #2: extend the pillar).
 * The sibling of `setNodeVoiceLoadError` (the built-in voice surface).
 */

import { useGraphStore } from '../../store/graphStore';
import type { NodeData } from '../../engine/types';

/**
 * A short human label for a node's degraded log line: `"<id> (<plugin-or-type>)"`.
 * Used by {@link import('./faultPipe').logNewlyDegradedStubs} so both executor tiers
 * surface a missing/incompatible plugin to the DevLog in one identical voice. Reads
 * the live graph node (the same SSOT this module already owns) — never throws on a
 * just-removed node (falls back to the bare id).
 */
export function describeNodeForLog(nodeId: string): string {
    const node = useGraphStore.getState().nodes.get(nodeId);
    const what = node?.pluginId ?? node?.type;
    return what ? `${nodeId} (${what})` : nodeId;
}

/** Set/clear `pluginLoadError` on a node, off the undo history. */
export function setNodePluginLoadError(nodeId: string, hasError: boolean): void {
    const store = useGraphStore.getState();
    const node = store.nodes.get(nodeId);
    if (!node) return;
    const current = (node.data as NodeData | undefined)?.pluginLoadError ?? false;
    // Only write on a real change — avoids churning the store (and re-renders) on
    // every graph push when the state is unchanged.
    if (current === hasError) return;
    // `updateNodeData` outside any gesture: engine-derived runtime state, not a
    // user edit, so it must NOT create an undo entry.
    store.updateNodeData<NodeData>(nodeId, { pluginLoadError: hasError });
}
