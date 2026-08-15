import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { startBridgeListener } from '../../ai/bridgeListener';
import { useCommandSources } from './useCommandSources';
import type { CommandBarOpenIntent } from './CommandBar';
import { useBindingSet } from '../../keymap/useKeymap';

const CommandBar = lazy(() =>
    import('./CommandBar').then((m) => ({ default: m.CommandBar })),
);

let intentSeq = 0;

function nextIntent(
    kind: CommandBarOpenIntent['kind'],
    detail?: { prompt?: string },
): CommandBarOpenIntent {
    intentSeq += 1;
    return { kind, prompt: detail?.prompt ?? '', seq: intentSeq };
}

export function CommandBarHost() {
    const [loaded, setLoaded] = useState(false);
    const [intent, setIntent] = useState<CommandBarOpenIntent | null>(null);

    // Register palette actions at boot so the first lazy-opened palette is populated.
    useCommandSources();

    useBindingSet(useMemo(() => ({
        id: 'command-bar-toggle',
        scope: 'global' as const,
        entries: [{
            actionId: 'commandBar.toggle',
            run: () => {
                setLoaded(true);
                setIntent(nextIntent('toggle'));
                return true;
            },
        }],
    }), []));

    // Keep the native AI tool bridge eager even though the palette UI is lazy.
    useEffect(() => {
        let unlisten: (() => void) | null = null;
        let cancelled = false;
        void startBridgeListener()
            .then((fn) => {
                if (cancelled) fn?.();
                else unlisten = fn;
            })
            .catch(() => {
                // Best-effort: a missing/failed tool bridge must not surface as an
                // unhandled rejection.
            });
        return () => {
            cancelled = true;
            unlisten?.();
        };
    }, []);

    useEffect(() => {
        const open = (next: CommandBarOpenIntent) => {
            setLoaded(true);
            setIntent(next);
        };

        const onConfigure = () => open(nextIntent('configure-ai'));
        const onAsk = (e: Event) => {
            const detail = (e as CustomEvent<{ prompt?: string }>).detail;
            open(nextIntent('ask-ai', detail));
        };

        window.addEventListener('openjammer:configure-ai', onConfigure);
        window.addEventListener('openjammer:ask-ai', onAsk);
        return () => {
            window.removeEventListener('openjammer:configure-ai', onConfigure);
            window.removeEventListener('openjammer:ask-ai', onAsk);
        };
    }, []);

    if (!loaded) return null;
    return (
        <Suspense fallback={null}>
            <CommandBar intent={intent} />
        </Suspense>
    );
}
