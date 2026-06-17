/**
 * D1 — PrimitiveKind SSOT set-equality gate (TS side).
 *
 * `schemas/primitive-kinds.json` is the canonical flat list of the closed
 * PrimitiveKind set. Every other declaration of that set must equal it, or the
 * Rust↔TS↔schema seam has silently drifted — the exact failure that left the
 * looper mislabeled (it was missing from one of two TS declarations). This test
 * pins the TWO node-readable declarations against the SSOT list:
 *   • the TS `PRIMITIVE_KINDS` tuple (which the `PrimitiveKind` type derives from), and
 *   • the `kind` enum in `schemas/oj-plugin-v1.json`.
 * The THIRD declaration — the Rust `ojproto::PrimitiveKind` enum — is pinned to
 * the same list by `primitive_kind_matches_ssot_list` in `wire_shapes.rs` (Rust
 * cannot be read from here), so all three agree transitively.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRIMITIVE_KINDS } from '@openjammer/oj-protocol';

function readJson(rel: string): unknown {
    return JSON.parse(readFileSync(resolve(process.cwd(), rel), 'utf-8'));
}

const sortedUnique = (xs: readonly string[]): string[] => [...new Set(xs)].sort();

describe('PrimitiveKind SSOT set-equality (D1)', () => {
    const ssot = readJson('schemas/primitive-kinds.json') as { kinds: string[] };

    it('the canonical SSOT list has no duplicates', () => {
        expect(new Set(ssot.kinds).size).toBe(ssot.kinds.length);
    });

    it('TS PRIMITIVE_KINDS equals the canonical SSOT list', () => {
        expect(sortedUnique(PRIMITIVE_KINDS)).toEqual(sortedUnique(ssot.kinds));
    });

    it('the oj-plugin-v1 schema `kind` enum equals the canonical SSOT list', () => {
        const schema = readJson('schemas/oj-plugin-v1.json') as {
            properties: { kind: { enum: string[] } };
        };
        expect(sortedUnique(schema.properties.kind.enum)).toEqual(sortedUnique(ssot.kinds));
    });
});
