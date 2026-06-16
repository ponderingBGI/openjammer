/**
 * paletteScore (M2) — an fzf-style subsequence scorer for command-palette ranking.
 *
 * Replaces the registry's plain substring match for INTERACTIVE palette ranking
 * (the registry's {@link searchCommands} stays for back-compat / non-UI callers).
 * Given a query and a candidate text, returns a number: `0` means "no match"
 * (the query is not a subsequence of the text); a higher number means a better
 * match. The CommandBar combines this with learned frecency to order results.
 *
 * Scoring model (case-insensitive):
 * - The query must appear as an in-order SUBSEQUENCE of the text, else `0`.
 * - Each matched character earns a base point.
 * - A match at a WORD BOUNDARY (text start, or right after a separator such as
 *   space / `-` / `_` / `.` / `/`, or a lower→Upper camelCase hump) earns a bonus.
 * - CONSECUTIVE matches earn a growing run bonus (contiguous beats scattered).
 * - A PREFIX match (the query matches from the very first character) earns an
 *   extra block bonus, so "lo" ranks "Looper" above "Add Classic Looper".
 * - A leftover gap penalty keeps tight matches ahead of loose ones, but never
 *   pushes a real match to or below `0`.
 *
 * The exact constants are not load-bearing beyond the documented ORDERING
 * guarantees the unit tests assert (prefix > word-boundary > mid-word > 0).
 */

// Tunable weights. Kept conservative so a single strong signal (prefix /
// boundary) dominates incidental mid-word matches without overflowing.
const BASE = 1; // every matched char
const BOUNDARY_BONUS = 10; // match at a word boundary
const CONSECUTIVE_BONUS = 5; // each additional char in a contiguous run
const PREFIX_BONUS = 15; // query matches from text[0]
const GAP_PENALTY = 1; // per skipped (unmatched) text char between matches

/** Separator characters that begin a new "word" for the boundary bonus. */
const SEPARATORS = new Set([' ', '-', '_', '.', '/', ':', '\t']);

/**
 * Is `text[i]` the start of a word? True at index 0, right after a separator, or
 * at a lower→Upper camelCase hump. `lower` is the lower-cased text (passed in so
 * we lower-case once per call, not per character).
 */
function isWordBoundary(text: string, lower: string, i: number): boolean {
    if (i === 0) return true;
    const prev = text[i - 1];
    if (SEPARATORS.has(prev)) return true;
    // camelCase hump: a lower-case (or non-cased) char immediately followed by an
    // upper-case char — e.g. the "N" in "lowNode" begins a new word for fuzzy.
    const prevIsLower = prev === lower[i - 1] && prev.toUpperCase() !== prev;
    const curIsUpper = text[i] !== lower[i] && text[i].toLowerCase() !== text[i];
    return prevIsLower && curIsUpper;
}

/**
 * Score `query` against `text`. Returns `0` for no subsequence match; otherwise
 * a positive number where higher is better. Case-insensitive.
 *
 * A blank query scores `0` (the caller decides empty-query ordering — typically
 * via learned frecency — rather than this scorer ranking everything equally).
 */
export function score(query: string, text: string): number {
    const q = query.trim().toLowerCase();
    if (q === '') return 0;
    if (text === '') return 0;

    const lower = text.toLowerCase();

    let qi = 0; // index into query
    let total = 0;
    let prevMatchIdx = -1; // last matched index in text
    let runLength = 0; // current consecutive-run length

    for (let i = 0; i < lower.length && qi < q.length; i++) {
        if (lower[i] !== q[qi]) continue;

        // A character matched.
        total += BASE;

        if (isWordBoundary(text, lower, i)) total += BOUNDARY_BONUS;

        if (prevMatchIdx === i - 1) {
            runLength += 1;
            total += CONSECUTIVE_BONUS * runLength;
        } else {
            runLength = 0;
            if (prevMatchIdx >= 0) {
                // Penalise the gap we skipped to reach this match.
                total -= GAP_PENALTY * (i - prevMatchIdx - 1);
            }
        }

        prevMatchIdx = i;
        qi += 1;
    }

    // Not all query chars consumed → not a subsequence → no match.
    if (qi < q.length) return 0;

    // Prefix bonus when the match began at the very first character.
    if (lower.startsWith(q)) total += PREFIX_BONUS;

    // A real match never scores <= 0 (gap penalties can't sink it below a floor).
    return Math.max(total, BASE);
}
