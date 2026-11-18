/**
 * SurfaceSwitcher — Canvas / Arrangement, and the key that does the same thing.
 *
 * It lives in the TOPBAR, not in the transport pill. The pill carries only what
 * is true on every surface and is about time; *where you are editing* is a
 * document-scope choice, the same class of thing as the File menu. Putting it on
 * the rule also means it never occludes the stage and never competes with the
 * transport for the eye.
 *
 * `Tab` still does it, and the keycap says so — the switch teaches its own
 * shortcut rather than hiding it in a help panel.
 */

import { Kbd, SegmentedControl } from '@openjammer/oj-ui';
import { useUiViewStore } from '../../store/uiViewStore';
import { keyComboToString, useKeybindingsStore } from '../../store/keybindingsStore';
import './SurfaceSwitcher.css';

type SwitchValue = 'canvas' | 'arrangement';

const OPTIONS: { value: SwitchValue; label: string }[] = [
    { value: 'canvas', label: 'Canvas' },
    { value: 'arrangement', label: 'Arrangement' },
];

export function SurfaceSwitcher() {
    const surface = useUiViewStore((state) => state.surface);
    // Reading the LIVE binding: a rebound Tab must not be advertised as Tab.
    const customBindings = useKeybindingsStore((state) => state.customBindings);
    void customBindings;
    const binding = useKeybindingsStore.getState().getBinding('view.toggleArrangement');
    const shortcut = binding ? keyComboToString(binding) : undefined;

    // The piano roll is a room inside the arrangement, not a third place.
    const value: SwitchValue = surface === 'canvas' ? 'canvas' : 'arrangement';

    return (
        <div className="oj-surface-switcher">
            <SegmentedControl
                aria-label="Editing surface"
                value={value}
                options={OPTIONS}
                onChange={(next) => {
                    const view = useUiViewStore.getState();
                    if (next === 'canvas' && view.surface === 'pianoroll') view.closePianoRoll();
                    view.setSurface(next);
                    requestAnimationFrame(() => {
                        document
                            .querySelector<HTMLElement>(`[data-surface-root="${next}"]`)
                            ?.focus({ preventScroll: true });
                    });
                }}
            />
            {shortcut && <Kbd className="oj-surface-switcher__hint">{shortcut}</Kbd>}
        </div>
    );
}
