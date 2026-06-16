/**
 * U23 — Presence overlay: live peer cursors + selection rings.
 *
 * A clean, self-contained overlay that renders OTHER peers' live cursors and
 * their selected-node highlights on top of the node canvas. It deliberately
 * does NOT restructure the canvas — it is a sibling layer that reads peer
 * presence from {@link useCollabStore} and the live graph from the graph store.
 *
 * Coordinates: peer cursors are stored in CANVAS coordinates, so this layer is
 * placed INSIDE the canvas's transformed content (translate+scale), letting
 * cursors line up regardless of pan/zoom. It also filters peers to the canvas
 * level the local user is currently viewing.
 *
 * If there is no active session this renders nothing — zero impact on the
 * single-user experience.
 */

import { useCollabStore } from '../../store/collabStore';
import { useGraphStore, getNodeDimensions } from '../../store/graphStore';
import { useCanvasNavigationStore } from '../../store/canvasNavigationStore';
import './PresenceOverlay.css';

export function PresenceOverlay() {
    const status = useCollabStore((s) => s.status);
    const peers = useCollabStore((s) => s.peers);
    const currentViewNodeId = useCanvasNavigationStore((s) => s.currentViewNodeId);
    const nodes = useGraphStore((s) => s.nodes);

    if (status !== 'connected' || peers.length === 0) return null;

    // Only show peers viewing the SAME canvas level as us.
    const visiblePeers = peers.filter((p) => (p.viewNodeId ?? null) === (currentViewNodeId ?? null));

    return (
        <div className="presence-overlay" aria-hidden>
            {/* Selection rings around nodes other peers have selected. */}
            {visiblePeers.flatMap((peer) =>
                peer.selection
                    .map((nodeId) => {
                        const node = nodes.get(nodeId);
                        if (!node) return null;
                        const dims = getNodeDimensions(node);
                        return (
                            <div
                                key={`${peer.peerId}-sel-${nodeId}`}
                                className="presence-selection"
                                style={{
                                    left: node.position.x,
                                    top: node.position.y,
                                    width: dims.width,
                                    height: dims.height,
                                    borderColor: peer.color,
                                    boxShadow: `0 0 0 1px ${peer.color}`,
                                }}
                            />
                        );
                    })
                    .filter(Boolean),
            )}

            {/* Live cursors. */}
            {visiblePeers.map((peer) =>
                peer.cursor ? (
                    <div
                        key={`${peer.peerId}-cursor`}
                        className="presence-cursor"
                        style={{ left: peer.cursor.x, top: peer.cursor.y }}
                    >
                        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                            <path
                                d="M2 2 L2 14 L5.5 10.5 L8 16 L10 15 L7.5 9.5 L13 9.5 Z"
                                fill={peer.color}
                                stroke="#fff"
                                strokeWidth="1"
                            />
                        </svg>
                        <span className="presence-cursor-label" style={{ background: peer.color }}>
                            {peer.name}
                        </span>
                    </div>
                ) : null,
            )}
        </div>
    );
}
