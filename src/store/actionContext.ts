/**
 * Action context (M2) — the SINGLE reader of the capability seam + selection.
 *
 * Every surface that runs {@link Action}s needs an {@link ActionCtx}: the
 * platform capability ceiling plus the "what is currently targeted" snapshot.
 * This module owns BOTH surface builders. It is the only place that reads
 * `getExecutor().getCapabilities()` together with `useGraphStore` selection, so
 * the rest of the surfaces stay declarative:
 *  - {@link buildPaletteCtx} — Ctrl/Cmd+K (no canvas point).
 *  - {@link buildMenuCtx} — the right-click context menu (M4): carries the
 *    clicked canvas `point` and, when right-clicking a node, that `node`.
 *
 * IMPORTANT (mutation discipline): the `node` / `selectedIds` captured here are a
 * DISPLAY / `enabled`-gating snapshot. Action `run(ctx)` handlers must RE-READ
 * `useGraphStore.getState()` by id before mutating — never mutate the snapshot.
 */

import { getExecutor } from '../audio/executor';
import { useGraphStore } from './graphStore';
import type { ActionCtx, TargetKind } from './commandRegistry';
import type { Position, GraphNode } from '../engine/types';

/**
 * Build the palette's {@link ActionCtx} from the live capability seam + current
 * graph selection.
 *
 * - `caps` ← `getExecutor().getCapabilities()` (the ONE seam).
 * - `targetKinds` always includes `'global'` and `'selection'`; when EXACTLY one
 *   node is selected it also includes `'node'` and sets `node`.
 * - `selectedIds` ← the current selection (registration/insertion order of the
 *   underlying Set).
 * - `point` is undefined: the palette has no canvas point.
 */
export function buildPaletteCtx(): ActionCtx {
    const caps = getExecutor().getCapabilities();
    const graph = useGraphStore.getState();
    const selectedIds = Array.from(graph.selectedNodeIds);

    const targetKinds: TargetKind[] = ['global', 'selection'];
    let node: ActionCtx['node'];

    if (selectedIds.length === 1) {
        const only = graph.nodes.get(selectedIds[0]);
        if (only) {
            targetKinds.push('node');
            node = only;
        }
    }

    return {
        caps,
        targetKinds,
        selectedIds,
        node,
        point: undefined,
    };
}

/**
 * Build the context menu's {@link ActionCtx} from the live capability seam + the
 * clicked canvas point (and the right-clicked node, when one is given).
 *
 * - `caps` ← `getExecutor().getCapabilities()` (the same ONE seam as the palette).
 * - `targetKinds` always includes `'global'`, `'canvasPoint'` and `'selection'`;
 *   when `opts.node` is given it ALSO includes `'node'` and sets `node`. (Port /
 *   connection right-click targets are a FUTURE milestone — intentionally absent.)
 * - `point` ← `opts.point` (the canvas-space click position the menu acts at).
 * - `selectedIds` ← the current selection snapshot.
 *
 * Like the palette ctx this is a DISPLAY snapshot: `run(ctx)` handlers must
 * RE-READ `useGraphStore.getState()` by id before mutating.
 */
export function buildMenuCtx(opts: { point: Position; node?: GraphNode }): ActionCtx {
    const caps = getExecutor().getCapabilities();
    const graph = useGraphStore.getState();
    const selectedIds = Array.from(graph.selectedNodeIds);

    const targetKinds: TargetKind[] = ['global', 'canvasPoint', 'selection'];
    let node: ActionCtx['node'];

    if (opts.node) {
        targetKinds.push('node');
        node = opts.node;
    }

    return {
        caps,
        targetKinds,
        selectedIds,
        node,
        point: opts.point,
    };
}

/**
 * Context key for context-aware frecency. Single-selected node → `sel:${type}`
 * so a learned pick is keyed to "while a <type> node is selected"; otherwise
 * `'canvas:empty'`. (The menu's richer key is M4 — not added here.)
 */
export function paletteContextKey(ctx: ActionCtx): string {
    if (ctx.node) return `sel:${ctx.node.type}`;
    return 'canvas:empty';
}
