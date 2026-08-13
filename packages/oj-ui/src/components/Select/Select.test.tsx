import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Select } from './Select';

describe('Select', () => {
    it('renders a select with the base class and its options', () => {
        const { container } = render(
            <Select defaultValue="a">
                <option value="a">A</option>
                <option value="b">B</option>
            </Select>,
        );
        const el = container.querySelector('select')!;
        expect(el.className).toBe('oj-select');
        expect(el.querySelectorAll('option').length).toBe(2);
    });
});
