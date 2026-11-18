import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { StatusDot } from './StatusDot';

const statusDotCss = readFileSync('packages/oj-ui/src/components/StatusDot/StatusDot.css', 'utf8');

describe('StatusDot', () => {
    it('uses the contrast-safe ink tokens for ok and warn dots', () => {
        expect(statusDotCss).toMatch(/--ok\s*\{[\s\S]*?var\(--success-ink\)/);
        expect(statusDotCss).toMatch(/--warn\s*\{[\s\S]*?var\(--warning-ink\)/);
    });

    it('renders the base class and the status modifier', () => {
        const { container } = render(<StatusDot status="ok" />);
        const dot = container.querySelector('span')!;
        expect(dot.className).toContain('oj-status-dot');
    });

    it('mirrors the status onto the data-status attribute', () => {
        const { container } = render(<StatusDot status="bad" />);
        expect(container.querySelector('span')!.getAttribute('data-status')).toBe('bad');
    });

    it('applies the right modifier for each status', () => {
        const statuses = ['ok', 'warn', 'bad', 'idle', 'info'] as const;
        for (const status of statuses) {
            const { container } = render(<StatusDot status={status} />);
            const cls = container.querySelector('span')!.className;
            expect(cls).toContain(`oj-status-dot--${status}`);
        }
    });

    it('merges a caller className after the base classes', () => {
        const { container } = render(<StatusDot status="warn" className="extra" />);
        expect(container.querySelector('span')!.className).toContain('oj-status-dot');
    });

    it('forwards native props (title, aria-label, data-*)', () => {
        const { container } = render(
            <StatusDot status="info" title="state" aria-label="connected" data-testid="d" />,
        );
        const dot = container.querySelector('span')!;
        expect(dot.getAttribute('title')).toBe('state');
        expect(dot.getAttribute('aria-label')).toBe('connected');
        expect(dot.getAttribute('data-testid')).toBe('d');
    });
});
