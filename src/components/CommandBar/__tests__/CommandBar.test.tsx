/**
 * CommandBar (M2) render tests.
 *
 * With `shouldFilter={false}` the palette OWNS its filtering + ordering, so these
 * tests exercise that ownership through the real component:
 *   (a) Tab still hands the typed text off to AI mode (the U20 fast-path);
 *   (b) the AI item is PRESENT and AUTO-HIGHLIGHTED when there are ZERO local
 *       results (D2-A2);
 *   (c) a learned prefix-win / frecency entry orders that item first.
 *
 * The capability seam is mocked so `caps.agent` is deterministic (desktop →
 * agent available). `useCommandSources` is mocked out so only the actions this
 * test registers appear, and the AI backend is stubbed so AI mode renders.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { DESKTOP_CAPABILITIES } from '../../../engine/capabilities';

// --- Mocks -----------------------------------------------------------------

// Deterministic capability seam: desktop row (agent available).
vi.mock('../../../audio/executor', () => ({
    getExecutor: () => ({
        getCapabilities: () => DESKTOP_CAPABILITIES,
    }),
}));

// Don't pull in the real node-add/app command sources; the test registers its own.
vi.mock('../useCommandSources', () => ({
    useCommandSources: () => {},
}));

// Stub the AI backend so AI mode renders without a real agent.
vi.mock('../../../ai', () => ({
    getAgentBackend: () => ({ name: 'stub' }),
}));

// A Tauri `invoke` that reports a configured provider, so AiPanel's mount-time
// auth refresh keeps `configured: true` and the Tab fast-path reaches the agent
// input (the unconfigured → AuthChooser path is tested in AuthChooser.test).
vi.mock('../../../ai/tauri', () => ({
    isTauri: () => true,
    getInvoke: () => (cmd: string) =>
        cmd === 'auth_status'
            ? Promise.resolve({ configured: true, activeProvider: 'opencode', conflict: false })
            : Promise.resolve({}),
    listen: () => Promise.resolve(() => {}),
    openExternal: vi.fn(),
}));

// jsdom lacks scrollIntoView + ResizeObserver, both of which cmdk uses.
beforeEach(() => {
    Element.prototype.scrollIntoView = () => {};
    if (!('ResizeObserver' in globalThis)) {
        (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
            class {
                observe() {}
                unobserve() {}
                disconnect() {}
            };
    }
});

import { CommandBar } from '../CommandBar';
import {
    register,
    registerAll,
    _resetForTests,
    type Action,
} from '../../../store/commandRegistry';
import { usePaletteLearningStore } from '../../../store/paletteLearningStore';
import { useGraphStore } from '../../../store/graphStore';
import { useAuthStore } from '../../../auth/authStore';
import { useCommandBarStore } from '../../../store/commandBarStore';

function makeAction(id: string, title: string, run = vi.fn()): Action {
    return {
        id,
        title,
        group: 'Test',
        targets: ['global'],
        run,
    };
}

/** Open the palette via the global Ctrl+K toggle. */
function openPalette(): void {
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
}

describe('CommandBar (M2)', () => {
    beforeEach(() => {
        cleanup();
        _resetForTests();
        // Pristine learning floor.
        usePaletteLearningStore.setState({
            frecency: {},
            ctxFrecency: {},
            prefixWins: {},
            lastUsed: {},
            seedBoosts: {},
        });
        // No selection (palette ctx → canvas:empty).
        useGraphStore.setState({ selectedNodeIds: new Set() });
        // D6 (M7): a configured provider so the Tab fast-path reaches the agent
        // input (the unconfigured path routes to the AuthChooser, tested separately).
        useAuthStore.setState({ configured: true, conflict: false });
        // The bar mode is persisted; reset to search so a prior AI-mode test
        // doesn't leak into the next render.
        useCommandBarStore.setState({ mode: 'search' });
    });

    afterEach(() => {
        cleanup();
    });

    it('opens on Ctrl+K and renders registered actions', () => {
        register(makeAction('node.add.looper', 'Add Looper'));
        render(<CommandBar />);

        expect(screen.queryByPlaceholderText(/Search commands/i)).toBeNull();
        openPalette();
        expect(screen.getByPlaceholderText(/Search commands/i)).toBeInTheDocument();
        expect(screen.getByText('Add Looper')).toBeInTheDocument();
    });

    it('Tab from search enters AI mode (the U20 fast-path)', () => {
        register(makeAction('node.add.looper', 'Add Looper'));
        render(<CommandBar />);
        openPalette();

        const input = screen.getByPlaceholderText(/Search commands/i);
        fireEvent.change(input, { target: { value: 'reverb' } });
        fireEvent.keyDown(input, { key: 'Tab' });

        // AI mode shows the agent prompt input (desktop caps → agent available).
        expect(
            screen.getByPlaceholderText(/Describe what to build/i),
        ).toBeInTheDocument();
        // The search input is gone (we left search mode).
        expect(screen.queryByPlaceholderText(/Search commands/i)).toBeNull();
    });

    it('auto-highlights the AI item when there are ZERO local results (D2-A2)', () => {
        register(makeAction('node.add.looper', 'Add Looper'));
        render(<CommandBar />);
        openPalette();

        const input = screen.getByPlaceholderText(/Search commands/i);
        // A query that matches NO registered action.
        fireEvent.change(input, { target: { value: 'zzzznotacommand' } });

        // The dedicated AI item is present...
        const aiItem = screen.getByText(/Ask AI:/i).closest('[cmdk-item]');
        expect(aiItem).not.toBeNull();
        // ...and selected (cmdk marks the highlighted item with aria-selected).
        expect(aiItem).toHaveAttribute('aria-selected', 'true');
    });

    it('orders a learned prefix-win item first', () => {
        registerAll([
            makeAction('node.add.looper', 'Add Looper'),
            makeAction('node.add.lowpass', 'Add Lowpass'),
        ]);

        // Teach the floor: after typing "lo", the user usually picks Lowpass.
        usePaletteLearningStore.setState({
            prefixWins: { lo: 'node.add.lowpass' },
        });

        render(<CommandBar />);
        openPalette();

        const input = screen.getByPlaceholderText(/Search commands/i);
        fireEvent.change(input, { target: { value: 'lo' } });

        // Both match "lo"; the prefix-win (Lowpass) must be highlighted first.
        const lowpassItem = screen.getByText('Add Lowpass').closest('[cmdk-item]');
        expect(lowpassItem).toHaveAttribute('aria-selected', 'true');
    });

    it('matches a non-contiguous subsequence query (fzf, not substring)', () => {
        register(makeAction('node.add.looper', 'Add Looper'));
        render(<CommandBar />);
        openPalette();

        const input = screen.getByPlaceholderText(/Search commands/i);
        // 'adlp' is an in-order subsequence of "Add Looper" but NOT a substring.
        // The old substring prefilter in queryActions dropped it; the fzf scorer
        // must now surface it.
        fireEvent.change(input, { target: { value: 'adlp' } });

        expect(screen.getByText('Add Looper')).toBeInTheDocument();
    });

    it('records a pick before running the action and then closes', () => {
        const run = vi.fn();
        register(makeAction('node.add.looper', 'Add Looper', run));
        render(<CommandBar />);
        openPalette();

        fireEvent.click(screen.getByText('Add Looper'));

        // The action ran...
        expect(run).toHaveBeenCalledOnce();
        // ...the palette closed...
        expect(screen.queryByPlaceholderText(/Search commands/i)).toBeNull();
        // ...and the pick was recorded into the local frecency floor.
        expect(
            usePaletteLearningStore.getState().frecency['node.add.looper'],
        ).toBeDefined();
    });

    it('Escape closes the palette', () => {
        register(makeAction('a', 'Action A'));
        render(<CommandBar />);
        openPalette();

        const input = screen.getByPlaceholderText(/Search commands/i);
        fireEvent.keyDown(input, { key: 'Escape' });

        expect(screen.queryByPlaceholderText(/Search commands/i)).toBeNull();
    });

    it('keeps the AI item present (not auto-highlighted) when there ARE results', () => {
        register(makeAction('node.add.looper', 'Add Looper'));
        render(<CommandBar />);
        openPalette();

        const input = screen.getByPlaceholderText(/Search commands/i);
        fireEvent.change(input, { target: { value: 'looper' } });

        // The top local result is highlighted, not the AI item.
        const looper = screen.getByText('Add Looper').closest('[cmdk-item]');
        expect(looper).toHaveAttribute('aria-selected', 'true');

        // AI item still rendered as an option.
        const ai = screen.getByText(/Ask AI:/i).closest('[cmdk-item]');
        expect(ai).not.toBeNull();
        expect(within(ai as HTMLElement).getByText(/Ask AI:/i)).toBeInTheDocument();
    });
});
