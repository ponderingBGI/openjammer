import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import {
    IconClose,
    IconChevronDown,
    IconChevronRight,
    IconMute,
    IconSpeaker,
    IconDownload,
    IconBolt,
    IconCheck,
    IconWarning,
    IconWindows,
    IconApple,
    IconLinux,
} from './Icons';

describe('Icons', () => {
    it('renders an svg with the base class and the default 16px size', () => {
        const { container } = render(<IconClose />);
        const svg = container.querySelector('svg')!;
        expect(svg).not.toBeNull();
        expect(svg.getAttribute('class')).toBe('oj-icon');
        expect(svg.getAttribute('width')).toBe('16');
        expect(svg.getAttribute('height')).toBe('16');
    });

    it('inherits text color via currentColor on stroke or fill', () => {
        const stroked = render(<IconCheck />).container.querySelector('svg')!;
        expect(stroked.getAttribute('stroke')).toBe('currentColor');

        const filled = render(<IconWindows />).container.querySelector('svg')!;
        expect(filled.getAttribute('fill')).toBe('currentColor');
    });

    it('is decorative (aria-hidden, no title) when no title is given', () => {
        const { container } = render(<IconBolt />);
        const svg = container.querySelector('svg')!;
        expect(svg.getAttribute('aria-hidden')).toBe('true');
        expect(svg.getAttribute('role')).toBeNull();
        expect(container.querySelector('title')).toBeNull();
    });

    it('exposes role=img + <title> + aria-label when titled', () => {
        const { container } = render(<IconWarning title="Heads up" />);
        const svg = container.querySelector('svg')!;
        expect(svg.getAttribute('role')).toBe('img');
        expect(svg.getAttribute('aria-label')).toBe('Heads up');
        expect(svg.getAttribute('aria-hidden')).toBeNull();
        expect(container.querySelector('title')!.textContent).toBe('Heads up');
    });

    it('applies the size prop to width and height', () => {
        const { container } = render(<IconSpeaker size={32} />);
        const svg = container.querySelector('svg')!;
        expect(svg.getAttribute('width')).toBe('32');
        expect(svg.getAttribute('height')).toBe('32');
    });

    it('merges a custom className after the base class', () => {
        const { container } = render(<IconMute className="extra" />);
        expect(container.querySelector('svg')!.getAttribute('class')).toBe('oj-icon extra');
    });

    it('spreads native svg props (onClick, data-*)', () => {
        const onClick = vi.fn();
        const { container } = render(<IconDownload data-testid="dl" onClick={onClick} />);
        const svg = container.querySelector('svg')!;
        expect(svg.getAttribute('data-testid')).toBe('dl');
        svg.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('renders every named icon as an svg', () => {
        const icons = [
            IconClose,
            IconChevronDown,
            IconChevronRight,
            IconMute,
            IconSpeaker,
            IconDownload,
            IconBolt,
            IconCheck,
            IconWarning,
            IconWindows,
            IconApple,
            IconLinux,
        ];
        for (const IconComp of icons) {
            const { container } = render(<IconComp />);
            expect(container.querySelector('svg')).not.toBeNull();
        }
    });
});
