/**
 * CommandBar (U19 + U20) — Raycast-style Ctrl/Cmd+K command palette.
 *
 * Rendered once at the app root. Owns its own open/close state and the global
 * Ctrl/Cmd+K toggle. Built from cmdk's primitives (`Command`, `Command.Input`,
 * `Command.List`, ...) rendered INSIDE this repo's existing overlay/portal
 * pattern (see SettingsPanel) — deliberately NOT `Command.Dialog`, to avoid
 * pulling in the Radix Dialog subtree.
 *
 * TWO MODES:
 * - 'search' (U19): the command registry, filtered by cmdk.
 * - 'ai' (U20): press Tab from search to hand the typed text to the AI agent.
 *   The agent half renders in {@link AiPanel}: a streaming transcript with an
 *   Approve / Reject transaction, or the "AI requires the desktop app" state in
 *   a plain browser. The handoff is the only structural change to this file.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Command } from 'cmdk';
import { getCommands, subscribe } from '../../store/commandRegistry';
import type { Command as RegistryCommand } from '../../store/commandRegistry';
import { useCommandSources } from './useCommandSources';
import { AiPanel } from './AiPanel';
import { useAgentSessionStore } from '../../store/agentSessionStore';
import './CommandBar.css';

/** Bar mode: 'search' (U19, the command registry) or 'ai' (U20, the agent). */
type CommandBarMode = 'search' | 'ai';

/** Group the flat registry list into stable, label-keyed buckets for rendering. */
function groupCommands(commands: readonly RegistryCommand[]): [string, RegistryCommand[]][] {
    const groups = new Map<string, RegistryCommand[]>();
    for (const command of commands) {
        const bucket = groups.get(command.group);
        if (bucket) bucket.push(command);
        else groups.set(command.group, [command]);
    }
    return Array.from(groups.entries());
}

export function CommandBar() {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [mode, setMode] = useState<CommandBarMode>('search');
    // Text carried from the search input into AI mode on the Tab handoff.
    const [aiPrompt, setAiPrompt] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    // Register node-add + app-action commands while mounted.
    useCommandSources();

    // Subscribe to the registry so newly-registered commands (e.g. AI-authored
    // DSP nodes) re-render the open palette live.
    const [commands, setCommands] = useState<readonly RegistryCommand[]>(getCommands);
    useEffect(() => subscribe(() => setCommands(getCommands())), []);

    const close = useCallback(() => {
        setOpen(false);
        setSearch('');
        setMode('search');
        setAiPrompt('');
        // Drop any in-flight / pending agent transaction when the bar closes.
        useAgentSessionStore.getState().reset();
    }, []);

    // Hand the typed text off to AI mode (Tab from search, or the "Ask AI" item).
    const enterAiMode = useCallback(() => {
        setAiPrompt(search);
        setMode('ai');
    }, [search]);

    // Return from AI mode to search, discarding any pending agent transaction.
    const backToSearch = useCallback(() => {
        useAgentSessionStore.getState().reset();
        setMode('search');
    }, []);

    // Global Ctrl/Cmd+K toggle. MUST early-return when the palette is already
    // open/focused so the handler doesn't fight the in-palette key handling
    // (cmdk owns arrow/enter/escape once focus is inside).
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            const isToggle = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k';
            if (!isToggle) return;

            // Early-return when open/focused: let the palette handle its own keys
            // (Escape closes it from inside via onOpenChange-style handling below).
            if (open) return;

            e.preventDefault();
            setOpen(true);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [open]);

    // Focus the search input whenever the palette opens or returns to search.
    useEffect(() => {
        if (open && mode === 'search') inputRef.current?.focus();
    }, [open, mode]);

    const runCommand = useCallback((command: RegistryCommand) => {
        close();
        command.run();
    }, [close]);

    if (!open) return null;

    const grouped = groupCommands(commands);

    return createPortal(
        <div className="command-bar-overlay" onClick={close}>
            <div
                className="command-bar-container"
                onClick={(e) => e.stopPropagation()}
                data-mode={mode}
            >
                {mode === 'ai' ? (
                    <AiPanel
                        initialPrompt={aiPrompt}
                        onBack={backToSearch}
                        onClose={close}
                    />
                ) : (
                    <Command label="Command Palette" loop>
                        <Command.Input
                            ref={inputRef}
                            className="command-bar-input"
                            placeholder="Search commands… (Tab to ask AI)"
                            value={search}
                            onValueChange={setSearch}
                            onKeyDown={(e) => {
                                if (e.key === 'Escape') {
                                    e.preventDefault();
                                    close();
                                } else if (e.key === 'Tab') {
                                    // Tab hands the typed text off to the AI agent.
                                    e.preventDefault();
                                    enterAiMode();
                                }
                            }}
                        />
                        <Command.List className="command-bar-list">
                            <Command.Empty className="command-bar-empty">
                                No results found.
                            </Command.Empty>
                            <Command.Group heading="AI" className="command-bar-group">
                                <Command.Item
                                    value={`ask ai ${search}`}
                                    className="command-bar-item command-bar-item-ai"
                                    onSelect={enterAiMode}
                                >
                                    {search.trim()
                                        ? `Ask AI: "${search.trim()}"`
                                        : 'Ask AI to build something…'}
                                </Command.Item>
                            </Command.Group>
                            {grouped.map(([group, items]) => (
                                <Command.Group
                                    key={group}
                                    heading={group}
                                    className="command-bar-group"
                                >
                                    {items.map((command) => (
                                        <Command.Item
                                            key={command.id}
                                            value={`${command.title} ${command.group} ${(command.keywords ?? []).join(' ')}`}
                                            className="command-bar-item"
                                            onSelect={() => runCommand(command)}
                                        >
                                            {command.title}
                                        </Command.Item>
                                    ))}
                                </Command.Group>
                            ))}
                        </Command.List>
                    </Command>
                )}
            </div>
        </div>,
        document.body,
    );
}
