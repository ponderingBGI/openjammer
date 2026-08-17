/**
 * AutoParamPanel (M6) — the FREE control surface for AI/Faust-authored nodes.
 *
 * Proves the panel renders one slider per manifest `ParamDecl` (id/name/min/max/
 * default) and writes a change back through `updateNodeData` — so an AI-authored
 * code node gets editable controls with no bespoke component.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { AutoParamPanel } from '../AutoParamPanel';
import { formatParamValue, seededParamIds, togglePinnedParam } from '../paramModel';
import type { PluginManifest } from '../../../engine/manifest';
import type { GraphNode } from '../../../engine/types';
import { useGraphStore } from '../../../store/graphStore';

function makeNode(data: Record<string, unknown>): GraphNode {
    return {
        id: 'n1',
        type: 'effect',
        category: 'effects',
        position: { x: 0, y: 0 },
        data,
        ports: [],
        parentId: null,
        childIds: [],
    } as GraphNode;
}

const manifest: PluginManifest = {
    id: 'ai.wasm.deadbeef',
    name: 'Tremolo',
    kind: 'WasmHost',
    dsp: 'wasm',
    ui: 'auto',
    params: [
        { id: 0, name: 'rate', min: 0.1, max: 20, default: 4 },
        { id: 1, name: 'depth', min: 0, max: 1, default: 0.5 },
    ],
    ports: { audio_in: 1, audio_out: 1, control_in: 0, control_out: 0 },
};

describe('AutoParamPanel', () => {
    beforeEach(() => {
        cleanup();
    });

    it('pins at most eight parameters and toggles by stable id', () => {
        expect(togglePinnedParam([1, 2], 2)).toEqual([1]);
        expect(togglePinnedParam([1, 2, 3, 4, 5, 6, 7, 8], 9)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
        expect(seededParamIds([], [2, 3, 2, 4, 5])).toEqual([2, 3, 4, 5]);
    });

    it('shows plugin value text verbatim and invents no unit on fallback', () => {
        expect(formatParamValue(1240, '1.24 kHz')).toBe('1.24 kHz');
        expect(formatParamValue(1240)).toBe('1240.00');
    });

    it('renders one slider per manifest param with its label + default', () => {
        render(<AutoParamPanel node={makeNode({})} manifest={manifest} />);
        const sliders = screen.getAllByRole('slider');
        expect(sliders).toHaveLength(2);
        // Labels are present.
        expect(screen.getByText('rate')).toBeDefined();
        expect(screen.getByText('depth')).toBeDefined();
        // Defaults are shown (formatted to 2dp).
        expect(screen.getByText('4.00')).toBeDefined();
        expect(screen.getByText('0.50')).toBeDefined();
    });

    it('shows the empty state when there are no params', () => {
        render(<AutoParamPanel node={makeNode({})} manifest={{ ...manifest, params: [] }} />);
        expect(screen.getByText('No parameters')).toBeDefined();
    });

    it('writes a slider change back through the real graph store', () => {
        // Use the REAL store: add a node, render the panel over it, move a slider,
        // and assert the store recorded the new value (the panel writes via
        // useGraphStore.updateNodeData keyed by param name).
        const id = useGraphStore.getState().addNode('effect', { x: 0, y: 0 }, null, { rate: 4 });
        const node = useGraphStore.getState().nodes.get(id)!;

        render(<AutoParamPanel node={node} manifest={manifest} />);
        const sliders = screen.getAllByRole('slider');
        fireEvent.change(sliders[0], { target: { value: '10' } });

        const updated = useGraphStore.getState().nodes.get(id)!;
        expect((updated.data as Record<string, unknown>).rate).toBe(10);

        useGraphStore.getState().removeNode(id);
    });
});
