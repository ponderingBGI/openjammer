/**
 * The three first-run claims that were not true, and now are.
 *
 * HA-04 — the beginner hint asserted "This rig is already making sound" with no
 * rig-existence check, so on an empty canvas the app's loudest audio claim was
 * about a rig that was not there.
 * HA-06 — two contradicting latency answers sat eight pixels apart in the same
 * status cluster: a tier sentence saying "an honest 15–25 ms" beside a chip
 * reading 116–132 ms in warning ink.
 * HA-27 — "everything still works", the sentence that matters most to a
 * performer on a stage with no Wi-Fi, lived only in a `title`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../audio/executor', () => ({ getExecutor: () => ({ capturePluginStates: vi.fn() }), isTauri: () => false }));

const { HintBubble } = await import('../HintBubble');
const { Topbar } = await import('../Topbar');
const { latencyTierLabel } = await import('../../../store/engineHealthStore');
const { useGraphStore } = await import('../../../store/graphStore');
const { useOnboardingStore } = await import('../../../store/onboardingStore');

afterEach(cleanup);

describe('HA-04 — the hint claims nothing about a rig that is not there', () => {
    beforeEach(() => {
        useGraphStore.getState().clearGraph();
        useOnboardingStore.setState({ answers: { exp: 'first' } as never, hintDismissed: false });
    });

    it('says nothing on an empty canvas', () => {
        const { container } = render(<HintBubble />);
        expect(container.querySelector('.oj-hint-bubble')).toBeNull();
    });

    it('speaks — and about the keys, not about a claim — once a rig exists', () => {
        act(() => { useGraphStore.getState().addNode('speaker', { x: 0, y: 0 }); });
        render(<HintBubble />);

        const hint = screen.getByRole('status');
        expect(hint.textContent).toMatch(/press a key/i);
        expect(hint.textContent).not.toMatch(/already making sound/i);
    });
});

describe('HA-06 — one latency claim', () => {
    it('reads the MEASUREMENT when there is one', () => {
        expect(latencyTierLabel(false, 118)).toMatch(/118 ms round trip/);
        expect(latencyTierLabel(true, 3)).toMatch(/3 ms round trip/);
    });

    it('falls back to the tier — never to a promise — when nothing is measured', () => {
        expect(latencyTierLabel(false, 0)).toMatch(/15.?25/);
        expect(latencyTierLabel(false, null)).toMatch(/15.?25/);
    });

    it('never claims sub-5 ms in the browser, measured or not', () => {
        expect(latencyTierLabel(false, 2)).not.toMatch(/sub-?5|under 5/i);
        expect(latencyTierLabel(false)).not.toMatch(/sub-?5|under 5/i);
    });
});

describe('HA-27 — the offline chip says what it means, once', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
    });
    afterEach(() => {
        vi.useRealTimers();
        Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
    });

    it('carries the reassurance the first time it appears, then shrinks', () => {
        render(<Topbar onOpenSettings={vi.fn()} />);
        expect(screen.getByText('Offline — everything still works')).toBeInTheDocument();

        act(() => { vi.advanceTimersByTime(11_000); });

        expect(screen.queryByText('Offline — everything still works')).toBeNull();
        expect(screen.getByText('Offline')).toBeInTheDocument();
    });
});
