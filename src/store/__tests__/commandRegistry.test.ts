import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    register,
    registerAll,
    unregister,
    subscribe,
    getCommands,
    getCommand,
    searchCommands,
    _resetForTests,
    type Command,
} from '../commandRegistry';

function makeCommand(id: string, overrides: Partial<Command> = {}): Command {
    return {
        id,
        title: overrides.title ?? id,
        group: overrides.group ?? 'Test',
        run: overrides.run ?? (() => {}),
        keywords: overrides.keywords,
    };
}

describe('commandRegistry', () => {
    beforeEach(() => {
        _resetForTests();
    });

    describe('register', () => {
        it('adds a command and exposes it via getCommands/getCommand', () => {
            register(makeCommand('a', { title: 'Add Looper', group: 'Routing' }));

            expect(getCommands()).toHaveLength(1);
            expect(getCommand('a')?.title).toBe('Add Looper');
        });

        it('replaces (does not duplicate) when re-registering the same id', () => {
            register(makeCommand('a', { title: 'First' }));
            register(makeCommand('a', { title: 'Second' }));

            expect(getCommands()).toHaveLength(1);
            expect(getCommand('a')?.title).toBe('Second');
        });

        it('returns an unregister function that removes the command', () => {
            const off = register(makeCommand('a'));
            expect(getCommand('a')).toBeDefined();

            off();
            expect(getCommand('a')).toBeUndefined();
            expect(getCommands()).toHaveLength(0);
        });

        it('runs the command callback', () => {
            const run = vi.fn();
            register(makeCommand('a', { run }));

            getCommand('a')?.run();
            expect(run).toHaveBeenCalledOnce();
        });

        it('preserves registration order in getCommands', () => {
            register(makeCommand('a'));
            register(makeCommand('b'));
            register(makeCommand('c'));

            expect(getCommands().map((c) => c.id)).toEqual(['a', 'b', 'c']);
        });

        it('returns a referentially-stable snapshot between mutations', () => {
            register(makeCommand('a'));
            const first = getCommands();
            const second = getCommands();
            expect(first).toBe(second);

            register(makeCommand('b'));
            expect(getCommands()).not.toBe(first);
        });
    });

    describe('registerAll / unregister', () => {
        it('registers a batch and removes them all via the returned cleanup', () => {
            const off = registerAll([
                makeCommand('a'),
                makeCommand('b'),
            ]);
            expect(getCommands()).toHaveLength(2);

            off();
            expect(getCommands()).toHaveLength(0);
        });

        it('unregister(id) is a no-op for unknown ids', () => {
            register(makeCommand('a'));
            unregister('does-not-exist');
            expect(getCommands()).toHaveLength(1);
        });
    });

    describe('searchCommands', () => {
        beforeEach(() => {
            registerAll([
                makeCommand('node.add.looper', {
                    title: 'Add Looper',
                    group: 'Routing',
                    keywords: ['loop', 'record'],
                }),
                makeCommand('node.add.piano', {
                    title: 'Add Classic Piano',
                    group: 'Instruments',
                    keywords: ['keys', 'grand'],
                }),
                makeCommand('app.settings', {
                    title: 'Open Settings',
                    group: 'App',
                }),
            ]);
        });

        it('returns all commands for an empty/blank query', () => {
            expect(searchCommands('')).toHaveLength(3);
            expect(searchCommands('   ')).toHaveLength(3);
        });

        it('matches on title (case-insensitive)', () => {
            const results = searchCommands('PIANO');
            expect(results.map((c) => c.id)).toEqual(['node.add.piano']);
        });

        it('matches on group', () => {
            const results = searchCommands('routing');
            expect(results.map((c) => c.id)).toEqual(['node.add.looper']);
        });

        it('matches on keywords', () => {
            const results = searchCommands('grand');
            expect(results.map((c) => c.id)).toEqual(['node.add.piano']);
        });

        it('returns nothing when no command matches', () => {
            expect(searchCommands('nonexistent-xyz')).toHaveLength(0);
        });
    });

    describe('subscribe', () => {
        it('notifies subscribers on register and unregister', () => {
            const listener = vi.fn();
            const unsubscribe = subscribe(listener);

            register(makeCommand('a'));
            expect(listener).toHaveBeenCalledTimes(1);

            unregister('a');
            expect(listener).toHaveBeenCalledTimes(2);

            unsubscribe();
            register(makeCommand('b'));
            expect(listener).toHaveBeenCalledTimes(2); // no further calls
        });
    });
});
