/**
 * Canvas Navigation Store - Manages hierarchical canvas navigation
 *
 * Simplified to track just "which node's children are we viewing?"
 * - currentViewNodeId = null → viewing root level nodes
 * - currentViewNodeId = "node-123" → viewing children of that node
 *
 * Navigation uses the flat structure with parentId references to traverse.
 */

import { create } from 'zustand';
import type { GraphNode, Position } from '../engine/types';
import { useGraphStore, getNodeDimensions } from './graphStore';
import { useCanvasStore } from './canvasStore';

// Root view state (stored separately since root has no parent node)
interface RootViewState {
    pan: Position;
    zoom: number;
}

interface CanvasNavigationState {
    // The single source of truth: which node's children are we viewing?
    // null = viewing root level, otherwise = viewing inside that node
    currentViewNodeId: string | null;

    // Root level viewport state (since root has no node to store it)
    rootViewState: RootViewState | null;

    // Actions
    enterNode: (nodeId: string) => void;
    exitToParent: () => void;
    exitToRoot: () => void;

    // Helper getters (derived from flat structure)
    getCurrentPath: () => GraphNode[];  // Path from root to current view
    getCurrentDepth: () => number;       // How deep we are (0 = root)
}

export const useCanvasNavigationStore = create<CanvasNavigationState>((set, get) => ({
    currentViewNodeId: null,
    rootViewState: null,

    // Enter a node's internal view
    enterNode: (nodeId: string) => {
        const graphStore = useGraphStore.getState();
        const canvasStore = useCanvasStore.getState();
        const state = get();

        // Get the target node
        const targetNode = graphStore.nodes.get(nodeId);
        if (!targetNode) {
            console.error('Cannot enter node: node not found', nodeId);
            return;
        }

        // Clear selection when changing levels
        graphStore.clearSelection();

        // Save current viewport state
        if (state.currentViewNodeId === null) {
            // Currently at root - save to rootViewState
            set({
                rootViewState: {
                    pan: { ...canvasStore.pan },
                    zoom: canvasStore.zoom
                }
            });
        } else {
            // Currently inside a node - save to that node's internalViewport
            const currentNode = graphStore.nodes.get(state.currentViewNodeId);
            if (currentNode) {
                const updatedNode: GraphNode = {
                    ...currentNode,
                    internalViewport: {
                        pan: { ...canvasStore.pan },
                        zoom: canvasStore.zoom
                    }
                };
                // Directly update the node in the store
                const newNodes = new Map(graphStore.nodes);
                newNodes.set(currentNode.id, updatedNode);
                useGraphStore.setState({ nodes: newNodes });
            }
        }

        // Update current view to the target node
        set({ currentViewNodeId: nodeId });

        // Restore or initialize viewport for the new view
        if (targetNode.internalViewport) {
            // Restore previously saved viewport
            canvasStore.setPan(targetNode.internalViewport.pan);
            canvasStore.setZoom(targetNode.internalViewport.zoom);
        } else {
            // First time entering - auto-center on children
            const children = graphStore.getNodeChildren(nodeId);
            if (children.length > 0) {
                // Calculate bounds of child nodes
                let minX = Infinity, minY = Infinity;
                let maxX = -Infinity, maxY = -Infinity;

                children.forEach(node => {
                    const dims = getNodeDimensions(node);
                    minX = Math.min(minX, node.position.x);
                    minY = Math.min(minY, node.position.y);
                    maxX = Math.max(maxX, node.position.x + dims.width);
                    maxY = Math.max(maxY, node.position.y + dims.height);
                });

                const bounds = {
                    x: minX,
                    y: minY,
                    width: maxX - minX,
                    height: maxY - minY,
                    centerX: (minX + maxX) / 2,
                    centerY: (minY + maxY) / 2
                };

                canvasStore.fitToNodes(bounds, window.innerWidth, window.innerHeight);
            } else {
                // No children - center on origin
                canvasStore.setPan({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
                canvasStore.setZoom(1);
            }
        }
    },

    // Go back up one level (exit current node, view parent's siblings)
    exitToParent: () => {
        const graphStore = useGraphStore.getState();
        const canvasStore = useCanvasStore.getState();
        const state = get();

        // Already at root - nothing to do
        if (state.currentViewNodeId === null) return;

        // Get current node
        const currentNode = graphStore.nodes.get(state.currentViewNodeId);
        if (!currentNode) {
            // Node not found (deleted?) - gracefully reset to root without calling exitToRoot
            // (which would try to save viewport to the missing node)
            console.warn('exitToParent: current node not found, resetting to root');
            graphStore.clearSelection();
            set({ currentViewNodeId: null });
            // Restore root viewport if available
            if (state.rootViewState) {
                canvasStore.setPan(state.rootViewState.pan);
                canvasStore.setZoom(state.rootViewState.zoom);
            }
            return;
        }

        // Clear selection when changing levels
        graphStore.clearSelection();

        // Save current viewport to the node we're leaving
        const updatedCurrentNode: GraphNode = {
            ...currentNode,
            internalViewport: {
                pan: { ...canvasStore.pan },
                zoom: canvasStore.zoom
            }
        };
        const newNodes = new Map(graphStore.nodes);
        newNodes.set(currentNode.id, updatedCurrentNode);
        useGraphStore.setState({ nodes: newNodes });

        // Move up to parent's view
        const parentId = currentNode.parentId;
        set({ currentViewNodeId: parentId });

        // Restore parent's viewport
        if (parentId === null) {
            // Going back to root
            if (state.rootViewState) {
                canvasStore.setPan(state.rootViewState.pan);
                canvasStore.setZoom(state.rootViewState.zoom);
            }
        } else {
            // Going back to another node
            const parentNode = graphStore.nodes.get(parentId);
            if (parentNode?.internalViewport) {
                canvasStore.setPan(parentNode.internalViewport.pan);
                canvasStore.setZoom(parentNode.internalViewport.zoom);
            }
        }
    },

    // Reset directly to root canvas
    exitToRoot: () => {
        const graphStore = useGraphStore.getState();
        const canvasStore = useCanvasStore.getState();
        const state = get();

        // Already at root
        if (state.currentViewNodeId === null) return;

        // Save current viewport before leaving
        const currentNode = graphStore.nodes.get(state.currentViewNodeId);
        if (currentNode) {
            const updatedNode: GraphNode = {
                ...currentNode,
                internalViewport: {
                    pan: { ...canvasStore.pan },
                    zoom: canvasStore.zoom
                }
            };
            const newNodes = new Map(graphStore.nodes);
            newNodes.set(currentNode.id, updatedNode);
            useGraphStore.setState({ nodes: newNodes });
        }

        // Clear selection
        graphStore.clearSelection();

        // Reset to root
        set({ currentViewNodeId: null });

        // Restore root viewport
        if (state.rootViewState) {
            canvasStore.setPan(state.rootViewState.pan);
            canvasStore.setZoom(state.rootViewState.zoom);
        }
    },

    // Get the path from root to current view
    getCurrentPath: () => {
        const graphStore = useGraphStore.getState();
        const state = get();

        if (state.currentViewNodeId === null) return [];

        const path: GraphNode[] = [];
        let currentId: string | null = state.currentViewNodeId;

        // Walk up the parent chain
        while (currentId !== null) {
            const node = graphStore.nodes.get(currentId);
            if (!node) break;
            path.unshift(node);  // Add to front
            currentId = node.parentId;
        }

        return path;
    },

    // Get current depth (0 = root)
    getCurrentDepth: () => {
        const graphStore = useGraphStore.getState();
        const state = get();

        if (state.currentViewNodeId === null) return 0;

        let depth = 1;
        let currentId: string | null = state.currentViewNodeId;

        while (currentId !== null) {
            const node = graphStore.nodes.get(currentId);
            if (!node?.parentId) break;
            currentId = node.parentId;
            depth++;
        }

        return depth;
    }
}));
