/**
 * Palette ranking helpers (W4-P5).
 *
 * The Ctrl+K palette owns its own ordering (see CommandBar.tsx). This module
 * holds the pure scoring pieces so they can be unit-tested — and read — without
 * a React render.
 */

/**
 * UI-028 — deterministic exact targeting. An EXACT title match (with or without
 * the "Add " verb the node rows carry) outranks every learned signal; a word
 * that STARTS with the query gets a smaller, still decisive nudge. Without this
 * a fuzzy subsequence over a long keyword blob can out-score the very row the
 * player just typed the name of, which is how the audit found several searches
 * falling through to the AI pseudo-item instead of the command they asked for.
 *
 * The two tiers are deliberately far apart, and both sit above the palette's
 * learned prefix-win boost (100_000): what you typed beats what you usually type.
 */
export function exactnessBoost(query: string, title: string): number {
    const q = query.trim().toLowerCase();
    if (!q) return 0;
    const full = title.toLowerCase();
    const bare = full.replace(/^add\s+/, '');
    if (full === q || bare === q) return 1_000_000;
    if (full.startsWith(q) || bare.split(/\s+/).some((word) => word.startsWith(q))) {
        return 10_000;
    }
    return 0;
}
