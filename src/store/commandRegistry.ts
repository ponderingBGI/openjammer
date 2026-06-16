/**
 * Action Registry (U19 → M2)
 *
 * A framework-free singleton that any module can register searchable, runnable
 * {@link Action}s into. The Ctrl/Cmd+K command bar (and, in a LATER milestone,
 * the right-click context menu) read from this ONE registry.
 *
 * M2 evolves the original U19 `Command` into a richer {@link Action} while
 * keeping FULL back-compat:
 * - `Command` survives as a LEGACY alias (a zero-arg `run()` entry). Today's
 *   callers — `useCommandSources`, `agentSessionStore` (`ai.dsp.*`) and the
 *   `CommandBar` — all still pass that shape, so {@link register}/{@link registerAll}
 *   NORMALISE a legacy `Command` into an `Action` (D1-A1): `run: (ctx) => legacy.run()`,
 *   `targets: ['global']`, `surfaces: ['palette']`, `frecencyKey: legacy.id`.
 * - The store internally holds normalised `Action`s only. Everything that read
 *   the old shape (`id`/`title`/`group`/`keywords`/`run`) keeps working because
 *   an `Action` is a structural superset (its `run` simply takes an optional
 *   {@link ActionCtx}).
 *
 * Design notes (unchanged from U19):
 * - No Zustand, no React — just a module-level store with a subscribe/getSnapshot
 *   pair so React can consume it via `useSyncExternalStore` AND non-React code
 *   (or AI-generated nodes) can register/unregister at any time without a hook.
 * - Entries are keyed by `id`; re-registering the same id replaces the prior
 *   entry (idempotent for hot-reload / re-mount).
 * - {@link searchCommands} is the minimal case-insensitive substring search kept
 *   for back-compat / non-UI callers and the registry's own unit tests. The
 *   palette's FUZZY scoring + ordering is owned by the CommandBar (see
 *   `paletteScore`); {@link queryActions} only FILTERS (by target ∩ context, by
 *   `enabled`, by surface, by optional substring) and returns registration order.
 *
 * Type-only imports keep this module framework-free: no React, no Zustand.
 */

import type { EngineCapabilities } from '../engine/capabilities';
import type { Position, GraphNode } from '../engine/types';

// ============================================================================
// Types
// ============================================================================

/**
 * What an action targets — the kind(s) of thing it can act on. The palette
 * always carries `'global'` + `'selection'` (and `'node'` when exactly one node
 * is selected); the context menu (M4) will additionally carry point/port/etc.
 */
export type TargetKind =
    | 'global'
    | 'canvasPoint'
    | 'selection'
    | 'node'
    | 'port'
    | 'connection';

/** Which surface(s) an action is offered on. Defaults to `['palette']`. */
export type Surface = 'palette' | 'menu';

/**
 * The context an action is filtered + run against. Built ONCE per surface from
 * the live capability seam + current selection (see `actionContext.ts` for the
 * palette builder). `run` handlers must RE-READ the store by id for mutations —
 * the snapshot here is for display / `enabled` gating only.
 */
export interface ActionCtx {
    /** The platform capability ceiling for this session (the ONE seam). */
    caps: EngineCapabilities;
    /** Canvas point, when the surface has one (context menu). Palette: undefined. */
    point?: Position;
    /** The target kinds present in this context (action must intersect these). */
    targetKinds: readonly TargetKind[];
    /** Ids of the currently-selected nodes (for `'selection'` actions). */
    selectedIds: readonly string[];
    /** The single selected node, when exactly one is selected. */
    node?: GraphNode;
    /** A port reference, when the context targets a port (context menu). */
    portRef?: { nodeId: string; portId: string };
    /** A connection id, when the context targets a connection (context menu). */
    connectionId?: string;
}

/**
 * A single searchable, runnable action surfaced in the Ctrl/Cmd+K bar (and,
 * later, the context menu). Structural superset of the legacy {@link Command}.
 */
export interface Action {
    /** Stable unique id. Re-registering the same id replaces the entry. */
    id: string;
    /** Primary display label, e.g. "Add Looper". */
    title: string;
    /** Bucket label used to group results, e.g. "Instruments" or "App". */
    group: string;
    /**
     * Nested-menu placement for the right-click context menu (M4), e.g.
     * `['Instruments']`. The context menu GROUPS by `path[0]` to rebuild the
     * friendly nested-category UX; the palette IGNORES this (it groups by
     * `group` and scores fuzzily). Legacy commands leave it `undefined` on
     * normalisation, so they simply fall back to `group` in the menu.
     */
    path?: readonly string[];
    /** Extra terms that should match the action but aren't shown as the title. */
    keywords?: string[];
    /** Stable key for frecency learning (defaults to `id` on normalisation). */
    frecencyKey?: string;
    /** Target kinds this action applies to (must intersect the context's). */
    targets: readonly TargetKind[];
    /**
     * Surfaces this action is offered on. Defaults to `['palette']` when omitted.
     * You can opt INTO `'menu'`, never OUT of `'palette'` — the SUPERSET
     * invariant: every registered action is reachable from the palette.
     */
    surfaces?: readonly Surface[];
    /** Optional gate: when it returns false the action is hidden in that context. */
    enabled?(ctx: ActionCtx): boolean;
    /**
     * Invoked when the user selects the action, with the surface's context.
     *
     * `ctx` is OPTIONAL so the legacy zero-arg call site (`getCommand(id)?.run()`,
     * still used by tests and programmatic dispatch) keeps type-checking — the
     * normalised legacy wrapper ignores it, and surface callers always pass one.
     */
    run(ctx?: ActionCtx): void;
}

/**
 * The LEGACY U19 command shape: a zero-arg `run()`. Kept as an alias + accepted
 * at the registration API; normalised into an {@link Action} internally (D1-A1).
 */
export interface Command {
    /** Stable unique id. Re-registering the same id replaces the entry. */
    id: string;
    /** Primary display label, e.g. "Add Looper". */
    title: string;
    /** Bucket label used to group results, e.g. "Instruments" or "App". */
    group: string;
    /** Invoked when the user selects the command. */
    run: () => void;
    /** Extra terms that should match the command but aren't shown as the title. */
    keywords?: string[];
}

/** Either the new {@link Action} shape or the legacy {@link Command} shape. */
export type RegisterInput = Action | Command;

// ============================================================================
// Normalisation (D1-A1)
// ============================================================================

/**
 * Type guard: is this input already a (new-shape) {@link Action}? An `Action`
 * declares `targets`; the legacy {@link Command} does not. We test on `targets`
 * specifically because `run` exists on both shapes.
 */
function isAction(input: RegisterInput): input is Action {
    return Array.isArray((input as Action).targets);
}

/**
 * Normalise any {@link RegisterInput} into a stored {@link Action}.
 *
 * - A new-shape `Action` is taken as-is, with `frecencyKey` defaulting to `id`
 *   and `surfaces` left undefined (treated as `['palette']` by readers). The
 *   SUPERSET invariant is enforced: a passed `surfaces` MUST include `'palette'`.
 * - A legacy `Command` is wrapped: `run: (ctx) => legacy.run()`,
 *   `targets: ['global']`, `surfaces: ['palette']`, `frecencyKey: legacy.id`.
 */
function normalize(input: RegisterInput): Action {
    if (isAction(input)) {
        const surfaces = input.surfaces;
        if (surfaces && !surfaces.includes('palette')) {
            throw new Error(
                `Action "${input.id}" violates the palette SUPERSET invariant: ` +
                    `surfaces must include 'palette' (got ${JSON.stringify(surfaces)}).`,
            );
        }
        return {
            ...input,
            frecencyKey: input.frecencyKey ?? input.id,
        };
    }
    // Legacy zero-arg Command → runnable Action.
    const legacy = input;
    return {
        id: legacy.id,
        title: legacy.title,
        group: legacy.group,
        keywords: legacy.keywords,
        frecencyKey: legacy.id,
        targets: ['global'],
        surfaces: ['palette'],
        run: (_ctx: ActionCtx) => legacy.run(),
    };
}

/**
 * The effective surfaces for an action — `surfaces ?? ['palette']`. Centralised
 * so the SUPERSET invariant + surface filtering share one definition.
 */
export function effectiveSurfaces(action: Action): readonly Surface[] {
    return action.surfaces ?? ['palette'];
}

/**
 * SUPERSET invariant helper (used by the unit test): every registered action is
 * reachable from the palette, i.e. `(surfaces ?? ['palette']).includes('palette')`.
 */
export function actionIncludesPalette(action: Action): boolean {
    return effectiveSurfaces(action).includes('palette');
}

// ============================================================================
// Store
// ============================================================================

// Insertion-ordered map of id -> normalised Action.
const actions = new Map<string, Action>();

// Subscribers notified whenever the action set changes.
const listeners = new Set<() => void>();

// Cached immutable snapshot for useSyncExternalStore. Rebuilt on every mutation
// so that getSnapshot returns a referentially-stable value between changes
// (React bails out of re-renders when the reference is unchanged).
let snapshot: readonly Action[] = [];

function rebuildSnapshot(): void {
    snapshot = Object.freeze(Array.from(actions.values()));
}

function emit(): void {
    rebuildSnapshot();
    for (const listener of listeners) listener();
}

// ============================================================================
// Public API (framework-free)
// ============================================================================

/**
 * Register an action (or a legacy command), replacing any existing entry with
 * the same id. Accepts either shape; stores a normalised {@link Action}.
 *
 * Returns an unregister function so call sites — typically a React effect or a
 * module that owns the entry's lifetime — can clean up:
 *
 * ```ts
 * useEffect(() => register({ id, title, group, run }), [...]);
 * ```
 */
export function register(input: RegisterInput): () => void {
    const action = normalize(input);
    actions.set(action.id, action);
    emit();
    return () => unregister(action.id);
}

/**
 * Register many entries at once (each either {@link Action} or legacy
 * {@link Command}). Returns a single unregister function that removes all of
 * them. Useful for deriving a batch from a static table.
 */
export function registerAll(batch: readonly RegisterInput[]): () => void {
    const normalized = batch.map(normalize);
    for (const action of normalized) actions.set(action.id, action);
    emit();
    return () => {
        let changed = false;
        for (const action of normalized) {
            changed = actions.delete(action.id) || changed;
        }
        if (changed) emit();
    };
}

/** Remove an action by id. No-op if it isn't registered. */
export function unregister(id: string): void {
    if (actions.delete(id)) emit();
}

/** Subscribe to registry changes. Returns an unsubscribe function. */
export function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * Current immutable snapshot of all actions, in registration order.
 * Stable by reference between mutations (for `useSyncExternalStore`).
 */
export function getCommands(): readonly Action[] {
    return snapshot;
}

/** Look up a single action by id (mainly for tests / programmatic dispatch). */
export function getCommand(id: string): Action | undefined {
    return actions.get(id);
}

/**
 * Filter the registry for a given context + surface (M2). This ONLY filters —
 * the palette's fuzzy scoring/ordering is owned by the CommandBar; the order
 * here is registration order.
 *
 * An action survives when:
 * 1. its `targets` intersect `ctx.targetKinds` (non-empty intersection), AND
 * 2. `enabled(ctx)` is not explicitly false, AND
 * 3. `(surfaces ?? ['palette']).includes(opts.surface)`, AND
 * 4. when `opts.query` is non-blank, a case-insensitive substring of it matches
 *    title / group / keywords (a placeholder until the caller applies fuzzy
 *    scoring; non-UI callers get sensible filtering for free).
 */
export function queryActions(
    ctx: ActionCtx,
    opts: { surface: Surface; query?: string },
): readonly Action[] {
    const targetSet = new Set(ctx.targetKinds);
    const q = (opts.query ?? '').trim().toLowerCase();

    return getCommands().filter((action) => {
        // (1) target ∩ context
        if (!action.targets.some((t) => targetSet.has(t))) return false;
        // (2) enabled gate
        if (action.enabled && action.enabled(ctx) === false) return false;
        // (3) surface
        if (!effectiveSurfaces(action).includes(opts.surface)) return false;
        // (4) optional substring query
        if (q !== '') {
            const inTitle = action.title.toLowerCase().includes(q);
            const inGroup = action.group.toLowerCase().includes(q);
            const inKw = (action.keywords ?? []).some((kw) =>
                kw.toLowerCase().includes(q),
            );
            if (!inTitle && !inGroup && !inKw) return false;
        }
        return true;
    });
}

/**
 * Minimal case-insensitive substring search over title + group + keywords.
 *
 * An empty/blank query returns every action (registration order). This is the
 * non-UI search path kept for back-compat; the command bar owns interactive
 * fuzzy matching/ordering, but both share the same registry as the source of
 * truth. NOT deleted by M2 (per the milestone scope).
 */
export function searchCommands(query: string): readonly Action[] {
    const q = query.trim().toLowerCase();
    if (q === '') return getCommands();
    return getCommands().filter((action) => {
        if (action.title.toLowerCase().includes(q)) return true;
        if (action.group.toLowerCase().includes(q)) return true;
        return (action.keywords ?? []).some((kw) => kw.toLowerCase().includes(q));
    });
}

/** Test-only: drop every registered action. Not used by app code. */
export function _resetForTests(): void {
    actions.clear();
    emit();
}
