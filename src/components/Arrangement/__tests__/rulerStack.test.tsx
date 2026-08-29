/**
 * TA2d must-fix 2 and 3b — the ruler stack.
 *
 * 1. The 64px ruler is ONE number. TA2c raised `.arrangement-ruler-shell` to 64px
 *    and left seven `top: 46px` field offsets behind, so the playhead and every
 *    grid line sat 18px above the lanes they claim to mark.
 * 2. The 14px brace row landed exactly where the old ruler's bars row was and
 *    called `stopPropagation()` before its 4px threshold, so a plain click in that
 *    band did nothing at all — no seek, no range — and the shipped e2e that clicks
 *    the ruler at y=35 to place the edit point failed.
 * 3. Pointer capture retargets the synthesized dblclick to the capturing element,
 *    so a double-click on a section chip's label arrived on the chip and dropped a
 *    stray marker instead of opening the rename field.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ArrangementSurface } from '../ArrangementSurface';
import { useArrangementStore } from '../../../store/arrangementStore';
import { useEditingContextStore } from '../../../store/editingContextStore';
import { useHistoryStore } from '../../../store/historyStore';
import { useTrackLaneViewStore } from '../../../store/trackLaneViewStore';
import { useUiViewStore } from '../../../store/uiViewStore';
import { buildPaperSketch } from '../../../song/songs/paperSketch';

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
    HTMLElement.prototype.setPointerCapture = vi.fn();
});

afterEach(cleanup);

const GESTURE_CSS = readFileSync(resolve(process.cwd(), 'src/components/Arrangement/gestureHandles.css'), 'utf8');
const SURFACE_CSS = readFileSync(resolve(process.cwd(), 'src/components/Arrangement/ArrangementSurface.css'), 'utf8');
const SURFACE_TSX = readFileSync(resolve(process.cwd(), 'src/components/Arrangement/ArrangementSurface.tsx'), 'utf8');

/** Every field overlay that has to begin exactly where the ruler ends. */
const RULER_OFFSET_RULES = [
    '.arrangement-field-ground',
    '.arrangement-song-end',
    '.arrangement-grid-anchor',
    '.arrangement-playhead',
    '.arrangement-loop-wash',
    '.arrangement-range-selection',
    '.arrangement-marquee.is-range',
    '.arrangement-record-error',
];

function ruleBody(css: string, selector: string): string {
    const start = css.indexOf(`\n${selector} {`) + 1;
    expect(start, `${selector} must exist in ArrangementSurface.css`).toBeGreaterThan(0);
    return css.slice(start, css.indexOf('}', start));
}

describe('ruler height is one variable', () => {
    it('declares --arrangement-ruler-height once and drives the ruler chrome from it', () => {
        expect(GESTURE_CSS).toMatch(/--arrangement-ruler-height:\s*64px;/);
        expect(GESTURE_CSS).toMatch(/\.arrangement-ruler-shell\s*{[^}]*height:\s*var\(--arrangement-ruler-height\);/s);
        expect(GESTURE_CSS).toMatch(/\.arrangement-ruler-content\s*{[^}]*height:\s*var\(--arrangement-ruler-height\);/s);
        // Sections 22 + braces 14 + bars 28 = the 64 the variable promises (spec 2.3).
        expect(GESTURE_CSS).toMatch(/\.arrangement-braces-row\s*{[^}]*top:\s*22px;[^}]*height:\s*14px;/s);
        expect(GESTURE_CSS).toMatch(/\.arrangement-bars-row\s*{[^}]*top:\s*36px;[^}]*height:\s*28px;/s);
    });

    it('offsets every field overlay from that variable, with no 46px literal left', () => {
        for (const selector of RULER_OFFSET_RULES) {
            const body = ruleBody(SURFACE_CSS, selector);
            expect(body, selector).toContain('top: var(--arrangement-ruler-height)');
            expect(body, selector).not.toContain('46px');
        }
        // The range marquee needs its `!important` kept, or the inline marquee box wins.
        expect(ruleBody(SURFACE_CSS, '.arrangement-marquee.is-range')).toContain('var(--arrangement-ruler-height) !important');
    });

    it('keeps the JS virtualization constant equal to the CSS variable', () => {
        const cssHeight = Number(/--arrangement-ruler-height:\s*(\d+)px;/.exec(GESTURE_CSS)![1]);
        const jsHeight = Number(/const RULER_HEIGHT = (\d+);/.exec(SURFACE_TSX)![1]);
        expect(jsHeight).toBe(cssHeight);
    });
});

describe('the brace row never swallows a plain click', () => {
    beforeEach(() => {
        useArrangementStore.getState().setArrangement(buildPaperSketch());
        useHistoryStore.getState().clear();
        useTrackLaneViewStore.setState({ expandedPianoRolls: {}, laneHeights: {}, headerWidth: 200, mixerOpen: false, automationLaneByTrack: {} });
        useUiViewStore.getState().setSurface('arrangement');
    });

    function mountRuler() {
        const view = render(<ArrangementSurface active songNodeId="song-1" />);
        const ruler = view.container.querySelector<HTMLElement>('.arrangement-ruler-viewport')!;
        ruler.getBoundingClientRect = () => ({ x: 200, y: 80, left: 200, top: 80, right: 1200, bottom: 144, width: 1000, height: 64, toJSON: () => ({}) });
        return view;
    }

    it('a press on the empty brace row still reaches the ruler scrub and seeks', () => {
        const { container } = mountRuler();
        const braces = container.querySelector<HTMLElement>('.arrangement-braces-row')!;
        act(() => { useArrangementStore.setState({ transportPending: null, pendingSeekSample: null }); });
        fireEvent.pointerDown(braces, { button: 0, pointerId: 41, clientX: 500, clientY: 110 });
        expect(useArrangementStore.getState().transportPending).toBe('seek');
        fireEvent.pointerUp(window, { pointerId: 41, clientX: 500, clientY: 110 });
        // A click is a locate, never an edit.
        expect(useHistoryStore.getState().cursor).toBe(0);
    });

    it('a drag on the empty brace row still creates a loop range as one entry', () => {
        const { container } = mountRuler();
        const braces = container.querySelector<HTMLElement>('.arrangement-braces-row')!;
        const initialTick = useArrangementStore.getState().playheadTick;
        fireEvent.pointerDown(braces, { button: 0, pointerId: 42, clientX: 400, clientY: 110 });
        fireEvent.pointerMove(window, { pointerId: 42, clientX: 640, clientY: 110 });
        fireEvent.pointerUp(window, { pointerId: 42, clientX: 640, clientY: 110 });
        const loop = useArrangementStore.getState().arrangement!.locations?.find((location) => location.kind === 'loop');
        expect(loop).toBeDefined();
        expect(loop!.endTick!).toBeGreaterThan(loop!.startTick);
        expect(useHistoryStore.getState().cursor).toBe(1);
        // The drag took the pointer from the scrub, so the playhead did not relocate.
        expect(useArrangementStore.getState().playheadTick).toBe(initialTick);
    });

    it('a press ON an existing brace owns the pointer and does not seek', () => {
        const arrangement = buildPaperSketch();
        arrangement.locations = [...(arrangement.locations ?? []).filter((location) => location.kind !== 'loop'), { id: 'loop-1', name: 'Loop', kind: 'loop', startTick: 3840, endTick: 7680 }];
        useArrangementStore.getState().setArrangement(arrangement);
        const { container } = mountRuler();
        act(() => { useArrangementStore.setState({ transportPending: null, pendingSeekSample: null }); });
        const brace = container.querySelector<HTMLElement>('.arrangement-loop-brace')!;
        fireEvent.pointerDown(brace, { button: 0, pointerId: 43, clientX: 500, clientY: 110 });
        expect(useArrangementStore.getState().transportPending).toBeNull();
        fireEvent.pointerUp(window, { pointerId: 43, clientX: 500, clientY: 110 });
    });
});

describe('section chip: rename vs marker', () => {
    beforeEach(() => {
        useArrangementStore.getState().setArrangement(buildPaperSketch());
        useHistoryStore.getState().clear();
        useTrackLaneViewStore.setState({ expandedPianoRolls: {}, laneHeights: {}, headerWidth: 200, mixerOpen: false, automationLaneByTrack: {} });
        useUiViewStore.getState().setSurface('arrangement');
        useEditingContextStore.getState().setSelection('arrangement', { sectionIds: [] });
    });

    const markerCount = () => useArrangementStore.getState().arrangement!.locations?.filter((location) => location.kind === 'mark').length ?? 0;

    function mount() {
        const view = render(<ArrangementSurface active songNodeId="song-1" />);
        const ruler = view.container.querySelector<HTMLElement>('.arrangement-ruler-viewport')!;
        ruler.getBoundingClientRect = () => ({ x: 200, y: 80, left: 200, top: 80, right: 1200, bottom: 144, width: 1000, height: 64, toJSON: () => ({}) });
        return { ...view, ruler };
    }

    /**
     * Chromium retargets the synthesized click/dblclick to whatever element holds
     * pointer capture, so the double-click that follows a press on the label is
     * delivered to `retarget`, not to the label.
     */
    function doublePress(press: HTMLElement, retarget: HTMLElement, clientX: number) {
        for (const pointerId of [61, 62]) {
            fireEvent.pointerDown(press, { button: 0, pointerId, clientX, clientY: 88 });
            fireEvent.pointerUp(window, { pointerId, clientX, clientY: 88 });
        }
        fireEvent.doubleClick(retarget, { clientX, clientY: 88, detail: 2 });
    }

    it('double-clicking a chip LABEL opens the inline rename and drops no marker', () => {
        const { container } = mount();
        const chip = container.querySelector<HTMLElement>('.arrangement-section-chip')!;
        const label = chip.querySelector<HTMLElement>('.arrangement-section-chip__label')!;
        const before = markerCount();
        doublePress(label, chip, 320);
        expect(container.querySelector('input.arrangement-section-chip')).not.toBeNull();
        expect(markerCount()).toBe(before);
    });

    it('double-clicking the chip EMPTY BAND drops a marker and opens no rename', () => {
        const { container } = mount();
        const chip = container.querySelector<HTMLElement>('.arrangement-section-chip')!;
        const before = markerCount();
        doublePress(chip, chip, 420);
        expect(markerCount()).toBe(before + 1);
        expect(container.querySelector('input.arrangement-section-chip')).toBeNull();
    });

    it('double-clicking the uncovered marks strip drops a marker', () => {
        const { container, ruler } = mount();
        const row = container.querySelector<HTMLElement>('.arrangement-sections-row')!;
        const before = markerCount();
        doublePress(row, ruler, 560);
        expect(markerCount()).toBe(before + 1);
        expect(container.querySelector('input.arrangement-section-chip')).toBeNull();
    });

    it('double-clicking the bars row drops nothing', () => {
        const { container, ruler } = mount();
        const bars = container.querySelector<HTMLElement>('.arrangement-bars-row')!;
        const before = markerCount();
        doublePress(bars, ruler, 560);
        expect(markerCount()).toBe(before);
    });
});
