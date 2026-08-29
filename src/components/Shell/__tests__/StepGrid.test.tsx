import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

    it('parks the playhead column outside the grid while the transport is still', () => {
        useArrangementStore.getState().setArrangement(buildBeatSong());
        const { container } = render(<StepGrid />);
        expect(container.querySelector<HTMLElement>('.oj-step-grid__rows')?.dataset.step).toBe('-1');
    });
});
