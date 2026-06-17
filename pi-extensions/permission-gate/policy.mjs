/**
 * permission-gate — the DEFAULT-sandbox policy (Phase 2, the in-Pi layer).
 *
 * The OS jail (Landlock/Seatbelt/Job-Object, applied by the Rust host at spawn) is
 * the hard guarantee that the agent cannot read/write outside the project folder.
 * THIS layer rides on top of it inside Pi to do what an OS FS-jail cannot: police
 * WHICH shell commands run (a default-deny allowlist), keep file *arguments* inside
 * the jail, and redact the provider key from any output before it re-enters the
 * model's context.
 *
 * These are PURE functions so the security-critical decisions are unit-tested
 * without the Pi runtime (`policy.test.mjs`). `index.mjs` wires them to Pi's
 * `tool_call` veto + `tool_result` filter.
 *
 * Threat model this closes (from the research critique):
 * - command chaining to escape the allowlist (`ls; curl evil`) → every segment is
 *   checked, and chaining/substitution operators are themselves denied.
 * - reading secrets into context (`cat ~/.pi/auth.json`, `echo $KEY`) → file args
 *   are jailed AND the key value is redacted from results.
 * - dropping the gate (`/reload` after editing settings.json) → settings/packages
 *   are denied write targets here, and the OS jail backstops it regardless.
 */

/** Commands the agent may run in DEFAULT (jailed) mode — navigate, read, search,
 *  transform WITHIN the project. Anything not here is denied (default-deny). */
export const DEFAULT_ALLOWLIST = new Set([
    'cd', 'ls', 'pwd', 'mkdir', 'touch', 'find', 'grep', 'rg', 'sed', 'awk',
    'echo', 'cat', 'head', 'tail', 'wc', 'sort', 'uniq', 'cut', 'tr', 'basename',
    'dirname', 'realpath', 'stat', 'diff', 'cp', 'mv', 'true', 'false', 'test',
]);

/** Always denied, even if an allowlist ever grows to include them — these have no
 *  safe form inside a jail (privilege, network, mass-delete, perms). */
export const HARD_DENY = new Set([
    'sudo', 'su', 'doas', 'ssh', 'scp', 'sftp', 'curl', 'wget', 'nc', 'ncat',
    'telnet', 'dd', 'rm', 'rmdir', 'chmod', 'chown', 'kill', 'pkill', 'mount',
    'shutdown', 'reboot', 'systemctl', 'launchctl', 'crontab', 'eval', 'exec',
]);

/**
 * Operators that chain or redirect to ANOTHER command/file. We split on them to
 * vet every segment, and the presence of substitution/background operators is
 * itself disqualifying (they can smuggle a denied command).
 */
const SEGMENT_SPLIT = /[;\n]|\|\||&&|\||(?<!\d)>|<|&(?!&)/g;
const SMUGGLE = /\$\(|`|<\(|>\(/; // command substitution / process substitution

/** Split a compound command line into its individual command segments. */
export function commandSegments(line) {
    return String(line)
        .split(SEGMENT_SPLIT)
        .map((s) => s.trim())
        .filter(Boolean);
}

/** The leading executable of a single command segment (strips env-assignments). */
export function leadingBinary(segment) {
    const tokens = segment.trim().split(/\s+/);
    // Skip leading `VAR=val` assignments (e.g. `FOO=1 cmd`).
    let i = 0;
    while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i++;
    const bin = tokens[i] ?? '';
    // A path like /usr/bin/curl or ./script — reduce to the basename for the check.
    return bin.split('/').pop() ?? bin;
}

/**
 * Decide whether a bash command line is allowed in jailed mode. Default-deny:
 * EVERY segment's leading binary must be in `allow` and never in HARD_DENY, and
 * the line must contain no command/process substitution.
 */
export function isCommandAllowed(line, allow = DEFAULT_ALLOWLIST) {
    const text = String(line);
    if (SMUGGLE.test(text)) {
        return { allowed: false, reason: 'command substitution is not allowed in jailed mode' };
    }
    const segments = commandSegments(text);
    if (segments.length === 0) {
        return { allowed: false, reason: 'empty command' };
    }
    for (const seg of segments) {
        const bin = leadingBinary(seg);
        if (HARD_DENY.has(bin)) {
            return { allowed: false, reason: `'${bin}' is never allowed in jailed mode` };
        }
        if (!allow.has(bin)) {
            return {
                allowed: false,
                reason: `'${bin}' is not in the jailed allowlist (toggle YOLO for full shell)`,
            };
        }
    }
    return { allowed: true };
}

/** Normalize a path for containment checks (no symlink resolution — the real
 *  extension also realpaths; the OS jail is the hard backstop either way). */
function normalize(p) {
    const parts = String(p).split('/');
    const out = [];
    for (const part of parts) {
        if (part === '' || part === '.') continue;
        if (part === '..') out.pop();
        else out.push(part);
    }
    return '/' + out.join('/');
}

/**
 * Whether `target` resolves inside one of the writable `roots`. Used to jail the
 * destination of any write/edit tool (and file args of bash) to the project folder
 * + the agent's own memory — NEVER its settings/packages/extensions.
 */
export function isPathInsideJail(target, roots) {
    const t = normalize(target);
    return roots.some((root) => {
        const r = normalize(root);
        return t === r || t.startsWith(r + '/');
    });
}

/** Paths inside the agent home that must stay read-only even though memory is
 *  writable — writing these would let the agent drop its own gate. */
export function isProtectedConfigPath(target) {
    const t = normalize(target);
    return /\/\.pi\/agent\/(settings\.json|extensions|packages)(\/|$)/.test(t);
}

/**
 * Redact every occurrence of the provider key from tool output before it re-enters
 * the model context. A no-op when there is no key or it is implausibly short
 * (avoid redacting common substrings).
 */
export function redactSecret(text, secret) {
    if (!secret || secret.length < 12) return text;
    return String(text).split(secret).join('‹redacted›');
}
