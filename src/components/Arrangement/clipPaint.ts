import type { ArrangementClip, Source } from '../../song/types';
import type { PitchRange } from '../../store/trackLaneViewStore';

/**
 * Paints a clip's MIDI content into its body.
 *
 * The notes are `--text-secondary` rectangles at `0.55 + 0.45·vel/127` alpha
 * (spec 2.5), not the teal note colour: teal is reserved for AUDIO in this
 * language, and a clip that is already washed in its track's tint must not also
 * carry a second saturated hue. Velocity is the only thing modulating them, so
 * the shape of a part is legible at lane height without a single label.
 *
 * Exported because the drag ghost paints the SAME content: a ghost that is an
 * empty rectangle cannot confirm you are moving the right thing.
 */
export function paintClipCanvas(
    canvas: HTMLCanvasElement,
    source: Source,
    clip: ArrangementClip,
    width: number,
    height: number,
    range: PitchRange,
) {
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.ceil(width * ratio));
    canvas.height = Math.max(1, Math.ceil(height * ratio));
    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const styles = getComputedStyle(canvas);
    context.clearRect(0, 0, width, height);
    if (source.kind === 'midi') {
        const sourceStart = clip.sourceStart ?? 0;
        const sourceEnd = sourceStart + clip.lengthTick;
        const notes = source.notes.filter((note) => note.tick + note.durTick > sourceStart && note.tick < sourceEnd);
        const bodyTop = width >= 36 && height >= 30 ? 20 : 4;
        const available = Math.max(2, height - bodyTop - 4);
        const span = Math.max(1, range.hi - range.lo);
        for (const note of notes) {
            const x = Math.max(0, (note.tick - sourceStart) / clip.lengthTick * width);
            const noteWidth = Math.max(1, note.durTick / clip.lengthTick * width);
            const y = bodyTop + (range.hi - note.pitch) / span * available;
            const noteHeight = Math.max(2, Math.min(4, available / span));
            context.globalAlpha = 0.55 + 0.45 * (note.vel ?? 96) / 127;
            context.fillStyle = styles.getPropertyValue('--text-secondary');
            context.fillRect(x, y, noteWidth, noteHeight);
        }
        context.globalAlpha = 1;
        return;
    }
}
