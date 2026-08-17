import { useState } from 'react';
import { Button, Tabs } from '@openjammer/oj-ui';
import { themes, applyTheme, getThemeById, getSavedThemeId, saveThemeId } from '@openjammer/oj-tokens';
import { KeybindingsPanel } from './KeybindingsPanel';
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
    useModalKeymap('settings', true);

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
                                <div className="minimal-theme-grid">
                                    {themes.map(theme => (
                                        <div
                                            key={theme.id}
                                            className={`minimal-theme-card ${selectedTheme === theme.id ? 'active' : ''}`}
                                            onClick={() => handleThemeChange(theme.id)}
                                        >
                                            <div
                                                style={{
                                                    height: '60px',
                                                    background: theme.colors.bgPrimary,
                                                    borderRadius: '4px',
                                                    marginBottom: '8px',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center'
                                                }}
                                            >
                                                <div style={{ width: '30px', height: '20px', background: theme.colors.bgNode, borderRadius: '2px' }} />
                                            </div>
                                            <div style={{ fontSize: '0.9rem', fontWeight: 500 }}>{theme.name}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                        {activeTab === 'keybindings' && (
                            <KeybindingsPanel />
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
