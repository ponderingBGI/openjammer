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

import { useCallback, useState } from 'react';
import { Command } from 'cmdk';
import { useAuthStore } from '../../auth/authStore';
import { openExternal } from '../../ai/tauri';

/** A selectable provider row. */
interface ProviderOption {
    /** Stable provider id (matches the store + the Rust env-var mapping). */
    id: string;
    /** Display title. */
    title: string;
    /** Short subtitle shown under the title. */
    subtitle: string;
}

/**
 * The offered providers, in display order. opencode Zen is FIRST so it is the
 * default highlight. Claude Pro/Max subscription OAuth is deliberately ABSENT.
 */
const PROVIDERS: readonly ProviderOption[] = [
    {
        id: 'opencode',
        title: 'opencode Zen',
        subtitle: 'Free key — recommended to get started',
    },
    {
        id: 'codex',
        title: 'Codex (OAuth)',
        subtitle: 'Sign in with your subscription — the clean subscription path',
    },
    {
        id: 'anthropic',
        title: 'Anthropic',
        subtitle: 'API key — billed per token, NOT your Pro/Max plan',
    },
    {
        id: 'openai',
        title: 'BYO OpenAI-compatible',
        subtitle: 'Your own base URL + API key',
    },
];

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
    const [selected, setSelected] = useState<ProviderOption | null>(null);
    const [value, setValue] = useState(PROVIDERS[0].id); // default highlight = opencode Zen

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
                <button
                    type="button"
                    className="command-bar-ai-back"
                    onClick={onBack}
                    aria-label="Back to search"
                >
                    ← Search
                </button>
                <span className="command-bar-ai-badge">Configure AI provider</span>
            </div>
            <p className="command-bar-auth-intro">
                Choose who pays for the AI agent. This only sets the provider — every edit
                still applies behind your Approve / Reject.
            </p>
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
                    {PROVIDERS.map((p) => (
                        <Command.Item
                            key={p.id}
                            value={p.id}
                            keywords={[p.title, p.subtitle]}
                            className="command-bar-item command-bar-auth-item"
                            onSelect={() => setSelected(p)}
                        >
                            <span className="command-bar-auth-item-title">{p.title}</span>
                            <span className="command-bar-auth-item-subtitle">{p.subtitle}</span>
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
                <button
                    type="button"
                    className="command-bar-ai-back"
                    onClick={onCancel}
                    aria-label="Back to providers"
                >
                    ← Providers
                </button>
                <span className="command-bar-ai-badge">{provider.title}</span>
            </div>

            {isZen && (
                <>
                    <button
                        type="button"
                        className="command-bar-auth-link"
                        onClick={() => void openExternal(OPENCODE_AUTH_URL)}
                    >
                        Get your free key →
                    </button>
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

            {isOAuth ? (
                <button
                    type="button"
                    className="command-bar-ai-approve"
                    onClick={() => void startOAuth()}
                    disabled={busy}
                >
                    Sign in with Codex
                </button>
            ) : (
                <>
                    {isOpenAiCompatible && (
                        <input
                            className="command-bar-input command-bar-auth-input"
                            placeholder="Base URL (e.g. https://api.example.com/v1)"
                            value={baseUrl}
                            onChange={(e) => setBaseUrl(e.target.value)}
                            disabled={busy}
                        />
                    )}
                    <input
                        autoFocus
                        className="command-bar-input command-bar-auth-input"
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
                    <button
                        type="button"
                        className="command-bar-ai-approve"
                        onClick={() => void submitKey()}
                        disabled={busy || !key.trim()}
                    >
                        Save key
                    </button>
                </>
            )}

            {message && <p className="command-bar-ai-error">{message}</p>}
        </div>
    );
}
