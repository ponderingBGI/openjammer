/**
 * StepGrid — eight cells over the beat rig's REAL clip.
 *
 * It is a view, not an editor: every cell toggle goes through `drawNotes` /
 * `eraseNotes`, the same operations a piano-roll pencil stroke emits, on the
 * same clip, in the same undo history. Open the piano roll (Tab, then Enter on
 * the clip) and you are looking at the notes this grid just drew. That is the
 * whole point — the prototype's grid was a `setInterval` pattern object, and a
 * groove that is not the real timeline is a lie the player finds in thirty
 * seconds.
 *
 * It appears only for the beat rig's own source, so it is the rig's face rather
 * than a second timeline UI competing with the arrangement. Load another song
 * and it is simply not there.
 */

import { useEffect, useRef } from 'react';
import { useArrangementStore } from '../../store/arrangementStore';
import { drawNotes, eraseNotes } from '../../song/ops';
import { BEAT_CLIP_ID, BEAT_ROWS, BEAT_SOURCE_ID, BEAT_STEPS, BEAT_STEP_TICKS } from '../../rigs';
import { registerTimelineFrameWriter } from '../Arrangement/sharedAnimationFrame';
import './StepGrid.css';

/** Half a step of tolerance: a note "is on" the step it was drawn at. */
const SNAP = BEAT_STEP_TICKS / 2;

export function StepGrid() {
    const arrangement = useArrangementStore((state) => state.arrangement);
    const isPlaying = useArrangementStore((state) => state.isPlaying);
    const gridRef = useRef<HTMLDivElement>(null);

    // The playhead column, written straight onto the DOM from the app's shared
    // frame — a groove running at 96 BPM must not re-render React eight times a
    // bar to move a highlight.
    useEffect(() => {
        const write = () => {
            const state = useArrangementStore.getState();
            if (!gridRef.current) return;
            const step = state.isPlaying
                ? Math.floor((state.currentTick() % (BEAT_STEPS * BEAT_STEP_TICKS)) / BEAT_STEP_TICKS)
                : -1;
            gridRef.current.dataset.step = String(step);
        };
        write();
        if (!isPlaying) return;
        return registerTimelineFrameWriter(write);
    }, [isPlaying, arrangement]);

    const source = arrangement?.sources?.[BEAT_SOURCE_ID];
    if (!arrangement || !source || source.kind !== 'midi') return null;

    const noteAt = (pitch: number, step: number) =>
        source.notes.find((note) => note.pitch === pitch && Math.abs(note.tick - step * BEAT_STEP_TICKS) < SNAP);

    const toggle = (pitch: number, velocity: number, step: number) => {
        const store = useArrangementStore.getState();
        const current = store.arrangement;
        if (!current) return;
        const existing = noteAt(pitch, step);
        const result = existing?.id
            ? eraseNotes(current, { noteIds: [existing.id] })
            : drawNotes(
                  current,
                  BEAT_CLIP_ID,
                  [{ tick: step * BEAT_STEP_TICKS, durTick: Math.round(BEAT_STEP_TICKS * 0.5), pitch, vel: velocity }],
                  (prefix) => store.mintId(prefix),
              );
        if (result.verbs.length) store.apply(result.verbs);
    };

    return (
        <div className="oj-step-grid" role="group" aria-label="Groove — eight steps">
            <div className="oj-step-grid__rows" ref={gridRef} data-step="-1">
                {BEAT_ROWS.map((row) => (
                    <div className="oj-step-grid__row" key={row.pitch}>
                        <b className="oj-step-grid__label">{row.label}</b>
                        {Array.from({ length: BEAT_STEPS }, (_, step) => {
                            const on = Boolean(noteAt(row.pitch, step));
                            return (
                                <button
                                    key={step}
                                    type="button"
                                    className={`oj-step-grid__cell${on ? ' is-on' : ''}`}
                                    style={{ '--oj-step': step } as React.CSSProperties}
                                    aria-pressed={on}
                                    aria-label={`${row.label} step ${step + 1}`}
                                    onClick={() => toggle(row.pitch, row.velocity, step)}
                                />
                            );
                        })}
                    </div>
                ))}
            </div>
            <span className="oj-step-grid__hint">click cells to edit the groove</span>
        </div>
    );
}
