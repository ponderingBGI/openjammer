import { beforeEach, describe, expect, it } from 'vitest';
import { useCanvasNavigationStore } from '../canvasNavigationStore';
import { useCanvasStore } from '../canvasStore';
import { useGraphStore } from '../graphStore';

describe('canvasNavigationStore viewport ownership', () => {
    beforeEach(() => {
        useGraphStore.setState({
            nodes: new Map(), connections: new Map(), connectionsByNode: new Map(),
            rootNodeIds: [], selectedNodeIds: new Set(), selectedConnectionIds: new Set(),
            clipboard: null, version: 0,
        });
        useCanvasNavigationStore.setState({ currentViewNodeId: null, rootViewState: null, viewStates: new Map() });
        useCanvasStore.setState({ pan: { x: 10, y: 20 }, zoom: 1.2, canvasRect: { left: 0, top: 0, width: 800, height: 600 } });
    });

    it('enters and exits containers without mutating audio graph nodes', () => {
        const containerId = useGraphStore.getState().addNode('container', { x: 0, y: 0 });
        const nodesBefore = useGraphStore.getState().nodes;
        const versionBefore = useGraphStore.getState().version;

        useCanvasNavigationStore.getState().enterNode(containerId);
        useCanvasStore.setState({ pan: { x: 30, y: 40 }, zoom: 1.5 });
        useCanvasNavigationStore.getState().exitToRoot();

        expect(useGraphStore.getState().nodes).toBe(nodesBefore);
        expect(useGraphStore.getState().version).toBe(versionBefore);
        expect(useCanvasNavigationStore.getState().viewStates.get(containerId)).toEqual({
            pan: { x: 30, y: 40 }, zoom: 1.5,
        });
    });
});
