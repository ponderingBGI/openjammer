import type { GlobalProvider } from '@ladle/react'
import { useEffect } from 'react'
// Token primitives (:root vars) + the runtime theme engine — the same source
// the app uses, so the catalog renders components exactly as they ship.
import '../packages/oj-tokens/dist/variables.css'
import { applyTheme, getThemeById, themes } from '@openjammer/oj-tokens'

// A global control to switch the active theme live in the catalog — the Phase 3
// "every component reviewable across all themes" requirement.
export const argTypes = {
    ojTheme: {
        control: { type: 'select' },
        options: themes.map((t) => t.id),
        defaultValue: 'cream',
    },
}

export const Provider: GlobalProvider = ({ children, globalState }) => {
    const raw = globalState.control?.ojTheme?.value
    const themeId = typeof raw === 'string' ? raw : 'cream'

    useEffect(() => {
        const theme = getThemeById(themeId) ?? themes[0]
        if (theme) applyTheme(theme)
    }, [themeId])

    return (
        <div
            style={{
                minHeight: '100vh',
                padding: 'var(--space-lg)',
                background: 'var(--bg-canvas)',
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-sketch)',
            }}
        >
            {children}
        </div>
    )
}
