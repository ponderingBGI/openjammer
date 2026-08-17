import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button, Callout, Chip, Input, Modal, PanelHeader, SegmentedControl } from '@openjammer/oj-ui';
import { getInvoke, isTauri } from '../../ai/tauri';
import { getExecutor } from '../../audio/executor';
import {
    hostedPluginIdFor, makeHostedPluginDefinition, registerDynamicPlugin,
    type HostedPluginDescriptor,
} from '../../engine/dynamicRegistry';
import { nodeDefinitions } from '../../engine/registry';
import { familiesFromClapFeatures, familyForBuiltIn, PLUGIN_FAMILIES, type PluginFamily } from '../../engine/pluginFamily';
import { register as registerCommand } from '../../store/commandRegistry';
import { useGraphStore } from '../../store/graphStore';
import { useBindingSet, useModalKeymap } from '../../keymap/useKeymap';
import './PluginsPanel.css';
import { browserActionWord, defaultBrowserFamilies, filterBrowserItems, type BrowserContext, type BrowserItem, type BrowserSource } from './browserModel';

interface PluginDescriptor extends HostedPluginDescriptor {
    features?: string[];
    has_gui?: boolean;
    reliability_note?: string;
    benched?: boolean;
}
interface PluginDir { path: string; scope: string; format?: string }
interface HostingInfo { backend: string; formats: string[] }
interface QuarantineEntry { path: string; reason: string; crash_count: number; benched: boolean }

function builtInItems(): BrowserItem[] {
    const seen = new Set<string>();
    return Object.values(nodeDefinitions).flatMap((definition, declarationOrder) => {
        if (seen.has(definition.name)) return [];
        seen.add(definition.name);
        return [{
            id: `builtin:${definition.type}`,
            name: definition.name,
            vendor: 'OpenJammer',
            family: familyForBuiltIn(definition.category, definition.name),
            source: 'built-in' as const,
            declarationOrder,
        }];
    });
}

function installedItem(plugin: PluginDescriptor, declarationOrder: number): BrowserItem {
    const format = plugin.format.toUpperCase();
    return {
        id: hostedPluginIdFor(plugin), name: plugin.name, vendor: plugin.vendor || 'Unknown maker',
        family: format === 'CLAP' ? familiesFromClapFeatures(plugin.features)[0] : undefined,
        format, path: plugin.path, source: 'installed', reliability: plugin.reliability_note,
        descriptor: plugin, declarationOrder, benched: plugin.benched,
    };
}

export function PluginsPanel({ initiallyOpen = false, context = 'browse' }: { initiallyOpen?: boolean; context?: BrowserContext }) {
    const [open, setOpen] = useState(initiallyOpen);
    const [browserContext, setBrowserContext] = useState(context);
    const [plugins, setPlugins] = useState<PluginDescriptor[]>([]);
    const [dirs, setDirs] = useState<PluginDir[]>([]);
    const [backend, setBackend] = useState<HostingInfo | null>(null);
    const [quarantine, setQuarantine] = useState<QuarantineEntry[]>([]);
    const [quarantineOpen, setQuarantineOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [source, setSource] = useState<BrowserSource>('all');
    const [families, setFamilies] = useState<PluginFamily[]>(() => defaultBrowserFamilies(context));
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [focused, setFocused] = useState(0);
    const [scanning, setScanning] = useState(false);
    const [scanError, setScanError] = useState<string | null>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const addNode = useGraphStore((state) => state.addNode);
    const setNodePluginId = useGraphStore((state) => state.setNodePluginId);
    const updateNodePorts = useGraphStore((state) => state.updateNodePorts);

    const close = useCallback(() => setOpen(false), []);
    useModalKeymap('plugins', open, useMemo(() => [{ actionId: 'panel.plugins', run: () => { close(); return true; } }], [close]));
    useBindingSet(useMemo(() => ({ id: 'plugins-toggle-mounted', scope: 'global' as const, entries: [{ actionId: 'panel.plugins', run: () => { setBrowserContext('browse'); setOpen((value) => !value); return true; } }] }), []));

    useEffect(() => {
        const onOpen = (event: Event) => {
            const detail = (event as CustomEvent<{ context?: BrowserContext }>).detail;
            const next = detail?.context ?? 'browse';
            setBrowserContext(next);
            setFamilies(defaultBrowserFamilies(next));
            setOpen(true);
        };
        window.addEventListener('openjammer:toggle-plugins', onOpen);
        window.addEventListener('openjammer:open-browser', onOpen);
        return () => { window.removeEventListener('openjammer:toggle-plugins', onOpen); window.removeEventListener('openjammer:open-browser', onOpen); };
    }, []);

    const choose = useCallback((item: BrowserItem) => {
        if (item.source === 'built-in') {
            const type = item.id.slice('builtin:'.length) as keyof typeof nodeDefinitions;
            addNode(type, { x: 80, y: 80 });
        } else if (item.descriptor) {
            const def = makeHostedPluginDefinition(item.descriptor);
            registerDynamicPlugin(item.id, def);
            const id = addNode('effect', { x: 80, y: 80 }, null, def.defaultData);
            setNodePluginId(id, item.id);
            updateNodePorts(id, def.defaultPorts.map((port) => ({ ...port })));
        }
        window.dispatchEvent(new CustomEvent('openjammer:browser-chosen', { detail: { context: browserContext, item } }));
        toast.success(`${browserActionWord(browserContext) === 'Add' ? 'Added' : browserActionWord(browserContext)} ${item.name}`);
        close();
    }, [addNode, browserContext, close, setNodePluginId, updateNodePorts]);

    const scan = useCallback(async () => {
        const invoke = getInvoke();
        if (!invoke || !isTauri()) { setBackend({ backend: 'none', formats: [] }); return; }
        setScanning(true); setScanError(null);
        try {
            const [found, foundDirs, info, quarantined] = await Promise.all([
                invoke('scan_plugins', { dirs: [] }) as Promise<PluginDescriptor[]>,
                invoke('plugin_dirs') as Promise<PluginDir[]>,
                (invoke('hosting_backend') as Promise<HostingInfo>).catch(() => null),
                (invoke('plugin_quarantine_list') as Promise<QuarantineEntry[]>).catch(() => []),
            ]);
            const safe = Array.isArray(found) ? found : [];
            setPlugins(safe); setDirs(Array.isArray(foundDirs) ? foundDirs : []); setBackend(info);
            setQuarantine(Array.isArray(quarantined) ? quarantined : []);
            safe.forEach((plugin) => {
                const id = hostedPluginIdFor(plugin); registerDynamicPlugin(id, makeHostedPluginDefinition(plugin));
                registerCommand({ id: `add-${id}`, title: `Add ${plugin.name}`, group: plugin.is_instrument ? 'Instruments' : 'Effects', keywords: [plugin.format, plugin.vendor], run: () => choose(installedItem(plugin, 0)) });
            });
            try { getExecutor().resync(); } catch { /* the first graph push will bind */ }
        } catch (error) { setScanError(error instanceof Error ? error.message : String(error)); }
        finally { setScanning(false); }
    }, [choose]);

    useEffect(() => { if (open) void scan(); }, [open, scan]);
    useEffect(() => { if (open) queueMicrotask(() => searchRef.current?.focus()); }, [open]);

    const items = useMemo(() => [...builtInItems(), ...plugins.map(installedItem)], [plugins]);
    const visible = useMemo(() => filterBrowserItems(items, query, source, families), [families, items, query, source]);
    const availableFamilies = useMemo(() => PLUGIN_FAMILIES.filter((family) => items.some((item) => item.family === family)), [items]);
    const action = browserActionWord(browserContext);
    const folderCount = dirs.length;

    const onListKeyDown = (event: React.KeyboardEvent) => {
        if (event.key === '/') { event.preventDefault(); searchRef.current?.focus(); return; }
        if (event.key === 'ArrowDown') { event.preventDefault(); setFocused((value) => Math.min(visible.length - 1, value + 1)); }
        else if (event.key === 'ArrowUp') { event.preventDefault(); setFocused((value) => Math.max(0, value - 1)); }
        else if (event.key === 'Enter' && visible[focused]) choose(visible[focused]);
        else if (event.key === ' ' && visible[focused]) { event.preventDefault(); setExpandedId((id) => id === visible[focused]!.id ? null : visible[focused]!.id); }
    };

    return (
        <Modal open={open} onClose={close} ariaLabel="Browser" align="top" size="auto">
            <div className={`plugin-browser plugin-browser--${browserContext}`}>
                <PanelHeader title="Browser" onClose={close} actions={<Button onClick={() => void scan()}>Re-scan</Button>} />
                <div className="plugin-browser__search">
                    <Input ref={searchRef} data-autofocus="true" aria-label="Search plugins" placeholder="search…" value={query} onChange={(event) => { setQuery(event.target.value); setFocused(0); }} />
                    <SegmentedControl aria-label="Plugin source" value={source} options={[{ value: 'all', label: 'All' }, { value: 'built-in', label: 'Built-in' }, { value: 'installed', label: 'Installed' }]} onChange={setSource} />
                </div>
                <div className="plugin-browser__families" aria-label="Plugin families">
                    {availableFamilies.map((family) => <Chip key={family} pressed={families.includes(family)} onClick={() => setFamilies((current) => current.includes(family) ? current.filter((value) => value !== family) : [...current, family])}>{family}</Chip>)}
                </div>
                {scanError && <Callout variant="danger" title="Scan failed">{scanError}</Callout>}
                <div className="plugin-browser__results" role="listbox" aria-label="Sounds and effects" tabIndex={0} onKeyDown={onListKeyDown}>
                    {visible.map((item, index) => {
                        const provenance = [item.vendor, item.family, item.format, item.reliability].filter(Boolean).join(' · ');
                        return <div key={item.id} className={`plugin-browser__row${item.benched ? ' is-benched' : ''}`} role="option" aria-selected={index === focused} aria-label={[item.name, provenance].filter(Boolean).join(', ')} onMouseEnter={() => setFocused(index)} onClick={() => choose(item)}>
                            <div className="plugin-browser__identity"><strong>{item.name}</strong><span>{provenance}</span></div>
                            <Button onClick={(event) => { event.stopPropagation(); choose(item); }}>{item.benched ? 'Un-bench' : action}</Button>
                            {expandedId === item.id && <div className="plugin-browser__detail"><span>{item.descriptor ? `${item.descriptor.ports.audio_in}→${item.descriptor.ports.audio_out} ch · ${item.descriptor.param_count} params` : 'OpenJammer built-in'}</span>{item.path && <code>{item.path}</code>}</div>}
                        </div>;
                    })}
                    {visible.length === 0 && <p className="plugin-browser__none">nothing matches that — try fewer letters.</p>}
                </div>
                {quarantineOpen && <section className="plugin-browser__quarantine"><h3>{quarantine.length} plugins sat out this scan</h3><p>They crashed while being read, so we stopped asking and finished without them. Nothing else was affected.</p><Button onClick={() => void getInvoke()?.('plugin_quarantine_reset').then(scan)}>Try them again</Button>{quarantine.map((entry) => <div className="plugin-browser__quarantine-row" key={entry.path}><code>{entry.path.split(/[\\/]/).pop()}</code><span>{entry.reason}</span><Button onClick={() => void getInvoke()?.('plugin_quarantine_pardon', { path: entry.path }).then(scan)}>Try again</Button></div>)}</section>}
                <footer className="plugin-browser__status">
                    <span>{scanning ? `Reading ${folderCount ? 1 : 0} of ${folderCount} folders — ${plugins.length} plugins so far.` : backend?.backend === 'none' ? "This build doesn't host plugins — built-ins only." : `Read ${folderCount} folders — ${plugins.length} plugins.`}</span>
                    {quarantine.length > 0 && <button type="button" onClick={() => setQuarantineOpen((value) => !value)}>{quarantine.length} sat out ›</button>}
                    <span className="plugin-browser__ruler" style={{ transform: `scaleX(${scanning && folderCount ? 1 / folderCount : 1})` }} />
                </footer>
            </div>
        </Modal>
    );
}
