import { useEffect, useMemo } from 'react';
import { resetTabTraversal, resolveKeydown } from './arbiter';
import { registerBindingSet } from './registry';
import type { BindingEntry, BindingSet } from './types';

export function useKeymapArbiter(): void {
    useEffect(() => {
        window.addEventListener('keydown', resolveKeydown);
        // A pointer ends whatever keyboard traversal was running, so the next
        // bare `Tab` on the stage floor is a parked gesture again and toggles
        // the surface (U9). Capture, so a handler that stops propagation on the
        // way up cannot leave the arbiter believing a Tab-walk is still live.
        window.addEventListener('pointerdown', resetTabTraversal, true);
        return () => {
            window.removeEventListener('keydown', resolveKeydown);
            window.removeEventListener('pointerdown', resetTabTraversal, true);
        };
    }, []);
}

export function useBindingSet(set: BindingSet | null): void {
    useEffect(() => {
        if (!set) return;
        return registerBindingSet(set);
    }, [set]);
}

export function useModalKeymap(id: string, open: boolean, entries: BindingEntry[] = []): void {
    useBindingSet(useMemoBindingSet(id, open, entries));
}

function useMemoBindingSet(id: string, open: boolean, entries: BindingEntry[]): BindingSet | null {
    // Callers memoize non-empty entry arrays; empty modal blockers remain stable.
    const key = entries.length === 0 ? EMPTY_ENTRIES : entries;
    return useMemo(() => open ? { id, scope: 'modal', entries: key } : null, [id, open, key]);
}

const EMPTY_ENTRIES: BindingEntry[] = [];
