import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTabTraversal, resolveKeydown } from '../arbiter';
import { clearBindingSetsForTests, registerBindingSet } from '../registry';
import { useCanvasStore } from '../../store/canvasStore';
import { useAudioClipStore } from '../../store/audioClipStore';
import { useUiViewStore } from '../../store/uiViewStore';
import { keybindingActions, UNBOUND_KEY, useKeybindingsStore } from '../../store/keybindingsStore';

function key(keyValue: string, init: KeyboardEventInit = {}, target?: Element): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: keyValue, bubbles: true, cancelable: true, ...init });
    if (target) Object.defineProperty(event, 'target', { value: target });
    return event;
}

describe('keymap arbiter', () => {
    beforeEach(() => {
        clearBindingSetsForTests();
        useUiViewStore.setState({ surface: 'canvas' });
        useCanvasStore.setState({ isDragging: false });
        useAudioClipStore.setState((state) => ({ dragState: { ...state.dragState, isDragging: false } }));
        useKeybindingsStore.setState({ customBindings: {} });
        resetTabTraversal();
    });

    afterEach(clearBindingSetsForTests);

    it('text scope beats the active surface', () => {
        const run = vi.fn(() => true);
        registerBindingSet({ id: 'canvas', scope: 'surface', surface: 'canvas', entries: [{ actionId: 'edit.undo', run }] });
        const input = document.createElement('input');
        expect(resolveKeydown(key('z', { ctrlKey: true }, input))).toBe(false);
        expect(run).not.toHaveBeenCalled();
    });

    it('the top modal beats the active surface', () => {
        const surface = vi.fn(() => true);
        const modal = vi.fn(() => true);
        registerBindingSet({ id: 'canvas', scope: 'surface', surface: 'canvas', entries: [{ actionId: 'edit.undo', run: surface }] });
        registerBindingSet({ id: 'modal', scope: 'modal', entries: [{ actionId: 'edit.undo', run: modal }] });
        expect(resolveKeydown(key('z', { ctrlKey: true }))).toBe(true);
        expect(modal).toHaveBeenCalledOnce();
        expect(surface).not.toHaveBeenCalled();
    });

    it('falls through unhandled sets and stops at the first handled set', () => {
        const first = vi.fn(() => false);
        const second = vi.fn(() => true);
        const third = vi.fn(() => true);
        for (const [id, run] of [['first', first], ['second', second], ['third', third]] as const) {
            registerBindingSet({ id, scope: 'surface', surface: 'canvas', entries: [{ actionId: 'edit.undo', run }] });
        }
        expect(resolveKeydown(key('z', { ctrlKey: true }))).toBe(true);
        expect(first).toHaveBeenCalledOnce();
        expect(second).toHaveBeenCalledOnce();
        expect(third).not.toHaveBeenCalled();
    });

    it('falls through the focused child surface to its enclosing surface INHERIT entries, then global', () => {
        const piano = vi.fn(() => false);
        const arrangement = vi.fn(() => true);
        const global = vi.fn(() => true);
        useUiViewStore.setState({ surface: 'arrangement' });
        registerBindingSet({ id: 'pianoroll:clip-1', scope: 'surface', surface: 'pianoroll', entries: [{ actionId: 'child.unhandled', defaultBinding: { key: 'z', ctrl: true }, run: piano }] });
        registerBindingSet({ id: 'arrangement', scope: 'surface', surface: 'arrangement', entries: [{ actionId: 'arrangement.undo', inherit: true, run: arrangement }] });
        registerBindingSet({ id: 'global', scope: 'global', entries: [{ actionId: 'edit.undo', run: global }] });
        const parent = document.createElement('div');
        parent.dataset.keymapSurface = 'arrangement';
        const child = document.createElement('div');
        child.dataset.keymapSurface = 'pianoroll';
        child.dataset.keymapSetId = 'pianoroll:clip-1';
        child.tabIndex = 0;
        parent.append(child);
        document.body.append(parent);
        child.focus();

        const handled = resolveKeydown(key('z', { ctrlKey: true }, child));
        parent.remove();
        expect(handled).toBe(true);
        expect(piano).toHaveBeenCalledOnce();
        expect(arrangement).toHaveBeenCalledOnce();
        expect(global).not.toHaveBeenCalled();
    });

    it('honours explicit unbinding for a binding-set-local default', () => {
        const run = vi.fn(() => true);
        useKeybindingsStore.setState({ customBindings: { 'arrangement.tool.draw': { key: UNBOUND_KEY } } });
        useUiViewStore.setState({ surface: 'arrangement' });
        registerBindingSet({ id: 'arrangement', scope: 'surface', surface: 'arrangement', entries: [{ actionId: 'arrangement.tool.draw', defaultBinding: { key: 'b' }, run }] });
        expect(resolveKeydown(key('b'))).toBe(false);
        expect(run).not.toHaveBeenCalled();
    });

    it('G1: bare Tab yields to editable and dialog-focusable targets', () => {
        const run = vi.fn(() => true);
        registerBindingSet({ id: 'global', scope: 'global', entries: [{ actionId: 'view.toggleArrangement', run }] });
        const input = document.createElement('input');
        expect(resolveKeydown(key('Tab', {}, input))).toBe(false);
        const dialog = document.createElement('div');
        dialog.setAttribute('role', 'dialog');
        const button = document.createElement('button');
        dialog.append(button);
        expect(resolveKeydown(key('Tab', {}, button))).toBe(false);
        expect(run).not.toHaveBeenCalled();
    });

    it('G2: bare Tab yields while a modal is open', () => {
        const run = vi.fn(() => true);
        registerBindingSet({ id: 'global', scope: 'global', entries: [{ actionId: 'view.toggleArrangement', run }] });
        registerBindingSet({ id: 'modal', scope: 'modal', entries: [] });
        expect(resolveKeydown(key('Tab'))).toBe(false);
        expect(run).not.toHaveBeenCalled();
    });

    it('G3: modified Tab does not match the bare binding', () => {
        const run = vi.fn(() => true);
        registerBindingSet({ id: 'global', scope: 'global', entries: [{ actionId: 'view.toggleArrangement', run }] });
        expect(resolveKeydown(key('Tab', { shiftKey: true }))).toBe(false);
        expect(run).not.toHaveBeenCalled();
    });

    /*
     * The drag guard's job is that a live gesture cannot have the surface swapped
     * out from under it. It used to do that by CONSUMING Tab, which U8 turned
     * into a dead end: `isConnecting` is now raised by the keyboard route too
     * (`Enter` arms a cable), and the way to the card you mean to land on is
     * `Tab`. So a mid-gesture Tab walks natively and still never toggles.
     */
    it('G4: a mid-gesture Tab walks natively and never toggles', () => {
        const run = vi.fn(() => true);
        registerBindingSet({ id: 'global', scope: 'global', entries: [{ actionId: 'view.toggleArrangement', run }] });
        useCanvasStore.setState({ isDragging: true });
        const event = key('Tab');
        expect(resolveKeydown(event)).toBe(false);
        expect(event.defaultPrevented).toBe(false);
        expect(run).not.toHaveBeenCalled();

        // Every other key is still consumed: no edit lands beneath a gesture.
        const letter = key('d', { ctrlKey: true });
        expect(resolveKeydown(letter)).toBe(true);
        expect(letter.defaultPrevented).toBe(true);
    });

    it('resolves every migrated shortcut through its action id', () => {
        const actionIds = [
            'file.save', 'file.export', 'commandBar.toggle', 'panel.devLog', 'panel.audioHealth', 'panel.plugins',
            'view.toggleArrangement', ...Array.from({ length: 9 }, (_, index) => `mode.${index + 1}`),
            'canvas.escape', 'edit.delete', 'canvas.deleteBackspace', 'canvas.exitLevel',
            'canvas.enterNode', 'canvas.transport', 'view.ghostMode', 'edit.undo', 'edit.redo',
            'canvas.copy', 'canvas.paste', 'canvas.multiConnect',
            'arrangement.transport', 'arrangement.undo', 'arrangement.redo',
            'arrangement.delete', 'arrangement.deleteBackspace',
            ...keybindingActions.filter((action) => action.id.startsWith('note.')).map((action) => action.id),
        ];

        for (const actionId of actionIds) {
            clearBindingSetsForTests();
            const action = keybindingActions.find((candidate) => candidate.id === actionId)!;
            const run = vi.fn(() => true);
            if (action.scope === 'surface') useUiViewStore.setState({ surface: action.surface! });
            registerBindingSet({
                id: actionId,
                scope: action.scope,
                surface: action.surface,
                entries: [{ actionId, run }],
            });
            const binding = action.defaultBinding;
            const event = key(binding.key, {
                ctrlKey: Boolean(binding.ctrl || binding.meta),
                shiftKey: Boolean(binding.shift),
                altKey: Boolean(binding.alt),
            });
            expect(resolveKeydown(event), actionId).toBe(true);
            expect(run, actionId).toHaveBeenCalledOnce();
        }
    });
    it('TA2d: an enclosing surface lends ONLY its inherit-flagged entries to a focused child', () => {
        const rollUnhandled = vi.fn(() => false);
        const parentInherited = vi.fn(() => true);
        const parentLocal = vi.fn(() => true);
        useUiViewStore.setState({ surface: 'arrangement' });
        registerBindingSet({ id: 'pianoroll:clip-1', scope: 'surface', surface: 'pianoroll', entries: [{ actionId: 'child.unhandled', defaultBinding: { key: 's' }, run: rollUnhandled }] });
        registerBindingSet({
            id: 'arrangement', scope: 'surface', surface: 'arrangement', entries: [
                { actionId: 'arrangement.split', defaultBinding: { key: 's' }, run: parentLocal },
                { actionId: 'arrangement.undo', inherit: true, run: parentInherited },
            ],
        });
        const parent = document.createElement('div');
        parent.dataset.keymapSurface = 'arrangement';
        const child = document.createElement('div');
        child.dataset.keymapSurface = 'pianoroll';
        child.dataset.keymapSetId = 'pianoroll:clip-1';
        child.tabIndex = 0;
        parent.append(child);
        document.body.append(parent);
        child.focus();

        // `s` is a destructive arrangement EDIT; it must not reach the parent.
        const split = key('s', {}, child);
        expect(resolveKeydown(split)).toBe(false);
        expect(rollUnhandled).toHaveBeenCalledOnce();
        expect(parentLocal).not.toHaveBeenCalled();
        expect(split.defaultPrevented).toBe(false);

        // Ctrl+Z is flagged inheritable, so document history still works from the roll.
        expect(resolveKeydown(key('z', { ctrlKey: true }, child))).toBe(true);
        expect(parentInherited).toHaveBeenCalledOnce();
        parent.remove();
    });

    /*
     * W5-P6 F7 / W6-UI item 7. `Tab` used to reach the surface toggle from ANY
     * descendant of a `[data-surface-root]`, so one Tab on a node port swapped
     * the visible surface and hid the node under the performer's hands. The law
     * now: the STAGE FLOOR toggles, a control walks.
     */
    it('S4: bare Tab toggles surfaces from the stage floor, and only from there', () => {
        const run = vi.fn(() => true);
        registerBindingSet({ id: 'global', scope: 'global', entries: [{ actionId: 'view.toggleArrangement', run }] });

        const pill = document.createElement('div');
        pill.className = 'transport-pill';
        const play = document.createElement('button');
        pill.append(play);
        const surface = document.createElement('div');
        surface.dataset.surfaceRoot = 'arrangement';
        surface.tabIndex = -1;
        const clip = document.createElement('button');
        surface.append(clip);
        document.body.append(pill, surface);

        // Chrome: the pill lives outside every `[data-surface-root]`, so Tab is
        // native traversal and the arbiter must not preventDefault.
        const fromPill = key('Tab', {}, play);
        expect(resolveKeydown(fromPill)).toBe(false);
        expect(fromPill.defaultPrevented).toBe(false);
        expect(resolveKeydown(key('Tab', { shiftKey: true }, play))).toBe(false);
        expect(run).not.toHaveBeenCalled();

        // PARKED on the stage floor — the player clicked the empty stage, or
        // pressed Escape, and now presses Tab. That is the gesture the topbar
        // keycap advertises, and it still toggles, from the surface root and
        // from the bare body alike.
        resetTabTraversal();
        expect(resolveKeydown(key('Tab', {}, surface))).toBe(true);
        resetTabTraversal();
        expect(resolveKeydown(key('Tab', {}, document.body))).toBe(true);
        expect(run).toHaveBeenCalledTimes(2);

        // A control INSIDE the surface walks natively — this is the trap.
        const fromClip = key('Tab', {}, clip);
        expect(resolveKeydown(fromClip)).toBe(false);
        expect(fromClip.defaultPrevented).toBe(false);
        expect(run).toHaveBeenCalledTimes(2);

        pill.remove();
        surface.remove();
    });

    /*
     * U9 / HA-01 — the forward route back INTO a surface.
     *
     * Measured before this: from the topbar's last control, Tab walked pill ->
     * hint -> help -> `document.body`, and every further Tab toggled canvas <->
     * song forever. Zero canvas controls were ever reached, while
     * `docs/shell.md:80-82` promised the opposite in writing.
     *
     * The discriminator is PARKED vs IN TRANSIT. A Tab that arrives on the stage
     * floor with another Tab immediately behind it is a traversal crossing the
     * floor, so it falls through to the browser and lands inside the surface. A
     * second consecutive Tab on the same root does the same, which is what lets a
     * player toggle a surface up and then walk straight into it. Anything else —
     * a pointer, any other key — parks focus again and the next Tab toggles.
     */
    it('U9: a Tab that follows a Tab crosses the stage floor instead of toggling', () => {
        const run = vi.fn(() => true);
        registerBindingSet({ id: 'global', scope: 'global', entries: [{ actionId: 'view.toggleArrangement', run }] });

        const chrome = document.createElement('button');
        const surface = document.createElement('div');
        surface.dataset.surfaceRoot = 'canvas';
        surface.tabIndex = -1;
        document.body.append(chrome, surface);

        // Walking OUT of the chrome, then across the floor: the second Tab must
        // not be eaten, or there is no way back into the surface at all.
        resetTabTraversal();
        expect(resolveKeydown(key('Tab', {}, chrome))).toBe(false);
        const crossing = key('Tab', {}, document.body);
        expect(resolveKeydown(crossing)).toBe(false);
        expect(crossing.defaultPrevented).toBe(false);
        expect(run).not.toHaveBeenCalled();

        // Parked: toggle once, then the very next Tab walks in.
        resetTabTraversal();
        expect(resolveKeydown(key('Tab', {}, surface))).toBe(true);
        expect(run).toHaveBeenCalledTimes(1);
        expect(resolveKeydown(key('Tab', {}, surface))).toBe(false);
        expect(run).toHaveBeenCalledTimes(1);

        // A key between two Tabs ends the traversal, so the floor toggles again.
        resolveKeydown(key('x', {}, document.body));
        expect(resolveKeydown(key('Tab', {}, surface))).toBe(true);
        expect(run).toHaveBeenCalledTimes(2);

        // ...and so does a pointer, which is what `useKeymapArbiter` wires to
        // `pointerdown`: click the empty stage, press Tab, get the other surface.
        expect(resolveKeydown(key('Tab', {}, surface))).toBe(false);
        resetTabTraversal();
        expect(resolveKeydown(key('Tab', {}, surface))).toBe(true);
        expect(run).toHaveBeenCalledTimes(3);

        chrome.remove();
        surface.remove();
    });

    /*
     * Symmetry: the target rule does not look at the modifier, so Shift+Tab is
     * native traversal from exactly the same places Tab is — and it is never the
     * toggle, because `view.toggleArrangement` is bound to a BARE Tab. That is
     * the keyboard-only route off a surface and into the chrome.
     */
    it('S4: Shift+Tab obeys the same target rule and never toggles', () => {
        const run = vi.fn(() => true);
        registerBindingSet({ id: 'global', scope: 'global', entries: [{ actionId: 'view.toggleArrangement', run }] });

        const surface = document.createElement('div');
        surface.dataset.surfaceRoot = 'canvas';
        surface.tabIndex = -1;
        const port = document.createElement('button');
        const nested = document.createElement('div');
        nested.className = 'oj-node';
        nested.append(port);
        surface.append(nested);
        document.body.append(surface);

        for (const target of [surface, document.body, port]) {
            const event = key('Tab', { shiftKey: true }, target);
            expect(resolveKeydown(event), 'Shift+Tab is never consumed').toBe(false);
            expect(event.defaultPrevented).toBe(false);
        }
        expect(run).not.toHaveBeenCalled();

        // ...and a port nested two levels deep is still not the stage floor.
        const forward = key('Tab', {}, port);
        expect(resolveKeydown(forward)).toBe(false);
        expect(forward.defaultPrevented).toBe(false);
        expect(run).not.toHaveBeenCalled();

        surface.remove();
    });

});
