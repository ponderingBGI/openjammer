import { getExecutor } from '../../audio/executor';
import { registerTimelineFrameWriter } from './sharedAnimationFrame';

let levels = new Map<string, number>();
let unsubscribeSignal: (() => void) | null = null;
let users = 0;

export function registerTimelineLevelWriter(write: (levels: ReadonlyMap<string, number>) => void): () => void {
    users += 1;
    if (!unsubscribeSignal) unsubscribeSignal = getExecutor().subscribeSignalLevels((next) => { levels = next; });
    const unregisterFrame = registerTimelineFrameWriter(() => write(levels));
    return () => {
        unregisterFrame();
        users -= 1;
        if (users === 0) {
            unsubscribeSignal?.();
            unsubscribeSignal = null;
            levels = new Map();
        }
    };
}
