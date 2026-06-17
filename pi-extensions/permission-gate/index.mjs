/**
 * permission-gate — the in-Pi DEFAULT-sandbox extension (Phase 2).
 *
 * Loaded into the agent's Pi home (`settings.json` `packages[]`) in jailed mode and
 * UNLOADED in YOLO. It vetoes tool calls before they execute (Pi's `tool_call`
 * hook returns `{ block: true }`, the only reliable pre-exec point — Pi has no host
 * pre-exec hook) and redacts the provider key from results.
 *
 * The decisions live in {@link ./policy.mjs} (pure + unit-tested). This file is the
 * thin glue to Pi's extension surface; it reads the jail boundary from the env the
 * Rust host sets at spawn:
 *   - OJ_PROJECT_ROOT   — the write-jail boundary (the open project folder)
 *   - OJ_MEMORY_ROOTS   — `:`-separated extra writable roots (pi-memory, sessions)
 *   - OJ_KEY_VAR        — the name of the env var holding the provider key to redact
 *
 * NOTE: this is the cooperative belt on top of the OS jail, which is the hard
 * guarantee. If a future Pi renames the tool/event shape, the OS jail still holds;
 * this layer degrades to "allow" only for shape it doesn't recognise, never for a
 * path/command it recognises as out-of-jail.
 */

import {
    isCommandAllowed,
    isPathInsideJail,
    isProtectedConfigPath,
    redactSecret,
} from './policy.mjs';

/** Tool names that run a shell command (vet the command string). */
const BASH_TOOLS = new Set(['bash', 'shell', 'run', 'exec', 'sh']);
/** Tool names that write to the filesystem (vet the destination path). */
const WRITE_TOOLS = new Set(['write', 'edit', 'create', 'apply_patch', 'write_file', 'str_replace']);

/** Pull the command string out of a tool-call input across plausible shapes. */
function commandOf(input) {
    return input?.command ?? input?.cmd ?? input?.script ?? input?.input ?? '';
}
/** Pull the write target path out of a tool-call input across plausible shapes. */
function pathOf(input) {
    return input?.path ?? input?.file ?? input?.filename ?? input?.target ?? '';
}

function jailConfig(env = process.env) {
    const projectRoot = env.OJ_PROJECT_ROOT || '';
    const memoryRoots = (env.OJ_MEMORY_ROOTS || '').split(':').filter(Boolean);
    const secret = env.OJ_KEY_VAR ? env[env.OJ_KEY_VAR] || '' : '';
    return { writableRoots: [projectRoot, ...memoryRoots].filter(Boolean), secret };
}

/**
 * The veto decision for one tool call. Exported so it is testable too: returns
 * `{ block, reason }`. `null`/allow for shapes it does not police (the OS jail
 * remains the backstop for those).
 */
export function vetoToolCall(toolName, input, cfg) {
    const name = String(toolName || '').toLowerCase();

    if (BASH_TOOLS.has(name)) {
        const verdict = isCommandAllowed(commandOf(input));
        return verdict.allowed ? null : { block: true, reason: verdict.reason };
    }

    if (WRITE_TOOLS.has(name)) {
        const target = pathOf(input);
        if (!target) return null;
        if (isProtectedConfigPath(target)) {
            return { block: true, reason: 'writing the agent config/extensions is not allowed (it would drop the sandbox)' };
        }
        if (cfg.writableRoots.length && !isPathInsideJail(target, cfg.writableRoots)) {
            return { block: true, reason: `writes are jailed to the project folder; '${target}' is outside it` };
        }
    }

    return null;
}

/**
 * Pi extension entry point. Registers the pre-exec veto and the result redactor.
 * Written to Pi's documented `ctx.on('tool_call'|'tool_result', …)` surface; the
 * gate MUST be the last handler so it re-reads the final (possibly-mutated) input.
 */
export default function register(ctx) {
    const cfg = jailConfig();

    ctx.on('tool_call', (event) => {
        // Re-derive from the FINAL input (a prior handler may have mutated it).
        const verdict = vetoToolCall(event?.tool ?? event?.toolName, event?.input ?? event?.args, cfg);
        if (verdict) return verdict; // { block: true, reason }
    });

    if (cfg.secret) {
        ctx.on('tool_result', (event) => {
            const out = event?.output ?? event?.result;
            if (typeof out === 'string') {
                return { output: redactSecret(out, cfg.secret) };
            }
        });
    }
}
