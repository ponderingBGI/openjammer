import { describe, it, expect } from 'vitest';
import { OjcoreLooperHandle, type OjcoreBridge } from '../ojcoreHandles';
import { INFINITE_DURATION, type LoopLayer } from '../capabilities';
import type { RtCommand } from '../../../../packages/oj-protocol-ts/src/index';
import {
    LooperAction,
    LooperState,
    LOOPER_MUTE_FLAG,
} from '../../../../packages/oj-protocol-ts/src/index';

/** A bridge stub that records every RtCommand the handle sends. */
function mockBridge(): { bridge: OjcoreBridge; sent: RtCommand[] } {
    const sent: RtCommand[] = [];
    const bridge: OjcoreBridge = {
        nodeIndex: () => 3,
        sendCommand: (cmd) => sent.push(cmd),
        nodeLevel: () => 0,
        loadSample: async () => {},
        startCapture: () => {},
        stopCapture: async () => null,
    };
    return { bridge, sent };
}

function setParamOf(sent: RtCommand[]): { node: number; param: number; value: number } | undefined {
    const c = sent.find((x) => typeof x === 'object' && x !== null && 'SetParam' in x) as
        | { SetParam: { node: number; param: number; value: number } }
        | undefined;
    return c?.SetParam;
}

/** All `RtCommand::Looper` payloads the handle sent, in order. */
function looperCmds(sent: RtCommand[]): { node: number; action: LooperAction; arg: number }[] {
    return sent
        .filter(
            (x): x is { Looper: { node: number; action: LooperAction; arg: number } } =>
                typeof x === 'object' && x !== null && 'Looper' in x
        )
        .map((x) => x.Looper);
}

describe('OjcoreLooperHandle.setDuration -> engine LOOP_SECS', () => {
    it('forwards the duration (seconds) as SetParam on kernel param 0 (LOOP_SECS)', () => {
        const { bridge, sent } = mockBridge();
        new OjcoreLooperHandle('looper-1', bridge).setDuration(10);
        expect(setParamOf(sent)).toEqual({ node: 3, param: 0, value: 10 });
    });

    it('maps an infinite duration to 0 = free-run', () => {
        const { bridge, sent } = mockBridge();
        new OjcoreLooperHandle('looper-1', bridge).setDuration(INFINITE_DURATION);
        expect(setParamOf(sent)?.value).toBe(0);
    });

    it('clamps to the kernel 60 s ceiling', () => {
        const { bridge, sent } = mockBridge();
        new OjcoreLooperHandle('looper-1', bridge).setDuration(999);
        expect(setParamOf(sent)?.value).toBe(60);
    });

    it('does nothing when the node is not in the graph (no NodeIdx)', () => {
        const sent: RtCommand[] = [];
        const bridge: OjcoreBridge = {
            nodeIndex: () => undefined,
            sendCommand: (cmd) => sent.push(cmd),
            nodeLevel: () => 0,
            loadSample: async () => {},
            startCapture: () => {},
            stopCapture: async () => null,
        };
        new OjcoreLooperHandle('looper-1', bridge).setDuration(10);
        expect(sent).toHaveLength(0);
    });
});

describe('OjcoreLooperHandle.setWet -> engine WET (loop-level balance)', () => {
    it('forwards the wet gain as SetParam on kernel param 1 (WET)', () => {
        const { bridge, sent } = mockBridge();
        new OjcoreLooperHandle('looper-1', bridge).setWet(0.5);
        expect(setParamOf(sent)).toEqual({ node: 3, param: 1, value: 0.5 });
    });

    it('clamps the wet gain to [0, 1]', () => {
        const { bridge, sent } = mockBridge();
        const h = new OjcoreLooperHandle('looper-1', bridge);
        h.setWet(2);
        expect(setParamOf(sent)?.value).toBe(1);
        expect(h.getWet()).toBe(1);
        sent.length = 0;
        h.setWet(-1);
        expect(setParamOf(sent)?.value).toBe(0);
        expect(h.getWet()).toBe(0);
    });

    it('does nothing when the node is not in the graph (no NodeIdx)', () => {
        const sent: RtCommand[] = [];
        const bridge: OjcoreBridge = {
            nodeIndex: () => undefined,
            sendCommand: (cmd) => sent.push(cmd),
            nodeLevel: () => 0,
            loadSample: async () => {},
            startCapture: () => {},
            stopCapture: async () => null,
        };
        const h = new OjcoreLooperHandle('looper-1', bridge);
        h.setWet(0.5);
        expect(sent).toHaveLength(0);
        // The cached value still updates so the UI mirror stays correct.
        expect(h.getWet()).toBe(0.5);
    });
});

describe('OjcoreLooperHandle record flow -> engine-driven', () => {
    it('startRecording sends RECORD (never ARM)', () => {
        const { bridge, sent } = mockBridge();
        const h = new OjcoreLooperHandle('looper-1', bridge);
        void h.startRecording();
        const cmds = looperCmds(sent);
        expect(cmds.map((c) => c.action)).toEqual([LooperAction.RECORD]);
        expect(cmds.some((c) => c.action === LooperAction.ARM)).toBe(false);
        // No synthetic row created on start.
        expect(h.getLoops()).toHaveLength(0);
    });

    it('stopRecording sends STOP and does NOT itself create a row', () => {
        const { bridge, sent } = mockBridge();
        const h = new OjcoreLooperHandle('looper-1', bridge);
        void h.startRecording();
        h.stopRecording();
        expect(looperCmds(sent).map((c) => c.action)).toEqual([
            LooperAction.RECORD,
            LooperAction.STOP,
        ]);
        // The authoritative row creation is the engine edge, not stopRecording.
        expect(h.getLoops()).toHaveLength(0);
    });
});

describe('OjcoreLooperHandle.onEngineEdge -> authoritative row creation', () => {
    it('RECORDING -> PLAYING creates exactly one row', () => {
        const { bridge } = mockBridge();
        const h = new OjcoreLooperHandle('looper-1', bridge);
        const added: LoopLayer[] = [];
        h.setOnLoopAdded((l) => added.push(l));
        void h.startRecording();
        h.onEngineEdge(LooperState.RECORDING, LooperState.PLAYING);
        expect(h.getLoops()).toHaveLength(1);
        expect(added).toHaveLength(1);
    });

    it('OVERDUBBING -> PLAYING layers a second row (does not wipe)', () => {
        const { bridge } = mockBridge();
        const h = new OjcoreLooperHandle('looper-1', bridge);
        h.onEngineEdge(LooperState.RECORDING, LooperState.PLAYING);
        h.onEngineEdge(LooperState.OVERDUBBING, LooperState.PLAYING);
        expect(h.getLoops()).toHaveLength(2);
    });

    it('a non-commit edge creates no row', () => {
        const { bridge } = mockBridge();
        const h = new OjcoreLooperHandle('looper-1', bridge);
        h.onEngineEdge(LooperState.IDLE, LooperState.RECORDING);
        h.onEngineEdge(LooperState.PLAYING, LooperState.OVERDUBBING);
        expect(h.getLoops()).toHaveLength(0);
    });
});

describe('OjcoreLooperHandle.onEngineFrame -> real playhead + trace', () => {
    it('sets the playhead from engine pos/loop_len (0..100)', () => {
        const { bridge } = mockBridge();
        const h = new OjcoreLooperHandle('looper-1', bridge);
        let playhead = -1;
        h.setOnWaveformHistoryUpdate((_hist, p) => (playhead = p));
        h.onEngineFrame(LooperState.PLAYING, 240, 480, 0.5);
        expect(playhead).toBeCloseTo(50);
    });

    it('reports playhead 0 when loop_len is 0 (free-run / empty)', () => {
        const { bridge } = mockBridge();
        const h = new OjcoreLooperHandle('looper-1', bridge);
        let playhead = -1;
        h.setOnWaveformHistoryUpdate((_hist, p) => (playhead = p));
        h.onEngineFrame(LooperState.IDLE, 0, 0, 0);
        expect(playhead).toBe(0);
    });

    it('accumulates the engine peak into the live trace while recording', () => {
        const { bridge } = mockBridge();
        const h = new OjcoreLooperHandle('looper-1', bridge);
        let history: number[] = [];
        h.setOnWaveformHistoryUpdate((hist) => (history = hist));
        h.onEngineFrame(LooperState.RECORDING, 10, 480, 0.3);
        h.onEngineFrame(LooperState.RECORDING, 20, 480, 0.7);
        expect(history).toEqual([0.3, 0.7]);
    });
});

describe('OjcoreLooperHandle per-layer indexed commands', () => {
    /** Capture rows after two committed passes. */
    function withTwoLayers() {
        const { bridge, sent } = mockBridge();
        const h = new OjcoreLooperHandle('looper-1', bridge);
        h.onEngineEdge(LooperState.RECORDING, LooperState.PLAYING); // layer 0
        h.onEngineEdge(LooperState.OVERDUBBING, LooperState.PLAYING); // layer 1
        sent.length = 0; // drop nothing relevant; isolate the op under test
        return { h, sent };
    }

    it('toggleLoopMute(idx 1) emits SET_MUTE with index|MUTE_FLAG, then unmute = bare index', () => {
        const { h, sent } = withTwoLayers();
        const layer1 = h.getLoops()[1];
        h.toggleLoopMute(layer1.id);
        let cmd = looperCmds(sent).at(-1)!;
        expect(cmd.action).toBe(LooperAction.SET_MUTE);
        expect(cmd.arg).toBe((1 | LOOPER_MUTE_FLAG) >>> 0);
        // Unmute -> bare index, MUTE_FLAG cleared.
        h.toggleLoopMute(layer1.id);
        cmd = looperCmds(sent).at(-1)!;
        expect(cmd.action).toBe(LooperAction.SET_MUTE);
        expect(cmd.arg).toBe(1);
    });

    it('deleteLoop emits DELETE_LAYER with the layer index and drops the row', () => {
        const { h, sent } = withTwoLayers();
        const layer0 = h.getLoops()[0];
        h.deleteLoop(layer0.id);
        const cmd = looperCmds(sent).at(-1)!;
        expect(cmd.action).toBe(LooperAction.DELETE_LAYER);
        expect(cmd.arg).toBe(0);
        expect(h.getLoops()).toHaveLength(1);
    });

    it('undoLast emits UNDO_LAST and pops the most-recent row', () => {
        const { h, sent } = withTwoLayers();
        h.undoLast();
        const cmd = looperCmds(sent).at(-1)!;
        expect(cmd.action).toBe(LooperAction.UNDO_LAST);
        expect(h.getLoops()).toHaveLength(1);
    });
});
