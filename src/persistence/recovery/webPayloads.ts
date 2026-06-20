/**
 * Browser payload adapter for boot recovery (Track B P0).
 *
 * Wires the generic {@link PayloadSource} to the browser's localStorage tier:
 *   • The PRIMARY recoverable payload is the emergency backup that App writes on
 *     `beforeunload` — the one that, today, is written but NEVER read (so a crash
 *     loses unsaved work even though it survived on disk). We resurrect it here.
 *   • The last autosaved graph (`openjammer-graph-v2`) is already auto-hydrated
 *     into the store by zustand-persist, so it is the implicit baseline a 'clean'
 *     recovery falls back to — we deliberately do NOT couple to its internal
 *     persist shape.
 *
 * Quarantine MOVES a suspect blob aside (never deletes user work) so it is no
 * longer auto-listed but can still be recovered on demand from Safe Mode.
 *
 * The OPFS / project-folder tiers (true crash durability) are Track B P1; this
 * adapter is the localStorage-tier P0 that makes crashes recoverable today.
 */

import type { GraphNode, Connection } from '../../engine/types';
import { logWarn } from '../../utils/log';
import type { PayloadSource, RecoverablePayload } from './recover';

export const EMERGENCY_KEY = 'openjammer-emergency-backup';
const QUARANTINE_INDEX_KEY = 'openjammer-recovery-quarantine';
const QUARANTINE_DATA_PREFIX = 'openjammer-recovery-quarantine.data:';

/** The on-disk shape App writes on `beforeunload`. */
export interface EmergencyBackup {
    v?: number;
    timestamp: number;
    projectName?: string | null;
    nodes: unknown[];
    edges: unknown[];
}

/** A validated graph ready for `graphStore.loadGraph(nodes, connections)`. */
export interface RecoveredGraph {
    nodes: GraphNode[];
    connections: Connection[];
}

function safeGet(key: string): string | null {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}
function safeSet(key: string, value: string): void {
    try {
        localStorage.setItem(key, value);
    } catch {
        /* private mode / quota — recovery degrades, never throws */
    }
}
function safeRemove(key: string): void {
    try {
        localStorage.removeItem(key);
    } catch {
        /* ignore */
    }
}

function readQuarantineIndex(): Array<{ id: string; bootSeq: number; reason: string }> {
    const raw = safeGet(QUARANTINE_INDEX_KEY);
    if (raw === null) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

/** Stable id for the emergency backup, keyed by its content timestamp. */
function emergencyId(b: EmergencyBackup): string {
    return `emergency:${b.timestamp}`;
}

function parseEmergency(raw: string | null): EmergencyBackup | null {
    if (raw === null) return null;
    try {
        const obj = JSON.parse(raw);
        if (typeof obj !== 'object' || obj === null) return null;
        const b = obj as Record<string, unknown>;
        if (!Array.isArray(b.nodes) || !Array.isArray(b.edges)) return null;
        return {
            v: typeof b.v === 'number' ? b.v : undefined,
            timestamp: typeof b.timestamp === 'number' ? b.timestamp : 0,
            projectName: typeof b.projectName === 'string' ? b.projectName : null,
            nodes: b.nodes,
            edges: b.edges,
        };
    } catch {
        return null;
    }
}

/**
 * Fail-closed validation: a recovered graph must be arrays of id-bearing nodes
 * and edges, or we reject it (→ quarantine → the user keeps their last good
 * state). Deliberately structural, not a deep schema check — the graph store's
 * own migrations handle field-level evolution; this only blocks outright garbage.
 */
export function validateRecoveredGraph(b: EmergencyBackup): RecoveredGraph | null {
    const nodesOk =
        b.nodes.every((n) => typeof n === 'object' && n !== null && typeof (n as { id?: unknown }).id === 'string');
    const edgesOk =
        b.edges.every((e) => typeof e === 'object' && e !== null && typeof (e as { id?: unknown }).id === 'string');
    if (!nodesOk || !edgesOk) return null;
    return { nodes: b.nodes as GraphNode[], connections: b.edges as Connection[] };
}

/** The browser boot-recovery payload source. */
export class WebPayloadSource implements PayloadSource<EmergencyBackup> {
    list(): RecoverablePayload<EmergencyBackup>[] {
        const backup = parseEmergency(safeGet(EMERGENCY_KEY));
        if (!backup) return [];
        const id = emergencyId(backup);
        if (readQuarantineIndex().some((q) => q.id === id)) return [];
        return [{ id, load: () => backup }];
    }

    quarantine(id: string, info: { bootSeq: number; reason: string }): void {
        // MOVE the live blob aside (never delete) so it is no longer auto-listed
        // but can still be recovered on demand from Safe Mode.
        const live = safeGet(EMERGENCY_KEY);
        if (live !== null && emergencyIdMatches(live, id)) {
            safeSet(QUARANTINE_DATA_PREFIX + id, live);
            safeRemove(EMERGENCY_KEY);
        }
        const index = readQuarantineIndex().filter((q) => q.id !== id);
        index.push({ id, bootSeq: info.bootSeq, reason: info.reason });
        safeSet(QUARANTINE_INDEX_KEY, JSON.stringify(index));
        logWarn('recovery', 'quarantined a suspect recovery payload (preserved, not deleted)', {
            id,
            reason: info.reason,
        });
    }
}

function emergencyIdMatches(rawLive: string, id: string): boolean {
    const b = parseEmergency(rawLive);
    return b !== null && emergencyId(b) === id;
}

/**
 * Write the default-on emergency backup. Unlike today's folder-gated write, this
 * persists a fresh unsaved jam too, so a crash with no project folder still
 * recovers (the localStorage tier of "default-on durability").
 */
export function writeEmergencyBackup(graph: {
    nodes: unknown[];
    edges: unknown[];
    projectName?: string | null;
    now?: number;
}): void {
    const payload: EmergencyBackup = {
        v: 1,
        timestamp: graph.now ?? Date.now(),
        projectName: graph.projectName ?? null,
        nodes: graph.nodes,
        edges: graph.edges,
    };
    safeSet(EMERGENCY_KEY, JSON.stringify(payload));
}

/** Clear the live emergency backup (after a clean save / settle). */
export function clearEmergencyBackup(): void {
    safeRemove(EMERGENCY_KEY);
}

/** Restore a previously quarantined payload (the "Recover anyway" action). */
export function loadQuarantined(id: string): RecoveredGraph | null {
    const b = parseEmergency(safeGet(QUARANTINE_DATA_PREFIX + id));
    if (!b) return null;
    return validateRecoveredGraph(b);
}

/** Whether any quarantined suspect exists (for the Safe-Mode "Recover anyway"). */
export function newestQuarantinedId(): string | null {
    const index = readQuarantineIndex();
    if (index.length === 0) return null;
    return index.reduce((a, b) => (b.bootSeq >= a.bootSeq ? b : a)).id;
}
