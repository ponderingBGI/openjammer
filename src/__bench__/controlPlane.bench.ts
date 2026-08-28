import { bench, describe } from 'vitest';
import { encodeTimelineDocuments } from '../audio/executor/timelinePlayback';
import { encodeWAV } from '../audio/wav';
import { virtualizationWindow } from '../components/Arrangement/geometry';
import { conduct, type ConductResult } from '../song/conduct';
import { buildDenseEdit, buildFirstLight, buildHundredTracks } from '../song/fixtures';
import { seededRandom } from '../song/fixtures/prng';
import { normalizeArrangement } from '../song/normalize';
import { getGridLadder } from '../song/rulerMarks';
import { applyVerbs, type Verb } from '../song/verbs';
import {
    registerHistoryDriver,
    useHistoryStore,
    type EditVerb,
    type HistoryScope,
} from '../store/historyStore';

function assertBench(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(`benchmark invariant: ${message}`);
}

const firstLight = buildFirstLight();
const hundredTracks = buildHundredTracks();
const denseEdit = buildDenseEdit();

// Pinned fixture facts make an accidentally empty/partial lowering fail loudly.
const FIRST_LIGHT_EVENT_COUNT = 2_714;
const HUNDRED_TRACK_EVENT_COUNT = 183_000;

describe('conduct', () => {
    bench('conduct(firstLight)', () => {
        const result = conduct(firstLight);
        assertBench(result.events.length === FIRST_LIGHT_EVENT_COUNT, `First Light produced ${result.events.length} events`);
        assertBench(result.timeline.events.length === result.events.length, 'First Light timeline/event parity');
    });

    bench('conduct(hundredTracks)', () => {
        const result = conduct(hundredTracks);
        assertBench(result.events.length === HUNDRED_TRACK_EVENT_COUNT, `Hundred Tracks produced ${result.events.length} events`);
        assertBench(Object.keys(result.trackIndex).length === 100, 'Hundred Tracks lost a track');
    });
});

const verbRandom = seededRandom(0x72b5_1000);
const denseTrackIds = denseEdit.tracks.map((track) => track.id!);
const verbStorm: Verb[] = Array.from({ length: 1_000 }, (_, index) => {
    const trackId = denseTrackIds[verbRandom.int(0, denseTrackIds.length - 1)]!;
    switch (index % 5) {
        case 0: return { kind: 'setTrackMute', trackId, mute: verbRandom.int(0, 1) === 1 };
        case 1: return { kind: 'setTrackSolo', trackId, solo: verbRandom.int(0, 1) === 1 };
        case 2: return { kind: 'setTrackGain', trackId, gainDb: verbRandom.int(-240, 60) / 10 };
        case 3: return { kind: 'setTrackPan', trackId, pan: verbRandom.int(-100, 100) / 100 };
        default: return { kind: 'setTrackName', trackId, name: `Storm ${verbRandom.int(0, 99)}` };
    }
});

describe('editing control plane', () => {
    bench('applyVerbs(denseEdit, 1k mixed verbs)', () => {
        const result = applyVerbs(denseEdit, verbStorm);
        assertBench(result.inverse.length === 1_000, `verb storm produced ${result.inverse.length} inverses`);
        assertBench(result.next.tracks.length === denseEdit.tracks.length, 'verb storm lost tracks');
        assertBench(result.next !== denseEdit, 'verb storm returned its input');
    });

    const historyTransactions: Array<{
        verbs: EditVerb[];
        inverse: EditVerb[];
        scope: HistoryScope;
    }> = Array.from({ length: 500 }, (_, index) => {
        if (index % 2 === 0) {
            return {
                verbs: [{ domain: 'graph', verb: { kind: 'moveNode', nodeId: `node-${index % 16}`, position: { x: index, y: -index } } }],
                inverse: [{ domain: 'graph', verb: { kind: 'moveNode', nodeId: `node-${index % 16}`, position: { x: index - 1, y: 1 - index } } }],
                scope: 'graph',
            };
        }
        const trackId = denseTrackIds[index % denseTrackIds.length]!;
        return {
            verbs: [{ domain: 'arrangement', verb: { kind: 'setTrackGain', trackId, gainDb: -(index % 24) } }],
            inverse: [{ domain: 'arrangement', verb: { kind: 'setTrackGain', trackId, gainDb: -((index - 1) % 24) } }],
            scope: 'arrangement',
        };
    });
    let dispatchedHistoryVerbs = 0;
    registerHistoryDriver((verbs) => { dispatchedHistoryVerbs += verbs.length; });

    bench('historyStore interleave(500 transactions + undo/redo sweeps)', () => {
        const history = useHistoryStore.getState();
        history.clear();
        dispatchedHistoryVerbs = 0;
        for (let index = 0; index < historyTransactions.length; index++) {
            const transaction = historyTransactions[index]!;
            const current = useHistoryStore.getState();
            current.begin(`Transaction ${index}`, transaction.scope);
            useHistoryStore.getState().record(transaction.verbs, transaction.inverse, undefined, transaction.scope);
            useHistoryStore.getState().commit();
        }
        for (let index = 0; index < 125; index++) useHistoryStore.getState().undo();
        for (let index = 0; index < 75; index++) useHistoryStore.getState().redo();
        const result = useHistoryStore.getState();
        assertBench(result.entries.length === 500, `history retained ${result.entries.length} transactions`);
        assertBench(result.cursor === 450, `history cursor ended at ${result.cursor}`);
        assertBench(dispatchedHistoryVerbs === 200, `history dispatched ${dispatchedHistoryVerbs} verbs`);
    });
});

const normalizedHundredTracks = normalizeArrangement(hundredTracks);

describe('normalization', () => {
    bench('normalize(hundredTracks) idempotent second pass', () => {
        const result = normalizeArrangement(normalizedHundredTracks);
        assertBench(result.tracks.length === 100, 'normalization lost tracks');
        assertBench(Object.keys(result.sources ?? {}).length === 2_000, 'normalization lost sources');
        assertBench(result.idCounter === normalizedHundredTracks.idCounter, 'second pass advanced the id counter');
    });
});

const ZOOM_LEVELS = [
    0.001, 0.0015, 0.002, 0.003, 0.0045, 0.006, 0.008, 0.012, 0.018, 0.026,
    0.038, 0.055, 0.08, 0.12, 0.18, 0.26, 0.38, 0.55, 0.8, 1.2,
] as const;
const hundredTrackHeights = hundredTracks.tracks.map((track) => 72 + ((track.automation?.length ?? 0) > 0 ? 96 : 0));
const scrollSweep = Array.from({ length: 240 }, (_, index) => ({
    left: index * 1_280,
    top: index * 73,
    width: 1_440,
    height: 900,
}));

describe('arrangement viewport math', () => {
    bench('grid ladder across 20 zoom levels', () => {
        const results = ZOOM_LEVELS.map((pxPerTick) => getGridLadder(pxPerTick * 3_840, 4, 'adaptive'));
        assertBench(results.length === 20, 'grid ladder skipped a zoom level');
        assertBench(results[0]!.barStride === 4 && results.at(-1)!.drawSubdivisions, 'grid ladder did not span coarse-to-fine detail');
    });

    bench('virtualization window across scroll sweep', () => {
        let checksum = 0;
        let finalWindow = { firstLane: 0, lastLane: 0 };
        for (const view of scrollSweep) {
            finalWindow = virtualizationWindow(hundredTrackHeights, view, 0.08, 200, 46);
            checksum += finalWindow.firstLane + finalWindow.lastLane;
        }
        assertBench(checksum > 10_000, `virtualization checksum was ${checksum}`);
        assertBench(finalWindow.lastLane <= 100 && finalWindow.lastLane > finalWindow.firstLane, 'virtualization returned an invalid lane range');
    });
});

const conductedFirstLight = conduct(firstLight);
const conductedHundredTracks = conduct(hundredTracks);

function benchTimelineWireBuild(name: string, conducted: ConductResult, expectedEvents: number): void {
    bench(name, () => {
        const result = encodeTimelineDocuments(conducted.tempoMap, conducted.timeline);
        assertBench(conducted.timeline.events.length === expectedEvents, 'wire-build input event count changed');
        assertBench(result.tempoMap.byteLength > 100, 'tempo-map wire document was empty');
        assertBench(result.timeline.byteLength > expectedEvents * 20, 'timeline wire document was implausibly small');
    });
}

describe('Timeline wire-build', () => {
    benchTimelineWireBuild('Timeline wire-build(firstLight)', conductedFirstLight, FIRST_LIGHT_EVENT_COUNT);
    benchTimelineWireBuild('Timeline wire-build(hundredTracks)', conductedHundredTracks, HUNDRED_TRACK_EVENT_COUNT);
});

const PCM_SAMPLE_RATE = 48_000;
const PCM_FRAMES = PCM_SAMPLE_RATE * 10;
const pcmChannels = [new Float32Array(PCM_FRAMES), new Float32Array(PCM_FRAMES)];
for (let frame = 0; frame < PCM_FRAMES; frame++) {
    pcmChannels[0]![frame] = Math.sin(2 * Math.PI * 220 * frame / PCM_SAMPLE_RATE) * 0.6;
    pcmChannels[1]![frame] = Math.sin(2 * Math.PI * 330 * frame / PCM_SAMPLE_RATE) * 0.55;
}
const pcmBuffer = {
    length: PCM_FRAMES,
    numberOfChannels: 2,
    sampleRate: PCM_SAMPLE_RATE,
    getChannelData: (channel: number) => pcmChannels[channel]!,
} as unknown as AudioBuffer;

describe('export', () => {
    bench('TS WAV encode(10s stereo PCM)', () => {
        const result = encodeWAV(pcmBuffer, { bitDepth: 16 });
        assertBench(result.byteLength === 44 + PCM_FRAMES * 2 * 2, `WAV byte length was ${result.byteLength}`);
        assertBench(new DataView(result).getUint32(4, true) === result.byteLength - 8, 'WAV RIFF size was invalid');
    });
});
