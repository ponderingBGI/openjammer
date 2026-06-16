/**
 * Plan path (D3, M7) — pure validator + lowering tests.
 *
 * Proves the higher-altitude {@link WorkflowPlan} desugars correctly and that
 * {@link validatePlan} catches the avoidable mistakes BEFORE any apply. Both
 * modules are pure (registry knowledge injected), so these run with FAKES — no
 * Zustand, no registry, no DOM.
 */

import { describe, it, expect } from 'vitest';
import { planToToolCalls, type PlanPortResolver, type WorkflowPlan } from '../plan';
import { validatePlan, type PlanLookups } from '../planValidator';
import type { PortDefinition } from '../../engine/types';

// ---------------------------------------------------------------------------
// Fake registry: a tiny world of looper / amplifier / speaker / mic.
// ---------------------------------------------------------------------------

const PORTS: Record<string, PortDefinition[]> = {
    looper: [
        { id: 'audio-in', name: 'Audio In', type: 'audio', direction: 'input' },
        { id: 'audio-out', name: 'Audio Out', type: 'audio', direction: 'output' },
    ],
    amplifier: [
        { id: 'audio-in', name: 'Audio In', type: 'audio', direction: 'input' },
        { id: 'audio-out', name: 'Audio Out', type: 'audio', direction: 'output' },
        { id: 'gain-in', name: 'Gain', type: 'control', direction: 'input' },
    ],
    speaker: [{ id: 'audio-in', name: 'Audio In', type: 'audio', direction: 'input' }],
    microphone: [{ id: 'audio-out', name: 'Audio Out', type: 'audio', direction: 'output' }],
};

const fakeLookups: PlanLookups = {
    isKnownType: (type) => type in PORTS,
    portsFor: (type) => PORTS[type] ?? [],
    // Mirror the real registry rule: direction must differ (checked upstream); same
    // direction is rejected here too for safety. Otherwise any-to-any.
    canConnect: (s, t) => s.direction !== t.direction,
    isSink: (type) => type === 'speaker',
};

const fakeResolve: PlanPortResolver = (type, portName) =>
    (PORTS[type as string] ?? []).find((p) => p.name === portName)?.id;

// ---------------------------------------------------------------------------
// validatePlan
// ---------------------------------------------------------------------------

describe('validatePlan', () => {
    it('accepts a sound mic -> amp -> speaker plan', () => {
        const plan: WorkflowPlan = {
            nodes: [
                { ref: 'mic', type: 'microphone' },
                { ref: 'amp', type: 'amplifier' },
                { ref: 'out', type: 'speaker' },
            ],
            wires: [
                { from: { ref: 'mic', port: 'Audio Out' }, to: { ref: 'amp', port: 'Audio In' } },
                { from: { ref: 'amp', port: 'Audio Out' }, to: { ref: 'out', port: 'Audio In' } },
            ],
        };
        expect(validatePlan(plan, fakeLookups)).toEqual([]);
    });

    it('flags a wire ref that resolves to no plan node (WIRE_REF)', () => {
        const plan: WorkflowPlan = {
            nodes: [{ ref: 'out', type: 'speaker' }],
            wires: [{ from: { ref: 'ghost', port: 'Audio Out' }, to: { ref: 'out', port: 'Audio In' } }],
        };
        const errs = validatePlan(plan, fakeLookups);
        expect(errs.some((e) => e.code === 'WIRE_REF' && e.ref === 'ghost')).toBe(true);
    });

    it('flags an unknown node type (UNKNOWN_TYPE)', () => {
        const plan: WorkflowPlan = {
            nodes: [
                { ref: 'x', type: 'flux-capacitor' },
                { ref: 'out', type: 'speaker' },
            ],
            wires: [],
        };
        const errs = validatePlan(plan, fakeLookups);
        expect(errs.some((e) => e.code === 'UNKNOWN_TYPE' && e.ref === 'x')).toBe(true);
    });

    it('flags a port NAME that does not resolve on the node (UNKNOWN_PORT)', () => {
        const plan: WorkflowPlan = {
            nodes: [
                { ref: 'mic', type: 'microphone' },
                { ref: 'out', type: 'speaker' },
            ],
            wires: [
                // "Bogus Port" is not on the mic.
                { from: { ref: 'mic', port: 'Bogus Port' }, to: { ref: 'out', port: 'Audio In' } },
            ],
        };
        const errs = validatePlan(plan, fakeLookups);
        expect(errs.some((e) => e.code === 'UNKNOWN_PORT' && e.ref === 'mic')).toBe(true);
    });

    it('flags a wire whose endpoints have the wrong direction (BAD_DIRECTION)', () => {
        const plan: WorkflowPlan = {
            nodes: [
                { ref: 'mic', type: 'microphone' },
                { ref: 'out', type: 'speaker' },
            ],
            wires: [
                // mic Audio Out -> out Audio In is correct; reverse it to break direction.
                { from: { ref: 'out', port: 'Audio In' }, to: { ref: 'mic', port: 'Audio Out' } },
            ],
        };
        const errs = validatePlan(plan, fakeLookups);
        expect(errs.some((e) => e.code === 'BAD_DIRECTION')).toBe(true);
    });

    it('rejects an incompatible connection (CANT_CONNECT)', () => {
        // canConnect that refuses everything → the otherwise-sound wire is rejected.
        const refusing: PlanLookups = { ...fakeLookups, canConnect: () => false };
        const plan: WorkflowPlan = {
            nodes: [
                { ref: 'mic', type: 'microphone' },
                { ref: 'out', type: 'speaker' },
            ],
            wires: [{ from: { ref: 'mic', port: 'Audio Out' }, to: { ref: 'out', port: 'Audio In' } }],
        };
        const errs = validatePlan(plan, refusing);
        expect(errs.some((e) => e.code === 'CANT_CONNECT')).toBe(true);
    });

    it('detects a non-looper cycle (CYCLE)', () => {
        // amp -> amp2 -> amp (a feedback loop with no looper) is an illegal cycle.
        const plan: WorkflowPlan = {
            nodes: [
                { ref: 'a', type: 'amplifier' },
                { ref: 'b', type: 'amplifier' },
                { ref: 'out', type: 'speaker' },
            ],
            wires: [
                { from: { ref: 'a', port: 'Audio Out' }, to: { ref: 'b', port: 'Audio In' } },
                { from: { ref: 'b', port: 'Audio Out' }, to: { ref: 'a', port: 'Audio In' } },
                { from: { ref: 'a', port: 'Audio Out' }, to: { ref: 'out', port: 'Audio In' } },
            ],
        };
        const errs = validatePlan(plan, fakeLookups);
        expect(errs.some((e) => e.code === 'CYCLE')).toBe(true);
    });

    it('ALLOWS looper feedback (the looper in->out edge is not a cycle)', () => {
        // looper output feeds back into amp which feeds the looper — a cycle that
        // passes THROUGH the looper. The looper-sourced edge is excluded, so it is
        // legal.
        const plan: WorkflowPlan = {
            nodes: [
                { ref: 'lp', type: 'looper' },
                { ref: 'amp', type: 'amplifier' },
                { ref: 'out', type: 'speaker' },
            ],
            wires: [
                { from: { ref: 'amp', port: 'Audio Out' }, to: { ref: 'lp', port: 'Audio In' } },
                // looper's own output edge — excluded from cycle detection.
                { from: { ref: 'lp', port: 'Audio Out' }, to: { ref: 'amp', port: 'Audio In' } },
                { from: { ref: 'lp', port: 'Audio Out' }, to: { ref: 'out', port: 'Audio In' } },
            ],
        };
        const errs = validatePlan(plan, fakeLookups);
        expect(errs.some((e) => e.code === 'CYCLE')).toBe(false);
    });

    it('passes speaker-reachability when a chain reaches a speaker', () => {
        const plan: WorkflowPlan = {
            nodes: [
                { ref: 'mic', type: 'microphone' },
                { ref: 'out', type: 'speaker' },
            ],
            wires: [{ from: { ref: 'mic', port: 'Audio Out' }, to: { ref: 'out', port: 'Audio In' } }],
        };
        expect(validatePlan(plan, fakeLookups).some((e) => e.code === 'NO_SOUND')).toBe(false);
    });

    it('fails speaker-reachability when no node reaches an output (NO_SOUND)', () => {
        const plan: WorkflowPlan = {
            nodes: [
                { ref: 'mic', type: 'microphone' },
                { ref: 'amp', type: 'amplifier' },
            ],
            wires: [{ from: { ref: 'mic', port: 'Audio Out' }, to: { ref: 'amp', port: 'Audio In' } }],
        };
        const errs = validatePlan(plan, fakeLookups);
        expect(errs.some((e) => e.code === 'NO_SOUND')).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// planToToolCalls
// ---------------------------------------------------------------------------

describe('planToToolCalls', () => {
    it('lowers params into add_node.initialData AND a follow-up update_node_data', () => {
        const plan: WorkflowPlan = {
            nodes: [{ ref: 'amp', type: 'amplifier', params: { gain: 2 } }],
            wires: [],
        };
        const calls = planToToolCalls(plan, { amp: 'node-1' }, fakeResolve);
        const add = calls.find((c) => c.name === 'add_node');
        expect(add?.name).toBe('add_node');
        expect(add && add.name === 'add_node' && add.args.initialData).toEqual({ gain: 2 });

        const update = calls.find((c) => c.name === 'update_node_data');
        expect(update && update.name === 'update_node_data' && update.args).toEqual({
            nodeId: 'node-1',
            data: { gain: 2 },
        });
    });

    it('resolves wire port NAMES to ids and refs to real ids', () => {
        const plan: WorkflowPlan = {
            nodes: [
                { ref: 'mic', type: 'microphone' },
                { ref: 'out', type: 'speaker' },
            ],
            wires: [{ from: { ref: 'mic', port: 'Audio Out' }, to: { ref: 'out', port: 'Audio In' } }],
        };
        const calls = planToToolCalls(plan, { mic: 'n-mic', out: 'n-out' }, fakeResolve);
        const conn = calls.find((c) => c.name === 'add_connection');
        expect(conn && conn.name === 'add_connection' && conn.args).toEqual({
            sourceNodeId: 'n-mic',
            sourcePortId: 'audio-out',
            targetNodeId: 'n-out',
            targetPortId: 'audio-in',
        });
    });

    it('emits an add_node for every node in plan order', () => {
        const plan: WorkflowPlan = {
            nodes: [
                { ref: 'a', type: 'microphone' },
                { ref: 'b', type: 'amplifier' },
                { ref: 'c', type: 'speaker' },
            ],
            wires: [],
        };
        const adds = planToToolCalls(plan, {}, fakeResolve).filter((c) => c.name === 'add_node');
        expect(adds).toHaveLength(3);
    });
});
