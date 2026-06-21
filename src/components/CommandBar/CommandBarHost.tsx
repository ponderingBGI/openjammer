import { lazy, Suspense, useEffect, useState } from 'react';
import { startBridgeListener } from '../../ai/bridgeListener';
import { useCommandSources } from './useCommandSources';
import type { CommandBarOpenIntent } from './CommandBar';

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

        const onKeyDown = (e: KeyboardEvent) => {
            const isToggle = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k';
            if (!isToggle) return;
            e.preventDefault();
            open(nextIntent('toggle'));
        };
        const onConfigure = () => open(nextIntent('configure-ai'));
        const onAsk = (e: Event) => {
            const detail = (e as CustomEvent<{ prompt?: string }>).detail;
            open(nextIntent('ask-ai', detail));
        };

        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('openjammer:configure-ai', onConfigure);
        window.addEventListener('openjammer:ask-ai', onAsk);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
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
