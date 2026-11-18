/**
 * HelpPanel — the shortcuts, and the honest answer to "which keyboard am I on?".
 *
 * Its DEFAULT follows the persona the first run collected: a player who has
 * never done this gets it open, a player with years of it gets it out of the
 * way. An explicit choice always beats the default and is remembered — the
 * persona sets where you START, never where you must stay.
 */

import { useCallback, useEffect, useState } from 'react';
import { IconButton, Kbd } from '@openjammer/oj-ui';
import { useAudioStore } from '../../store/audioStore';
import { useOnboardingStore } from '../../store/onboardingStore';
import './HelpPanel.css';

const HELP_DISMISSED_KEY = 'openjammer:help-dismissed';

/** `true` = the player opened it, `false` = closed it, `null` = never said. */
function readChoice(): boolean | null {
    try {
        const stored = localStorage.getItem(HELP_DISMISSED_KEY);
        if (stored === null) return null;
        return stored !== 'true';
    } catch {
        return null;
    }
}

const SHORTCUTS: { keys: string[]; label: string }[] = [
    { keys: ['Q–P', 'A–L', 'Z–/'], label: 'Play the keyboard' },
    { keys: ['1'], label: 'Config mode' },
    { keys: ['2–9'], label: 'Keyboard modes' },
    { keys: ['Right click'], label: 'Add nodes' },
    { keys: ['Drag'], label: 'Box select' },
    { keys: ['Alt', 'Drag'], label: 'Pan the canvas' },
    { keys: ['Scroll'], label: 'Zoom' },
    { keys: ['Tab'], label: 'Canvas / arrangement' },
    { keys: ['W'], label: 'Ghost mode' },
    { keys: ['Del'], label: 'Remove selected' },
    { keys: ['Ctrl+Z'], label: 'Undo' },
    { keys: ['Ctrl+K'], label: 'Ask the AI' },
];

/** A beginner needs the first five; everything else is depth, not a wall. */
const BEGINNER_COUNT = 5;

export function HelpPanel() {
    const [choice, setChoice] = useState<boolean | null>(readChoice);
    const persona = useOnboardingStore((state) => state.answers?.exp);
    const currentMode = useAudioStore((s) => s.currentMode);
    const isModeUnassigned = useAudioStore((s) => s.isModeUnassigned);

    /*
     * The persona decides the DEFAULT; an explicit choice always wins.
     *
     * Only the beginner gets it open. It is a 268px card in the corner of the
     * stage, and anyone who has done this before would rather see their patch —
     * the `?` button is right there, and `?` opens it.
     */
    const isVisible = choice ?? persona === 'first';

    const write = useCallback((next: boolean) => {
        setChoice(next);
        try {
            if (next) localStorage.removeItem(HELP_DISMISSED_KEY);
            else localStorage.setItem(HELP_DISMISSED_KEY, 'true');
        } catch {
            // Private mode: the panel still works, it just forgets.
        }
    }, []);

    const handleToggle = useCallback(() => write(!isVisible), [isVisible, write]);

    useEffect(() => {
        const handler = () => handleToggle();
        window.addEventListener('openjammer:toggle-help', handler);
        return () => window.removeEventListener('openjammer:toggle-help', handler);
    }, [handleToggle]);

    if (!isVisible) {
        return (
            <button
                type="button"
                className={`oj-help__minimised${isModeUnassigned ? ' is-warning' : ''}`}
                onClick={handleToggle}
                aria-label="Show keyboard help"
                title="Keyboard help (?)"
            >
                {isModeUnassigned ? '!' : '?'}
            </button>
        );
    }

    const shortcuts = persona === 'first' ? SHORTCUTS.slice(0, BEGINNER_COUNT) : SHORTCUTS;

    return (
        <aside className={`oj-help${isModeUnassigned ? ' is-warning' : ''}`} aria-label="Keyboard help">
            <header className="oj-help__head">
                <h3 className="oj-help__title">Keys</h3>
                <span className="oj-help__mode">
                    <Kbd>{currentMode}</Kbd>
                    {currentMode === 1 ? 'Config' : `Keyboard ${currentMode}`}
                </span>
                <IconButton label="Hide keyboard help" icon="✕" onClick={() => write(false)} />
            </header>

            {isModeUnassigned && (
                <p className="oj-help__warning">
                    No keyboard is assigned to {currentMode}. Add a Keyboard node, or press 1 to get back to config mode.
                </p>
            )}

            <ul className="oj-help__list">
                {shortcuts.map((row) => (
                    <li key={row.label}>
                        <span className="oj-help__keys">
                            {row.keys.map((key) => (
                                <Kbd key={key}>{key}</Kbd>
                            ))}
                        </span>
                        <span className="oj-help__label">{row.label}</span>
                    </li>
                ))}
            </ul>
        </aside>
    );
}
