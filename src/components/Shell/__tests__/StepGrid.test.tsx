import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../../../audio/executor', () => ({
    getExecutor: () => ({
        setArrangementLoop: vi.fn(),
        setArrangementPunch: vi.fn(),
        setArrangementClick: vi.fn(),
        setArrangementCountIn: vi.fn(),
        subscribeSignalLevels: () => () => {},
        getTimelineBackend: () => 'wasm',
    }),
    isTauri: () => false,
}));

const { useArrangementStore } = await import('../../../store/arrangementStore');
const { StepGrid } = await import('../StepGrid');
const { buildBeatSong, BEAT_SOURCE_ID, BEAT_STEP_TICKS } = await import('../../../rigs');
const { buildPaperSketch } = await import('../../../song/songs/paperSketch');

function notes() {
    const source = useArrangementStore.getState().arrangement?.sources?.[BEAT_SOURCE_ID];
    return source?.kind === 'midi' ? source.notes : [];
}

describe('StepGrid', () => {
    beforeEach(() => useArrangementStore.getState().setArrangement(null));

    it('is not there without a song', () => {
        const { container } = render(<StepGrid />);
        expect(container).toBeEmptyDOMElement();
    });

    it('is not there for a song that is not the beat rig', () => {
        useArrangementStore.getState().setArrangement(buildPaperSketch());
        const { container } = render(<StepGrid />);
        expect(container).toBeEmptyDOMElement();
    });

    it('renders three rows of eight over the beat rig clip', () => {
        useArrangementStore.getState().setArrangement(buildBeatSong());
        render(<StepGrid />);
        expect(screen.getAllByRole('button')).toHaveLength(24);
        expect(screen.getByRole('button', { name: 'KICK step 1' }).getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByRole('button', { name: 'KICK step 2' }).getAttribute('aria-pressed')).toBe('false');
    });

    it('writes real notes into the real clip, undoably', () => {
        useArrangementStore.getState().setArrangement(buildBeatSong());
        render(<StepGrid />);
        const before = notes().length;

        fireEvent.click(screen.getByRole('button', { name: 'KICK step 2' }));
        const added = notes().filter((note) => note.pitch === 36 && note.tick === BEAT_STEP_TICKS);
        expect(added).toHaveLength(1);
        expect(notes().length).toBe(before + 1);

        useArrangementStore.getState().undo();
        expect(notes().length).toBe(before);
    });

    it('erases the note a lit cell stands for', () => {
        useArrangementStore.getState().setArrangement(buildBeatSong());
        render(<StepGrid />);
        const before = notes().length;

        fireEvent.click(screen.getByRole('button', { name: 'KICK step 1' }));
        expect(notes().filter((note) => note.pitch === 36 && note.tick === 0)).toHaveLength(0);
        expect(notes().length).toBe(before - 1);
    });

    /*
     * U15 — it is a CARD, in the Song node's language.
     *
     * It shipped as an uncarded, full-bleed strip welded to the viewport bottom:
     * no title bar, no well, sitting straight on the canvas paper, clipping the
     * `SONG` card it is the face of, with its hint five hundred pixels from the
     * cells it described and its lit cells wearing the STATE colour
     * (FINAL-REVIEW §2.3).
     */
    it('is a card with a title bar, a well, and the hint beside its cells', () => {
        useArrangementStore.getState().setArrangement(buildBeatSong());
        const { container } = render(<StepGrid />);

        const card = container.querySelector('.oj-step-card')!;
        expect(card.getAttribute('aria-label')).toBe('Steps — Beat rig');
        expect(card.querySelector('.oj-step-card__title')?.textContent).toBe('Steps');
        expect(card.querySelector('.oj-step-card__type')?.textContent).toBe('Beat rig');

        // The grid and its hint are both INSIDE the well, in that order.
        const well = card.querySelector('.oj-step-card__well')!;
        expect(well.querySelector('.oj-step-grid__rows')).not.toBeNull();
        expect(well.querySelector('.oj-step-card__hint')?.textContent).toBe('Click a cell to add or remove a hit.');
        // And the strip that used to span the viewport is gone entirely.
        expect(container.querySelector('.oj-step-grid')).toBeNull();
    });

    it('paints a lit step in the second accent, never the state colour', () => {
        const css = readFileSync(resolve(process.cwd(), 'src/components/Shell/StepGrid.css'), 'utf8');
        const lit = /\.oj-step-grid__cell\.is-on \{([^}]*)\}/.exec(css)?.[1] ?? '';
        expect(lit, 'a groove is content, and content wears --acc2').toContain('var(--accent-two-ink)');
        expect(lit).not.toContain('var(--accent-primary)');
        // The playhead column stays a BORDER: the fill already means "this step plays".
        expect(css).toMatch(/nth-of-type\(8\)[\s\S]*?border-color: var\(--text-secondary\)/);
    });

    it('parks the playhead column outside the grid while the transport is still', () => {
        useArrangementStore.getState().setArrangement(buildBeatSong());
        const { container } = render(<StepGrid />);
        expect(container.querySelector<HTMLElement>('.oj-step-grid__rows')?.dataset.step).toBe('-1');
    });
});
