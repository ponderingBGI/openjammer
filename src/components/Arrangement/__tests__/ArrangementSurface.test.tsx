import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ArrangementSurface } from '../ArrangementSurface';
import { useArrangementStore } from '../../../store/arrangementStore';
import { buildPaperSketch } from '../../../song/songs/paperSketch';

beforeAll(() => {
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

    it('renders the ruled empty invitation with the Paper Sketch action', () => {
        useArrangementStore.getState().setArrangement(null);
        render(<ArrangementSurface active songNodeId="song-1" />);
        expect(screen.getByRole('heading', { name: 'An empty page.' })).toBeVisible();
        expect(screen.getByRole('button', { name: /Paper Sketch/i })).toBeVisible();
        expect(document.querySelectorAll('.arrangement-empty-lane')).toHaveLength(3);
    });

    it('renders populated tracks and source-window clips', () => {
        useArrangementStore.getState().setArrangement(buildPaperSketch());
        const { container } = render(<ArrangementSurface active songNodeId="song-1" />);
        expect(container.querySelectorAll('.arrangement-track')).toHaveLength(3);
        expect(container.querySelectorAll('.arrangement-clip').length).toBeGreaterThan(0);
        expect(screen.queryByText('An empty page.')).not.toBeInTheDocument();
    });
});
