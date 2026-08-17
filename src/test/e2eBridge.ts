import { buildDenseEdit, buildFirstLight, buildPathological } from '../song/fixtures';
import type { Arrangement } from '../song/types';
import { useArrangementStore } from '../store/arrangementStore';

type FixtureName = 'denseEdit' | 'firstLight' | 'pathological';

interface E2EBridge {
    setFixture(name: FixtureName): void;
    snapshot(): Arrangement | null;
}

const clone = <T>(value: T): T => structuredClone(value);

export function installE2EBridge(): void {
    if (typeof window === 'undefined' || !navigator.webdriver) return;
    const fixtures = { denseEdit: buildDenseEdit, firstLight: buildFirstLight, pathological: buildPathological };
    const bridge: E2EBridge = {
        setFixture(name) {
            useArrangementStore.getState().setArrangement(fixtures[name]());
        },
        snapshot: () => clone(useArrangementStore.getState().arrangement),
    };
    (window as unknown as { __openjammerE2E: E2EBridge }).__openjammerE2E = bridge;
}
