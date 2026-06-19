/**
 * True when a keyboard event started inside an editable control.
 *
 * Global canvas/app shortcuts must not call `preventDefault()` for these targets:
 * Backspace/Delete should edit text, not delete graph nodes, and Ctrl+S should
 * remain browser/editor-native while the user is typing.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;
    const tag = target.tagName;
    return (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        isContentEditableElement(target)
    );
}

function isContentEditableElement(target: Element): boolean {
    if (target instanceof HTMLElement && target.isContentEditable) return true;
    const editable = target.closest('[contenteditable]');
    if (!editable) return false;
    return editable.getAttribute('contenteditable')?.toLowerCase() !== 'false';
}
