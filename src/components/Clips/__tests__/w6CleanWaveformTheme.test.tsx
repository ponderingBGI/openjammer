/**
 * W6-CLEAN #6 — the waveform editor follows the theme.
 *
 * The editor canvas is the ONE surface in OpenJammer that CSS cannot restyle:
 * its colours are baked into pixels at draw time. `readWavePalette()` reads the
 * live tokens, but it was only ever called from two draw effects keyed on
 * `[audioBuffer, zoom, scrollOffset, …]` — so switching theme with the editor
 * open left the waveform painted in the OLD palette until the player happened to
 * zoom or drag. A theme switch has to be a draw trigger, not just a variable
 * change.
 *
 * The test watches the 2D context: a `openjammer:theme-change` event must make
 * the editor paint again, with the colours the new theme resolves to.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAudioClipStore, setClipBuffer } from '../../../store/audioClipStore';
import type { AudioClip } from '../../../engine/types';

vi.mock('../../../audio/audioContext', () => ({ getAudioContext: () => null }));

const { WaveformEditorModal } = await import('../WaveformEditorModal');

/** Every fill colour the editor asked the canvas for, in order. */
let fills: string[] = [];

/** A stand-in for the 2D context that records what it was told to paint with. */
function recordingContext(): CanvasRenderingContext2D {
    const context = {
        set fillStyle(value: string) { fills.push(value); },
        get fillStyle() { return ''; },
        strokeStyle: '',
        lineWidth: 1,
        globalAlpha: 1,
        font: '',
        textAlign: 'left',
        fillRect: () => {},
        clearRect: () => {},
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        stroke: () => {},
        fillText: () => {},
        strokeRect: () => {},
        save: () => {},
        restore: () => {},
    };
    return context as unknown as CanvasRenderingContext2D;
}

/** A one-second mono buffer — enough geometry for the editor to draw. */
function fakeBuffer(): AudioBuffer {
    const data = new Float32Array(4410).map((_, i) => Math.sin(i / 20) * 0.5);
    return {
        length: data.length,
        duration: 0.1,
        sampleRate: 44100,
        numberOfChannels: 1,
        getChannelData: () => data,
    } as unknown as AudioBuffer;
}

const CLIP: AudioClip = {
    id: 'clip-1',
    sampleId: 'sample-1',
    sampleName: 'take-1.wav',
    startFrame: 0,
    endFrame: -1,
    durationSeconds: 0.1,
    sampleRate: 44100,
    waveformPeaks: [],
    position: null,
    width: 120,
    height: 40,
    sourceType: 'library',
    createdAt: 0,
    lastModifiedAt: 0,
};

beforeEach(() => {
    fills = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
        () => recordingContext(),
    );
    setClipBuffer(CLIP.sampleId, fakeBuffer());
    useAudioClipStore.setState({
        clips: new Map([[CLIP.id, CLIP]]),
        editingClipId: CLIP.id,
    });
});

afterEach(() => {
    cleanup();
    useAudioClipStore.setState({ editingClipId: null, clips: new Map() });
    vi.restoreAllMocks();
});

/** Point the live tokens at a palette a test can recognise. */
function setPalette(ground: string, wave: string) {
    document.documentElement.style.setProperty('--bg-tertiary', ground);
    document.documentElement.style.setProperty('--audio-connection', wave);
}

describe('W6-CLEAN — a theme change repaints the waveform', () => {
    it('draws again with the new palette when the theme event fires', () => {
        setPalette('rgb(1, 1, 1)', 'rgb(2, 2, 2)');
        render(<WaveformEditorModal />);

        expect(fills).toContain('rgb(1, 1, 1)');

        // The player switches theme with the editor open.
        fills = [];
        setPalette('rgb(9, 9, 9)', 'rgb(8, 8, 8)');
        act(() => {
            window.dispatchEvent(new CustomEvent('openjammer:theme-change', { detail: 'light' }));
        });

        expect(fills.length).toBeGreaterThan(0);
        expect(fills).toContain('rgb(9, 9, 9)');
        expect(fills).not.toContain('rgb(1, 1, 1)');
    });

    it('follows a theme changed in another tab (the storage event)', () => {
        setPalette('rgb(1, 1, 1)', 'rgb(2, 2, 2)');
        render(<WaveformEditorModal />);

        fills = [];
        setPalette('rgb(7, 7, 7)', 'rgb(6, 6, 6)');
        act(() => {
            window.dispatchEvent(new StorageEvent('storage', { key: 'openjammer-theme' }));
        });

        expect(fills).toContain('rgb(7, 7, 7)');
    });

    it('stops listening once the editor is closed', () => {
        setPalette('rgb(1, 1, 1)', 'rgb(2, 2, 2)');
        const view = render(<WaveformEditorModal />);
        view.unmount();

        fills = [];
        act(() => {
            window.dispatchEvent(new CustomEvent('openjammer:theme-change', { detail: 'dark' }));
        });

        expect(fills).toEqual([]);
    });
});
