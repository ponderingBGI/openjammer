import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Marquee } from './Marquee';

describe('Marquee', () => {
    it('renders the base class', () => {
        const { container } = render(<Marquee x={0} y={0} width={10} height={10} />);
        const el = container.querySelector('div')!;
        expect(el.className).toBe('oj-marquee');
    });

    it('positions and sizes from x/y/width/height', () => {
        const { container } = render(<Marquee x={12} y={34} width={56} height={78} />);
        const el = container.querySelector('div') as HTMLDivElement;
        expect(el.style.left).toBe('12px');
        expect(el.style.top).toBe('34px');
        expect(el.style.width).toBe('56px');
        expect(el.style.height).toBe('78px');
    });

    it('merges a custom className while keeping the base class', () => {
        const { container } = render(
            <Marquee x={0} y={0} width={1} height={1} className="extra" />,
        );
        const cls = container.querySelector('div')!.className;
        expect(cls).toContain('oj-marquee');
        expect(cls).toContain('extra');
    });

    it('lets caller style override merge without dropping position', () => {
        const { container } = render(
            <Marquee x={5} y={6} width={7} height={8} style={{ opacity: '0.5' }} />,
        );
        const el = container.querySelector('div') as HTMLDivElement;
        expect(el.style.left).toBe('5px');
        expect(el.style.opacity).toBe('0.5');
    });

    it('forwards native props (data-* and aria-hidden)', () => {
        const { container } = render(
            <Marquee x={0} y={0} width={1} height={1} data-testid="m" aria-hidden="true" />,
        );
        const el = container.querySelector('div')!;
        expect(el.getAttribute('data-testid')).toBe('m');
        expect(el.getAttribute('aria-hidden')).toBe('true');
    });
});
