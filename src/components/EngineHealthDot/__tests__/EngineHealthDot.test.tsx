/**
 * EngineHealthDot (Phase 2) — the calm tri-state mapping + the ambient render.
 *
 * Two layers:
 *   • The PURE {@link presentHealth} mapping — the single source of truth the
 *     dot AND the toast policy read. IDLE must NEVER be an alarm; DEGRADED →
 *     ochre/warn; DEAD → clay/bad and the only alarm.
 *   • The component wiring — it always shows a label next to the dot (never a
 *     naked colour), carries the honest latency tier in its tooltip, and opens
 *     the existing Audio-health readout on click (no second dashboard).
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { EngineHealthDot } from '../EngineHealthDot';
import {
    presentHealth,
    latencyTierLabel,
    useEngineHealthStore,
} from '../../../store/engineHealthStore';

afterEach(() => {
    cleanup();
    useEngineHealthStore.setState({ health: 'IDLE', reason: '' });
});

describe('presentHealth (pure mapping)', () => {
    it('IDLE is the muted, non-alarm state', () => {
        const p = presentHealth('IDLE');
        expect(p.status).toBe('idle');
        expect(p.isAlarm).toBe(false);
    });

    it('DEGRADED maps to the ochre warn token and stays non-alarm', () => {
        const p = presentHealth('DEGRADED');
        expect(p.status).toBe('warn');
        expect(p.isAlarm).toBe(false);
        expect(p.label).toMatch(/degrad/i);
    });

    it('DEAD maps to the clay bad token and is the only alarm', () => {
        const p = presentHealth('DEAD');
        expect(p.status).toBe('bad');
        expect(p.isAlarm).toBe(true);
        expect(p.label).toMatch(/stopp/i);
    });

    it('folds the reason into the blurb when present', () => {
        const p = presentHealth('DEAD', 'IPC bridge absent');
        expect(p.blurb).toContain('IPC bridge absent');
    });

    it('is honest about latency tiers (device-dependent native, never sub-5 ms browser)', () => {
        // Native is device-dependent: it CAN be sub-5 ms when the device grants a
        // small buffer (measured ~1.3 ms, Fixed(64) @ 48 kHz on a Windows test
        // machine) and ~10 ms+ when it forces a larger period — so the honest
        // label names BOTH ends of the range, not a single fixed figure.
        expect(latencyTierLabel(true)).toMatch(/sub-?5 ms/i);
        expect(latencyTierLabel(true)).toMatch(/10 ms/i);
        expect(latencyTierLabel(true)).toMatch(/device-dependent/i);
        // The browser tier is never dressed up as sub-5 ms — it is an honest tier.
        expect(latencyTierLabel(false)).not.toMatch(/sub-?5|under 5/i);
        expect(latencyTierLabel(false)).toMatch(/15.?25/);
    });
});

describe('EngineHealthDot (component)', () => {
    beforeEach(() => {
        useEngineHealthStore.setState({ health: 'IDLE', reason: '' });
    });

    it('renders a label next to the dot (a colour never travels naked)', () => {
        render(<EngineHealthDot />);
        expect(screen.getByText('Sound ready')).toBeTruthy();
    });

    it('reflects the live store state', () => {
        render(<EngineHealthDot />);
        act(() => {
            useEngineHealthStore.setState({ health: 'DEAD', reason: 'stream down' });
        });
        expect(screen.getByText('Sound stopped')).toBeTruthy();
    });

    it('carries the honest latency tier in its tooltip and never says sub-5 ms', () => {
        render(<EngineHealthDot />);
        const btn = screen.getByRole('button');
        const tip = btn.getAttribute('title') ?? '';
        expect(tip).toMatch(/15.?25 ms|10 ms/);
        expect(tip).not.toMatch(/sub-?5|under 5/i);
    });

    it('opens the existing Audio-health readout on click (no second dashboard)', () => {
        render(<EngineHealthDot />);
        let opened = false;
        const onOpen = () => {
            opened = true;
        };
        window.addEventListener('openjammer:toggle-audio-health', onOpen);
        try {
            fireEvent.click(screen.getByRole('button'));
        } finally {
            window.removeEventListener('openjammer:toggle-audio-health', onOpen);
        }
        expect(opened).toBe(true);
    });
});
