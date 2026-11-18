import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const executor = {
    pauseContinuousSources: vi.fn(),
    resumeContinuousSources: vi.fn(),
    setArrangementLoop: vi.fn(),
    setArrangementPunch: vi.fn(),
    setArrangementClick: vi.fn(),
    setArrangementCountIn: vi.fn(),
    subscribeSignalLevels: () => () => {},
    subscribeTransport: () => () => {},
    startArrangementPreview: vi.fn(),
    updateArrangementPreview: vi.fn(),
    stopArrangementPreview: vi.fn(),
    seekArrangement: vi.fn(),
    getTimelineBackend: () => 'wasm',
};
vi.mock('../../../audio/executor', () => ({ getExecutor: () => executor, isTauri: () => false }));

const { useArrangementStore } = await import('../../../store/arrangementStore');
const { useAudioStore } = await import('../../../store/audioStore');
const { useTransportStore } = await import('../../../store/transportStore');
const { useUiViewStore } = await import('../../../store/uiViewStore');
const { TransportPillHost } = await import('../TransportPillHost');
const { parseBarBeat } = await import('../barBeat');
const { resolveKeydown } = await import('../../../keymap/arbiter');
const { buildBeatSong } = await import('../../../rigs');

describe('parseBarBeat', () => {
    it('reads the positions a musician actually types', () => {
        expect(parseBarBeat('1', 3840, 960)).toBe(0);
        expect(parseBarBeat('3.2', 3840, 960)).toBe(2 * 3840 + 960);
        expect(parseBarBeat('3.2.480', 3840, 960)).toBe(2 * 3840 + 960 + 480);
    });

    it('refuses to guess rather than seeking somewhere unasked', () => {
        expect(parseBarBeat('', 3840, 960)).toBeNull();
        expect(parseBarBeat('bar three', 3840, 960)).toBeNull();
        expect(parseBarBeat('1.2.3.4', 3840, 960)).toBeNull();
    });
});

describe('TransportPillHost', () => {
    beforeEach(() => {
        useArrangementStore.getState().setArrangement(null);
        useAudioStore.setState({ isAudioContextReady: false, currentMode: 1 });
        useTransportStore.setState({ isGloballyPaused: false });
        useUiViewStore.setState({ surface: 'canvas' });
        useArrangementStore.setState({ transportAwaitedCommand: null, transportError: null, transportPending: null });
        vi.clearAllMocks();
    });

    it('shows only the transport and the meter on a bare canvas', () => {
        render(<TransportPillHost onRequestAudio={vi.fn()} />);
        expect(screen.getByRole('button', { name: 'Start sound' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Record' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Loop' })).toBeNull();
        expect(screen.getByRole('meter', { name: 'Master output level' })).toBeInTheDocument();
    });

    it('says WHY the tempo is inert when there is no song', () => {
        render(<TransportPillHost onRequestAudio={vi.fn()} />);
        const tempo = screen.getByRole('button', { name: /^Tempo/ });
        expect(tempo.getAttribute('aria-disabled')).toBe('true');
        expect(tempo.getAttribute('title')).toBe('Add a Song node to set the tempo');
    });

    it('unlocks audio on the play gesture, then runs the transport', () => {
        const onRequestAudio = vi.fn();
        render(<TransportPillHost onRequestAudio={onRequestAudio} />);
        fireEvent.click(screen.getByRole('button', { name: 'Start sound' }));
        expect(onRequestAudio).toHaveBeenCalledTimes(1);
        expect(useTransportStore.getState().isGloballyPaused).toBe(true);
    });

    it('does not ask for audio twice once it is running', () => {
        useAudioStore.setState({ isAudioContextReady: true });
        const onRequestAudio = vi.fn();
        render(<TransportPillHost onRequestAudio={onRequestAudio} />);
        fireEvent.click(screen.getByRole('button', { name: 'Hold all sound' }));
        expect(onRequestAudio).not.toHaveBeenCalled();
    });

    it('pulses only before the first gesture has let sound through', () => {
        const { container, rerender } = render(<TransportPillHost onRequestAudio={vi.fn()} />);
        expect(container.querySelector('.oj-transport__play')?.className).toContain('is-attn');

        useAudioStore.setState({ isAudioContextReady: true });
        rerender(<TransportPillHost onRequestAudio={vi.fn()} />);
        expect(container.querySelector('.oj-transport__play')?.className).not.toContain('is-attn');
    });

    describe('with a song', () => {
        beforeEach(() => {
            useArrangementStore.getState().setArrangement(buildBeatSong());
            useAudioStore.setState({ isAudioContextReady: true });
        });

        it('opens every time zone and reads the playhead', () => {
            render(<TransportPillHost onRequestAudio={vi.fn()} />);
            expect(screen.getByRole('button', { name: 'Playhead at 1.1' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Loop' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Metronome' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Return to start' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: /^Tempo/ }).getAttribute('aria-disabled')).toBeNull();
        });

        it('refuses to record with a reason instead of a shrug', () => {
            render(<TransportPillHost onRequestAudio={vi.fn()} />);
            const record = screen.getByRole('button', { name: 'Record' }) as HTMLButtonElement;
            expect(record.disabled).toBe(true);
            expect(record.title).toMatch(/arm a track first/i);
        });

        it('drives the loop toggle through the engine', () => {
            render(<TransportPillHost onRequestAudio={vi.fn()} />);
            fireEvent.click(screen.getByRole('button', { name: 'Loop' }));
            expect(executor.setArrangementLoop).toHaveBeenCalled();
        });

        it('commits a clamped tempo through the arrangement store', () => {
            render(<TransportPillHost onRequestAudio={vi.fn()} />);
            const tempo = screen.getByRole('button', { name: /^Tempo/ });
            fireEvent.keyDown(tempo, { key: 'ArrowUp', shiftKey: true });
            expect(useArrangementStore.getState().arrangement!.tempoBpm).toBe(106);
        });

        /*
         * `isPlaying` is optimistic — it flips before the engine has said a word,
         * and when the acknowledgement never comes the 1.5 s timeout leaves it
         * TRUE beside a transportError. The pill is the one place a performer
         * looks to ask "is it running", so it waits for the engine's answer
         * rather than claiming Stop over a frozen playhead.
         */
        describe('the glyph tells the truth about the engine', () => {
            const transport = (patch: Partial<ReturnType<typeof useArrangementStore.getState>>) =>
                act(() => { useArrangementStore.setState(patch); });

            it('shows Play, with the readout muted, while a start is unconfirmed', () => {
                const { container } = render(<TransportPillHost onRequestAudio={vi.fn()} />);
                transport({ isPlaying: true, transportPending: 'play', transportError: null });

                expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
                expect(container.querySelector('.oj-transport__position')?.className).toContain('is-pending');
            });

            it('shows Play when the engine never acknowledged the command', () => {
                render(<TransportPillHost onRequestAudio={vi.fn()} />);
                transport({
                    isPlaying: true,
                    transportPending: null,
                    transportError: 'The audio engine did not acknowledge the transport command.',
                    transportAwaitedCommand: 'play',
                });

                expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
            });

            it('shows Stop once the engine has confirmed it is rolling', () => {
                const { container } = render(<TransportPillHost onRequestAudio={vi.fn()} />);
                transport({ isPlaying: true, transportPending: null, transportError: null });

                expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
                expect(container.querySelector('.oj-transport__position')?.className).not.toContain('is-pending');
            });

            it('does not flicker back to Play while seeking mid-roll', () => {
                render(<TransportPillHost onRequestAudio={vi.fn()} />);
                transport({ isPlaying: true, transportPending: 'seek', transportError: null });

                expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
            });

            /*
             * HA-03, the measured lie: with the glyph showing Play and
             * `isPlaying` still optimistically true, the press asked `isPlaying`
             * and STOPPED the song. A button that says Play must play. So the
             * glyph and the gesture read one predicate
             * (`transportAwaitingEngine`) and the press asks the engine again.
             */
            it('a button showing Play never stops the song — it asks again', () => {
                render(<TransportPillHost onRequestAudio={vi.fn()} />);
                transport({ isPlaying: true, transportPending: null, transportError: 'The audio engine did not acknowledge the transport command.', transportAwaitedCommand: 'play' });

                const play = screen.getByRole('button', { name: 'Play' });
                act(() => { fireEvent.click(play); });

                // Still trying to play — the press did not become a stop.
                expect(useArrangementStore.getState().isPlaying).toBe(true);
                expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
            });

            it('agrees with Space, because both read the same predicate', () => {
                render(<TransportPillHost onRequestAudio={vi.fn()} />);
                transport({ isPlaying: true, transportPending: 'play', transportError: null });

                act(() => { useTransportStore.getState().toggleGlobalPause(); });

                expect(useArrangementStore.getState().isPlaying).toBe(true);
            });

            /*
             * U7. The report used to render on the arrangement's sky band and
             * nowhere else — a surface the player is not looking at while they
             * press Play on the canvas. The pill is the one place a performer is
             * told about the transport.
             */
            /*
             * G-01. The reason belongs to the BUTTON that wears the warning dot
             * — that is what a pointer hovers and what a keyboard lands on. On
             * the surrounding `role="group"` it was unreachable: the button's
             * own hardcoded title still said "Play (space)", and a description
             * on a group is read on entry and never again.
             */
            it('carries the reason on the PLAY BUTTON, in ink and in words', () => {
                const { container } = render(<TransportPillHost onRequestAudio={vi.fn()} />);
                const reason = 'Track 1 has no instrument yet — choose one on the track and it will play.';
                transport({ isPlaying: true, transportPending: null, transportError: reason, transportAwaitedCommand: 'play' });

                expect(container.querySelector('.oj-transport-host')?.getAttribute('data-transport-fault')).toBe('true');
                const play = screen.getByRole('button', { name: 'Play' });
                expect(play.getAttribute('title')).toContain(reason);
                const describedBy = play.getAttribute('aria-describedby');
                expect(describedBy).not.toBeNull();
                expect(container.querySelector(`#${CSS.escape(describedBy!)}`)?.textContent).toContain(reason);
                // The hidden gesture that ends it is named where the dot is explained.
                expect(play.getAttribute('title')).toContain('Press Esc to stop');
            });

            /*
             * G-03. Escape is the ONE gesture that always means stop while a
             * start is unconfirmed — without it a performer had no way to end a
             * song the engine may still be sounding.
             */
            it('Escape stops a transport wedged on an unconfirmed start', () => {
                render(<TransportPillHost onRequestAudio={vi.fn()} />);
                transport({ isPlaying: true, transportPending: null, transportError: 'silence', transportAwaitedCommand: 'play' });

                act(() => { resolveKeydown(new KeyboardEvent('keydown', { key: 'Escape' })); });

                expect(useArrangementStore.getState().isPlaying).toBe(false);
                expect(useArrangementStore.getState().transportPending).toBe('stop');
            });

            it('leaves Escape alone when the transport is not wedged', () => {
                render(<TransportPillHost onRequestAudio={vi.fn()} />);
                transport({ isPlaying: true, transportPending: null, transportError: null });

                act(() => { resolveKeydown(new KeyboardEvent('keydown', { key: 'Escape' })); });

                expect(useArrangementStore.getState().isPlaying).toBe(true);
            });

            /*
             * G-11. The sky band's live region lives inside the arrangement
             * surface, which is `inert` and `aria-hidden` whenever the canvas is
             * active — so on the canvas it announces to nobody. The pill speaks
             * exactly where the sky band cannot, and stays silent where it can,
             * so the sentence is never said twice.
             */
            it('announces the reason on the canvas, and leaves it to the sky band on the song', () => {
                const { container, rerender } = render(<TransportPillHost onRequestAudio={vi.fn()} />);
                transport({ isPlaying: true, transportPending: null, transportError: 'silence', transportAwaitedCommand: 'play' });

                const region = container.querySelector('.oj-transport-host__reason')!;
                expect(region.getAttribute('role')).toBe('status');
                expect(region.getAttribute('aria-live')).toBe('polite');
                expect(region.textContent).toBe('silence');

                act(() => { useUiViewStore.setState({ surface: 'arrangement' }); });
                rerender(<TransportPillHost onRequestAudio={vi.fn()} />);
                expect(container.querySelector('.oj-transport-host__reason')?.textContent).toBe('');
            });

            it('shows no fault marking while the transport is simply stopped', () => {
                const { container } = render(<TransportPillHost onRequestAudio={vi.fn()} />);
                transport({ isPlaying: false, transportPending: null, transportError: null });

                expect(container.querySelector('.oj-transport-host')?.getAttribute('data-transport-fault')).toBeNull();
            });
        });
    });

    /*
     * The chrome hands focus back to the stage after a mouse activation, so bare
     * `Tab` still switches surface the way the topbar's keycap promises. A
     * keyboard activation keeps focus, so a player traversing the pill stays in it.
     */
    describe('chrome focus', () => {
        it('releases focus after a pointer activation', () => {
            render(<TransportPillHost onRequestAudio={vi.fn()} />);
            const play = screen.getByRole('button', { name: 'Start sound' });
            play.focus();

            fireEvent.click(play, { detail: 1 });

            expect(document.activeElement).toBe(document.body);
        });

        it('keeps focus when the same control is activated from the keyboard', () => {
            render(<TransportPillHost onRequestAudio={vi.fn()} />);
            const play = screen.getByRole('button', { name: 'Start sound' });
            play.focus();

            fireEvent.click(play, { detail: 0 });

            expect(document.activeElement).toBe(play);
        });
    });

    /*
     * W4-TBc item 4 (W4-TBb §12.2). The ruled surfaces reserve a centre lane for
     * this pill, symmetrically, because it is `position: fixed; left: 50%` and
     * centred on the window rather than on any column. That reserve used to be
     * the literal 432px — a copy of a measurement, pinned by a `>= 428` that was
     * a copy of the same measurement — so adding a transport zone here would put
     * the pill back over the arrangement's armed edit-mode control with every
     * test still green. The pill publishes its own width instead, and
     * `--arrangement-sky-pill-reserve` is `calc(that + 4px)`.
     */
    describe('the pill publishes its width for the surfaces that reserve a lane for it', () => {
        const observers: { callback: ResizeObserverCallback; disconnected: boolean }[] = [];

        beforeEach(() => {
            observers.length = 0;
            document.documentElement.style.removeProperty('--oj-transport-pill-width');
            class TestResizeObserver {
                callback: ResizeObserverCallback;
                disconnected = false;
                constructor(callback: ResizeObserverCallback) { this.callback = callback; observers.push(this); }
                observe() {}
                disconnect() { this.disconnected = true; }
            }
            vi.stubGlobal('ResizeObserver', TestResizeObserver);
        });

        const widthIs = (width: number) => vi
            .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
            .mockReturnValue({ width, height: 44, x: 0, y: 0, top: 0, left: 0, right: width, bottom: 44, toJSON: () => ({}) });

        it('writes the measured width onto the document element, from ONE observer', () => {
            widthIs(427.9);
            render(<TransportPillHost onRequestAudio={vi.fn()} />);
            expect(document.documentElement.style.getPropertyValue('--oj-transport-pill-width')).toBe('427.9px');
            expect(observers).toHaveLength(1);
        });

        /*
         * A custom property on `documentElement` invalidates style for the whole
         * document. This fires while a transport zone appears or disappears, so
         * a write per observation would be a style recalculation per frame of a
         * window resize — on the one component that is on screen during a take.
         */
        it('writes only when the number actually changes', () => {
            const rect = widthIs(428);
            render(<TransportPillHost onRequestAudio={vi.fn()} />);
            const spy = vi.spyOn(document.documentElement.style, 'setProperty');

            act(() => { observers[0]!.callback([], {} as ResizeObserver); });
            expect(spy).not.toHaveBeenCalled();

            rect.mockReturnValue({ width: 466, height: 44, x: 0, y: 0, top: 0, left: 0, right: 466, bottom: 44, toJSON: () => ({}) });
            act(() => { observers[0]!.callback([], {} as ResizeObserver); });
            expect(spy).toHaveBeenCalledWith('--oj-transport-pill-width', '466px');
            spy.mockRestore();
        });

        it('falls back to the stylesheet rather than leaving a stale width behind', () => {
            widthIs(427.9);
            const { unmount } = render(<TransportPillHost onRequestAudio={vi.fn()} />);
            unmount();
            expect(document.documentElement.style.getPropertyValue('--oj-transport-pill-width')).toBe('');
        });
    });

    describe('the space hint', () => {
        it('appears on the canvas only while Space is the transport key', () => {
            const { rerender, container } = render(<TransportPillHost onRequestAudio={vi.fn()} />);
            expect(container.querySelector('.oj-transport__hint')?.textContent).toBe('space');

            // Modes 2–9 give Space to the sustain pedal, so the hint must go.
            useAudioStore.setState({ currentMode: 2 });
            rerender(<TransportPillHost onRequestAudio={vi.fn()} />);
            expect(container.querySelector('.oj-transport__hint')).toBeNull();
        });

        it('is absent on the piano roll, where Space is not bound', () => {
            useUiViewStore.setState({ surface: 'pianoroll' });
            const { container } = render(<TransportPillHost onRequestAudio={vi.fn()} />);
            expect(container.querySelector('.oj-transport__hint')).toBeNull();
        });
    });
});
