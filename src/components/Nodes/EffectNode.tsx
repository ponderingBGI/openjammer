/**
 * Effect Node - Audio effects processor
 */

import { useCallback } from 'react';
import type { GraphNode, EffectNodeData, EffectType } from '../../engine/types';
import { useGraphStore } from '../../store/graphStore';

interface EffectNodeProps {
    node: GraphNode;
}

const EFFECT_OPTIONS: { value: EffectType; label: string; params: string[] }[] = [
    { value: 'distortion', label: '🔥 Distortion', params: ['amount'] },
    { value: 'pitch', label: '🎵 Pitch Shift', params: ['semitones'] },
    { value: 'reverb', label: '🏛️ Reverb', params: ['mix', 'decay'] },
    { value: 'delay', label: '📢 Delay', params: ['time', 'feedback', 'mix'] }
];

const PARAM_CONFIG: Record<string, { min: number; max: number; step: number; default: number }> = {
    amount: { min: 0, max: 1, step: 0.1, default: 0.5 },
    semitones: { min: -12, max: 12, step: 1, default: 0 },
    mix: { min: 0, max: 1, step: 0.1, default: 0.3 },
    decay: { min: 0.1, max: 5, step: 0.1, default: 2 },
    time: { min: 0.05, max: 1, step: 0.05, default: 0.3 },
    feedback: { min: 0, max: 0.9, step: 0.1, default: 0.4 }
};

export function EffectNode({ node }: EffectNodeProps) {
    const data = node.data as EffectNodeData;
    const updateNodeData = useGraphStore((s) => s.updateNodeData);

    const effectType = data.effectType || 'distortion';
    const params = data.params || {};

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
                <select
                    className="node-select"
                    value={effectType}
                    onChange={handleTypeChange}
                >
                    {EFFECT_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                </select>
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
                        <input
                            type="range"
                            min={config?.min ?? 0}
                            max={config?.max ?? 1}
                            step={config?.step ?? 0.1}
                            value={value}
                            onChange={(e) => handleParamChange(param, parseFloat(e.target.value))}
                            style={{ width: '100%' }}
                        />
                    </div>
                );
            })}
        </div>
    );
}
