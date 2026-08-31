/**
 * Song Node — the on-canvas handle for the ONE timeline (the arrangementStore's
 * Arrangement). Collapsed, it is a record sleeve: the song's title, one mono
 * line of exact facts (tracks · bars · tempo), and the door into the
 * arrangement. Entered (`E`, or the button), the canvas swaps the node layer for
 * the peer Arrangement surface.
 *
 * It owns no audio — the instruments it plays are ordinary graph nodes the
 * arrangement references — so it carries no ports, and the body is free to be
 * nothing but the facts.
 *
 * Playing is a CHIP, not a fill: on this canvas an accent wash means "engaged
 * control", and a song that is rolling is a state you read, not a control you
 * are holding.
 */

import type { GraphNode } from '../../engine/types';
import { useArrangementStore } from '../../store/arrangementStore';
import { useUiViewStore } from '../../store/uiViewStore';
import { useIsAgentPending } from '../../store/agentSessionStore';
import { arrangementLengthTicks, timebase } from '../../song/time';
import { Button, Chip, Kbd, NodeShell, StatusDot } from '@openjammer/oj-ui';
import { NodeFeedback } from './NodeFeedback';
import { useNodeRefusal } from './nodeControls';
import './SongNode.css';

interface SongNodeProps {
    node: GraphNode;
    style?: React.CSSProperties;
    handleHeaderMouseDown?: (e: React.MouseEvent) => void;
    handleNodeMouseEnter?: () => void;
    handleNodeMouseLeave?: () => void;
    isSelected?: boolean;
    isDragging?: boolean;
}

export function SongNode({
    node,
    style,
    handleHeaderMouseDown,
    handleNodeMouseEnter,
    handleNodeMouseLeave,
    isSelected,
    isDragging,
}: SongNodeProps) {
    const arrangement = useArrangementStore((s) => s.arrangement);
    const isPlaying = useArrangementStore((s) => s.isPlaying);
    const isRefusing = useNodeRefusal(node.id);
    const isAgentPending = useIsAgentPending(node.id);
    const openArrangement = useUiViewStore((s) => s.setSurface);

    const title = arrangement?.name ?? 'Empty song';
    const trackCount = arrangement?.tracks.length ?? 0;
    const barCount = arrangement
        ? Math.round(arrangementLengthTicks(arrangement) / timebase(arrangement).ticksPerBar)
        : 0;

    return (
        <NodeShell
            className={`schematic-node song-node${isPlaying ? ' playing' : ''}${isRefusing ? ' deletion-attempted' : ''}`}
            style={style}
            title={title}
            nodeType="SONG"
            selected={!!isSelected}
            dragging={!!isDragging}
            agentPending={isAgentPending}
            headerProps={{ onMouseDown: handleHeaderMouseDown }}
            onMouseEnter={handleNodeMouseEnter}
            onMouseLeave={handleNodeMouseLeave}
        >
            {arrangement ? (
                <>
                    <p className="song-node-summary">
                        {trackCount} {trackCount === 1 ? 'track' : 'tracks'} · {barCount}{' '}
                        {barCount === 1 ? 'bar' : 'bars'} · {arrangement.tempoBpm} BPM
                    </p>
                    <div className="oj-node__meta">
                        <Chip tone={isPlaying ? 'success' : 'neutral'}>
                            <StatusDot status={isPlaying ? 'ok' : 'idle'} />
                            {isPlaying ? 'playing' : 'stopped'}
                        </Chip>
                    </div>
                </>
            ) : (
                <p className="song-node-summary song-node-summary--empty">
                    Nothing arranged yet.
                </p>
            )}

            <Button
                variant="ghost"
                className="song-node-open"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                    event.stopPropagation();
                    openArrangement('arrangement', node.id);
                }}
            >
                Open arrangement<Kbd>E</Kbd>
            </Button>
            <NodeFeedback active={isRefusing} message="The song is the project's timeline — it cannot be deleted." />
        </NodeShell>
    );
}
