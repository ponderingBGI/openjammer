import { useEffect, useMemo, useRef, useState } from 'react';
import { providerTitle } from '../../auth/providers';
import { useAuthStore } from '../../auth/authStore';
import {
    getState,
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

function modelKey(model: PiModel): string {
    return `${model.provider}/${model.id}`;
}

function modelLabel(model: PiModel): string {
    return typeof model.name === 'string' && model.name.trim() ? model.name : model.id;
}

function modelSupportsReasoning(model: PiModel): boolean {
    return !!model.reasoning;
}

function filterModels(models: readonly PiModel[], query: string): PiModel[] {
    const q = query.trim().toLowerCase();
    if (!q) return [...models];
    return models.filter((model) => {
        const haystack = `${model.provider} ${model.id} ${model.name ?? ''} ${model.provider}/${model.id}`.toLowerCase();
        return haystack.includes(q);
    });
}

export function ModelPicker({ runtime, initialQuery = '', onSelected, onCancel }: ModelPickerProps) {
    const activeProvider = useAuthStore((s) => s.activeProvider);
    const activeModelId = useAuthStore((s) => s.modelId);
    const setProvider = useAuthStore((s) => s.setProvider);
    const inputRef = useRef<HTMLInputElement>(null);

    const [query, setQuery] = useState(initialQuery);
    const [models, setModels] = useState<PiModel[]>([]);
    const [currentKey, setCurrentKey] = useState<string | null>(
        activeProvider && activeModelId ? `${activeProvider}/${activeModelId}` : null,
    );
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    useEffect(() => {
        let live = true;
        void Promise.all([listAvailableModels(runtime()), getState(runtime())])
            .then(([available, state]) => {
                if (!live) return;
                const stateModel = state.data && typeof state.data === 'object'
                    ? (state.data as { model?: unknown }).model
                    : null;
                if (stateModel && typeof stateModel === 'object') {
                    const m = stateModel as { provider?: unknown; id?: unknown; modelId?: unknown };
                    const provider = typeof m.provider === 'string' ? m.provider : null;
                    const id = typeof m.id === 'string'
                        ? m.id
                        : typeof m.modelId === 'string'
                            ? m.modelId
                            : null;
                    if (provider && id) setCurrentKey(`${provider}/${id}`);
                }
                setModels(available);
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
    }, [runtime]);

    const sorted = useMemo(() => {
        return [...models].sort((a, b) => {
            const aCurrent = modelKey(a) === currentKey;
            const bCurrent = modelKey(b) === currentKey;
            if (aCurrent && !bCurrent) return -1;
            if (!aCurrent && bCurrent) return 1;
            const providerDelta = a.provider.localeCompare(b.provider);
            if (providerDelta !== 0) return providerDelta;
            return a.id.localeCompare(b.id);
        });
    }, [currentKey, models]);

    const filtered = useMemo(() => filterModels(sorted, query), [query, sorted]);
    const selected = filtered[Math.min(selectedIndex, Math.max(0, filtered.length - 1))];

    const choose = async (model: PiModel | undefined) => {
        if (!model) return;
        setLoading(true);
        const res = await setModel(model.provider, model.id, runtime());
        setLoading(false);
        if (!res.ok) {
            setError(`Pi could not switch to ${model.provider}/${model.id}.`);
            return;
        }
        setProvider(model.provider, model.id);
        setCurrentKey(modelKey(model));
        onSelected(`Model: ${providerTitle(model.provider)} / ${model.id}`);
    };

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
                <span>Models come from Pi’s configured providers.</span>
                <span>↑↓ choose · Enter switch · Esc back</span>
            </div>

            <input
                ref={inputRef}
                className="command-bar-input command-bar-models-input"
                placeholder="Filter models… e.g. opus, gpt, zen"
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
                {loading && <div className="command-bar-models-empty">Starting Pi and loading models…</div>}
                {!loading && error && <div className="command-bar-ai-error">{error}</div>}
                {!loading && !error && filtered.length === 0 && (
                    <div className="command-bar-models-empty">
                        No models found. Use <code>/provider</code> to configure another provider.
                    </div>
                )}
                {!loading && !error && filtered.map((model, index) => {
                    const isCurrent = modelKey(model) === currentKey;
                    const isSelected = index === selectedIndex;
                    return (
                        <button
                            key={modelKey(model)}
                            type="button"
                            className="command-bar-model-row"
                            data-selected={isSelected}
                            data-current={isCurrent}
                            role="option"
                            aria-selected={isSelected}
                            onMouseEnter={() => setSelectedIndex(index)}
                            onClick={() => void choose(model)}
                        >
                            <span className="command-bar-model-main">
                                <span className="command-bar-model-name">{modelLabel(model)}</span>
                                <code>{model.id}</code>
                            </span>
                            <span className="command-bar-model-meta">
                                <span>{providerTitle(model.provider)}</span>
                                {modelSupportsReasoning(model) && <span>reasoning</span>}
                                {isCurrent && <strong>current ✓</strong>}
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
