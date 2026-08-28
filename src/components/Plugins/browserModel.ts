import type { HostedPluginDescriptor } from '../../engine/dynamicRegistry';
import type { PluginFamily } from '../../engine/pluginFamily';

export type BrowserContext = 'browse' | 'pick' | 'insert';
export type BrowserSource = 'all' | 'built-in' | 'installed';
export interface BrowserItem {
    id: string; name: string; vendor: string; family?: PluginFamily; format?: string; path?: string;
    source: 'built-in' | 'installed'; reliability?: string; descriptor?: HostedPluginDescriptor;
    declarationOrder: number; benched?: boolean;
}
export function browserActionWord(context: BrowserContext): 'Add' | 'Use' | 'Insert' { return context === 'pick' ? 'Use' : context === 'insert' ? 'Insert' : 'Add'; }
export function defaultBrowserFamilies(context: BrowserContext): PluginFamily[] { return context === 'pick' ? ['Keys', 'Synth', 'Drums', 'Sampler'] : []; }
function relevance(item: BrowserItem, query: string): number { const q = query.toLowerCase(); const name = item.name.toLowerCase(); if (!q) return 0; if (name === q) return 100; if (name.startsWith(q)) return 80; if (name.includes(q)) return 60; if (item.vendor.toLowerCase().includes(q)) return 40; if (item.family?.toLowerCase().includes(q)) return 30; if (item.format?.toLowerCase().includes(q)) return 20; return item.path?.toLowerCase().includes(q) ? 1 : -1; }
export function filterBrowserItems(items: readonly BrowserItem[], query: string, source: BrowserSource, families: readonly PluginFamily[]): BrowserItem[] { return items.filter((item) => source === 'all' || item.source === source).filter((item) => families.length === 0 || (item.family !== undefined && families.includes(item.family))).map((item) => ({ item, score: relevance(item, query.trim()) })).filter(({ score }) => score >= 0).sort((a, b) => { if (query.trim() && a.score !== b.score) return b.score - a.score; if (a.item.benched !== b.item.benched) return a.item.benched ? 1 : -1; if (a.item.source !== b.item.source) return a.item.source === 'built-in' ? -1 : 1; if (a.item.source === 'built-in') return a.item.declarationOrder - b.item.declarationOrder; return a.item.vendor.localeCompare(b.item.vendor) || a.item.declarationOrder - b.item.declarationOrder; }).map(({ item }) => item); }
