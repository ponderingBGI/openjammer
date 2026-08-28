import type { SurfaceId } from '../store/uiViewStore';

export type KeymapScope = 'text' | 'modal' | 'surface' | 'global';

export interface BindingEntry {
    actionId: string;
    guard?: (event: KeyboardEvent) => boolean;
    run: (event: KeyboardEvent) => boolean;
}

export interface BindingSet {
    id: string;
    scope: Exclude<KeymapScope, 'text'>;
    surface?: SurfaceId;
    entries: BindingEntry[];
}
