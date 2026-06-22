import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nodeDefinitions } from '../registry';
import {
    allManifests,
    manifestFor,
    manifestFromDefinition,
    type PluginManifest,
} from '../manifest';
import type { NodeType } from '../types';

// Load the frozen v1 schema from the real file (single source of truth — the
// same schema the Rust PluginManifest mirrors). vitest runs from the repo root.
const SCHEMA_PATH = resolve(process.cwd(), 'schemas/oj-plugin-v1.json');
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as JsonSchema;

// ---------------------------------------------------------------------------
// A small JSON-Schema validator covering exactly the features oj-plugin-v1.json
// uses (object/array/string/number/integer, required, enum, minLength,
// minimum/maximum, additionalProperties:false, items). No external deps.
// ---------------------------------------------------------------------------

interface JsonSchema {
    type?: string;
    required?: string[];
    enum?: unknown[];
    properties?: Record<string, JsonSchema>;
    items?: JsonSchema;
    additionalProperties?: boolean;
    minLength?: number;
    minimum?: number;
    maximum?: number;
}

function validate(value: unknown, s: JsonSchema, path: string, errors: string[]): void {
    if (s.enum) {
        if (!s.enum.includes(value as never)) {
            errors.push(`${path}: ${JSON.stringify(value)} not in enum ${JSON.stringify(s.enum)}`);
        }
        return;
    }

    switch (s.type) {
        case 'object': {
            if (typeof value !== 'object' || value === null || Array.isArray(value)) {
                errors.push(`${path}: expected object`);
                return;
            }
            const obj = value as Record<string, unknown>;
            for (const key of s.required ?? []) {
                if (!(key in obj)) errors.push(`${path}: missing required "${key}"`);
            }
            if (s.additionalProperties === false) {
                for (const key of Object.keys(obj)) {
                    if (!(s.properties && key in s.properties)) {
                        errors.push(`${path}: additional property "${key}" not allowed`);
                    }
                }
            }
            for (const [key, sub] of Object.entries(s.properties ?? {})) {
                if (key in obj) validate(obj[key], sub, `${path}.${key}`, errors);
            }
            return;
        }
        case 'array': {
            if (!Array.isArray(value)) {
                errors.push(`${path}: expected array`);
                return;
            }
            if (s.items) value.forEach((v, i) => validate(v, s.items as JsonSchema, `${path}[${i}]`, errors));
            return;
        }
        case 'string': {
            if (typeof value !== 'string') {
                errors.push(`${path}: expected string`);
                return;
            }
            if (s.minLength !== undefined && value.length < s.minLength) {
                errors.push(`${path}: shorter than minLength ${s.minLength}`);
            }
            return;
        }
        case 'integer':
        case 'number': {
            if (typeof value !== 'number' || !Number.isFinite(value)) {
                errors.push(`${path}: expected number`);
                return;
            }
            if (s.type === 'integer' && !Number.isInteger(value)) {
                errors.push(`${path}: expected integer`);
            }
            if (s.minimum !== undefined && value < s.minimum) errors.push(`${path}: below minimum ${s.minimum}`);
            if (s.maximum !== undefined && value > s.maximum) errors.push(`${path}: above maximum ${s.maximum}`);
            return;
        }
        default:
            // No `type` constraint (e.g. the `kind` property declared only via
            // its enum) — nothing further to check here.
            return;
    }
}

function schemaErrors(manifest: PluginManifest): string[] {
    const errors: string[] = [];
    validate(manifest, schema, manifest.id, errors);
    return errors;
}

describe('PluginManifest derivation', () => {
    it('derives a schema-valid manifest for every nodeDefinition', () => {
        const types = Object.keys(nodeDefinitions) as NodeType[];
        expect(types.length).toBeGreaterThan(0);

        for (const type of types) {
            const manifest = manifestFor(type);
            const errors = schemaErrors(manifest);
            expect(errors, `manifest for "${type}" must be schema-valid`).toEqual([]);
        }
    });

    it('falls back to the inert Unknown manifest for stale runtime node types', () => {
        // Runtime data can outlive the TS union (e.g. old localStorage/workflows).
        // This must not crash NodeWrapper's AutoParamPanel fallback.
        const manifest = manifestFor('stale-node-type' as NodeType);
        expect(manifest.name).toBe('Unknown');
        expect(manifest.dsp).toBe('none');
    });

    it('covers every nodeDefinition exactly once', () => {
        const manifests = allManifests();
        const ids = manifests.map((m) => m.id);
        expect(ids.length).toBe(Object.keys(nodeDefinitions).length);
        expect(new Set(ids).size).toBe(ids.length); // unique
    });

    it('is a pure mapping from nodeDefinitions (no hand-duplicated lists)', () => {
        for (const def of Object.values(nodeDefinitions)) {
            const manifest = manifestFromDefinition(def);
            expect(manifest.id).toBe(`builtin.${def.type}`);
            expect(manifest.name).toBe(def.name);
        }
    });

    it('marks visual/routing nodes dsp:none and audio nodes dsp:builtin', () => {
        expect(manifestFor('multiplier').dsp).toBe('builtin');
        expect(manifestFor('multiplier').kind).toBe('Multiply');
        expect(manifestFor('speaker').dsp).toBe('builtin');
        expect(manifestFor('sampler').dsp).toBe('builtin');
        // Purely-visual / routing nodes have no audio kernel.
        expect(manifestFor('canvas-input').dsp).toBe('none');
        expect(manifestFor('container').dsp).toBe('none');
        expect(manifestFor('keyboard-visual').dsp).toBe('none');
    });

    it("derives manifest.ui from the single-source nodeDefinitions[type].ui (no magic count)", () => {
        // The manifest's `ui` is DERIVED from the def's `ui` field (the single
        // source of truth, kept in lockstep with NodeWrapper by the node-registry
        // gate). It must equal the def for EVERY type — a derivation, not a list.
        for (const [type, def] of Object.entries(nodeDefinitions)) {
            expect(manifestFor(type as NodeType).ui).toBe(def.ui);
        }
    });

    it('spot-checks bespoke (ui:react) vs free (ui:auto) per NodeWrapper reality', () => {
        // Rich bespoke surfaces (a NodeWrapper branch).
        expect(manifestFor('looper').ui).toBe('react');
        expect(manifestFor('effect').ui).toBe('react');
        expect(manifestFor('multiplier').ui).toBe('react');
        expect(manifestFor('sampler').ui).toBe('react');
        expect(manifestFor('container').ui).toBe('react'); // ContainerNode (schematic switch)
        expect(manifestFor('piano').ui).toBe('react'); // InstrumentNode (schematic switch)
        expect(manifestFor('recorder').ui).toBe('react'); // RecorderNode (content switch)
        // Free AutoParamPanel surfaces (NO NodeWrapper branch).
        expect(manifestFor('instrument').ui).toBe('auto'); // generic node falls through to AutoParamPanel
        expect(manifestFor('keyboard-key').ui).toBe('auto');
    });

    it('counts ports from defaultPorts', () => {
        // multiplier: in-1 + in-2 + out, all universal (counted as control for topology)
        const mul = manifestFor('multiplier');
        expect(mul.ports).toEqual({ audio_in: 0, audio_out: 0, control_in: 2, control_out: 1 });
    });

    it('derives numeric params from defaultData', () => {
        const sampler = manifestFor('sampler');
        const names = sampler.params.map((p) => p.name);
        expect(names).toContain('gain');
        expect(names).toContain('attack');
        // ids are stable, contiguous, and >= 0
        sampler.params.forEach((p, i) => expect(p.id).toBe(i));
        for (const p of sampler.params) {
            expect(p.default).toBeGreaterThanOrEqual(p.min);
            expect(p.default).toBeLessThanOrEqual(p.max);
        }
    });

    it('gives the multiplier an explicit factor decl matching the kernel param (SEAM-4)', () => {
        // The factor param carries the kernel's param id (0) and the seam's clamp
        // range: floored at 0, no musical ceiling (1e6 ≈ unbounded, per "0 to ∞").
        // emit clamps the live value, so a negative (phase-invert) can never reach
        // the kernel. The FACTOR_ACTIVE flag (id 1) is edge-derived in emit, not a
        // manifest decl, so the manifest carries exactly one param.
        const mul = manifestFor('multiplier');
        expect(mul.params).toHaveLength(1);
        const factor = mul.params[0];
        expect(factor.id).toBe(0);
        expect(factor.name).toBe('factor');
        expect(factor.min).toBe(0);
        expect(factor.max).toBe(1_000_000);
        expect(factor.default).toBe(1);
    });

    it('lowers the looper to the real Looper kernel (not Delay)', () => {
        // Regression guard for the SSOT drift: the looper node MUST lower to the
        // closed `Looper` primitive (the kernel id resolved at runtime is
        // `builtin.looper`). It was mismapped to `Delay`.
        expect(manifestFor('looper').kind).toBe('Looper');
    });

    it('gives the looper explicit kernel param ids (SEAM-4), not field-order ones', () => {
        // The kernel ids are LOOP_SECS=0, WET=1, DRY=2. Auto-derivation from
        // defaultData ORDER put `currentTime`(0) on WET, forcing the captured
        // loop to play back SILENT. These MUST be the explicit kernel contract.
        const looper = manifestFor('looper');
        const byId = new Map(looper.params.map((p) => [p.id, p]));
        expect(byId.get(0)?.name).toBe('duration'); // LOOP_SECS reads node.data.duration
        expect(byId.get(1)?.name).toBe('wet');
        expect(byId.get(1)?.default).toBe(1); // WET audible (was 0)
        expect(byId.get(2)?.name).toBe('dry');
        expect(byId.get(2)?.default).toBe(1);
        // currentTime must NOT leak in as a kernel param (it would clobber WET).
        expect(looper.params.some((p) => p.name === 'currentTime')).toBe(false);
    });
});
