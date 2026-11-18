/**
 * Preset rigs — a real, sounding patch three taps into the first run.
 *
 * See `docs/shell.md` for what each rig is made of and why.
 */

export type { RigNode, RigWire, RigSpec, RigFactory } from './types';
export { rigFor, RIG_LABEL } from './presets';
export { installRig, installRigFor, focusRig, type InstalledRig } from './buildRig';
export {
    buildBeatSong,
    BEAT_ROWS,
    BEAT_STEPS,
    BEAT_STEP_TICKS,
    BEAT_BAR_TICKS,
    BEAT_SOURCE_ID,
    BEAT_TRACK_ID,
    BEAT_CLIP_ID,
} from './beatSong';
