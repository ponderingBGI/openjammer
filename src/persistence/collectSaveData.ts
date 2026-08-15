import { arrangementForExport } from '../song/project';
import type { Arrangement } from '../song/types';
import { useArrangementStore } from '../store/arrangementStore';
import { useCanvasStore } from '../store/canvasStore';
import { useGraphStore } from '../store/graphStore';
import { useHistoryStore } from '../store/historyStore';

export interface SaveData {
    nodes: unknown[];
    edges: unknown[];
    viewport: { x: number; y: number; zoom: number };
    arrangement: Arrangement | null;
}

/** Collect the complete authoring document for every save and recovery path. */
export function collectSaveData(): SaveData {
    const graph = useGraphStore.getState();
    const canvas = useCanvasStore.getState();
    const arrangement = useArrangementStore.getState().arrangement;

    const data = {
        nodes: Array.from(graph.nodes.values()),
        edges: Array.from(graph.connections.values()),
        viewport: {
            x: canvas.pan.x,
            y: canvas.pan.y,
            zoom: canvas.zoom,
        },
        arrangement: arrangement ? arrangementForExport(arrangement) : null,
    };
    useHistoryStore.getState().markClean();
    return data;
}
