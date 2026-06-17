/**
 * PluginsPanel (§3) — the "bring your own plugins" discovery surface.
 *
 * Scans the OS-standard plugin directories (via the native `scan_plugins`
 * command — empty `dirs` means "the defaults", see `ojhost::default_plugin_dirs`)
 * and lists what's installed, with each plugin's vendor, format, port counts, and
 * whether it's an instrument or an effect. Plugin HOSTING is native-only (the
 * pure-Rust CLAP backend), so in a plain browser this explains that and points at
 * the desktop app.
 *
 * Toggled with Ctrl/Cmd+Shift+P or the "Plugins" palette command.
 */

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { getInvoke, isTauri } from '../../ai/tauri';
import './PluginsPanel.css';

/** One scanned plugin (mirrors `ojhost::PluginDescriptor`). */
interface PluginDescriptor {
    uid: string;
    name: string;
    vendor: string;
    path: string;
    format: 'Clap' | 'Vst3' | 'Au' | string;
    is_instrument: boolean;
    ports: { audio_in: number; audio_out: number };
    param_count: number;
    latency_samples: number;
}

type ScanState =
    | { kind: 'idle' }
    | { kind: 'scanning' }
    | { kind: 'ok'; plugins: PluginDescriptor[] }
    | { kind: 'error'; message: string }
    | { kind: 'unsupported' };

export function PluginsPanel() {
    const [open, setOpen] = useState(false);
    const [state, setState] = useState<ScanState>({ kind: 'idle' });

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setOpen((v) => (v ? false : v));
                return;
            }
            const hit = (e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'p';
            if (!hit) return;
            e.preventDefault();
            setOpen((v) => !v);
        };
        const onCmd = () => setOpen((v) => !v);
        window.addEventListener('keydown', onKey);
        window.addEventListener('openjammer:toggle-plugins', onCmd);
        return () => {
            window.removeEventListener('keydown', onKey);
            window.removeEventListener('openjammer:toggle-plugins', onCmd);
        };
    }, []);

    const scan = useCallback(async () => {
        const invoke = getInvoke();
        if (!invoke || !isTauri()) {
            setState({ kind: 'unsupported' });
            return;
        }
        setState({ kind: 'scanning' });
        try {
            // Empty dirs -> the native side scans the OS-standard plugin folders.
            const plugins = (await invoke('scan_plugins', { dirs: [] })) as PluginDescriptor[];
            setState({ kind: 'ok', plugins: Array.isArray(plugins) ? plugins : [] });
        } catch (err) {
            setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
        }
    }, []);

    // Scan once each time the panel opens.
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- opening the panel kicks off a native plugin scan (side effect on an external system); the scan's setState is the sanctioned subscribe-and-update pattern
        if (open) void scan();
    }, [open, scan]);

    if (!open) return null;

    return createPortal(
        <div className="plugins-overlay" onClick={() => setOpen(false)}>
            <div
                className="plugins-panel"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label="Plugins"
            >
                <header className="plugins-header">
                    <span className="plugins-title">Plugins</span>
                    <span className="plugins-spacer" />
                    <button className="plugins-btn" onClick={() => void scan()} title="Re-scan">
                        Re-scan
                    </button>
                    <button className="plugins-btn" onClick={() => setOpen(false)} title="Close (Ctrl/Cmd+Shift+P)">
                        ✕
                    </button>
                </header>

                <div className="plugins-body">
                    {state.kind === 'unsupported' && (
                        <p className="plugins-note">
                            Plugin hosting (CLAP / VST3) is part of the <strong>desktop app</strong>.
                            Install OpenJammer for your OS to scan and host your own plugins.
                        </p>
                    )}
                    {state.kind === 'scanning' && <p className="plugins-note">Scanning your plugin folders…</p>}
                    {state.kind === 'error' && (
                        <p className="plugins-note plugins-error">Scan failed: {state.message}</p>
                    )}
                    {state.kind === 'ok' && state.plugins.length === 0 && (
                        <p className="plugins-note">
                            No plugins found. Drop a <code>.clap</code> into your CLAP folder
                            (e.g. <code>~/.clap</code> on Linux, <code>~/Library/Audio/Plug-Ins/CLAP</code> on
                            macOS) and re-scan.
                        </p>
                    )}
                    {state.kind === 'ok' && state.plugins.length > 0 && (
                        <ul className="plugins-list">
                            {state.plugins.map((p) => (
                                <li key={p.uid || p.path} className="plugins-item">
                                    <div className="plugins-item-main">
                                        <span className="plugins-name">{p.name}</span>
                                        <span className="plugins-vendor">{p.vendor}</span>
                                    </div>
                                    <div className="plugins-meta">
                                        <span className="plugins-tag">{p.format}</span>
                                        <span className="plugins-tag">
                                            {p.is_instrument ? 'instrument' : 'effect'}
                                        </span>
                                        <span className="plugins-tag">
                                            {p.ports.audio_in}→{p.ports.audio_out} ch
                                        </span>
                                        <span className="plugins-tag">{p.param_count} params</span>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </div>,
        document.body,
    );
}
