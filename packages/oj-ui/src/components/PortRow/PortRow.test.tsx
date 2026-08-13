import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PortRow } from './PortRow';

describe('PortRow', () => {
    it('renders the base + side class and the label text', () => {
        const { container } = render(<PortRow side="input" kind="control" label="Trigger" />);
        const row = container.querySelector('.oj-port-row')!;
        expect(row.className).toContain('oj-port-row--input');
        expect(row.querySelector('.oj-port-row__label')!.textContent).toBe('Trigger');
    });

    it('renders a Port with the row direction and kind color', () => {
        const { container } = render(<PortRow side="output" kind="audio" label="Out" />);
        const port = container.querySelector('.oj-port')!;
        expect(port.className).toContain('oj-port--audio-output');
    });

    it('reverses to output layout', () => {
        const { container } = render(<PortRow side="output" kind="audio" label="Out" />);
        expect(container.querySelector('.oj-port-row')!.className).toContain('oj-port-row--output');
    });

    it('propagates connected to the row and the Port', () => {
        const { container } = render(<PortRow side="input" kind="audio" label="In" connected />);
        expect(container.querySelector('.oj-port-row')!.className).toContain('is-connected');
        expect(container.querySelector('.oj-port')!.className).toContain('is-connected');
    });

    it('uses resolvedKind for a connected universal port color', () => {
        const { container } = render(
            <PortRow side="output" kind="universal" label="R" connected resolvedKind="audio" />,
        );
        expect(container.querySelector('.oj-port')!.className).toContain('oj-port--audio-output');
    });

    it('marks a placeholder row and Port', () => {
        const { container } = render(
            <PortRow side="input" kind="universal" label="+ Add" placeholder />,
        );
        expect(container.querySelector('.oj-port-row')!.className).toContain('is-placeholder');
        expect(container.querySelector('.oj-port')!.className).toContain('is-placeholder');
    });

    it('hides the label visually but keeps it in the DOM', () => {
        const { container } = render(
            <PortRow side="input" kind="audio" label="Quiet" hideLabel />,
        );
        const label = container.querySelector('.oj-port-row__label')!;
        expect(label.className).toContain('oj-port-row__label--hidden');
        expect(label.textContent).toBe('Quiet');
    });

    it('renders editableLabel in place of the static label', () => {
        const { container } = render(
            <PortRow
                side="input"
                kind="control"
                label="Note"
                editableLabel={<input data-testid="edit" defaultValue="Note" />}
            />,
        );
        expect(container.querySelector('input[data-testid="edit"]')).not.toBeNull();
        expect(container.querySelector('.oj-port-row__label--hidden')).toBeNull();
    });

    it('forwards data attributes and pointer handlers to the Port (the connection target)', () => {
        const onPointerDown = vi.fn();
        const { container } = render(
            <PortRow
                side="output"
                kind="audio"
                label="Out"
                data-node-id="n1"
                data-port-id="p1"
                data-port-type="audio"
                onPointerDown={onPointerDown}
            />,
        );
        const port = container.querySelector('.oj-port')!;
        expect(port.getAttribute('data-node-id')).toBe('n1');
        expect(port.getAttribute('data-port-id')).toBe('p1');
        expect(port.getAttribute('data-port-type')).toBe('audio');
    });

    it('merges a custom className onto the row', () => {
        const { container } = render(
            <PortRow side="input" kind="audio" label="In" className="extra" />,
        );
        expect(container.querySelector('.oj-port-row')!.className).toContain('extra');
    });
});
