import { useEffect, useMemo } from 'react';
import { resolveKeydown } from './arbiter';
import { registerBindingSet } from './registry';
import type { BindingEntry, BindingSet } from './types';

export function useKeymapArbiter(): void {
    useEffect(() => {
        window.addEventListener('keydown', resolveKeydown);
        return () => window.removeEventListener('keydown', resolveKeydown);
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
