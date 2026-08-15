import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ArrangementSurface } from '../ArrangementSurface';
import { useArrangementStore } from '../../../store/arrangementStore';

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
        expect(surface?.querySelector('.song-interior')).not.toBeNull();
    });
});
