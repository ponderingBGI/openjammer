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

export function isFocusableInOpenDialog(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;
    const dialog = target.closest('[role="dialog"], dialog');
    if (!dialog) return false;
    if (dialog instanceof HTMLDialogElement && !dialog.open) return false;
    return target.matches(
        'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"]), [contenteditable]:not([contenteditable="false"])',
    );
}

/**
 * True when the browser currently owns a real text selection.
 *
 * Canvas shortcuts have an internal clipboard for graph nodes, but they must
 * never steal Ctrl/Cmd+C from selected UI copy in Settings, guides, logs, or
 * agent answers. Letting the native copy command run is the only way those
 * selections reach the OS clipboard.
 */
export function hasNativeTextSelection(): boolean {
    if (typeof window !== 'undefined') {
        const selection = window.getSelection?.();
        if (selection && !selection.isCollapsed && selection.toString().length > 0) {
            return true;
        }
    }

    if (typeof document === 'undefined') return false;
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
        const start = active.selectionStart;
        const end = active.selectionEnd;
        return start !== null && end !== null && start !== end;
    }

    return false;
}

function isContentEditableElement(target: Element): boolean {
    if (target instanceof HTMLElement && target.isContentEditable) return true;
    const editable = target.closest('[contenteditable]');
    if (!editable) return false;
    return editable.getAttribute('contenteditable')?.toLowerCase() !== 'false';
}
