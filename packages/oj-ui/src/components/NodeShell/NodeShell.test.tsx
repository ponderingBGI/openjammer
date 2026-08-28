import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { NodeShell } from './NodeShell';

const nodeShellCss = readFileSync(
    'packages/oj-ui/src/components/NodeShell/NodeShell.css',
    'utf8',
);

function rule(selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return nodeShellCss.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
}

describe('NodeShell', () => {
    it('renders the title, type chip and content', () => {
        const { container, getByText } = render(
            <NodeShell title="Looper" nodeType="audio">
                body
            </NodeShell>,
        );
        expect(getByText('Looper')).toBeTruthy();
        expect(container.querySelector('.oj-node__type')!.textContent).toBe('audio');
        expect(container.querySelector('.oj-node__content')!.textContent).toBe('body');
    });

    it('renders the 2x2 grip dots in the header by default and hides them on request', () => {
        const { container } = render(<NodeShell title="t">x</NodeShell>);
        const grip = container.querySelector('.oj-node__header .oj-node__grip')!;
        expect(grip.querySelectorAll('i')).toHaveLength(4);
        expect(grip.getAttribute('aria-hidden')).toBe('true');

        const { container: noGrip } = render(
            <NodeShell title="t" grip={false}>
                x
            </NodeShell>,
        );
        expect(noGrip.querySelector('.oj-node__grip')).toBeNull();
    });

    it('applies selected / dragging / agent-pending state classes', () => {
        const { container } = render(
            <NodeShell title="t" selected dragging agentPending>
                x
            </NodeShell>,
        );
        const cls = container.querySelector('.oj-node')!.className;
        expect(cls).toContain('is-selected');
        expect(cls).toContain('is-dragging');
        expect(cls).toContain('is-agent-pending');
    });

    it('keeps mouse selection to a 1.5px edge and reserves the focus ring for focus-visible', () => {
        const selected = rule('.oj-node.is-selected');
        const focused = rule('.oj-node:focus-visible');
        const selectedAndFocused = rule('.oj-node.is-selected:focus-visible');

        expect(selected).toContain('inset 0 0 0 0.5px var(--accent-primary)');
        expect(selected).not.toContain('var(--focus-ring)');
        expect(focused).toContain('var(--focus-ring)');
        expect(selectedAndFocused).toContain('var(--focus-ring)');
    });

    it('omits the type chip when nodeType is not given', () => {
        const { container } = render(<NodeShell title="t">x</NodeShell>);
        expect(container.querySelector('.oj-node__type')).toBeNull();
    });

    it('opens the body with the port row: inputs left, outputs right', () => {
        const { container } = render(
            <NodeShell title="t" inputs={<span data-testid="in" />} outputs={<span data-testid="out" />}>
                <div data-testid="body" />
            </NodeShell>,
        );
        const content = container.querySelector('.oj-node__content')!;
        const ports = content.querySelector('.oj-node__ports')!;
        // D7: the sockets live INSIDE the body padding, as its first row.
        expect(content.firstElementChild).toBe(ports);
        expect(ports.querySelector('.oj-node__ports-in [data-testid="in"]')).toBeTruthy();
        expect(ports.querySelector('.oj-node__ports-out [data-testid="out"]')).toBeTruthy();
    });

    it('omits the port row entirely when no ports are given', () => {
        const { container } = render(<NodeShell title="t">x</NodeShell>);
        expect(container.querySelector('.oj-node__ports')).toBeNull();
    });

    it('omits the port row when the port slots are empty arrays', () => {
        const { container } = render(
            <NodeShell title="t" inputs={[]} outputs={[]}>
                x
            </NodeShell>,
        );
        expect(container.querySelector('.oj-node__ports')).toBeNull();
    });

    it('forwards headerProps to the drag handle and renders a headerAction', () => {
        const { container } = render(
            <NodeShell
                title="t"
                headerProps={{ 'aria-label': 'drag' } as React.HTMLAttributes<HTMLDivElement>}
                headerAction={<button type="button">open</button>}
            >
                x
            </NodeShell>,
        );
        const header = container.querySelector('.oj-node__header')!;
        expect(header.getAttribute('aria-label')).toBe('drag');
        expect(header.querySelector('button')!.textContent).toBe('open');
    });
});
