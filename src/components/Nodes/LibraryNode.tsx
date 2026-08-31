/**
 * Library Node — a file browser that lives on the canvas.
 *
 * The audit's verdict on the old build was right: this is not node styling, it
 * is a file browser (757 lines of it), and it should be built from the same
 * List / ListRow / Input / Chip the rest of the app browses with. It is now.
 *
 * What the card is: a NodeShell whose body is two resizable panels — tags on
 * the left, files on the right — with one live seam out of the header, the
 * `sample-out` port that feeds a selected sample's PCM to connected Samplers.
 * It is the ONE resizable node on this canvas, and S3's measured geometry reads
 * `data.width` / `data.height`, so the resize seam is preserved exactly.
 *
 * Three rules this file exists to keep:
 *
 *  1. **No native dialog, ever** (UI-021). Deleting a tag, permanently deleting
 *     a file and emptying the trash all used to call `confirm()`, which steals
 *     focus from a live instrument and cannot be dismissed the way the rest of
 *     the app is. They now ask in the card, as one `alertdialog` Callout that
 *     always appears in the same place so the list never jumps.
 *  2. **The selection only moves to a sample that actually arrived** (UI-020).
 *     Decode and deliver first; commit the visible/persisted selection after.
 *     A file that fails to decode leaves the last good one playing.
 *  3. **A tag's colour is its identity, never its legibility.** The hue rides in
 *     on one custom property and is spent on the 8px dot in the left panel —
 *     and on nothing else. W5-P7 also washed the file-row chips with it, and
 *     four of four seeded tags then measured 3.46-4.33:1 in dark: `getTagColor`
 *     hashes an arbitrary tag name into a hue, so a wash under a fixed text
 *     token has a ratio
 *     that changes with the tag's NAME and can never be proven AA. The wash is
 *     gone; every word on this card is a theme token, so a tag can be any hue
 *     and still read.
 *  4. **Every player action is one Ctrl+Z, and never the card** (W5-P7b). The
 *     library is not the graph, so rename / trash / restore / tagging used to
 *     reach no history at all — and `Ctrl+Z` after one of them replayed the last
 *     GRAPH entry, which on a fresh canvas is "add the Library node". Those
 *     gestures now go through `recordLibraryEdit` (`store/libraryVerbs.ts`),
 *     which puts a metadata-and-references delta on the SAME history stack the
 *     graph uses. The two that destroy a payload outside the store —
 *     permanently delete, empty trash — are `recordSealedLibraryEditAsync`: they ask
 *     first, and their step is consumed by `Ctrl+Z` without resurrecting a row
 *     whose audio is gone.
 *
 * Rebuilt in W5-P7; the undo seam and the tag-chip contrast fix are W5-P7b.
 */

import { useState, useCallback, useEffect, useMemo, useRef, memo } from 'react';
import {
  Button,
  Callout,
  Chip,
  IconButton,
  IconClose,
  Input,
  List,
  ListRow,
  NodeShell,
  PortRow,
  ProgressBar,
  WaveformView,
} from '@openjammer/oj-ui';
import { toast } from 'sonner';
import type { GraphNode, LibraryNodeData, LibraryItemRef, NodeData } from '../../engine/types';
import { useGraphStore } from '../../store/graphStore';
import {
  useLibraryStore,
  getSampleFile,
  getTagColor,
  getWaveform,
  type LibraryItem,
} from '../../store/libraryStore';
import { recordLibraryEdit, recordSealedLibraryEditAsync } from '../../store/libraryVerbs';
import { useIsAgentPending } from '../../store/agentSessionStore';
import { base64ToPeaks, formatSampleDuration } from '../../utils/audioMetadata';
import { isFileSystemAccessSupported, selectLibraryFolder } from '../../utils/fileSystemAccess';
import { getAudioContext } from '../../audio/audioContext';
import { getExecutor } from '../../audio/executor';
import { useResize } from '../../hooks/useResize';
import { usePanelResize } from '../../hooks/usePanelResize';
import { ResizeHandles } from '../common/ResizeHandles';
import { PanelSeparator } from '../common/PanelSeparator';
import { ScrollContainer } from '../common/ScrollContainer';
import { useConfirmFocus } from '../Shell/confirmFocus';
import { RelinkSamplesDialog } from '../Dialogs/RelinkSamplesDialog';
import './LibraryNode.css';

interface LibraryNodeProps {
  node: GraphNode;
  handleHeaderMouseDown: (e: React.MouseEvent) => void;
  handleNodeMouseEnter: () => void;
  handleNodeMouseLeave: () => void;
  isSelected: boolean;
  isDragging: boolean;
  isHoveredWithConnections?: boolean;
  style: React.CSSProperties;
  // Port wiring (SEAM-1): the library declares one live seam — `sample-out` — that
  // feeds a selected sample's PCM into connected Sampler nodes. These come from
  // NodeWrapper's shared schematic props so the port is draggable like any other.
  handlePortMouseDown?: (portId: string, e: React.MouseEvent) => void;
  handlePortMouseUp?: (portId: string, e: React.MouseEvent) => void;
  handlePortMouseEnter?: (portId: string) => void;
  handlePortMouseLeave?: () => void;
  hasConnection?: (portId: string) => boolean;
}

// Minimum dimensions for resizing - must match CSS .library-node min-width/min-height
const MIN_WIDTH = 400;
const MIN_HEIGHT = 300;

// Type guard for LibraryNodeData - validates expected shape
function isLibraryNodeData(data: NodeData | undefined): data is LibraryNodeData {
  if (data === null || data === undefined || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;

  // Validate field types if present (allow partial data being initialized)
  if ('itemRefs' in d && !Array.isArray(d.itemRefs)) return false;
  if ('playbackMode' in d && !['oneshot', 'loop', 'hold'].includes(d.playbackMode as string)) return false;
  if ('volume' in d && (typeof d.volume !== 'number' || !Number.isFinite(d.volume))) return false;

  return true;
}

export const LibraryNode = memo(function LibraryNode({
  node,
  handleHeaderMouseDown,
  handleNodeMouseEnter,
  handleNodeMouseLeave,
  isSelected,
  isDragging,
  isHoveredWithConnections,
  style,
  handlePortMouseDown,
  handlePortMouseUp,
  handlePortMouseEnter,
  handlePortMouseLeave,
  hasConnection,
}: LibraryNodeProps) {
  // Validate node data with type guard and provide defaults
  const data: LibraryNodeData = isLibraryNodeData(node.data) ? node.data : {
    libraryId: undefined,
    currentItemId: undefined,
    itemRefs: [],
    playbackMode: 'oneshot',
    volume: 0.8,
  };
  const updateNodeData = useGraphStore(s => s.updateNodeData);
  const isAgentPending = useIsAgentPending(node.id);

  // Library store
  const libraries = useLibraryStore(s => s.libraries);
  const scanProgress = useLibraryStore(s => s.scanProgress);
  const addLibrary = useLibraryStore(s => s.addLibrary);
  const scanLibrary = useLibraryStore(s => s.scanLibrary);
  const projectLibraryId = useLibraryStore(s => s.projectLibraryId);
  const checkMissingItems = useLibraryStore(s => s.checkMissingItems);
  /**
   * The items map, SUBSCRIBED — not read through `getItemsByLibrary()`.
   *
   * `getItemsByLibrary` is a store ACTION: calling it reads `get().items`
   * without subscribing, so nothing on this card re-rendered when an item's
   * `status` flipped. That is half of why the missing-file loop was dead — even
   * once something wrote `status: 'missing'`, the struck-through row
   * (`.is-missing`, below) would not have appeared until an unrelated render
   * happened along. One subscription fixes the row, the list and the banner.
   */
  const storeItems = useLibraryStore(s => s.items);

  // Tag management from store
  const pinnedTags = useLibraryStore(s => s.pinnedTags);
  const allTags = useLibraryStore(s => s.allTags);
  const createTag = useLibraryStore(s => s.createTag);
  const pinTag = useLibraryStore(s => s.pinTag);
  const unpinTag = useLibraryStore(s => s.unpinTag);
  const deleteTag = useLibraryStore(s => s.deleteTag);
  const addTagToItem = useLibraryStore(s => s.addTagToItem);
  const removeTagFromItem = useLibraryStore(s => s.removeTagFromItem);
  const reorderPinnedTags = useLibraryStore(s => s.reorderPinnedTags);
  const activeFilterTag = useLibraryStore(s => s.activeFilterTag);
  const setActiveFilterTag = useLibraryStore(s => s.setActiveFilterTag);
  const trashItem = useLibraryStore(s => s.trashItem);
  const restoreItem = useLibraryStore(s => s.restoreItem);
  const emptyTrash = useLibraryStore(s => s.emptyTrash);
  const permanentlyDeleteItem = useLibraryStore(s => s.permanentlyDeleteItem);

  // Auto-connect to project library if available
  // Priority: node's own libraryId > projectLibraryId
  const effectiveLibraryId = data.libraryId || projectLibraryId;

  // Auto-set the library ID when project library becomes available
  useEffect(() => {
    // If node doesn't have a library set and project library is available, auto-select it
    if (!data.libraryId && projectLibraryId && libraries[projectLibraryId]) {
      updateNodeData<LibraryNodeData>(node.id, { libraryId: projectLibraryId });
    }
  }, [data.libraryId, projectLibraryId, libraries, node.id, updateNodeData]);

  /**
   * The one fact both filesystem effects below key off, as a STAMP rather than
   * as the `libraries` object.
   *
   * `libraries` gets a new identity on every store write — including every
   * per-file tick of a scan in progress — so an effect that depends on it and
   * also WRITES to it is a spin, and both effects below do exactly that. The
   * stamp is two scalars, so it changes when the answer changes and not before.
   */
  const libraryScanStamp = useLibraryStore(s => {
    const lib = effectiveLibraryId ? s.libraries[effectiveLibraryId] : undefined;
    return lib ? `${lib.status}:${lib.lastScanAt}` : '';
  });

  /**
   * Read the folder once, if it has never been read.
   *
   * SPIN-1. This used to depend on `libraries` and to retry on any status but
   * `scanning` — which meant that a scan that FAILED (`restoreHandle` came back
   * empty, or the permission was refused) wrote `status: 'error'` into
   * `libraries`, which gave the object a new identity, which re-ran this
   * effect, which retried the same doomed scan, forever. Nothing changed
   * between attempts, so it never recovered and never stopped: a card sitting
   * on the canvas pinning the main thread with IndexedDB reads while the player
   * is trying to play. An automatic retry that cannot succeed is not
   * resilience.
   *
   * `error` and `permission_needed` are therefore TERMINAL until the player
   * acts. They are not dead ends — linking a folder (`addLibrary`) and
   * relinking one (`relinkLibrary`) both put the library back to `ready`, which
   * moves the stamp and lets this effect fire again.
   */
  useEffect(() => {
    if (!effectiveLibraryId) return;
    const [status, scannedAt] = libraryScanStamp.split(':');
    if (status !== 'ready' || scannedAt !== '0') return;
    scanLibrary(effectiveLibraryId, false).catch(console.error);
  }, [effectiveLibraryId, libraryScanStamp, scanLibrary]);

  /**
   * MISSING-1 — the producer half of the missing-file loop.
   *
   * `libraryStore.checkMissingItems()` is the only thing that writes
   * `status: 'missing'` at scale, and until now it had no caller a player could
   * reach: it was transitively dead behind `relinkLibrary`, which was dead
   * behind a dialog nothing imported. So `LibraryNode` rendered a struck-through
   * `.is-missing` row and `LibraryNode.css` painted it `--danger-ink` for a
   * state that could never occur. Wired here, at the one moment the answer can
   * change and is worth paying for: a library this card is showing has finished
   * a scan.
   *
   * It is NOT in the render path and NOT undoable. The walk is async, batched
   * 50 at a time inside the store, and refuses to run at all when the folder's
   * permission has lapsed (see `checkMissingItems`) — so the worst case is that
   * the card says nothing, never that it strikes through a folder that is fine.
   */
  useEffect(() => {
    if (!effectiveLibraryId) return;
    const [status, scannedAt] = libraryScanStamp.split(':');
    if (status !== 'ready' || scannedAt === '0') return;
    checkMissingItems(effectiveLibraryId).catch((err) => {
      // Reported, never thrown at the player: an unreadable folder is a fact
      // about the machine, and the card is still usable without the answer.
      console.warn('[Library] Missing-file check failed:', err);
    });
  }, [effectiveLibraryId, libraryScanStamp, checkMissingItems]);

  /**
   * Every item in this library, derived from the SUBSCRIBED map.
   *
   * This replaces `getItemsByLibrary(effectiveLibraryId)`, which is the same
   * one-line filter but reached through a store action — i.e. a read with no
   * subscription behind it, so the file list never repainted when an item
   * changed underneath it. Same result, one source, and it is the source the
   * missing-file banner reads too.
   */
  const allLibraryItems = useMemo(
    () =>
      effectiveLibraryId
        ? Object.values(storeItems).filter((item) => item.libraryId === effectiveLibraryId)
        : [],
    [storeItems, effectiveLibraryId],
  );

  /** The rows the walk found gone. The banner's count and the dialog's list
   *  are the same array — one source, so they cannot disagree. */
  const missingItems = useMemo(
    () => allLibraryItems.filter((item) => item.status === 'missing'),
    [allLibraryItems],
  );

  /** The relink sheet, opened from the banner below. */
  const [isRelinking, setIsRelinking] = useState(false);

  // Local state
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [previewingItemId, setPreviewingItemId] = useState<string | null>(null);
  const [loadingItemId, setLoadingItemId] = useState<string | null>(null);
  const [isLinking, setIsLinking] = useState(false);
  const [isCreatingTag, setIsCreatingTag] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [dragOverTag, setDragOverTag] = useState<string | null>(null);
  const [dragOverPinnedSection, setDragOverPinnedSection] = useState(false);
  const [dragOverOtherSection, setDragOverOtherSection] = useState(false);
  const [draggingTag, setDraggingTag] = useState<string | null>(null);
  const [draggingPinnedTag, setDraggingPinnedTag] = useState<string | null>(null);
  const [pinnedDropIndex, setPinnedDropIndex] = useState<number | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  /**
   * The one file row whose `+N` tag chip is open.
   *
   * A row shows one tag inline so the filename keeps its 120px floor, which left
   * tags 2..N behind an inert count — and since the remove button travels with
   * the chip, unreachable. One at a time: the disclosure is a detail about the
   * row under the pointer, not a mode the list stays in.
   */
  const [expandedTagsItemId, setExpandedTagsItemId] = useState<string | null>(null);

  /**
   * The one destructive question this card ever asks, asked IN the card
   * (UI-021). It always renders in the same strip under the panels, so a
   * confirm never moves the list out from under the pointer.
   */
  const [pendingConfirm, setPendingConfirm] = useState<
    | { kind: 'delete-tag'; tag: string }
    | { kind: 'delete-item'; id: string; name: string }
    | { kind: 'empty-trash'; count: number }
    | null
  >(null);

  /* And it takes the keyboard when it opens. An `alertdialog` nobody is focused
     on announces into nothing and leaves Tab walking the browser behind it —
     the same defect a native `confirm()` has, only quieter. One rule, one place
     (`Shell/confirmFocus`), shared with the menu bar and Settings: the SAFE
     answer is focused on open, and focus returns to the trigger — or to search,
     when the row that asked has just been deleted — on close. */
  const keepItRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  /** The control that asked, latched by `askToDelete` so the restore can check
   *  whether it survived the answer. */
  const confirmOpenerRef = useRef<HTMLButtonElement | null>(null);
  useConfirmFocus(pendingConfirm !== null, keepItRef, () => {
    const opener = confirmOpenerRef.current;
    return opener && opener.isConnected && !opener.disabled ? opener : searchRef.current;
  });

  /** Ask the question, and remember which control asked it. */
  const askToDelete = useCallback(
    (
      question: NonNullable<typeof pendingConfirm>,
      event: React.MouseEvent<HTMLButtonElement>,
    ) => {
      event.stopPropagation();
      confirmOpenerRef.current = event.currentTarget;
      setPendingConfirm(question);
    },
    [],
  );

  /** Peaks for the sample the node is currently feeding — one idb read. */
  const [previewPeaks, setPreviewPeaks] = useState<number[]>([]);

  // Multi-selection state
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [selectionBox, setSelectionBox] = useState<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);

  // Refs
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const newTagInputRef = useRef<HTMLInputElement>(null);
  const editNameInputRef = useRef<HTMLInputElement>(null);
  const filesContainerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isMountedRef = useRef(true); // Track mount state for async safety

  // Get updateItem from store
  const updateItem = useLibraryStore(s => s.updateItem);

  /** The item this node is feeding, subscribed (so a rename updates the card). */
  const currentItem = useLibraryStore(s =>
    data.currentItemId ? s.items[data.currentItemId] : undefined,
  );

  // Node resize hook
  const {
    width: nodeWidth,
    height: nodeHeight,
    handleResizeStart,
    isResizing,
  } = useResize({
    nodeId: node.id,
    initialWidth: data.width ?? 500,
    initialHeight: data.height ?? 400,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    onDimensionsChange: (w, h) => updateNodeData<LibraryNodeData>(node.id, { width: w, height: h }),
  });

  // Panel separator hook
  const {
    position: separatorPos,
    isDragging: isDraggingSeparator,
    handleSeparatorMouseDown,
    containerRef: leftPanelRef,
  } = usePanelResize({
    nodeId: node.id,
    initialPosition: data.separatorPosition ?? 0.5,
    mode: 'percentage',
    min: 0.2,
    max: 0.8,
    direction: 'vertical',
    onPositionChange: (pos) => updateNodeData<LibraryNodeData>(node.id, { separatorPosition: pos }),
  });

  // Get current library
  const currentLibrary = effectiveLibraryId ? libraries[effectiveLibraryId] : null;

  // Debounce search input for performance (I1)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 150);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Clear selection and tag filter when library changes (C3, I6)
  useEffect(() => {
    setSelectedItemIds(new Set());
    setActiveFilterTag(null);
  }, [effectiveLibraryId, setActiveFilterTag]);

  // Get other (non-pinned) tags
  const otherTags = useMemo(() => {
    return allTags.filter(t => !pinnedTags.includes(t));
  }, [allTags, pinnedTags]);

  // Get filtered items - uses debounced search for performance (I2)
  const libraryItems = useMemo(() => {
    if (!effectiveLibraryId) return [];
    let allItems = allLibraryItems;

    // Hide trashed items unless 'trash' is the active filter
    if (activeFilterTag !== 'trash') {
      allItems = allItems.filter((item: LibraryItem) => !item.tags.includes('trash'));
    }

    // Filter by active tag
    if (activeFilterTag) {
      allItems = allItems.filter((item: LibraryItem) => item.tags.includes(activeFilterTag));
    }

    // Filter by search (using debounced value)
    if (debouncedSearch.trim()) {
      const query = debouncedSearch.toLowerCase();
      allItems = allItems.filter(
        (s: LibraryItem) =>
          s.fileName.toLowerCase().includes(query) ||
          s.tags.some((t: string) => t.toLowerCase().includes(query))
      );
    }

    return allItems;
  }, [effectiveLibraryId, allLibraryItems, debouncedSearch, activeFilterTag]);

  // Handle linking a new folder
  const handleLinkFolder = useCallback(async () => {
    if (!isFileSystemAccessSupported()) {
      toast.error('File System Access API not supported. Please use Chrome or Edge.');
      return;
    }

    setIsLinking(true);
    try {
      const handle = await selectLibraryFolder();
      const libraryId = await addLibrary(handle);
      updateNodeData<LibraryNodeData>(node.id, { libraryId });
      await scanLibrary(libraryId, true);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error('Failed to link folder:', err);
      }
    } finally {
      setIsLinking(false);
    }
  }, [node.id, addLibrary, scanLibrary, updateNodeData]);

  // Handle item selection (I5: with loading state, C5: with toast errors)
  // Uses getState() to avoid stale closure issues with items and data.itemRefs
  const handleSelectItem = useCallback(
    async (itemId: string) => {
      // Get fresh state at execution time to avoid stale closures
      const freshItem = useLibraryStore.getState().items[itemId];
      if (!freshItem) return;

      setLoadingItemId(itemId);

      // Decode and deliver first. The visible/persisted selection is the last-good
      // sample and must not move to a missing or corrupt item.
      try {
        const file = await getSampleFile(itemId);
        if (!file) {
          toast.error('File not found - it may have been moved or deleted');
          return;
        }
        const ctx = getAudioContext();
        if (!ctx) {
          toast.error('Audio system not available');
          return;
        }
        const arrayBuffer = await file.arrayBuffer();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        getExecutor().sendSampleBuffer(node.id, audioBuffer);

        const currentNode = useGraphStore.getState().nodes.get(node.id);
        const currentItemRefs = (currentNode?.data as LibraryNodeData | undefined)?.itemRefs || [];
        updateNodeData<LibraryNodeData>(node.id, {
          currentItemId: itemId,
          itemRefs: [
            ...currentItemRefs.filter((r: LibraryItemRef) => r.id !== itemId),
            {
              id: itemId,
              relativePath: freshItem.relativePath,
              displayName: freshItem.fileName,
              libraryId: freshItem.libraryId,
            },
          ],
        });
      } catch (err) {
        console.error('Failed to load item for sampler:', err);
        toast.error('Failed to load audio file');
      } finally {
        // Only clear loading state if this item is still loading (handle rapid clicks)
        setLoadingItemId(current => current === itemId ? null : current);
      }
    },
    [node.id, updateNodeData]
  );

  // PERSIST-1 / SEAM-1: the library feed is a PERSISTENT feed, not a one-shot. The
  // currently-selected item's PCM must reach connected samplers (a) when a sampler
  // is freshly WIRED to this library, and (b) on RELOAD (the sampler's engine
  // binding does not survive a fresh session, and the library re-resolves the file
  // from disk). Decode the current item once and broadcast it to every connected
  // sampler via the executor's `sendSampleBuffer` (which fans out by node type).
  // Reads node data / connections via getState() so the callback identity is stable.
  const pushCurrentSampleToSamplers = useCallback(async () => {
    const currentNode = useGraphStore.getState().nodes.get(node.id);
    const itemId = (currentNode?.data as LibraryNodeData | undefined)?.currentItemId;
    if (!itemId) return;
    // Only do the (costly) decode if at least one sampler is actually wired here.
    const conns = useGraphStore.getState().getConnectionsForNode(node.id);
    const nodes = useGraphStore.getState().nodes;
    const feedsASampler = conns.some(
      (c) => c.sourceNodeId === node.id && nodes.get(c.targetNodeId)?.type === 'sampler',
    );
    if (!feedsASampler) return;
    try {
      const file = await getSampleFile(itemId);
      if (!file) return; // re-resolve failed; selecting again surfaces the toast
      const ctx = getAudioContext();
      if (!ctx) return;
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      getExecutor().sendSampleBuffer(node.id, audioBuffer);
    } catch (err) {
      console.error('[LibraryNode] Failed to re-feed sample to samplers:', err);
    }
  }, [node.id]);

  // Re-fire the feed on CONNECT and on RELOAD. The dependency is a stable string
  // signature of the connected sampler ids (sorted) + the current item id: it
  // changes exactly when a sampler is wired/unwired or the selection changes, so a
  // newly-connected sampler (or a reloaded project) re-receives the live PCM. The
  // worklet/IPC seam ignores duplicate buffers, so a redundant push is harmless.
  const connectedSamplerSignature = useGraphStore((s) => {
    const conns = s.connectionsByNode.get(node.id);
    if (!conns) return '';
    const ids: string[] = [];
    for (const cid of conns) {
      const c = s.connections.get(cid);
      if (c && c.sourceNodeId === node.id && s.nodes.get(c.targetNodeId)?.type === 'sampler') {
        ids.push(c.targetNodeId);
      }
    }
    return ids.sort().join(',');
  });

  useEffect(() => {
    if (!connectedSamplerSignature) return; // no sampler wired -> nothing to feed
    void pushCurrentSampleToSamplers();
  }, [connectedSamplerSignature, data.currentItemId, pushCurrentSampleToSamplers]);

  // Handle preview (C1: track active sources, C5: toast errors, I7: proper error logging)
  // Uses isMountedRef to prevent state updates after unmount
  const handlePreviewItem = useCallback(
    async (itemId: string) => {
      if (audioSourceRef.current) {
        try {
          audioSourceRef.current.stop();
        } catch (e) {
          if (process.env.NODE_ENV === 'development') console.warn('Stop failed:', e);
        }
        audioSourceRef.current = null;
      }

      if (previewingItemId === itemId) {
        setPreviewingItemId(null);
        return;
      }

      setPreviewingItemId(itemId);

      // Capture the expected item ID for the onended callback closure
      const expectedItemId = itemId;

      try {
        const file = await getSampleFile(itemId);
        // Check if component is still mounted after async operation
        if (!isMountedRef.current) return;

        if (!file) {
          setPreviewingItemId(null);
          toast.error('File not found');
          return;
        }

        const ctx = getAudioContext();
        if (!ctx) {
          setPreviewingItemId(null);
          toast.error('Audio system not available');
          return;
        }

        const arrayBuffer = await file.arrayBuffer();
        // Check if component is still mounted after async operation
        if (!isMountedRef.current) return;

        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        // Check if component is still mounted after async operation
        if (!isMountedRef.current) return;

        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);

        // Track this source for cleanup (C1)
        activeSourcesRef.current.add(source);

        source.onended = () => {
          // Only update state if component is still mounted
          if (!isMountedRef.current) return;
          // Only clear preview state if this source's item is still the current preview
          // This prevents race conditions where a new preview starts before this one ends
          setPreviewingItemId((current) => current === expectedItemId ? null : current);
          if (audioSourceRef.current === source) {
            audioSourceRef.current = null;
          }
          // Remove from active sources set
          activeSourcesRef.current.delete(source);
        };
        source.start();
        audioSourceRef.current = source;
      } catch (err) {
        console.error('Preview failed:', err);
        // Only update state if component is still mounted
        if (isMountedRef.current) {
          setPreviewingItemId(null);
          toast.error('Preview failed - file may be corrupted');
        }
      }
    },
    [previewingItemId]
  );

  // Cleanup on unmount (C1: stop all audio sources, C2: clear refs, C3: mark unmounted)
  useEffect(() => {
    isMountedRef.current = true; // Ensure mounted on effect run
    return () => {
      // Mark as unmounted first to prevent state updates from async operations
      isMountedRef.current = false;

      // Stop all active audio sources (C1)
      activeSourcesRef.current.forEach(source => {
        try {
          source.stop();
        } catch (e) {
          if (process.env.NODE_ENV === 'development') console.warn('Stop failed:', e);
        }
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps -- the live ref set at unmount is exactly what must be stopped/cleared; copying to a local at mount would capture the empty initial set and leak sources
      activeSourcesRef.current.clear();

      // Stop current preview source
      if (audioSourceRef.current) {
        try {
          audioSourceRef.current.stop();
        } catch (e) {
          if (process.env.NODE_ENV === 'development') console.warn('Stop failed:', e);
        }
      }
    };
  }, []);

  // Handle double-click to edit file name
  // Uses getState() to avoid stale closure with items
  const handleStartEditFileName = useCallback((itemId: string) => {
    const item = useLibraryStore.getState().items[itemId];
    if (!item) return;
    // Get base name without extension
    const baseName = item.fileName.replace(/\.[^.]+$/, '');
    setEditingItemId(itemId);
    setEditingName(baseName);
  }, []);

  // Handle save file name
  // Uses getState() to avoid stale closure with items
  const handleSaveFileName = useCallback(() => {
    if (!editingItemId || !editingName.trim()) {
      setEditingItemId(null);
      setEditingName('');
      return;
    }

    const item = useLibraryStore.getState().items[editingItemId];
    if (!item) {
      setEditingItemId(null);
      setEditingName('');
      return;
    }

    // Get original extension
    const extMatch = item.fileName.match(/\.[^.]+$/);
    const extension = extMatch ? extMatch[0] : '';
    const newFileName = editingName.trim() + extension;

    // Only update if name changed
    if (newFileName !== item.fileName) {
      recordLibraryEdit('Rename sample', () => {
        updateItem(editingItemId, { fileName: newFileName });
      });
    }

    setEditingItemId(null);
    setEditingName('');
  }, [editingItemId, editingName, updateItem]);

  // Focus input when editing starts
  useEffect(() => {
    if (editingItemId && editNameInputRef.current) {
      editNameInputRef.current.focus();
      editNameInputRef.current.select();
    }
  }, [editingItemId]);

  // Handle drag start for file - only set drag data, don't create clip yet
  // Clip will be created when dropped on canvas (handled by NodeCanvas)
  const handleFileDragStart = useCallback(
    (e: React.DragEvent, item: LibraryItem) => {
      e.stopPropagation();

      // If this item is selected, drag all selected items; otherwise just this one
      const itemsToDrag = selectedItemIds.has(item.id) && selectedItemIds.size > 1
        ? Array.from(selectedItemIds)
        : [item.id];

      // Set drag data - item IDs for tagging (comma-separated), single item data for canvas drop
      e.dataTransfer.setData('application/library-item-ids', itemsToDrag.join(','));
      e.dataTransfer.setData('application/library-item-id', item.id); // For backwards compatibility
      e.dataTransfer.setData('application/library-item', JSON.stringify({
        id: item.id,
        fileName: item.fileName,
        duration: item.duration,
        sampleRate: item.sampleRate,
        sourceNodeId: node.id,
      }));
      e.dataTransfer.effectAllowed = 'copyMove';

      // Set a drag image
      const dragEl = e.currentTarget as HTMLElement;
      if (dragEl) {
        e.dataTransfer.setDragImage(dragEl, 60, 20);
      }
    },
    [node.id, selectedItemIds]
  );

  // Handle drop on tag (tag all dragged files)
  const handleTagDrop = useCallback(
    (e: React.DragEvent, tagName: string) => {
      e.preventDefault();
      e.stopPropagation(); // Prevent canvas from also handling the drop
      setDragOverTag(null);

      // Check for audio clip drop (from canvas)
      const clipDataStr = e.dataTransfer.getData('application/audio-clip');
      if (clipDataStr) {
        try {
          const clipData = JSON.parse(clipDataStr) as {
            sampleId: string;
            sampleName: string;
            startFrame: number;
            endFrame: number;
          };

          // Validate source is in library (not a file: prefix which means dropped from filesystem)
          if (clipData.sampleId.startsWith('file:')) {
            toast.error('Source file must be in library to save crop');
            return;
          }

          const sourceItem = useLibraryStore.getState().items[clipData.sampleId];
          if (!sourceItem) {
            toast.error('Source file not found in library');
            return;
          }

          // Don't create virtual from virtual
          if (sourceItem.isVirtual) {
            toast.error('Cannot create crop from existing virtual item');
            return;
          }

          // If no crop (full file), just add tag to existing item
          if (clipData.startFrame === 0 && clipData.endFrame === -1) {
            recordLibraryEdit('Tag sample', () => addTagToItem(clipData.sampleId, tagName));
            toast.success(`Tagged "${clipData.sampleName}"`);
            return;
          }

          // Create virtual item with crop. One drop is one gesture, so it is one
          // undo step — and it is a RECORDED one, not a sealed one: a virtual
          // item is pure metadata (a frame range plus a reference to its parent
          // file), so undoing it destroys no audio and re-doing it costs nothing.
          // The tag-only branch above already worked this way; the crop did not,
          // which made the smaller of the two edits the only reversible one.
          const baseName = clipData.sampleName.replace(/\.\w+$/, '');
          const virtualName = `${baseName} (crop)`;
          const createVirtualItem = useLibraryStore.getState().createVirtualItem;
          let virtualId: string | null = null;
          recordLibraryEdit('Save crop', () => {
            virtualId = createVirtualItem(
              clipData.sampleId,
              clipData.startFrame,
              clipData.endFrame,
              virtualName,
              [tagName]
            );
          });

          if (virtualId) {
            toast.success(`Saved crop as "${virtualName}"`);
          } else {
            toast.error('Failed to create virtual sample');
          }
          return;
        } catch (err) {
          console.error('[LibraryNode] Failed to parse clip data:', err);
        }
      }

      // Try to get multiple item IDs first. One drop is one gesture, however
      // many files it carried, so the whole batch is ONE undo step.
      const itemIdsStr = e.dataTransfer.getData('application/library-item-ids');
      if (itemIdsStr) {
        const itemIds = itemIdsStr.split(',').filter(Boolean);
        recordLibraryEdit('Tag samples', () => {
          itemIds.forEach(id => addTagToItem(id, tagName));
        });
      } else {
        // Fallback to single item
        const itemId = e.dataTransfer.getData('application/library-item-id');
        if (itemId) {
          recordLibraryEdit('Tag sample', () => addTagToItem(itemId, tagName));
        }
      }
    },
    [addTagToItem]
  );

  // Selection box handlers for files panel
  // Use refs to track selection state for window event listeners
  const isSelectingRef = useRef(false);
  const selectionStartRef = useRef({ x: 0, y: 0 });

  // Window-level handlers for robust selection (using refs to avoid stale closures)
  useEffect(() => {
    const handleWindowMouseMove = (e: MouseEvent) => {
      if (!isSelectingRef.current) return;

      const container = filesContainerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      // Get scroll offset from scroll container ref (I4: replaced querySelector with ref)
      const scrollTop = scrollContainerRef.current?.scrollTop ?? 0;
      const scrollLeft = scrollContainerRef.current?.scrollLeft ?? 0;

      const x = e.clientX - rect.left + scrollLeft;
      const y = e.clientY - rect.top + scrollTop;

      setSelectionBox({
        startX: selectionStartRef.current.x,
        startY: selectionStartRef.current.y,
        currentX: x,
        currentY: y,
      });
    };

    const handleWindowMouseUp = (e: MouseEvent) => {
      if (!isSelectingRef.current) return;

      isSelectingRef.current = false;
      const container = filesContainerRef.current;
      if (!container) {
        setSelectionBox(null);
        return;
      }

      // Get current selection box state for calculating selection
      const rect = container.getBoundingClientRect();
      // Use ref instead of querySelector (I4)
      const scrollTop = scrollContainerRef.current?.scrollTop ?? 0;
      const scrollLeft = scrollContainerRef.current?.scrollLeft ?? 0;

      const currentX = e.clientX - rect.left + scrollLeft;
      const currentY = e.clientY - rect.top + scrollTop;
      const startX = selectionStartRef.current.x;
      const startY = selectionStartRef.current.y;

      // Calculate selection rectangle
      const minX = Math.min(startX, currentX);
      const maxX = Math.max(startX, currentX);
      const minY = Math.min(startY, currentY);
      const maxY = Math.max(startY, currentY);

      // Only select if dragged more than 5 pixels
      if (maxX - minX < 5 && maxY - minY < 5) {
        setSelectionBox(null);
        return;
      }

      const newSelected = new Set<string>();

      // Check each file row's play button against the selection box. The rows
      // are read out of the DOM (one query, only on mouse-up) rather than from
      // a React ref map mirroring them - one source of truth for what is on
      // screen, and nothing to keep in sync when the list re-filters.
      container.querySelectorAll<HTMLElement>('.library-file-row[data-item-id]').forEach((rowEl) => {
        const itemId = rowEl.dataset.itemId;
        if (!itemId) return;
        const playBtn = rowEl.querySelector('.file-preview-btn');
        if (!playBtn) return;

        const btnRect = playBtn.getBoundingClientRect();
        // Convert to container-relative coordinates
        const btnLeft = btnRect.left - rect.left + scrollLeft;
        const btnRight = btnRect.right - rect.left + scrollLeft;
        const btnTop = btnRect.top - rect.top + scrollTop;
        const btnBottom = btnRect.bottom - rect.top + scrollTop;

        // Check if entire play button is within selection box
        if (btnLeft >= minX && btnRight <= maxX && btnTop >= minY && btnBottom <= maxY) {
          newSelected.add(itemId);
        }
      });

      setSelectedItemIds(newSelected);
      setSelectionBox(null);
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, []);

  const handleFilesMouseDown = useCallback((e: React.MouseEvent) => {
    // Only start selection if clicking on empty space (not on a file row)
    const target = e.target as HTMLElement;
    if (target.closest('.library-file-row')) return;
    // Also ignore if clicking on scroll container padding or other interactive elements
    if (target.closest('button') || target.closest('input')) return;

    // Stop propagation to prevent canvas from starting its selection box
    e.stopPropagation();
    e.preventDefault(); // Prevent text selection during drag

    const container = filesContainerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    // Get scroll offset from scroll container ref (I4)
    const scrollTop = scrollContainerRef.current?.scrollTop ?? 0;
    const scrollLeft = scrollContainerRef.current?.scrollLeft ?? 0;

    const x = e.clientX - rect.left + scrollLeft;
    const y = e.clientY - rect.top + scrollTop;

    // Store start position in ref for window event listeners
    selectionStartRef.current = { x, y };
    isSelectingRef.current = true;

    setSelectionBox({ startX: x, startY: y, currentX: x, currentY: y });
    setSelectedItemIds(new Set()); // Clear selection when starting new box
  }, []);

  // Clear selection when clicking elsewhere
  const handleFileRowClick = useCallback((itemId: string, e: React.MouseEvent) => {
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      // Multi-select with modifier key
      setSelectedItemIds(prev => {
        const newSet = new Set(prev);
        if (newSet.has(itemId)) {
          newSet.delete(itemId);
        } else {
          newSet.add(itemId);
        }
        return newSet;
      });
    } else {
      // Single select
      setSelectedItemIds(new Set([itemId]));
    }
    handleSelectItem(itemId);
  }, [handleSelectItem]);

  // Handle tag click (filter)
  const handleTagClick = useCallback((tagName: string) => {
    if (activeFilterTag === tagName) {
      setActiveFilterTag(null);
    } else {
      setActiveFilterTag(tagName);
    }
  }, [activeFilterTag, setActiveFilterTag]);

  // Handle creating new tag
  const handleCreateTag = useCallback(() => {
    const name = newTagName.trim();
    if (name) {
      // New tags go to "other tags" first - user can drag to pin
      recordLibraryEdit('Create tag', () => createTag(name));
    }
    setNewTagName('');
    setIsCreatingTag(false);
  }, [newTagName, createTag]);

  // Handle tag drag start (from other tags section)
  const handleTagDragStart = useCallback((e: React.DragEvent, tagName: string) => {
    e.dataTransfer.setData('application/tag-name', tagName);
    e.dataTransfer.setData('application/tag-source', 'other');
    e.dataTransfer.effectAllowed = 'move';
    setDraggingTag(tagName);
  }, []);

  // Handle pinned tag drag start (for reordering)
  const handlePinnedTagDragStart = useCallback((e: React.DragEvent, tagName: string) => {
    e.dataTransfer.setData('application/tag-name', tagName);
    e.dataTransfer.setData('application/tag-source', 'pinned');
    e.dataTransfer.effectAllowed = 'move';
    setDraggingPinnedTag(tagName);
  }, []);

  // Handle tag drag end
  const handleTagDragEnd = useCallback(() => {
    setDraggingTag(null);
    setDraggingPinnedTag(null);
    setDragOverPinnedSection(false);
    setDragOverOtherSection(false);
    setPinnedDropIndex(null);
  }, []);

  // Calculate drop index for pinned tags based on mouse position
  const handlePinnedTagDragOver = useCallback((e: React.DragEvent, tagIndex: number) => {
    e.preventDefault();
    if (!draggingPinnedTag && !draggingTag) return;

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const dropIndex = e.clientY < midY ? tagIndex : tagIndex + 1;
    setPinnedDropIndex(dropIndex);
  }, [draggingPinnedTag, draggingTag]);

  // Handle drop on pinned tags section (to pin or reorder)
  const handlePinnedSectionDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverPinnedSection(false);
    setPinnedDropIndex(null);

    const tagName = e.dataTransfer.getData('application/tag-name');
    const source = e.dataTransfer.getData('application/tag-source');

    if (!tagName) return;

    if (source === 'pinned') {
      // Reordering pinned tag
      const currentIndex = pinnedTags.indexOf(tagName);
      if (currentIndex === -1) return;

      let targetIndex = pinnedDropIndex ?? pinnedTags.length;
      // Adjust target if dragging down (account for removal)
      if (targetIndex > currentIndex) targetIndex--;

      if (targetIndex !== currentIndex && targetIndex >= 0) {
        const newOrder = [...pinnedTags];
        newOrder.splice(currentIndex, 1);
        newOrder.splice(targetIndex, 0, tagName);
        recordLibraryEdit('Reorder pinned tags', () => reorderPinnedTags(newOrder));
      }
    } else {
      // Pinning a new tag from other section
      if (!pinnedTags.includes(tagName)) {
        if (pinnedDropIndex !== null && pinnedDropIndex < pinnedTags.length) {
          // Insert at specific position
          const newOrder = [...pinnedTags];
          newOrder.splice(pinnedDropIndex, 0, tagName);
          recordLibraryEdit('Pin tag', () => reorderPinnedTags(newOrder));
        } else {
          recordLibraryEdit('Pin tag', () => pinTag(tagName));
        }
      }
    }
  }, [pinnedTags, pinnedDropIndex, pinTag, reorderPinnedTags]);

  // Handle drop on other section (to unpin)
  const handleOtherSectionDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverOtherSection(false);

    const tagName = e.dataTransfer.getData('application/tag-name');
    const source = e.dataTransfer.getData('application/tag-source');

    // Only unpin if dragging from pinned section
    if (tagName && source === 'pinned' && pinnedTags.includes(tagName)) {
      recordLibraryEdit('Unpin tag', () => unpinTag(tagName));
    }
  }, [pinnedTags, unpinTag]);

  // Focus input when creating tag
  useEffect(() => {
    if (isCreatingTag && newTagInputRef.current) {
      newTagInputRef.current.focus();
    }
  }, [isCreatingTag]);

  /**
   * The trace for the sample this Library is currently feeding. ONE IndexedDB
   * read per selection — not one per visible row: a browser meant to scroll
   * hundreds of files cannot pay a decode per row and still feel instant
   * (design-for-instant). The waveform you want to see is the one you picked.
   */
  useEffect(() => {
    const itemId = data.currentItemId;
    if (!itemId) {
      setPreviewPeaks([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const encoded = await getWaveform(itemId);
      if (cancelled) return;
      if (!encoded) {
        setPreviewPeaks([]);
        return;
      }
      const peaks = base64ToPeaks(encoded);
      // Downsample to a card-sized envelope; a 2000-point polyline in a 200px
      // box is 1800 points of nothing.
      const target = 96;
      const stride = Math.max(1, Math.floor(peaks.length / target));
      const out: number[] = [];
      for (let i = 0; i < peaks.length; i += stride) {
        let max = 0;
        for (let j = i; j < Math.min(i + stride, peaks.length); j += 1) {
          const v = Math.abs(peaks[j]);
          if (v > max) max = v;
        }
        out.push(max);
      }
      setPreviewPeaks(out);
    })();
    return () => { cancelled = true; };
  }, [data.currentItemId]);


  /**
   * One tag. A pill you can filter with, pin by dragging, and drop files onto.
   * The hue is the tag's identity and is spent ONLY on the dot and a faint
   * wash - the word itself is a theme token, so any hue still reads (D5).
   */
  const renderTag = (tagName: string, isPinned: boolean, index?: number) => {
    const isActive = activeFilterTag === tagName;
    const isTagDragging = isPinned ? draggingPinnedTag === tagName : draggingTag === tagName;
    const showDropBefore = isPinned && pinnedDropIndex === index && (draggingPinnedTag || draggingTag);
    const showDropAfter = isPinned && pinnedDropIndex === (index ?? 0) + 1 && index === pinnedTags.length - 1 && (draggingPinnedTag || draggingTag);

    const classes = [
      'library-tag',
      dragOverTag === tagName && 'is-drop-target',
      isTagDragging && 'is-dragging',
      showDropBefore && 'drop-before',
      showDropAfter && 'drop-after',
    ].filter(Boolean).join(' ');

    return (
      <ListRow
        key={tagName}
        className={classes}
        selected={isActive}
        style={{ '--tag-color': getTagColor(tagName) } as React.CSSProperties}
        role="option"
        tabIndex={0}
        onClick={() => handleTagClick(tagName)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleTagClick(tagName);
          }
        }}
        draggable
        onDragStart={(e) => isPinned ? handlePinnedTagDragStart(e, tagName) : handleTagDragStart(e, tagName)}
        onDragEnd={handleTagDragEnd}
        onDragOver={(e) => {
          e.preventDefault();
          if (isPinned && index !== undefined) {
            handlePinnedTagDragOver(e, index);
          } else {
            setDragOverTag(tagName);
          }
        }}
        onDragLeave={() => { setDragOverTag(null); }}
        onDrop={(e) => isPinned ? handlePinnedSectionDrop(e) : handleTagDrop(e, tagName)}
        title={isPinned ? 'Drag to reorder, or drag into All tags to unpin' : 'Drag into Pinned to pin, click to filter'}
        actions={
          <IconButton
            variant="ghost"
            className="library-tag__action"
            label={isPinned ? `Unpin ${tagName}` : `Delete tag ${tagName}`}
            onClick={(e) => {
              if (isPinned) {
                e.stopPropagation();
                recordLibraryEdit('Unpin tag', () => unpinTag(tagName));
              } else {
                askToDelete({ kind: 'delete-tag', tag: tagName }, e);
              }
            }}
            icon={<IconClose size={12} />}
            title={isPinned ? 'Unpin tag' : 'Delete tag'}
          />
        }
      >
        <span className="library-tag__dot" aria-hidden="true" />
        <span className="library-tag__name">{tagName}</span>
      </ListRow>
    );
  };

  /** One file. A row you can preview, rename, tag, drag to the canvas and trash. */
  const renderFileRow = (item: LibraryItem) => {
    const isActive = data.currentItemId === item.id;
    const isPreviewing = previewingItemId === item.id;
    const isLoading = loadingItemId === item.id;
    const isMissing = item.status === 'missing';
    const isTrashed = item.tags.includes('trash');
    const isEditing = editingItemId === item.id;
    const isMultiSelected = selectedItemIds.has(item.id);
    const isVirtual = item.isVirtual === true;
    const visibleTags = item.tags.filter((t) => t !== 'trash');
    const tagsExpanded = expandedTagsItemId === item.id;
    const shownTags = tagsExpanded ? visibleTags : visibleTags.slice(0, 1);
    const hiddenTags = visibleTags.slice(1);
    const toggleTags = () => setExpandedTagsItemId(tagsExpanded ? null : item.id);

    const classes = [
      'library-file-row',
      tagsExpanded && 'is-tags-expanded',
      isMultiSelected && 'is-multi-selected',
      isMissing && 'is-missing',
      isTrashed && 'is-trashed',
      isEditing && 'is-editing',
      isLoading && 'is-loading',
      isVirtual && 'is-virtual',
    ].filter(Boolean).join(' ');

    return (
      <ListRow
        key={item.id}
        data-item-id={item.id}
        className={classes}
        /* `ListRow` emits `aria-selected` from `selected`. A row caught by the
           marquee is visually selected (accent inset edge + `--accent-ink`
           label), so it has to be ANNOUNCED as selected too; `isActive` still
           drives the "current item" dot on its own. */
        selected={isActive || isMultiSelected}
        onClick={(e) => !isEditing && handleFileRowClick(item.id, e)}
        onKeyDown={(e) => {
          if (isEditing) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleFileRowClick(item.id, e as unknown as React.MouseEvent);
          } else if ((e.key === 'Delete' || e.key === 'Backspace') && !isTrashed) {
            e.preventDefault();
            recordLibraryEdit('Move sample to trash', () => trashItem(item.id));
            toast.info('Item moved to trash');
          }
        }}
        aria-keyshortcuts="Delete Backspace"
        tabIndex={0}
        role="option"
        draggable={!isTrashed && !isEditing}
        onDragStart={(e) => !isTrashed && !isEditing && handleFileDragStart(e, item)}
        title={`${item.relativePath} - double-click the name to rename, drag onto the canvas to place it`}
        actions={
          <>
            {/* One gesture, one job. The chip filters; a real, labelled button
                beside it takes the tag off this file. W5-P7 had the removal on a
                `onDoubleClick` over the chip, which has no keyboard route, no
                accessible name, and lived only in a tooltip — while the chip's
                own Enter/Space was already spent on filtering. */}
            <span className="library-file-row__tags">
              {shownTags.map((tag) => (
                <span key={tag} className="library-file-row__tagpair">
                  <Chip
                    className="library-file-row__tag"
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); handleTagClick(tag); }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        handleTagClick(tag);
                      }
                    }}
                    title={`Filter by ${tag}`}
                  >
                    {tag}
                  </Chip>
                  <IconButton
                    variant="ghost"
                    className="library-file-row__untag"
                    label={`Remove ${tag} tag`}
                    onClick={(e) => {
                      e.stopPropagation();
                      recordLibraryEdit('Remove tag', () => removeTagFromItem(item.id, tag));
                    }}
                    onKeyDown={(e: React.KeyboardEvent) => {
                      if (e.key !== 'Enter' && e.key !== ' ') return;
                      e.preventDefault();
                      e.stopPropagation();
                      recordLibraryEdit('Remove tag', () => removeTagFromItem(item.id, tag));
                    }}
                    icon={<IconClose size={11} />}
                    title={`Remove ${tag} tag`}
                  />
                </span>
              ))}
              {/* ONE tag inline, the rest behind the count. Two chips plus their
                  remove buttons could not both stay readable AND leave the file
                  name its 120px floor — squeezed, they rendered as empty pills,
                  which is worse than not showing them.

                  But the remove button travels with its chip, so a count that only
                  had a tooltip made tags 2..N unremovable — a capability HEAD had.
                  So the count is a DISCLOSURE: it names the hidden tags in its
                  title, and clicking it (or Enter/Space on it) opens them on this
                  row, each with its own remove button. */}
              {hiddenTags.length > 0 && (
                <Chip
                  className="library-file-row__more"
                  role="button"
                  tabIndex={0}
                  aria-expanded={tagsExpanded}
                  aria-label={
                    tagsExpanded
                      ? 'Show fewer tags'
                      : `Show ${hiddenTags.length} more ${hiddenTags.length === 1 ? 'tag' : 'tags'}: ${hiddenTags.join(', ')}`
                  }
                  onClick={(e) => { e.stopPropagation(); toggleTags(); }}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
                    e.stopPropagation();
                    toggleTags();
                  }}
                  title={tagsExpanded ? 'Show fewer tags' : `Also tagged ${hiddenTags.join(', ')} - click to remove any of them`}
                >
                  {tagsExpanded ? 'Less' : `+${hiddenTags.length}`}
                </Chip>
              )}
            </span>
            <IconButton
              variant="ghost"
              className={`library-file-row__trash${isTrashed ? ' is-restore' : ''}`}
              label={isTrashed ? `Restore ${item.fileName}` : `Move ${item.fileName} to trash`}
              disabled={isPreviewing || isLoading}
              onClick={(e) => {
                e.stopPropagation();
                if (isTrashed) {
                  // Restoring and stepping out of the trash view is ONE gesture,
                  // so it is one entry: undo puts the row back in the trash AND
                  // puts the filter back where the player had it.
                  recordLibraryEdit('Restore sample', () => {
                    restoreItem(item.id);
                    // Only clear the filter when we are LOOKING at the trash, so
                    // the restored item reappears in the main list rather than
                    // vanishing.
                    if (activeFilterTag === 'trash') setActiveFilterTag(null);
                  });
                  toast.success('Item restored');
                } else {
                  recordLibraryEdit('Move sample to trash', () => trashItem(item.id));
                  toast.info('Item moved to trash');
                }
              }}
              icon={isTrashed ? <IconRestore /> : <IconClose size={13} />}
              title={isTrashed ? 'Restore' : 'Move to trash'}
            />
            {isTrashed && (
              <IconButton
                variant="ghost"
                className="library-file-row__delete"
                label={`Permanently delete ${item.fileName}`}
                disabled={isPreviewing || isLoading}
                onClick={(e) =>
                  askToDelete({ kind: 'delete-item', id: item.id, name: item.fileName }, e)
                }
                icon={<IconTrash />}
                title="Permanently delete"
              />
            )}
          </>
        }
      >
        <button
          type="button"
          className={`file-preview-btn${isPreviewing ? ' is-playing' : ''}`}
          onClick={(e) => { e.stopPropagation(); handlePreviewItem(item.id); }}
          aria-label={isPreviewing ? `Stop ${item.fileName}` : `Preview ${item.fileName}`}
          aria-pressed={isPreviewing}
          title={isLoading ? 'Loading...' : (isPreviewing ? 'Stop' : 'Preview')}
          disabled={isLoading}
        >
          {isPreviewing ? <IconStopGlyph /> : <IconPlayGlyph />}
        </button>

        {isEditing ? (
          <Input
            ref={editNameInputRef}
            className="library-file-row__rename"
            value={editingName}
            onChange={(e) => setEditingName(e.target.value)}
            onBlur={handleSaveFileName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleSaveFileName();
              } else if (e.key === 'Escape') {
                setEditingItemId(null);
                setEditingName('');
              }
            }}
            onClick={(e) => e.stopPropagation()}
            aria-label="File name"
          />
        ) : (
          <span
            className="library-file-row__name"
            onDoubleClick={(e) => {
              e.stopPropagation();
              handleStartEditFileName(item.id);
            }}
          >
            {isVirtual && (
              <span className="library-file-row__virtual" title="Virtual crop - it references its parent file">
                CROP
              </span>
            )}
            {item.fileName}
          </span>
        )}

        {item.duration ? (
          <span className="oj-node__readout library-file-row__len">
            {formatSampleDuration(item.duration)}
          </span>
        ) : null}
      </ListRow>
    );
  };

  // Check if scanning
  const isScanning =
    scanProgress !== null && scanProgress.libraryId === effectiveLibraryId && scanProgress.phase !== 'complete';

  // Combined style with dimensions (S3's measured geometry reads data.width/height)
  const nodeStyle: React.CSSProperties = {
    ...style,
    width: nodeWidth,
    height: nodeHeight,
  };

  // SEAM-1: the single live seam - the sample feed into connected samplers.
  // Resolve it from the node's ports (id may be 'sample-out'; fall back by
  // type/direction so a migrated node still finds it).
  const sampleOutPort =
    node.ports.find((p) => p.id === 'sample-out') ??
    node.ports.find((p) => p.type === 'audio' && p.direction === 'output');


  const cardClass = [
    'schematic-node',
    'library-node',
    isResizing && 'is-resizing',
    isHoveredWithConnections && 'hover-connecting',
  ].filter(Boolean).join(' ');

  return (
    <NodeShell
      className={cardClass}
      style={nodeStyle}
      title={currentLibrary ? currentLibrary.name : 'Library'}
      nodeType={currentLibrary ? `${currentLibrary.itemCount} FILES` : 'FILES'}
      selected={isSelected}
      dragging={isDragging}
      agentPending={isAgentPending}
      headerProps={{ onMouseDown: handleHeaderMouseDown }}
      onMouseEnter={handleNodeMouseEnter}
      onMouseLeave={handleNodeMouseLeave}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => e.stopPropagation()}
      outputs={sampleOutPort ? (
        <PortRow
          side="output"
          kind="audio"
          label={sampleOutPort.name || 'Sample'}
          connected={!!hasConnection?.(sampleOutPort.id)}
          data-node-id={node.id}
          data-port-id={sampleOutPort.id}
          data-port-type="audio"
          onMouseDown={(e: React.MouseEvent) => { e.stopPropagation(); handlePortMouseDown?.(sampleOutPort.id, e); }}
          onMouseUp={(e: React.MouseEvent) => { e.stopPropagation(); handlePortMouseUp?.(sampleOutPort.id, e); }}
          onMouseEnter={() => handlePortMouseEnter?.(sampleOutPort.id)}
          onMouseLeave={handlePortMouseLeave}
          title="Sample out - wire this to a Sampler"
        />
      ) : undefined}
    >
      <div className="library-body" onMouseDown={(e) => e.stopPropagation()}>
        {/* MISSING-2 — the exit from the struck-through rows.
            Above the list, because it is about the list; a banner and not a
            modal, because a folder that moved is not an emergency and a live
            instrument never has focus taken from it to be told about one. The
            count comes from the same array the sheet lists, so the two cannot
            disagree. */}
        {currentLibrary && !isScanning && missingItems.length > 0 && (
          <Callout
            variant="danger"
            className="library-missing"
            title={`${missingItems.length} sample${missingItems.length === 1 ? '' : 's'} moved or went missing`}
          >
            <p className="library-missing__body">
              The struck-through rows below point at files that are no longer
              where the folder scan left them. Nothing is lost — point
              OpenJammer at them again and every tag, crop and name comes with
              them.
            </p>
            <Button
              className="library-missing__cta"
              onClick={() => setIsRelinking(true)}
            >
              Relink {missingItems.length} missing sample
              {missingItems.length === 1 ? '' : 's'}...
            </Button>
          </Callout>
        )}

        {!currentLibrary ? (
          /* Nothing linked yet. One sentence about what a folder buys you, and
             one primary button - the only solid accent fill on this card. */
          <Callout
            variant="info"
            title="Link a folder of audio"
            className="library-onboard"
          >
            <p className="library-onboard__body">
              Point OpenJammer at a folder and every sound in it becomes
              searchable, taggable, and draggable straight onto the canvas.
              Nothing is copied or moved.
            </p>
            <Button
              variant="primary"
              className="library-onboard__cta"
              onClick={handleLinkFolder}
              loading={isLinking}
              disabled={isLinking}
            >
              Link a folder...
            </Button>
            {!isFileSystemAccessSupported() && (
              <p className="library-onboard__note">
                This browser cannot open a folder. Chrome or Edge can.
              </p>
            )}
          </Callout>
        ) : isScanning ? (
          /* Reading the folder. A real progress bar plus skeleton rows, so the
             panel keeps the shape it is about to have instead of collapsing. */
          <div className="library-scanning">
            <ProgressBar
              value={scanProgress?.current ?? 0}
              max={Math.max(scanProgress?.total ?? 1, 1)}
              aria-label="Scanning folder"
            />
            <span className="oj-node__readout library-scanning__status">
              {scanProgress?.current ?? 0} / {scanProgress?.total ?? '?'} files
            </span>
            <div className="library-skeleton" aria-hidden="true">
              {[0, 1, 2, 3, 4].map((i) => (
                <span key={i} className="library-skeleton__row" />
              ))}
            </div>
          </div>
        ) : (
          <div className="library-panels">
            {/* ---- Left: the tag rail ---- */}
            <div className="library-tags-panel" ref={leftPanelRef}>
              <div
                className={`library-tags-section${dragOverPinnedSection ? ' is-drop-target' : ''}`}
                style={{ height: `${separatorPos * 100}%` }}
                onDragOver={(e) => {
                  if (draggingTag) {
                    e.preventDefault();
                    setDragOverPinnedSection(true);
                  }
                }}
                onDragLeave={() => setDragOverPinnedSection(false)}
                onDrop={handlePinnedSectionDrop}
              >
                <div className="library-section-head">
                  <span className="library-section-head__title">Pinned</span>
                </div>
                <ScrollContainer mode="dropdown" className="library-tags-scroll">
                  <List role="listbox" aria-label="Pinned tags" className="library-tag-list">
                    {pinnedTags.map((tag, index) => renderTag(tag, true, index))}
                  </List>
                  {pinnedTags.length === 0 && (
                    <p className="library-hint">Drag a tag here to keep it at hand.</p>
                  )}
                </ScrollContainer>
              </div>

              <PanelSeparator
                direction="vertical"
                onMouseDown={handleSeparatorMouseDown}
                isDragging={isDraggingSeparator}
                className="library-separator"
              />

              <div
                className={`library-tags-section${dragOverOtherSection ? ' is-drop-target' : ''}`}
                style={{ height: `${(1 - separatorPos) * 100}%` }}
                onDragOver={(e) => {
                  if (draggingPinnedTag) {
                    e.preventDefault();
                    setDragOverOtherSection(true);
                  }
                }}
                onDragLeave={() => setDragOverOtherSection(false)}
                onDrop={handleOtherSectionDrop}
              >
                <div className="library-section-head">
                  <span className="library-section-head__title">All tags</span>
                  <Button
                    variant="ghost"
                    className="library-add-tag"
                    onClick={() => setIsCreatingTag(true)}
                    title="Create a new tag"
                  >
                    + New
                  </Button>
                </div>
                <ScrollContainer mode="dropdown" className="library-tags-scroll">
                  {isCreatingTag && (
                    <Input
                      ref={newTagInputRef}
                      className="library-new-tag"
                      value={newTagName}
                      onChange={(e) => setNewTagName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleCreateTag();
                        if (e.key === 'Escape') { setIsCreatingTag(false); setNewTagName(''); }
                      }}
                      onBlur={handleCreateTag}
                      placeholder="Tag name..."
                      aria-label="New tag name"
                      onMouseDown={(e) => e.stopPropagation()}
                    />
                  )}
                  <List role="listbox" aria-label="All tags" className="library-tag-list">
                    {otherTags.map((tag) => renderTag(tag, false))}
                  </List>
                  {otherTags.length === 0 && !isCreatingTag && (
                    <p className="library-hint">No tags yet. Make one with + New.</p>
                  )}
                </ScrollContainer>
              </div>
            </div>

            {/* ---- Right: search, the feed preview, and the files ---- */}
            <div className="library-files-panel">
              <div className="library-search">
                <Input
                  ref={searchRef}
                  className="library-search__input"
                  type="search"
                  placeholder="Search files and tags"
                  aria-label="Search files and tags"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onMouseDown={(e) => e.stopPropagation()}
                />
                {activeFilterTag && (
                  <Chip
                    className="library-filter-chip"
                    pressed
                    role="button"
                    tabIndex={0}
                    onClick={() => setActiveFilterTag(null)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setActiveFilterTag(null);
                      }
                    }}
                    title="Clear the tag filter"
                  >
                    {activeFilterTag} x
                  </Chip>
                )}
                {activeFilterTag === 'trash' && libraryItems.length > 0 && (
                  <Button
                    variant="danger"
                    className="library-empty-trash"
                    disabled={loadingItemId !== null}
                    onClick={(e) =>
                      askToDelete({ kind: 'empty-trash', count: libraryItems.length }, e)
                    }
                  >
                    Empty trash
                  </Button>
                )}
              </div>

              {/* What this node is feeding down the cable, right now. One idb
                  read, one trace - the sample you picked, not every row. */}
              {currentItem && (
                <div className="library-feed">
                  <WaveformView
                    className="library-feed__clip"
                    peaks={previewPeaks}
                    durationLabel={currentItem.duration ? formatSampleDuration(currentItem.duration) : '-'}
                    name={currentItem.fileName}
                    cropped={currentItem.isVirtual === true}
                    selected
                    title="The sample being fed to every connected Sampler"
                  />
                  <span className="library-feed__label">Feeding</span>
                </div>
              )}

              <div
                ref={filesContainerRef}
                className="library-files-container"
                onMouseDownCapture={handleFilesMouseDown}
              >
                <ScrollContainer ref={scrollContainerRef} mode="dropdown" className="library-files">
                  {libraryItems.length === 0 ? (
                    <p className="library-hint library-hint--center">
                      {(searchQuery || activeFilterTag) ? 'Nothing matches that.' : 'This folder has no audio in it.'}
                    </p>
                  ) : (
                    <>
                      {(debouncedSearch || activeFilterTag) && (
                        <span className="oj-node__readout library-count">
                          {libraryItems.length} item{libraryItems.length !== 1 ? 's' : ''}
                        </span>
                      )}
                      <List role="listbox" aria-label="Files" className="library-file-list">
                        {libraryItems.map(renderFileRow)}
                      </List>
                    </>
                  )}
                </ScrollContainer>

                {selectionBox && (
                  <div
                    className="library-selection-box"
                    style={{
                      left: Math.min(selectionBox.startX, selectionBox.currentX),
                      top: Math.min(selectionBox.startY, selectionBox.currentY),
                      width: Math.abs(selectionBox.currentX - selectionBox.startX),
                      height: Math.abs(selectionBox.currentY - selectionBox.startY),
                    }}
                  />
                )}
              </div>
            </div>
          </div>
        )}

        {/* The one destructive question, always in the same place (UI-021). */}
        {pendingConfirm && (
          <Callout
            key={pendingConfirm.kind}
            variant="danger"
            className="library-confirm"
            role="alertdialog"
            aria-label="Confirm"
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return;
              event.stopPropagation();
              setPendingConfirm(null);
            }}
            title={
              pendingConfirm.kind === 'delete-tag'
                ? `Delete the tag "${pendingConfirm.tag}"?`
                : pendingConfirm.kind === 'delete-item'
                  ? `Permanently delete "${pendingConfirm.name}"?`
                  : `Permanently delete ${pendingConfirm.count} trashed item${pendingConfirm.count === 1 ? '' : 's'}?`
            }
          >
            <p className="library-confirm__body">
              {pendingConfirm.kind === 'delete-tag'
                ? 'It comes off every file that carries it. The files themselves are untouched.'
                : 'This cannot be undone.'}
            </p>
            <div className="library-confirm__actions">
              <Button
                ref={keepItRef}
                variant="secondary"
                data-autofocus="true"
                onClick={() => setPendingConfirm(null)}
              >
                Keep it
              </Button>
              <Button
                variant="danger"
                onClick={async () => {
                  const action = pendingConfirm;
                  setPendingConfirm(null);
                  if (!action) return;
                  if (action.kind === 'delete-tag') {
                    // The files are untouched, so this one really does come back.
                    recordLibraryEdit('Delete tag', () => deleteTag(action.tag));
                    return;
                  }
                  if (action.kind === 'delete-item') {
                    setLoadingItemId(action.id);
                    try {
                      // SEALED: the waveform and the file handle leave IndexedDB
                      // here, so undo must not put back a row that plays nothing.
                      await recordSealedLibraryEditAsync('Delete sample permanently', () =>
                        permanentlyDeleteItem(action.id),
                      );
                      toast.success('Item permanently deleted');
                    } catch (error) {
                      console.error('Failed to delete item:', error);
                      toast.error('Failed to delete item');
                    } finally {
                      setLoadingItemId(null);
                    }
                    return;
                  }
                  setLoadingItemId('empty-trash');
                  try {
                    await recordSealedLibraryEditAsync('Empty trash', async () => {
                      await emptyTrash();
                      setActiveFilterTag(null);
                    });
                    toast.success('Trash emptied');
                  } catch (error) {
                    console.error('[Library] Failed to empty trash:', error);
                    toast.error('Failed to empty trash');
                  } finally {
                    setLoadingItemId(null);
                  }
                }}
              >
                Delete
              </Button>
            </div>
          </Callout>
        )}

        {/* MISSING-3 — the recovery itself. On close the walk runs again, so
            the banner's count is the answer to what the player just did rather
            than what was true when the sheet opened: relink three of five and
            the card says two, with no reload and no second gesture. */}
        {isRelinking && effectiveLibraryId && (
          <RelinkSamplesDialog
            libraryId={effectiveLibraryId}
            missingSamples={missingItems}
            onClose={() => {
              setIsRelinking(false);
              checkMissingItems(effectiveLibraryId).catch((err) => {
                console.warn('[Library] Missing-file re-check failed:', err);
              });
            }}
          />
        )}
      </div>

      <ResizeHandles
        handles={['se', 'e', 's']}
        onResizeStart={handleResizeStart}
        isResizing={isResizing}
      />
    </NodeShell>
  );
});

/** Preview - a play triangle. */
function IconPlayGlyph() {
  return (
    <svg viewBox="0 0 24 24" width={12} height={12} fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

/** Stop the preview - a square. */
function IconStopGlyph() {
  return (
    <svg viewBox="0 0 24 24" width={12} height={12} fill="currentColor" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

/** Put it back - a curling return arrow. */
function IconRestore() {
  return (
    <svg viewBox="0 0 24 24" width={13} height={13} fill="currentColor" aria-hidden="true">
      <path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z" />
    </svg>
  );
}

/** Gone for good - a bin. */
function IconTrash() {
  return (
    <svg viewBox="0 0 24 24" width={13} height={13} fill="currentColor" aria-hidden="true">
      <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
    </svg>
  );
}
