import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { List, ListRow } from './ListRow';

const listRowCss = readFileSync('packages/oj-ui/src/components/ListRow/ListRow.css', 'utf8');

describe('List', () => {
    it('renders the base class and defaults to role=list', () => {
        const { container } = render(<List>x</List>);
        const list = container.querySelector('.oj-list')!;
        expect(list.className).toContain('oj-list');
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
    it('pins the shared 8px menu-row radius and contrast-safe current dot', () => {
        expect(listRowCss).toMatch(/\.oj-list-row\s*\{[\s\S]*?border-radius:\s*8px;/);
        expect(listRowCss).toMatch(/\.is-current[\s\S]*?background:\s*var\(--accent-ink\)/);
        expect(listRowCss).not.toMatch(/\.is-current[\s\S]*?background:\s*var\(--accent-secondary\)/);
    });

    /*
     * THE ROW OWNS ITS OWN ROW (W5-P7b non-blocking 12).
     *
     * `.oj-list-row__body` declared only `flex: 1; min-width: 0`, so its
     * children stayed inline: the Library's 8px tag dot rendered 0×0 and every
     * consumer that wanted a row of parts had to re-declare the same three lines
     * (six of them did). The component declares it once now. On the pre-fix
     * sheet this test finds no `display` in the body rule at all.
     */
    it('declares the body as the flex row its consumers kept re-declaring', () => {
        const body = /\.oj-list-row__body\s*\{([^}]*)\}/.exec(listRowCss)?.[1] ?? '';
        expect(body).toMatch(/display:\s*flex;/);
        expect(body).toMatch(/align-items:\s*center;/);
        expect(body).toMatch(/gap:\s*var\(--space-xs\);/);
        expect(body).toMatch(/min-width:\s*0;/);
    });

    /*
     * ...but not when the body IS the text. `text-overflow: ellipsis` applies to
     * block containers only, so a blanket flex box would have swapped the
     * command bar's rewind ellipsis for a hard clip — a consumer file this lane
     * does not own. The escape hatch is part of the fix, not an afterthought.
     */
    it('keeps a plain-text body a block box so a consumer ellipsis still fires', () => {
        expect(listRowCss).toMatch(/\.oj-list-row__body:not\(:has\(\*\)\)\s*\{[^}]*display:\s*block;/s);
        expect(listRowCss, 'a lone wrapper still fills the body the way a block box did').toMatch(/\.oj-list-row__body\s*>\s*:only-child\s*\{[^}]*flex:\s*1;/s);
    });

    it('paints the current dot as a real box in both body shapes', () => {
        const { container } = render(<ListRow current><span>Row</span></ListRow>);
        const body = container.querySelector('.oj-list-row__body')!;
        expect(body.querySelector('span')).not.toBeNull();
        // 4px of margin + the body's 4px gap in a flex body; the full 8px when
        // the body is plain text and there is no gap to add.
        expect(listRowCss).toMatch(/\.oj-list-row\.is-current \.oj-list-row__body::before\s*\{[^}]*margin-right:\s*var\(--space-xs\);/s);
        expect(listRowCss).toMatch(/\.oj-list-row\.is-current \.oj-list-row__body:not\(:has\(\*\)\)::before\s*\{[^}]*margin-right:\s*var\(--space-sm\);/s);
    });

    it('renders the base class and wraps children in the body slot', () => {
        const { container } = render(<ListRow>Row</ListRow>);
        const row = container.querySelector('.oj-list-row')!;
        expect(row.className).toContain('oj-list-row');
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
