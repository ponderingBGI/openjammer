/**
 * Engine health store tests (Phase 1). The store holds the tri-state TRUTH; the
 * one positive helper {@link setEngineLive} must never paper over a sticky fault.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    useEngineHealthStore,
    setEngineHealth,
    setEngineLive,
    presentHealth,
} from '../engineHealthStore';

beforeEach(() => {
    // Reset to the cold-start truth between cases.
    useEngineHealthStore.setState({ health: 'IDLE', reason: '' });
});

describe('setEngineLive guards against masking a real fault', () => {
    it('goes LIVE from the calm IDLE start', () => {
        setEngineLive('engine up');
        const s = useEngineHealthStore.getState();
        expect(s.health).toBe('LIVE');
        expect(s.reason).toBe('engine up');
    });

    it('re-affirms LIVE while already LIVE', () => {
        setEngineHealth('LIVE', 'first');
        setEngineLive('again');
        expect(useEngineHealthStore.getState().health).toBe('LIVE');
    });

    it('does NOT overwrite a sticky DEAD engine (the dot stays honest)', () => {
        setEngineHealth('DEAD', 'IPC bridge absent');
        setEngineLive(); // a stray "live" signal after the fault
        const s = useEngineHealthStore.getState();
        expect(s.health).toBe('DEAD');
        expect(s.reason).toBe('IPC bridge absent');
    });

    it('does NOT overwrite a sticky DEGRADED engine', () => {
        setEngineHealth('DEGRADED', 'graph push rejected');
        setEngineLive();
        const s = useEngineHealthStore.getState();
        expect(s.health).toBe('DEGRADED');
        expect(s.reason).toBe('graph push rejected');
    });

    it('the executor can still escalate back to LIVE explicitly after recovery', () => {
        setEngineHealth('DEAD', 'down');
        // The executor — not the convenience helper — knows it truly recovered.
        setEngineHealth('LIVE', 'recovered on new device');
        expect(useEngineHealthStore.getState().health).toBe('LIVE');
    });
});

describe('setHealth is idempotent (no churn during a fault storm)', () => {
    it('a repeated identical transition does not re-render subscribers', () => {
        setEngineHealth('DEGRADED', 'same');
        let calls = 0;
        const unsub = useEngineHealthStore.subscribe(() => {
            calls += 1;
        });
        setEngineHealth('DEGRADED', 'same'); // no-op
        expect(calls).toBe(0);
        setEngineHealth('DEGRADED', 'changed reason'); // real change
        expect(calls).toBe(1);
        unsub();
    });
});

describe('presentHealth pairs DEAD with the only allowed alarm', () => {
    it('only DEAD is an alarm; IDLE never alarms', () => {
        expect(presentHealth('DEAD').isAlarm).toBe(true);
        expect(presentHealth('DEGRADED').isAlarm).toBe(false);
        expect(presentHealth('LIVE').isAlarm).toBe(false);
        expect(presentHealth('IDLE').isAlarm).toBe(false);
    });
});
