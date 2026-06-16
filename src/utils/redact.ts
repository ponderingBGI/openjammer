/**
 * Redaction for the one-click issue reporter (L5).
 *
 * The diagnostic snapshot itself is built fail-CLOSED — `diagnostics.ts` only
 * ever includes an ALLOWLIST of known-safe fields, so no secret can leak through
 * it by construction. This module is the second line of defence for the part we
 * do NOT control: the attached DevLog tail, whose free-form messages + structured
 * fields are produced all over the app and could incidentally carry a secret, a
 * home-directory path, or a LAN peer address. Every string that goes into a
 * report passes through {@link redactText} first.
 *
 * The patterns are pinned to the VERIFIED secret-handling anchor on the native
 * side: `src-tauri/src/ai.rs` forwards the single provider key under the env var
 * named by `OPENJAMMER_AI_KEY_VAR` (default `OPENJAMMER_PROVIDER_KEY`), so those
 * exact names are redacted here. We also scrub the generic shapes a leak most
 * often takes (labelled key/token/secret assignments, `Bearer` headers, `sk-…`
 * provider keys), home-dir path prefixes, and IPv4 addresses (LAN peers).
 *
 * Redaction is intentionally conservative-to-over-redact: a false positive
 * (scrubbing something harmless) is acceptable; a false negative (leaking a
 * secret into a public GitHub issue) is not.
 */

/** The single placeholder every redaction collapses to, so the output is obvious. */
const MASK = '«redacted»';

/**
 * The provider-key env-var names from `src-tauri/src/ai.rs` (`stripped_env`): the
 * key is forwarded under the var named by `OPENJAMMER_AI_KEY_VAR`, defaulting to
 * `OPENJAMMER_PROVIDER_KEY`. Pinned here so the redactor tracks that anchor.
 */
export const SECRET_ENV_VARS = ['OPENJAMMER_PROVIDER_KEY', 'OPENJAMMER_AI_KEY_VAR'] as const;

type Replacer = (match: string, ...groups: string[]) => string;

// Ordered (pattern, replacer) rules. Applied in sequence; earlier, more specific
// rules run before broader ones.
const RULES: readonly { re: RegExp; fn: Replacer }[] = [
    // Home-directory prefixes -> scrub just the user segment, keep the structure.
    //   C:\Users\milo\…  ->  C:\Users\«redacted»\…
    { re: /([A-Za-z]:\\Users\\)[^\\/\s"'<>|]+/g, fn: (_m, p1) => p1 + MASK },
    //   /Users/milo/… (macOS) and /home/milo/… (Linux)
    { re: /(\/(?:Users|home)\/)[^/\s"'<>|]+/g, fn: (_m, p1) => p1 + MASK },

    // The verified provider-key env vars, in `NAME=value` / `NAME: value` form.
    {
        re: new RegExp(`\\b(${SECRET_ENV_VARS.join('|')})\\s*[=:]\\s*\\S+`, 'gi'),
        fn: (_m, p1) => `${p1}=${MASK}`,
    },

    // Labelled secret assignments: api_key / apikey / secret / token / password /
    // passwd / pwd / auth(_token) = <value>  (quotes optional).
    {
        re: /\b(api[_-]?key|secret|token|password|passwd|pwd|auth(?:[_-]?token)?)\b\s*[=:]\s*"?[^\s"'<>,;]+"?/gi,
        fn: (_m, p1) => `${p1}=${MASK}`,
    },

    // `Authorization: Bearer <jwt>` and bare `Bearer <token>`.
    { re: /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, fn: () => `Bearer ${MASK}` },

    // Provider-style API keys (OpenAI `sk-…`, Anthropic `sk-ant-…`, etc.).
    { re: /\bsk-[A-Za-z0-9_-]{6,}/g, fn: () => MASK },

    // IPv4 addresses (LAN peer ids) — keep loopback / unspecified, which are not
    // identifying and are useful diagnostics.
    {
        re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
        fn: (m) => (m === '127.0.0.1' || m === '0.0.0.0' ? m : MASK),
    },
];

/**
 * Scrub a single string of secrets, home-dir prefixes, and LAN addresses. Safe to
 * call on any user-facing or logged text before it leaves the app.
 */
export function redactText(input: string): string {
    let out = input;
    for (const rule of RULES) out = out.replace(rule.re, rule.fn);
    return out;
}

/**
 * Recursively redact a JSON-ish value (string / array / object), returning a new
 * value with every string scrubbed via {@link redactText}. Non-string scalars are
 * returned unchanged. Used to sanitize a {@link import('../store/logStore').LogFields}
 * blob before it is serialized into a report.
 */
export function redactValue(value: unknown): unknown {
    if (typeof value === 'string') return redactText(value);
    if (Array.isArray(value)) return value.map(redactValue);
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) out[k] = redactValue(v);
        return out;
    }
    return value;
}
