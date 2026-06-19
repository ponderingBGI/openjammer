/**
 * @openjammer/oj-tokens — the design-token single source of truth.
 *
 * Tokens are authored as DTCG JSON under `tokens/` and compiled by Style
 * Dictionary (`bun run tokens`) into:
 *   - `dist/variables.css`        — the theme-invariant primitives (:root)
 *   - `src/generated/themes.ts`   — the per-theme color sets (the registry below)
 *
 * The runtime theming engine here is hand-written and stable: it applies a
 * theme by setting the semantic CSS custom properties, and persists the choice.
 * This preserves the exact API the app already depends on (`themes`,
 * `applyTheme`, `getThemeById`, `getSavedThemeId`, `saveThemeId`) — only the
 * import path moves from `src/styles/themes` to `@openjammer/oj-tokens`.
 */

import type { Theme } from './types';
import { generatedThemes } from './generated/themes';

export type { Theme, ThemeColors } from './types';

/** All built-in themes, generated from `tokens/themes/*.json`. */
export const themes: Theme[] = generatedThemes;

const STORAGE_KEY = 'openjammer-theme';
const DEFAULT_THEME_ID = 'cream';

/** `bgPrimary` -> `bg-primary`. The color keys map 1:1 to `--kebab` CSS vars. */
function camelToKebab(key: string): string {
    return key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

/**
 * Apply a theme by writing its semantic color tokens onto `:root` as CSS custom
 * properties. Generic over `colors`, so adding a token in DTCG needs no change
 * here. Never touches the audio path — pure DOM style writes.
 */
export function applyTheme(theme: Theme): void {
    const root = document.documentElement;
    for (const [key, value] of Object.entries(theme.colors)) {
        root.style.setProperty(`--${camelToKebab(key)}`, value);
    }
}

export function getThemeById(id: string): Theme | undefined {
    return themes.find((t) => t.id === id);
}

export function getSavedThemeId(): string {
    try {
        const savedId = localStorage.getItem(STORAGE_KEY);
        if (savedId && themes.some((t) => t.id === savedId)) {
            return savedId;
        }
        return DEFAULT_THEME_ID;
    } catch (error) {
        console.error('Failed to read theme from localStorage:', error);
        return DEFAULT_THEME_ID;
    }
}

export function saveThemeId(id: string): void {
    try {
        if (!themes.some((t) => t.id === id)) {
            console.warn(`Invalid theme ID: ${id}, not saving`);
            return;
        }
        localStorage.setItem(STORAGE_KEY, id);
    } catch (error) {
        console.error('Failed to save theme to localStorage:', error);
    }
}
