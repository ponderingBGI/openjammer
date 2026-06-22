/**
 * Effect Node - Audio effects processor
 */

import { useCallback, useMemo } from 'react';
import type { GraphNode, EffectNodeData, EffectType } from '../../engine/types';
import { useGraphStore } from '../../store/graphStore';
import { Select, Slider } from '@openjammer/oj-ui';

interface EffectNodeProps {
    node: GraphNode;
}

// Each option's `params` are the UI control names; they map 1:1 to the chosen
// effect's REAL kernel param ids in the emitter (`EFFECT_LOWERING` in
// manifest.ts). Every slider here drives the engine — no dead controls. The old
// 'pitch' option was removed: there is no pitch-shift primitive in ojcore, so it
// was a fictional no-op (honesty over a dead menu entry).
const EFFECT_OPTIONS: { value: EffectType; label: string; params: string[] }[] = [
    { value: 'distortion', label: '🔥 Distortion', params: ['amount', 'level'] },
    { value: 'filter', label: '🎛️ Filter', params: ['frequency', 'q'] },
    { value: 'reverb', label: '🏛️ Reverb', params: ['mix'] },
    { value: 'delay', label: '📢 Delay', params: ['time', 'feedback', 'mix'] }
];

// Slider config per UI param. Ranges mirror the kernel param decls so the UI can
// never push an out-of-range value (the kernels clamp anyway, but the control
// should be honest about the real usable range).
const PARAM_CONFIG: Record<string, { min: number; max: number; step: number; default: number }> = {
    amount: { min: 0, max: 1, step: 0.05, default: 0.5 },
    level: { min: 0, max: 2, step: 0.05, default: 1 },
    frequency: { min: 20, max: 20_000, step: 10, default: 1000 },
    q: { min: 0.1, max: 20, step: 0.1, default: 0.707 },
    mix: { min: 0, max: 1, step: 0.05, default: 0.3 },
    time: { min: 0, max: 2, step: 0.01, default: 0.25 },
    feedback: { min: 0, max: 0.9, step: 0.05, default: 0.4 }
};

export function EffectNode({ node }: EffectNodeProps) {
    const data = node.data as EffectNodeData;
    const updateNodeData = useGraphStore((s) => s.updateNodeData);

    const effectType = data.effectType || 'distortion';
    const params = useMemo(() => data.params || {}, [data.params]);

    const currentEffect = EFFECT_OPTIONS.find(e => e.value === effectType);

    // Change effect type
    const handleTypeChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
        const newType = e.target.value as EffectType;
        const effectConfig = EFFECT_OPTIONS.find(ef => ef.value === newType);

        // Initialize default params for new effect type
        const newParams: Record<string, number> = {};
        effectConfig?.params.forEach(param => {
            newParams[param] = PARAM_CONFIG[param]?.default ?? 0.5;
        });

        updateNodeData<EffectNodeData>(node.id, {
            effectType: newType,
            params: newParams
        });
    }, [node.id, updateNodeData]);

    // Update param value
    const handleParamChange = useCallback((param: string, value: number) => {
        updateNodeData<EffectNodeData>(node.id, {
            params: { ...params, [param]: value }
        });
    }, [node.id, params, updateNodeData]);

    return (
        <div className="effect-node">
            {/* Effect Type Selector */}
            <div className="node-row">
                <Select
                    className="node-select"
                    value={effectType}
                    onChange={handleTypeChange}
                >
                    {EFFECT_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                </Select>
            </div>

            {/* Effect Parameters */}
            {currentEffect?.params.map(param => {
                const config = PARAM_CONFIG[param];
                const value = params[param] ?? config?.default ?? 0.5;

                return (
                    <div key={param} className="node-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                            <span className="node-label" style={{ marginBottom: 0, textTransform: 'capitalize' }}>
                                {param}
                            </span>
                            <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                                {typeof value === 'number' ? value.toFixed(2) : value}
                            </span>
                        </div>
                        <Slider
                            aria-label={param}
                            min={config?.min ?? 0}
                            max={config?.max ?? 1}
                            step={config?.step ?? 0.1}
                            value={value}
                            onChange={(v) => handleParamChange(param, v)}
                            style={{ width: '100%' }}
                        />
                    </div>
                );
            })}
        </div>
    );
}
