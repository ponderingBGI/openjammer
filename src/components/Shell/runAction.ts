/**
 * Press a keyboard action from a button.
 *
 * Some of this app's most load-bearing affordances exist only as key bindings —
 * `Ctrl+K` above all, which PRODUCT.md calls non-negotiable and which a
 * first-time player never once saw named on screen. Giving a hidden gesture its
 * visible twin means a button has to be able to do exactly what the key does.
 *
 * It runs the SAME `run` the arbiter would, found by `actionId` in the live
 * binding registry — never a synthetic `KeyboardEvent`, which would go stale the
 * moment a player rebound the key, and never a second copy of the behaviour.
 */

import { getBindingSets } from '../../keymap/registry';

/** Run the first registered handler for `actionId`. False when nothing claims it. */
export function runAction(actionId: string): boolean {
    for (const set of getBindingSets()) {
        for (const entry of set.entries) {
            if (entry.actionId !== actionId) continue;
            if (entry.run(new KeyboardEvent('keydown'))) return true;
        }
    }
    return false;
}
