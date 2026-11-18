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
import { createPlanLookups, resolvePlanPort } from '../planAdapter';
import type { PortDefinition } from '../../engine/types';

// ---------------------------------------------------------------------------
// Fake registry: a tiny world of looper / multiplier / speaker / mic.
//
// It speaks the SHIPPING vocabulary (`In` / `Out`). It used to say `Audio In` /
// `Audio Out`, and when the real registry was renamed this whole file stayed
// green while every documented plan broke against the real one — a fake that
// drifts from the thing it stands in for is worse than no fake. The block at the
// bottom of this file exercises the REAL registry for exactly that reason.
// ---------------------------------------------------------------------------

const PORTS: Record<string, PortDefinition[]> = {
    looper: [
        { id: 'audio-in', name: 'In', type: 'audio', direction: 'input' },
        { id: 'audio-out', name: 'Out', type: 'audio', direction: 'output' },
    ],
    multiplier: [
        { id: 'audio-in', name: 'In', type: 'audio', direction: 'input' },
        { id: 'audio-out', name: 'Out', type: 'audio', direction: 'output' },
    ],
    speaker: [{ id: 'audio-in', name: 'In', type: 'audio', direction: 'input' }],
    microphone: [{ id: 'audio-out', name: 'Out', type: 'audio', direction: 'output' }],
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
                { ref: 'amp', type: 'multiplier' },
                { ref: 'out', type: 'speaker' },
            ],
            wires: [
                { from: { ref: 'mic', port: 'Out' }, to: { ref: 'amp', port: 'In' } },
                { from: { ref: 'amp', port: 'Out' }, to: { ref: 'out', port: 'In' } },
            ],
        };
        expect(validatePlan(plan, fakeLookups)).toEqual([]);
    });

    it('flags a wire ref that resolves to no plan node (WIRE_REF)', () => {
        const plan: WorkflowPlan = {
            nodes: [{ ref: 'out', type: 'speaker' }],
            wires: [{ from: { ref: 'ghost', port: 'Out' }, to: { ref: 'out', port: 'In' } }],
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
                { from: { ref: 'mic', port: 'Bogus Port' }, to: { ref: 'out', port: 'In' } },
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
                { from: { ref: 'out', port: 'In' }, to: { ref: 'mic', port: 'Out' } },
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
            wires: [{ from: { ref: 'mic', port: 'Out' }, to: { ref: 'out', port: 'In' } }],
        };
        const errs = validatePlan(plan, refusing);
        expect(errs.some((e) => e.code === 'CANT_CONNECT')).toBe(true);
    });

    it('detects a non-looper cycle (CYCLE)', () => {
        // amp -> amp2 -> amp (a feedback loop with no looper) is an illegal cycle.
        const plan: WorkflowPlan = {
            nodes: [
                { ref: 'a', type: 'multiplier' },
                { ref: 'b', type: 'multiplier' },
                { ref: 'out', type: 'speaker' },
            ],
            wires: [
                { from: { ref: 'a', port: 'Out' }, to: { ref: 'b', port: 'In' } },
                { from: { ref: 'b', port: 'Out' }, to: { ref: 'a', port: 'In' } },
                { from: { ref: 'a', port: 'Out' }, to: { ref: 'out', port: 'In' } },
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
                { ref: 'amp', type: 'multiplier' },
                { ref: 'out', type: 'speaker' },
            ],
            wires: [
                { from: { ref: 'amp', port: 'Out' }, to: { ref: 'lp', port: 'In' } },
                // looper's own output edge — excluded from cycle detection.
                { from: { ref: 'lp', port: 'Out' }, to: { ref: 'amp', port: 'In' } },
                { from: { ref: 'lp', port: 'Out' }, to: { ref: 'out', port: 'In' } },
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
            wires: [{ from: { ref: 'mic', port: 'Out' }, to: { ref: 'out', port: 'In' } }],
        };
        expect(validatePlan(plan, fakeLookups).some((e) => e.code === 'NO_SOUND')).toBe(false);
    });

    it('fails speaker-reachability when no node reaches an output (NO_SOUND)', () => {
        const plan: WorkflowPlan = {
            nodes: [
                { ref: 'mic', type: 'microphone' },
                { ref: 'amp', type: 'multiplier' },
            ],
            wires: [{ from: { ref: 'mic', port: 'Out' }, to: { ref: 'amp', port: 'In' } }],
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
            nodes: [{ ref: 'amp', type: 'multiplier', params: { factor: 2 } }],
            wires: [],
        };
        const calls = planToToolCalls(plan, { amp: 'node-1' }, fakeResolve);
        const add = calls.find((c) => c.name === 'add_node');
        expect(add?.name).toBe('add_node');
        expect(add && add.name === 'add_node' && add.args.initialData).toEqual({ factor: 2 });

        const update = calls.find((c) => c.name === 'update_node_data');
        expect(update && update.name === 'update_node_data' && update.args).toEqual({
            nodeId: 'node-1',
            data: { factor: 2 },
        });
    });

    it('resolves wire port NAMES to ids and refs to real ids', () => {
        const plan: WorkflowPlan = {
            nodes: [
                { ref: 'mic', type: 'microphone' },
                { ref: 'out', type: 'speaker' },
            ],
            wires: [{ from: { ref: 'mic', port: 'Out' }, to: { ref: 'out', port: 'In' } }],
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
                { ref: 'b', type: 'multiplier' },
                { ref: 'c', type: 'speaker' },
            ],
            wires: [],
        };
        const adds = planToToolCalls(plan, {}, fakeResolve).filter((c) => c.name === 'add_node');
        expect(adds).toHaveLength(3);
    });
});

// ---------------------------------------------------------------------------
// The REAL registry — the agent's shipped wire contract
// ---------------------------------------------------------------------------

/**
 * W6-SHIP fix round, F3. Everything above this line runs against a FAKE registry,
 * and that is why renaming the real port vocabulary broke `docs/agent-tools.md`'s
 * worked example without turning a single test red: the fake had been taught the
 * same old names, so it agreed with the code that was wrong.
 *
 * This block runs the doc's example — the one an agent is told to copy — through
 * `resolvePlanPort` and `createPlanLookups`, i.e. the real built-in registry. It
 * asserts both halves of the contract:
 *
 *  1. the CURRENT names in the doc resolve and validate, and
 *  2. every RETIRED spelling still resolves, because an agent that learned
 *     `"Audio Out"` from an older revision of that doc must not be silently
 *     broken by our rename. Reversibility is the boundary, not obedience.
 */
describe('the agent wire contract, against the real registry', () => {
    /** `docs/agent-tools.md`'s worked example, verbatim in shape. */
    const docPlan = (outPort: string, inPort: string): WorkflowPlan => ({
        nodes: [
            { ref: 'lp', type: 'looper' },
            { ref: 'amp', type: 'multiplier', params: { factor: 2 } },
            { ref: 'out', type: 'speaker' },
        ],
        wires: [
            // `In 1` is the multiplier's OWN name and has no alias — a port that
            // carries a real name keeps it. The doc example used to say
            // `Audio In` here, into a port that has never existed under any
            // spelling, so it had been broken since before the rename.
            { from: { ref: 'lp', port: outPort }, to: { ref: 'amp', port: 'In 1' } },
            { from: { ref: 'amp', port: outPort }, to: { ref: 'out', port: inPort } },
        ],
    });

    it('validates the documented plan with the CURRENT names', () => {
        const errors = validatePlan(docPlan('Out', 'In'), createPlanLookups());
        expect(errors, JSON.stringify(errors)).toEqual([]);
    });

    it('still validates a plan an agent learned with the RETIRED names', () => {
        for (const [out, into] of [['Audio Out', 'Audio In'], ['Output', 'Input']] as const) {
            const errors = validatePlan(docPlan(out, into), createPlanLookups());
            expect(errors, `${out} -> ${into}: ${JSON.stringify(errors)}`).toEqual([]);
        }
    });

    it('lowers every spelling to the SAME real port ids', () => {
        // The aliases are not a second code path — they must land on the exact
        // ids the current names land on, or an old plan would wire a new graph
        // differently from a new one.
        const ids = (out: string, into: string) =>
            planToToolCalls(docPlan(out, into), { lp: 'n-lp', amp: 'n-amp', out: 'n-out' }, resolvePlanPort)
                .filter((call) => call.name === 'add_connection')
                .map((call) => {
                    const args = call.args as { sourcePortId?: string; targetPortId?: string };
                    return `${args.sourcePortId}->${args.targetPortId}`;
                });
        const current = ids('Out', 'In');
        expect(current).toEqual(['audio-out->in-1', 'out->audio-in']);
        expect(ids('Audio Out', 'Audio In')).toEqual(current);
        expect(ids('Output', 'Input')).toEqual(current);
        // `Audio` is deliberately NOT an alias on this path: a plan endpoint has
        // no direction, so it would match a node's input and its output equally
        // and `find` would take whichever came first — a cable wired backwards
        // from a name the agent thought was precise. It stays a migration-only
        // spelling, and the validator reports it rather than guessing.
        expect(resolvePlanPort('speaker', 'Audio')).toBeUndefined();
        expect(resolvePlanPort('looper', 'Audio')).toBeUndefined();
        // The id itself is the one spelling that never moves. Asserted per port
        // rather than through the plan, because the three nodes do not share ids
        // (the multiplier's output really is `out`, not `audio-out`).
        expect(resolvePlanPort('looper', 'audio-out')).toBe('audio-out');
        expect(resolvePlanPort('speaker', 'audio-in')).toBe('audio-in');
        expect(resolvePlanPort('multiplier', 'out')).toBe('out');
    });

    it('does not invent a match for a name no port carries', () => {
        // The aliases widen the generic pair only; a typo must still be caught by
        // the validator rather than silently resolving to something plausible.
        expect(resolvePlanPort('speaker', 'Audio Outt')).toBeUndefined();
        expect(resolvePlanPort('speaker', 'Sidechain')).toBeUndefined();
        expect(validatePlan(docPlan('Out', 'Sidechain'), createPlanLookups()).length).toBeGreaterThan(0);
    });
});
