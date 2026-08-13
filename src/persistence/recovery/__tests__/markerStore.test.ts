/**
 * Redundant breaker-store tests (Track B P0). The doubly-written marker must
 * survive a torn write of EITHER copy: `read` returns the first PARSEABLE copy,
 * never the merely-present one, so a half-written primary cannot disarm the
 * crash-loop guard with garbage. Uses jsdom localStorage.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { WebMarkerStore, MemoryMarkerStore } from '../markerStore';
import { serializeMarker, freshMarker } from '../breaker';

const PRIMARY_KEY = 'openjammer-recovery-marker';
const SHADOW_KEY = 'openjammer-recovery-marker.bak';

const goodMarker = () => serializeMarker({ ...freshMarker('inst-1'), open: true, bootSeq: 3 });

beforeEach(() => {
    localStorage.clear();
});

describe('WebMarkerStore.read (parseable-first redundancy)', () => {
    it('returns the primary when it is parseable', () => {
        const store = new WebMarkerStore();
        store.write(goodMarker());
        expect(store.read()).toBe(goodMarker());
    });

    it('falls through to the shadow when the PRIMARY is torn/invalid JSON', () => {
        const good = goodMarker();
        localStorage.setItem(PRIMARY_KEY, '{"v":1,"open":tr'); // torn mid-write
        localStorage.setItem(SHADOW_KEY, good);
        // The torn primary must NOT shadow the readable backup.
        expect(new WebMarkerStore().read()).toBe(good);
    });

    it('still returns the primary when IT parses even if the shadow is torn', () => {
        const good = goodMarker();
        localStorage.setItem(PRIMARY_KEY, good);
        localStorage.setItem(SHADOW_KEY, 'not json {');
        expect(new WebMarkerStore().read()).toBe(good);
    });

    it('hands back the present (garbage) value when NEITHER parses (caller fails toward Safe Mode)', () => {
        localStorage.setItem(PRIMARY_KEY, 'garbage-1 {');
        localStorage.setItem(SHADOW_KEY, 'garbage-2 {');
        expect(new WebMarkerStore().read()).toBe('garbage-1 {');
    });

    it('returns the shadow when the primary is absent entirely', () => {
        const good = goodMarker();
        localStorage.setItem(SHADOW_KEY, good);
        expect(new WebMarkerStore().read()).toBe(good);
    });

    it('returns null when both copies are absent', () => {
        expect(new WebMarkerStore().read()).toBeNull();
    });

    it('round-trips a clean write through both copies', () => {
        const store = new WebMarkerStore();
        store.write(goodMarker());
        expect(localStorage.getItem(PRIMARY_KEY)).toBe(goodMarker());
        expect(localStorage.getItem(SHADOW_KEY)).toBe(goodMarker());
        store.clear();
        expect(store.read()).toBeNull();
    });
});

describe('MemoryMarkerStore (test double)', () => {
    it('reads back what was written, and clears', () => {
        const store = new MemoryMarkerStore(goodMarker());
        expect(store.read()).toBe(goodMarker());
        store.clear();
        expect(store.read()).toBeNull();
    });
});
