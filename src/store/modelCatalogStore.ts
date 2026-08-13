/**
 * Model + slash-command catalog cache — the "instant /models, instant /" seam.
 *
 * The model list and the dynamic Pi slash commands both cost a warm-child RPC to
 * fetch, which is why they used to feel slow on open ("Loading…" / "Pi commands
 * load after the agent starts"). This store persists the last-known catalogs so
 * the pickers render SYNCHRONOUSLY from known state and revalidate underneath
 * (stale-while-revalidate) — code-value #9 made literal for the AI surface.
 *
 * Two disciplines keep "instant" from ever producing a WRONG result:
 *   1. Each catalog is keyed by an OPAQUE {@link catalogFingerprint}: it changes
 *      when the configured providers / base URLs / custom models change (the
 *      inputs that change what Pi can offer), so a stale catalog from a removed
 *      provider is auto-discarded. The fingerprint never embeds a raw key (it
 *      keys on WHICH providers are configured, not the secret) and is hashed, so
 *      the persisted buster leaks no provider topology into localStorage.
 *   2. Models persist as slim identity blobs only (provider/id/name/reasoning) —
 *      never base URLs or `api`.
 *
 * Reads still filter by the live configured-provider set at the call site, so a
 * provider the user has since removed is never shown even if it sits in the blob.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PiModel, PiSlashCommand } from '../ai/piSessions';

export interface CatalogFingerprintInput {
    providerKeys?: Record<string, string>;
    providerBaseUrls?: Record<string, string>;
    providerCustomModels?: Record<string, string[]>;
    provider?: string;
}

/** FNV-1a 32-bit → base36. Opaque + cheap; only needs to be stable, not secure. */
function hashString(s: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i += 1) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
}

/**
 * A stable, opaque cache key for the catalogs. Keys on the SET of configured
 * providers + their base URLs + custom-model lists + the active provider — never
 * on a raw API key value — then hashes the result so nothing sensitive lands in
 * localStorage.
 */
export function catalogFingerprint(input: CatalogFingerprintInput): string {
    const configured = Object.entries(input.providerKeys ?? {})
        .filter(([, v]) => typeof v === 'string' && v.length > 0)
        .map(([k]) => k)
        .sort();
    return hashString(
        JSON.stringify({
            configured,
            baseUrls: input.providerBaseUrls ?? {},
            custom: input.providerCustomModels ?? {},
            provider: input.provider ?? null,
        }),
    );
}

/** Reduce a remote model to non-sensitive identity fields before persisting. */
export function slimModel(model: PiModel): PiModel {
    const out: PiModel = { provider: model.provider, id: model.id };
    if (typeof model.name === 'string') out.name = model.name;
    if (model.reasoning != null) out.reasoning = model.reasoning;
    return out;
}

interface ModelCatalogState {
    /** Slim remote model blobs (unfiltered; callers filter by live config). */
    models: PiModel[];
    /** Fingerprint the model list was fetched under, or null if empty. */
    modelsBuster: string | null;
    /** Last-known dynamic Pi slash commands. */
    commands: PiSlashCommand[];
    /** Fingerprint the commands were fetched under, or null if empty. */
    commandsBuster: string | null;

    /** Cached models for this fingerprint, or `[]` if the config changed. */
    modelsFor: (buster: string) => PiModel[];
    /** Cached commands for this fingerprint, or `[]` if the config changed. */
    commandsFor: (buster: string) => PiSlashCommand[];
    /** Write-through the revalidated model list (slimmed). */
    setModels: (buster: string, models: PiModel[]) => void;
    /** Write-through the revalidated dynamic commands. */
    setCommands: (buster: string, commands: PiSlashCommand[]) => void;
    /** Drop the command cache (e.g. `/reload` re-discovers Pi commands). */
    clearCommands: () => void;
    /** Drop everything. */
    clear: () => void;
}

export const useModelCatalogStore = create<ModelCatalogState>()(
    persist(
        (set, get) => ({
            models: [],
            modelsBuster: null,
            commands: [],
            commandsBuster: null,

            modelsFor: (buster) => (get().modelsBuster === buster ? get().models : []),
            commandsFor: (buster) => (get().commandsBuster === buster ? get().commands : []),
            setModels: (buster, models) => set({ models: models.map(slimModel), modelsBuster: buster }),
            setCommands: (buster, commands) => set({ commands, commandsBuster: buster }),
            clearCommands: () => set({ commands: [], commandsBuster: null }),
            clear: () => set({ models: [], modelsBuster: null, commands: [], commandsBuster: null }),
        }),
        { name: 'openjammer-model-catalog', version: 1 },
    ),
);
