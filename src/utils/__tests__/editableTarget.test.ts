import { describe, expect, it } from 'vitest';
import { isEditableTarget } from '../editableTarget';

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
