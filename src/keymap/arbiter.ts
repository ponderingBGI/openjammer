import { useAudioClipStore } from '../store/audioClipStore';
import { useCanvasStore } from '../store/canvasStore';
import { matchesKeyCombo, UNBOUND_KEY, useKeybindingsStore } from '../store/keybindingsStore';
import { useUiViewStore } from '../store/uiViewStore';
import { hasNativeTextSelection, isEditableTarget, isFocusableInOpenDialog } from '../utils/editableTarget';
import { getBindingSets } from './registry';
import type { BindingSet } from './types';

/**
 * S4: bare `Tab` is the canvas <-> arrangement toggle only when focus is on the
 * STAGE FLOOR — `document.body`, or a `[data-surface-root]` element ITSELF.
 * Focus parked in chrome (the floating transport pill, the topbar, a panel, a
 * focus-trapped dialog) keeps native DOM traversal, and so does focus parked on
 * anything *inside* a surface: a node, a faceplate, a port, a clip.
 *
 * The `closest()` this replaces matched every descendant, which is what W5-P6's
 * F7 measured: with focus on a node port, one `Tab` swapped the visible surface
 * and hid the node the performer was working on, so no port, knob or pad on the
 * canvas was reachable by keyboard at all. A surface that cannot be walked is
 * not a surface. `matches()` keeps the law the topbar keycap advertises — press
 * `Tab` on the empty stage and the other surface comes up — while inside a card
 * `Tab` means what it means everywhere else: the next control.
 *
 * `Shift+Tab` obeys the same target rule (the guard below does not look at the
 * modifier), but it never toggles: `view.toggleArrangement` is bound to a bare
 * `Tab`, so a backwards Tab from the stage floor walks into the chrome. That
 * asymmetry is deliberate — it is the keyboard-only route OUT of a surface, and
 * the hidden peer is `inert`, so it can never be the thing Shift+Tab lands on.
 *
 * This is deliberately a POSITIVE test on the event target. `:focus-visible` cannot
 * carry the negative case: Chromium already raises it on the very keydown that is
 * about to move focus, so every Tab would look like chrome.
 */
function isSurfaceTabTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return true;
    if (target === document.body) return true;
    if (isFocusableInOpenDialog(target)) return false;
    return target.matches('[data-surface-root]');
}

/**
 * Was the PREVIOUS key a bare `Tab`? — the whole of U9.
 *
 * The stage-floor `Tab` toggle was unconditional, and the measured consequence
 * (HEURISTIC-AUDIT HA-01, S1) is that there was **no forward-Tab route into any
 * surface at all**. Walking the topbar ends at the transport pill; the next
 * `Tab` leaves the last tabbable element, which parks `document.activeElement`
 * on `document.body` — the stage floor — and from there every further `Tab`
 * toggled canvas <-> song forever. Zero canvas controls were ever reached, while
 * `docs/shell.md:80-82` promised the opposite in writing.
 *
 * The discriminator is whether focus is PARKED on the stage floor or in TRANSIT
 * across it. A player who clicked the empty stage, or pressed Escape, and then
 * presses `Tab` means "show me the other surface" — that gesture is unchanged,
 * and it is what the topbar keycap advertises. A player mid-traversal arrives on
 * the floor with a `Tab` already behind them, and means "keep going" — so the
 * key falls through to native traversal and lands on the first control inside
 * the active surface, which is exactly what the doc claims.
 *
 * One flag covers both halves of the decision, including the one the brief names
 * directly: a SECOND consecutive bare `Tab` on a surface root always falls
 * through, so a player who toggles and presses `Tab` again walks INTO the
 * surface they just brought up rather than toggling back.
 *
 * `Shift+Tab` is not a bare Tab and never toggles, so it neither sets nor reads
 * this; any other key clears it, which is what makes "consecutive" mean
 * consecutive.
 */
let previousKeyWasBareTab = false;

/**
 * Focus was moved by something other than the keyboard (a click, a tap), so the
 * traversal that was running is over: the next bare `Tab` on the stage floor is
 * a fresh, PARKED gesture and must toggle. Wired to `pointerdown` by
 * `useKeymapArbiter`; also called by the arbiter's own tests.
 */
export function resetTabTraversal(): void {
    previousKeyWasBareTab = false;
}

function runSets(event: KeyboardEvent, sets: readonly BindingSet[], inheritedOnly = false): boolean {
    const bindings = useKeybindingsStore.getState();
    for (const set of sets) {
        for (const entry of set.entries) {
            if (inheritedOnly && !entry.inherit) continue;
            if (bindings.customBindings[entry.actionId]?.key === UNBOUND_KEY) continue;
            const configured = bindings.getBinding(entry.actionId);
            if (!(configured ? matchesKeyCombo(event, configured) : entry.defaultBinding && matchesKeyCombo(event, entry.defaultBinding)) || entry.guard?.(event) === false) continue;
            if (!entry.run(event)) continue;
            event.preventDefault();
            return true;
        }
    }
    return false;
}

export function resolveKeydown(event: KeyboardEvent): boolean {
    // FIRST, before any early return: the "was the last key a bare Tab" flag has
    // to see EVERY key, or a Tab pressed inside a text field leaves it stale and
    // the next stage-floor Tab reads a traversal that is not running (U9).
    const isBareTab = event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey;
    const wasFollowingTab = previousKeyWasBareTab;
    previousKeyWasBareTab = isBareTab;

    const isNativeCopy = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && hasNativeTextSelection();
    if (isEditableTarget(event.target) || isNativeCopy) return false;

    const allSets = getBindingSets();
    const modalSets = allSets.filter((set) => set.scope === 'modal');

    // Tab is browser focus traversal everywhere except the song surfaces themselves —
    // inside a focus-trapped dialog, on the transport pill, in the topbar, in a panel.
    // And on the stage floor it is traversal too whenever the previous key was
    // also a bare Tab: focus is crossing the floor, not parked on it (U9).
    if (event.key === 'Tab' && (!isSurfaceTabTarget(event.target) || (isBareTab && wasFollowingTab))) return false;

    /*
     * While dragging, Escape may reach the normal ladder; every other key is
     * deliberately consumed so no edit can land beneath the pointer gesture.
     *
     * `Tab` is the ONE exception, and U8 is why. `isConnecting` is now raised by
     * the KEYBOARD route as well as the pointer one — `Enter` on a socket arms a
     * cable — and walking to the card you mean to land on is `Tab`. Swallowing it
     * left the keyboard player armed and unable to move, i.e. the gesture failing
     * at exactly the step that matters. So a mid-gesture `Tab` FALLS THROUGH to
     * native focus traversal rather than being consumed — it still never reaches
     * the surface toggle, which is the half of this guard that was load-bearing
     * (swapping the visible surface out from under a live drag). Safe for the
     * pointer case too: a drag follows the mouse, not the focus ring, and no EDIT
     * can land from a Tab.
     */
    const canvas = useCanvasStore.getState();
    const dragActive = canvas.isDragging || canvas.isPanning || canvas.isConnecting ||
        useAudioClipStore.getState().dragState.isDragging;
    if (dragActive && event.key !== 'Escape') {
        if (event.key === 'Tab') return false;
        event.preventDefault();
        return true;
    }

    // Only the top-most modal participates. An unhandled modal key never falls
    // through to a surface/global action.
    if (modalSets.length > 0) {
        return runSets(event, modalSets.slice(-1));
    }

    // Resolution is inside-out: the focused binding set, each enclosing DOM
    // surface, the active app surface when it is not already in that path,
    // then global. An unhandled child shortcut therefore never walls off its
    // parent editor, while a handled child shortcut still wins immediately.
    // Fall-through is allowlisted, not blanket: only the FIRST (innermost)
    // surface runs its whole set. Every enclosing surface contributes just its
    // `inherit: true` entries, so a key the piano roll does not consume can
    // reach undo, transport or the Escape cascade — and can never reach the
    // arrangement's editing letters (`s` split, `0` mute, the tool keys).
    const surfacePath: Array<{ surface: string; setId?: string }> = [];
    let element = document.activeElement?.closest<HTMLElement>('[data-keymap-surface]') ?? null;
    while (element) {
        const surface = element.dataset.keymapSurface;
        if (surface) surfacePath.push({ surface, setId: element.dataset.keymapSetId });
        element = element.parentElement?.closest<HTMLElement>('[data-keymap-surface]') ?? null;
    }
    const activeSurface = useUiViewStore.getState().surface;
    if (!surfacePath.some((entry) => entry.surface === activeSurface)) surfacePath.push({ surface: activeSurface });
    for (const [depth, entry] of surfacePath.entries()) {
        const surfaceSets = allSets.filter((set) => set.scope === 'surface' && set.surface === entry.surface && (!entry.setId || set.id === entry.setId));
        if (runSets(event, surfaceSets, depth > 0)) return true;
    }

    return runSets(event, allSets.filter((set) => set.scope === 'global'));
}
