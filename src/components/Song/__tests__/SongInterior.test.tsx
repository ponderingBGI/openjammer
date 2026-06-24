import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SongInterior } from '../SongInterior';
import { useArrangementStore } from '../../../store/arrangementStore';
import { buildPaperSketch } from '../../../song/songs/paperSketch';

const store = () => useArrangementStore.getState();

afterEach(cleanup);

describe('SongInterior — the on-canvas timeline', () => {
    describe('empty state', () => {
        beforeEach(() => store().setArrangement(null));

        it('invites a start and seeds Paper Sketch on click', () => {
            render(<SongInterior songNodeId="song-1" />);
            const start = screen.getByRole('button', { name: /Start from/i });
            fireEvent.click(start);
            // The store now holds the seeded song …
            expect(store().arrangement?.name).toBe('Paper Sketch No. 1');
            // … and the codeNodes were stripped (native-only) for browser playback.
            expect(store().arrangement?.codeNodes).toBeUndefined();
            // … and the timeline now shows the real tracks.
            expect(screen.getByText('Nylon Chords')).toBeTruthy();
        });
    });

    describe('loaded song', () => {
        beforeEach(() => store().setArrangement(buildPaperSketch()));

        it('renders every track, bar numbers, sections, and notes', () => {
            const { container } = render(<SongInterior songNodeId="song-1" />);
            for (const name of ['Nylon Chords', 'Bass', 'Lead']) {
                expect(screen.getByText(name)).toBeTruthy();
            }
            // Ruler bar labels (1-based) and section markers.
            expect(screen.getByText('1')).toBeTruthy();
            for (const sec of ['Intro', 'Groove', 'Lift', 'Outro']) {
                expect(screen.getByText(sec)).toBeTruthy();
            }
            // Notes are drawn as ink marks — the chords clip alone has 8 per bar.
            expect(container.querySelectorAll('.song-note').length).toBeGreaterThan(50);
            // And there are exactly three clips (one per track).
            expect(container.querySelectorAll('.song-clip').length).toBe(3);
        });

        it('transport play/stop toggles through the store', () => {
            render(<SongInterior songNodeId="song-1" />);
            expect(store().isPlaying).toBe(false);
            fireEvent.click(screen.getByTitle('Play'));
            expect(store().isPlaying).toBe(true);
            fireEvent.click(screen.getByTitle('Stop'));
            expect(store().isPlaying).toBe(false);
        });

        it('a mute toggle is a reversible verb (undo restores it)', () => {
            render(<SongInterior songNodeId="song-1" />);
            const firstMute = screen.getAllByTitle('Mute')[0]!;
            fireEvent.click(firstMute);
            expect(store().arrangement!.tracks[0]!.mute).toBe(true);
            // The transport's undo button shares the agent's command-log.
            fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
            expect(store().arrangement!.tracks[0]!.mute).toBeUndefined();
        });

        it('clicking a clip selects it (and highlights it)', () => {
            const { container } = render(<SongInterior songNodeId="song-1" />);
            const clip = container.querySelector('.song-clip')!;
            fireEvent.mouseDown(clip);
            const firstClipId = store().arrangement!.tracks[0]!.clips[0]!.id;
            expect(store().selectedClipId).toBe(firstClipId);
            // Re-render reflects the selection class.
            expect(container.querySelector('.song-clip.selected')).toBeTruthy();
        });

        it('the playhead exists and the rewind seeks to the start', () => {
            const { container } = render(<SongInterior songNodeId="song-1" />);
            expect(container.querySelector('.song-playhead')).toBeTruthy();
            store().seek(5000);
            expect(store().currentTick()).toBe(5000);
            fireEvent.click(screen.getByTitle('Return to start'));
            expect(store().currentTick()).toBe(0);
        });
    });
});
