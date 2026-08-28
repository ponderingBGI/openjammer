/**
 * Port Position Calculator
 *
 * Calculates port positions using a hybrid approach:
 * 1. Fixed positions - ports with explicit position defined
 * 2. Dynamic positions - calculated from portLayout config
 *
 * All positions are in canvas coordinates (not screen coordinates).
 */

import type { GraphNode, PortDefinition, PortLayoutConfig, Position } from '../engine/types';
import { getNodeDefinition } from '../engine/registry';
import { getNodeDimensions } from '../store/graphStore';

/**
 * New DNA socket geometry (master-plan D7). Sockets are recessed wells INSIDE
 * the node body, not dots on the card edge, so the fallback math has to land on
 * the same pixel the DOM does — otherwise every canvas mount and every node add
 * paints one frame of cables hooked to the card's corners and then snaps. The
 * covenant calls that a bug, not a cosmetic issue.
 *
 * The numbers are measured off the rendered card, not guessed:
 *   x: 14px body padding + 9px socket radius              = 23px from the edge
 *   y: 39px header + 12px body padding + 9px socket radius = 60px from the top
 *   step: 18px well + 8px row gap                          = 26px per row
 *
 * `SOCKET_*_PX` are exported because the registry's normalized `position`
 * literals are derived from them — `src/engine/__tests__/socketGeometry.test.ts`
 * recomputes every edge-anchored literal from these constants and the node's own
 * declared dimensions, so the two can never drift apart silently.
 */
export const SOCKET_INSET_PX = 23;
export const SOCKET_ROW_TOP_PX = 60;
export const SOCKET_ROW_STEP_PX = 26;

/**
 * Normalized x of the socket column for a node `width` px wide. Clamped at 30%
 * so the two columns of a very narrow card can never cross in the middle — a
 * few node types declare nominal boxes far smaller than the card they actually
 * render (`keyboard-key` says 50x50), and a fallback that puts the input on top
 * of the output would be worse than the edge it replaced.
 */
export function socketColumnX(width: number, side: 'input' | 'output'): number {
    const inset = Math.min(SOCKET_INSET_PX / width, 0.3);
    return side === 'input' ? inset : 1 - inset;
}

/** Normalized y of the `index`-th socket row on a node `height` px tall. */
export function socketRowY(height: number, index = 0): number {
    return (SOCKET_ROW_TOP_PX + index * SOCKET_ROW_STEP_PX) / height;
}

// Default port layout when none specified. `x: 0 / 1` names the input and
// output SIDE; resolveSocketX turns that into the real in-body column for this
// node's width. The band is top-weighted because the sockets open the body
// rather than straddling the card's vertical middle.
const DEFAULT_PORT_LAYOUT: Required<PortLayoutConfig> = {
    direction: 'vertical',
    inputArea: { x: 0, startY: 0.45, endY: 0.85 },
    outputArea: { x: 1, startY: 0.45, endY: 0.85 }
};

/**
 * Get the canvas-space position for a specific port on a node
 */
export function getPortPosition(node: GraphNode, portId: string): Position | null {
    const port = node.ports.find(p => p.id === portId);
    if (!port) return null;

    const definition = getNodeDefinition(node.type);
    const dimensions = definition.dimensions ?? getNodeDimensions(node);
    const portLayout = definition.portLayout ?? {};

    // Merge with defaults. The default areas are edge-anchored (x 0 / 1) because
    // that is what "the input side" means; resolveSocketX turns that into the
    // real in-body column for this node's width.
    const layout: Required<PortLayoutConfig> = {
        direction: portLayout.direction ?? DEFAULT_PORT_LAYOUT.direction,
        inputArea: portLayout.inputArea ?? DEFAULT_PORT_LAYOUT.inputArea,
        outputArea: portLayout.outputArea ?? DEFAULT_PORT_LAYOUT.outputArea
    };

    // If port has explicit position, use it — with the same edge-to-column
    // resolution the dynamic path gets, so an author writing "the output side"
    // as x: 1 lands on the socket, not on the card's corner.
    if (port.position) {
        return {
            x: node.position.x + resolveSocketX(port.position.x, dimensions.width) * dimensions.width,
            y: node.position.y + port.position.y * dimensions.height
        };
    }

    // Calculate dynamic position based on layout
    return calculateDynamicPortPosition(node, port, layout, dimensions);
}

/**
 * Calculate position for a port without explicit position
 */
function calculateDynamicPortPosition(
    node: GraphNode,
    port: PortDefinition,
    layout: Required<PortLayoutConfig>,
    dimensions: { width: number; height: number }
): Position {
    const isInput = port.direction === 'input';
    const area = isInput ? layout.inputArea : layout.outputArea;

    // Get all ports of same direction without explicit position
    const dynamicPorts = node.ports.filter(p =>
        p.direction === port.direction && !p.position
    );

    const portIndex = dynamicPorts.findIndex(p => p.id === port.id);
    const totalPorts = dynamicPorts.length;

    // Calculate position within the spawn area
    let normalizedX: number;
    let normalizedY: number;

    if (layout.direction === 'vertical') {
        normalizedX = area.x;

        if (totalPorts === 1) {
            // Single port: center in area
            normalizedY = (area.startY + area.endY) / 2;
        } else {
            // Multiple ports: evenly distributed
            const range = area.endY - area.startY;
            const step = range / (totalPorts - 1);
            normalizedY = area.startY + portIndex * step;
        }
    } else {
        // Horizontal layout
        normalizedY = (area.startY + area.endY) / 2;

        if (totalPorts === 1) {
            normalizedX = area.x;
        } else {
            // For horizontal, we need startX/endX - use x as center and spread
            const spread = 0.3; // 30% of width for horizontal spread
            const startX = Math.max(0, area.x - spread / 2);
            const endX = Math.min(1, area.x + spread / 2);
            const range = endX - startX;
            const step = range / (totalPorts - 1);
            normalizedX = startX + portIndex * step;
        }
    }

    return {
        x: node.position.x + resolveSocketX(normalizedX, dimensions.width) * dimensions.width,
        y: node.position.y + normalizedY * dimensions.height
    };
}

/**
 * Pull an edge-anchored x (0 = left rail, 1 = right rail) in to the socket
 * column. Anything between the rails is a bespoke faceplate coordinate (the
 * visual keyboard's keys, MiniLab's knobs) and is left exactly where the node
 * author put it.
 */
function resolveSocketX(normalizedX: number, width: number): number {
    if (normalizedX <= 0) return socketColumnX(width, 'input');
    if (normalizedX >= 1) return socketColumnX(width, 'output');
    return normalizedX;
}

/**
 * Get all port positions for a node
 * Returns a Map of portId -> Position
 */
export function getAllPortPositions(node: GraphNode): Map<string, Position> {
    const positions = new Map<string, Position>();

    for (const port of node.ports) {
        const pos = getPortPosition(node, port.id);
        if (pos) {
            positions.set(port.id, pos);
        }
    }

    return positions;
}

/**
 * Check if a click position is near a port
 * Returns the port ID if within threshold, null otherwise
 */
export function findPortAtPosition(
    node: GraphNode,
    clickPos: Position,
    threshold: number = 15
): string | null {
    for (const port of node.ports) {
        const portPos = getPortPosition(node, port.id);
        if (!portPos) continue;

        const dx = clickPos.x - portPos.x;
        const dy = clickPos.y - portPos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance <= threshold) {
            return port.id;
        }
    }

    return null;
}
