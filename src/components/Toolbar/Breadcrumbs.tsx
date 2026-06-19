/**
 * Breadcrumbs - Shows navigation path through nested node canvas levels
 *
 * Displays "main > Node1 > Node2" style navigation with clickable segments
 * to navigate back to any level in the hierarchy.
 */

import { useCallback } from 'react';
import { useCanvasNavigationStore } from '../../store/canvasNavigationStore';
import { getNodeDefinition } from '../../engine/registry';
import type { GraphNode } from '../../engine/types';
import { Button } from '@openjammer/oj-ui';
import './Breadcrumbs.css';

/**
 * Get display name for a node
 */
function getNodeDisplayName(node: GraphNode): string {
    const definition = getNodeDefinition(node.type);
    return definition?.name || node.type;
}

export function Breadcrumbs() {
    const currentViewNodeId = useCanvasNavigationStore((s) => s.currentViewNodeId);
    const getCurrentPath = useCanvasNavigationStore((s) => s.getCurrentPath);
    const exitToRoot = useCanvasNavigationStore((s) => s.exitToRoot);
    const enterNode = useCanvasNavigationStore((s) => s.enterNode);

    // Get the navigation path
    const path = getCurrentPath();
    const isAtRoot = currentViewNodeId === null;

    // Navigate to a specific level in the path
    const navigateToLevel = useCallback((index: number) => {
        // index -1 means root
        if (index === -1) {
            exitToRoot();
            return;
        }

        // Navigate to the node at the specified index
        // If clicking on the last item, do nothing (already there)
        if (index === path.length - 1) return;

        // To navigate to a specific level, we need to exit to parent repeatedly
        // or enter the specific node. Since the path gives us the node IDs,
        // we can use enterNode to go to the node at that index, but that would
        // enter INTO that node. We want to VIEW that node's siblings (parent's view).

        // The path[index] is the node we want to be viewing FROM (inside)
        // So we need to enter that node
        const targetNode = path[index];
        if (targetNode) {
            // Exit to root first, then enter each node in sequence
            exitToRoot();
            // Enter each node up to and including the target
            for (let i = 0; i <= index; i++) {
                const nodeInPath = path[i];
                if (nodeInPath) {
                    enterNode(nodeInPath.id);
                }
            }
        }
    }, [path, exitToRoot, enterNode]);

    // If at root and no navigation history, don't show breadcrumbs
    if (isAtRoot) {
        return null;
    }

    return (
        <div className="breadcrumbs">
            {/* Root level (main) */}
            <Button
                variant="ghost"
                className="breadcrumb-item"
                onClick={() => exitToRoot()}
                title="Go to main canvas"
            >
                main
            </Button>

            {/* Path segments */}
            {path.map((node, index) => {
                const displayName = getNodeDisplayName(node);
                return (
                    <span key={node.id} className="breadcrumb-segment">
                        <span className="breadcrumb-separator">&gt;</span>
                        {index === path.length - 1 ? (
                            // Current level - not clickable
                            <span className="breadcrumb-item breadcrumb-current">
                                {displayName}
                            </span>
                        ) : (
                            // Previous level - clickable
                            <Button
                                variant="ghost"
                                className="breadcrumb-item"
                                onClick={() => navigateToLevel(index)}
                                title={`Go to ${displayName}`}
                            >
                                {displayName}
                            </Button>
                        )}
                    </span>
                );
            })}
        </div>
    );
}
