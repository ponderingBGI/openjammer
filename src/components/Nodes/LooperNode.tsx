/**
 * Looper Node — the live-performance faceplate.
 *
 * This is the one card on the canvas a player touches WHILE the room is
 * listening, so two rules govern everything below.
 *
 *  1. **Nothing here re-renders on a frame.** The engine's return frames arrive
 *     per audio block (hundreds a second on the wasm tier), and the old build
 *     pushed three `setState` calls into every one of them. Now a frame writes
 *     REFS only; the live trace, the playhead and the level meter are painted
 *     from the app's ONE shared animation frame straight into the DOM (the P6
 *     pattern: one attribute write, one custom property, never a render).
 *     React state changes only when a real fact changes — a transport edge, a
 *     committed layer, a control the player moved.
 *
 *  2. **Every control drives a verb the engine actually has.** The transport is
 *     RECORD/STOP (the kernel decides RECORDING vs OVERDUBBING from whether
 *     layers exist), per-layer SET_MUTE, DELETE_LAYER, UNDO_LAST and the
 *     node-level WET. There is no PLAY/STOP or CLEAR on the `LooperHandle`
 *     seam, so "Clear" is spelled out as what it really is — deleting every
 *     layer — and asks first, in the card, never in a native dialog that steals
 *     focus from a live instrument.
 *
 * STATE IS ENGINE-DRIVEN. The transport (idle / armed / recording / playing /
 * overdubbing), the committed rows, the playhead and the live trace all come
 * FROM the engine through the looper handle's return-frame callbacks. The UI
 * never guesses a state that can fail to reset. A held note beats a glitch:
 * control errors surface as inline, non-focus-stealing hints.
 *
 * ---------------------------------------------------------------------------
 * UNDO (W5-P7b). Before this round, NO Looper action reached the undo stack —
 * so `Ctrl+Z` after muting or deleting a layer replayed the last GRAPH entry,
 * which was still "add the Looper node", and the whole card left the canvas
 * with every take on it. That is the worst thing that can happen on stage.
 *
 * The fix is one seam, not a second history: the per-layer facts a PLAYER edits
 * — membership, mute and name — now live in `node.data.layers` as metadata
 * (id + flags + the library item id, **never** PCM), so every one of them is an
 * ordinary `setNodeData` graph verb, bracketed into exactly ONE `Ctrl+Z` by
 * `beginGesture`/`endGesture`, exactly like the Sampler's knobs. `data.layers`
 * is the SSOT for those three facts and the engine is reconciled FROM it, so an
 * undone mute really un-mutes the audio rather than only repainting the row.
 *
 * What undo CANNOT do, stated plainly: a committed take's PCM is owned by the
 * kernel on the audio thread, and `ojproto::looper_action` has ARM/RECORD/PLAY/
 * STOP/CLEAR/OVERDUB/UNDO_LAST/SET_MUTE/DELETE_LAYER and no ADD_LAYER — there is
 * no verb, on either tier, that can put a deleted layer's samples back.
 * (`addLoopFromBuffer` looks like one and is not: by its own TODO it registers a
 * row for the visuals and drives OVERDUB; it never transfers the PCM.) So the
 * three destructive actions — delete a layer, clear every layer, take the last
 * layer back off — are ONE `Ctrl+Z` each and never more (the node and every
 * surviving take stay exactly where they are), and all three ASK FIRST, in the
 * card. Confirm-gated beats silently unrecoverable.
 *
 * W5-P7c made both halves of that true rather than nearly true. "One each" was
 * one entry PER LAYER for clear-all, because the handle reports each removal
 * synchronously and this card commits a metadata step when it does; the three
 * now share `commitDestructive`, one depth-counted bracket. And the entry is
 * SEALED (inverse := forward, {@link sealLastGraphEntry}) like the Library's two
 * destroyers, so the one `Ctrl+Z` it costs consumes the step and changes
 * nothing, instead of restoring metadata for a take whose PCM is gone.
 *
 * The confirms say what is actually true, too. They used to claim the kernel
 * owned the take's audio and it could not be brought back. But every committed
 * take is auto-saved into the project Library, and a delete only TRASHES that
 * copy — so the old copy overstated the loss in the one direction a player
 * cares about. What cannot be undone is narrower and exact: the take cannot go
 * back INTO the loop. The copy points at the Library trash as the place to look
 * — not as a promise, because the auto-save is best-effort and swallows its
 * error.
 *
 * **The export name.** HEAD opened a separate inline `Export name…` field next
 * to the download button; the W5-P7 rebuild dropped it without saying so. It is
 * NOT coming back, and this is the conscious version of that call: a layer has
 * ONE name, edited in place on its own row (`EditableLabel`), and that name is
 * what `handleExport` saves into the library. Two fields for one string is two
 * places to disagree; a second modal step in front of a live export is a control
 * that costs a bar. What W5-P7b did add is the half that was actually missing —
 * the name is persisted in `node.data.layers` now instead of living in transient
 * component state, so it survives a reload and one `Ctrl+Z` puts it back.
 *
 * Rebuilt in W5-P7; undo seam added in W5-P7b; the seam made one-press-one-
 * sealed-step, and the confirms made honest, in W5-P7c.
 */

import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';
import type { GraphNode, LooperNodeData, AudioClip, ClipDropTarget } from '../../engine/types';
import { useGraphStore } from '../../store/graphStore';
import { useHistoryStore } from '../../store/historyStore';
import { useAudioStore } from '../../store/audioStore';
import { useAudioClipStore, setClipBuffer, getClipBuffer } from '../../store/audioClipStore';
import { useLibraryStore } from '../../store/libraryStore';
import { getExecutor, INFINITE_DURATION, isInfiniteDuration, type Loop } from '../../audio/executor';
import { getAudioContext } from '../../audio/audioContext';
import { createClipFromLoop, loadClipAudio } from '../../utils/clipUtils';
import { formatSampleDuration } from '../../utils/audioMetadata';
import { useScrollCapture } from '../../hooks/useScrollCapture';
import type { ScrollData } from '../../hooks/useScrollCapture';
import { registerTimelineFrameWriter } from '../Arrangement/sharedAnimationFrame';
import { registerTimelineLevelWriter } from '../Arrangement/timelineSignalLevels';
import { meterScale } from '../Shell/masterSignal';
import { useConfirmFocus } from '../Shell/confirmFocus';
import { LooperState } from '../../../packages/oj-protocol-ts/src/index';
import {
    Button,
    Callout,
    Chip,
    EditableLabel,
    IconButton,
    IconClose,
    IconDownload,
    IconMute,
    IconSpeaker,
    Knob,
    List,
    ListRow,
    Meter,
    NodeShell,
    PortRow,
    ValueScrubber,
    Waveform,
    type MeterHandle,
} from '@openjammer/oj-ui';
import { useGestureBracket } from './nodeControls';
import './LooperNode.css';

// Type for library store functions to use in refs
type SaveAudioToLibraryFn = (buffer: AudioBuffer, name: string, tags?: string[]) => Promise<string | null>;
type TrashItemFn = (itemId: string) => void;

interface LooperNodeProps {
    node: GraphNode;
    handlePortMouseDown?: (portId: string, e: React.MouseEvent) => void;
    handlePortMouseUp?: (portId: string, e: React.MouseEvent) => void;
    handlePortMouseEnter?: (portId: string) => void;
    handlePortMouseLeave?: () => void;
    hasConnection: (portId: string) => boolean;
    handleHeaderMouseDown: (e: React.MouseEvent) => void;
    handleNodeMouseEnter: () => void;
    handleNodeMouseLeave: () => void;
    isSelected: boolean;
    isDragging: boolean;
    isHoveredWithConnections: boolean;
    incomingConnectionCount: number;
    style: React.CSSProperties;
}

interface LoopRow {
    id: string;
    waveformData: number[];  // The recorded waveform shape
    isMuted: boolean;
    libraryItemId?: string;  // Reference to saved library item
    /** Real captured length, once the take's PCM has landed (Stage 3). */
    durationSeconds?: number;
}

/**
 * The undoable half of a layer: what a PLAYER decided about it. Metadata and a
 * REFERENCE only — the `libraryItemId` of the auto-saved take — so putting a
 * layer edit on the undo stack never copies a sample into history.
 *
 * Lives in `node.data.layers`. `LooperNodeData` is a `NodeData`, which carries
 * an index signature, so this key needs no change to `src/engine/types.ts`
 * (another lane's file this round).
 */
export interface LooperLayerMeta {
    id: string;
    isMuted: boolean;
    /** The performance label. It is also the name the export lands under. */
    name: string;
    /** The saved take in the project library — a reference, never audio. */
    libraryItemId?: string;
}

/** The engine-side facts a layer's metadata is merged against. */
type LayerSource = { id: string; isMuted: boolean; libraryItemId?: string };

/** Read the undoable layer metadata off a looper node's data. */
function readLayerMeta(data: unknown): LooperLayerMeta[] {
    const layers = (data as { layers?: unknown } | null)?.layers;
    return Array.isArray(layers) ? (layers as LooperLayerMeta[]) : [];
}

/**
 * Rebuild the metadata list for `rows` (the engine's layers, in kernel order),
 * carrying every player-set fact forward for the ids that survive and giving a
 * brand-new layer its default name. Rows are the membership authority; metadata
 * is the memory.
 */
function mergeLayerMeta(rows: readonly LayerSource[], prev: readonly LooperLayerMeta[]): LooperLayerMeta[] {
    return rows.map((row, index) => {
        const old = prev.find((m) => m.id === row.id);
        const meta: LooperLayerMeta = {
            id: row.id,
            isMuted: old?.isMuted ?? row.isMuted,
            name: old?.name ?? `Loop ${index + 1}`,
        };
        const libraryItemId = row.libraryItemId ?? old?.libraryItemId;
        if (libraryItemId) meta.libraryItemId = libraryItemId;
        return meta;
    });
}

/**
 * Seal the entry the gesture just closed: its inverse becomes its forward.
 *
 * The same discipline as `libraryVerbs.ts`'s two destroyers, and for the same
 * reason. The kernel owns a committed take's PCM and `ojproto::looper_action`
 * has no ADD_LAYER, so a `Ctrl+Z` that restored a deleted layer's METADATA
 * would put a row on screen that plays nothing — and a row that looks restored
 * and plays nothing is a lie. Sealed, the press still costs exactly one
 * `Ctrl+Z`: it CONSUMES the step and changes nothing, rather than falling
 * through into the entry that would delete the card.
 *
 * It runs after the outermost `endGesture` because the entry does not exist
 * until then — which is why it lives here and not inside `commitLayers`.
 * No deep clone: `applyGraphVerb` clones on apply and a verb is never mutated.
 */
function sealLastGraphEntry(): void {
    const { entries, cursor } = useHistoryStore.getState();
    const entry = entries[cursor - 1];
    if (!entry) return;
    const sealed = [...entries];
    sealed[cursor - 1] = { ...entry, inverse: [...entry.verbs] };
    useHistoryStore.setState({ entries: sealed });
}

/** Default loop-level wet gain when the node has none persisted (kernel default). */
const DEFAULT_LOOP_VOLUME = 1;

/** viewBox geometry for the live trace — matches oj-ui `Waveform`'s so the two
 *  traces on this card (live, and each committed layer) read as one drawing. */
const TRACE_W = 1000;
const TRACE_H = 100;
/* The envelope is unipolar, so silence draws ON y = TRACE_H and a full peak ON
 * y = 0 — both on a viewport edge, where half the stroke is clipped away. Three
 * units of bleed at each end keep the DRAWING identical to `oj-ui Waveform`
 * (same mapping, same colours) while letting a quiet pass still read as a line
 * rather than as nothing happening. */
const TRACE_BLEED = 3;

/** A filled circle — "this will capture". */
function IconRecord({ size = 16 }: { size?: number }) {
    return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
            <circle cx="12" cy="12" r="7" />
        </svg>
    );
}

/** A square — "commit this pass". */
function IconStop({ size = 16 }: { size?: number }) {
    return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
            <rect x="6" y="6" width="12" height="12" rx="2" />
        </svg>
    );
}

/** A curling back-arrow — "take the last layer off again". */
function IconUndo({ size = 14 }: { size?: number }) {
    return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
            <path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z" />
        </svg>
    );
}

/** The transport read, as a word a player can shout across a stage. */
function transportLabel(state: LooperState): string {
    switch (state) {
        case LooperState.RECORDING: return 'REC';
        case LooperState.OVERDUBBING: return 'DUB';
        case LooperState.PLAYING: return 'PLAY';
        case LooperState.ARMED: return 'ARMED';
        default: return 'IDLE';
    }
}

/** Map an engine peak envelope onto the shared trace viewBox. */
function tracePoints(data: number[], upTo: number): string {
    const n = data.length;
    if (n < 2) return '';
    const span = Math.max(upTo, 1) / 100 * TRACE_W;
    const step = span / (n - 1);
    let out = '';
    for (let i = 0; i < n; i += 1) {
        const v = Math.min(Math.max(data[i] ?? 0, 0), 1);
        out += `${Math.round(i * step * 100) / 100},${Math.round((TRACE_H - v * TRACE_H) * 100) / 100} `;
    }
    return out.trimEnd();
}

export const LooperNode = memo(function LooperNode({
    node,
    handlePortMouseDown,
    handlePortMouseUp,
    handlePortMouseEnter,
    handlePortMouseLeave,
    hasConnection,
    handleHeaderMouseDown,
    handleNodeMouseEnter,
    handleNodeMouseLeave,
    isSelected,
    isDragging,
    isHoveredWithConnections,
    style
}: LooperNodeProps) {
    const data = node.data as LooperNodeData;
    const updateNodeData = useGraphStore((s) => s.updateNodeData);
    const beginGesture = useGraphStore((s) => s.beginGesture);
    const endGesture = useGraphStore((s) => s.endGesture);
    const isAudioContextReady = useAudioStore((s) => s.isAudioContextReady);

    // Audio clip store for drag-out functionality
    const addClip = useAudioClipStore((s) => s.addClip);
    const startClipDrag = useAudioClipStore((s) => s.startDrag);
    const registerDropTarget = useAudioClipStore((s) => s.registerDropTarget);
    const unregisterDropTarget = useAudioClipStore((s) => s.unregisterDropTarget);
    const clipDragState = useAudioClipStore((s) => s.dragState);

    // Library store for auto-saving loops and trashing deleted items
    const saveAudioToLibrary = useLibraryStore((s) => s.saveAudioToLibrary);
    const trashItem = useLibraryStore((s) => s.trashItem);

    // Refs for library store functions to avoid re-running effect when store updates
    const saveAudioToLibraryRef = useRef<SaveAudioToLibraryFn>(saveAudioToLibrary);
    const trashItemRef = useRef<TrashItemFn>(trashItem);

    useEffect(() => {
        saveAudioToLibraryRef.current = saveAudioToLibrary;
    }, [saveAudioToLibrary]);

    useEffect(() => {
        trashItemRef.current = trashItem;
    }, [trashItem]);

    // The card body; the drop-target bounds are read from the card it sits in.
    const bodyRef = useRef<HTMLDivElement>(null);

    const [loops, setLoops] = useState<LoopRow[]>([]);
    // The engine looper state — the SSOT for the transport UI. Driven by the
    // return frames, NEVER a local guess that can fail to reset.
    const [engineState, setEngineState] = useState<LooperState>(LooperState.IDLE);
    const [duration, setDuration] = useState(data.duration || 10);

    // Loop-level wet gain (0..1) — the balance control for the summed layers.
    const [loopVolume, setLoopVolume] = useState(
        data.loopVolume ?? DEFAULT_LOOP_VOLUME
    );

    /** The undoable per-layer facts: membership, mute and the display name (which
     *  is also the export name). One `setNodeData` verb, one Ctrl+Z. */
    const layers = useMemo(() => readLayerMeta(data), [data]);
    const layerMeta = useMemo(() => {
        const byId = new Map<string, LooperLayerMeta>();
        for (const layer of layers) byId.set(layer.id, layer);
        return byId;
    }, [layers]);

    /** The row whose delete is waiting for a yes — asked IN the card (UI-021). */
    const [pendingDelete, setPendingDelete] = useState<string | null>(null);
    /** Same for "clear every layer", which is delete N times. */
    const [confirmClear, setConfirmClear] = useState(false);
    /** And for "take the last layer back off", which is equally permanent. */
    const [confirmUndoLast, setConfirmUndoLast] = useState(false);

    /* An `alertdialog` that never RECEIVES focus is a native `confirm()`'s bug
       with better paint: the announcement fires into nothing and Tab keeps
       walking the card behind it. The app has one rule for this and one place
       that keeps it (`Shell/confirmFocus`) — the SAFE answer takes focus on
       open, and focus goes back where it came from on close, never to <body>.
       Both of this card's questions go through it, like the menu bar's and
       Settings'. */
    const keepAllRef = useRef<HTMLButtonElement>(null);
    const keepLayerRef = useRef<HTMLButtonElement>(null);
    const keepLastRef = useRef<HTMLButtonElement>(null);
    const recordRef = useRef<HTMLButtonElement>(null);

    useConfirmFocus(confirmUndoLast, keepLastRef, () => {
        const undo = bodyRef.current?.querySelector<HTMLButtonElement>('.looper-undo');
        return undo && !undo.disabled ? undo : recordRef.current;
    });

    useConfirmFocus(confirmClear, keepAllRef, () => {
        // "Delete all" disables the very button that opened the question, so
        // focus lands on the transport instead of falling to the document.
        const clear = bodyRef.current?.querySelector<HTMLButtonElement>('.looper-clear');
        return clear && !clear.disabled ? clear : recordRef.current;
    });
    // The row that asked, latched — `pendingDelete` is already null by the time
    // the restore runs.
    const deleteAskedFrom = useRef<string | null>(null);
    useEffect(() => {
        if (pendingDelete) deleteAskedFrom.current = pendingDelete;
    }, [pendingDelete]);

    useConfirmFocus(pendingDelete !== null, keepLayerRef, () => {
        // Answering re-renders the row's action cluster either way, so the
        // element focus came from is gone even when the layer survives. Go back
        // to the same ROW if it is still there, to any row if it is not, and to
        // the transport as the floor — never to <body>.
        const body = bodyRef.current;
        const asked = deleteAskedFrom.current;
        const sameRow = asked
            ? body?.querySelector<HTMLButtonElement>(
                  `[data-loop-id="${CSS.escape(asked)}"] .looper-layer__delete`,
              )
            : null;
        return (
            sameRow ??
            body?.querySelector<HTMLButtonElement>('.looper-layer__delete') ??
            recordRef.current
        );
    });

    // ---- The live trace: refs the engine writes, one shared frame paints -----
    const liveHistoryRef = useRef<number[]>([]);
    const playheadRef = useRef(0);
    const traceDirty = useRef(true);
    const traceElRef = useRef<SVGPolylineElement>(null);
    const playheadElRef = useRef<SVGLineElement>(null);
    const meterRef = useRef<MeterHandle>(null);

    // Derived transport flags from the engine state (no separate local boolean).
    const isRecording =
        engineState === LooperState.RECORDING ||
        engineState === LooperState.OVERDUBBING;
    const isPlaying = engineState === LooperState.PLAYING;
    const isLive = isRecording || isPlaying;
    const hasLayers = loops.length > 0;
    const allMuted = hasLayers && loops.every((l) => l.isMuted);

    // Get port IDs from node.ports
    const inputPort = node.ports.find(p => p.direction === 'input' && p.type === 'audio');
    const outputPort = node.ports.find(p => p.direction === 'output' && p.type === 'audio');
    const inputPortId = inputPort?.id || 'audio-in';
    const outputPortId = outputPort?.id || 'audio-out';

    // Get the Looper instance from the audio executor
    const getLooper = useCallback(() => {
        return getExecutor().getLooper(node.id);
    }, [node.id]);

    /**
     * Write the layer metadata as ONE undo step.
     *
     * This is the only door: every user-facing layer edit on this card goes
     * through it, so a mute, a rename, a delete and a committed take each cost
     * exactly one `Ctrl+Z` — and never the node. Writing metadata that is
     * byte-identical to what is already there produces no verb and therefore no
     * entry (`diffGraph` compares the node), so the engine-driven syncs below
     * are free when nothing actually changed.
     */
    const commitLayers = useCallback((next: readonly LooperLayerMeta[]) => {
        beginGesture();
        updateNodeData<{ layers: LooperLayerMeta[] }>(node.id, { layers: [...next] });
        endGesture();
    }, [node.id, updateNodeData, beginGesture, endGesture]);

    /** Re-derive the metadata from the handle's CURRENT rows. Stale-closure-safe:
     *  it reads both sides at call time, so the engine callbacks can use it. */
    const syncLayerMetaFromHandle = useCallback((rows?: readonly LayerSource[]) => {
        const source = rows ?? getLooper()?.getLoops() ?? [];
        const prev = readLayerMeta(useGraphStore.getState().nodes.get(node.id)?.data);
        commitLayers(mergeLayerMeta(source, prev));
    }, [getLooper, node.id, commitLayers]);

    const syncLayerMetaRef = useRef(syncLayerMetaFromHandle);
    useEffect(() => { syncLayerMetaRef.current = syncLayerMetaFromHandle; }, [syncLayerMetaFromHandle]);

    // Set up Looper callbacks when component mounts or audio context becomes ready
    // Uses refs for library store functions to prevent effect re-runs when store updates
    useEffect(() => {
        if (!isAudioContextReady) return;

        let looper = getLooper();
        let pollIntervalId: number | null = null;
        let isSetup = false;

        const syncRowsFromHandle = (l: ReturnType<typeof getLooper>) => {
            if (!l) return;
            // The handle's getLoops() is the SSOT for the committed layers (in
            // kernel/commit order); mirror it verbatim so row order == layer index.
            setLoops(l.getLoops().map((loop) => ({
                id: loop.id,
                waveformData: loop.waveformData || [],
                isMuted: loop.isMuted,
                libraryItemId: loop.libraryItemId,
                durationSeconds: loop.buffer?.duration,
            })));
        };

        const setupCallbacks = (l: ReturnType<typeof getLooper>) => {
            if (!l || isSetup) return;
            isSetup = true;

            l.setOnLoopAdded(async (audioLoop: Loop) => {
                // The handle already appended the row to getLoops(); re-sync from
                // it so order stays aligned with the kernel layer indices.
                syncRowsFromHandle(getLooper());
                // A committed take is a player action, so it gets its OWN undo
                // entry. Without one, `Ctrl+Z` straight after a pass would replay
                // whatever came before the Looper existed.
                syncLayerMetaRef.current();
                // Reset the live trace for the next pass.
                liveHistoryRef.current = [];
                traceDirty.current = true;

                if (audioLoop.buffer) {
                    // Auto-save to project library with "loop" tag. Use a ref to
                    // read the latest fn without causing effect re-runs.
                    try {
                        const itemId = await saveAudioToLibraryRef.current(audioLoop.buffer, 'Loop', ['loop']);
                        if (itemId) {
                            audioLoop.libraryItemId = itemId;
                            setLoops(prev => prev.map(loop =>
                                loop.id === audioLoop.id ? { ...loop, libraryItemId: itemId } : loop
                            ));
                        }
                        // A failed library save is a background convenience, not a
                        // performance-critical path — no focus-stealing toast.
                        // The loop still plays; we stay quiet (a held note beats a glitch).
                    } catch (err) {
                        console.warn('[Looper] Failed to auto-save loop to library:', err);
                    }
                }
            });

            l.setOnLoopDeleted((deletedLoop: Loop) => {
                // Trash the library item if the loop was saved (ref avoids re-runs).
                if (deletedLoop.libraryItemId) {
                    trashItemRef.current(deletedLoop.libraryItemId);
                }
                // Re-sync rows from the handle (it already spliced its list).
                syncRowsFromHandle(getLooper());
                // Drop the layer's metadata too, in the same shape as every other
                // layer edit. If the removal came from a user action the action
                // already committed this exact list, so this is a no-op write and
                // produces no second history entry.
                syncLayerMetaRef.current();
            });

            // Stage 3: a committed layer's TRUE captured PCM arrived after the row
            // was created (it crosses the seam on a separate path). Re-sync rows so
            // the meter-envelope trace swaps to the real waveform shape, and
            // auto-save the now-real buffer to the library.
            l.setOnLoopUpdated(async (updatedLoop: Loop) => {
                syncRowsFromHandle(getLooper());
                if (updatedLoop.buffer && !updatedLoop.libraryItemId) {
                    try {
                        const itemId = await saveAudioToLibraryRef.current(
                            updatedLoop.buffer,
                            'Loop',
                            ['loop'],
                        );
                        if (itemId) {
                            updatedLoop.libraryItemId = itemId;
                            setLoops((prev) =>
                                prev.map((loop) =>
                                    loop.id === updatedLoop.id
                                        ? { ...loop, libraryItemId: itemId }
                                        : loop,
                                ),
                            );
                        }
                    } catch (err) {
                        // Background convenience; a held note beats a glitch.
                        console.warn('[Looper] Failed to auto-save finalized loop:', err);
                    }
                }
            });

            l.setOnWaveformHistoryUpdate((history: number[], playhead: number) => {
                // EVERY engine return frame lands here — hundreds a second on the
                // wasm tier. So this writes REFS and a dirty bit, and nothing else.
                // The shared animation frame turns them into pixels (UI-023).
                liveHistoryRef.current = history;
                playheadRef.current = playhead;
                traceDirty.current = true;
                // The one React fact a frame may carry: a transport EDGE. Setting
                // the same value is a no-op in React, so this does not re-render.
                setEngineState(l.getEngineState() as LooperState);
            });

            l.setDuration(duration);
            // Push the persisted loop-level wet into the engine on (re)mount so the
            // balance survives reload (no-op until the node is in the graph).
            l.setWet(data.loopVolume ?? DEFAULT_LOOP_VOLUME);

            // Mirror any layers the handle already holds (e.g. after a remount).
            syncRowsFromHandle(l);
            setEngineState(l.getEngineState() as LooperState);
        };

        // If looper is available, set up immediately
        if (looper) {
            setupCallbacks(looper);
        } else {
            // Poll for looper availability with exponential backoff
            let delay = 50;
            const maxDelay = 1000;
            const maxAttempts = 10;
            let attempts = 0;

            const poll = () => {
                attempts++;
                looper = getLooper();
                if (looper) {
                    setupCallbacks(looper);
                } else if (attempts < maxAttempts) {
                    delay = Math.min(delay * 2, maxDelay);
                    pollIntervalId = window.setTimeout(poll, delay);
                } else if (import.meta.env.DEV) {
                    console.warn(`LooperNode: Failed to get looper after ${maxAttempts} attempts`);
                }
            };
            pollIntervalId = window.setTimeout(poll, delay);
        }

        return () => {
            if (pollIntervalId !== null) {
                clearTimeout(pollIntervalId);
            }
            const l = getLooper();
            if (l) {
                l.setOnLoopAdded(() => {});
                l.setOnLoopDeleted(() => {});
                l.setOnLoopUpdated(() => {});
                l.setOnWaveformHistoryUpdate(() => {});
            }
        };
    // Note: saveAudioToLibrary and trashItem are accessed via refs to prevent
    // effect re-runs when the library store updates (which happens during saving).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAudioContextReady, node.id, duration, getLooper]);

    /**
     * The trace painter. One subscription to the app's ONE shared frame, alive
     * only while the engine is actually moving; it writes two SVG attributes and
     * returns. No React, no store, no allocation beyond the points string.
     */
    useEffect(() => {
        if (!isLive) {
            // Park the trace flat so a stopped looper does not freeze mid-shape.
            traceElRef.current?.setAttribute('points', '');
            playheadElRef.current?.setAttribute('x1', '0');
            playheadElRef.current?.setAttribute('x2', '0');
            return;
        }
        traceDirty.current = true;
        return registerTimelineFrameWriter(() => {
            if (!traceDirty.current) return;
            traceDirty.current = false;
            const x = Math.min(Math.max(playheadRef.current, 0), 100) / 100 * TRACE_W;
            traceElRef.current?.setAttribute(
                'points',
                tracePoints(liveHistoryRef.current, playheadRef.current),
            );
            const line = playheadElRef.current;
            if (line) {
                const s = String(Math.round(x * 100) / 100);
                line.setAttribute('x1', s);
                line.setAttribute('x2', s);
            }
        });
    }, [isLive]);

    /**
     * The level meter, on the same shared frame and the same dB scale as every
     * other meter in the app (`meterScale`) — a linear bar under a dB readout is
     * a lie dressed as precision. One custom-property write per frame.
     */
    useEffect(() => {
        return registerTimelineLevelWriter((levels) => {
            meterRef.current?.setSignal(meterScale(levels.get(node.id) ?? 0));
        });
    }, [node.id]);

    const handleRecord = useCallback(async () => {
        const looper = getLooper();
        if (!looper) return;
        // Start a pass. The engine decides RECORDING (first take) vs OVERDUBBING
        // (layers exist) and reports it back; the UI reflects that, never guesses.
        await looper.startRecording();
    }, [getLooper]);

    const handleStopRecord = useCallback(() => {
        const looper = getLooper();
        if (looper) {
            looper.stopRecording();
        }
        // Do NOT set a local state here — the engine reports the commit edge
        // (RECORDING|OVERDUBBING -> PLAYING) which flips the UI authoritatively.
    }, [getLooper]);

    /**
     * `data.layers` -> the engine, and -> the visible rows.
     *
     * Mute flows ONE way: a click writes the metadata, and this reconciles.
     * That is what makes an undone mute really un-mute the audio instead of only
     * repainting the row — the history driver writes `node.data` and lands here
     * on exactly the same path a click takes.
     *
     * Metadata is the SSOT, so its ABSENCE means the default: unmuted. That is
     * what makes the FIRST mute on a card undoable — the inverse of that first
     * `setNodeData` is a `data` with no `layers` key at all, and a reconciler
     * that only acted on rows it had metadata for would leave the audio muted
     * while the row said otherwise. It also means a mute survives a reload: the
     * engine handle comes back fresh and this pushes the player's mutes into it.
     */
    useEffect(() => {
        const looper = getLooper();
        if (looper) {
            for (const engineLoop of looper.getLoops()) {
                const wanted = layerMeta.get(engineLoop.id)?.isMuted ?? false;
                if (engineLoop.isMuted !== wanted) looper.toggleLoopMute(engineLoop.id);
            }
        }
        setLoops((prev) => {
            let dirty = false;
            const next = prev.map((row) => {
                const wanted = layerMeta.get(row.id)?.isMuted ?? false;
                if (wanted === row.isMuted) return row;
                dirty = true;
                return { ...row, isMuted: wanted };
            });
            return dirty ? next : prev;
        });
    }, [layerMeta, getLooper]);

    const handleToggleMute = useCallback((loopId: string) => {
        commitLayers(
            mergeLayerMeta(loops, layers).map((meta) =>
                meta.id === loopId ? { ...meta, isMuted: !meta.isMuted } : meta,
            ),
        );
    }, [commitLayers, loops, layers]);

    /**
     * Silence / un-silence the whole loop. There is no transport STOP on the
     * `LooperHandle` seam, and pretending otherwise would be a control that
     * lies — so this is exactly what it says: every layer's own mute, moved
     * together, through the same SET_MUTE the row toggles drive — and as ONE
     * undo step, because it was one press.
     */
    const handleToggleAllMuted = useCallback(() => {
        const next = !allMuted;
        commitLayers(mergeLayerMeta(loops, layers).map((meta) => ({ ...meta, isMuted: next })));
    }, [commitLayers, loops, layers, allMuted]);

    /** Rename a layer. The label is the performance name AND the export name. */
    const handleRenameLayer = useCallback((loopId: string, next: string, fallback: string) => {
        commitLayers(
            mergeLayerMeta(loops, layers).map((meta) =>
                meta.id === loopId ? { ...meta, name: next.trim() || fallback } : meta,
            ),
        );
    }, [commitLayers, loops, layers]);

    /**
     * One destructive press, ONE sealed undo entry.
     *
     * Both halves matter and both were wrong before W5-P7c.
     *
     * *One entry.* `LooperHandle.deleteLoop` reports the removal on the SAME
     * synchronous call, and this card's `onLoopDeleted` commits its own layer-
     * metadata step when it does. So "clear every layer" wrote one entry PER
     * LAYER: N dead `Ctrl+Z` presses on stage before the stack reaches a step
     * that changes anything. `useHistoryStore.begin` is depth-counted, so the
     * outer bracket here swallows every nested commit into one press.
     *
     * *Sealed.* See {@link sealLastGraphEntry}. It has to run after the bracket
     * closes, because that is when the entry is appended.
     */
    const commitDestructive = useCallback((run: () => void) => {
        beginGesture();
        try {
            run();
        } finally {
            endGesture();
        }
        sealLastGraphEntry();
    }, [beginGesture, endGesture]);

    const handleDeleteLoop = useCallback((loopId: string) => {
        // The handle's onLoopDeleted re-syncs rows; splice optimistically too so
        // the row vanishes instantly (design-for-instant).
        const remaining = loops.filter((loop) => loop.id !== loopId);
        commitDestructive(() => {
            getLooper()?.deleteLoop(loopId);
            setLoops(remaining);
            commitLayers(mergeLayerMeta(remaining, layers));
        });
        setPendingDelete(null);
    }, [getLooper, loops, layers, commitLayers, commitDestructive]);

    /** Delete every layer — the honest spelling of "Clear". */
    const handleClearAll = useCallback(() => {
        commitDestructive(() => {
            const looper = getLooper();
            for (const loop of loops) looper?.deleteLoop(loop.id);
            setLoops([]);
            commitLayers([]);
        });
        setConfirmClear(false);
    }, [getLooper, loops, commitLayers, commitDestructive]);

    // Undo the most-recently committed layer (LIFO) — a real engine UNDO_LAST.
    // Permanent, like the other two removals, so it asks first.
    const handleUndoLast = useCallback(() => {
        const looper = getLooper();
        setConfirmUndoLast(false);
        if (!looper) return;
        // onLoopDeleted re-syncs; pop optimistically for instant feedback.
        const remaining = loops.slice(0, -1);
        commitDestructive(() => {
            looper.undoLast();
            setLoops(remaining);
            commitLayers(mergeLayerMeta(remaining, layers));
        });
    }, [getLooper, loops, layers, commitLayers, commitDestructive]);

    /** Save a layer into the project library under its current display name. */
    const handleExport = useCallback(async (loopId: string, name: string) => {
        const looper = getLooper();
        if (!looper) return;
        const audioLoop = looper.getLoops().find(l => l.id === loopId);
        if (!audioLoop?.buffer) return;
        const itemId = await saveAudioToLibraryRef.current(audioLoop.buffer, name, ['exported', 'loop']);
        if (itemId) {
            setLoops(prev => prev.map(l =>
                l.id === loopId ? { ...l, libraryItemId: itemId } : l
            ));
        }
    }, [getLooper]);

    const isInfinite = isInfiniteDuration(duration);

    const handleDurationChange = useCallback((newDuration: number) => {
        let finalDuration: number;
        if (isInfiniteDuration(newDuration)) {
            finalDuration = INFINITE_DURATION;
        } else {
            // Clamp to valid range: 1-60 seconds
            finalDuration = Math.max(1, Math.min(60, Math.round(newDuration)));
        }
        setDuration(finalDuration);
        // Bracket the node.data write in a gesture so Ctrl+Z reverts it.
        beginGesture();
        updateNodeData<LooperNodeData>(node.id, { duration: finalDuration });
        endGesture();

        const looper = getLooper();
        if (looper) {
            looper.setDuration(finalDuration);
        }
    }, [node.id, updateNodeData, getLooper, beginGesture, endGesture]);

    // Loop-level wet (balance) control. Drives SetParam(WET) on the looper and
    // persists into node.data. The whole sweep is ONE Ctrl+Z step: the bracket
    // opens on the first value change (pointer, wheel or Arrow key alike) and
    // closes on the control's commit.
    const mix = useGestureBracket();
    const handleLoopVolumeChange = useCallback((next: number) => {
        const v = Math.max(0, Math.min(1, next));
        setLoopVolume(v);
        const looper = getLooper();
        if (looper) {
            looper.setWet(v);
        }
        mix.begin();
        updateNodeData<LooperNodeData>(node.id, { loopVolume: v });
    }, [node.id, updateNodeData, getLooper, mix]);

    // Handle scroll on the loop length (native listener for trackpad support)
    const handleDurationScroll = useCallback((scroll: ScrollData) => {
        if (isRecording) return;

        if (isInfinite && scroll.scrollingDown) {
            // Scrolling down from infinite goes to 60
            handleDurationChange(60);
        } else if (duration === 60 && scroll.scrollingUp) {
            // Scrolling up from 60 goes to infinite
            handleDurationChange(INFINITE_DURATION);
        } else if (!isInfinite) {
            const delta = scroll.scrollingUp ? 1 : -1;
            handleDurationChange(duration + delta);
        }
    }, [duration, isInfinite, isRecording, handleDurationChange]);

    const { ref: durationScrollRef } = useScrollCapture<HTMLSpanElement>({
        onScroll: handleDurationScroll,
        enabled: !isRecording,
    });

    // Handle drag-out from loop items
    const handleLoopDragStart = useCallback((loopRow: LoopRow, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        const looper = getLooper();
        if (!looper) return;

        // Find the actual loop with buffer
        const loop = looper.getLoops().find(l => l.id === loopRow.id);
        if (!loop || !loop.buffer) return;

        // Create a temporary sample ID based on the loop
        const tempSampleId = `looper-${node.id}-${loopRow.id}-${Date.now()}`;
        const tempSampleName = `${layerMeta.get(loopRow.id)?.name ?? `Loop ${loops.indexOf(loopRow) + 1}`}.wav`;

        // Store the buffer in global cache so any looper can access it
        setClipBuffer(tempSampleId, loop.buffer);

        // Create the clip
        const clipData = createClipFromLoop(loop, tempSampleId, tempSampleName, node.id);
        if (!clipData) return; // Buffer was null (shouldn't happen since we checked above)

        // Add to store and get the ID
        const clipId = addClip(clipData);

        // Get bounds of the loop item element
        const target = e.currentTarget as HTMLElement;
        const bounds = target.getBoundingClientRect();

        // Remove the loop from the looper (move semantics - the loop becomes a clip)
        looper.deleteLoop(loopRow.id);
        const remaining = loops.filter(l => l.id !== loopRow.id);
        setLoops(remaining);
        // The layer left this card for the canvas — one gesture, one undo entry,
        // and the take itself is not lost: it is the clip now.
        commitLayers(mergeLayerMeta(remaining, layers));

        // Start dragging
        startClipDrag(clipId, { x: e.clientX, y: e.clientY }, bounds);
    }, [getLooper, node.id, loops, layers, layerMeta, commitLayers, addClip, startClipDrag]);

    // Handle clip drop into looper (add as new loop layer)
    const handleClipDrop = useCallback(async (clip: AudioClip) => {
        const looper = getLooper();
        if (!looper) return;

        try {
            // First check if buffer is in cache (for looper-originated clips)
            const cachedBuffer = getClipBuffer(clip.sampleId);
            if (cachedBuffer) {
                looper.addLoopFromBuffer(cachedBuffer);
                return;
            }

            const audioContext = getAudioContext();
            if (!audioContext) return;

            const buffer = await loadClipAudio(clip, audioContext);
            looper.addLoopFromBuffer(buffer);
        } catch (error) {
            console.error('Failed to load clip audio for looper:', error);
        }
    }, [getLooper]);

    // Register as drop target
    useEffect(() => {
        const dropTarget: ClipDropTarget = {
            nodeId: node.id,
            targetName: 'Looper',
            onClipDrop: handleClipDrop,
            canAcceptClip: () => true, // Accept any audio clip
            // The whole card is the target; the body is what holds the ref.
            getDropZoneBounds: () =>
                bodyRef.current?.closest('.oj-node')?.getBoundingClientRect() ?? null,
        };

        registerDropTarget(dropTarget);
        return () => unregisterDropTarget(node.id);
    }, [node.id, handleClipDrop, registerDropTarget, unregisterDropTarget]);

    // Visual feedback when being dragged over
    const isDropTarget = clipDragState.hoveredTargetId === node.id;

    const cardClass = [
        'schematic-node',
        'looper-node',
        isLive && 'is-live',
        isRecording && 'is-recording',
        isDropTarget && 'clip-drop-target',
        isHoveredWithConnections && 'hover-connecting',
    ].filter(Boolean).join(' ');

    const lengthLabel = isInfinite ? '∞' : `${duration} s`;

    const stateChip = useMemo(() => {
        if (isRecording) {
            return (
                <Chip tone="danger" className="looper-state" title="Capturing a pass">
                    {transportLabel(engineState)}
                </Chip>
            );
        }
        if (isPlaying) {
            return (
                <Chip tone="success" className="looper-state" title="The loop is rolling">
                    PLAY
                </Chip>
            );
        }
        if (engineState === LooperState.ARMED) {
            return <Chip tone="warning" className="looper-state">ARMED</Chip>;
        }
        return null;
    }, [engineState, isRecording, isPlaying]);

    return (
        <NodeShell
            className={cardClass}
            style={style}
            title="Looper"
            nodeType="LOOP"
            selected={isSelected}
            dragging={isDragging}
            headerProps={{ onMouseDown: handleHeaderMouseDown }}
            headerAction={stateChip}
            onMouseEnter={handleNodeMouseEnter}
            onMouseLeave={handleNodeMouseLeave}
            inputs={
                <PortRow
                    side="input"
                    kind="audio"
                    label={inputPort?.name ?? 'In'}
                    connected={hasConnection(inputPortId)}
                    data-node-id={node.id}
                    data-port-id={inputPortId}
                    data-port-type={inputPort?.type ?? 'audio'}
                    onMouseDown={(e: React.MouseEvent) => { e.stopPropagation(); handlePortMouseDown?.(inputPortId, e); }}
                    onMouseUp={(e: React.MouseEvent) => { e.stopPropagation(); handlePortMouseUp?.(inputPortId, e); }}
                    onMouseEnter={() => handlePortMouseEnter?.(inputPortId)}
                    onMouseLeave={handlePortMouseLeave}
                />
            }
            outputs={
                <PortRow
                    side="output"
                    kind="audio"
                    label={outputPort?.name ?? 'Out'}
                    connected={hasConnection(outputPortId)}
                    data-node-id={node.id}
                    data-port-id={outputPortId}
                    data-port-type={outputPort?.type ?? 'audio'}
                    onMouseDown={(e: React.MouseEvent) => { e.stopPropagation(); handlePortMouseDown?.(outputPortId, e); }}
                    onMouseUp={(e: React.MouseEvent) => { e.stopPropagation(); handlePortMouseUp?.(outputPortId, e); }}
                    onMouseEnter={() => handlePortMouseEnter?.(outputPortId)}
                    onMouseLeave={handlePortMouseLeave}
                />
            }
        >
            <div ref={bodyRef} className="looper-body" onMouseDown={(e) => e.stopPropagation()}>
                {/* The cycle: the live trace, the playhead, and how long a pass is.
                    Both SVG attributes below are written by the shared frame, so
                    this subtree never re-renders while the engine is moving. */}
                <div className="looper-cycle">
                    <div className={`looper-live${isRecording ? ' is-recording' : ''}`}>
                        <svg
                            className="looper-live__svg"
                            viewBox={`0 ${-TRACE_BLEED} ${TRACE_W} ${TRACE_H + TRACE_BLEED * 2}`}
                            preserveAspectRatio="none"
                            role="img"
                            aria-label={isRecording ? 'Live recording trace' : 'Loop position'}
                        >
                            <line
                                className="looper-live__base"
                                x1="0" y1={TRACE_H} x2={TRACE_W} y2={TRACE_H}
                            />
                            <polyline ref={traceElRef} className="looper-live__trace" points="" />
                            <line
                                ref={playheadElRef}
                                className="looper-live__playhead"
                                x1="0" y1="0" x2="0" y2={TRACE_H}
                            />
                        </svg>
                    </div>

                    <div className="looper-cycle__row">
                        <span ref={durationScrollRef} className="looper-length">
                            <ValueScrubber
                                label="LOOP"
                                value={isInfinite ? 60 : duration}
                                display={lengthLabel}
                                disabled={isRecording}
                                onCommit={handleDurationChange}
                                title="Loop length in seconds — click to type, scroll past 60 for free-run"
                            />
                        </span>
                        <Meter
                            ref={meterRef}
                            bars={7}
                            height={16}
                            barWidth={4}
                            label="Looper output level"
                        />
                    </div>
                </div>

                {/* Transport. Record is the only button with a fill, because it is
                    the only one that changes what the audience hears next. */}
                <div className="looper-transport" role="group" aria-label="Looper transport">
                    <Button
                        variant="danger"
                        ref={recordRef}
                        className={`looper-record${isRecording ? ' is-recording' : ''}`}
                        onClick={isRecording ? handleStopRecord : handleRecord}
                        disabled={!isAudioContextReady}
                        aria-label={
                            isRecording
                                ? 'Stop and commit this loop pass'
                                : hasLayers
                                  ? 'Overdub a new layer'
                                  : 'Record a loop'
                        }
                        aria-pressed={isRecording}
                        title={
                            !isAudioContextReady
                                ? 'Press play once to start the audio engine, then record'
                                : isRecording
                                  ? 'Stop / commit pass'
                                  : hasLayers
                                    ? 'Overdub a layer'
                                    : 'Record'
                        }
                    >
                        {isRecording ? <IconStop size={15} /> : <IconRecord size={15} />}
                        <span className="looper-record__label">
                            {isRecording ? 'Stop' : hasLayers ? 'Overdub' : 'Record'}
                        </span>
                    </Button>
                    <IconButton
                        variant="node"
                        className="looper-silence"
                        label={allMuted ? 'Unmute every layer' : 'Silence every layer'}
                        aria-pressed={allMuted}
                        disabled={!hasLayers}
                        onClick={handleToggleAllMuted}
                        icon={allMuted ? <IconMute size={16} /> : <IconSpeaker size={16} />}
                        title={allMuted ? 'Unmute every layer' : 'Silence every layer'}
                    />
                    <IconButton
                        variant="node"
                        className="looper-clear"
                        label="Clear every layer"
                        disabled={!hasLayers}
                        onClick={() => setConfirmClear(true)}
                        icon={<IconClose size={16} />}
                        title="Clear every layer"
                    />
                </div>

                {confirmClear && (
                    <Callout
                        variant="danger"
                        title={`Delete all ${loops.length} layers?`}
                        className="looper-confirm"
                        role="alertdialog"
                        aria-label="Delete every layer"
                        onKeyDown={(event) => {
                            if (event.key !== 'Escape') return;
                            event.stopPropagation();
                            setConfirmClear(false);
                        }}
                    >
                        These cannot go back into the loop — their takes stay in the Library trash.
                        <div className="looper-confirm__actions">
                            <Button
                                ref={keepAllRef}
                                variant="secondary"
                                data-autofocus="true"
                                onClick={() => setConfirmClear(false)}
                            >
                                Keep them
                            </Button>
                            <Button variant="danger" onClick={handleClearAll}>
                                Delete all
                            </Button>
                        </div>
                    </Callout>
                )}

                {confirmUndoLast && (
                    <Callout
                        variant="danger"
                        title="Take the last layer back off?"
                        className="looper-confirm"
                        role="alertdialog"
                        aria-label="Take the last layer back off"
                        onKeyDown={(event) => {
                            if (event.key !== 'Escape') return;
                            event.stopPropagation();
                            setConfirmUndoLast(false);
                        }}
                    >
                        This cannot go back into the loop — its take stays in the Library trash.
                        <div className="looper-confirm__actions">
                            <Button
                                ref={keepLastRef}
                                variant="secondary"
                                data-autofocus="true"
                                onClick={() => setConfirmUndoLast(false)}
                            >
                                Keep it
                            </Button>
                            <Button variant="danger" onClick={handleUndoLast}>
                                Take it off
                            </Button>
                        </div>
                    </Callout>
                )}

                {/* The layers, newest last — the same order the kernel stacks them. */}
                {hasLayers && (
                    <div className="looper-layers">
                        <div className="looper-layers__head">
                            <span className="looper-layers__count">
                                {loops.length} {loops.length === 1 ? 'layer' : 'layers'}
                            </span>
                            <Button
                                variant="ghost"
                                className="looper-undo"
                                onClick={() => setConfirmUndoLast(true)}
                                title="Take the last layer back off - it cannot go back into the loop"
                            >
                                <IconUndo />
                                Undo layer
                            </Button>
                        </div>

                        <List className="looper-list" aria-label="Recorded layers">
                            {loops.map((loop, index) => {
                                const fallbackName = `Loop ${index + 1}`;
                                const name = layerMeta.get(loop.id)?.name ?? fallbackName;
                                const confirming = pendingDelete === loop.id;
                                return (
                                    <ListRow
                                        key={loop.id}
                                        data-loop-id={loop.id}
                                        className={`looper-layer${loop.isMuted ? ' is-muted' : ''}${confirming ? ' is-confirming' : ''}`}
                                        aria-label={`${name}${loop.isMuted ? ', muted' : ''}`}
                                        onMouseDown={(e) => { if (!confirming) handleLoopDragStart(loop, e); }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Delete' || e.key === 'Backspace') {
                                                e.preventDefault();
                                                setPendingDelete(loop.id);
                                            }
                                        }}
                                        tabIndex={0}
                                        title="Drag onto the canvas to turn this layer into a clip"
                                        actions={confirming ? (
                                            <span
                                                className="looper-layer__confirm"
                                                role="alertdialog"
                                                aria-label={`Delete ${name}?`}
                                                onKeyDown={(event) => {
                                                    if (event.key !== 'Escape') return;
                                                    event.stopPropagation();
                                                    setPendingDelete(null);
                                                }}
                                            >
                                                <Button
                                                    ref={keepLayerRef}
                                                    variant="secondary"
                                                    data-autofocus="true"
                                                    onClick={() => setPendingDelete(null)}
                                                >
                                                    Keep
                                                </Button>
                                                <Button
                                                    variant="danger"
                                                    title="Permanent — the kernel owns this take's audio"
                                                    onClick={() => handleDeleteLoop(loop.id)}
                                                >
                                                    Delete
                                                </Button>
                                            </span>
                                        ) : (
                                            <>
                                                <IconButton
                                                    variant="ghost"
                                                    label={loop.isMuted ? `Unmute ${name}` : `Mute ${name}`}
                                                    aria-pressed={loop.isMuted}
                                                    className="looper-layer__mute"
                                                    onClick={() => handleToggleMute(loop.id)}
                                                    onMouseDown={(e) => e.stopPropagation()}
                                                    icon={loop.isMuted ? <IconMute size={13} /> : <IconSpeaker size={13} />}
                                                />
                                                <IconButton
                                                    variant="ghost"
                                                    label={loop.libraryItemId ? `Re-export ${name}` : `Export ${name}`}
                                                    className={`looper-layer__export${loop.libraryItemId ? ' is-exported' : ''}`}
                                                    onClick={() => void handleExport(loop.id, name)}
                                                    onMouseDown={(e) => e.stopPropagation()}
                                                    icon={<IconDownload size={13} />}
                                                />
                                                <IconButton
                                                    variant="ghost"
                                                    label={`Delete ${name}`}
                                                    className="looper-layer__delete"
                                                    onClick={() => setPendingDelete(loop.id)}
                                                    onMouseDown={(e) => e.stopPropagation()}
                                                    icon={<IconClose size={13} />}
                                                />
                                            </>
                                        )}
                                    >
                                        <span
                                            className="looper-layer__name"
                                            onMouseDown={(e) => e.stopPropagation()}
                                        >
                                            <EditableLabel
                                                value={name}
                                                mono
                                                placeholder="Layer name"
                                                onCommit={(next) =>
                                                    handleRenameLayer(loop.id, next, fallbackName)
                                                }
                                            />
                                        </span>
                                        <Waveform
                                            className="looper-layer__wave"
                                            data={loop.waveformData}
                                            height={18}
                                            aria-label={`${name} waveform`}
                                        />
                                        <span className="oj-node__readout looper-layer__len">
                                            {loop.durationSeconds
                                                ? formatSampleDuration(loop.durationSeconds)
                                                : lengthLabel}
                                        </span>
                                    </ListRow>
                                );
                            })}
                        </List>
                    </div>
                )}

                {/* Balance: how much of the summed layers reaches the output. Only
                    meaningful once there is something to balance. */}
                {hasLayers && (
                    <div className="looper-mix">
                        <Knob
                            label="MIX"
                            value={loopVolume}
                            min={0}
                            max={1}
                            defaultValue={DEFAULT_LOOP_VOLUME}
                            size={44}
                            format={(v) => `${Math.round(v * 100)}%`}
                            onChange={handleLoopVolumeChange}
                            onCommit={mix.end}
                        />
                        <p className="looper-mix__hint">
                            How much of the stacked layers reaches the output.
                        </p>
                    </div>
                )}

                {!hasLayers && !isRecording && (
                    <p className="looper-empty">
                        Record a pass, or drop an audio clip on this card to start a layer.
                    </p>
                )}
            </div>
        </NodeShell>
    );
});
