import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { NodeShell } from './NodeShell';

describe('NodeShell', () => {
    it('renders the title, type label and content', () => {
        const { container, getByText } = render(
            <NodeShell title="Looper" nodeType="audio">
                body
            </NodeShell>,
        );
        expect(getByText('Looper')).toBeTruthy();
        expect(getByText('audio')).toBeTruthy();
        expect(container.querySelector('.oj-node__content')!.textContent).toBe('body');
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

    it('omits the type label when nodeType is not given', () => {
        const { container } = render(<NodeShell title="t">x</NodeShell>);
        expect(container.querySelector('.oj-node__type')).toBeNull();
    });

    it('renders the input/output port rails when given', () => {
        const { container } = render(
            <NodeShell title="t" inputs={<span data-testid="in" />} outputs={<span data-testid="out" />}>
                body
            </NodeShell>,
        );
        expect(container.querySelector('.oj-node__ports')).toBeTruthy();
        expect(container.querySelector('.oj-node__ports-left [data-testid="in"]')).toBeTruthy();
        expect(container.querySelector('.oj-node__ports-right [data-testid="out"]')).toBeTruthy();
    });

    it('omits the port rail entirely when no ports are given', () => {
        const { container } = render(<NodeShell title="t">x</NodeShell>);
        expect(container.querySelector('.oj-node__ports')).toBeNull();
    });
});
