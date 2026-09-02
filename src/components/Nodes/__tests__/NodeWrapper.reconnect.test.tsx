import { fireEvent, render, screen } from '@testing-library/react';
import type { MouseEvent } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NodeWrapper } from '../NodeWrapper';
import { useCanvasStore } from '../../../store/canvasStore';
import { useGraphStore } from '../../../store/graphStore';
import { useHistoryStore } from '../../../store/historyStore';

vi.mock('../SpeakerNode', () => ({
    SpeakerNode: ({ handleHeaderMouseDown }: { handleHeaderMouseDown?: (event: MouseEvent) => void }) => (
        <button type="button" data-testid="drag-handle" onMouseDown={handleHeaderMouseDown}>speaker</button>
    ),
}));

describe('NodeWrapper reconnect gesture', () => {
    beforeEach(() => {
        useGraphStore.setState({
            nodes: new Map(),
            connections: new Map(),
            connectionsByNode: new Map(),
            rootNodeIds: [],
            selectedNodeIds: new Set(),
            selectedConnectionIds: new Set(),
            clipboard: null,
            version: 0,
        });
        useHistoryStore.getState().clear();
        useCanvasStore.setState({
            isConnecting: false,
            connectingFrom: null,
            pendingDisconnect: null,
            hoverTarget: null,
        });
    });

    it('marks both schematic and NodeFrame node roots for geometry observation', () => {
        const graph = useGraphStore.getState();
        const schematicId = graph.addNode('speaker', { x: 0, y: 0 });
        const framedId = graph.addNode('effect', { x: 200, y: 0 });
        const { container } = render(<>
            <NodeWrapper node={useGraphStore.getState().nodes.get(schematicId)!} />
            <NodeWrapper node={useGraphStore.getState().nodes.get(framedId)!} />
        </>);
        expect(container.querySelector(`[data-canvas-node-root="${schematicId}"]`)).not.toBeNull();
        expect(container.querySelector(`[data-canvas-node-root="${framedId}"]`)).not.toBeNull();
    });

    /*
     * The `ghost-input-` test that stood here is gone with the branch it drove
     * (RG-05). It was the ONLY producer of a `ghost-input-` port id anywhere —
     * `git grep ghost-input-` at `HEAD` and across the tree hit the two lines
     * that consumed the id and this mock, which invented it. The live
     * "always one empty port" affordance is `PortPanelNode`'s `empty-…` socket,
     * a real port that takes the ordinary path. A test that keeps fifty lines of
     * production code alive by being their only caller is not coverage; it is a
     * second copy of the requirement (agents.md value #8).
     *
     * What that test really pinned — one gesture, one `Ctrl+Z` — is pinned by the
     * cable MOVE test in `outputFanOut.test.tsx`, which lands a real cable
     * through the same module and asserts `cursor + 1` and an exact round trip.
     */

    it('keeps clicks history-neutral, toggles with Shift, and closes one group-drag gesture on blur', () => {
        const graph = useGraphStore.getState();
        const firstId = graph.addNode('speaker', { x: 0, y: 0 });
        const secondId = graph.addNode('speaker', { x: 200, y: 0 });
        useHistoryStore.getState().clear();
        useGraphStore.setState({ selectedNodeIds: new Set([firstId, secondId]) });
        const view = render(<NodeWrapper node={useGraphStore.getState().nodes.get(firstId)!} />);
        const handle = screen.getByTestId('drag-handle');

        fireEvent.mouseDown(handle, { button: 0, clientX: 10, clientY: 10 });
        fireEvent.mouseMove(window, { clientX: 12, clientY: 12 });
        fireEvent.mouseUp(window);
        expect(useHistoryStore.getState().entries).toHaveLength(0);
        expect(useGraphStore.getState().selectedNodeIds).toEqual(new Set([firstId]));

        useGraphStore.setState({ selectedNodeIds: new Set([firstId, secondId]) });
        fireEvent.mouseDown(handle, { button: 0, clientX: 10, clientY: 10, shiftKey: true });
        expect(useGraphStore.getState().selectedNodeIds.has(firstId)).toBe(false);
        useGraphStore.setState({ selectedNodeIds: new Set([firstId, secondId]) });

        fireEvent.mouseDown(handle, { button: 0, clientX: 10, clientY: 10 });
        fireEvent.mouseMove(window, { clientX: 40, clientY: 30 });
        expect(useHistoryStore.getState().open).not.toBeNull();
        fireEvent.blur(window);
        expect(useHistoryStore.getState().open).toBeNull();
        expect(useHistoryStore.getState().entries).toHaveLength(1);
        expect(useGraphStore.getState().nodes.get(firstId)?.position).toEqual({ x: 30, y: 20 });
        expect(useGraphStore.getState().nodes.get(secondId)?.position).toEqual({ x: 230, y: 20 });
        view.unmount();
        expect(useHistoryStore.getState().entries).toHaveLength(1);
    });

    it('closes an active drag gesture when unmounted', () => {
        const id = useGraphStore.getState().addNode('speaker', { x: 0, y: 0 });
        useHistoryStore.getState().clear();
        const view = render(<NodeWrapper node={useGraphStore.getState().nodes.get(id)!} />);
        fireEvent.mouseDown(screen.getByTestId('drag-handle'), { button: 0, clientX: 0, clientY: 0 });
        fireEvent.mouseMove(window, { clientX: 10, clientY: 0 });
        expect(useHistoryStore.getState().open).not.toBeNull();
        view.unmount();
        expect(useHistoryStore.getState().open).toBeNull();
        expect(useHistoryStore.getState().entries).toHaveLength(1);
    });
});
