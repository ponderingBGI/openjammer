/**
 * W4-TBb M1 + M2 — the field overlay pane.
 *
 * Three overlays were painting on the two pieces of chrome the shell contract
 * says are always there. Measured in Chromium on the pre-fix tree
 * (`plans/redesign-new-dna/.scratch/w4-tbb/before.json`):
 *
 *   • the drag ghost covered **12 800 px²** of the sticky header column and its
 *     readout another **2 266 px²**, drawn on top of the track names;
 *   • the playhead crossed the header column at every scrollLeft between 1 and
 *     199 (**432 px²**), reading as a stray divider inside the headers.
 *
 * The z-ladder cannot state the rule these overlays share — above the clips,
 * never on the chrome — because "above content, below chrome" is not an order,
 * it is a boundary. So the fix is a CLIP, and this file pins the construction:
 * every transient overlay is inside one pane, the pane is the field viewport,
 * and the pane clips.
 *
 * Layout is not simulated in jsdom, so this asserts the two facts that COMPOSE
 * into non-intersection — containment in a clipped pane, and the pane's exact
 * geometry — and then computes where a given overlay lands from the same
 * numbers the browser would. The real rects are measured in the browser run.
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
    class TestResizeObserver { observe() {} disconnect() {} }
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    HTMLElement.prototype.setPointerCapture = vi.fn();
    // jsdom has no layout, and the pane is sized from the scroller's client box.
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 1280 });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 640 });
});

afterEach(cleanup);

const SURFACE_CSS = readFileSync(resolve(process.cwd(), 'src/components/Arrangement/ArrangementSurface.css'), 'utf8');
const GESTURE_CSS = readFileSync(resolve(process.cwd(), 'src/components/Arrangement/gestureHandles.css'), 'utf8');
const GHOST_CSS = readFileSync(resolve(process.cwd(), 'src/components/Arrangement/DragGhost.css'), 'utf8');
const SURFACE_TSX = readFileSync(resolve(process.cwd(), 'src/components/Arrangement/ArrangementSurface.tsx'), 'utf8');
const ROLL_CSS = readFileSync(resolve(process.cwd(), 'src/components/PianoRoll/PianoRoll.css'), 'utf8');

/** `translate3d(-200px,-64px,0)` → `[-200, -64]`. */
function translation(element: HTMLElement): [number, number] {
    const match = /translate3d\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)(?:px)?/.exec(element.style.transform);
    expect(match, `${element.className} must carry a translate3d`).not.toBeNull();
    return [Number(match![1]), Number(match![2])];
}

const HEADER_WIDTH = 200;
const RULER_HEIGHT = 64;

function ruleBody(css: string, selector: string): string {
    const start = css.indexOf(`\n${selector} {`) + 1;
    expect(start, `${selector} must exist`).toBeGreaterThan(0);
    return css.slice(start, css.indexOf('}', start));
}

function mount() {
    const view = render(<ArrangementSurface active songNodeId="song-1" />);
    const scroll = view.container.querySelector<HTMLElement>('.arrangement-scroll')!;
    const pane = view.container.querySelector<HTMLElement>('[data-field-overlay]')!;
    return { ...view, scroll, pane };
}

/** Drive the scroll the way the browser does: set the offsets, fire `scroll`. */
function scrollField(scroll: HTMLElement, left: number, top: number) {
    Object.defineProperty(scroll, 'scrollLeft', { configurable: true, writable: true, value: left });
    Object.defineProperty(scroll, 'scrollTop', { configurable: true, writable: true, value: top });
    act(() => { fireEvent.scroll(scroll); });
}

describe('the field overlay pane is one clipped window onto the field', () => {
    beforeEach(() => {
        useArrangementStore.getState().setArrangement(buildPaperSketch());
        useHistoryStore.getState().clear();
        useTrackLaneViewStore.setState({ expandedPianoRolls: {}, laneHeights: {}, headerWidth: HEADER_WIDTH, mixerOpen: false, automationLaneByTrack: {} });
        useUiViewStore.getState().setSurface('arrangement');
        useEditingContextStore.getState().clearSelection('arrangement');
        useEditingContextStore.getState().setSnapIndicatorTick(null);
        useEditingContextStore.getState().setClipDragPreview(null);
    });

    it('clips to the field, and does it by clipping rather than by z-order', () => {
        const body = ruleBody(SURFACE_CSS, '.arrangement-field-overlay');
        expect(body).toContain('overflow: hidden');
        // Its top edge IS the ruler's bottom edge, from the same two variables
        // the header grip and the ruler stack use — no third copy of 56 or 64.
        expect(body).toContain('top: calc(var(--arrangement-sky-height) + var(--arrangement-ruler-height))');
        // The ghost must stay ABOVE clips (z 2..6) and above the sticky ruler
        // (z 8) and the header column, so a lower z-index is not the answer.
        expect(Number(/z-index:\s*(\d+)/.exec(body)![1])).toBeGreaterThan(Number(/z-index:\s*(\d+)/.exec(ruleBody(SURFACE_CSS, '.arrangement-ruler-shell'))![1]));
        expect(Number(/z-index:\s*(\d+)/.exec(body)![1])).toBeGreaterThan(Number(/z-index:\s*(\d+)/.exec(ruleBody(SURFACE_CSS, '.arrangement-track__header'))![1]));
        // The ghost layer is now a zero-sized ORIGIN; the pane owns the clip.
        expect(ruleBody(GHOST_CSS, '.arrangement-drag-ghost-layer')).not.toContain('overflow: hidden');
    });

    it('keeps the JS sky constant equal to the CSS variable the pane is placed from', () => {
        const css = Number(/--arrangement-sky-height:\s*(\d+)px;/.exec(SURFACE_CSS)![1]);
        expect(Number(/const SKY_HEIGHT = (\d+);/.exec(SURFACE_TSX)![1])).toBe(css);
        expect(Number(/--arrangement-ruler-height:\s*(\d+)px;/.exec(GESTURE_CSS)![1])).toBe(RULER_HEIGHT);
    });

    it('is exactly the field viewport: the header edge to the right edge, the ruler to the bottom', () => {
        const { pane, scroll } = mount();
        scrollField(scroll, 0, 0);
        expect(pane.style.left).toBe(`${HEADER_WIDTH}px`);
        expect(pane.style.width).toBe(`${scroll.clientWidth - HEADER_WIDTH}px`);
        expect(pane.style.height).toBe(`${scroll.clientHeight - RULER_HEIGHT}px`);
    });

    it('holds EVERY transient overlay, and holds them nowhere else', () => {
        const { container, pane, scroll } = mount();
        const arrangement = useArrangementStore.getState().arrangement!;
        const trackId = arrangement.tracks[0]!.id!;
        const clipId = arrangement.tracks[0]!.clips[0]!.id!;
        act(() => {
            useArrangementStore.getState().apply({ kind: 'setLoopRange', location: { id: 'loop-1', name: 'Loop', kind: 'loop', startTick: 3840, endTick: 7680 } });
            useEditingContextStore.getState().setSelection('arrangement', { timeRange: { fromTick: 960, toTick: 3840, trackIds: [trackId] } });
            useEditingContextStore.getState().setSnapIndicatorTick(1920);
            useEditingContextStore.getState().setClipDragPreview({ clipId, sourceTrackId: trackId, hoveredTrackId: '', x: 40, y: 300, width: 180, height: 64, copy: false, tick: 960, originTick: 1920, locked: false });
        });
        // A marquee needs a real drag; everything else is document state.
        const lane = container.querySelector<HTMLElement>('.arrangement-lane')!;
        lane.getBoundingClientRect = () => ({ x: 200, y: 200, left: 200, top: 200, right: 1280, bottom: 272, width: 1080, height: 72, toJSON: () => ({}) });
        fireEvent.pointerDown(lane, { button: 0, pointerId: 91, clientX: 400, clientY: 230 });
        fireEvent.pointerMove(window, { pointerId: 91, clientX: 520, clientY: 260 });

        for (const selector of [
            '.arrangement-playhead',
            '.arrangement-snap-indicator',
            '.arrangement-loop-wash',
            '.arrangement-range-selection',
            '.arrangement-marquee',
            '[data-drag-ghost]',
            '.arrangement-drag-readout',
        ]) {
            const element = container.querySelector(selector);
            expect(element, `${selector} must render`).not.toBeNull();
            expect(pane.contains(element!), `${selector} must live inside the clipped pane`).toBe(true);
            expect(scroll.contains(element!), `${selector} must not be back inside the scroller`).toBe(false);
        }
        fireEvent.pointerUp(window, { pointerId: 91, clientX: 520, clientY: 260 });
    });

    it('counter-translates by the live scroll, so a scrolled playhead lands OUTSIDE the pane rather than on the headers', () => {
        const { container, scroll } = mount();
        const origin = container.querySelector<HTMLElement>('.arrangement-field-overlay__origin')!;
        scrollField(scroll, 0, 0);
        expect(origin.style.transform).toBe(`translate3d(${-HEADER_WIDTH}px,${-RULER_HEIGHT}px,0)`);

        for (const scrollLeft of [60, 150, 199, 400]) {
            scrollField(scroll, scrollLeft, 40);
            expect(origin.style.transform).toBe(`translate3d(${-HEADER_WIDTH - scrollLeft}px,${-RULER_HEIGHT - 40}px,0)`);
            /*
             * The playhead sits at content x = headerWidth + tick·pxPerTick and
             * the origin is shifted by -(headerWidth + scrollLeft), so its x
             * inside the pane is tick·pxPerTick - scrollLeft. At tick 0 that is
             * negative for every scroll > 0 — i.e. behind the pane's left edge,
             * which IS the header's right edge, and the pane clips. Before this
             * change the same playhead was drawn at surface x = 200 - scrollLeft,
             * which is inside the 0..200 header column (measured 432 px² of
             * overlap at 60 / 150 / 199).
             */
            const paneLocalX = 0 - scrollLeft;
            expect(paneLocalX).toBeLessThan(0);
            expect(HEADER_WIDTH + paneLocalX).toBeLessThan(HEADER_WIDTH);
        }
    });
});

/**
 * W4-TBc item 3 — the playhead does not tear in two.
 *
 * The LINE rides the overlay pane, whose origin is written synchronously in
 * `onScroll`. The CAP used to ride `.arrangement-ruler-content`, translated
 * from React state committed in a rAF, so for one frame of every scroll the two
 * halves of the playhead marked different instants: sampled per frame under a
 * real wheel, **150px apart** on a notch, 18px at 18px/frame, i.e. exactly one
 * frame of scroll at any rate (W4-TBb §2, `g2b.json`).
 *
 * The fix is one writer and one call. jsdom has no layout, so this asserts the
 * three facts that COMPOSE into "line.x − cap.x = 0": the cap is outside the
 * lagging box, the same scroll event writes both, and the two transforms put
 * the same tick at the same surface x. The per-frame equality under a real
 * wheel is measured in the browser run.
 */
describe('the playhead line and its cap are written by one scroll-synchronous writer', () => {
    beforeEach(() => {
        useArrangementStore.getState().setArrangement(buildPaperSketch());
        useHistoryStore.getState().clear();
        useTrackLaneViewStore.setState({ expandedPianoRolls: {}, laneHeights: {}, headerWidth: HEADER_WIDTH, mixerOpen: false, automationLaneByTrack: {} });
        useUiViewStore.getState().setSurface('arrangement');
        act(() => { useArrangementStore.setState({ isPlaying: false, playheadTick: 0 }); });
    });

    it('puts the cap OUTSIDE the ruler content, which is the box that lags', () => {
        const { container } = mount();
        const cap = container.querySelector<HTMLElement>('.arrangement-playhead-cap')!;
        const content = container.querySelector<HTMLElement>('.arrangement-ruler-content')!;
        const viewport = container.querySelector<HTMLElement>('.arrangement-ruler-viewport')!;
        // The content is the React/rAF-translated box; the viewport is static
        // and already clips at the header edge, which is why the cap can leave.
        expect(content.style.transform).toContain('translateX');
        expect(content.contains(cap)).toBe(false);
        expect(viewport.contains(cap)).toBe(true);
    });

    it('writes the pane origin and the cap in the SAME scroll call', () => {
        const { container, scroll } = mount();
        const origin = container.querySelector<HTMLElement>('.arrangement-field-overlay__origin')!;
        const cap = container.querySelector<HTMLElement>('.arrangement-playhead-cap')!;
        // The handler must reach both through the one writer. Calling the pane's
        // own writer from the handler would let the two be separated again.
        const handlerStart = SURFACE_TSX.indexOf('onScroll={(event) => {');
        expect(handlerStart, 'the scroll handler must be findable').toBeGreaterThan(0);
        const handler = SURFACE_TSX.slice(handlerStart, SURFACE_TSX.indexOf('scheduleViewportWrite();', handlerStart));
        expect(handler).toContain('writeScrollTransforms();');
        expect(handler).not.toContain('writeOverlayOrigin();');

        act(() => { useArrangementStore.setState({ playheadTick: 3840 }); });
        const pxPerTick = useEditingContextStore.getState().viewports.arrangement.pxPerTick;
        for (const scrollLeft of [0, 60, 150, 199, 400, 1500]) {
            // ONE event. Both elements must be current when it returns.
            scrollField(scroll, scrollLeft, 0);
            expect(translation(origin)[0]).toBe(-HEADER_WIDTH - scrollLeft);
            expect(translation(cap)[0]).toBeCloseTo(3840 * pxPerTick - scrollLeft, 6);
        }
    });

    it('lands the line and the cap on the same surface x at every scroll', () => {
        const { container, scroll } = mount();
        const origin = container.querySelector<HTMLElement>('.arrangement-field-overlay__origin')!;
        const line = container.querySelector<HTMLElement>('.arrangement-playhead')!;
        const cap = container.querySelector<HTMLElement>('.arrangement-playhead-cap')!;
        const pane = container.querySelector<HTMLElement>('[data-field-overlay]')!;
        /*
         * Both boxes begin at the header edge — the pane by inline style, the
         * ruler viewport as the second grid column — so surface x is the sum of
         * that origin and the transforms actually on the DOM.
         */
        expect(GESTURE_CSS).toMatch(/\.arrangement-ruler-shell\s*{[^}]*grid-template-columns:\s*var\(--arrangement-header-width[^}]*}/s);
        expect(GESTURE_CSS).toMatch(/\.arrangement-playhead\s*{[^}]*left:\s*var\(--arrangement-header-width/s);

        act(() => { useArrangementStore.setState({ playheadTick: 1920 }); });
        for (const scrollLeft of [0, 37, 150, 512, 2048]) {
            scrollField(scroll, scrollLeft, 0);
            // line: pane left + the pane origin + the line's own `left` + its tick
            const lineX = Number.parseFloat(pane.style.left) + translation(origin)[0] + HEADER_WIDTH + translation(line)[0];
            // cap: the ruler viewport's left + its tick, counter-scrolled itself
            const capX = HEADER_WIDTH + translation(cap)[0];
            expect(lineX - capX, `scrollLeft ${scrollLeft}`).toBe(0);
        }
    });
});

/**
 * W4-TBc item 1 (W4-TBb F1) — the inline roll obeys the same boundary.
 *
 * `.piano-roll` is `position: relative` with no `z-index`, so it opened no
 * stacking context and its scroomer (5), playhead (6), marquee (7) and clip
 * brackets (9) were compared directly against `.arrangement-track__header`
 * (z 5) — tying on z and winning on DOM order. Open a clip inline, scroll the
 * field 150px, and 54 pixels of the sticky header column belonged to
 * `piano-roll__scroomer` (`g7.json`); with `isolation: isolate` it is 0.
 *
 * The field's own transients are held off the chrome by a clip. The roll's are
 * held off by isolation. Same law, and this file is where the law is written
 * down, so this is where the roll is held to it.
 */
describe('the inline piano roll cannot paint on the chrome either', () => {
    it('isolates the roll so its z-ladder is never compared with the header', () => {
        const rollRule = ROLL_CSS.slice(ROLL_CSS.indexOf('\n.piano-roll {') + 1);
        const body = rollRule.slice(0, rollRule.indexOf('\n}'));
        // The DECLARATION, on its own line — not the word inside the comment
        // that explains it, which is what a looser `toContain` would have
        // accepted after someone deleted the one line that does the work.
        expect(body).toMatch(/^\s*isolation:\s*isolate;\s*$/m);
        // …and the reason travels with it, or the next reader deletes it.
        expect(body).toMatch(/z-ladder|stacking context/i);
    });

    it('names the exact collision it prevents: roll internals outrank the sticky header', () => {
        const headerZ = Number(/z-index:\s*(\d+)/.exec(ruleBody(SURFACE_CSS, '.arrangement-track__header'))![1]);
        const rollZ = ['.piano-roll__scroomer', '.piano-roll__playhead', '.piano-roll__marquee', '.piano-roll__clip-brackets']
            .map((selector) => {
                const start = ROLL_CSS.indexOf(`\n${selector} {`) + 1;
                expect(start, `${selector} must exist`).toBeGreaterThan(0);
                return Number(/z-index:\s*(\d+)/.exec(ROLL_CSS.slice(start, ROLL_CSS.indexOf('}', start)))![1]);
            });
        // Every one of them would win against the header on its own. Isolation
        // is the only thing standing between them and the track names.
        for (const z of rollZ) expect(z).toBeGreaterThanOrEqual(headerZ);
    });
});
