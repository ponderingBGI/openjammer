/**
 * PluginsPanel (§3) — the "bring your own plugins" discovery surface.
 *
 * Scans the OS-standard plugin directories (via the native `scan_plugins`
 * command — empty `dirs` means "the defaults", see `ojhost::default_plugin_dirs`)
 * and lists what's installed, with each plugin's vendor, format, port counts, and
 * whether it's an instrument or an effect. Plugin HOSTING is native-only (JUCE
 * VST2/VST3/CLAP/AU in desktop builds), so in a plain browser this explains that
 * and points at the desktop app.
 *
 * Toggled with Ctrl/Cmd+Shift+P or the "Plugins" palette command. The overlay
 * chrome (portal, scrim, Escape, focus-trap, click-outside) is the oj-ui Modal;
 * the header, actions, notes and tags are oj-ui primitives.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Modal, PanelHeader, Button, Callout, Chip, Spinner, List, ListRow } from '@openjammer/oj-ui';
import { getInvoke, isTauri } from '../../ai/tauri';
import { getExecutor } from '../../audio/executor';
import { hostedPluginIdFor, makeHostedPluginDefinition, registerDynamicPlugin } from '../../engine/dynamicRegistry';
import { register as registerCommand } from '../../store/commandRegistry';
import { useGraphStore } from '../../store/graphStore';
import './PluginsPanel.css';
import { useBindingSet, useModalKeymap } from '../../keymap/useKeymap';

/** One scanned plugin (mirrors `ojhost::PluginDescriptor`). */
interface PluginDescriptor {
    uid: string;
    name: string;
    vendor: string;
    path: string;
    format: 'Clap' | 'Vst2' | 'Vst3' | 'Au' | string;
    is_instrument: boolean;
    ports: { audio_in: number; audio_out: number };
    param_count: number;
    latency_samples: number;
}

/** A scanned plugin folder + whether it's the per-user or system-wide location. */
interface PluginDir {
    path: string;
    scope: 'user' | 'system' | string;
    format?: 'VST2' | 'VST3' | 'CLAP' | 'AU' | string;
}

/** Which hosting backend THIS build compiled in (mirrors `HostingInfo` in the
 *  native shell). `'none'` is the fast scaffold `bun native` that can't host any
 *  plugin — so an empty list there means "build can't host", not "none installed". */
interface HostingInfo {
    backend: 'none' | 'clap' | 'juce' | string;
    formats: string[];
}

type ScanState =
    | { kind: 'idle' }
    | { kind: 'scanning' }
    | { kind: 'ok'; plugins: PluginDescriptor[]; dirs: PluginDir[]; backend: HostingInfo | null }
    | { kind: 'error'; message: string }
    | { kind: 'unsupported' };

export function PluginsPanel({ initiallyOpen = false }: { initiallyOpen?: boolean }) {
    const [open, setOpen] = useState(initiallyOpen);
    const modalEntries = useMemo(() => [{
        actionId: 'panel.plugins', run: () => { setOpen(false); return true; },
    }], []);
    useModalKeymap('plugins', open, modalEntries);
    useBindingSet(useMemo(() => ({
        id: 'plugins-toggle-mounted',
        scope: 'global' as const,
        entries: [{ actionId: 'panel.plugins', run: () => { setOpen((value) => !value); return true; } }],
    }), []));
    const [state, setState] = useState<ScanState>({ kind: 'idle' });
    const addNode = useGraphStore((s) => s.addNode);
    const setNodePluginId = useGraphStore((s) => s.setNodePluginId);
    const updateNodePorts = useGraphStore((s) => s.updateNodePorts);

    useEffect(() => {
        const onCmd = () => setOpen((v) => !v);
        window.addEventListener('openjammer:toggle-plugins', onCmd);
        return () => {
            window.removeEventListener('openjammer:toggle-plugins', onCmd);
        };
    }, []);

    const close = useCallback(() => setOpen(false), []);

    const insertPlugin = useCallback(
        (plugin: PluginDescriptor) => {
            const pluginId = hostedPluginIdFor(plugin);
            const def = makeHostedPluginDefinition(plugin);
            registerDynamicPlugin(pluginId, def);
            const id = addNode('effect', { x: 80, y: 80 }, null, def.defaultData);
            setNodePluginId(id, pluginId);
            updateNodePorts(id, def.defaultPorts.map((port) => ({ ...port })));
            toast.success(`Added ${plugin.name}`, {
                description: plugin.is_instrument ? 'Hosted instrument plugin' : 'Hosted effect plugin',
            });
            close();
        },
        [addNode, close, setNodePluginId, updateNodePorts],
    );

    const scan = useCallback(async () => {
        const invoke = getInvoke();
        if (!invoke || !isTauri()) {
            setState({ kind: 'unsupported' });
            return;
        }
        setState({ kind: 'scanning' });
        try {
            // Empty dirs -> the native side scans the OS-standard plugin folders;
            // `plugin_dirs` returns those same VST2/VST3/CLAP/AU folders so the
            // empty state can show real paths instead of examples. `hosting_backend`
            // reports which backend this build compiled in, so an empty list can be
            // explained honestly (a scaffold build can't host anything). It's a new
            // command, so tolerate an older binary that lacks it (-> null).
            const [plugins, dirs, backend] = await Promise.all([
                invoke('scan_plugins', { dirs: [] }) as Promise<PluginDescriptor[]>,
                invoke('plugin_dirs') as Promise<PluginDir[]>,
                (invoke('hosting_backend') as Promise<HostingInfo>).catch(() => null),
            ]);
            const safePlugins = Array.isArray(plugins) ? plugins : [];
            for (const plugin of safePlugins) {
                const pluginId = hostedPluginIdFor(plugin);
                registerDynamicPlugin(pluginId, makeHostedPluginDefinition(plugin));
                registerCommand({
                    id: `add-${pluginId}`,
                    title: `Add ${plugin.name}`,
                    group: 'Plugins',
                    keywords: [plugin.format, plugin.vendor, plugin.is_instrument ? 'instrument' : 'effect'],
                    run: () => insertPlugin(plugin),
                });
            }
            setState({
                kind: 'ok',
                plugins: safePlugins,
                dirs: Array.isArray(dirs) ? dirs : [],
                backend,
            });
            // Auto-rebind (invariant #4a): the engine just re-registered every
            // scanned plugin, so force a re-push. A node that was degraded because
            // its plugin was missing now recompiles onto the real loader and its
            // "(missing plugin)" badge clears — no canvas edit needed.
            try {
                getExecutor().resync();
            } catch {
                /* no executor yet (pre-audio): the next push rebinds anyway */
            }
        } catch (err) {
            setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
        }
    }, [insertPlugin]);

    const resetQuarantine = useCallback(async () => {
        const invoke = getInvoke();
        if (!invoke) return;
        try {
            await invoke('plugin_quarantine_reset');
            toast.success('Plugin quarantine reset');
            await scan();
        } catch (err) {
            toast.error('Could not reset plugin quarantine', {
                description: err instanceof Error ? err.message : String(err),
            });
        }
    }, [scan]);

    /** Open one of the known plugin folders in the OS file manager. */
    const revealPath = useCallback(async (path: string) => {
        const invoke = getInvoke();
        if (!invoke) return;
        try {
            await invoke('reveal_path', { path });
        } catch (err) {
            toast.error('Could not open the folder', {
                description: err instanceof Error ? err.message : String(err),
            });
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
                    <>
                        <Button onClick={() => void resetQuarantine()} title="Reset crashed-plugin quarantine and re-scan">
                            Reset quarantine
                        </Button>
                        <Button onClick={() => void scan()} title="Re-scan">
                            Re-scan
                        </Button>
                    </>
                }
            />

            <div className="plugins-body">
                {state.kind === 'unsupported' && (
                    <Callout variant="info">
                        Plugin hosting is part of the <strong>desktop app</strong>. Install OpenJammer
                        for your OS to scan and host VST2, VST3, CLAP, and macOS AU plugins.
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
                    <PluginsEmptyState
                        backend={state.backend}
                        dirs={state.dirs}
                        onReveal={(path) => void revealPath(path)}
                    />
                )}
                {state.kind === 'ok' && state.plugins.length > 0 && (
                    <List aria-label="Installed plugins">
                        {state.plugins.map((p) => (
                            <ListRow
                                key={p.uid || p.path}
                                actions={
                                    <div className="plugins-meta">
                                        <Button onClick={() => insertPlugin(p)} title={`Add ${p.name} to the graph`}>
                                            Add
                                        </Button>
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

/**
 * The empty state, told honestly by what this build can actually host. The old
 * copy always said "install a plugin into a folder below, then Re-scan" — a lie in
 * a scaffold `bun native`, which can't host anything no matter what's installed.
 * Now the message follows `hosting_backend`:
 *   • `none`  → hosting is off; point at `bun native --all` (no folder dump — it's
 *               noise when dropping a plugin can't help).
 *   • `clap`  → CLAP-only; VST3/AU won't show; folders shown.
 *   • `juce`/unknown → really scanned and found nothing; folders shown + a nudge to
 *               Reset quarantine (a plugin that crashed a prior scan stays skipped).
 */
function PluginsEmptyState({
    backend,
    dirs,
    onReveal,
}: {
    backend: HostingInfo | null;
    dirs: PluginDir[];
    onReveal: (path: string) => void;
}) {
    const kind = backend?.backend ?? 'unknown';

    if (kind === 'none') {
        return (
            <div className="plugins-empty">
                <Callout variant="info" title="Plugin hosting is off in this build">
                    This fast <code>bun native</code> build doesn’t scan or host plugins, so nothing
                    appears here no matter what’s installed. Relaunch with <code>bun native --all</code>{' '}
                    (VST2/VST3/CLAP/AU) or <code>bun native --clap</code> (CLAP-only), then reopen this panel.
                </Callout>
            </div>
        );
    }

    const formats = backend?.formats?.length ? backend.formats.join('/').toUpperCase() : '';
    const title = kind === 'clap' ? 'No CLAP plugins found' : 'No plugins found';
    const body =
        kind === 'clap' ? (
            <>
                This build hosts <strong>CLAP only</strong> — VST3 and AU plugins won’t appear. Drop a{' '}
                <code>.clap</code> into a folder below and <strong>Re-scan</strong>, or relaunch with{' '}
                <code>bun native --all</code> for VST3/AU.
            </>
        ) : (
            <>
                {formats ? `Hosting is on (${formats}). ` : ''}OpenJammer scanned the folders below and
                found nothing. If a plugin you installed is missing, try <strong>Reset quarantine</strong>{' '}
                then <strong>Re-scan</strong> — a plugin that crashed a previous scan stays skipped until
                quarantine is cleared.
            </>
        );

    return (
        <div className="plugins-empty">
            <Callout variant="info" title={title}>
                {body}
            </Callout>
            {dirs.length > 0 && (
                <List aria-label="Plugin folders">
                    {dirs.map((dir) => (
                        <ListRow
                            key={dir.path}
                            actions={
                                <Button
                                    onClick={() => onReveal(dir.path)}
                                    title="Open this folder in your file manager"
                                >
                                    Open folder
                                </Button>
                            }
                        >
                            <span className="plugins-dir">
                                <code className="plugins-path">{dir.path}</code>
                                <Chip>{dir.format ?? 'Plugin'}</Chip>
                                <Chip>{dir.scope === 'user' ? 'your account' : 'all users'}</Chip>
                            </span>
                        </ListRow>
                    ))}
                </List>
            )}
        </div>
    );
}
