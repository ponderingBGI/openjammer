/**
 * ExportDialog — the FORM, not the renderer.
 *
 * The bounce itself is covered by `browserExport` / `nativeExport` /
 * `exportSpec`. What is covered here is the thing a player actually touches:
 * that format and bit depth are two honest decisions rather than one dropdown of
 * five strings, that the browser tier does not offer a format it cannot write,
 * that FLAC never keeps an impossible 32-bit-float pairing, and that the tail
 * scrubber only appears when the tail is fixed.
 */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

let native = false;
vi.mock('../../../ai/tauri', () => ({ isTauri: () => native, openExternal: vi.fn() }));
vi.mock('../../../keymap/useKeymap', () => ({ useModalKeymap: vi.fn() }));

import { ExportDialog } from '../ExportDialog';
import type { Arrangement } from '../../../song/types';

const arrangement = {
    name: 'Test song',
    ppq: 960,
    tempoBpm: 120,
    timeSignature: [4, 4],
    tracks: [],
    sources: {},
    locations: [],
} as unknown as Arrangement;

function open() {
    return render(<ExportDialog open arrangement={arrangement} onClose={vi.fn()} />);
}

afterEach(() => {
    cleanup();
    native = false;
});

describe('ExportDialog form', () => {
    it('offers format and bit depth as two separate decisions on the desktop', () => {
        native = true;
        open();

        const format = screen.getByRole('tablist', { name: 'Export format' });
        expect(within(format).getByRole('tab', { name: 'WAV' })).toHaveAttribute('aria-selected', 'true');
        expect(within(format).getByRole('tab', { name: 'FLAC' })).toBeInTheDocument();

        const depth = screen.getByRole('tablist', { name: 'Bit depth' });
        expect(within(depth).getByRole('tab', { name: '24-bit' })).toHaveAttribute('aria-selected', 'true');
        expect(within(depth).getByRole('tab', { name: '32-bit float' })).toBeInTheDocument();
    });

    it('drops 32-bit float when FLAC is chosen, rather than keeping an illegal pair', () => {
        native = true;
        open();

        const format = screen.getByRole('tablist', { name: 'Export format' });
        fireEvent.click(within(screen.getByRole('tablist', { name: 'Bit depth' })).getByRole('tab', { name: '32-bit float' }));
        fireEvent.click(within(format).getByRole('tab', { name: 'FLAC' }));

        const depth = screen.getByRole('tablist', { name: 'Bit depth' });
        expect(within(depth).queryByRole('tab', { name: '32-bit float' })).toBeNull();
        expect(within(depth).getByRole('tab', { name: '24-bit' })).toHaveAttribute('aria-selected', 'true');
    });

    it('states the fixed values in the browser instead of greying out a control', () => {
        open();

        // A disabled SegmentedControl is dimmed as a whole, so you cannot read
        // WHICH segment is selected. Off the desktop there is no choice to make,
        // so the value is simply stated — and the reason is given.
        expect(screen.queryByRole('tablist', { name: 'Export format' })).toBeNull();
        expect(screen.queryByRole('tablist', { name: 'Bit depth' })).toBeNull();
        expect(screen.getByLabelText('Export format')).toHaveTextContent('WAV');
        expect(screen.getByLabelText('Bit depth')).toHaveTextContent('24-bit');
        expect(screen.getByText('FLAC is desktop only')).toBeInTheDocument();
        expect(screen.getByText('The browser writes 24-bit')).toBeInTheDocument();
        expect(screen.getByText('Browser export')).toBeInTheDocument();
    });

    it('offers the four sample rates and switches between them', () => {
        open();

        const rates = screen.getByRole('tablist', { name: 'Sample rate' });
        ['44.1 kHz', '48 kHz', '88.2 kHz', '96 kHz'].forEach((label) => {
            expect(within(rates).getByRole('tab', { name: label })).toBeInTheDocument();
        });
        expect(within(rates).getByRole('tab', { name: '48 kHz' })).toHaveAttribute('aria-selected', 'true');

        fireEvent.click(within(rates).getByRole('tab', { name: '96 kHz' }));
        expect(within(rates).getByRole('tab', { name: '96 kHz' })).toHaveAttribute('aria-selected', 'true');
    });

    it('only shows the tail scrubber when the tail is fixed', () => {
        open();

        const tail = screen.getByRole('tablist', { name: 'Export tail' });
        expect(screen.queryByText('2.0 s')).toBeNull();

        fireEvent.click(within(tail).getByRole('tab', { name: 'Fixed' }));
        expect(screen.getByText('2.0 s')).toBeInTheDocument();

        fireEvent.click(within(tail).getByRole('tab', { name: /Auto/ }));
        expect(screen.queryByText('2.0 s')).toBeNull();
    });

    it('requires a filename before it will export', () => {
        open();

        const exportButton = screen.getByRole('button', { name: 'Export song' });
        expect(exportButton).not.toBeDisabled();

        fireEvent.change(screen.getByLabelText('Filename'), { target: { value: '   ' } });
        expect(screen.getByRole('button', { name: 'Export song' })).toBeDisabled();
    });

    it('states the preflight estimate in mono, up front', () => {
        open();

        const preflight = screen.getByLabelText('Estimated export size');
        expect(preflight.textContent).toMatch(/bars ·/);
        expect(preflight.textContent).toMatch(/MB/);
    });
});
