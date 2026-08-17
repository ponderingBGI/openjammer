import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveKeydown } from '../arbiter';
import { clearBindingSetsForTests, registerBindingSet } from '../registry';
import { useCanvasStore } from '../../store/canvasStore';
import { useAudioClipStore } from '../../store/audioClipStore';
import { useUiViewStore } from '../../store/uiViewStore';
import { keybindingActions } from '../../store/keybindingsStore';

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

    it('G4: drag guard consumes Tab without toggling', () => {
        const run = vi.fn(() => true);
        registerBindingSet({ id: 'global', scope: 'global', entries: [{ actionId: 'view.toggleArrangement', run }] });
        useCanvasStore.setState({ isDragging: true });
        const event = key('Tab');
        expect(resolveKeydown(event)).toBe(true);
        expect(event.defaultPrevented).toBe(true);
        expect(run).not.toHaveBeenCalled();
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
});
