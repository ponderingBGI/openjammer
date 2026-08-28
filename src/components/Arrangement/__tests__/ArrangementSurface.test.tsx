import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ArrangementSurface } from '../ArrangementSurface';
import { useArrangementStore } from '../../../store/arrangementStore';
import { buildPaperSketch } from '../../../song/songs/paperSketch';
import { useEditingContextStore } from '../../../store/editingContextStore';
import { useHistoryStore } from '../../../store/historyStore';

beforeAll(() => {
    class TestPointerEvent extends MouseEvent {
        pointerId: number;
        constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 0; }
    }
    vi.stubGlobal('PointerEvent', TestPointerEvent);
    class TestResizeObserver {
        observe() {}
        disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(cleanup);

describe('ArrangementSurface', () => {
    it('stays mounted but is hidden, inert, and aria-hidden while canvas is active', () => {
        useArrangementStore.getState().setArrangement(null);
        const { container } = render(<ArrangementSurface active={false} songNodeId="song-1" />);
        const surface = container.querySelector('.arrangement-surface');
        expect(surface).not.toBeNull();
        expect(surface).toHaveAttribute('hidden');
        expect(surface).toHaveAttribute('inert');
        expect(surface).toHaveAttribute('aria-hidden', 'true');
        expect(surface).toHaveClass('song-interior');
    });

    it('renders the ruled empty invitation with both song starters', () => {
        useArrangementStore.getState().setArrangement(null);
        render(<ArrangementSurface active songNodeId="song-1" />);
        expect(screen.getByRole('heading', { name: 'An empty page.' })).toBeVisible();
        expect(screen.getByRole('button', { name: /Paper Sketch/i })).toBeVisible();
        expect(screen.getByRole('button', { name: /First Light/i })).toBeVisible();
        expect(document.querySelectorAll('.arrangement-empty-ghost .arrangement-track')).toHaveLength(3);
    });

    it('renders populated tracks and source-window clips', () => {
        useArrangementStore.getState().setArrangement(buildPaperSketch());
        const { container } = render(<ArrangementSurface active songNodeId="song-1" />);
        expect(container.querySelectorAll('.arrangement-track')).toHaveLength(3);
        expect(container.querySelectorAll('.arrangement-clip').length).toBeGreaterThan(0);
        expect(screen.queryByText('An empty page.')).not.toBeInTheDocument();
    });

    it('moves a clip across tracks as one history entry and one undo restores it', () => {
        useArrangementStore.getState().setArrangement(buildPaperSketch());
        useHistoryStore.getState().clear();
        HTMLElement.prototype.setPointerCapture = vi.fn();
        const { container } = render(<ArrangementSurface active songNodeId="song-1" />);
        const clip = container.querySelector<HTMLElement>('.arrangement-clip')!;
        const clipId = clip.dataset.clipId!;
        const clipWidth = Number.parseFloat(clip.style.width);
        clip.getBoundingClientRect = () => ({ x: 200, y: 80, left: 200, top: 80, right: 200 + clipWidth, bottom: 120, width: clipWidth, height: 40, toJSON: () => ({}) });
        const originalTrack = useArrangementStore.getState().arrangement!.tracks.find((track) => track.clips.some((item) => item.id === clipId))!;
        const target = useArrangementStore.getState().arrangement!.tracks.find((track) => (track.id ?? track.ref) !== (originalTrack.id ?? originalTrack.ref))!;
        const targetElement = container.querySelector<HTMLElement>(`[data-track-id="${target.id ?? target.ref}"]`)!;
        Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => targetElement) });
        fireEvent.pointerDown(clip, { button: 0, pointerId: 7, clientX: 200 + clipWidth / 2, clientY: 100 });
        fireEvent.pointerMove(window, { pointerId: 7, clientX: 330, clientY: 190, shiftKey: false, altKey: false });
        const ghost = container.querySelector<HTMLElement>('[data-drag-ghost]');
        expect(ghost).toHaveAttribute('data-hovered-track-id', target.id);
        expect(clip.closest('[data-track-id]')).toHaveAttribute('data-track-id', originalTrack.id);
        expect(clip).toHaveClass('is-dragging');
        expect(targetElement).toHaveClass('is-drop-target');
        fireEvent.pointerUp(window, { pointerId: 7, clientX: 330, clientY: 190 });
        expect(container.querySelector('[data-drag-ghost]')).toBeNull();
        expect(useArrangementStore.getState().arrangement!.tracks.find((track) => track.clips.some((item) => item.id === clipId))?.id).toBe(target.id);
        expect(useHistoryStore.getState().cursor).toBe(1);
        act(() => useHistoryStore.getState().undo());
        expect(useArrangementStore.getState().arrangement!.tracks.find((track) => track.clips.some((item) => item.id === clipId))?.id).toBe(originalTrack.id);
    });

    it('keeps a clip drag alive across lost pointer capture and commits on window pointerup', () => {
        useArrangementStore.getState().setArrangement(buildPaperSketch());
        useHistoryStore.getState().clear();
        HTMLElement.prototype.setPointerCapture = vi.fn();
        const { container } = render(<ArrangementSurface active songNodeId="song-1" />);
        const clip = container.querySelector<HTMLElement>('.arrangement-clip')!;
        const clipId = clip.dataset.clipId!;
        const width = Number.parseFloat(clip.style.width);
        const originalTick = useArrangementStore.getState().arrangement!.tracks.flatMap((track) => track.clips).find((item) => item.id === clipId)!.startTick;
        const originalTrack = useArrangementStore.getState().arrangement!.tracks.find((track) => track.clips.some((item) => item.id === clipId))!;
        const target = useArrangementStore.getState().arrangement!.tracks.find((track) => track.id !== originalTrack.id)!;
        const targetElement = container.querySelector<HTMLElement>(`[data-track-id="${target.id}"]`)!;
        Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => targetElement) });
        clip.getBoundingClientRect = () => ({ x: 200, y: 80, left: 200, top: 80, right: 200 + width, bottom: 120, width, height: 40, toJSON: () => ({}) });

        fireEvent.pointerDown(clip, { button: 0, pointerId: 17, clientX: 200 + width / 2, clientY: 100 });
        fireEvent.pointerMove(window, { pointerId: 17, clientX: 330, clientY: 190 });
        clip.dispatchEvent(new PointerEvent('lostpointercapture', { bubbles: true, pointerId: 17 }));
        expect(useArrangementStore.getState().isGestureOpen()).toBe(true);
        fireEvent.pointerMove(window, { pointerId: 17, clientX: 360, clientY: 190 });
        fireEvent.pointerUp(window, { pointerId: 17, clientX: 360, clientY: 190 });

        expect(useArrangementStore.getState().isGestureOpen()).toBe(false);
        expect(useHistoryStore.getState().cursor).toBe(1);
        expect(useArrangementStore.getState().arrangement!.tracks.find((track) => track.clips.some((item) => item.id === clipId))?.id).toBe(target.id);
        expect(useArrangementStore.getState().arrangement!.tracks.flatMap((track) => track.clips).find((item) => item.id === clipId)!.startTick).toBeGreaterThanOrEqual(originalTick);
    });

    it('keeps an active clip rendered beyond the virtualization window and commits on window pointerup', () => {
        const clientWidth = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300);
        useArrangementStore.getState().setArrangement(buildPaperSketch());
        useHistoryStore.getState().clear();
        HTMLElement.prototype.setPointerCapture = vi.fn();
        const { container } = render(<ArrangementSurface active songNodeId="song-1" />);
        const clip = container.querySelector<HTMLElement>('.arrangement-clip')!;
        const clipId = clip.dataset.clipId!;
        const width = Number.parseFloat(clip.style.width);
        const originalTick = useArrangementStore.getState().arrangement!.tracks.flatMap((track) => track.clips).find((item) => item.id === clipId)!.startTick;
        const track = clip.closest<HTMLElement>('[data-track-id]')!;
        Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => track) });
        clip.getBoundingClientRect = () => ({ x: 200, y: 80, left: 200, top: 80, right: 200 + width, bottom: 120, width, height: 40, toJSON: () => ({}) });

        fireEvent.pointerDown(clip, { button: 0, pointerId: 27, clientX: 200 + width / 2, clientY: 100 });
        fireEvent.pointerMove(window, { pointerId: 27, clientX: 200 + width / 2 + 150, clientY: 100 });

        expect(container.querySelector(`button[data-clip-id="${clipId}"]`)).toBe(clip);
        expect(useArrangementStore.getState().isGestureOpen()).toBe(true);
        expect(useArrangementStore.getState().arrangement!.tracks.flatMap((item) => item.clips).find((item) => item.id === clipId)!.startTick).toBeGreaterThan(originalTick);

        fireEvent.pointerUp(window, { pointerId: 27, clientX: 200 + width / 2 + 150, clientY: 100 });
        expect(useArrangementStore.getState().isGestureOpen()).toBe(false);
        expect(useHistoryStore.getState().cursor).toBe(1);
        expect(useArrangementStore.getState().arrangement!.tracks.flatMap((item) => item.clips).find((item) => item.id === clipId)!.startTick).toBeGreaterThan(originalTick);
        clientWidth.mockRestore();
    });

    it('aborts and restores a virtualized drag when the ArrangementSurface unmounts', () => {
        const clientWidth = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300);
        useArrangementStore.getState().setArrangement(buildPaperSketch());
        useHistoryStore.getState().clear();
        HTMLElement.prototype.setPointerCapture = vi.fn();
        const { container, unmount } = render(<ArrangementSurface active songNodeId="song-1" />);
        const clip = container.querySelector<HTMLElement>('.arrangement-clip')!;
        const clipId = clip.dataset.clipId!;
        const width = Number.parseFloat(clip.style.width);
        const originalTick = useArrangementStore.getState().arrangement!.tracks.flatMap((track) => track.clips).find((item) => item.id === clipId)!.startTick;
        const track = clip.closest<HTMLElement>('[data-track-id]')!;
        Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => track) });
        clip.getBoundingClientRect = () => ({ x: 200, y: 80, left: 200, top: 80, right: 200 + width, bottom: 120, width, height: 40, toJSON: () => ({}) });

        fireEvent.pointerDown(clip, { button: 0, pointerId: 37, clientX: 200 + width / 2, clientY: 100 });
        fireEvent.pointerMove(window, { pointerId: 37, clientX: 200 + width / 2 + 150, clientY: 100 });
        expect(useArrangementStore.getState().isGestureOpen()).toBe(true);
        expect(useArrangementStore.getState().arrangement!.tracks.flatMap((item) => item.clips).find((item) => item.id === clipId)!.startTick).toBeGreaterThan(originalTick);

        unmount();

        expect(useArrangementStore.getState().isGestureOpen()).toBe(false);
        expect(useArrangementStore.getState().arrangement!.tracks.flatMap((item) => item.clips).find((item) => item.id === clipId)!.startTick).toBe(originalTick);
        expect(useHistoryStore.getState().cursor).toBe(0);
        expect(useEditingContextStore.getState()).toMatchObject({ dragActive: false, activeClipDragIds: [], clipDragPreview: null });
        clientWidth.mockRestore();
    });

    it('keeps the canonical left tick through one zoom notch even when DOM scroll reads stale', () => {
        const callbacks: FrameRequestCallback[] = [];
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { callbacks.push(callback); return callbacks.length; });
        useArrangementStore.getState().setArrangement(buildPaperSketch());
        useEditingContextStore.getState().setViewport('arrangement', { leftTick: 28_800, pxPerTick: 0.3 });
        const { container } = render(<ArrangementSurface active songNodeId="song-1" />);
        const scroll = container.querySelector<HTMLElement>('.arrangement-scroll')!;
        Object.defineProperty(scroll, 'scrollLeft', { configurable: true, get: () => 0, set: () => undefined });
        fireEvent.wheel(scroll, { ctrlKey: true, deltaY: 120, clientX: 600 });
        act(() => { callbacks.shift()?.(performance.now()); });
        expect(useEditingContextStore.getState().viewports.arrangement.leftTick).toBeGreaterThan(24_960);
    });

    it('clamps a typed tempo through the production TransportStrip path', () => {
        useArrangementStore.getState().setArrangement(buildPaperSketch());
        render(<ArrangementSurface active songNodeId="song-1" />);
        fireEvent.click(screen.getByLabelText('Tempo'));
        const editor = screen.getByRole('spinbutton', { name: 'Edit value' });
        fireEvent.change(editor, { target: { value: '999' } });
        fireEvent.keyDown(editor, { key: 'Enter' });
        expect(useArrangementStore.getState().arrangement!.tempoBpm).toBe(300);
    });

});
