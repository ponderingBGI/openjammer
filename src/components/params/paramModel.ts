export const MAX_PINNED_PARAMS = 8;
export function togglePinnedParam(current: readonly number[], id: number): number[] { return current.includes(id) ? current.filter((value) => value !== id) : [...current, id].slice(-MAX_PINNED_PARAMS); }
export function seededParamIds(pinned: readonly number[], touched: readonly number[]): number[] { return pinned.length > 0 ? [...pinned] : [...new Set(touched)].slice(-4); }
export function formatParamValue(value: number, pluginText?: string | null): string { return pluginText == null || pluginText === '' ? value.toFixed(2) : pluginText; }
