/** Provider metadata for the in-app AI auth/model surfaces. */

export interface ProviderOption {
    /** Stable provider id (matches Rust env-var mapping and Pi provider ids). */
    id: string;
    /** Display title. */
    title: string;
    /** Short subtitle shown under the title. */
    subtitle: string;
}

/**
 * Offered providers, in display order. opencode Zen is first so fresh installs
 * default to the lowest-friction path.
 */
export const AI_PROVIDERS: readonly ProviderOption[] = [
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
        id: 'openrouter',
        title: 'OpenRouter',
        subtitle: 'API key — broad OpenAI-compatible model marketplace',
    },
    {
        id: 'openai',
        title: 'BYO OpenAI-compatible',
        subtitle: 'Your own base URL + API key',
    },
];

export function providerTitle(id?: string): string {
    if (!id) return 'None';
    return AI_PROVIDERS.find((provider) => provider.id === id)?.title ?? id;
}
