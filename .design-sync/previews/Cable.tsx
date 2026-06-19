import { Cable } from '@openjammer/oj-ui';
import type { CableKind } from '@openjammer/oj-ui';

/** A canvas-like SVG overlay so the cables have somewhere to live. */
function Stage({ children }: { children: React.ReactNode }) {
    return (
        <svg
            width={360}
            height={220}
            style={{
                background: 'var(--bg-canvas)',
                border: 'var(--border-sketch-width) solid var(--border-subtle)',
                borderRadius: 'var(--radius-lg)',
            }}
        >
            {children}
        </svg>
    );
}

export const Kinds = () => {
    const kinds: CableKind[] = ['audio', 'control', 'universal'];
    return (
        <Stage>
            {kinds.map((kind, i) => (
                <Cable
                    key={kind}
                    kind={kind}
                    start={{ x: 30, y: 40 + i * 60 }}
                    end={{ x: 330, y: 40 + i * 60 }}
                />
            ))}
        </Stage>
    );
};

export const SelectedAndBundled = () => (
    <Stage>
        <Cable kind="audio" start={{ x: 30, y: 50 }} end={{ x: 330, y: 50 }} selected />
        <Cable
            kind="audio"
            start={{ x: 30, y: 130 }}
            end={{ x: 330, y: 130 }}
            bundled
            bundleCount={4}
        />
    </Stage>
);

export const SignalLevels = () => (
    <Stage>
        <Cable kind="audio" start={{ x: 30, y: 40 }} end={{ x: 330, y: 40 }} signalLevel={0} />
        <Cable kind="audio" start={{ x: 30, y: 110 }} end={{ x: 330, y: 110 }} signalLevel={0.5} />
        <Cable kind="audio" start={{ x: 30, y: 180 }} end={{ x: 330, y: 180 }} signalLevel={1} />
    </Stage>
);

export const TempDrag = () => (
    <Stage>
        <Cable kind="control" start={{ x: 30, y: 110 }} end={{ x: 280, y: 60 }} temp />
    </Stage>
);

export const Selectable = () => (
    <Stage>
        <Cable
            kind="audio"
            start={{ x: 30, y: 110 }}
            end={{ x: 330, y: 110 }}
            onSelect={() => alert('cable selected')}
        />
    </Stage>
);
