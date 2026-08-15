/**
 * Song Node — the on-canvas handle for the ONE timeline (the arrangementStore's
 * Arrangement). Collapsed, it is a warm little record sleeve: the song title, a
 * one-line summary (tracks · bars · tempo), and the invitation to press E. Entered
 * (E), the canvas swaps the node layer for the peer Arrangement surface.
 *
 * It owns no audio — the instruments it plays are ordinary graph nodes referenced by
 * the arrangement — so it carries no ports. Living Sketchbook: paper, ink, Caveat, a
 * hard blur-free offset shadow; never grey chrome.
 */

import type { GraphNode } from '../../engine/types';
import { useUIFeedbackStore } from '../../store/uiFeedbackStore';
import { useArrangementStore } from '../../store/arrangementStore';
import { useUiViewStore } from '../../store/uiViewStore';
import { arrangementLengthTicks, timebase } from '../../song/time';
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
    const flashingNodes = useUIFeedbackStore((s) => s.flashingNodes);
    const isFlashing = flashingNodes.has(node.id);
    const openArrangement = useUiViewStore((s) => s.setSurface);

    const title = arrangement?.name ?? 'Empty song';
    const summary = arrangement
        ? `${arrangement.tracks.length} ${arrangement.tracks.length === 1 ? 'track' : 'tracks'} · ` +
          `${arrangementLengthTicks(arrangement) / timebase(arrangement).ticksPerBar} bars · ${arrangement.tempoBpm} BPM`
        : 'Press E to start arranging';

    return (
        <div
            className={`schematic-node song-node ${isFlashing ? 'deletion-attempted' : ''} ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''} ${isPlaying ? 'playing' : ''}`}
            style={style}
            onMouseEnter={handleNodeMouseEnter}
            onMouseLeave={handleNodeMouseLeave}
        >
            <div className="song-node-header" onMouseDown={handleHeaderMouseDown}>
                <span className="song-node-disc" aria-hidden="true">
                    {isPlaying ? '▶' : '◉'}
                </span>
                <span className="song-node-title">{title}</span>
            </div>
            <div className="song-node-body">
                <div className="song-node-summary">{summary}</div>
                <button
                    type="button"
                    className="song-node-hint"
                    onClick={(event) => {
                        event.stopPropagation();
                        openArrangement('arrangement', node.id);
                    }}
                >
                    Open arrangement · E
                </button>
            </div>
        </div>
    );
}
