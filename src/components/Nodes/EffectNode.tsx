/**
 * Effect Node — the built-in audio effects.
 *
 * The card is a small instrument face: pick what the box IS from a menu, then
 * turn its dials. Nothing here is a list of settings, because nothing here is
 * a setting — every control drives a real kernel parameter while sound is
 * flowing.
 *
 * WHICH CONTROL: bounded parameters get `Knob`s up to the same limit
 * `AutoParamPanel` uses (KNOB_LIMIT = 6, the point at which a face stops being
 * playable and starts needing to be scannable). Every built-in effect here has
 * at most three, so they are all dials. Frequencies get a log sweep — a cutoff
 * knob that crawls at the bottom and leaps at the top is a knob that lies.
 *
 * The type picker is a Menu popover rather than a native `<select>`: it is the
 * only place on this card where the node changes identity, and it deserves the
 * app's own menu physics and keyboard model.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GraphNode, EffectNodeData, EffectType } from '../../engine/types';
import { useGraphStore } from '../../store/graphStore';
import { Button, IconChevronDown, Knob, Menu, MenuItem } from '@openjammer/oj-ui';
import { useGestureBracket } from './nodeControls';
import './EffectNode.css';

interface EffectNodeProps {
    node: GraphNode;
}

// Each option's `params` are the UI control names; they map 1:1 to the chosen
// effect's REAL kernel param ids in the emitter (`EFFECT_LOWERING` in
// manifest.ts). Every dial here drives the engine — no dead controls. The old
// 'pitch' option was removed: there is no pitch-shift primitive in ojcore, so it
// was a fictional no-op (honesty over a dead menu entry).
const EFFECT_OPTIONS: { value: EffectType; label: string; params: string[] }[] = [
    { value: 'distortion', label: 'Distortion', params: ['amount', 'level'] },
    { value: 'filter', label: 'Filter', params: ['frequency', 'q'] },
    { value: 'reverb', label: 'Reverb', params: ['mix'] },
    { value: 'delay', label: 'Delay', params: ['time', 'feedback', 'mix'] },
];

/**
 * Per-parameter control config. Ranges mirror the kernel param decls so the UI
 * can never push an out-of-range value (the kernels clamp anyway, but the
 * control should be honest about the real usable range). `log` and `format` are
 * what turn a number into something a hand can find.
 */
const PARAM_CONFIG: Record<
    string,
    { min: number; max: number; default: number; log?: boolean; format: (v: number) => string }
> = {
    amount: { min: 0, max: 1, default: 0.5, format: (v) => `${Math.round(v * 100)}%` },
    level: { min: 0, max: 2, default: 1, format: (v) => `${v.toFixed(2)}×` },
    frequency: {
        min: 20,
        max: 20_000,
        default: 1000,
        log: true,
        format: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)} Hz`),
    },
    q: { min: 0.1, max: 20, default: 0.707, log: true, format: (v) => v.toFixed(2) },
    mix: { min: 0, max: 1, default: 0.3, format: (v) => `${Math.round(v * 100)}%` },
    time: { min: 0, max: 2, default: 0.25, format: (v) => `${Math.round(v * 1000)} ms` },
    feedback: { min: 0, max: 0.9, default: 0.4, format: (v) => `${Math.round(v * 100)}%` },
};

export function EffectNode({ node }: EffectNodeProps) {
    const data = node.data as EffectNodeData;
    const updateNodeData = useGraphStore((s) => s.updateNodeData);
    const beginGesture = useGraphStore((s) => s.beginGesture);
    const endGesture = useGraphStore((s) => s.endGesture);
    const gesture = useGestureBracket();

    const [pickerOpen, setPickerOpen] = useState(false);
    const pickerRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);

    const effectType = data.effectType || 'distortion';
    const params = useMemo(() => data.params || {}, [data.params]);
    const currentEffect = EFFECT_OPTIONS.find((e) => e.value === effectType);

    // Per-instance outside-click; two Effect nodes never share one popover.
    useEffect(() => {
        if (!pickerOpen) return;
        const onDown = (e: PointerEvent) => {
            if (!pickerRef.current?.contains(e.target as Node)) setPickerOpen(false);
        };
        document.addEventListener('pointerdown', onDown);
        return () => document.removeEventListener('pointerdown', onDown);
    }, [pickerOpen]);

    const closePicker = useCallback(() => {
        setPickerOpen(false);
        triggerRef.current?.focus();
    }, []);

    /** Changing the effect re-seeds every parameter — one reversible step. */
    const handleTypeChange = useCallback((newType: EffectType) => {
        closePicker();
        if (newType === effectType) return;
        const effectConfig = EFFECT_OPTIONS.find((ef) => ef.value === newType);
        const newParams: Record<string, number> = {};
        effectConfig?.params.forEach((param) => {
            newParams[param] = PARAM_CONFIG[param]?.default ?? 0.5;
        });
        beginGesture();
        updateNodeData<EffectNodeData>(node.id, { effectType: newType, params: newParams });
        endGesture();
    }, [beginGesture, closePicker, effectType, endGesture, node.id, updateNodeData]);

    const handleParamChange = useCallback((param: string, value: number) => {
        gesture.begin();
        updateNodeData<EffectNodeData>(node.id, { params: { ...params, [param]: value } });
    }, [gesture, node.id, params, updateNodeData]);

    return (
        <div className="effect-node">
            <div ref={pickerRef} className="effect-picker">
                <Button
                    ref={triggerRef}
                    variant="node"
                    className="effect-picker__trigger"
                    aria-haspopup="menu"
                    aria-expanded={pickerOpen}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => setPickerOpen((open) => !open)}
                >
                    <span className="effect-picker__name">{currentEffect?.label ?? 'Effect'}</span>
                    <IconChevronDown size={14} aria-hidden="true" />
                </Button>
                {pickerOpen && (
                    <Menu
                        ariaLabel="Effect type"
                        className="effect-picker__menu"
                        onEscape={closePicker}
                        onMouseDown={(e) => e.stopPropagation()}
                    >
                        {EFFECT_OPTIONS.map((opt) => (
                            <MenuItem
                                key={opt.value}
                                label={opt.label}
                                aria-checked={opt.value === effectType}
                                className={opt.value === effectType ? 'is-current' : undefined}
                                onSelect={() => handleTypeChange(opt.value)}
                            />
                        ))}
                    </Menu>
                )}
            </div>

            <div className="effect-dials" onMouseDown={(e) => e.stopPropagation()}>
                {currentEffect?.params.map((param) => {
                    const config = PARAM_CONFIG[param];
                    const value = params[param] ?? config?.default ?? 0.5;
                    return (
                        <Knob
                            key={param}
                            label={param.toUpperCase()}
                            value={value}
                            min={config?.min ?? 0}
                            max={config?.max ?? 1}
                            log={config?.log ?? false}
                            defaultValue={config?.default}
                            size={44}
                            format={config?.format ?? ((v) => v.toFixed(2))}
                            onChange={(v) => handleParamChange(param, v)}
                            onCommit={gesture.end}
                        />
                    );
                })}
            </div>
        </div>
    );
}
