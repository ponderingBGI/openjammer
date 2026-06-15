/**
 * AutoParamPanel — the FREE control surface.
 *
 * Renders an editable slider per {@link ParamDecl} purely from a node's
 * {@link PluginManifest}. This is the UI that AI- and Faust-authored nodes get
 * for nothing: declare numeric params in the manifest and they become editable
 * here, with no bespoke React component required.
 *
 * Bespoke (ui:'react') nodes keep their hand-written components; NodeWrapper
 * only falls back to this panel for manifests whose `ui` is `'auto'`.
 *
 * Param `name` doubles as the node-`data` key (manifests are derived from each
 * definition's numeric `defaultData` fields — see `engine/manifest.ts`), so a
 * change writes straight back through `updateNodeData`.
 */

import { useCallback } from 'react';
import type { GraphNode, NodeData } from '../../engine/types';
import type { ParamDecl, PluginManifest } from '../../engine/manifest';
import { useGraphStore } from '../../store/graphStore';

interface AutoParamPanelProps {
    node: GraphNode;
    manifest: PluginManifest;
}

function stepFor(param: ParamDecl): number {
    const span = param.max - param.min;
    if (span <= 0) return 0.01;
    // ~100 steps across the range, rounded to a clean magnitude.
    const raw = span / 100;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    return mag > 0 ? mag : 0.01;
}

function ParamRow({ node, param }: { node: GraphNode; param: ParamDecl }) {
    const updateNodeData = useGraphStore((s) => s.updateNodeData);

    const stored = (node.data as Record<string, unknown>)[param.name];
    const value = typeof stored === 'number' && Number.isFinite(stored) ? stored : param.default;

    const handleChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const next = parseFloat(e.target.value);
            if (Number.isNaN(next)) return;
            updateNodeData<NodeData>(node.id, { [param.name]: next });
        },
        [node.id, param.name, updateNodeData],
    );

    return (
        <div className="node-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '2px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>{param.name}</span>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                    {value.toFixed(2)}
                </span>
            </div>
            <input
                type="range"
                min={param.min}
                max={param.max}
                step={stepFor(param)}
                value={value}
                onChange={handleChange}
                onMouseDown={(e) => e.stopPropagation()}
                style={{ width: '100%' }}
            />
        </div>
    );
}

export function AutoParamPanel({ node, manifest }: AutoParamPanelProps) {
    if (manifest.params.length === 0) {
        return (
            <div className="auto-param-panel" style={{ fontSize: '11px', color: 'var(--text-muted)', padding: '4px' }}>
                No parameters
            </div>
        );
    }

    return (
        <div className="auto-param-panel" style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '4px' }}>
            {manifest.params.map((param) => (
                <ParamRow key={param.id} node={node} param={param} />
            ))}
        </div>
    );
}
