import { useEffect, useState } from 'react';
import { Callout, IconButton, IconClose, IconChevronDown, Menu, MenuItem, StatusDot, Toggle } from '@openjammer/oj-ui';
import { getInvoke } from '../../ai/tauri';
import './PluginWindowShell.css';

interface ShellInfo { label: string; plugin_name: string; owner: string; has_gui: boolean; bypassed: boolean; dirty: boolean }

/** A bypass glyph — the signal routed around the box. */
function BypassGlyph() {
    return (
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
            <path d="M1.5 8h4" />
            <path d="M10.5 8h4" />
            <circle cx="8" cy="8" r="2.5" />
        </svg>
    );
}

/**
 * The chrome around a hosted plugin's own window: who it is, whose node it is
 * on, bypass, an unsaved-state dot, a menu and close. Everything but the plugin
 * GUI itself is an oj-ui part reading semantic tokens, so a plugin window looks
 * like it belongs to OpenJammer even though its middle is somebody else's.
 */
export function PluginWindowShell({ label }: { label: string }) {
    const [info, setInfo] = useState<ShellInfo | null>(null);
    const [menu, setMenu] = useState(false);
    const [alwaysOnTop, setAlwaysOnTop] = useState(false);
    useEffect(() => { void getInvoke()?.('plugin_window_shell_info', { label }).then((value) => setInfo(value as ShellInfo)); }, [label]);
    useEffect(() => {
        const focusHost = (event: KeyboardEvent) => { if (event.key === 'F6') void getInvoke()?.('plugin_window_focus_host'); };
        window.addEventListener('keydown', focusHost);
        return () => window.removeEventListener('keydown', focusHost);
    }, []);
    if (!info) return null;
    const call = (command: string, args: Record<string, unknown> = {}) => void getInvoke()?.(command, { label, ...args });
    return <main className="plugin-window-shell">
        <header className="plugin-window-strip">
            <div className="plugin-window-identity">
                <strong>{info.plugin_name}</strong>
                <span>on {info.owner}</span>
            </div>
            <nav className="plugin-window-controls" aria-label="Plugin window controls">
                {info.dirty && (
                    <span className="plugin-window-dirty" title="Unsaved plugin state — Ctrl+S">
                        <StatusDot status="warn" />
                        <span className="plugin-window-dirty-label">Unsaved</span>
                    </span>
                )}
                <IconButton
                    label={`Bypass ${info.plugin_name}`}
                    aria-pressed={info.bypassed}
                    active={info.bypassed}
                    icon={<BypassGlyph />}
                />
                <IconButton
                    label="Plugin window menu"
                    aria-expanded={menu}
                    icon={<IconChevronDown size={14} />}
                    onClick={() => setMenu((value) => !value)}
                />
                <IconButton
                    label="Close plugin window"
                    icon={<IconClose size={14} />}
                    onClick={() => call('plugin_window_shell_close')}
                />
            </nav>
            {menu && (
                <Menu ariaLabel="Plugin window menu" className="plugin-window-menu" onEscape={() => setMenu(false)}>
                    {['Save preset…', 'Load preset…', 'Reset to default', 'Reveal plugin file'].map((item) => (
                        <MenuItem key={item} label={item} />
                    ))}
                    <div className="plugin-window-menu-toggle">
                        <Toggle
                            label="Always on top"
                            checked={alwaysOnTop}
                            onChange={(checked) => { setAlwaysOnTop(checked); call('plugin_window_always_on_top', { alwaysOnTop: checked }); }}
                        />
                    </div>
                </Menu>
            )}
        </header>
        <section className="plugin-window-content">
            {info.has_gui
                ? <div id="plugin-native-gui-slot" />
                : <Callout variant="info" title="This plugin has no embeddable GUI" className="plugin-window-nogui">
                    Every parameter remains available on its node.
                </Callout>}
        </section>
    </main>;
}
