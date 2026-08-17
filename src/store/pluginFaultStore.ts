import { useSyncExternalStore } from 'react';

export type PluginFaultKind = 'AutoBypassed' | 'Crashed' | 'NonFinite';
export interface PluginFaultCard { id: string; nodeId: string; pluginName: string; kind: PluginFaultKind; count: number; corr?: number }

const cards = new Map<string, PluginFaultCard>();
const crashCounts = new Map<string, number>();
const nonFiniteWindows = new Map<string, number[]>();
const listeners = new Set<() => void>();
let snapshot: PluginFaultCard[] = [];
const emit = () => { snapshot = [...cards.values()]; listeners.forEach((listener) => listener()); };

export function reducePluginFault(card: PluginFaultCard, now = Date.now()): PluginFaultCard | null {
    if (card.kind === 'Crashed') {
        const count = (crashCounts.get(card.nodeId) ?? 0) + 1;
        crashCounts.set(card.nodeId, count);
        return { ...card, count };
    }
    if (card.kind === 'NonFinite') {
        const recent = [...(nonFiniteWindows.get(card.nodeId) ?? []), now].filter((time) => now - time <= 10_000);
        nonFiniteWindows.set(card.nodeId, recent);
        return recent.length >= 8 ? { ...card, count: recent.length } : null;
    }
    return { ...card, count: Math.max(1, card.count) };
}

export function reportPluginFault(input: Omit<PluginFaultCard, 'id' | 'count'>): void {
    const reduced = reducePluginFault({ ...input, id: `${input.nodeId}:${input.kind}`, count: 1 });
    if (!reduced) return;
    cards.set(reduced.id, reduced); emit();
}
export function dismissPluginFault(id: string): void { if (cards.delete(id)) emit(); }
export function clearPluginFaultsForTests(): void { cards.clear(); crashCounts.clear(); nonFiniteWindows.clear(); emit(); }
export function usePluginFaultCards(): PluginFaultCard[] {
    return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => snapshot, () => snapshot);
}
