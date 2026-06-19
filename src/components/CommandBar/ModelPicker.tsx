import { useEffect, useMemo, useRef, useState } from 'react';
import { providerTitle } from '../../auth/providers';
import { useAuthStore } from '../../auth/authStore';
import {
    listAvailableModels,
    setModel,
    type PiCommandRuntime,
    type PiModel,
} from '../../ai/piSessions';

interface ModelPickerProps {
    runtime: () => PiCommandRuntime;
    initialQuery?: string;
    onSelected: (message: string) => void;
    onCancel: () => void;
}

type DisplayModel = PiModel & { manual?: boolean; instant?: boolean };

function modelKey(model: PiModel): string {
    return `${model.provider}/${model.id}`;
}

function modelLabel(model: PiModel): string {
    return typeof model.name === 'string' && model.name.trim() ? model.name : model.id;
}

function modelSupportsReasoning(model: PiModel): boolean {
    return !!model.reasoning;
}

function filterModels(models: readonly DisplayModel[], query: string): DisplayModel[] {
    const q = query.trim().toLowerCase();
    if (!q) return [...models];
    return models.filter((model) => {
        const haystack = `${model.provider} ${model.id} ${model.name ?? ''} ${model.provider}/${model.id}`.toLowerCase();
        return haystack.includes(q) || model.manual;
    });
}

function mergeModels(...groups: readonly DisplayModel[][]): DisplayModel[] {
    const byKey = new Map<string, DisplayModel>();
    for (const group of groups) {
        for (const model of group) {
            if (!byKey.has(modelKey(model))) byKey.set(modelKey(model), model);
        }
    }
    return Array.from(byKey.values());
}

function configuredProviderSet(
    providerKeys: Record<string, string>,
    configuredProviderIds: readonly string[],
    configured: boolean,
    activeProvider?: string,
): Set<string> {
    const ids = new Set(configuredProviderIds);
    Object.keys(providerKeys).forEach((id) => ids.add(id));
    if (configured && activeProvider) ids.add(activeProvider);
    return ids;
}

export function ModelPicker({ runtime, initialQuery = '', onSelected, onCancel }: ModelPickerProps) {
    const activeProvider = useAuthStore((s) => s.activeProvider);
    const activeModelId = useAuthStore((s) => s.modelId);
    const configured = useAuthStore((s) => s.configured);
    const configuredProviderIds = useAuthStore((s) => s.configuredProviderIds);
    const providerKeys = useAuthStore((s) => s.providerKeys);
    const providerBaseUrls = useAuthStore((s) => s.providerBaseUrls);
    const providerCustomModels = useAuthStore((s) => s.providerCustomModels);
    const setProvider = useAuthStore((s) => s.setProvider);
    const addCustomModel = useAuthStore((s) => s.addCustomModel);
    const inputRef = useRef<HTMLInputElement>(null);

    const configuredProviders = useMemo(
        () => configuredProviderSet(providerKeys, configuredProviderIds, configured, activeProvider),
        [activeProvider, configured, configuredProviderIds, providerKeys],
    );

    const [query, setQuery] = useState(initialQuery);
    const [remoteModels, setRemoteModels] = useState<DisplayModel[]>([]);
    const [currentKey, setCurrentKey] = useState<string | null>(
        activeProvider && activeModelId ? `${activeProvider}/${activeModelId}` : null,
    );
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [loading, setLoading] = useState(true);
    const [selectingKey, setSelectingKey] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    useEffect(() => {
        let live = true;
        void listAvailableModels(runtime())
            .then((available) => {
                if (!live) return;
                setRemoteModels(available.filter((model) => configuredProviders.has(model.provider)));
                setLoading(false);
            })
            .catch((err: unknown) => {
                if (!live) return;
                setError(err instanceof Error ? err.message : String(err));
                setLoading(false);
            });
        return () => {
            live = false;
        };
    }, [configuredProviders, runtime]);

    const instantModels = useMemo<DisplayModel[]>(() => {
        const out: DisplayModel[] = [];
        if (activeProvider && activeModelId && configuredProviders.has(activeProvider)) {
            out.push({ provider: activeProvider, id: activeModelId, instant: true });
        }
        for (const [provider, models] of Object.entries(providerCustomModels)) {
            if (!configuredProviders.has(provider)) continue;
            for (const id of models) out.push({ provider, id, instant: true });
        }
        return out;
    }, [activeModelId, activeProvider, configuredProviders, providerCustomModels]);

    const sorted = useMemo(() => {
        return mergeModels(remoteModels, instantModels).sort((a, b) => {
            const aCurrent = modelKey(a) === currentKey;
            const bCurrent = modelKey(b) === currentKey;
            if (aCurrent && !bCurrent) return -1;
            if (!aCurrent && bCurrent) return 1;
            if (a.manual && !b.manual) return -1;
            if (!a.manual && b.manual) return 1;
            const providerDelta = a.provider.localeCompare(b.provider);
            if (providerDelta !== 0) return providerDelta;
            return a.id.localeCompare(b.id);
        });
    }, [currentKey, instantModels, remoteModels]);

    const manualProvider = activeProvider && configuredProviders.has(activeProvider) ? activeProvider : undefined;
    const manualId = query.trim();
    const manualRow = useMemo<DisplayModel[]>(() => (
        manualProvider && manualId
            ? [{ provider: manualProvider, id: manualId, name: `Use “${manualId}”`, manual: true }]
            : []
    ), [manualId, manualProvider]);

    const filtered = useMemo(() => {
        const actual = filterModels(sorted, query).filter((model) => !model.manual);
        const hasExact = actual.some((model) => model.id === manualId && model.provider === manualProvider);
        return mergeModels(hasExact ? [] : manualRow, actual);
    }, [manualId, manualProvider, manualRow, query, sorted]);
    const selected = filtered[Math.min(selectedIndex, Math.max(0, filtered.length - 1))];

    const choose = async (model: DisplayModel | undefined) => {
        if (!model || selectingKey) return;
        const key = modelKey(model);
        setSelectingKey(key);
        const baseRuntime = runtime();
        const providerCustom = new Set(baseRuntime.providerCustomModels?.[model.provider] ?? []);
        if (model.manual) providerCustom.add(model.id);
        const nextRuntime: PiCommandRuntime = {
            ...baseRuntime,
            providerCustomModels: {
                ...(baseRuntime.providerCustomModels ?? {}),
                [model.provider]: Array.from(providerCustom),
            },
        };
        const res = await setModel(model.provider, model.id, nextRuntime);
        setSelectingKey(null);
        if (!res.ok) {
            setError(`Pi could not switch to ${model.provider}/${model.id}.`);
            return;
        }
        if (model.manual) addCustomModel(model.provider, model.id);
        setProvider(model.provider, model.id);
        setCurrentKey(key);
        onSelected(`Model: ${providerTitle(model.provider)} / ${model.id}`);
    };

    const configuredLabel = Array.from(configuredProviders).map(providerTitle).join(', ') || 'none';

    return (
        <div className="command-bar-models">
            <div className="command-bar-ai-header">
                <button
                    type="button"
                    className="command-bar-ai-back"
                    onClick={onCancel}
                    aria-label="Back to chat"
                >
                    ← Chat
                </button>
                <span className="command-bar-ai-badge">Choose model</span>
            </div>

            <div className="command-bar-models-help">
                <span>Showing configured providers only: {configuredLabel}</span>
                <span>Type a custom model id · ↑↓ choose · Enter switch · Esc back</span>
            </div>

            <input
                ref={inputRef}
                className="command-bar-input command-bar-models-input"
                placeholder={providerBaseUrls[activeProvider ?? '']
                    ? 'Filter or type a custom model id…'
                    : 'Filter configured models…'}
                value={query}
                onChange={(e) => {
                    setQuery(e.target.value);
                    setSelectedIndex(0);
                }}
                onKeyDown={(e) => {
                    if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        setSelectedIndex((i) => Math.min(i + 1, Math.max(0, filtered.length - 1)));
                    } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        setSelectedIndex((i) => Math.max(0, i - 1));
                    } else if (e.key === 'Enter') {
                        e.preventDefault();
                        void choose(selected);
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        onCancel();
                    }
                }}
            />

            <div className="command-bar-models-list" role="listbox" aria-label="Available models">
                {loading && (
                    <div className="command-bar-models-empty">Loading configured provider models…</div>
                )}
                {error && <div className="command-bar-ai-error">{error}</div>}
                {!loading && !error && filtered.length === 0 && (
                    <div className="command-bar-models-empty">
                        {configuredProviders.size === 0
                            ? <>No providers configured. Use <code>/provider</code> first.</>
                            : <>No configured-provider models found. Type a model id to add a custom one.</>}
                    </div>
                )}
                {!error && filtered.map((model, index) => {
                    const isCurrent = modelKey(model) === currentKey;
                    const isSelected = index === selectedIndex;
                    const isSelecting = selectingKey === modelKey(model);
                    return (
                        <button
                            key={`${model.manual ? 'manual:' : ''}${modelKey(model)}`}
                            type="button"
                            className="command-bar-model-row"
                            data-selected={isSelected}
                            data-current={isCurrent}
                            role="option"
                            aria-selected={isSelected}
                            disabled={!!selectingKey}
                            onMouseEnter={() => setSelectedIndex(index)}
                            onClick={() => void choose(model)}
                        >
                            <span className="command-bar-model-main">
                                <span className="command-bar-model-name">{modelLabel(model)}</span>
                                <code>{model.id}</code>
                            </span>
                            <span className="command-bar-model-meta">
                                <span>{providerTitle(model.provider)}</span>
                                {model.manual && <span>add custom</span>}
                                {model.instant && !model.manual && <span>session</span>}
                                {modelSupportsReasoning(model) && <span>reasoning</span>}
                                {isCurrent && <strong>current ✓</strong>}
                                {isSelecting && <span>switching…</span>}
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
