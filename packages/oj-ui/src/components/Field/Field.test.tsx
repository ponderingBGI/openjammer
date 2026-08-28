import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Field } from './Field';

describe('Field', () => {
    it('renders a label associated with the control', () => {
        const { container, getByText } = render(
            <Field label="Gain">
                <input />
            </Field>,
        );
        expect(getByText('Gain')).toBeTruthy();
        const control = screen.getByRole('textbox', { name: 'Gain' });
        expect(control.id).toMatch(/^oj-field-/);
        expect(container.querySelector('label.oj-field__label')!.getAttribute('for')).toBe(
            control.id,
        );
    });

    it('adds the row modifier when inline', () => {
        const { container } = render(
            <Field label="x" row>
                <input />
            </Field>,
        );
        expect(container.querySelector('.oj-field')!.className).toContain('oj-field--row');
    });
    it('renders the description and error slots only when provided', () => {
        const { container: bare } = render(
            <Field label="x">
                <input />
            </Field>,
        );
        expect(bare.querySelector('.oj-field__description')).toBeNull();
        expect(bare.querySelector('.oj-field__error')).toBeNull();

        const { container } = render(
            <Field label="Tempo" description="Beats per minute." error="Out of range.">
                <input />
            </Field>,
        );
        expect(container.querySelector('.oj-field__description')!.textContent).toBe(
            'Beats per minute.',
        );
        expect(container.querySelector('.oj-field__error')!.textContent).toBe('Out of range.');
    });

    it('forwards htmlFor so the label names the control', () => {
        const { container } = render(
            <Field label="Gain" htmlFor="g">
                <input id="g" />
            </Field>,
        );
        expect(container.querySelector('label.oj-field__label')!.getAttribute('for')).toBe('g');
    });

    it('keeps the accessible name exact and describes the control separately', () => {
        render(
            <Field
                label="Tempo"
                htmlFor="tempo"
                description="Beats per minute."
                error="Out of range."
            >
                <input id="tempo" aria-describedby="existing-help" />
            </Field>,
        );
        const control = screen.getByRole('textbox', { name: 'Tempo' });
        expect(control).toHaveAccessibleName('Tempo');
        expect(control).toHaveAttribute('aria-invalid', 'true');
        const ids = control.getAttribute('aria-describedby')!.split(' ');
        expect(ids).toEqual(['existing-help', 'tempo-description', 'tempo-error']);
        expect(document.getElementById(ids[1]!)!.textContent).toBe('Beats per minute.');
        expect(document.getElementById(ids[2]!)!.textContent).toBe('Out of range.');
        expect(screen.getByRole('alert')).toHaveTextContent('Out of range.');
    });
});
