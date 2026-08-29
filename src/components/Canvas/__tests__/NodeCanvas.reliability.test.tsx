import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NodeCanvas } from '../NodeCanvas';
import { resolveKeydown } from '../../../keymap/arbiter';
import { useAudioStore } from '../../../store/audioStore';
import { useCanvasStore } from '../../../store/canvasStore';
import { useGraphStore } from '../../../store/graphStore';
import { useHistoryStore } from '../../../store/historyStore';

vi.mock('../../../audio/executor', () => ({
    getExecutor: () => ({
        subscribeSignalLevels: () => () => {},
    }),
}));

const observedNodeRoots: Element[] = [];
let resizeCallback: ResizeObserverCallback | undefined;
let nodeRenderCount = 0;
vi.mock('../../Nodes/NodeWrapper', () => ({
    NodeWrapper: ({ node }: { node: { id: string; type: string } }) => {
        nodeRenderCount += 1;
        return <div data-canvas-node-root={node.id}><div className={`${node.type}-node`} /></div>;
    },
}));

class ResizeObserverStub {
    constructor(callback: ResizeObserverCallback) { resizeCallback = callback; }
    observe(element: Element) { observedNodeRoots.push(element); }
    disconnect() {}
}

describe('NodeCanvas reliability', () => {
    beforeEach(() => {
        vi.stubGlobal('ResizeObserver', ResizeObserverStub);
        useGraphStore.setState({
            nodes: new Map(), connections: new Map(), connectionsByNode: new Map(),
            rootNodeIds: [], selectedNodeIds: new Set(), selectedConnectionIds: new Set(),
            clipboard: null, version: 0,
        });
        useCanvasStore.getState().resetView();
        observedNodeRoots.length = 0;
        resizeCallback = undefined;
        nodeRenderCount = 0;
    });

    it('observes the resizable Library visual root and invalidates layout on resize', () => {
        useGraphStore.getState().addNode('library', { x: 0, y: 0 });
        render(<NodeCanvas />);
        expect(observedNodeRoots.some(element => element.classList.contains('library-node'))).toBe(true);
        const rendersBeforeResize = nodeRenderCount;
        act(() => resizeCallback?.([], {} as ResizeObserver));
        expect(nodeRenderCount).toBeGreaterThan(rendersBeforeResize);
    });

    afterEach(() => vi.unstubAllGlobals());

    it('keeps a held note alive across a graph mutation and releases it once from an input', () => {
        const emit = vi.fn();
        const release = vi.fn();
        useAudioStore.setState({
            currentMode: 2,
            activeKeyboardId: 'keyboard-1',
            emitKeyboardSignal: emit,
            releaseKeyboardSignal: release,
        });
        const { unmount } = render(<NodeCanvas />);

        act(() => {
            resolveKeydown(new KeyboardEvent('keydown', { key: 'q', bubbles: true }));
        });
        expect(emit).toHaveBeenCalled();

        act(() => {
            useGraphStore.getState().addNode('speaker', { x: 10, y: 20 });
        });
        expect(release).not.toHaveBeenCalled();

        const input = document.createElement('input');
        document.body.appendChild(input);
        act(() => input.dispatchEvent(new KeyboardEvent('keyup', { key: 'q', bubbles: true })));
        expect(release).toHaveBeenCalledTimes(1);

        unmount();
        expect(release).toHaveBeenCalledTimes(1);
        input.remove();
    });

    it.each(['blur', 'visibilitychange', 'unmount'] as const)('flushes each held source exactly once on %s', (ending) => {
        const release = vi.fn();
        useAudioStore.setState({
            currentMode: 2,
            activeKeyboardId: 'keyboard-1',
            emitKeyboardSignal: vi.fn(),
            releaseKeyboardSignal: release,
        });
        const view = render(<NodeCanvas />);
        act(() => resolveKeydown(new KeyboardEvent('keydown', { key: 'q', bubbles: true })));
        if (ending === 'blur') {
            act(() => window.dispatchEvent(new Event('blur')));
        } else if (ending === 'visibilitychange') {
            vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
            act(() => document.dispatchEvent(new Event('visibilitychange')));
        } else {
            view.unmount();
        }
        expect(release).toHaveBeenCalledTimes(1);
        if (ending !== 'unmount') view.unmount();
        expect(release).toHaveBeenCalledTimes(1);
    });

    it('republishes the canvas rect when its surface ancestor finishes entering', () => {
        let rect = { left: -10, top: -7, width: 800, height: 600 };
        const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
            ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height,
            x: rect.left, y: rect.top, toJSON: () => ({}),
        }));
        const { container } = render(<div data-surface-root><NodeCanvas /></div>);
        expect(useCanvasStore.getState().canvasRect.left).toBe(-10);

        rect = { left: 32, top: 18, width: 800, height: 600 };
        act(() => container.querySelector('[data-surface-root]')?.dispatchEvent(new Event('animationend')));

        expect(useCanvasStore.getState().canvasRect).toEqual(rect);
        spy.mockRestore();
    });

    it('keeps the canvas point under a ctrl-wheel anchor pixel-locked with a non-zero rect', () => {
        const rect = { left: 40, top: 25, width: 800, height: 600 };
        const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
            ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height,
            x: rect.left, y: rect.top, toJSON: () => ({}),
        }));
        const { container } = render(<NodeCanvas />);
        const anchor = { x: 310, y: 240 };
        useCanvasStore.setState({ canvasRect: { left: -10, top: -7, width: 821, height: 612 } });
        const before = useCanvasStore.getState().screenToCanvas(anchor);

        act(() => container.querySelector('.node-canvas')?.dispatchEvent(new WheelEvent('wheel', {
            clientX: anchor.x, clientY: anchor.y, deltaY: -100, ctrlKey: true,
            bubbles: true, cancelable: true,
        })));

        const after = useCanvasStore.getState().screenToCanvas(anchor);
        expect(useCanvasStore.getState().canvasRect).toEqual(rect);
        expect(after.x).not.toBeCloseTo(before.x, 3);
        expect(after.x).toBeCloseTo((anchor.x - rect.left - useCanvasStore.getState().pan.x) / useCanvasStore.getState().zoom, 6);
        expect(after.y).toBeCloseTo((anchor.y - rect.top - useCanvasStore.getState().pan.y) / useCanvasStore.getState().zoom, 6);
        spy.mockRestore();
    });
    /*
     * A rig lands, `focusRig()` switches the app into that rig's keyboard mode so
     * typing plays — and until this was fixed, `Ctrl+Z` was dead from that moment
     * on. Chords are not notes: anything carrying Ctrl/Cmd must reach the canvas
     * in every mode, or the first thing a first-run player ever does is the one
     * thing they cannot take back.
     */
    it.each([
        ['undo', { key: 'z', ctrlKey: true }, 0, 0],
        ['redo', { key: 'z', ctrlKey: true, shiftKey: true }, 1, 1],
    ] as const)('runs %s from a keyboard mode, not only config mode', (which, chord, expectedCursor, expectedNodes) => {
        useHistoryStore.getState().clear();
        useAudioStore.setState({ currentMode: 3, activeKeyboardId: 'keyboard-1' });
        render(<NodeCanvas />);

        act(() => { useGraphStore.getState().addNode('speaker', { x: 10, y: 20 }); });
        expect(useHistoryStore.getState().cursor).toBe(1);
        if (which === 'redo') {
            act(() => resolveKeydown(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })));
            expect(useHistoryStore.getState().cursor).toBe(0);
        }

        act(() => resolveKeydown(new KeyboardEvent('keydown', { ...chord, bubbles: true })));

        expect(useAudioStore.getState().currentMode).toBe(3);
        expect(useHistoryStore.getState().cursor).toBe(expectedCursor);
        expect(useGraphStore.getState().rootNodeIds).toHaveLength(expectedNodes);
    });

    it('still plays a bare note key in a keyboard mode after the chord hoist', () => {
        const emit = vi.fn();
        useAudioStore.setState({ currentMode: 3, activeKeyboardId: 'keyboard-1', emitKeyboardSignal: emit });
        render(<NodeCanvas />);

        act(() => resolveKeydown(new KeyboardEvent('keydown', { key: 'z', bubbles: true })));

        expect(emit).toHaveBeenCalledWith('keyboard-1', 3, 0);
    });
});
