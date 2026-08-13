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
import { act, render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react';
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

vi.mock('../../../ai/bridgeListener', () => ({
    startBridgeListener: vi.fn(() => Promise.resolve(undefined)),
}));

// Stub the AI backend so AI mode renders without a real agent.
vi.mock('../../../ai', () => ({
    getAgentBackend: () => ({
        id: 'stub',
        async *run() {
            yield { kind: 'result', summary: 'done' };
        },
    }),
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

import { CommandBar, type CommandBarOpenIntent } from '../CommandBar';
import { CommandBarHost } from '../CommandBarHost';
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
import { useAgentSessionStore } from '../../../store/agentSessionStore';

function makeAction(id: string, title: string, run = vi.fn()): Action {
    return {
        id,
        title,
        group: 'Test',
        targets: ['global'],
        run,
    };
}

let testIntentSeq = 0;

function openIntent(kind: CommandBarOpenIntent['kind'] = 'toggle', prompt = ''): CommandBarOpenIntent {
    testIntentSeq += 1;
    return { kind, prompt, seq: testIntentSeq } as CommandBarOpenIntent;
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
        useAgentSessionStore.setState({
            phase: 'idle',
            messages: [],
            error: null,
            sessionId: null,
            runBaseline: null,
            send: vi.fn(),
            newSession: vi.fn(),
        });
        // The bar mode is persisted; reset to search so a prior AI-mode test
        // doesn't leak into the next render.
        useCommandBarStore.setState({ mode: 'search' });
    });

    afterEach(() => {
        cleanup();
    });

    it('host lazy-loads on Ctrl+K and renders registered actions', async () => {
        register(makeAction('node.add.looper', 'Add Looper'));
        render(<CommandBarHost />);

        expect(screen.queryByPlaceholderText(/Search commands/i)).toBeNull();
        fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
        expect(
            await screen.findByPlaceholderText(/Search commands/i, undefined, { timeout: 5000 }),
        ).toBeInTheDocument();
        expect(await screen.findByText('Add Looper')).toBeInTheDocument();
    });

    it('Tab from search sends the typed prompt to AI (the one-key fast-path)', async () => {
        const send = vi.fn();
        useAgentSessionStore.setState({ send });
        register(makeAction('node.add.looper', 'Add Looper'));
        render(<CommandBar intent={openIntent()} />);

        const input = screen.getByPlaceholderText(/Search commands/i);
        fireEvent.change(input, { target: { value: 'reverb' } });
        fireEvent.keyDown(input, { key: 'Tab' });

        // AI mode shows the agent prompt input (desktop caps → agent available).
        // AiPanel is now code-split (lazy + Suspense), so it mounts asynchronously and
        // its dynamic import resolves the real (heavy) module graph in jsdom (~1s).
        // Await its appearance with a generous timeout so the full suite's parallel
        // load can't tip it over the default 1s wait. (Production hides this cost
        // behind the PWA precache; this latitude is purely a test-environment one.)
        expect(
            await screen.findByPlaceholderText(/Ask anything/i, undefined, { timeout: 5000 }),
        ).toBeInTheDocument();
        // The search input is gone (we left search mode).
        expect(screen.queryByPlaceholderText(/Search commands/i)).toBeNull();
        await waitFor(() => expect(send).toHaveBeenCalledOnce());
        expect(send.mock.calls[0][1]).toMatchObject({ prompt: 'reverb' });
    });

    it('host lazy-loads ask-ai events into AI mode with the supplied prompt', async () => {
        const send = vi.fn();
        useAgentSessionStore.setState({ send });
        render(<CommandBarHost />);

        act(() => {
            window.dispatchEvent(
                new CustomEvent('openjammer:ask-ai', { detail: { prompt: 'fix the dropout' } }),
            );
        });

        expect(
            await screen.findByPlaceholderText(/Ask anything/i, undefined, { timeout: 5000 }),
        ).toBeInTheDocument();
        await waitFor(() => expect(send).toHaveBeenCalledOnce());
        expect(send.mock.calls[0][1]).toMatchObject({ prompt: 'fix the dropout' });
    });

    it('auto-highlights the AI item when there are ZERO local results (D2-A2)', () => {
        register(makeAction('node.add.looper', 'Add Looper'));
        render(<CommandBar intent={openIntent()} />);

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

        render(<CommandBar intent={openIntent()} />);

        const input = screen.getByPlaceholderText(/Search commands/i);
        fireEvent.change(input, { target: { value: 'lo' } });

        // Both match "lo"; the prefix-win (Lowpass) must be highlighted first.
        const lowpassItem = screen.getByText('Add Lowpass').closest('[cmdk-item]');
        expect(lowpassItem).toHaveAttribute('aria-selected', 'true');
    });

    it('matches a non-contiguous subsequence query (fzf, not substring)', () => {
        register(makeAction('node.add.looper', 'Add Looper'));
        render(<CommandBar intent={openIntent()} />);

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
        render(<CommandBar intent={openIntent()} />);

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
        render(<CommandBar intent={openIntent()} />);

        const input = screen.getByPlaceholderText(/Search commands/i);
        fireEvent.keyDown(input, { key: 'Escape' });

        expect(screen.queryByPlaceholderText(/Search commands/i)).toBeNull();
    });

    it('keeps the AI item present (not auto-highlighted) when there ARE results', () => {
        register(makeAction('node.add.looper', 'Add Looper'));
        render(<CommandBar intent={openIntent()} />);

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
