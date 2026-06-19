/**
 * Slash-command catalogue for OpenJammer's embedded Pi chat.
 *
 * Pi RPC exposes extension / prompt / skill commands via `get_commands`, but its
 * built-in TUI commands are intentionally interactive-only. OpenJammer owns the
 * desktop UI for those built-ins, so we keep a small typed registry here and
 * merge it with Pi's dynamic list in `AiPanel`.
 */

import type { PiSlashCommand } from './piSessions';

export type AiSlashCommandSource = 'pi' | 'openjammer' | 'extension' | 'prompt' | 'skill';

export interface AiSlashCommand {
    /** Invoked as `/<name>`. */
    name: string;
    description: string;
    source: AiSlashCommandSource;
    /** Short argument hint, e.g. `<name>` or `[instructions]`. */
    argsHint?: string;
    /** Whether OpenJammer executes this directly instead of forwarding to Pi prompt expansion. */
    local: boolean;
}

export const BUILTIN_AI_SLASH_COMMANDS: readonly AiSlashCommand[] = [
    {
        name: 'new',
        description: 'Start a fresh Pi session.',
        source: 'pi',
        local: true,
    },
    {
        name: 'resume',
        description: 'Pick a previous Pi session to continue.',
        source: 'pi',
        local: true,
    },
    {
        name: 'name',
        description: 'Set the current session display name.',
        source: 'pi',
        argsHint: '<name>',
        local: true,
    },
    {
        name: 'session',
        description: 'Show current session id, name, model, and message count.',
        source: 'pi',
        local: true,
    },
    {
        name: 'compact',
        description: 'Summarize older context to make room.',
        source: 'pi',
        argsHint: '[focus]',
        local: true,
    },
    {
        name: 'copy',
        description: 'Copy the last assistant answer.',
        source: 'pi',
        local: true,
    },
    {
        name: 'login',
        description: 'Alias for /provider — configure who pays for the AI agent.',
        source: 'pi',
        local: true,
    },
    {
        name: 'provider',
        description: 'Configure or replace an AI provider key.',
        source: 'openjammer',
        local: true,
    },
    {
        name: 'logout',
        description: 'Clear the current in-app AI provider key.',
        source: 'pi',
        local: true,
    },
    {
        name: 'model',
        description: 'Open Pi’s model picker.',
        source: 'pi',
        argsHint: '[search]',
        local: true,
    },
    {
        name: 'models',
        description: 'Open Pi’s model picker.',
        source: 'openjammer',
        argsHint: '[search]',
        local: true,
    },
    {
        name: 'settings',
        description: 'Open OpenJammer settings.',
        source: 'openjammer',
        local: true,
    },
    {
        name: 'hotkeys',
        description: 'Show OpenJammer help and keyboard shortcuts.',
        source: 'openjammer',
        local: true,
    },
    {
        name: 'logs',
        description: 'Open the developer log panel.',
        source: 'openjammer',
        local: true,
    },
    {
        name: 'diagnostics',
        description: 'Open audio health diagnostics.',
        source: 'openjammer',
        local: true,
    },
    {
        name: 'reload',
        description: 'Restart the warm Pi child so extensions and prompts reload.',
        source: 'pi',
        local: true,
    },
    {
        name: 'yolo',
        description: 'Ask to enter YOLO mode for the Pi subprocess.',
        source: 'openjammer',
        local: true,
    },
    {
        name: 'safe',
        description: 'Return the Pi subprocess to the default sandboxed mode.',
        source: 'openjammer',
        local: true,
    },
];

export function fromPiSlashCommand(command: PiSlashCommand): AiSlashCommand {
    return {
        name: command.name,
        description: command.description ?? describePiSource(command.source),
        source: command.source,
        local: false,
    };
}

export function sortSlashCommands(commands: readonly AiSlashCommand[]): AiSlashCommand[] {
    const sourceRank: Record<AiSlashCommandSource, number> = {
        pi: 0,
        openjammer: 1,
        extension: 2,
        prompt: 3,
        skill: 4,
    };
    return [...commands].sort((a, b) => {
        const sourceDelta = sourceRank[a.source] - sourceRank[b.source];
        if (sourceDelta !== 0) return sourceDelta;
        return a.name.localeCompare(b.name);
    });
}

export function filterSlashCommands(
    commands: readonly AiSlashCommand[],
    query: string,
): AiSlashCommand[] {
    const q = query.trim().toLowerCase();
    if (!q) return sortSlashCommands(commands);
    return sortSlashCommands(
        commands.filter((command) => {
            const haystack = `${command.name} ${command.description} ${command.source}`.toLowerCase();
            return command.name.toLowerCase().startsWith(q) || haystack.includes(q);
        }),
    );
}

function describePiSource(source: PiSlashCommand['source']): string {
    if (source === 'extension') return 'Pi extension command.';
    if (source === 'prompt') return 'Pi prompt template.';
    return 'Pi skill command.';
}
