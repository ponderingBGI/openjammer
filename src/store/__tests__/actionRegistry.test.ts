/**
 * Action registry (M2) tests — the NEW behavior layered onto the U19 registry.
 *
 * The original 14 back-compat tests live in `commandRegistry.test.ts` and stay
 * UNCHANGED. This file covers the M2 additions:
 *   (a) the SUPERSET invariant — every registered action is reachable from the
 *       palette (`(surfaces ?? ['palette']).includes('palette')`);
 *   (b) D1-A1 normalisation — a legacy zero-arg Command is wrapped into a runnable
 *       Action (targets ['global'], surfaces ['palette'], frecencyKey = id, and
 *       run(ctx) invokes the legacy run);
 *   (c) queryActions filtering — by target ∩ ctx.targetKinds, by enabled, and by
 *       surface.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    register,
    registerAll,
    getCommand,
    getCommands,
    queryActions,
    actionIncludesPalette,
    effectiveSurfaces,
    _resetForTests,
    type Action,
    type ActionCtx,
    type Command,
} from '../commandRegistry';
import { BROWSER_CAPABILITIES, DESKTOP_CAPABILITIES } from '../../engine/capabilities';

/** A bare palette ctx with the given target kinds (no real selection needed). */
function ctx(
    targetKinds: ActionCtx['targetKinds'],
    overrides: Partial<ActionCtx> = {},
): ActionCtx {
    return {
        caps: DESKTOP_CAPABILITIES,
        targetKinds,
        selectedIds: [],
        point: undefined,
        ...overrides,
    };
}

/** A minimal new-shape Action. */
function makeAction(id: string, overrides: Partial<Action> = {}): Action {
    return {
        id,
        title: overrides.title ?? id,
        group: overrides.group ?? 'Test',
        path: overrides.path,
        targets: overrides.targets ?? ['global'],
        surfaces: overrides.surfaces,
        keywords: overrides.keywords,
        frecencyKey: overrides.frecencyKey,
        enabled: overrides.enabled,
        run: overrides.run ?? (() => {}),
    };
}

describe('actionRegistry (M2)', () => {
    beforeEach(() => {
        _resetForTests();
    });

    describe('SUPERSET invariant', () => {
        it('every registered action includes "palette" in its effective surfaces', () => {
            registerAll([
                makeAction('a'), // surfaces omitted → defaults to ['palette']
                makeAction('b', { surfaces: ['palette'] }),
                makeAction('c', { surfaces: ['palette', 'menu'] }),
            ]);

            for (const action of getCommands()) {
                expect(actionIncludesPalette(action)).toBe(true);
            }
        });

        it('rejects an action whose surfaces opt OUT of palette', () => {
            expect(() =>
                register(makeAction('menu-only', { surfaces: ['menu'] })),
            ).toThrow(/palette/i);
        });

        it('effectiveSurfaces defaults to ["palette"] when omitted', () => {
            register(makeAction('a'));
            expect(effectiveSurfaces(getCommand('a')!)).toEqual(['palette']);
        });
    });

    describe('D1-A1 legacy normalisation', () => {
        it('wraps a legacy zero-arg Command into a runnable Action', () => {
            const run = vi.fn();
            const legacy: Command = {
                id: 'legacy.cmd',
                title: 'Legacy',
                group: 'App',
                run,
            };

            register(legacy);
            const stored = getCommand('legacy.cmd');

            expect(stored).toBeDefined();
            expect(stored!.targets).toEqual(['global']);
            expect(stored!.surfaces).toEqual(['palette']);
            expect(stored!.frecencyKey).toBe('legacy.cmd');

            // run(ctx) invokes the legacy zero-arg run.
            stored!.run(ctx(['global']));
            expect(run).toHaveBeenCalledOnce();
        });

        it('defaults a new-shape Action frecencyKey to its id', () => {
            register(makeAction('node.add.looper'));
            expect(getCommand('node.add.looper')!.frecencyKey).toBe('node.add.looper');
        });

        it('preserves an explicit frecencyKey on a new-shape Action', () => {
            register(makeAction('x', { frecencyKey: 'custom.key' }));
            expect(getCommand('x')!.frecencyKey).toBe('custom.key');
        });
    });

    describe('queryActions filtering', () => {
        it('filters by target ∩ ctx.targetKinds', () => {
            registerAll([
                makeAction('g', { targets: ['global'] }),
                makeAction('n', { targets: ['node'] }),
                makeAction('s', { targets: ['selection'] }),
            ]);

            // Context carries only 'global' + 'selection'.
            const result = queryActions(ctx(['global', 'selection']), {
                surface: 'palette',
            });
            expect(result.map((a) => a.id).sort()).toEqual(['g', 's']);
        });

        it('drops actions whose enabled(ctx) is false', () => {
            registerAll([
                makeAction('on', { enabled: () => true }),
                makeAction('off', { enabled: () => false }),
                makeAction('agent', {
                    enabled: (c) => c.caps.agent !== 'none',
                }),
            ]);

            const desktop = queryActions(ctx(['global']), { surface: 'palette' });
            expect(desktop.map((a) => a.id).sort()).toEqual(['agent', 'on']);

            const browser = queryActions(
                ctx(['global'], { caps: BROWSER_CAPABILITIES }),
                { surface: 'palette' },
            );
            expect(browser.map((a) => a.id).sort()).toEqual(['on']);
        });

        it('filters by surface (menu actions excluded from palette unless opted in)', () => {
            registerAll([
                makeAction('palette-only', { surfaces: ['palette'] }),
                makeAction('both', { surfaces: ['palette', 'menu'] }),
            ]);

            const palette = queryActions(ctx(['global']), { surface: 'palette' });
            expect(palette.map((a) => a.id).sort()).toEqual(['both', 'palette-only']);

            const menu = queryActions(ctx(['global']), { surface: 'menu' });
            expect(menu.map((a) => a.id)).toEqual(['both']);
        });

        it('applies an optional substring query over title/group/keywords', () => {
            registerAll([
                makeAction('looper', { title: 'Add Looper', keywords: ['loop'] }),
                makeAction('piano', { title: 'Add Piano', group: 'Instruments' }),
            ]);

            const result = queryActions(ctx(['global']), {
                surface: 'palette',
                query: 'loop',
            });
            expect(result.map((a) => a.id)).toEqual(['looper']);
        });

        it('returns registration order (no ranking)', () => {
            registerAll([
                makeAction('c'),
                makeAction('a'),
                makeAction('b'),
            ]);
            const result = queryActions(ctx(['global']), { surface: 'palette' });
            expect(result.map((a) => a.id)).toEqual(['c', 'a', 'b']);
        });
    });

    describe('M4 unification (palette SUPERSET, menu SUBSET)', () => {
        // The right-click menu's context: it carries a canvas point + selection.
        const menuCtx = ctx(['global', 'canvasPoint', 'selection']);
        // The palette's context: global + selection (no canvas point).
        const paletteCtx = ctx(['global', 'selection']);

        it('a node-add Action on both surfaces appears in BOTH queries', () => {
            registerAll([
                makeAction('node.add.looper', {
                    title: 'Add Looper',
                    group: 'Routing',
                    path: ['Routing'],
                    targets: ['global', 'canvasPoint', 'selection'],
                    surfaces: ['palette', 'menu'],
                }),
            ]);

            const inMenu = queryActions(menuCtx, { surface: 'menu' });
            const inPalette = queryActions(paletteCtx, { surface: 'palette' });

            expect(inMenu.map((a) => a.id)).toContain('node.add.looper');
            expect(inPalette.map((a) => a.id)).toContain('node.add.looper');
        });

        it('an app Action (surfaces ["palette"]) appears ONLY in the palette', () => {
            registerAll([
                makeAction('app.settings', {
                    title: 'Open Settings',
                    group: 'App',
                    surfaces: ['palette'],
                }),
                makeAction('node.add.looper', {
                    title: 'Add Looper',
                    group: 'Routing',
                    path: ['Routing'],
                    targets: ['global', 'canvasPoint', 'selection'],
                    surfaces: ['palette', 'menu'],
                }),
            ]);

            const menu = queryActions(menuCtx, { surface: 'menu' }).map((a) => a.id);
            const palette = queryActions(paletteCtx, { surface: 'palette' }).map((a) => a.id);

            // The menu is the curated SUBSET: no app action.
            expect(menu).not.toContain('app.settings');
            expect(menu).toContain('node.add.looper');
            // The palette is the strict SUPERSET: both present.
            expect(palette).toContain('app.settings');
            expect(palette).toContain('node.add.looper');
        });

        it('preserves the optional `path` for menu nesting (palette ignores it)', () => {
            register(
                makeAction('node.add.keys', {
                    title: 'Add Keys',
                    group: 'Instruments',
                    path: ['Instruments'],
                    surfaces: ['palette', 'menu'],
                }),
            );

            const stored = queryActions(menuCtx, { surface: 'menu' })[0];
            expect(stored.path).toEqual(['Instruments']);
        });
    });
});
