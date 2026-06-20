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
 * Toggled with Ctrl/Cmd+Shift+P or the "Plugins" palette command. The overlay
 * chrome (portal, scrim, Escape, focus-trap, click-outside) is the oj-ui Modal;
 * the header, actions, notes and tags are oj-ui primitives.
 */

import { useCallback, useEffect, useState } from 'react';
import { Modal, PanelHeader, Button, Callout, Chip, Spinner, List, ListRow } from '@openjammer/oj-ui';
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

    const close = useCallback(() => setOpen(false), []);

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

    return (
        <Modal open={open} onClose={close} ariaLabel="Plugins" align="top" size="md">
            <PanelHeader
                title="Plugins"
                onClose={close}
                actions={
                    <Button onClick={() => void scan()} title="Re-scan">
                        Re-scan
                    </Button>
                }
            />

            <div className="plugins-body">
                {state.kind === 'unsupported' && (
                    <Callout variant="info">
                        Plugin hosting (CLAP / VST3) is part of the <strong>desktop app</strong>.
                        Install OpenJammer for your OS to scan and host your own plugins.
                    </Callout>
                )}
                {state.kind === 'scanning' && (
                    <p className="plugins-note">
                        <Spinner /> Scanning your plugin folders…
                    </p>
                )}
                {state.kind === 'error' && (
                    <Callout variant="danger" title="Scan failed">
                        {state.message}
                    </Callout>
                )}
                {state.kind === 'ok' && state.plugins.length === 0 && (
                    <Callout variant="info">
                        No plugins found. Drop a <code>.clap</code> into your CLAP folder
                        (e.g. <code>~/.clap</code> on Linux, <code>~/Library/Audio/Plug-Ins/CLAP</code> on
                        macOS) and re-scan.
                    </Callout>
                )}
                {state.kind === 'ok' && state.plugins.length > 0 && (
                    <List aria-label="Installed plugins">
                        {state.plugins.map((p) => (
                            <ListRow
                                key={p.uid || p.path}
                                actions={
                                    <div className="plugins-meta">
                                        <Chip>{p.format}</Chip>
                                        <Chip>{p.is_instrument ? 'instrument' : 'effect'}</Chip>
                                        <Chip>
                                            {p.ports.audio_in}→{p.ports.audio_out} ch
                                        </Chip>
                                        <Chip>{p.param_count} params</Chip>
                                    </div>
                                }
                            >
                                <span className="plugins-item-main">
                                    <span className="plugins-name">{p.name}</span>
                                    <span className="plugins-vendor">{p.vendor}</span>
                                </span>
                            </ListRow>
                        ))}
                    </List>
                )}
            </div>
        </Modal>
    );
}
