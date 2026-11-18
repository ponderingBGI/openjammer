/** Types for the static web-surface sheet renderer (see `staticSheet.mjs`). */
export declare function renderStaticTokenSheet(
    surface: string,
    primitives: string,
    light: Record<string, string>,
    dark: Record<string, string>,
): string;

export declare const STATIC_TOKEN_SHEETS: readonly { path: string; surface: string }[];
