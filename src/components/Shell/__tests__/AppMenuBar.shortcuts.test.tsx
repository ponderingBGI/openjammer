import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppMenuBar } from '../AppMenuBar';
import { UNBOUND_KEY, useKeybindingsStore } from '../../../store/keybindingsStore';

vi.mock('../../../audio/executor', () => ({
    getExecutor: () => ({ capturePluginStates: vi.fn() }),
    isTauri: () => false,
}));

describe('AppMenuBar shortcut labels', () => {
    beforeEach(() => useKeybindingsStore.setState({ customBindings: {} }));

    it('tracks rebound and removed keymap actions without stale File shortcuts', () => {
        useKeybindingsStore.getState().setBinding('view.zoomIn', { key: 'u', alt: true });
        useKeybindingsStore.getState().setBinding('view.zoomOut', { key: UNBOUND_KEY });
        render(<AppMenuBar />);

        fireEvent.click(screen.getByRole('button', { name: /^View/ }));
        expect(screen.getByText('Alt+U')).toBeInTheDocument();
        expect(screen.queryByText('Alt+-')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /^File/ }));
        expect(screen.queryByText(/Ctrl\+[NO]$/)).not.toBeInTheDocument();
    });

    it('keeps the looper hold reachable now that Space plays the song', () => {
        render(<AppMenuBar />);

        fireEvent.click(screen.getByRole('button', { name: /^View/ }));
        expect(screen.getByText('Pause loopers')).toBeInTheDocument();
    });
});
