import { useEffect, useRef, useState } from 'react';
import { Button, Swatch, Tabs } from '@openjammer/oj-ui';
import { themes, applyTheme, getThemeById, getSavedThemeId, saveThemeId } from '@openjammer/oj-tokens';
import { KeybindingsPanelSafe } from './KeybindingsPanel';
import { AudioSettingsPanel } from './AudioSettingsPanel';
import { UpdatesPanel } from './UpdatesPanel';
import { AboutPanel } from './AboutPanel';
import { ScrollContainer } from '../common/ScrollContainer';
import './SettingsPanel.css';
import { useModalKeymap } from '../../keymap/useKeymap';

const TABS = [
    { value: 'graphics', label: 'Graphics' },
    { value: 'keybindings', label: 'Keybindings' },
    { value: 'audio', label: 'Audio' },
    { value: 'updates', label: 'Updates' },
    { value: 'about', label: 'About' },
];

export function SettingsPanel({ onClose }: { onClose: () => void }) {
    const [activeTab, setActiveTab] = useState('graphics');
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

    return (
        <div className="minimal-settings-overlay" onClick={onClose}>
            <div
                className="minimal-settings-container"
                role="dialog"
                aria-modal="true"
                aria-label="Settings"
                onClick={e => e.stopPropagation()}
                onKeyDown={(event) => {
                    if (event.key === 'Escape') onClose();
                }}
            >
                <div className="minimal-settings-header">
                    <h2>Settings</h2>
                    <Button variant="ghost" iconOnly onClick={onClose} aria-label="Close settings">
                        ✕
                    </Button>
                </div>

                <div className="minimal-settings-content">
                    {/* Sidebar — the canonical vertical SegmentedControl (Tabs). */}
                    <div className="minimal-sidebar">
                        <Tabs
                            aria-label="Settings sections"
                            value={activeTab}
                            onChange={setActiveTab}
                            options={TABS}
                        />
                    </div>

                    {/* Main Content */}
                    <ScrollContainer mode="dropdown" className="minimal-main">
                        {activeTab === 'graphics' && (
                            <div className="settings-section">
                                <h3 style={{ marginTop: 0, marginBottom: '24px' }}>Interface Theme</h3>
                                <div className="minimal-theme-grid" role="radiogroup" aria-label="Interface theme" ref={themeGroupRef}>
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
                            </div>
                        )}
                        {activeTab === 'keybindings' && (
                            <KeybindingsPanelSafe />
                        )}
                        {activeTab === 'audio' && (
                            <AudioSettingsPanel />
                        )}
                        {activeTab === 'updates' && (
                            <UpdatesPanel />
                        )}
                        {activeTab === 'about' && (
                            <AboutPanel />
                        )}
                    </ScrollContainer>
                </div>
            </div>
        </div>
    );
}
