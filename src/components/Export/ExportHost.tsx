import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useBindingSet } from '../../keymap/useKeymap';
import { useArrangementStore } from '../../store/arrangementStore';
import { ExportDialog } from './ExportDialog';

export function ExportHost() {
    const [open, setOpen] = useState(false);
    const arrangement = useArrangementStore((state) => state.arrangement);
    const isPlaying = useArrangementStore((state) => state.isPlaying);
    const requestOpen = useCallback(() => {
        if (!arrangement) {
            toast('There isn’t a song on the page yet.');
            return;
        }
        if (isPlaying) {
            toast('Stop playback before opening export.');
            return;
        }
        setOpen(true);
    }, [arrangement, isPlaying]);
    useBindingSet(useMemo(() => ({
        id: 'export-song',
        scope: 'global' as const,
        entries: [{ actionId: 'file.export', run: () => { requestOpen(); return true; } }],
    }), [requestOpen]));
    useEffect(() => {
        window.addEventListener('openjammer:export-song', requestOpen);
        return () => window.removeEventListener('openjammer:export-song', requestOpen);
    }, [requestOpen]);
    if (!arrangement) return null;
    return <ExportDialog open={open} arrangement={arrangement} onClose={() => setOpen(false)} />;
}
