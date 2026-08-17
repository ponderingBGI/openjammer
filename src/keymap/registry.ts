import type { BindingSet } from './types';

const sets: BindingSet[] = [];

export function registerBindingSet(set: BindingSet): () => void {
    sets.push(set);
    return () => {
        const index = sets.indexOf(set);
        if (index >= 0) sets.splice(index, 1);
    };
}

export function getBindingSets(): readonly BindingSet[] {
    return sets;
}

export function clearBindingSetsForTests(): void {
    sets.splice(0);
}
