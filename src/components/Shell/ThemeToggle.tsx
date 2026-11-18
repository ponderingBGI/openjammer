/**
 * ThemeToggle — one button, two themes.
 *
 * The instrument ships light and dark and nothing else, so a picker would be
 * three clicks for a binary. The glyph shows the theme you would GET, which is
 * the thing a hand reaches for on a dim stage; the accessible name says it in
 * words. The choice is written back into the onboarding answers, so "your rig is
 * ready either way" stays true after a reload.
 */

import { useEffect, useState } from 'react';
import { IconButton } from '@openjammer/oj-ui';
import { applyTheme, getSavedThemeId, getThemeById, saveThemeId } from '@openjammer/oj-tokens';
import { useOnboardingStore } from '../../store/onboardingStore';

const SunGlyph = () => (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
        <circle cx="8" cy="8" r="3.1" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path
            d="M8 .9v1.8M8 13.3v1.8M15.1 8h-1.8M2.7 8H.9M13 3l-1.3 1.3M4.3 11.7 3 13M13 13l-1.3-1.3M4.3 4.3 3 3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
        />
    </svg>
);

const MoonGlyph = () => (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
        <path
            d="M13.4 10.2A5.8 5.8 0 0 1 5.8 2.6a5.8 5.8 0 1 0 7.6 7.6Z"
            fill="currentColor"
        />
    </svg>
);

export function ThemeToggle() {
    const [themeId, setThemeId] = useState(() => getSavedThemeId());

    // Follow the theme wherever it changes — the AI agent can set it too.
    useEffect(() => {
        const sync = () => setThemeId(getSavedThemeId());
        window.addEventListener('openjammer:theme-change', sync);
        window.addEventListener('storage', sync);
        return () => {
            window.removeEventListener('openjammer:theme-change', sync);
            window.removeEventListener('storage', sync);
        };
    }, []);

    const isDark = themeId === 'dark';
    const next = isDark ? 'light' : 'dark';

    return (
        <IconButton
            label={`Switch to the ${next} theme`}
            title={`Switch to the ${next} theme`}
            icon={isDark ? <SunGlyph /> : <MoonGlyph />}
            onClick={() => {
                const theme = getThemeById(next);
                if (!theme) return;
                applyTheme(theme);
                saveThemeId(next);
                setThemeId(next);
                useOnboardingStore.getState().setTheme(next);
            }}
        />
    );
}
