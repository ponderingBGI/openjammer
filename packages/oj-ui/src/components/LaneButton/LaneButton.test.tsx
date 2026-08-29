import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { LaneButton } from './LaneButton';

const laneButtonCss = readFileSync(
    'packages/oj-ui/src/components/LaneButton/LaneButton.css',
    'utf8',
);

describe('LaneButton', () => {
    it('pins tone inks and the reduced-motion recording ring', () => {
        expect(laneButtonCss).toMatch(/--mute[\s\S]*?var\(--warning-ink\)/);
        expect(laneButtonCss).toMatch(/--solo[\s\S]*?var\(--accent-ink\)/);
        expect(laneButtonCss).toMatch(/--armed[\s\S]*?var\(--danger-ink\)/);
        expect(laneButtonCss).toMatch(/1200ms/);
        expect(laneButtonCss).toMatch(/prefers-reduced-motion[\s\S]*?animation:\s*none;[\s\S]*?2px var\(--danger-ink\)/);
    });
    it('preserves the accessible name, pressed state, tone and click contract', () => {
        const onClick = vi.fn();
        const { getByRole } = render(
            <LaneButton tone="mute" aria-label="Mute drums" aria-pressed onClick={onClick}>M</LaneButton>,
        );
        const button = getByRole('button', { name: 'Mute drums', pressed: true });
        expect(button.className).toContain('oj-lane-button--mute');
        fireEvent.click(button);
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('defaults to a button and forwards disabled', () => {
        const { getByRole } = render(<LaneButton disabled aria-label="Arm">●</LaneButton>);
        const button = getByRole('button', { name: 'Arm' }) as HTMLButtonElement;
        expect(button.type).toBe('button');
        expect(button.disabled).toBe(true);
    });
});
