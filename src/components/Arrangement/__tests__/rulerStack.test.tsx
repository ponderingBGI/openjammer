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
const PILL_HOST_TSX = readFileSync(resolve(process.cwd(), 'src/components/Shell/TransportPillHost.tsx'), 'utf8');
const TIMELINE_DOC = readFileSync(resolve(process.cwd(), 'docs/timeline.md'), 'utf8');

/** Every field overlay that has to begin exactly where the ruler ends. */
const RULER_OFFSET_RULES = [
    '.arrangement-field-ground',
    '.arrangement-song-end',
    '.arrangement-grid-anchor',
    '.arrangement-playhead',
    '.arrangement-loop-wash',
    '.arrangement-range-selection',
    '.arrangement-marquee.is-range',
    /*
     * `.arrangement-record-error` is deliberately NOT in this list any more.
     * W4-TB moved record/transport failures out of a floating banner and into a
     * CHIP in the sky band's utility cluster (spec 8.3: never a modal, never
     * something that shoves the ruler down). There is no longer an element to
     * offset from the ruler, so a rule for one would be dead CSS.
     */
];

function ruleBody(css: string, selector: string): string {
    const start = css.indexOf(`\n${selector} {`) + 1;
    expect(start, `${selector} must exist in ArrangementSurface.css`).toBeGreaterThan(0);
    return css.slice(start, css.indexOf('}', start));
}

/** The body of `@media (max-width: N px) { … }`, brace-matched so nested rules survive. */
function mediaBlock(css: string, query: string): string {
    const start = css.indexOf(`@media (${query}) {`);
    expect(start, `@media (${query}) must exist`).toBeGreaterThan(-1);
    let depth = 0;
    for (let index = css.indexOf('{', start); index < css.length; index++) {
        if (css[index] === '{') depth++;
        else if (css[index] === '}' && --depth === 0) return css.slice(css.indexOf('{', start) + 1, index);
    }
    throw new Error(`unterminated @media (${query})`);
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

    /*
     * W4-TBb M3. The pill is `position: fixed; left: 50%` — centred on the
     * WINDOW — so the only construction that can promise it never covers a
     * control is a symmetric one. The shipped sky band reserved its middle on
     * ONE side only (a `flex: 0 0 clamp(...)` gap that protected the song name),
     * and the right-flushed utility cluster walked straight under the pill:
     * measured 1 152 px² of the ARMED `Slide` button covered at 1024px and
     * 1 008 px² at 900px, with `elementFromPoint` returning the pill's keycap
     * both times (`before.json → sky`). Which edit mode is armed is exactly the
     * thing a performer must be able to read without clicking.
     */
    it('reserves the pill lane on BOTH sides of the sky band', () => {
        const body = ruleBody(SURFACE_CSS, '.arrangement-sky');
        expect(body).toContain('display: grid');
        const columns = /grid-template-columns:\s*([^;]+);/.exec(body)![1]!;
        const [before, centre, after] = columns.split(/\s+(?=minmax|var)/);
        expect(centre, 'the centre column is the pill reserve').toContain('--arrangement-sky-pill-reserve');
        expect(before, 'the two side columns must be identical, or the reserve is not centred').toBe(after);
        // The one-sided flex reserve is gone, and the cluster wraps instead of
        // sliding: nothing in this band may leave the surface to make room.
        expect(ruleBody(SURFACE_CSS, '.arrangement-sky__gap')).not.toContain('flex');
        expect(ruleBody(SURFACE_CSS, '.arrangement-sky__utility')).toContain('flex-wrap: wrap');
        expect(SURFACE_CSS).not.toMatch(/\.arrangement-edit-mode\s*{[^}]*display:\s*none/);
    });

    /*
     * W4-TBc item 4 (W4-TBb §12.2). The reserve used to be the literal `432px`
     * — a COPY of a measurement (the pill was 427.9px with every zone present),
     * with a `>= 428` assertion that was a copy of the same measurement. Add a
     * zone to `TransportPill` and the pill grows past the lane it was promised,
     * M3 comes straight back, and every gate stays green. So the reserve is now
     * derived from a width the pill itself publishes, and the number in this
     * file is only the fallback for the frame before the first measurement.
     */
    it('derives the pill lane from a width the pill publishes, not from a copied measurement', () => {
        const reserve = /--arrangement-sky-pill-reserve:\s*([^;]+);/.exec(SURFACE_CSS)![1]!;
        expect(reserve).toBe('calc(var(--oj-transport-pill-width, 428px) + 4px)');
        expect(reserve, 'a literal reserve is exactly the coupling this replaces').not.toMatch(/^\d+px$/);
        // The fallback still has to cover the measured pill, because it is what
        // the reserve is worth before the observer has ever fired.
        expect(Number(/--oj-transport-pill-width,\s*(\d+)px/.exec(reserve)![1])).toBeGreaterThanOrEqual(428);
        // Declared as well as defaulted, so the gate against undeclared custom
        // properties can see it and a host that stops publishing degrades to a
        // real reserve rather than to nothing.
        expect(SURFACE_CSS).toMatch(/--oj-transport-pill-width:\s*428px;/);

        // …and the publisher exists, with ONE observer that writes on change only.
        expect(PILL_HOST_TSX).toContain('--oj-transport-pill-width');
        expect(PILL_HOST_TSX).toContain('new ResizeObserver(publish)');
        expect((PILL_HOST_TSX.match(/new ResizeObserver/g) ?? []).length).toBe(1);
        expect(PILL_HOST_TSX).toMatch(/if \(width <= 0 \|\| Math\.abs\(width - published\) < 0\.5\) return;/);
    });

    /*
     * W4-TBc item 2 (W4-TBb F2). The cluster starts WRAPPING at ~1177px, but
     * the compaction that makes two rows fit was at 1024px: measured 2.2px of
     * overflow and 627–781px² of cluster ∩ ruler at every width from 1030 to
     * 1177 — a ~150px band containing 1152 and 1176 and any non-maximised
     * window, in which the ruler's sections row paints over the zoom chip.
     * Two 30px rows plus the 3px gap is 63px in a 56px band; compacted they are
     * 24 + 3 + 24 = 51 and fit. The breakpoint has to BE the wrap.
     */
    it('compacts the cluster at the width it starts wrapping, not 150px later', () => {
        const compaction = mediaBlock(SURFACE_CSS, 'max-width: 1180px');
        for (const rule of [
            '.arrangement-sky__utility { gap: 3px 4px; }',
            '.arrangement-sky__utility .oj-btn { height: 24px; min-height: 24px; padding: 0 8px; }',
            '.arrangement-sky__utility .arrangement-edit-mode { padding: 2px; }',
            '.arrangement-sky__utility .arrangement-edit-mode button { padding: 0 7px; }',
        ]) expect(compaction, 'the compaction rules belong on the wrap width').toContain(rule);

        // The `Tab` hint keeps its own, narrower width — it is not what wraps.
        const hint = mediaBlock(SURFACE_CSS, 'max-width: 1024px');
        expect(hint).toContain('.arrangement-sky__hint { display: none; }');
        expect(hint, 'compaction must not still be sitting at 1024').not.toContain('.arrangement-sky__utility');

        // 1180 ≥ the 1177 the cluster actually wraps at, and the zoom chip still
        // leaves later, at 900 — the order of the three widths is the design.
        expect(SURFACE_CSS.indexOf('@media (max-width: 1180px)')).toBeLessThan(SURFACE_CSS.indexOf('@media (max-width: 1024px)'));
        expect(mediaBlock(SURFACE_CSS, 'max-width: 900px')).toContain('.arrangement-zoom-scrubber { display: none; }');

        // The doc must not still teach the wrong threshold.
        expect(TIMELINE_DOC, 'docs/timeline.md still says the cluster compacts below 1024').not.toMatch(/Below 1024px the cluster's controls compact/);
        expect(TIMELINE_DOC).toContain('1180px');
    });

    /*
     * W6-UI item 8 / W4-TBb-REPORT §2b — THE ALERT SHEDS ITS SENTENCE ON THE
     * SAME WIDTH.
     *
     * A full-sentence chip costs a row's worth of width, so with an alert
     * present the cluster wanted a THIRD compacted row: 24 + 3 + 24 + 3 + 24 =
     * 78px inside a 56px band. Measured 24.19px of overflow and 7 621px² of
     * cluster ∩ ruler from 1030px down, and no cap on the text fixes it (even
     * 10ch still overflows below 840px). Growing the band is what spec 8.3
     * forbids. So below the SAME width the cluster compacts at, the chip becomes
     * the warning glyph.
     *
     * On the pre-fix sheet there is no glyph rule and no label rule, and the
     * chip carried no `title` at all, so the tail of a truncated message was
     * unreadable at every width.
     */
    it('turns the alert chip into a glyph on the compaction width, without silencing it', () => {
        const compaction = mediaBlock(SURFACE_CSS, 'max-width: 1180px');
        expect(compaction, 'the 34ch cap is what forced the row; it goes with the text').toMatch(/\.arrangement-sky__alert\s*{[^}]*max-width:\s*none;/s);
        expect(compaction, 'the glyph sizes itself once the sentence is out of flow').toMatch(/\.arrangement-sky__alert\s*{[^}]*flex:\s*0 0 auto;/s);

        // The label is CLIPPED, never removed: the chip is its own `role=status`
        // live region and a removed label is a failure nobody hears.
        const label = /\.arrangement-sky__alert \.oj-chip__label\s*{([^}]*)}/s.exec(compaction)?.[1] ?? '';
        expect(label, 'display:none would take the message out of the a11y tree').not.toMatch(/display:\s*none/);
        expect(label).toMatch(/position:\s*absolute/);
        expect(label).toMatch(/clip:\s*rect\(0, 0, 0, 0\)/);
        expect(label).toMatch(/width:\s*1px/);

        /*
         * Wide, the sentence is the chip — but on a flex BASE OF ZERO, so it
         * takes the slack the controls leave instead of wrapping onto a row of
         * its own. `flex: 0 1 auto` (wrap is decided before shrink) is what put
         * 57px of cluster in a 56px band from 1190px up, and 64px from ~1350:
         * the full sentence only ever fitted on a 1885px window. The 27px floor
         * is the glyph plus its padding — squeezed, never vanished.
         */
        expect(SURFACE_CSS).toMatch(/\.arrangement-sky__alert\s*{[^}]*flex:\s*1 1 0;/s);
        expect(SURFACE_CSS).toMatch(/\.arrangement-sky__alert\s*{[^}]*min-width:\s*27px;/s);
        expect(SURFACE_CSS).toMatch(/\.arrangement-sky__alert\s*{[^}]*max-width:\s*34ch;/s);

        // ...and the full message is on `title` at EVERY width, because 34ch
        // truncates even when the text is showing.
        const skyBand = readFileSync(resolve(process.cwd(), 'src/components/Arrangement/SkyBand.tsx'), 'utf8');
        expect(skyBand).toMatch(/title=\{children\}/);
        expect(skyBand).toMatch(/glyph=\{<IconWarning/);
        expect(skyBand, 'every alert goes through the one component').not.toMatch(/<Chip className="arrangement-sky__alert"/);
        expect((skyBand.match(/<Alert tone=/g) ?? []).length, 'faults, transport and record all use it').toBe(3);
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
    function doublePress(press: HTMLElement, retarget: HTMLElement, clientX: number, modifiers: { altKey?: boolean } = {}) {
        for (const pointerId of [61, 62]) {
            fireEvent.pointerDown(press, { button: 0, pointerId, clientX, clientY: 88, ...modifiers });
            fireEvent.pointerUp(window, { pointerId, clientX, clientY: 88, ...modifiers });
        }
        fireEvent.doubleClick(retarget, { clientX, clientY: 88, detail: 2, ...modifiers });
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

    /*
     * W4-TBb, from W4-TB-REVIEW §2. There is no "empty band" on a section chip
     * any more: `.arrangement-section-chip__label` is `display: block`, so it
     * fills the chip, and on Paper Sketch the sections cover the whole song —
     * which left marker creation by hand with NO gesture at all (the gate
     * measured `marksAfter 1 -> 0`). The old test pressed the chip ELEMENT,
     * which a real pointer can never hit, so it kept passing while the browser
     * did not. ALT is the gesture now: it is this surface's "do the other
     * thing" modifier already, and rename stays the plain double-click because
     * renaming is far commoner than dropping a mark inside a named section.
     */
    it('the chip label fills the chip, so there is no empty band left to press', () => {
        expect(SURFACE_CSS).toMatch(/\.arrangement-section-chip__label\s*{[^}]*display:\s*block;/);
    });

    it('ALT + double-clicking a chip LABEL drops a marker and opens no rename', () => {
        const { container } = mount();
        const chip = container.querySelector<HTMLElement>('.arrangement-section-chip')!;
        const label = chip.querySelector<HTMLElement>('.arrangement-section-chip__label')!;
        const before = markerCount();
        doublePress(label, chip, 420, { altKey: true });
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

    /*
     * W4-TBc item 5 (W4-TBb §12.5). The gesture works and nothing on screen
     * said it existed: `title` and `aria-label` on the row and on the chip were
     * all null, and the cursor is a plain pointer. `Ctrl+M` is in the
     * keybindings catalogue, but it drops at the PLAYHEAD — a different gesture,
     * not the same one by another route — so the modifier was undiscoverable.
     * The tooltip is on the ROW so it covers both the chips and the uncovered
     * strip, which is exactly the pair of gestures it describes.
     */
    it('says out loud that Alt is what drops a marker on a covered row', () => {
        const { container } = mount();
        const row = container.querySelector<HTMLElement>('.arrangement-sections-row')!;
        expect(row.title).toBe('Double-click to rename · Alt+double-click to add a marker');
        // A chip has no title of its own, so hovering one inherits the row's —
        // the affordance has to be there where the sections actually are.
        expect(container.querySelector<HTMLElement>('.arrangement-section-chip')!.title).toBe('');
        // And the doc teaches the same sentence.
        expect(TIMELINE_DOC).toContain('Alt+double-click to add a marker');
    });

    it('double-clicking the bars row drops nothing', () => {
        const { container, ruler } = mount();
        const bars = container.querySelector<HTMLElement>('.arrangement-bars-row')!;
        const before = markerCount();
        doublePress(bars, ruler, 560);
        expect(markerCount()).toBe(before);
    });
});
