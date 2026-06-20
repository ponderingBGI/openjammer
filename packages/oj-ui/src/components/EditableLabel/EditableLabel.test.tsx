import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { EditableLabel } from './EditableLabel';

describe('EditableLabel', () => {
    it('rests as a labelled span with the value and base class', () => {
        const { container } = render(<EditableLabel value="Reverb" onCommit={() => {}} />);
        const wrap = container.querySelector('.oj-editable-label')!;
        const text = container.querySelector('.oj-editable-label__text')!;
        expect(wrap.className).toContain('oj-editable-label');
        expect(text.textContent).toBe('Reverb');
        expect(container.querySelector('input')).toBeNull();
    });

    it('shows the placeholder in the muted voice when value is empty', () => {
        const { container } = render(
            <EditableLabel value="" placeholder="Untitled" onCommit={() => {}} />,
        );
        const text = container.querySelector('.oj-editable-label__text')!;
        expect(text.textContent).toBe('Untitled');
        expect(text.className).toContain('is-placeholder');
    });

    it('applies the center alignment modifier', () => {
        const { container } = render(
            <EditableLabel value="x" align="center" onCommit={() => {}} />,
        );
        expect(container.querySelector('.oj-editable-label')!.className).toContain(
            'oj-editable-label--center',
        );
    });

    it('enters edit mode on double-click (uncontrolled) seeded with the value', () => {
        const { container } = render(<EditableLabel value="Bass" onCommit={() => {}} />);
        fireEvent.doubleClick(container.querySelector('.oj-editable-label__text')!);
        const input = container.querySelector('input') as HTMLInputElement;
        expect(input).not.toBeNull();
        expect(input.value).toBe('Bass');
        expect(container.querySelector('.oj-editable-label')!.className).toContain('is-editing');
    });

    it('enters edit mode on Enter from the resting label', () => {
        const { container } = render(<EditableLabel value="Bass" onCommit={() => {}} />);
        fireEvent.keyDown(container.querySelector('.oj-editable-label__text')!, { key: 'Enter' });
        expect(container.querySelector('input')).not.toBeNull();
    });

    it('commits the trimmed draft on Enter and leaves edit mode', () => {
        const onCommit = vi.fn();
        const { container } = render(
            <EditableLabel value="Bass" defaultEditing onCommit={onCommit} />,
        );
        const input = container.querySelector('input') as HTMLInputElement;
        fireEvent.change(input, { target: { value: '  Lead  ' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onCommit).toHaveBeenCalledWith('Lead');
        expect(container.querySelector('input')).toBeNull();
    });

    it('commits on blur', () => {
        const onCommit = vi.fn();
        const { container } = render(
            <EditableLabel value="Bass" defaultEditing onCommit={onCommit} />,
        );
        const input = container.querySelector('input') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'Pad' } });
        fireEvent.blur(input);
        expect(onCommit).toHaveBeenCalledWith('Pad');
    });

    it('reverts and calls onCancel on Escape without committing', () => {
        const onCommit = vi.fn();
        const onCancel = vi.fn();
        const { container } = render(
            <EditableLabel value="Bass" defaultEditing onCommit={onCommit} onCancel={onCancel} />,
        );
        const input = container.querySelector('input') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'Throwaway' } });
        fireEvent.keyDown(input, { key: 'Escape' });
        expect(onCancel).toHaveBeenCalled();
        expect(onCommit).not.toHaveBeenCalled();
        const rested = container.querySelector('.oj-editable-label__text')!;
        expect(rested.textContent).toBe('Bass');
    });

    it('controlled: stays in edit mode after Escape (parent owns the flag)', () => {
        const onCancel = vi.fn();
        const { container } = render(
            <EditableLabel value="Bass" editing onCommit={() => {}} onCancel={onCancel} />,
        );
        fireEvent.keyDown(container.querySelector('input')!, { key: 'Escape' });
        expect(onCancel).toHaveBeenCalled();
        // The component did not flip its own state — the input is still mounted.
        expect(container.querySelector('input')).not.toBeNull();
    });

    it('controlled: does not enter edit mode on its own from a double-click', () => {
        const { container } = render(
            <EditableLabel value="Bass" editing={false} onCommit={() => {}} />,
        );
        fireEvent.doubleClick(container.querySelector('.oj-editable-label__text')!);
        expect(container.querySelector('input')).toBeNull();
    });

    it('merges a custom className onto the wrapper', () => {
        const { container } = render(
            <EditableLabel value="x" className="mine" onCommit={() => {}} />,
        );
        expect(container.querySelector('.oj-editable-label')!.className).toContain('mine');
    });
});
