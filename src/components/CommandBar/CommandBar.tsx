/**
 * CommandBar (U19) — Raycast-style Ctrl/Cmd+K command palette, SEARCH half.
 *
 * Rendered once at the app root. Owns its own open/close state and the global
 * Ctrl/Cmd+K toggle. Built from cmdk's primitives (`Command`, `Command.Input`,
 * `Command.List`, ...) rendered INSIDE this repo's existing overlay/portal
 * pattern (see SettingsPanel) — deliberately NOT `Command.Dialog`, to avoid
 * pulling in the Radix Dialog subtree.
 *
 * Mode seam (for U20): the bar tracks a `mode` that is currently always
 * 'search'. A 'ai' mode is reserved for the Tab -> AI handoff so U20 can add it
 * without restructuring this component (see the TODO around Tab handling).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Command } from 'cmdk';
import { getCommands, subscribe } from '../../store/commandRegistry';
import type { Command as RegistryCommand } from '../../store/commandRegistry';
import { useCommandSources } from './useCommandSources';
import './CommandBar.css';

/**
 * Bar mode. Only 'search' is implemented in U19.
 *
 * TODO(U20): add `'ai'` here and a Tab handoff in {@link CommandBar} so an empty
 * query + Tab (or a dedicated "Ask AI" item) flips mode to 'ai' and routes the
 * typed text to the node-generation flow. Nothing else in this file needs to
 * change structurally — only the `mode` branch and the input's onKeyDown.
 */
type CommandBarMode = 'search';

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
    // Reserved for U20 (Tab -> AI). Always 'search' in U19.
    const [mode] = useState<CommandBarMode>('search');
    const inputRef = useRef<HTMLInputElement>(null);

    // Register node-add + app-action commands while mounted.
    useCommandSources();

    // Subscribe to the registry so newly-registered commands (e.g. future
    // AI-generated nodes) re-render the open palette live.
    const [commands, setCommands] = useState<readonly RegistryCommand[]>(getCommands);
    useEffect(() => subscribe(() => setCommands(getCommands())), []);

    const close = useCallback(() => {
        setOpen(false);
        setSearch('');
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

    // Focus the input whenever the palette opens.
    useEffect(() => {
        if (open) inputRef.current?.focus();
    }, [open]);

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
                <Command label="Command Palette" loop>
                    <Command.Input
                        ref={inputRef}
                        className="command-bar-input"
                        placeholder="Search commands..."
                        value={search}
                        onValueChange={setSearch}
                        onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                                e.preventDefault();
                                close();
                            }
                            // TODO(U20): if (e.key === 'Tab') flip mode -> 'ai'.
                        }}
                    />
                    <Command.List className="command-bar-list">
                        <Command.Empty className="command-bar-empty">
                            No results found.
                        </Command.Empty>
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
            </div>
        </div>,
        document.body,
    );
}
