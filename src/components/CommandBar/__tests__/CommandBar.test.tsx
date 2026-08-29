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

import { readFileSync } from 'node:fs';
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
import { useKeymapArbiter } from '../../../keymap/useKeymap';

function ArbiterHarness() {
    useKeymapArbiter();
    return null;
}

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
        render(<><ArbiterHarness /><CommandBarHost /></>);

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

    it('teaches the Tab handoff (never a pseudo-row) when there are ZERO results (UI-028)', () => {
        register(makeAction('node.add.looper', 'Add Looper'));
        render(<CommandBar intent={openIntent()} />);

        const input = screen.getByPlaceholderText(/Search commands/i);
        // A query that matches NO registered action.
        fireEvent.change(input, { target: { value: 'zzzznotacommand' } });

        // The empty state teaches the handoff...
        expect(screen.getByText(/No command for that/i)).toBeInTheDocument();
        expect(
            within(screen.getByRole('status')).getByText(/ask the agent/i),
        ).toBeInTheDocument();
        // ...and there is NO "Ask AI" result row that could rank into or steal
        // the selection (the audited UI-028 defect).
        expect(document.querySelector('[cmdk-item]')).toBeNull();
    });

    it('Enter on an empty result set hands the query to the agent', async () => {
        const send = vi.fn();
        useAgentSessionStore.setState({ send });
        register(makeAction('node.add.looper', 'Add Looper'));
        render(<CommandBar intent={openIntent()} />);

        const input = screen.getByPlaceholderText(/Search commands/i);
        fireEvent.change(input, { target: { value: 'zzzznotacommand' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(
            await screen.findByPlaceholderText(/Ask anything/i, undefined, { timeout: 5000 }),
        ).toBeInTheDocument();
        await waitFor(() => expect(send).toHaveBeenCalledOnce());
    });

    it('ranks an EXACT title match first, above a learned prefix win (UI-028)', () => {
        registerAll([
            makeAction('node.add.speaker', 'Add Speaker'),
            makeAction('node.add.sampler', 'Add Sampler'),
        ]);
        // The floor has been taught to prefer Sampler after "spe".
        usePaletteLearningStore.setState({ prefixWins: { spe: 'node.add.sampler' } });

        render(<CommandBar intent={openIntent()} />);
        const input = screen.getByPlaceholderText(/Search commands/i);
        fireEvent.change(input, { target: { value: 'speaker' } });

        // What you typed beats what you usually type.
        expect(screen.getByText('Add Speaker').closest('[cmdk-item]')).toHaveAttribute(
            'aria-selected',
            'true',
        );
    });

    it('never makes a DISABLED row the default selection (UI-028)', () => {
        registerAll([
            {
                id: 'app.zeta',
                title: 'Zeta thing',
                group: 'Test',
                targets: ['global'],
                disabledReason: 'Not on this platform',
                run: vi.fn(),
            },
            makeAction('app.zetb', 'Zetb thing'),
        ]);
        render(<CommandBar intent={openIntent()} />);

        const input = screen.getByPlaceholderText(/Search commands/i);
        fireEvent.change(input, { target: { value: 'zet' } });

        expect(screen.getByText('Zeta thing').closest('[cmdk-item]')).not.toHaveAttribute(
            'aria-selected',
            'true',
        );
        expect(screen.getByText('Zetb thing').closest('[cmdk-item]')).toHaveAttribute(
            'aria-selected',
            'true',
        );
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

    it('highlights the top local result and keeps the agent in the footer', () => {
        register(makeAction('node.add.looper', 'Add Looper'));
        render(<CommandBar intent={openIntent()} />);

        const input = screen.getByPlaceholderText(/Search commands/i);
        fireEvent.change(input, { target: { value: 'looper' } });

        // The top local result is highlighted...
        const looper = screen.getByText('Add Looper').closest('[cmdk-item]');
        expect(looper).toHaveAttribute('aria-selected', 'true');

        // ...and the agent handoff is a footer affordance carrying the Tab
        // keycap, not a result row.
        const ask = screen.getByRole('button', { name: /Ask the agent/i });
        expect(ask).toBeInTheDocument();
        expect(within(ask).getByText('Tab')).toBeInTheDocument();
        expect(ask.closest('[cmdk-item]')).toBeNull();
    });

    it('restores focus to the element that had it when the palette opened', () => {
        register(makeAction('node.add.looper', 'Add Looper'));
        const trigger = document.createElement('button');
        document.body.appendChild(trigger);
        trigger.focus();

        render(<CommandBar intent={openIntent()} />);
        const input = screen.getByPlaceholderText(/Search commands/i);
        fireEvent.keyDown(input, { key: 'Escape' });

        expect(document.activeElement).toBe(trigger);
        trigger.remove();
    });

    it('contains Tab focus inside the palette in both directions', () => {
        register(makeAction('node.add.looper', 'Add Looper'));
        const behindScrim = document.createElement('button');
        behindScrim.textContent = 'Behind scrim';
        document.body.appendChild(behindScrim);

        render(<CommandBar intent={openIntent()} />);
        const input = screen.getByPlaceholderText(/Search commands/i);
        const last = screen.getByRole('button', { name: /Ask the agent/i });

        // `fireEvent` returns false when the handler called preventDefault —
        // that IS the containment: without it the browser walks focus out to
        // the topbar behind the scrim.
        last.focus();
        expect(fireEvent.keyDown(last, { key: 'Tab' })).toBe(false);
        expect(document.activeElement).toBe(input);
        expect(document.activeElement).not.toBe(behindScrim);

        input.focus();
        expect(fireEvent.keyDown(input, { key: 'Tab', shiftKey: true })).toBe(false);
        expect(document.activeElement).toBe(last);
        expect(document.activeElement).not.toBe(behindScrim);

        behindScrim.remove();
    });

    it('pulls Tab back in when focus has already fallen outside the palette', () => {
        // The audited case: a mode swap unmounts the focused control, focus
        // lands on <body>, and the NEXT Tab walks into the chrome behind the
        // scrim. Out there the wrap check (`active === first/last`) can't fire,
        // so the trap has to claim the key on containment alone.
        register(makeAction('node.add.looper', 'Add Looper'));
        const behindScrim = document.createElement('button');
        behindScrim.textContent = 'Behind scrim';
        document.body.appendChild(behindScrim);

        render(<CommandBar intent={openIntent()} />);
        const input = screen.getByPlaceholderText(/Search commands/i);
        const overlay = document.querySelector('.command-bar-overlay')!;

        (document.activeElement as HTMLElement | null)?.blur();
        expect(document.activeElement).toBe(document.body);

        expect(fireEvent.keyDown(overlay, { key: 'Tab' })).toBe(false);
        expect(document.activeElement).toBe(input);
        expect(document.activeElement).not.toBe(behindScrim);

        behindScrim.remove();
    });

    it('raises the selected row over the measured inset fill without a side stripe', () => {
        const css = readFileSync('src/components/CommandBar/CommandBar.css', 'utf8');
        const selected = css.slice(
            css.indexOf(".command-bar-item[data-selected='true'] {"),
            css.indexOf(".command-bar-item[data-disabled='true']"),
        );

        // 7% is the ONLY integer step where the fill clears 1.3:1 against a rest
        // row AND `--accent-ink` still clears AA 4.5 on top of it, in BOTH themes
        // (light 4-7, dark 7-11 — measured in .scratch/w4-p5b/probe2.mjs). Pin the
        // number: a "harmless" nudge either way breaks one of the two.
        expect(selected).toContain(
            'color-mix(in oklab, var(--text-primary) 7%, var(--bg-tertiary))',
        );
        // …and it must be a real step off the hover fill, not the same colour.
        expect(selected).not.toMatch(/background:\s*var\(--bg-tertiary\)/);
        expect(selected).toContain('box-shadow: var(--shadow-raised)');
        expect(selected).toContain('color: var(--accent-ink)');
        expect(selected).not.toMatch(/border-(left|right)/);

        // The one row that paints --text-muted on the fill refuses the fill.
        expect(css).toMatch(
            /\.command-bar-item\[data-disabled='true'\]\[data-selected='true'\][^{]*\{[^}]*background:\s*transparent/s,
        );
    });

    it('keeps the focused search border accented but gates its ring on keyboard focus', () => {
        const css = readFileSync('src/components/CommandBar/CommandBar.css', 'utf8');

        // Focus alone = the accent border (the field DOES read as focused on
        // open); the 3px ring is held back behind the keyboard-focus marker.
        expect(css).toMatch(
            /\.command-bar-input:focus\s*\{[^}]*border-color:\s*var\(--accent-primary\)[^}]*box-shadow:\s*none/s,
        );
        expect(css).toMatch(
            /\.command-bar-input:focus-visible\[data-keyboard-focus='true'\]\s*\{[^}]*box-shadow:\s*var\(--focus-ring\)/s,
        );
    });

    it('lights the search ring on a focus-moving Tab, never on typing', () => {
        register(makeAction('node.add.looper', 'Add Looper'));
        render(<CommandBar intent={openIntent()} />);
        const input = screen.getByPlaceholderText(/Search commands/i) as HTMLInputElement;

        // Programmatic autofocus on open: border only.
        expect(document.activeElement).toBe(input);
        expect(input.dataset.keyboardFocus).toBe('false');

        // Typing is keyboard activity but NOT a focus move — the ring stays off,
        // or it would be lit permanently from the first character (the very
        // "always-on state indicator" this replaces).
        fireEvent.keyDown(input, { key: 'l' });
        fireEvent.keyDown(input, { key: 'o' });
        fireEvent.keyDown(input, { key: 'ArrowDown' });
        fireEvent.keyDown(input, { key: 'ArrowUp' });
        expect(input.dataset.keyboardFocus).toBe('false');

        // Shift+Tab is a real focus move inside the palette → the ring returns.
        fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
        expect(input.dataset.keyboardFocus).toBe('true');
    });

    it('holds the palette entrance and the streaming dots still under reduced motion', () => {
        const css = readFileSync('src/components/CommandBar/CommandBar.css', 'utf8');
        const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
        expect(reduced).toContain('.command-bar-container');
        expect(reduced).toContain('.command-bar-dots i');
        expect(reduced).toContain('animation: none');
    });

    it('shows a mono type chip on node-add rows', () => {
        register(makeAction('node.add.looper', 'Add Looper'));
        render(<CommandBar intent={openIntent()} />);

        const row = screen.getByText('Add Looper').closest('[cmdk-item]');
        expect(within(row as HTMLElement).getByText('looper')).toHaveClass('oj-chip__label');
    });
});
