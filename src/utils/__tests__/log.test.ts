/**
 * Global error-handler tests (L4 logging). The `unhandledrejection` handler is
 * allowlisted to the app's OWN origin via the stack heuristic: it must KEEP a
 * rejection whose frames are same-origin OR relative/ambiguous (conservative —
 * when in doubt, log), and DROP only a rejection whose every URL-like frame is a
 * parseable, absolute, FOREIGN origin (third-party / extension noise).
 *
 * We exercise the private heuristic through the public handler (the seam the
 * design intends): install once, dispatch crafted rejections, and assert what
 * lands in the DevLog ring.
 */

import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { installGlobalErrorHandlers } from '../log';
import { useLogStore } from '../../store/logStore';

/** jsdom serves the app at this origin; foreign frames must differ from it. */
const OWN = window.location.origin;

beforeAll(() => {
    // Idempotent — installs the real `unhandledrejection` listener exactly once.
    installGlobalErrorHandlers();
});

beforeEach(() => {
    useLogStore.getState().clear();
});

/** Dispatch a synthetic unhandled rejection carrying a crafted Error stack. */
function reject(stack: string): void {
    const reason = new Error('boom');
    reason.stack = stack;
    window.dispatchEvent(
        new PromiseRejectionEvent('unhandledrejection', { promise: Promise.reject(reason).catch(() => {}) as never, reason }),
    );
}

/** Did a `window`-scoped rejection entry land in the DevLog ring? */
function logged(): boolean {
    return useLogStore.getState().entries.some((e) => e.scope === 'window' && e.message.startsWith('unhandled rejection'));
}

describe('unhandledrejection origin allowlist', () => {
    it('KEEPS a rejection whose frames are same-origin', () => {
        reject(`Error: boom\n    at fn (${OWN}/assets/index.js:1:2)`);
        expect(logged()).toBe(true);
    });

    it('KEEPS a rejection whose frames are RELATIVE (dev/minified — no origin substring)', () => {
        reject('Error: boom\n    at fn (/assets/index.js:1:2)\n    at g (/assets/x.js:3:4)');
        expect(logged()).toBe(true);
    });

    it('KEEPS a rejection with no URL-like frame at all (ambiguous ⇒ log it)', () => {
        reject('Error: boom\n    at Object.<anonymous>\n    at process');
        expect(logged()).toBe(true);
    });

    it('KEEPS a mixed stack with at least one same-origin frame', () => {
        reject(`Error: boom\n    at z (https://cdn.example.com/lib.js:9:9)\n    at fn (${OWN}/app.js:1:1)`);
        expect(logged()).toBe(true);
    });

    it('DROPS a rejection whose every frame is a parseable, absolute, FOREIGN origin', () => {
        reject('Error: boom\n    at q (chrome-extension://abcd/inject.js:5:6)\n    at z (https://cdn.example.com/lib.js:9:9)');
        expect(logged()).toBe(false);
    });

    it('KEEPS a non-Error rejection (no stack to judge ⇒ logged with its detail)', () => {
        window.dispatchEvent(
            new PromiseRejectionEvent('unhandledrejection', { promise: Promise.reject('plain').catch(() => {}) as never, reason: 'plain' }),
        );
        expect(useLogStore.getState().entries.some((e) => e.scope === 'window')).toBe(true);
    });
});
