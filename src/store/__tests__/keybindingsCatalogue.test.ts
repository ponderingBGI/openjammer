/**
 * The keybindings catalogue must be COMPLETE.
 *
 * `keybindingActions` is what Settings → Keybindings renders, and it is also
 * what `getConflictingActions` reasons over. An action that a binding set
 * registers at runtime but that is missing from the catalogue is invisible: it
 * cannot be seen, cannot be rebound, and — worse — cannot be detected as the
 * thing a user's new shortcut just collided with. So this test reads the source
 * of every file that registers binding entries and asserts each id it finds is
 * in the catalogue.
 *
 * The extraction is deliberately mechanical and is documented inline; it is a
 * regex over source text, not a runtime registry, because the binding sets are
 * built inside components from live store closures and cannot be imported here.
 * It under-reports rather than over-reports, so a green run is a floor, not a
 * ceiling — but it DOES fail the moment someone adds a plain
 * `actionId: 'foo.bar'` without cataloguing it, which is the mistake that
 * actually happens.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { keybindingActions } from '../keybindingsStore';

/** Every file that constructs `BindingSet` entries. */
const SOURCES = [
    'src/App.tsx',
    'src/components/Arrangement/ArrangementSurface.tsx',
    'src/components/PianoRoll/PianoRoll.tsx',
    'src/components/DevLog/DevLogPanel.tsx',
    'src/components/AudioHealth/AudioHealthPanel.tsx',
    'src/components/Plugins/PluginsPanel.tsx',
];

/**
 * Ids produced by a template literal or an `Object.entries(...)` map, which no
 * regex can recover from source. Each is listed with the expression that mints
 * it so the mapping stays auditable.
 */
const GENERATED: Record<string, string[]> = {
    // PianoRoll.tsx — `pianoroll.step.${key}` over the twelve keybed letters.
    'pianoroll.step.<key>': ['a', 'w', 's', 'e', 'd', 'f', 't', 'g', 'y', 'h', 'u', 'j'].map(
        (key) => `pianoroll.step.${key}`,
    ),
    // PianoRoll.tsx — `pianoroll.tool.${nextTool}` over the four tool letters.
    'pianoroll.tool.<tool>': ['select', 'draw', 'erase', 'knife'].map(
        (tool) => `pianoroll.tool.${tool}`,
    ),
    // App.tsx — `mode.${index + 1}` for the nine mode slots.
    'mode.<n>': Array.from({ length: 9 }, (_, index) => `mode.${index + 1}`),
};

function read(relative: string): string {
    return readFileSync(join(process.cwd(), relative), 'utf8');
}

/**
 * Pull action ids out of one source file:
 *   1. `actionId: 'x'`                       — a plain entry
 *   2. `[['x', …], ['y', …]] as const).map(` — a tuple-map whose FIRST element
 *      is the id (the shape every timeline entry group uses)
 *   3. `'x': { key: … }`                     — the piano roll's `canonical` map
 */
function idsIn(source: string): string[] {
    const found = new Set<string>();
    for (const match of source.matchAll(/actionId:\s*'([^']+)'/g)) found.add(match[1]!);
    for (const match of source.matchAll(/\[\s*'((?:arrangement|pianoroll)\.[a-zA-Z0-9.]+)'\s*,/g)) {
        found.add(match[1]!);
    }
    for (const match of source.matchAll(/'((?:arrangement|pianoroll)\.[a-zA-Z0-9.]+)':\s*\{\s*key:/g)) {
        found.add(match[1]!);
    }
    return [...found];
}

describe('keybindings catalogue completeness', () => {
    const catalogued = new Set(keybindingActions.map((action) => action.id));

    it('finds a non-trivial number of registered ids (the scan itself works)', () => {
        const scanned = SOURCES.flatMap((file) => idsIn(read(file)));
        // If a refactor changes how binding sets are written, this guard fails
        // loudly rather than letting the completeness check silently pass on an
        // empty list.
        expect(scanned.length).toBeGreaterThan(60);
    });

    it('catalogues every action id registered by a binding set', () => {
        const missing = SOURCES.flatMap((file) =>
            idsIn(read(file))
                .filter((id) => !catalogued.has(id))
                .map((id) => `${id} (${file})`),
        );
        expect(missing).toEqual([]);
    });

    it('catalogues every template-generated action id', () => {
        for (const [expression, ids] of Object.entries(GENERATED)) {
            const missing = ids.filter((id) => !catalogued.has(id));
            expect({ expression, missing }).toEqual({ expression, missing: [] });
        }
    });

    it('has a unique id and a unique label for every action', () => {
        const ids = keybindingActions.map((action) => action.id);
        expect(ids.length).toBe(new Set(ids).size);

        // Labels are the ONLY thing shown to a player. Two actions sharing a
        // label is a bug you only notice when you rebind the wrong one.
        const labels = keybindingActions.map((action) => action.label);
        const duplicates = labels.filter((label, index) => labels.indexOf(label) !== index);
        expect(duplicates).toEqual([]);
    });

    it('gives every timeline action a surface, so conflicts stay scoped', () => {
        const unscoped = keybindingActions
            .filter((action) => action.id.startsWith('arrangement.') || action.id.startsWith('pianoroll.'))
            .filter((action) => action.scope !== 'surface' || !action.surface)
            .map((action) => action.id);
        expect(unscoped).toEqual([]);
    });
});
