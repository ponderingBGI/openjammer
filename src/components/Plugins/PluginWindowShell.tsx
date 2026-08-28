import { useEffect, useState } from 'react';
import { Button } from '@openjammer/oj-ui';
import { getInvoke } from '../../ai/tauri';
import './PluginWindowShell.css';

interface ShellInfo { label: string; plugin_name: string; owner: string; has_gui: boolean; bypassed: boolean; dirty: boolean }

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
            <div><strong>{info.plugin_name}</strong><span>on {info.owner}</span></div>
            <nav aria-label="Plugin window controls">
                <button type="button" aria-label={`Bypass ${info.plugin_name}`} aria-pressed={info.bypassed}>⊸</button>
                <i className={info.dirty ? 'is-dirty' : ''} title="unsaved plugin state — Ctrl+S" />
                <button type="button" aria-label="Plugin window menu" aria-expanded={menu} onClick={() => setMenu((value) => !value)}>⌄</button>
                <button type="button" aria-label="Close plugin window" onClick={() => call('plugin_window_shell_close')}>×</button>
            </nav>
            {menu && <div className="plugin-window-menu" role="menu">
                {['Save preset…', 'Load preset…', 'Reset to default', 'Reveal plugin file'].map((item) => <Button role="menuitem" key={item}>{item}</Button>)}
                <label><input type="checkbox" checked={alwaysOnTop} onChange={(event) => { setAlwaysOnTop(event.target.checked); call('plugin_window_always_on_top', { alwaysOnTop: event.target.checked }); }} /> Always on top</label>
            </div>}
        </header>
        <section className="plugin-window-content">{info.has_gui ? <div id="plugin-native-gui-slot" /> : <p>This plugin has no embeddable GUI. Every parameter remains available on its node.</p>}</section>
    </main>;
}
