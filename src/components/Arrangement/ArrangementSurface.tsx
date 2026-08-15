import { useMemo } from 'react';
import { useArrangementStore } from '../../store/arrangementStore';
import { useBindingSet } from '../../keymap/useKeymap';
import { SongInterior } from '../Song/SongInterior';
import './ArrangementSurface.css';

export function ArrangementSurface({ active, songNodeId }: { active: boolean; songNodeId: string | null }) {
    useBindingSet(useMemo(() => ({
        id: 'arrangement-surface',
        scope: 'surface' as const,
        surface: 'arrangement' as const,
        entries: [
            {
                actionId: 'arrangement.transport',
                guard: (event: KeyboardEvent) => !event.repeat,
                run: () => {
                    const store = useArrangementStore.getState();
                    if (store.isPlaying) store.stop(); else store.play();
                    return true;
                },
            },
            { actionId: 'arrangement.undo', run: () => { useArrangementStore.getState().undo(); return true; } },
            { actionId: 'arrangement.redo', run: () => { useArrangementStore.getState().redo(); return true; } },
            {
                actionId: 'arrangement.delete',
                run: () => {
                    const store = useArrangementStore.getState();
                    if (store.selectedNoteIds.length > 0) {
                        store.apply(store.selectedNoteIds.map((noteId) => ({ kind: 'removeNote' as const, noteId })));
                        store.selectNotes([]);
                    } else if (store.selectedClipId) {
                        store.apply({ kind: 'removeClip', clipId: store.selectedClipId });
                        store.selectClip(null);
                    }
                    return true;
                },
            },
            {
                actionId: 'arrangement.deleteBackspace',
                run: () => {
                    const store = useArrangementStore.getState();
                    if (store.selectedNoteIds.length > 0) {
                        store.apply(store.selectedNoteIds.map((noteId) => ({ kind: 'removeNote' as const, noteId })));
                        store.selectNotes([]);
                    } else if (store.selectedClipId) {
                        store.apply({ kind: 'removeClip', clipId: store.selectedClipId });
                        store.selectClip(null);
                    }
                    return true;
                },
            },
        ],
    }), []));

    return (
        <div
            className="arrangement-surface"
            data-surface-root="arrangement"
            tabIndex={-1}
            hidden={!active}
            inert={!active ? true : undefined}
            aria-hidden={!active}
        >
            <SongInterior songNodeId={songNodeId ?? 'song'} />
        </div>
    );
}
