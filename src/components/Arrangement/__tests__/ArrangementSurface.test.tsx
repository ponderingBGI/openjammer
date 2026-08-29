import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ArrangementSurface } from '../ArrangementSurface';
import { useArrangementStore } from '../../../store/arrangementStore';
import { buildPaperSketch } from '../../../song/songs/paperSketch';
import { useEditingContextStore } from '../../../store/editingContextStore';
import { useHistoryStore } from '../../../store/historyStore';
import { resolveKeydown } from '../../../keymap/arbiter';
import { useUiViewStore } from '../../../store/uiViewStore';
import { timebase } from '../../../song/time';
import { useTrackLaneViewStore } from '../../../store/trackLaneViewStore';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RulerStack } from '../RulerStack';

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

function captureAnimationFrames() {
    const callbacks: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { callbacks.push(callback); return callbacks.length; });
    return () => act(() => { for (const callback of callbacks.splice(0)) callback(performance.now()); });
}

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
        const flushFrames = captureAnimationFrames();
        useArrangementStore.getState().setArrangement(buildPaperSketch());
        useHistoryStore.getState().clear();
        HTMLElement.prototype.setPointerCapture = vi.fn();
        const { container } = render(<ArrangementSurface active songNodeId="song-1" />);
        useUiViewStore.getState().setSurface('arrangement');
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
        flushFrames();
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
        const flushFrames = captureAnimationFrames();
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
        flushFrames();

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
        const flushFrames = captureAnimationFrames();
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
        flushFrames();
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

    // The tempo control moved into the ONE floating transport pill in Wave 4, so
    // its typing path is covered by `TransportPill.test.tsx`. What must still hold
    // HERE is the invariant underneath it: whatever a UI hands the store, the
    // arrangement's tempo stays inside 20-300.
    it('clamps a tempo the arrangement store is handed', () => {
        useArrangementStore.getState().setArrangement(buildPaperSketch());
        render(<ArrangementSurface active songNodeId="song-1" />);
        useArrangementStore.getState().setTempo(999);
        expect(useArrangementStore.getState().arrangement!.tempoBpm).toBe(300);
        useArrangementStore.getState().setTempo(1);
        expect(useArrangementStore.getState().arrangement!.tempoBpm).toBe(20);
    });

    it('leaves follow-playhead disarmed after a clip drag and paints the snap hairline', () => {
        const flushFrames = captureAnimationFrames();
        useArrangementStore.getState().setArrangement(buildPaperSketch());
        useEditingContextStore.setState({ followPlayhead: true, gridUnit: 'bar', snapMode: 'magnetic' });
        useEditingContextStore.getState().setViewport('arrangement', { pxPerTick: 0.05 });
        HTMLElement.prototype.setPointerCapture = vi.fn();
        const { container } = render(<ArrangementSurface active songNodeId="song-1" />);
        const clip = container.querySelector<HTMLElement>('.arrangement-clip')!;
        const width = Number.parseFloat(clip.style.width);
        const track = clip.closest<HTMLElement>('[data-track-id]')!;
        Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => track) });
        clip.getBoundingClientRect = () => ({ x: 200, y: 80, left: 200, top: 80, right: 200 + width, bottom: 120, width, height: 40, toJSON: () => ({}) });
        fireEvent.pointerDown(clip, { button: 0, pointerId: 71, clientX: 200 + width / 2, clientY: 100 });
        fireEvent.pointerMove(window, { pointerId: 71, clientX: 200 + width / 2 + 190, clientY: 100 });
        flushFrames();
        expect(useEditingContextStore.getState().followPlayhead).toBe(false);
        expect(useEditingContextStore.getState().snapIndicatorTick).not.toBeNull();
        expect(container.querySelector('.arrangement-snap-indicator')).not.toBeNull();
        fireEvent.pointerUp(window, { pointerId: 71, clientX: 200 + width / 2 + 190, clientY: 100 });
        expect(useEditingContextStore.getState().followPlayhead).toBe(false);
        expect(useEditingContextStore.getState().snapIndicatorTick).toBeNull();
    });

    it('uses plain empty-lane drag for range and Alt-drag for object marquee', () => {
        useArrangementStore.getState().setArrangement(buildPaperSketch());
        HTMLElement.prototype.setPointerCapture = vi.fn();
        const { container } = render(<ArrangementSurface active songNodeId="song-1" />);
        const timeline = container.querySelector<HTMLElement>('.arrangement-timeline-content')!;
        const lane = container.querySelector<HTMLElement>('.arrangement-lane')!;
        const clip = lane.querySelector<HTMLElement>('[data-clip-id]')!;
        timeline.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 1200, bottom: 600, width: 1200, height: 600, toJSON: () => ({}) });
        lane.getBoundingClientRect = () => ({ x: 200, y: 80, left: 200, top: 80, right: 1200, bottom: 152, width: 1000, height: 72, toJSON: () => ({}) });
        clip.getBoundingClientRect = () => ({ x: 250, y: 90, left: 250, top: 90, right: 330, bottom: 130, width: 80, height: 40, toJSON: () => ({}) });
        fireEvent.pointerDown(lane, { button: 0, pointerId: 72, clientX: 220, clientY: 100 });
        fireEvent.pointerMove(window, { pointerId: 72, clientX: 360, clientY: 120 });
        fireEvent.pointerUp(window, { pointerId: 72, clientX: 360, clientY: 120 });
        expect(useEditingContextStore.getState().viewports.arrangement.selection.timeRange).not.toBeNull();
        fireEvent.pointerDown(lane, { button: 0, pointerId: 73, clientX: 220, clientY: 85, altKey: true });
        fireEvent.pointerMove(window, { pointerId: 73, clientX: 360, clientY: 140, altKey: true });
        fireEvent.pointerUp(window, { pointerId: 73, clientX: 360, clientY: 140, altKey: true });
        expect(useEditingContextStore.getState().viewports.arrangement.selection.timeRange).toBeNull();
        expect(useEditingContextStore.getState().viewports.arrangement.selection.clipIds).toContain(clip.dataset.clipId);
    });

    it('binds B to Draw and commits one compound createClip that one undo removes', () => {
        const arrangement = buildPaperSketch();
        arrangement.tracks[0]!.clips = [];
        useArrangementStore.getState().setArrangement(arrangement);
        useHistoryStore.getState().clear();
        HTMLElement.prototype.setPointerCapture = vi.fn();
        const { container } = render(<ArrangementSurface active songNodeId="song-1" />);
        const root = container.querySelector<HTMLElement>('[data-surface-root="arrangement"]')!;
        useUiViewStore.getState().setSurface('arrangement');
        root.focus();
        act(() => { resolveKeydown(new KeyboardEvent('keydown', { key: 'b', bubbles: true })); });
        expect(useEditingContextStore.getState().viewports.arrangement.tool).toBe('draw');
        const timeline = container.querySelector<HTMLElement>('.arrangement-timeline-content')!;
        const lane = container.querySelector<HTMLElement>('.arrangement-lane')!;
        timeline.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 1200, bottom: 600, width: 1200, height: 600, toJSON: () => ({}) });
        lane.getBoundingClientRect = () => ({ x: 200, y: 80, left: 200, top: 80, right: 1200, bottom: 152, width: 1000, height: 72, toJSON: () => ({}) });
        const beforeSources = Object.keys(useArrangementStore.getState().arrangement!.sources ?? {}).length;
        fireEvent.pointerDown(lane, { button: 0, pointerId: 74, clientX: 260, clientY: 100 });
        fireEvent.pointerMove(window, { pointerId: 74, clientX: 420, clientY: 100 });
        expect(container.querySelector('[data-draw-ghost]')).not.toBeNull();
        fireEvent.pointerUp(window, { pointerId: 74, clientX: 420, clientY: 100 });
        expect(useArrangementStore.getState().arrangement!.tracks[0]!.clips).toHaveLength(1);
        expect(Object.keys(useArrangementStore.getState().arrangement!.sources ?? {})).toHaveLength(beforeSources + 1);
        expect(useHistoryStore.getState().cursor).toBe(1);
        act(() => useHistoryStore.getState().undo());
        expect(useArrangementStore.getState().arrangement!.tracks[0]!.clips).toHaveLength(0);
        expect(Object.keys(useArrangementStore.getState().arrangement!.sources ?? {})).toHaveLength(beforeSources);
    });

    it('pins the remaining arrangement navigation and spatial-selection keys', () => {
        useArrangementStore.getState().setArrangement(buildPaperSketch());
        useUiViewStore.getState().setSurface('arrangement');
        const { container } = render(<ArrangementSurface active songNodeId="song-1" />);
        container.querySelector<HTMLElement>('[data-surface-root="arrangement"]')!.focus();
        const arrangement = useArrangementStore.getState().arrangement!;
        const sourceTrackIndex = arrangement.tracks.findIndex((track) => track.clips.some((clip) => clip.id));
        const clip = arrangement.tracks[sourceTrackIndex]!.clips[0]!;
        act(() => { useEditingContextStore.getState().setSelection('arrangement', { clipIds: [clip.id!] }); });
        act(() => { resolveKeydown(new KeyboardEvent('keydown', { key: ']', bubbles: true })); });
        expect(useEditingContextStore.getState().gridUnit).not.toBe('adaptive');
        act(() => { resolveKeydown(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true })); });
        expect(useArrangementStore.getState().arrangement!.tracks.flatMap((track) => track.clips).find((item) => item.id === clip.id)!.startTick).toBe(clip.startTick + timebase(arrangement).ticksPerBar);
        if (sourceTrackIndex < arrangement.tracks.length - 1) {
            act(() => { resolveKeydown(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
            expect(useArrangementStore.getState().arrangement!.tracks[sourceTrackIndex + 1]!.clips.some((item) => item.id === clip.id)).toBe(true);
        }
        act(() => { resolveKeydown(new KeyboardEvent('keydown', { key: 'ArrowRight', ctrlKey: true, altKey: true, shiftKey: true, bubbles: true })); });
        expect(useEditingContextStore.getState().viewports.arrangement.selection.clipIds.length).toBeGreaterThan(0);
        act(() => { resolveKeydown(new KeyboardEvent('keydown', { key: 'ArrowRight', ctrlKey: true, bubbles: true })); });
        expect(useArrangementStore.getState().transportPending).toBe('seek');
    });

    it('exposes setTrackColor through the track-header colour input', () => {
        useArrangementStore.getState().setArrangement(buildPaperSketch());
        useHistoryStore.getState().clear();
        render(<ArrangementSurface active songNodeId="song-1" />);
        const track = useArrangementStore.getState().arrangement!.tracks[0]!;
        fireEvent.change(screen.getByLabelText(`Colour for ${track.name ?? track.ref}`), { target: { value: '#123456' } });
        expect(useArrangementStore.getState().arrangement!.tracks[0]!.color).toBe('#123456');
        expect(useHistoryStore.getState().cursor).toBe(1);
    });

    it('retains the ruler element for window-owned scrub moves after React clears currentTarget', () => {
        useArrangementStore.getState().setArrangement(buildPaperSketch());
        HTMLElement.prototype.setPointerCapture = vi.fn();
        const { container } = render(<ArrangementSurface active songNodeId="song-1" />);
        const ruler = container.querySelector<HTMLElement>('.arrangement-ruler-viewport')!;
        ruler.getBoundingClientRect = () => ({ x: 200, y: 80, left: 200, top: 80, right: 1200, bottom: 120, width: 1000, height: 40, toJSON: () => ({}) });
        fireEvent.pointerDown(ruler, { button: 0, pointerId: 91, clientX: 260, clientY: 100 });
        expect(() => fireEvent.pointerMove(window, { pointerId: 91, clientX: 520, clientY: 100 })).not.toThrow();
        expect(useArrangementStore.getState().transportPending).toBe('seek');
        fireEvent.pointerUp(window, { pointerId: 91, clientX: 520, clientY: 100 });
        expect(useEditingContextStore.getState().snapIndicatorTick).toBeNull();
    });

    it('gives lane and header resize handles reachable boxes', () => {
        const arrangement = buildPaperSketch();
        useArrangementStore.getState().setArrangement(arrangement);
        useTrackLaneViewStore.setState({ laneHeights: {}, headerWidth: 200, expandedPianoRolls: {} });
        HTMLElement.prototype.setPointerCapture = vi.fn();
        const { container } = render(<ArrangementSurface active songNodeId="song-1" />);
        const laneHandle = container.querySelector<HTMLElement>('.arrangement-lane__resize')!;
        const headerHandle = container.querySelector<HTMLElement>('.arrangement-header-resize')!;
        expect(laneHandle).not.toBeNull();
        expect(headerHandle).not.toBeNull();
        const structuralCss = readFileSync(resolve(process.cwd(), 'src/components/Arrangement/gestureHandles.css'), 'utf8');
        expect(structuralCss).toMatch(/\.arrangement-lane__resize\s*{[^}]*height:\s*5px;[^}]*cursor:\s*ns-resize;/s);
        expect(structuralCss).toMatch(/\.arrangement-header-resize\s*{[^}]*width:\s*6px;[^}]*cursor:\s*col-resize;/s);

    });

    it('positions the loop bracket from its start tick and scroll offset', () => {
        const arrangement = buildPaperSketch();
        arrangement.locations = [...(arrangement.locations ?? []).filter((location) => location.kind !== 'loop'), { id: 'loop-test', name: 'Loop', kind: 'loop', startTick: 3840, endTick: 7680 }];
        useArrangementStore.getState().setArrangement(arrangement);
        const { container } = render(<RulerStack fieldWidth={1000} contentWidth={2000} scrollLeft={96} pxPerTick={0.1} ticksPerBar={3840} beatsPerBar={4} gridUnit="bar" snapOn sections={[]} songEnd={20_000} loop={arrangement.locations.at(-1)} onToggleSnap={() => undefined} />);
        const bracket = container.querySelector<HTMLElement>('.arrangement-loop-bracket')!;
        expect(bracket).not.toBeNull();
        expect(bracket.style.transform).toBe('translateX(288px)');
        expect(bracket.style.width).toBe('384px');
    });

    it('creates markers from a section chip empty band and Ctrl+M at the playhead', () => {
        const arrangement = buildPaperSketch();
        useArrangementStore.getState().setArrangement(arrangement);
        useHistoryStore.getState().clear();
        useUiViewStore.getState().setSurface('arrangement');
        const { container } = render(<ArrangementSurface active songNodeId="song-1" />);
        const root = container.querySelector<HTMLElement>('[data-surface-root="arrangement"]')!;
        root.focus();
        const chip = container.querySelector<HTMLElement>('.arrangement-section-chip')!;
        const ruler = container.querySelector<HTMLElement>('.arrangement-ruler-viewport')!;
        ruler.getBoundingClientRect = () => ({ x: 200, y: 80, left: 200, top: 80, right: 1200, bottom: 144, width: 1000, height: 64, toJSON: () => ({}) });
        const markerCount = () => useArrangementStore.getState().arrangement!.locations?.filter((location) => location.kind === 'mark').length ?? 0;
        const before = markerCount();
        fireEvent.doubleClick(chip, { clientX: 440, clientY: 90 });
        expect(markerCount()).toBe(before + 1);
        act(() => useArrangementStore.setState({ playheadTick: 12_345 }));
        act(() => { resolveKeydown(new KeyboardEvent('keydown', { key: 'm', ctrlKey: true, bubbles: true })); });
        expect(markerCount()).toBe(before + 2);
        expect(useArrangementStore.getState().arrangement!.locations?.some((location) => location.kind === 'mark' && location.startTick === 12_345)).toBe(true);
        expect(useHistoryStore.getState().cursor).toBe(2);
    });

    it('TA2d: I and O at tick 0 emit a legal loop range instead of throwing', () => {
        useArrangementStore.getState().setArrangement(buildPaperSketch());
        useHistoryStore.getState().clear();
        useUiViewStore.getState().setSurface('arrangement');
        const { container } = render(<ArrangementSurface active songNodeId="song-1" />);
        container.querySelector<HTMLElement>('[data-surface-root="arrangement"]')!.focus();
        act(() => useArrangementStore.setState({ playheadTick: 0, transportPending: null, pendingSeekSample: null }));

        // TA2c computed `startTick: min(loopStart, tick - 1)` here, i.e. -1, and
        // `applyVerb` threw "location cannot start below zero" as a page error.
        expect(() => act(() => { resolveKeydown(new KeyboardEvent('keydown', { key: 'o', bubbles: true })); })).not.toThrow();
        expect(() => act(() => { resolveKeydown(new KeyboardEvent('keydown', { key: 'i', bubbles: true })); })).not.toThrow();
        const loop = useArrangementStore.getState().arrangement!.locations?.find((location) => location.kind === 'loop');
        expect(loop).toBeDefined();
        expect(loop!.startTick).toBeGreaterThanOrEqual(0);
        expect(loop!.endTick! - loop!.startTick).toBeGreaterThanOrEqual(1);
    });

});
