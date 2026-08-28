import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ArrangementSurface } from '../ArrangementSurface';
import { useArrangementStore } from '../../../store/arrangementStore';
import { buildPaperSketch } from '../../../song/songs/paperSketch';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

    it('keeps ascenders intact in a 26px track-name row', () => {
        const arrangement = buildPaperSketch();
        arrangement.tracks[0] = { ...arrangement.tracks[0]!, name: 'Lead' };
        useArrangementStore.getState().setArrangement(arrangement);
        render(<ArrangementSurface active songNodeId="song-1" />);
        expect(screen.getAllByText('Lead', { selector: '.arrangement-track__name' })[0]).toHaveTextContent('Lead');
        const css = readFileSync(join(process.cwd(), 'src/components/Arrangement/ArrangementSurface.css'), 'utf8');
        expect(css).toMatch(/grid-template-rows:\s*26px 24px/);
        expect(css).toMatch(/font:\s*600 18px\/26px var\(--font-sketch\)/);
        expect(css).toMatch(/overflow-clip-margin:\s*6px/);
    });
});
