/**
 * M0 — capability seam gate.
 *
 * Pins the ONE platform-capability descriptor every agent / code-node / auth /
 * learning consumer reads: the native (Tauri) executor must report the full
 * desktop row and the wasm (browser) executor the honest degraded subset. If
 * either drifts, a platform silently gains/loses a feature — exactly what this
 * seam exists to prevent.
 */

import { describe, it, expect } from 'vitest';
import {
    BROWSER_CAPABILITIES,
    DESKTOP_CAPABILITIES,
    agentTransportLabel,
    canHostJail,
} from '../capabilities';
import { OjcoreNativeExecutor } from '../../audio/executor/OjcoreNativeExecutor';
import { OjcoreWasmExecutor } from '../../audio/executor/OjcoreWasmExecutor';

describe('EngineCapabilities (M0 spine seam)', () => {
    it('desktop row is the full flagship set', () => {
        expect(DESKTOP_CAPABILITIES).toEqual({
            agent: 'pi-subprocess',
            codeNodes: 'author-and-run',
            auth: 'keychain-loopback',
            learning: 'pi-memory',
            sandbox: 'host-jailed',
        });
    });

    it('browser row is the honest degraded subset', () => {
        expect(BROWSER_CAPABILITIES).toEqual({
            agent: 'none',
            codeNodes: 'run-only',
            auth: 'none',
            learning: 'local-only',
            sandbox: 'none',
        });
    });

    it('the native executor reports the full desktop row', () => {
        expect(new OjcoreNativeExecutor().getCapabilities()).toEqual(DESKTOP_CAPABILITIES);
    });

    it('the wasm executor reports the degraded browser row', () => {
        expect(new OjcoreWasmExecutor().getCapabilities()).toEqual(BROWSER_CAPABILITIES);
    });

    it('agent gating: desktop offers the agent, browser does not', () => {
        expect(DESKTOP_CAPABILITIES.agent !== 'none').toBe(true);
        expect(BROWSER_CAPABILITIES.agent !== 'none').toBe(false);
    });

    it('agentTransportLabel covers every agent variant', () => {
        expect(agentTransportLabel('pi-subprocess')).toMatch(/local/i);
        expect(agentTransportLabel('remote-proxy')).toMatch(/remote/i);
        expect(agentTransportLabel('none')).toMatch(/unavailable/i);
    });

    it('sandbox gating: only a host-jailed platform can offer YOLO', () => {
        // The YOLO toggle precondition: a platform that cannot OS-confine the
        // agent in the first place has no guards to drop.
        expect(canHostJail(DESKTOP_CAPABILITIES.sandbox)).toBe(true);
        expect(canHostJail(BROWSER_CAPABILITIES.sandbox)).toBe(false);
    });
});
