/**
 * Phase 6 — the live sandbox-mode store. Pins the safety contract: default jailed,
 * explicit YOLO entry, browser can never enter YOLO, exit always returns to safe.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DESKTOP_CAPABILITIES, BROWSER_CAPABILITIES } from '../../engine/capabilities';

// Swap the active capability row per test (host-jailed desktop vs none browser).
let caps = DESKTOP_CAPABILITIES;
vi.mock('../../audio/executor', () => ({
    getExecutor: () => ({ getCapabilities: () => caps }),
}));

import { useSandboxStore } from '../sandboxStore';

describe('sandboxStore (Phase 6 live mode)', () => {
    beforeEach(() => {
        caps = DESKTOP_CAPABILITIES;
        useSandboxStore.setState({ mode: 'jailed', projectLabel: '' });
    });

    it('defaults to jailed', () => {
        expect(useSandboxStore.getState().mode).toBe('jailed');
    });

    it('requestYolo does NOT change the mode (entry must be explicit)', () => {
        const warrants = useSandboxStore.getState().requestYolo();
        expect(warrants).toBe(true);
        expect(useSandboxStore.getState().mode).toBe('jailed');
    });

    it('confirmYolo enters YOLO; exitYolo returns to safe', () => {
        useSandboxStore.getState().confirmYolo();
        expect(useSandboxStore.getState().mode).toBe('yolo');
        useSandboxStore.getState().exitYolo();
        expect(useSandboxStore.getState().mode).toBe('jailed');
    });

    it('requestYolo returns false when already in YOLO', () => {
        useSandboxStore.getState().confirmYolo();
        expect(useSandboxStore.getState().requestYolo()).toBe(false);
    });

    it('a browser (no host-jail) can never enter YOLO', () => {
        caps = BROWSER_CAPABILITIES;
        expect(useSandboxStore.getState().canYolo()).toBe(false);
        expect(useSandboxStore.getState().requestYolo()).toBe(false);
        useSandboxStore.getState().confirmYolo(); // defence in depth
        expect(useSandboxStore.getState().mode).toBe('jailed');
    });
});
