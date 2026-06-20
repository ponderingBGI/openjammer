import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Field } from './Field';

describe('Field', () => {
    it('renders a label wrapping the control', () => {
        const { container, getByText } = render(
            <Field label="Gain">
                <input />
            </Field>,
        );
        expect(getByText('Gain')).toBeTruthy();
        expect(container.querySelector('label.oj-field input')).toBeTruthy();
    });

    it('adds the row modifier when inline', () => {
        const { container } = render(
            <Field label="x" row>
                <input />
            </Field>,
        );
        expect(container.querySelector('.oj-field')!.className).toContain('oj-field--row');
    });
});
