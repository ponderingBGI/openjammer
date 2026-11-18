import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Chip, Modal, PanelHeader, SegmentedControl, Swatch, Tabs } from '@openjammer/oj-ui';
import { themes, applyTheme, getThemeById, getSavedThemeId, saveThemeId } from '@openjammer/oj-tokens';
import { KeybindingsPanelSafe } from './KeybindingsPanel';
import { AudioSettingsPanel } from './AudioSettingsPanel';
import { UpdatesPanel } from './UpdatesPanel';
import { AboutPanel } from './AboutPanel';
import './SettingsPanel.css';
import { useModalKeymap } from '../../keymap/useKeymap';
import { DEFAULT_ANSWERS, useOnboardingStore, type Persona } from '../../store/onboardingStore';

/**
 * How much the instrument shows by default. It is a preference, not a verdict —
 * every control stays reachable at every density; the persona only decides what
 * is in the way on the first look.
 */
const PERSONAS: { value: Persona; label: string }[] = [
    { value: 'first', label: 'First time' },
    { value: 'some', label: 'Dabbled' },
    { value: 'pro', label: 'Years of it' },
];

type TabId = 'appearance' | 'audio' | 'keybindings' | 'updates' | 'about';

const TABS: { value: TabId; label: string }[] = [
    { value: 'appearance', label: 'Appearance' },
    { value: 'audio', label: 'Audio' },
    { value: 'keybindings', label: 'Keybindings' },
    { value: 'updates', label: 'Updates' },
    { value: 'about', label: 'About' },
];

/** The one-line orientation under the dialog title, per tab. */
const TAB_SUBTITLE: Record<TabId, string> = {
    appearance: 'Theme and how much the instrument shows you by default.',
    audio: 'Devices, latency and the engine restart you choose the moment for.',
    keybindings: 'Every shortcut in OpenJammer, grouped by the surface it plays on.',
    updates: 'Release channel, automatic updates and manual installers.',
    about: 'Version, diagnostics and the source.',
};

/**
 * Settings — one overlay dialog, a vertical tab sidebar, and five calm forms
 * built from the shared `.oj-set-*` row vocabulary (see SettingsPanel.css).
 *
 * The overlay chrome is the oj-ui Modal: it owns the scrim, Escape, the Tab
 * focus trap, initial focus and focus restoration, so this component never
 * hand-rolls any of it. `useModalKeymap` still parks the app keymap while the
 * dialog is up, so a shortcut typed in here never reaches the canvas.
 */
export function SettingsPanel({ onClose }: { onClose: () => void }) {
    const [activeTab, setActiveTab] = useState<TabId>('appearance');
    const persona = useOnboardingStore((state) => state.answers?.exp ?? DEFAULT_ANSWERS.exp);
    const [selectedTheme, setSelectedTheme] = useState(getSavedThemeId());
    const themeGroupRef = useRef<HTMLDivElement>(null);
    useModalKeymap('settings', true);

    useEffect(() => {
        const syncTheme = () => setSelectedTheme(getSavedThemeId());
        window.addEventListener('openjammer:theme-change', syncTheme);
        window.addEventListener('storage', syncTheme);
        syncTheme();
        return () => {
            window.removeEventListener('openjammer:theme-change', syncTheme);
            window.removeEventListener('storage', syncTheme);
        };
    }, []);

    const handleThemeChange = (themeId: string) => {
        setSelectedTheme(themeId);
        const theme = getThemeById(themeId);
        if (theme) {
            applyTheme(theme);
            saveThemeId(themeId);
        }
    };

    const version = useMemo(
        () => (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0-dev'),
        [],
    );

    return (
        <Modal open onClose={onClose} ariaLabel="Settings" align="center" size="auto">
            <div className="oj-settings">
                <PanelHeader
                    title="Settings"
                    subtitle={TAB_SUBTITLE[activeTab]}
                    badge={<Chip title="Application version">v{version}</Chip>}
                    onClose={onClose}
                />

                <div className="oj-settings__body">
                    <div className="oj-settings__sidebar oj-scroll">
                        <Tabs
                            aria-label="Settings sections"
                            value={activeTab}
                            onChange={setActiveTab}
                            options={TABS}
                        />
                    </div>

                    <div className="oj-settings__pane oj-scroll">
                        {activeTab === 'appearance' && (
                            <div className="oj-set">
                                <section className="oj-set-section">
                                    <h3 className="oj-set-section__title">Theme</h3>
                                    <div
                                        className="oj-set-themes"
                                        role="radiogroup"
                                        aria-label="Interface theme"
                                        ref={themeGroupRef}
                                    >
                                        {themes.map((theme, index) => (
                                            <Swatch
                                                key={theme.id}
                                                role="radio"
                                                aria-checked={selectedTheme === theme.id}
                                                aria-pressed={undefined}
                                                tabIndex={selectedTheme === theme.id ? 0 : -1}
                                                bg={theme.colors.bgPrimary}
                                                node={theme.colors.bgNode}
                                                name={theme.name}
                                                selected={selectedTheme === theme.id}
                                                onSelect={() => handleThemeChange(theme.id)}
                                                onKeyDown={(event) => {
                                                    if (event.key === ' ') {
                                                        event.preventDefault();
                                                        handleThemeChange(theme.id);
                                                        return;
                                                    }
                                                    const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
                                                    if (!delta) return;
                                                    event.preventDefault();
                                                    const next = themes[(index + delta + themes.length) % themes.length]!;
                                                    handleThemeChange(next.id);
                                                    requestAnimationFrame(() => themeGroupRef.current?.querySelector<HTMLButtonElement>(`[role="radio"][aria-checked="true"]`)?.focus());
                                                }}
                                            />
                                        ))}
                                    </div>
                                </section>

                                <section className="oj-set-section">
                                    <h3 className="oj-set-section__title">Density</h3>
                                    <div className="oj-set-row">
                                        <div className="oj-set-row__text">
                                            <span className="oj-set-row__label">How much to show</span>
                                            <span className="oj-set-row__desc">
                                                Nothing is ever taken away &mdash; this only decides what is in
                                                the way when you open a fresh canvas.
                                            </span>
                                        </div>
                                        <div className="oj-set-row__control">
                                            <SegmentedControl
                                                aria-label="Interface density"
                                                value={persona}
                                                options={PERSONAS}
                                                onChange={(value) => useOnboardingStore.getState().setPersona(value)}
                                            />
                                        </div>
                                    </div>
                                </section>

                                <section className="oj-set-section">
                                    <h3 className="oj-set-section__title">First run</h3>
                                    <div className="oj-set-row">
                                        <div className="oj-set-row__text">
                                            <span className="oj-set-row__label">Redo setup</span>
                                            <span className="oj-set-row__desc">
                                                Run the three setup questions again. Your current patch is left
                                                exactly as it is; the new rig lands beside it and Ctrl+Z removes it.
                                            </span>
                                        </div>
                                        <div className="oj-set-row__control">
                                            <Button
                                                onClick={() => {
                                                    useOnboardingStore.getState().reset();
                                                    onClose();
                                                }}
                                            >
                                                Redo setup
                                            </Button>
                                        </div>
                                    </div>
                                </section>
                            </div>
                        )}
                        {activeTab === 'audio' && <AudioSettingsPanel />}
                        {activeTab === 'keybindings' && <KeybindingsPanelSafe />}
                        {activeTab === 'updates' && <UpdatesPanel />}
                        {activeTab === 'about' && <AboutPanel />}
                    </div>
                </div>
            </div>
        </Modal>
    );
}
