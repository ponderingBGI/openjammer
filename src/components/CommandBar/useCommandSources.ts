/**
 * Command sources (U19)
 *
 * Derives the initial set of {@link Command}s from existing app data and wires
 * them into the {@link register registry} for the lifetime of the mounted
 * command bar:
 *
 * 1. Node-add commands — one per registered {@link nodeDefinitions} entry that
 *    appears in a user-facing {@link menuCategories} bucket, grouped by the
 *    node's {@link NodeCategory}. (`registry.ts` is imported READ-ONLY.)
 * 2. App actions — trivial global toggles dispatched as the same window
 *    CustomEvents the toolbar/menus already listen for (settings, help).
 *
 * Future AI-generated nodes register through the SAME `commandRegistry`
 * singleton, so they appear here automatically without touching this file.
 */

import { useEffect } from 'react';
import { nodeDefinitions, menuCategories } from '../../engine/registry';
import type { NodeCategory, NodeType, Position } from '../../engine/types';
import { useGraphStore } from '../../store/graphStore';
import { useCanvasStore } from '../../store/canvasStore';
import { useCanvasNavigationStore } from '../../store/canvasNavigationStore';
import { registerAll } from '../../store/commandRegistry';
import type { Command } from '../../store/commandRegistry';

// Human-readable group label per category (matches the menu's casing).
const CATEGORY_LABEL: Record<NodeCategory, string> = {
    instruments: 'Instruments',
    input: 'Input',
    effects: 'Effects',
    routing: 'Routing',
    output: 'Output',
    utility: 'Utility',
};

/**
 * Spawn a new node of `type` at the centre of the current viewport, inside the
 * canvas level the user is currently viewing. Mirrors NodeCanvas's add path
 * (screen point -> canvas coords -> addNode with the active parent) without
 * importing anything from the read-only Nodes lane.
 */
function addNodeAtViewportCenter(type: NodeType): void {
    const screenCenter: Position = {
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
    };
    const canvasPos = useCanvasStore.getState().screenToCanvas(screenCenter);
    const parentId = useCanvasNavigationStore.getState().currentViewNodeId;
    useGraphStore.getState().addNode(type, canvasPos, parentId);
}

/**
 * Build the node-add commands. Only node types surfaced in `menuCategories`
 * become commands — internal/visual helper types (e.g. `*-visual`,
 * `canvas-input`) are intentionally excluded, exactly as the right-click menu
 * excludes them.
 */
function buildNodeCommands(): Command[] {
    const userFacingTypes = new Set<NodeType>(
        menuCategories.flatMap((category) => category.items),
    );

    const result: Command[] = [];
    for (const type of userFacingTypes) {
        const def = nodeDefinitions[type];
        if (!def) continue;
        result.push({
            id: `node.add.${type}`,
            title: `Add ${def.name}`,
            group: CATEGORY_LABEL[def.category] ?? def.category,
            keywords: [def.type, def.category, def.description, 'add', 'node', 'create'],
            run: () => addNodeAtViewportCenter(type),
        });
    }
    return result;
}

/**
 * App-action commands sourced from menus/keybindings where trivially available.
 * These reuse the existing window CustomEvent seam (see App.tsx / HelpPanel.tsx).
 */
function buildAppCommands(): Command[] {
    return [
        {
            id: 'app.settings.toggle',
            title: 'Open Settings',
            group: 'App',
            keywords: ['settings', 'preferences', 'theme', 'audio', 'keybindings'],
            run: () => window.dispatchEvent(new CustomEvent('openjammer:toggle-settings')),
        },
        {
            id: 'app.help.toggle',
            title: 'Toggle Help',
            group: 'App',
            keywords: ['help', 'shortcuts', 'keys', 'guide'],
            run: () => window.dispatchEvent(new CustomEvent('openjammer:toggle-help')),
        },
        {
            id: 'app.project.new',
            title: 'New Project',
            group: 'App',
            keywords: ['new', 'project', 'create', 'file'],
            run: () => window.dispatchEvent(new CustomEvent('openjammer:new-project')),
        },
    ];
}

/**
 * Register the derived command sources for as long as the command bar is
 * mounted. The registry is keyed by id, so this is safe across re-mounts.
 */
export function useCommandSources(): void {
    useEffect(() => {
        return registerAll([...buildNodeCommands(), ...buildAppCommands()]);
    }, []);
}
