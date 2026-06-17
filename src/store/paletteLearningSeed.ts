/**
 * Palette learning SEED entry point (D-LEARN, M7) — the desktop "pi-memory"
 * ceiling layered OVER the always-present local frecency floor (M2).
 *
 * When `caps.learning === 'pi-memory'`, the persistent-intelligence package MAY
 * seed/boost the local palette ranking with cross-session preferences. This module
 * is the ONE wiring point that calls
 * {@link usePaletteLearningStore.applySeedBoosts}. The merge is ADDITIVE and the
 * local frecency stays the UNCONDITIONAL FLOOR: a seed can only ever RAISE a
 * command's score, never lower a live on-device one.
 *
 * ── FOUNDER-GATED ──────────────────────────────────────────────────────────
 * The seed SOURCE — reading real Pi-memory — is founder-gated (it needs the
 * persistent-intelligence runtime + a real Pi). {@link fetchSeedBoosts} is a
 * documented STUB returning an empty map today, so this path ships green and is
 * a no-op until the founder wires the real source. The additive-merge INVARIANT
 * (never lower a live local score) is tested now so the contract is locked in.
 */

import { usePaletteLearningStore } from './paletteLearningStore';
import { getExecutor } from '../audio/executor';

/**
 * Fetch the seed boosts to additively merge into the local frecency floor.
 *
 * FOUNDER-GATED STUB: returns an empty map. The real implementation reads the
 * `pi-persistent-intelligence` memory (cross-session command preferences) and
 * maps them to `frecencyKey -> boost`. Kept async so the real source (an RPC /
 * file read) is a drop-in replacement.
 */
export async function fetchSeedBoosts(): Promise<Record<string, number>> {
    // No real Pi-memory read in this build — see module docs.
    return {};
}

/**
 * Apply the Pi-memory seed boosts to the palette learning floor, but ONLY when
 * the platform's learning ceiling is `'pi-memory'`. A no-op on `'local-only'`
 * (browser) and whenever the seed map is empty (today's founder-gated stub), so
 * calling it is always safe.
 *
 * INVARIANT: this only RAISES scores ({@link usePaletteLearningStore.applySeedBoosts}
 * is additive); the local frecency floor is never lowered.
 */
export async function seedPaletteLearning(): Promise<void> {
    let learning: string;
    try {
        learning = getExecutor().getCapabilities().learning;
    } catch {
        return; // no executor (degenerate env) → nothing to seed
    }
    if (learning !== 'pi-memory') return;

    const seeds = await fetchSeedBoosts();
    if (Object.keys(seeds).length === 0) return;
    usePaletteLearningStore.getState().applySeedBoosts(seeds);
}
