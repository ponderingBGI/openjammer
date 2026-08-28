import { useMemo, useState } from 'react';
import { Button, Input, ParamRow } from '@openjammer/oj-ui';
import type { GraphNode, NodeData } from '../../engine/types';
import type { ParamDecl, PluginManifest } from '../../engine/manifest';
import { HOSTED_PLUGIN_DESCRIPTOR_KEY, type HostedPluginDescriptor } from '../../engine/dynamicRegistry';
import { getInvoke, isTauri } from '../../ai/tauri';
import { useGraphStore } from '../../store/graphStore';
import './AutoParamPanel.css';
import { formatParamValue, seededParamIds, togglePinnedParam } from './paramModel';

function stepFor(param: ParamDecl): number {
    if (param.stepped) return 1;
    const span = param.max - param.min;
    if (span <= 0) return 0.01;
    const raw = span / 100;
    return 10 ** Math.floor(Math.log10(raw));
}

function displayName(param: ParamDecl): string {
    const parts = param.module?.split('/').filter(Boolean) ?? [];
    return parts.length > 1 ? `${parts.slice(1).join(' › ')} › ${param.name}` : param.name || `Parameter ${param.id + 1}`;
}

function groupParams(params: readonly ParamDecl[]): Array<{ name: string; params: ParamDecl[] }> {
    const groups = new Map<string, ParamDecl[]>();
    for (const param of params) {
        const group = param.module?.split('/').filter(Boolean)[0] ?? '';
        groups.set(group, [...(groups.get(group) ?? []), param]);
    }
    return [...groups].map(([name, members]) => ({ name: members.length === 1 ? '' : name, params: members }));
}

function WindowGlyph({ node, descriptor }: { node: GraphNode; descriptor: HostedPluginDescriptor }) {
    const [open, setOpen] = useState(false);
    if (!descriptor.has_gui) return null;
    const toggle = async () => {
        const invoke = getInvoke();
        if (!invoke || !isTauri()) return;
        const command = open ? 'plugin_editor_close' : 'plugin_editor_open';
        await invoke(command, open ? { nodeId: node.id } : { nodeId: node.id, descriptor });
        setOpen(!open);
    };
    return <Button className="plugin-window-glyph" aria-label={`${open ? 'Close' : 'Open'} ${descriptor.name} window`} aria-pressed={open} onClick={() => void toggle()} title="Open plugin window"><span aria-hidden="true">↗</span></Button>;
}

export function AutoParamPanel({ node, manifest }: { node: GraphNode; manifest: PluginManifest }) {
    const updateNodeData = useGraphStore((state) => state.updateNodeData);
    const beginGesture = useGraphStore((state) => state.beginGesture);
    const endGesture = useGraphStore((state) => state.endGesture);
    const data = node.data as Record<string, unknown>;
    const descriptor = data[HOSTED_PLUGIN_DESCRIPTOR_KEY] as HostedPluginDescriptor | undefined;
    const pinned = Array.isArray(data.pinnedParams) ? data.pinnedParams.filter((id): id is number => typeof id === 'number') : [];
    const touched = Array.isArray(data.touchedParams) ? data.touchedParams.filter((id): id is number => typeof id === 'number') : [];
    const [query, setQuery] = useState('');
    const [closedGroups, setClosedGroups] = useState<Set<string>>(() => new Set(manifest.params.length > 24 ? groupParams(manifest.params).slice(1).map((group) => group.name) : []));
    const params = useMemo(() => manifest.params.filter((param) => !param.hidden && `${param.name} ${param.module ?? ''}`.toLowerCase().includes(query.toLowerCase())), [manifest.params, query]);
    const shownPinned = seededParamIds(pinned, touched).map((id) => manifest.params.find((param) => param.id === id)).filter((param): param is ParamDecl => Boolean(param));

    const row = (param: ParamDecl, inPinned = false) => {
        const stored = data[param.name];
        const value = typeof stored === 'number' && Number.isFinite(stored) ? stored : param.default;
        const label = displayName(param);
        return <ParamRow key={`${inPinned ? 'pin' : 'all'}:${param.id}`} label={label} value={value} valueText={formatParamValue(value, param.valueText)} min={param.min} max={param.max} step={stepFor(param)} readOnly={param.readOnly} pinned={pinned.includes(param.id)} onLabelClick={() => updateNodeData<NodeData>(node.id, { pinnedParams: togglePinnedParam(pinned, param.id) })} onGestureStart={beginGesture} onGestureEnd={endGesture} onChange={(next) => { if (!Number.isFinite(next)) return; updateNodeData<NodeData>(node.id, { [param.name]: next, touchedParams: [...touched.filter((id) => id !== param.id), param.id].slice(-4) }); }} />;
    };

    return <div className="auto-param-panel">
        {descriptor && <div className="auto-param-panel__window"><span>{descriptor.vendor}</span><WindowGlyph node={node} descriptor={descriptor} /></div>}
        {manifest.params.length > 24 && <Input aria-label="Filter parameters" placeholder="filter parameters" value={query} onChange={(event) => setQuery(event.target.value)} />}
        <div className="auto-param-panel__scroll">
            {manifest.params.length > 24 && <section className="auto-param-panel__pinned"><h3>Pinned</h3>{shownPinned.length ? shownPinned.map((param) => row(param, true)) : <p>⌐ pin the ones you play — click a name</p>}</section>}
            {groupParams(params).map((group) => <section key={group.name || 'ungrouped'}>
                {group.name && <button type="button" className="auto-param-panel__group" aria-expanded={!closedGroups.has(group.name)} onClick={() => setClosedGroups((current) => { const next = new Set(current); if (next.has(group.name)) next.delete(group.name); else next.add(group.name); return next; })}>{closedGroups.has(group.name) ? '▸' : '⌄'} {group.name}<span>{group.params.length} params</span></button>}
                {!closedGroups.has(group.name) && group.params.map((param) => row(param))}
            </section>)}
            {manifest.params.length === 0 && <p className="auto-param-panel__empty">No parameters</p>}
        </div>
        {descriptor && <footer className="plugin-node-footer"><button type="button" aria-label={`Bypass ${descriptor.name}`} aria-pressed={data.pluginBypassed === true} onClick={() => updateNodeData<NodeData>(node.id, { pluginBypassed: data.pluginBypassed !== true })}>⊸</button>{descriptor.latency_samples > 0 && <span title={`Delay-compensated at the master.`}>+{descriptor.latency_samples} smp aligned</span>}<i className={data.pluginStateDirty === true ? 'is-dirty' : ''} title="unsaved plugin state — Ctrl+S" /></footer>}
    </div>;
}
