/**
 * Command Registry (U19)
 *
 * A framework-free singleton that any module can register searchable
 * {@link Command}s into. The Ctrl/Cmd+K command bar reads from this registry.
 *
 * Design notes:
 * - No Zustand, no React — just a plain module-level store with a
 *   subscribe/getSnapshot pair so React can consume it via `useSyncExternalStore`
 *   (see {@link useCommands}) AND non-React code (or future AI-generated nodes)
 *   can register/unregister at any time without a hook.
 * - Commands are keyed by `id`; re-registering the same id replaces the prior
 *   entry (idempotent for hot-reload / re-mount). This is what lets U20's
 *   AI-generated nodes auto-appear later: they just call `register()` with the
 *   same registry — no restructuring required.
 * - Search is intentionally minimal: a single case-insensitive substring match
 *   over title + group + keywords. No second fuzzy library, no virtualization.
 *   (cmdk does its own filtering in the UI; {@link searchCommands} exists for
 *   non-UI callers and for the registry's own unit tests.)
 */

// ============================================================================
// Types
// ============================================================================

/**
 * A single searchable, runnable command surfaced in the Ctrl/Cmd+K bar.
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

// ============================================================================
// Store
// ============================================================================

// Insertion-ordered map of id -> Command.
const commands = new Map<string, Command>();

// Subscribers notified whenever the command set changes.
const listeners = new Set<() => void>();

// Cached immutable snapshot for useSyncExternalStore. Rebuilt on every mutation
// so that getSnapshot returns a referentially-stable value between changes
// (React bails out of re-renders when the reference is unchanged).
let snapshot: readonly Command[] = [];

function rebuildSnapshot(): void {
    snapshot = Object.freeze(Array.from(commands.values()));
}

function emit(): void {
    rebuildSnapshot();
    for (const listener of listeners) listener();
}

// ============================================================================
// Public API (framework-free)
// ============================================================================

/**
 * Register a command (or replace an existing one with the same id).
 *
 * Returns an unregister function so call sites — typically a React effect or a
 * module that owns the command's lifetime — can clean up:
 *
 * ```ts
 * useEffect(() => register({ id, title, group, run }), [...]);
 * ```
 */
export function register(command: Command): () => void {
    commands.set(command.id, command);
    emit();
    return () => unregister(command.id);
}

/**
 * Register many commands at once. Returns a single unregister function that
 * removes all of them. Useful for deriving a batch from a static table.
 */
export function registerAll(batch: readonly Command[]): () => void {
    for (const command of batch) commands.set(command.id, command);
    emit();
    return () => {
        let changed = false;
        for (const command of batch) {
            changed = commands.delete(command.id) || changed;
        }
        if (changed) emit();
    };
}

/** Remove a command by id. No-op if it isn't registered. */
export function unregister(id: string): void {
    if (commands.delete(id)) emit();
}

/** Subscribe to registry changes. Returns an unsubscribe function. */
export function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * Current immutable snapshot of all commands, in registration order.
 * Stable by reference between mutations (for `useSyncExternalStore`).
 */
export function getCommands(): readonly Command[] {
    return snapshot;
}

/** Look up a single command by id (mainly for tests / programmatic dispatch). */
export function getCommand(id: string): Command | undefined {
    return commands.get(id);
}

/**
 * Minimal case-insensitive substring search over title + group + keywords.
 *
 * An empty/blank query returns every command (registration order). This is the
 * non-UI search path; the command bar relies on cmdk's built-in filtering for
 * interactive matching, but both share the same registry as the source of truth.
 */
export function searchCommands(query: string): readonly Command[] {
    const q = query.trim().toLowerCase();
    if (q === '') return getCommands();
    return getCommands().filter((command) => {
        if (command.title.toLowerCase().includes(q)) return true;
        if (command.group.toLowerCase().includes(q)) return true;
        return (command.keywords ?? []).some((kw) => kw.toLowerCase().includes(q));
    });
}

/** Test-only: drop every registered command. Not used by app code. */
export function _resetForTests(): void {
    commands.clear();
    emit();
}
