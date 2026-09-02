/**
 * U6, on the lane — the track says it has no instrument, before Play.
 *
 * FH-1 drew a clip, drew three notes, pressed Play and got silence plus a chip
 * blaming the audio engine. The cause was on the track she was looking at: its
 * `ref` named nothing, so `conduct` skipped it. The only report was a console
 * line, and the header showed the raw ref as if it were an instrument name.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { TrackLaneView } from '../TrackLaneView';
import type { Arrangement } from '../../../song/types';

beforeAll(() => {
    class TestResizeObserver { observe() {} disconnect() {} }
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(cleanup);

function song(bound: boolean): Arrangement {
    return {
        name: 'Untitled song',
        tempoBpm: 120,
        ppq: 960,
        timeSignature: [4, 4],
        graph: bound
            ? { nodes: [{ ref: 'voice', type: 'instrument', data: { instrumentId: 'karplus-nylon' } }], connections: [] }
            : { nodes: [], connections: [] },
        tracks: [{ id: 'track-1', name: 'Track 1', ref: bound ? 'voice' : 'track-1', clips: [] }],
    };
}

function lane(bound: boolean) {
    const arrangement = song(bound);
    return render(
        <TrackLaneView track={arrangement.tracks[0]!} arrangement={arrangement} pxPerTick={1} visibleStartTick={0} visibleEndTick={10_000} />,
    );
}

describe('an unbound track', () => {
    it('says so, in words, instead of showing its raw ref', () => {
        lane(false);
        expect(screen.getByText('No instrument yet')).toBeInTheDocument();
        expect(screen.queryByText('track-1')).toBeNull();
    });

    it('carries the whole sentence for anything that is not an eye', () => {
        lane(false);
        expect(screen.getByRole('button', { name: 'No instrument yet on Track 1 — choose one' })).toBeInTheDocument();
    });

    /*
     * Mute, Solo and Automation act on a voice. There isn't one. Offering them
     * is a control for nothing — and hiding them is what gives the sentence room
     * inside a 200px header at the 13px type floor.
     */
    it('offers no controls for a voice that does not exist', () => {
        lane(false);
        expect(screen.queryByRole('button', { name: /^Mute/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /^Solo/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /automation for/i })).toBeNull();
        // Arm survives: the empty state's "Record something" arms a track before
        // it has an instrument.
        expect(screen.getByRole('button', { name: /Arm Track 1/ })).toBeInTheDocument();
    });

    it('opens the picker from EITHER half of the chip', () => {
        const opened: string[] = [];
        window.addEventListener('openjammer:open-browser', (event) => {
            opened.push((event as CustomEvent<{ trackId?: string }>).detail?.trackId ?? '');
        });
        lane(false);

        screen.getByRole('button', { name: 'No instrument yet on Track 1 — choose one' }).click();
        screen.getByRole('button', { name: 'Choose instrument for Track 1' }).click();

        expect(opened).toEqual(['track-1', 'track-1']);
    });
});

/*
 * G-08. The three lanes behind the empty-state card are ruled ground, not
 * tracks. They used to render M / S / ● / A beside a chip whose name was the
 * empty string — three rows of unlabelled controls next to a blank pill, which
 * reads as a failed render rather than as paper.
 */
describe('a shell lane (the ruled ground behind the empty page)', () => {
    const ghost = { id: 'empty-ghost-0', name: '', ref: '', clips: [] };
    const shellLane = () => render(
        <TrackLaneView track={ghost} arrangement={song(false)} pxPerTick={1} visibleStartTick={0} visibleEndTick={10000} shell />,
    );

    it('has no controls on it at all', () => {
        const { container } = shellLane();
        expect(container.querySelectorAll('button')).toHaveLength(0);
        expect(container.querySelector('.arrangement-instrument-chip')).toBeNull();
        expect(container.querySelector('.arrangement-track__swatch')).toBeNull();
        expect(container.querySelector('.arrangement-track__controls')).toBeNull();
    });

    it('still draws the lane it is there to draw', () => {
        const { container } = shellLane();
        expect(container.querySelector('.arrangement-track')).not.toBeNull();
        expect(container.querySelector('.arrangement-lane')).not.toBeNull();
        expect(container.querySelector('.arrangement-track__stripe')).not.toBeNull();
    });
});

describe('a bound track', () => {
    it('shows its instrument and its full control row', () => {
        lane(true);
        expect(screen.getByText('karplus-nylon')).toBeInTheDocument();
        expect(screen.queryByText('No instrument yet')).toBeNull();
        expect(screen.getByRole('button', { name: /^Mute/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Solo/ })).toBeInTheDocument();
    });
});
