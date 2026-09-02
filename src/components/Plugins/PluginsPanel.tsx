import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button, Callout, Chip, CodeBlock, Input, List, ListRow, Modal, PanelHeader, ProgressBar, SegmentedControl, Spinner, StatusDot } from '@openjammer/oj-ui';
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
import { browserActionWord, defaultBrowserFamilies, filterBrowserItems, isBindableTrackVoice, type BrowserContext, type BrowserItem, type BrowserSource } from './browserModel';
import { useArrangementStore } from '../../store/arrangementStore';
import { bindTrackVerbs } from '../../song/bindTrack';

interface PluginDescriptor extends HostedPluginDescriptor {
    features?: string[];
    has_gui?: boolean;
    reliability_note?: string;
    benched?: boolean;
}
interface PluginDir { path: string; scope: string; format?: string }
interface HostingInfo { backend: string; formats: string[] }
interface QuarantineEntry { path: string; reason: string; crash_count: number; benched: boolean }

/**
 * `keep` runs BEFORE the de-duplication by display name, and that order is the
 * whole point: two definitions share the name "Instrument" — the structural
 * `-visual` mirror and the real one — and the mirror is declared first. Filtering
 * afterwards would drop the mirror AND leave the pick list with no "Instrument"
 * in it at all, which is how a filter meant to remove an unbindable choice
 * quietly removed a bindable one.
 */
function builtInItems(keep: (definition: { type: string; category: string }) => boolean = () => true): BrowserItem[] {
    const seen = new Set<string>();
    return Object.values(nodeDefinitions).flatMap((definition, declarationOrder) => {
        if (!keep(definition)) return [];
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

export function PluginsPanel({ initiallyOpen = false, context = 'browse', trackId = null }: { initiallyOpen?: boolean; context?: BrowserContext; trackId?: string | null }) {
    const [open, setOpen] = useState(initiallyOpen);
    const [browserContext, setBrowserContext] = useState(context);
    /*
     * WHICH track asked. The lane header has always sent it
     * (`detail: { context: 'pick', trackId }`) and every listener has always
     * dropped it, which is why the chip was decorative (UX-INV Q2 cause 2).
     */
    const [pickTrackId, setPickTrackId] = useState<string | null>(trackId);
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
            const detail = (event as CustomEvent<{ context?: BrowserContext; trackId?: string }>).detail;
            const next = detail?.context ?? 'browse';
            setBrowserContext(next);
            setPickTrackId(detail?.trackId ?? null);
            setFamilies(defaultBrowserFamilies(next));
            setOpen(true);
        };
        window.addEventListener('openjammer:toggle-plugins', onOpen);
        window.addEventListener('openjammer:open-browser', onOpen);
        return () => { window.removeEventListener('openjammer:toggle-plugins', onOpen); window.removeEventListener('openjammer:open-browser', onOpen); };
    }, []);

    const choose = useCallback((item: BrowserItem) => {
        /*
         * "Use it on THIS track" is a different verb from "add it to the canvas".
         * It writes the voice into the SONG's graph and points the track at it —
         * one array of verbs, so one Ctrl+Z takes the whole choice back.
         */
        const arrangement = useArrangementStore.getState().arrangement;
        if (browserContext === 'pick' && pickTrackId && arrangement && item.source === 'built-in') {
            const type = item.id.slice('builtin:'.length) as keyof typeof nodeDefinitions;
            const verbs = bindTrackVerbs(arrangement, pickTrackId, { type });
            if (verbs.length > 0) {
                useArrangementStore.getState().apply(verbs);
                window.dispatchEvent(new CustomEvent('openjammer:browser-chosen', { detail: { context: browserContext, item, trackId: pickTrackId } }));
                toast.success(`This track plays ${item.name}`);
                close();
                return;
            }
        }
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
    }, [addNode, browserContext, close, pickTrackId, setNodePluginId, updateNodePorts]);

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

    const items = useMemo(() => {
        // Picking a track's voice is not browsing: only what can actually BE a
        // voice belongs in the list (see `isBindableTrackVoice`).
        if (browserContext === 'pick') return builtInItems(isBindableTrackVoice);
        return [...builtInItems(), ...plugins.map(installedItem)];
    }, [browserContext, plugins]);
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

    // The honest empty state depends on WHY the list is empty: a filtered search
    // that matched nothing, a build that cannot host plugins at all, or a scan
    // that genuinely found none. Never one vague shrug for all three.
    const emptyState = (() => {
        if (visible.length > 0) return null;
        if (scanning) return null;
        if (query.trim() || families.length > 0 || source !== 'all') {
            return (
                <Callout variant="info" title="Nothing matches that">
                    Try fewer letters, or clear the family and source filters.
                </Callout>
            );
        }
        if (backend?.backend === 'none') {
            return (
                <Callout variant="info" title="This build hosts built-ins only">
                    Plugin hosting is a desktop feature. Everything OpenJammer ships with is
                    still here.
                </Callout>
            );
        }
        return (
            <Callout variant="info" title="No plugins found">
                {folderCount > 0
                    ? `Read ${folderCount} folder${folderCount === 1 ? '' : 's'} and found nothing to load. Re-scan after installing one.`
                    : 'No plugin folders are configured yet.'}
            </Callout>
        );
    })();

    return (
        <Modal open={open} onClose={close} ariaLabel="Browser" align="top" size="auto">
            <div className={`plugin-browser plugin-browser--${browserContext}`}>
                <PanelHeader
                    title="Browser"
                    onClose={close}
                    actions={
                        <Button variant="ghost" disabled={scanning} onClick={() => void scan()}>
                            {scanning ? <><Spinner size={14} /> Scanning…</> : 'Re-scan'}
                        </Button>
                    }
                />
                <div className="plugin-browser__search">
                    <Input ref={searchRef} data-autofocus="true" type="search" aria-label="Search plugins" placeholder="Search sounds and effects…" value={query} onChange={(event) => { setQuery(event.target.value); setFocused(0); }} />
                    <SegmentedControl aria-label="Plugin source" className="plugin-browser__source" value={source} options={[{ value: 'all', label: 'All' }, { value: 'built-in', label: 'Built-in' }, { value: 'installed', label: 'Installed' }]} onChange={setSource} />
                </div>
                <div className="plugin-browser__families" role="group" aria-label="Plugin families">
                    {availableFamilies.map((family) => (
                        <Chip
                            key={family}
                            role="button"
                            tabIndex={0}
                            className="plugin-browser__family"
                            pressed={families.includes(family)}
                            aria-pressed={families.includes(family)}
                            onClick={() => setFamilies((current) => current.includes(family) ? current.filter((value) => value !== family) : [...current, family])}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault();
                                    setFamilies((current) => current.includes(family) ? current.filter((value) => value !== family) : [...current, family]);
                                }
                            }}
                        >
                            {family}
                        </Chip>
                    ))}
                </div>
                <div className="plugin-browser__results oj-scroll">
                    {scanError && <Callout variant="danger" title="Scan failed">{scanError}</Callout>}
                    {emptyState}
                    <List role="listbox" aria-label="Sounds and effects" className="plugin-browser__list" tabIndex={0} onKeyDown={onListKeyDown}>
                        {visible.map((item, index) => (
                            <div key={item.id} className="plugin-browser__entry">
                                <ListRow
                                    className={`plugin-browser__row${item.benched ? ' is-benched' : ''}`}
                                    role="option"
                                    aria-selected={index === focused}
                                    aria-label={[item.name, item.vendor, item.format, item.benched ? 'benched' : ''].filter(Boolean).join(', ')}
                                    selected={index === focused}
                                    onMouseEnter={() => setFocused(index)}
                                    onClick={() => choose(item)}
                                    actions={
                                        <Button variant={item.benched ? 'secondary' : 'node'} onClick={(event) => { event.stopPropagation(); choose(item); }}>
                                            {item.benched ? 'Un-bench' : action}
                                        </Button>
                                    }
                                >
                                    <span className="plugin-browser__identity">
                                        <strong>{item.name}</strong>
                                        <span className="plugin-browser__meta">
                                            <span className="plugin-browser__vendor">{item.vendor}</span>
                                            {item.family && <Chip>{item.family}</Chip>}
                                            {item.format && <Chip>{item.format}</Chip>}
                                            {/* State is shown only when there IS one. A green
                                                "Ready" on every healthy row is decoration, and
                                                decoration in a state colour is exactly what the
                                                Signal-Not-Brand rule forbids. */}
                                            {item.benched && (
                                                <span className="plugin-browser__status-text">
                                                    <StatusDot status="warn" />
                                                    {item.reliability ?? 'Sat out after a crash'}
                                                </span>
                                            )}
                                            {!item.benched && item.reliability && (
                                                <span className="plugin-browser__status-text">
                                                    <StatusDot status="warn" />
                                                    {item.reliability}
                                                </span>
                                            )}
                                        </span>
                                    </span>
                                </ListRow>
                                {expandedId === item.id && (
                                    <div className="plugin-browser__detail">
                                        <span>{item.descriptor ? `${item.descriptor.ports.audio_in}→${item.descriptor.ports.audio_out} ch · ${item.descriptor.param_count} params` : 'OpenJammer built-in'}</span>
                                        {item.path && <CodeBlock text={item.path} />}
                                    </div>
                                )}
                            </div>
                        ))}
                    </List>
                </div>
                {quarantineOpen && (
                    <section className="plugin-browser__quarantine" aria-label="Plugins that sat out">
                        <Callout variant="warning" title={`${quarantine.length} plugins sat out this scan`}>
                            They crashed while being read, so we stopped asking and finished without
                            them. Nothing else was affected.
                        </Callout>
                        <div className="plugin-browser__quarantine-actions">
                            <Button variant="secondary" onClick={() => void getInvoke()?.('plugin_quarantine_reset').then(scan)}>Try them again</Button>
                        </div>
                        <List role="list" aria-label="Quarantined plugins">
                            {quarantine.map((entry) => (
                                <ListRow
                                    key={entry.path}
                                    className="plugin-browser__quarantine-row"
                                    actions={<Button variant="ghost" onClick={() => void getInvoke()?.('plugin_quarantine_pardon', { path: entry.path }).then(scan)}>Try again</Button>}
                                >
                                    <span className="plugin-browser__quarantine-name">{entry.path.split(/[\\/]/).pop()}</span>
                                    <span className="plugin-browser__quarantine-reason">
                                        <StatusDot status="bad" />
                                        {entry.reason}
                                    </span>
                                </ListRow>
                            ))}
                        </List>
                    </section>
                )}
                <footer className="plugin-browser__status">
                    <span>{scanning ? `Reading ${folderCount} folder${folderCount === 1 ? '' : 's'} — ${plugins.length} plugins so far.` : backend?.backend === 'none' ? "This build doesn't host plugins — built-ins only." : `Read ${folderCount} folder${folderCount === 1 ? '' : 's'} — ${plugins.length} plugins.`}</span>
                    {quarantine.length > 0 && (
                        <Button variant="link" onClick={() => setQuarantineOpen((value) => !value)}>
                            {quarantine.length} sat out
                        </Button>
                    )}
                    {scanning && <ProgressBar indeterminate className="plugin-browser__ruler" aria-label="Scanning plugin folders" />}
                </footer>
            </div>
        </Modal>
    );
}
