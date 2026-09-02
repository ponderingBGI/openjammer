import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { TransportPill } from './TransportPill';

afterEach(() => vi.useRealTimers());

describe('TransportPill', () => {
    it('renders only the zones it is given', () => {
        const { container } = render(<TransportPill playing={false} onPlayToggle={() => {}} />);
        expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Record' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Loop' })).toBeNull();
        expect(container.querySelectorAll('.oj-transport__zone')).toHaveLength(1);
    });

    it('flips the play button between Play and Stop', () => {
        const onPlayToggle = vi.fn();
        const { rerender } = render(<TransportPill playing={false} onPlayToggle={onPlayToggle} />);
        fireEvent.click(screen.getByRole('button', { name: 'Play' }));
        expect(onPlayToggle).toHaveBeenCalledTimes(1);

        rerender(<TransportPill playing onPlayToggle={onPlayToggle} />);
        expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
    });

    it('never pulses while the transport is rolling', () => {
        const { container, rerender } = render(<TransportPill playing={false} pulse onPlayToggle={() => {}} />);
        expect(container.querySelector('.oj-transport__play')?.className).toContain('is-attn');
        rerender(<TransportPill playing pulse onPlayToggle={() => {}} />);
        expect(container.querySelector('.oj-transport__play')?.className).not.toContain('is-attn');
    });

    it('disables record with the honest reason rather than a shrug', () => {
        render(
            <TransportPill
                playing={false}
                onPlayToggle={() => {}}
                record={{ recording: false, disabled: true, disabledReason: 'Arm a track first', onToggle: () => {} }}
            />,
        );
        const button = screen.getByRole('button', { name: 'Record' }) as HTMLButtonElement;
        expect(button.disabled).toBe(true);
        expect(button.title).toBe('Arm a track first');
    });

    it('shows the pending position in the muted voice', () => {
        const { container, rerender } = render(
            <TransportPill playing={false} onPlayToggle={() => {}} position={{ display: '3.2' }} />,
        );
        expect(container.querySelector('.oj-transport__position')?.className).not.toContain('is-pending');
        rerender(<TransportPill playing={false} onPlayToggle={() => {}} position={{ display: '3.2', pending: true }} />);
        expect(container.querySelector('.oj-transport__position')?.className).toContain('is-pending');
    });

    it('seeks with the typed position on Enter', () => {
        const onSeek = vi.fn();
        render(<TransportPill playing={false} onPlayToggle={() => {}} position={{ display: '1.1', onSeek }} />);
        fireEvent.click(screen.getByRole('button', { name: 'Playhead at 1.1' }));
        const input = screen.getByLabelText('Go to position') as HTMLInputElement;
        fireEvent.change(input, { target: { value: '9.3' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onSeek).toHaveBeenCalledWith('9.3');
    });

    describe('tempo', () => {
        function Host({ onCommit }: { onCommit: (v: number) => void }) {
            const [value, setValue] = useState(120);
            return (
                <TransportPill
                    playing={false}
                    onPlayToggle={() => {}}
                    tempo={{ value, onCommit: (v) => { setValue(v); onCommit(v); } }}
                />
            );
        }

        function drag(dx: number, modifiers: { shiftKey?: boolean; altKey?: boolean } = {}) {
            const el = screen.getByRole('button', { name: /^Tempo/ });
            fireEvent.pointerDown(el, { button: 0, clientX: 200 });
            act(() => {
                fireEvent.pointerMove(window, { clientX: 200 + dx, ...modifiers });
            });
            act(() => {
                fireEvent.pointerUp(window);
            });
        }

        it('commits exactly ONE setTempo per drag, at 3px per BPM', () => {
            const onCommit = vi.fn();
            render(<Host onCommit={onCommit} />);
            drag(90);
            expect(onCommit).toHaveBeenCalledTimes(1);
            expect(onCommit).toHaveBeenCalledWith(150);
        });

        it('honours Shift for fine and Alt for coarse', () => {
            const onCommit = vi.fn();
            const { unmount } = render(<Host onCommit={onCommit} />);
            drag(90, { shiftKey: true });
            expect(onCommit).toHaveBeenLastCalledWith(123);
            unmount();

            render(<Host onCommit={onCommit} />);
            drag(6, { altKey: true });
            expect(onCommit).toHaveBeenLastCalledWith(130);
        });

        it('clamps to 20–300 whatever the gesture asks for', () => {
            const onCommit = vi.fn();
            const { unmount } = render(<Host onCommit={onCommit} />);
            drag(3000);
            expect(onCommit).toHaveBeenLastCalledWith(300);
            unmount();

            render(<Host onCommit={onCommit} />);
            drag(-3000);
            expect(onCommit).toHaveBeenLastCalledWith(20);
        });

        it('does not commit when the pointer never moved', () => {
            const onCommit = vi.fn();
            render(<Host onCommit={onCommit} />);
            drag(0);
            expect(onCommit).not.toHaveBeenCalled();
        });

        it('is inert and explains itself when there is no song', () => {
            render(
                <TransportPill
                    playing={false}
                    onPlayToggle={() => {}}
                    tempo={{ value: 120, onCommit: () => {}, disabled: true, disabledReason: 'Add a Song to set the tempo' }}
                />,
            );
            const el = screen.getByRole('button', { name: 'Tempo 120 BPM' });
            expect(el.getAttribute('aria-disabled')).toBe('true');
            expect(el.getAttribute('tabindex')).toBe('-1');
            expect(el.getAttribute('title')).toBe('Add a Song to set the tempo');
        });

        it('steps with the arrow keys and clamps there too', () => {
            const onCommit = vi.fn();
            render(<Host onCommit={onCommit} />);
            const el = screen.getByRole('button', { name: /^Tempo/ });
            fireEvent.keyDown(el, { key: 'ArrowUp' });
            expect(onCommit).toHaveBeenLastCalledWith(121);
            fireEvent.keyDown(el, { key: 'ArrowDown', shiftKey: true });
            expect(onCommit).toHaveBeenLastCalledWith(111);
        });
    });

    it('opens the count-in popover on right-click and reports the choice', () => {
        const onCountIn = vi.fn();
        const onToggle = vi.fn();
        render(
            <TransportPill
                playing={false}
                onPlayToggle={() => {}}
                metronome={{ on: false, countInBars: 0, onToggle, onCountIn }}
            />,
        );
        const button = screen.getByRole('button', { name: 'Metronome' });
        fireEvent.contextMenu(button);
        fireEvent.click(screen.getByRole('menuitemradio', { name: '2 bars' }));
        expect(onCountIn).toHaveBeenCalledWith(2);
        expect(onToggle).not.toHaveBeenCalled();
    });

    it('toggles the click on a plain press', () => {
        const onToggle = vi.fn();
        render(
            <TransportPill
                playing={false}
                onPlayToggle={() => {}}
                metronome={{ on: false, countInBars: 0, onToggle, onCountIn: () => {} }}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Metronome' }));
        expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('exposes loop as a pressed toggle', () => {
        const onToggle = vi.fn();
        render(<TransportPill playing={false} onPlayToggle={() => {}} loop={{ on: true, onToggle }} />);
        const loop = screen.getByRole('button', { name: 'Loop' });
        expect(loop.getAttribute('aria-pressed')).toBe('true');
        fireEvent.click(loop);
        expect(onToggle).toHaveBeenCalled();
    });

    describe('the second Stop', () => {
        /**
         * Name the mark the one transport button is drawing, by its geometry
         * rather than by its class. The `is-return-armed` class carries no
         * styling of its own, so asserting on it would prove nothing a player
         * can see; the shapes are the thing the hand reads. A lone filled
         * triangle is Play, a lone rounded square is Stop, and bar + triangle
         * is the rewind mark of the armed second Stop.
         */
        function transportGlyph(container: HTMLElement) {
            const svg = container.querySelector('.oj-transport__play svg');
            if (!svg) return 'none';
            const paths = svg.querySelectorAll('path').length;
            const rects = svg.querySelectorAll('rect').length;
            if (paths === 1 && rects === 0) return 'play';
            if (paths === 0 && rects === 1) return 'stop';
            if (paths === 1 && rects === 1) return 'rewind';
            return `unknown (${paths} paths, ${rects} rects)`;
        }

        it('swaps the play triangle for a filled rewind mark when armed', () => {
            const { container, rerender } = render(<TransportPill playing={false} onPlayToggle={() => {}} />);
            expect(transportGlyph(container)).toBe('play');

            rerender(<TransportPill playing={false} returnArmed onPlayToggle={() => {}} />);
            expect(transportGlyph(container)).toBe('rewind');

            // Both marks are SOLID. The hairline `ReturnGlyph` sits two controls
            // away and means "to bar 1"; if this one ever drifts into the same
            // outline, a hand would learn the two ticks as one and trust it.
            const marks = [...container.querySelectorAll('.oj-transport__play svg > *')];
            expect(marks).toHaveLength(2);
            expect(marks.map((m) => m.getAttribute('fill'))).toEqual(['currentColor', 'currentColor']);
        });

        it('names the armed second Stop in both the label and the tooltip', () => {
            const onPlayToggle = vi.fn();
            const { rerender } = render(
                <TransportPill playing={false} returnArmed hint="space" onPlayToggle={onPlayToggle} />,
            );
            const button = screen.getByRole('button', { name: 'Return to where playback started' });
            expect(button.getAttribute('title')).toBe('Return to where playback started (space)');

            // A press is still the ONE transport gesture — the owner decides what
            // it means, the pill only tells the truth about which state it is in.
            fireEvent.click(button);
            expect(onPlayToggle).toHaveBeenCalledTimes(1);

            rerender(<TransportPill playing={false} returnArmed returnLabel="Return to 5.1" onPlayToggle={onPlayToggle} />);
            const renamed = screen.getByRole('button', { name: 'Return to 5.1' });
            expect(renamed.getAttribute('title')).toBe('Return to 5.1');
        });

        it('ignores returnArmed while the transport rolls', () => {
            const { container, rerender } = render(
                <TransportPill playing={false} returnArmed onPlayToggle={() => {}} />,
            );
            expect(transportGlyph(container)).toBe('rewind');

            // The worst lie this component can tell is a stop square over a
            // rolling transport — so `playing` wins outright, however the owner
            // left the arming flag.
            rerender(<TransportPill playing returnArmed onPlayToggle={() => {}} />);
            expect(transportGlyph(container)).toBe('stop');
            expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
            expect(container.querySelector('.oj-transport__play')?.className).not.toContain('is-return-armed');

            rerender(<TransportPill playing={false} returnArmed onPlayToggle={() => {}} />);
            expect(transportGlyph(container)).toBe('rewind');
        });

        it('is Play, plainly, when nothing is armed', () => {
            const { container } = render(<TransportPill playing={false} hint="space" onPlayToggle={() => {}} />);
            expect(transportGlyph(container)).toBe('play');
            const button = screen.getByRole('button', { name: 'Play' });
            expect(button.getAttribute('title')).toBe('Play (space)');
            expect(button.className).not.toContain('is-return-armed');
        });
    });

    it('keeps every control in tab order, left to right', () => {
        const { container } = render(
            <TransportPill
                playing={false}
                onPlayToggle={() => {}}
                onReturnToStart={() => {}}
                record={{ recording: false, onToggle: () => {} }}
                position={{ display: '1.1', onSeek: () => {} }}
                tempo={{ value: 120, onCommit: () => {} }}
                loop={{ on: false, onToggle: () => {} }}
                metronome={{ on: false, countInBars: 0, onToggle: () => {}, onCountIn: () => {} }}
                hint="space"
            />,
        );
        const focusables = [...container.querySelectorAll<HTMLElement>('button, [tabindex]')]
            .filter((el) => el.getAttribute('tabindex') !== '-1');
        expect(focusables.map((el) => el.getAttribute('aria-label'))).toEqual([
            'Play',
            'Record',
            'Return to start',
            'Playhead at 1.1',
            'Tempo 120 BPM',
            'Loop',
            'Metronome',
        ]);
    });
});
