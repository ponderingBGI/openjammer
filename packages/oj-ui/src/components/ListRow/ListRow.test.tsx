import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { List, ListRow } from './ListRow';

describe('List', () => {
    it('renders the base class and defaults to role=list', () => {
        const { container } = render(<List>x</List>);
        const list = container.querySelector('.oj-list')!;
        expect(list.className).toBe('oj-list');
        expect(list.getAttribute('role')).toBe('list');
    });

    it('forwards role, aria-label and extra props', () => {
        const { container } = render(
            <List role="listbox" aria-label="Models" className="extra">
                x
            </List>,
        );
        const list = container.querySelector('.oj-list')!;
        expect(list.getAttribute('role')).toBe('listbox');
        expect(list.getAttribute('aria-label')).toBe('Models');
        expect(list.className).toContain('extra');
    });
});

describe('ListRow', () => {
    it('renders the base class and wraps children in the body slot', () => {
        const { container } = render(<ListRow>Row</ListRow>);
        const row = container.querySelector('.oj-list-row')!;
        expect(row.className).toBe('oj-list-row');
        expect(row.querySelector('.oj-list-row__body')!.textContent).toBe('Row');
    });

    it('omits state modifiers and aria attrs when at rest', () => {
        const { container } = render(<ListRow>r</ListRow>);
        const row = container.querySelector('.oj-list-row')!;
        expect(row.className).not.toContain('is-');
        expect(row.getAttribute('aria-selected')).toBe(null);
        expect(row.getAttribute('aria-current')).toBe(null);
        expect(row.getAttribute('aria-disabled')).toBe(null);
    });

    it('applies selected, current and disabled modifiers with matching aria', () => {
        const { container } = render(
            <ListRow selected current disabled>
                r
            </ListRow>,
        );
        const row = container.querySelector('.oj-list-row')!;
        expect(row.className).toContain('is-selected');
        expect(row.className).toContain('is-current');
        expect(row.className).toContain('is-disabled');
        expect(row.getAttribute('aria-selected')).toBe('true');
        expect(row.getAttribute('aria-current')).toBe('true');
        expect(row.getAttribute('aria-disabled')).toBe('true');
    });

    it('renders the actions slot only when provided', () => {
        const { container: bare } = render(<ListRow>r</ListRow>);
        expect(bare.querySelector('.oj-list-row__actions')).toBe(null);

        const { container: withActions } = render(<ListRow actions={<button>go</button>}>r</ListRow>);
        const slot = withActions.querySelector('.oj-list-row__actions')!;
        expect(slot.querySelector('button')!.textContent).toBe('go');
    });

    it('forwards native props (onClick, aria-label)', () => {
        const onClick = vi.fn();
        const { container } = render(
            <ListRow onClick={onClick} aria-label="lbl">
                r
            </ListRow>,
        );
        const row = container.querySelector('.oj-list-row')! as HTMLDivElement;
        expect(row.getAttribute('aria-label')).toBe('lbl');
        row.click();
        expect(onClick).toHaveBeenCalledTimes(1);
    });
});
