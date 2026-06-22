import { describe, it, expect } from 'vitest';
import { OjcoreLooperHandle, type OjcoreBridge } from '../ojcoreHandles';
import { INFINITE_DURATION } from '../capabilities';
import type { RtCommand } from '../../../../packages/oj-protocol-ts/src/index';

/** A bridge stub that records every RtCommand the handle sends. */
function mockBridge(): { bridge: OjcoreBridge; sent: RtCommand[] } {
    const sent: RtCommand[] = [];
    const bridge: OjcoreBridge = {
        nodeIndex: () => 3,
        sendCommand: (cmd) => sent.push(cmd),
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
            loadSample: async () => {},
            startCapture: () => {},
            stopCapture: async () => null,
        };
        new OjcoreLooperHandle('looper-1', bridge).setDuration(10);
        expect(sent).toHaveLength(0);
    });
});
