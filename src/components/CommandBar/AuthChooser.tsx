/**
 * AuthChooser (D6, M7) — the provider onboarding step inside the Ctrl/Cmd+K AI
 * path.
 *
 * The first Tab→AI before a provider is configured routes HERE (not the agent
 * input). It is a cmdk keyboard-nav chooser (arrow / Enter) over the supported
 * providers; picking one reveals its inline detail (paste-a-key / OAuth). On a
 * successful configure it calls {@link onConfigured} so the panel hands off to the
 * agent input.
 *
 * PROVIDER POLICY (project plan, dated 2026-01-09):
 *   - DEFAULT highlight = **opencode Zen** (a free key), with a NON-DISMISSIBLE
 *     data-training notice during its free period.
 *   - **Codex OAuth** — the clean subscription path (loopback PKCE; founder-gated
 *     native body).
 *   - **Anthropic API key** — labelled "API key — billed per token, NOT your
 *     Pro/Max plan" so nobody mistakes it for a subscription.
 *   - **BYO OpenAI-compatible** — a base URL + key.
 *   - Claude Pro/Max SUBSCRIPTION OAuth is NOT shown / NOT a default option
 *     (Anthropic prohibits it in third-party tools). It is intentionally absent.
 *
 * Auth resolves only WHO PAYS — it grants the agent no new power. The store
 * ({@link useAuthStore}) NEVER persists the key.
 */

import { useCallback, useMemo, useState } from 'react';
import { Command } from 'cmdk';
import { Button, Input } from '@openjammer/oj-ui';
import { useAuthStore } from '../../auth/authStore';
import { AI_PROVIDERS, providerTitle, type ProviderOption } from '../../auth/providers';
import { openExternal } from '../../ai/tauri';

/** The opencode Zen free-key page opened in the system browser. */
const OPENCODE_AUTH_URL = 'https://opencode.ai/auth';

interface AuthChooserProps {
    /** Called once a provider is successfully configured (hands off to the agent). */
    onConfigured: () => void;
    /** Return to search mode (Esc / Back). */
    onBack: () => void;
}

export function AuthChooser({ onConfigured, onBack }: AuthChooserProps) {
    // The currently expanded provider (its detail panel is shown). Null = the list.
    const activeProvider = useAuthStore((s) => s.activeProvider);
    const configured = useAuthStore((s) => s.configured);
    const configuredProviderIds = useAuthStore((s) => s.configuredProviderIds);
    const configuredProviders = useMemo(() => {
        const ids = new Set(configuredProviderIds);
        if (configured && activeProvider) ids.add(activeProvider);
        return ids;
    }, [activeProvider, configured, configuredProviderIds]);
    const initialProvider = activeProvider ?? AI_PROVIDERS[0].id;
    const [selected, setSelected] = useState<ProviderOption | null>(null);
    const [value, setValue] = useState(initialProvider); // default highlight = active provider or opencode Zen

    if (selected) {
        return (
            <ProviderDetail
                provider={selected}
                onCancel={() => setSelected(null)}
                onConfigured={onConfigured}
            />
        );
    }

    return (
        <div className="command-bar-auth" data-testid="auth-chooser">
            <div className="command-bar-ai-header">
                <Button
                    variant="ghost"
                    onClick={onBack}
                    aria-label="Back to search"
                >
                    ← Search
                </Button>
                <span className="command-bar-ai-badge">Configure AI provider</span>
            </div>
            {configured && activeProvider ? (
                <div className="command-bar-auth-configured" role="status">
                    <span>Configured: <strong>{providerTitle(activeProvider)}</strong></span>
                    <span>Esc keeps it · Enter reconfigures the highlighted provider</span>
                </div>
            ) : (
                <p className="command-bar-auth-intro">
                    Choose who pays for the AI agent. This only sets the provider — every edit
                    is still an undoable OpenJammer canvas action.
                </p>
            )}
            <Command label="Choose AI provider" value={value} onValueChange={setValue} loop>
                {/*
                 * cmdk drives ↑/↓ navigation + Enter through its INPUT; without one
                 * the list is unfocusable and the keyboard does nothing (the bug).
                 * autoFocus so arrows/Enter work the moment the chooser opens.
                 */}
                <Command.Input
                    autoFocus
                    className="command-bar-input"
                    placeholder="Filter providers…  (↑ ↓ to navigate, Enter to choose)"
                    onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                            e.preventDefault();
                            onBack();
                        }
                    }}
                />
                <Command.List className="command-bar-list">
                    <Command.Empty className="command-bar-empty">
                        No providers match.
                    </Command.Empty>
                    {AI_PROVIDERS.map((p) => (
                        <Command.Item
                            key={p.id}
                            value={p.id}
                            keywords={[p.title, p.subtitle]}
                            className="command-bar-item command-bar-auth-item"
                            onSelect={() => setSelected(p)}
                        >
                            <span className="command-bar-auth-item-title">
                                {p.title}
                                {configuredProviders.has(p.id) && (
                                    <span className="command-bar-auth-configured-mark">configured</span>
                                )}
                            </span>
                            <span className="command-bar-auth-item-subtitle">
                                {configuredProviders.has(p.id)
                                    ? 'Already configured — press Enter to replace the key'
                                    : p.subtitle}
                            </span>
                        </Command.Item>
                    ))}
                </Command.List>
            </Command>
        </div>
    );
}

/** The inline detail for one provider: key paste (Zen/Anthropic/OpenAI) or OAuth (Codex). */
function ProviderDetail({
    provider,
    onCancel,
    onConfigured,
}: {
    provider: ProviderOption;
    onCancel: () => void;
    onConfigured: () => void;
}) {
    const storeKey = useAuthStore((s) => s.storeKey);
    const validateKey = useAuthStore((s) => s.validateKey);
    const beginOAuth = useAuthStore((s) => s.beginOAuth);
    const setProvider = useAuthStore((s) => s.setProvider);
    const configured = useAuthStore((s) => s.configuredProviderIds.includes(provider.id) || (s.configured && s.activeProvider === provider.id));

    const [key, setKey] = useState('');
    const [baseUrl, setBaseUrl] = useState('');
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<string | null>(null);

    const isOAuth = provider.id === 'codex';
    const isOpenAiCompatible = provider.id === 'openai';
    const isZen = provider.id === 'opencode';

    const submitKey = useCallback(async () => {
        if (!key.trim() || busy) return;
        setBusy(true);
        setMessage(null);
        setProvider(provider.id);
        // BYO OpenAI-compatible providers carry a base URL; forward it (transient,
        // never persisted) so it is not silently dropped at the auth seam.
        const url = isOpenAiCompatible ? baseUrl.trim() || undefined : undefined;
        // Validate best-effort. A DEFINITIVE rejection blocks; but when validation
        // is unavailable in this build (founder-gated HTTP round-trip), we proceed
        // to store — a wrong key then surfaces as a clear error on the first run.
        const validation = await validateKey(provider.id, key.trim(), url);
        if (!validation.ok && !validation.notConfigured) {
            setBusy(false);
            setMessage(validation.message ?? 'That key was rejected.');
            return;
        }
        const stored = await storeKey(provider.id, key.trim(), url);
        setBusy(false);
        if (stored.ok) {
            onConfigured();
        } else {
            setMessage(stored.message ?? 'Could not store the key.');
        }
    }, [key, busy, provider.id, isOpenAiCompatible, baseUrl, setProvider, validateKey, storeKey, onConfigured]);

    const startOAuth = useCallback(async () => {
        if (busy) return;
        setBusy(true);
        setMessage(null);
        const res = await beginOAuth(provider.id);
        setBusy(false);
        if (res.ok) onConfigured();
        else setMessage(res.message ?? 'OAuth is not available in this build.');
    }, [busy, provider.id, beginOAuth, onConfigured]);

    return (
        <div className="command-bar-auth" data-testid="auth-detail">
            <div className="command-bar-ai-header">
                <Button
                    variant="ghost"
                    onClick={onCancel}
                    aria-label="Back to providers"
                >
                    ← Providers
                </Button>
                <span className="command-bar-ai-badge">{provider.title}</span>
            </div>

            {configured && (
                <p className="command-bar-auth-hint">
                    {provider.title} is already configured. Press Esc to keep it, or enter a new key to replace it.
                </p>
            )}

            {isZen && (
                <>
                    <Button
                        variant="link"
                        className="command-bar-auth-link"
                        onClick={() => void openExternal(OPENCODE_AUTH_URL)}
                    >
                        Get your free key →
                    </Button>
                    {/* NON-DISMISSIBLE data-training notice (free period). */}
                    <p className="command-bar-auth-notice" role="note">
                        During its free period, collected data may be used to improve the
                        model - do not submit personal or confidential data
                    </p>
                </>
            )}

            {provider.id === 'anthropic' && (
                <p className="command-bar-auth-hint">
                    API key - billed per token, NOT your Pro/Max plan.
                </p>
            )}

            {provider.id === 'openrouter' && (
                <p className="command-bar-auth-hint">
                    Paste an OpenRouter key. Then use <code>/models</code> to pick only OpenRouter models.
                </p>
            )}

            {isOpenAiCompatible && (
                <p className="command-bar-auth-hint">
                    Paste a base URL + key. In <code>/models</code>, type a model id and press Enter to add it.
                </p>
            )}

            {isOAuth ? (
                <Button
                    variant="primary"
                    onClick={() => void startOAuth()}
                    disabled={busy}
                >
                    Sign in with Codex
                </Button>
            ) : (
                <>
                    {isOpenAiCompatible && (
                        <Input
                            className="command-bar-auth-input"
                            placeholder="Base URL (e.g. https://api.example.com/v1)"
                            value={baseUrl}
                            onChange={(e) => setBaseUrl(e.target.value)}
                            disabled={busy}
                        />
                    )}
                    <Input
                        autoFocus
                        className="command-bar-auth-input"
                        type="password"
                        placeholder="Paste your API key, then press Enter…"
                        value={key}
                        onChange={(e) => setKey(e.target.value)}
                        disabled={busy}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                void submitKey();
                            } else if (e.key === 'Escape') {
                                e.preventDefault();
                                onCancel();
                            }
                        }}
                    />
                    <Button
                        variant="primary"
                        onClick={() => void submitKey()}
                        disabled={busy || !key.trim()}
                    >
                        Save key
                    </Button>
                </>
            )}

            {message && <p className="command-bar-ai-error">{message}</p>}
        </div>
    );
}
