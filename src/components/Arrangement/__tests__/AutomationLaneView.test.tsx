import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPaperSketch } from '../../../song/songs/paperSketch';
import { useArrangementStore } from '../../../store/arrangementStore';
import { useHistoryStore } from '../../../store/historyStore';
import { AutomationLaneView } from '../AutomationLaneView';

beforeAll(() => {
    class TestPointerEvent extends MouseEvent {
        pointerId: number;
        constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 0; }
    }
    vi.stubGlobal('PointerEvent', TestPointerEvent);
    HTMLElement.prototype.setPointerCapture = vi.fn();
});

afterEach(cleanup);

describe('AutomationLaneView gestures', () => {
    beforeEach(() => {
        useArrangementStore.getState().setArrangement(buildPaperSketch());
        useHistoryStore.getState().clear();
    });

    function renderLane() {
        const arrangement = useArrangementStore.getState().arrangement!;
        const track = arrangement.tracks.find((item) => item.automation?.some((lane) => lane.id))!;
        const lane = track.automation!.find((item) => item.id)!;
        const view = render(<AutomationLaneView arrangement={arrangement} track={track} lane={lane} pxPerTick={0.05} />);
        const field = view.container.querySelector<HTMLElement>('.arrangement-automation__field')!;
        field.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 1200, bottom: 96, width: 1200, height: 96, toJSON: () => ({}) });
        return { ...view, laneId: lane.id!, field };
    }

    const lanePoints = (laneId: string) => useArrangementStore.getState().arrangement!.tracks.flatMap((track) => track.automation ?? []).find((lane) => lane.id === laneId)!.points;

    it('adds a point on double-click as one undo entry', () => {
        const { field, laneId } = renderLane();
        const before = lanePoints(laneId).length;
        fireEvent.doubleClick(field, { clientX: 350, clientY: 40 });
        expect(lanePoints(laneId)).toHaveLength(before + 1);
        expect(useHistoryStore.getState().cursor).toBe(1);
    });

    it('commits a point drag once and Escape restores an in-flight drag', () => {
        const { container, laneId } = renderLane();
        const point = container.querySelector<HTMLElement>('.arrangement-automation__point')!;
        const before = structuredClone(lanePoints(laneId));
        fireEvent.pointerDown(point, { button: 0, pointerId: 201, clientX: 100, clientY: 40 });
        fireEvent.pointerMove(window, { pointerId: 201, clientX: 140, clientY: 30 });
        fireEvent.pointerUp(window, { pointerId: 201, clientX: 140, clientY: 30 });
        expect(useHistoryStore.getState().cursor).toBe(1);
        const committed = structuredClone(lanePoints(laneId));
        expect(committed).not.toEqual(before);

        const movedPoint = container.querySelector<HTMLElement>('.arrangement-automation__point')!;
        fireEvent.pointerDown(movedPoint, { button: 0, pointerId: 202, clientX: 140, clientY: 30 });
        fireEvent.pointerMove(window, { pointerId: 202, clientX: 180, clientY: 60 });
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(lanePoints(laneId)).toEqual(committed);
        expect(useHistoryStore.getState().cursor).toBe(1);
    });

    it('uses a Shift-drag range adjustment as one setAutomationRange entry', () => {
        const { container, field, laneId } = renderLane();
        fireEvent.pointerDown(field, { button: 0, pointerId: 203, clientX: 1, clientY: 40, shiftKey: true });
        fireEvent.pointerMove(window, { pointerId: 203, clientX: 600, clientY: 40, shiftKey: true });
        fireEvent.pointerUp(window, { pointerId: 203, clientX: 600, clientY: 40, shiftKey: true });
        const range = container.querySelector<HTMLElement>('.arrangement-automation__range')!;
        expect(range).not.toBeNull();
        const before = structuredClone(lanePoints(laneId));
        fireEvent.pointerDown(range, { button: 0, pointerId: 204, clientX: 300, clientY: 50 });
        fireEvent.pointerMove(window, { pointerId: 204, clientX: 300, clientY: 30 });
        fireEvent.pointerUp(window, { pointerId: 204, clientX: 300, clientY: 30 });
        expect(lanePoints(laneId)).not.toEqual(before);
        expect(useHistoryStore.getState().cursor).toBe(1);
    });
});
