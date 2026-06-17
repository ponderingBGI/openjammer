/**
 * ContextMenu (M4) render tests.
 *
 * The right-click menu is a FILTERED PROJECTION of the SAME Action registry the
 * Ctrl+K palette reads, filtered to `surface: 'menu'`. These tests exercise that
 * projection through the real component:
 *   (a) the nested CATEGORIES render with their items (grouped by `action.path`);
 *   (b) selecting an item RUNS the action (spawning a node via the registered
 *       `run`) and CLOSES the menu;
 *   (c) the MIDI item (`node.add.midi`) triggers `onOpenMIDIBrowser` instead of
 *       running its action, when the handler is provided.
 *
 * The capability seam is mocked (desktop) so `buildMenuCtx` is deterministic;
 * `useCanvasStore.screenToCanvas` is mocked to an identity so the clicked point
 * is predictable.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { DESKTOP_CAPABILITIES } from '../../../engine/capabilities';
import type { Position } from '../../../engine/types';

// --- Mocks -----------------------------------------------------------------

// Deterministic capability seam: desktop row.
vi.mock('../../../audio/executor', () => ({
    getExecutor: () => ({
        getCapabilities: () => DESKTOP_CAPABILITIES,
    }),
}));

// Identity screenToCanvas so the menu's canvas point == its screen point.
vi.mock('../../../store/canvasStore', () => ({
    useCanvasStore: Object.assign(
        (selector: (s: { screenToCanvas: (p: Position) => Position }) => unknown) =>
            selector({ screenToCanvas: (p: Position) => p }),
        {
            getState: () => ({ screenToCanvas: (p: Position) => p }),
        },
    ),
}));

import { ContextMenu } from '../ContextMenu';
import {
    register,
    registerAll,
    _resetForTests,
    type Action,
} from '../../../store/commandRegistry';
import { useGraphStore } from '../../../store/graphStore';

/** A node-add-style Action offered on both surfaces, placed in `path` category. */
function makeNodeAdd(
    id: string,
    title: string,
    category: string,
    run = vi.fn(),
): Action {
    return {
        id,
        title,
        group: category,
        path: [category],
        targets: ['global', 'canvasPoint', 'selection'],
        surfaces: ['palette', 'menu'],
        run,
    };
}

const POSITION: Position = { x: 100, y: 120 };

describe('ContextMenu (M4)', () => {
    beforeEach(() => {
        cleanup();
        _resetForTests();
        // No selection (menu ctx → no single node target).
        useGraphStore.setState({ selectedNodeIds: new Set() });
    });

    afterEach(() => {
        cleanup();
    });

    it('renders the nested categories with their items (projection of the registry)', () => {
        registerAll([
            makeNodeAdd('node.add.looper', 'Add Looper', 'Routing'),
            makeNodeAdd('node.add.keys', 'Add Keys', 'Instruments'),
        ]);

        render(<ContextMenu position={POSITION} onClose={() => {}} />);

        // Both categories present...
        expect(screen.getByText('Instruments')).toBeInTheDocument();
        expect(screen.getByText('Routing')).toBeInTheDocument();
        // ...with their items.
        expect(screen.getByText('Add Keys')).toBeInTheDocument();
        expect(screen.getByText('Add Looper')).toBeInTheDocument();
    });

    it('does NOT show palette-only actions (the curated SUBSET)', () => {
        registerAll([
            makeNodeAdd('node.add.looper', 'Add Looper', 'Routing'),
            // App action: palette-only, must be absent from the menu.
            {
                id: 'app.settings',
                title: 'Open Settings',
                group: 'App',
                targets: ['global'],
                surfaces: ['palette'],
                run: vi.fn(),
            },
        ]);

        render(<ContextMenu position={POSITION} onClose={() => {}} />);

        expect(screen.getByText('Add Looper')).toBeInTheDocument();
        expect(screen.queryByText('Open Settings')).toBeNull();
    });

    it('runs the action and closes when an item is selected', () => {
        const run = vi.fn();
        const onClose = vi.fn();
        register(makeNodeAdd('node.add.looper', 'Add Looper', 'Routing', run));

        render(<ContextMenu position={POSITION} onClose={onClose} />);
        fireEvent.click(screen.getByText('Add Looper'));

        // The action ran, with a ctx carrying the clicked canvas point.
        expect(run).toHaveBeenCalledOnce();
        const ctx = run.mock.calls[0][0];
        expect(ctx.point).toEqual(POSITION);
        expect(ctx.targetKinds).toContain('canvasPoint');

        // The menu closes (rAF-deferred).
        return new Promise<void>((resolve) => {
            requestAnimationFrame(() => {
                expect(onClose).toHaveBeenCalled();
                resolve();
            });
        });
    });

    it('appends unknown groups (e.g. AI DSP) after the known categories', () => {
        registerAll([
            makeNodeAdd('node.add.looper', 'Add Looper', 'Routing'),
            makeNodeAdd('ai.dsp.reverb', 'Add Reverb', 'AI DSP'),
        ]);

        render(<ContextMenu position={POSITION} onClose={() => {}} />);

        const categories = screen
            .getAllByRole('group')
            .map((el) => el.getAttribute('aria-label'))
            .filter((label): label is string => label !== null);

        // 'AI DSP' (unknown) comes after 'Routing' (known).
        expect(categories.indexOf('AI DSP')).toBeGreaterThan(
            categories.indexOf('Routing'),
        );
    });

    it('opens the MIDI browser instead of running the action for the MIDI item', () => {
        const midiRun = vi.fn();
        const onOpenMIDIBrowser = vi.fn();
        const onClose = vi.fn();
        register(makeNodeAdd('node.add.midi', 'Add Midi', 'Input', midiRun));

        render(
            <ContextMenu
                position={POSITION}
                onClose={onClose}
                onOpenMIDIBrowser={onOpenMIDIBrowser}
            />,
        );

        fireEvent.click(screen.getByText('Add Midi'));

        // The browser opened; the add action did NOT run; the menu closed.
        expect(onOpenMIDIBrowser).toHaveBeenCalledOnce();
        expect(midiRun).not.toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
    });

    it('keeps keyboard a11y: Escape closes the menu', () => {
        const onClose = vi.fn();
        register(makeNodeAdd('node.add.looper', 'Add Looper', 'Routing'));

        render(<ContextMenu position={POSITION} onClose={onClose} />);
        fireEvent.keyDown(document, { key: 'Escape' });

        expect(onClose).toHaveBeenCalled();
    });

    it('exposes role=menu and role=menuitem for screen readers', () => {
        register(makeNodeAdd('node.add.looper', 'Add Looper', 'Routing'));

        render(<ContextMenu position={POSITION} onClose={() => {}} />);

        const menu = screen.getByRole('menu');
        expect(menu).toBeInTheDocument();
        // The item is a menuitem.
        const item = screen.getByText('Add Looper');
        expect(item).toHaveAttribute('role', 'menuitem');
        expect(within(menu).getByText('Cancel')).toBeInTheDocument();
    });
});
