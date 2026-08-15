/**
 * Pi-extension tool-parity gate. The host wires a tool in three places (tools.ts,
 * bridgeListener, agentSessionStore) — but the MODEL only learns a tool exists when
 * the Pi extension (pi-openjammer-graph/index.ts) DECLARES it. This is the exact gap
 * that left describe_arrangement / edit_timeline unreachable for the agent despite the
 * host being fully wired. This gate fails when any host AGENT_TOOL_NAME is not declared
 * to the model, so "the agent can't call the tool we built" can never recur silently.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TOOL_CATALOGUE } from '../tools';
import { EDIT_OPS } from '../../song/ops';

const EXT_PATH = resolve(process.cwd(), 'pi-openjammer-graph/index.ts');

describe('Pi extension ↔ host tool parity', () => {
    const src = readFileSync(EXT_PATH, 'utf8');
    // Every tool the extension registers carries a `name: '<tool>'` literal.
    const registered = new Set(
        [...src.matchAll(/name:\s*'([a-z_]+)'/g)].map((m) => m[1]),
    );

    // The model-facing surface is TOOL_CATALOGUE (the catalogue Pi is told about) — a
    // superseded host tool kept only for back-compat (e.g. author_dsp_node, replaced by
    // author_code_node) is deliberately NOT advertised, so it need not be declared.
    it('declares every ADVERTISED tool (TOOL_CATALOGUE) to the model', () => {
        const missing = TOOL_CATALOGUE.map((t) => t.name).filter((n) => !registered.has(n));
        expect(
            missing,
            `pi-openjammer-graph/index.ts does not register: ${missing.join(', ')} — ` +
                'the agent cannot call a catalogued host tool the extension never declares.',
        ).toEqual([]);
    });

    it('declares every edit_timeline operation to the model', () => {
        const missing = EDIT_OPS.filter((op) => !src.includes(`'${op}'`));
        expect(missing).toEqual([]);
    });
});
