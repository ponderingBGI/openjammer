import { useAudioClipStore } from '../store/audioClipStore';
import { useCanvasStore } from '../store/canvasStore';
import { useKeybindingsStore } from '../store/keybindingsStore';
import { useUiViewStore } from '../store/uiViewStore';
import { hasNativeTextSelection, isEditableTarget, isFocusableInOpenDialog } from '../utils/editableTarget';
import { getBindingSets } from './registry';
import type { BindingSet } from './types';

function runSets(event: KeyboardEvent, sets: readonly BindingSet[]): boolean {
    const { matchesAction } = useKeybindingsStore.getState();
    for (const set of sets) {
        for (const entry of set.entries) {
            if (!matchesAction(event, entry.actionId) || entry.guard?.(event) === false) continue;
            if (!entry.run(event)) continue;
            event.preventDefault();
            return true;
        }
    }
    return false;
}

export function resolveKeydown(event: KeyboardEvent): boolean {
    const isNativeCopy = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && hasNativeTextSelection();
    if (isEditableTarget(event.target) || isNativeCopy) return false;

    const allSets = getBindingSets();
    const modalSets = allSets.filter((set) => set.scope === 'modal');

    // Tab in a focus-trapped dialog is browser focus traversal, even when the
    // focused target happens to be a non-editable button or link.
    if (event.key === 'Tab' && isFocusableInOpenDialog(event.target)) return false;

    // While dragging, Escape may reach the normal ladder; every other key is
    // deliberately consumed so no edit can land beneath the pointer gesture.
    const canvas = useCanvasStore.getState();
    const dragActive = canvas.isDragging || canvas.isPanning || canvas.isConnecting ||
        useAudioClipStore.getState().dragState.isDragging;
    if (dragActive && event.key !== 'Escape') {
        event.preventDefault();
        return true;
    }

    // Only the top-most modal participates. An unhandled modal key never falls
    // through to a surface/global action.
    if (modalSets.length > 0) {
        return runSets(event, modalSets.slice(-1));
    }

    const surface = useUiViewStore.getState().surface;
    const surfaceSets = allSets.filter((set) => set.scope === 'surface' && set.surface === surface);
    if (runSets(event, surfaceSets)) return true;

    return runSets(event, allSets.filter((set) => set.scope === 'global'));
}
