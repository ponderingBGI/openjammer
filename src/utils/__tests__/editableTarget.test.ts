import { afterEach, describe, expect, it } from 'vitest';
import { hasNativeTextSelection, isEditableTarget } from '../editableTarget';

afterEach(() => {
    window.getSelection()?.removeAllRanges();
    document.body.innerHTML = '';
});

describe('isEditableTarget', () => {
    it('treats textarea as editable so global Backspace shortcuts do not steal it', () => {
        const textarea = document.createElement('textarea');
        expect(isEditableTarget(textarea)).toBe(true);
    });

    it('treats input, select, and contenteditable as editable', () => {
        expect(isEditableTarget(document.createElement('input'))).toBe(true);
        expect(isEditableTarget(document.createElement('select'))).toBe(true);
        const editable = document.createElement('div');
        editable.setAttribute('contenteditable', 'true');
        expect(isEditableTarget(editable)).toBe(true);
    });

    it('does not treat normal elements as editable', () => {
        expect(isEditableTarget(document.createElement('div'))).toBe(false);
    });
});

describe('hasNativeTextSelection', () => {
    it('detects selected static UI text so Ctrl+C can stay browser-native', () => {
        const copy = document.createElement('p');
        copy.textContent = 'System Default';
        document.body.append(copy);

        const range = document.createRange();
        range.selectNodeContents(copy);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);

        expect(hasNativeTextSelection()).toBe(true);
    });

    it('ignores collapsed document selections', () => {
        const copy = document.createElement('p');
        copy.textContent = 'No selection yet';
        document.body.append(copy);

        const range = document.createRange();
        range.setStart(copy.firstChild ?? copy, 0);
        range.collapse(true);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);

        expect(hasNativeTextSelection()).toBe(false);
    });

    it('detects selected text inside the focused editable control fallback', () => {
        const input = document.createElement('input');
        input.value = 'latency';
        document.body.append(input);
        input.focus();
        input.setSelectionRange(0, 4);

        expect(hasNativeTextSelection()).toBe(true);
    });
});
