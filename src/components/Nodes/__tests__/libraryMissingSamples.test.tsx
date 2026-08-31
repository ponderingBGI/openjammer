/**
 * W6-P7D item 2 — the missing-samples loop, end to end.
 *
 * Three gates found the same defect and none of them could close it: the
 * `missing` STATE was real and rendered (`libraryStore.ts` declares
 * `status: 'missing'`, `LibraryNode.tsx` puts `.is-missing` on the row,
 * `LibraryNode.css` paints it `--danger-ink` with the name struck through) —
 * but the PRODUCER was dead. `checkMissingItems()` had no caller a player could
 * reach; it was transitively dead behind `relinkLibrary`, itself dead behind a
 * dialog nothing imported. So the app shipped a red struck-through row for a
 * state it could never enter, and a recovery nothing could open.
 *
 * What this file pins, in the order the loop runs:
 *
 *  1. `checkMissingItems` marks an item whose file is not on disk, and — the
 *     half that keeps it honest — marks NOTHING when the folder is merely
 *     un-permissioned or unlinked. "I cannot look" is not "they are gone", and
 *     striking through a player's whole folder on a lapsed permission is the
 *     loudest possible way to say something untrue.
 *  2. `LibraryNode` CALLS it, once its library is ready and scanned.
 *  3. The banner appears with the real count and OPENS the dialog.
 *  4. A successful relink clears the state and the banner goes.
 *  5. Undo: a relink is ONE step and that step is SEALED — `Ctrl+Z` consumes it
 *     and changes nothing, rather than falling through into the graph entry
 *     that would take the Library card off the canvas.
 *
 * Every assertion below fails on the pre-fix tree: 1's guard did not exist, 2
 * had no caller, 3/4 had no banner and no importer, and 5 recorded nothing.
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const idb = vi.hoisted(() => new Map<string, unknown>());
vi.mock('idb-keyval', () => ({
    get: vi.fn(async (k: string) => idb.get(k)),
    set: vi.fn(async (k: string, v: unknown) => { idb.set(k, v); }),
    del: vi.fn(async (k: string) => { idb.delete(k); }),
    keys: vi.fn(async () => [...idb.keys()]),
}));

const fsa = vi.hoisted(() => ({
    restoreHandle: vi.fn(),
    verifyPermission: vi.fn(async () => true),
    persistHandle: vi.fn(async () => {}),
}));
vi.mock('../../../utils/fileSystemAccess', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../utils/fileSystemAccess')>()),
    restoreHandle: fsa.restoreHandle,
    verifyPermission: fsa.verifyPermission,
    persistHandle: fsa.persistHandle,
}));

import { useGraphStore } from '../../../store/graphStore';
import { useHistoryStore } from '../../../store/historyStore';
import { useLibraryStore, type LibraryItem } from '../../../store/libraryStore';
import { LibraryNode } from '../LibraryNode';
import '../../../store/libraryVerbs';

// ---------------------------------------------------------------------------
// A directory tree that answers the two calls `checkMissingItems` makes.
// ---------------------------------------------------------------------------

/** Build a handle for a set of `a/b/c.wav` paths. Anything not listed throws,
 *  which is exactly what a real handle does for a file that left the disk. */
function fakeDir(paths: string[]): FileSystemDirectoryHandle {
    const make = (prefix: string): FileSystemDirectoryHandle =>
        ({
            name: prefix || 'root',
            async getDirectoryHandle(name: string) {
                const next = prefix ? `${prefix}/${name}` : name;
                if (!paths.some((p) => p.startsWith(`${next}/`))) {
                    throw new Error(`NotFoundError: ${next}`);
                }
                return make(next);
            },
            async getFileHandle(name: string) {
                const full = prefix ? `${prefix}/${name}` : name;
                if (!paths.includes(full)) throw new Error(`NotFoundError: ${full}`);
                return { kind: 'file', name } as unknown as FileSystemFileHandle;
            },
        }) as unknown as FileSystemDirectoryHandle;
    return make('');
}

function item(over: Partial<LibraryItem> = {}): LibraryItem {
    return {
        id: 'i1',
        fileName: 'clap.wav',
        relativePath: 'drums/clap.wav',
        libraryId: 'lib',
        duration: 1.5,
        sampleRate: 48000,
        channels: 1,
        fileSize: 1024,
        lastModified: 0,
        tags: [],
        status: 'available',
        ...over,
    } as LibraryItem;
}

function seedLibrary(items: LibraryItem[]) {
    useLibraryStore.setState({
        libraries: {
            lib: {
                id: 'lib',
                name: 'Drums',
                rootPath: 'Drums',
                handleKey: 'lib-root',
                itemCount: items.length,
                lastScanAt: 1,
                status: 'ready',
            } as never,
        },
        items: Object.fromEntries(items.map((i) => [i.id, i])),
        allTags: [],
        pinnedTags: [],
        activeFilterTag: null,
        scanProgress: null,
        projectLibraryId: null,
    });
}

const faceProps = (id: string) => ({
    node: useGraphStore.getState().nodes.get(id)!,
    hasConnection: () => false,
    handleHeaderMouseDown: () => {},
    handleNodeMouseEnter: () => {},
    handleNodeMouseLeave: () => {},
    isSelected: false,
    isDragging: false,
    isHoveredWithConnections: false,
    style: {},
});

/** The real store actions, captured before any test swaps one for a spy —
 *  `useLibraryStore.setState` replaces them for the whole file otherwise, and a
 *  no-op `checkMissingItems` left behind by one test silently disarms every
 *  test after it. */
const REAL_ACTIONS = {
    checkMissingItems: useLibraryStore.getState().checkMissingItems,
    scanLibrary: useLibraryStore.getState().scanLibrary,
};

beforeEach(() => {
    idb.clear();
    useLibraryStore.setState({ ...REAL_ACTIONS });
    fsa.restoreHandle.mockReset().mockResolvedValue(null);
    fsa.verifyPermission.mockReset().mockResolvedValue(true);
    fsa.persistHandle.mockReset().mockResolvedValue(undefined);
    useGraphStore.setState({
        nodes: new Map(),
        connections: new Map(),
        connectionsByNode: new Map(),
        rootNodeIds: [],
        selectedNodeIds: new Set(),
        selectedConnectionIds: new Set(),
        clipboard: null,
        version: 0,
    });
    useHistoryStore.getState().clear();
});
afterEach(cleanup);

// ---------------------------------------------------------------------------
// 1. The producer, and the two things it refuses to claim
// ---------------------------------------------------------------------------

describe('checkMissingItems', () => {
    it('marks the item whose file is no longer on disk, and only that one', async () => {
        seedLibrary([
            item({ id: 'here', relativePath: 'drums/clap.wav' }),
            item({ id: 'gone', relativePath: 'drums/kick.wav' }),
        ]);
        fsa.restoreHandle.mockResolvedValue(fakeDir(['drums/clap.wav']));

        const missing = await useLibraryStore.getState().checkMissingItems('lib');

        expect(missing).toEqual(['gone']);
        expect(useLibraryStore.getState().items.gone.status).toBe('missing');
        expect(useLibraryStore.getState().items.here.status).toBe('available');
    });

    it('marks NOTHING when the folder is there but the permission has lapsed', async () => {
        // The reload case: the handle survives in IndexedDB, the grant does not,
        // and every `getFileHandle` below would throw `NotAllowedError` — which
        // the walk's `catch` would read as a missing file and strike through the
        // player's entire folder. A held note beats a glitch.
        seedLibrary([item({ id: 'a' }), item({ id: 'b', relativePath: 'drums/kick.wav' })]);
        fsa.restoreHandle.mockResolvedValue(fakeDir([]));
        fsa.verifyPermission.mockResolvedValue(false);

        expect(await useLibraryStore.getState().checkMissingItems('lib')).toEqual([]);
        expect(useLibraryStore.getState().items.a.status).toBe('available');
        expect(useLibraryStore.getState().items.b.status).toBe('available');
        // …and it never asked for permission, because an effect has no user
        // gesture behind it to spend on a prompt.
        expect(fsa.verifyPermission).toHaveBeenCalledWith(expect.anything(), false);
    });

    it('marks NOTHING for a library that was never linked to a folder', async () => {
        seedLibrary([item()]);
        useLibraryStore.setState((s) => ({
            libraries: { lib: { ...s.libraries.lib, handleKey: '' } },
        }));

        expect(await useLibraryStore.getState().checkMissingItems('lib')).toEqual([]);
        expect(useLibraryStore.getState().items.i1.status).toBe('available');
    });

    it('marks every item when the library ROOT itself is gone', async () => {
        // This one IS a real total loss — nothing under that folder can be
        // reached — and it is what the dialog's "the whole folder moved" route
        // exists to answer in one gesture.
        seedLibrary([item({ id: 'a' }), item({ id: 'b' })]);
        fsa.restoreHandle.mockResolvedValue(null);

        expect(await useLibraryStore.getState().checkMissingItems('lib')).toEqual(['a', 'b']);
        expect(useLibraryStore.getState().items.a.status).toBe('missing');
    });

    it('never puts a background walk on the undo stack', async () => {
        seedLibrary([item({ id: 'gone', relativePath: 'drums/kick.wav' })]);
        fsa.restoreHandle.mockResolvedValue(fakeDir([]));
        const before = useHistoryStore.getState().cursor;

        await useLibraryStore.getState().checkMissingItems('lib');

        expect(useHistoryStore.getState().cursor).toBe(before);
    });
});

// ---------------------------------------------------------------------------
// 2–4. The card: it calls the walk, it says so, and it opens the way out
// ---------------------------------------------------------------------------

describe('the Library card surfaces the missing files', () => {
    async function mountWithMissing(paths: string[] = []) {
        seedLibrary([
            item({ id: 'here', fileName: 'clap.wav', relativePath: 'drums/clap.wav' }),
            item({ id: 'gone', fileName: 'kick.wav', relativePath: 'drums/kick.wav' }),
        ]);
        fsa.restoreHandle.mockResolvedValue(fakeDir(paths));
        const id = useGraphStore.getState().addNode('library', { x: 0, y: 0 });
        useGraphStore.getState().updateNodeData(id, { libraryId: 'lib' });
        const view = render(<LibraryNode {...faceProps(id)} />);
        return view;
    }

    it('runs the walk on its own, once the library is ready and scanned', async () => {
        const spy = vi.fn(useLibraryStore.getState().checkMissingItems);
        useLibraryStore.setState({ checkMissingItems: spy });
        await mountWithMissing(['drums/clap.wav']);
        await waitFor(() => expect(spy).toHaveBeenCalledWith('lib'));
    });

    it('does not run the walk for a library that has never been scanned', async () => {
        const spy = vi.fn(async () => []);
        // `scanLibrary` is stubbed too: an unscanned library is exactly what the
        // OTHER effect reacts to, and the real one would reach for a folder that
        // is not there.
        const scan = vi.fn(async () => {});
        seedLibrary([item()]);
        useLibraryStore.setState((s) => ({
            checkMissingItems: spy,
            scanLibrary: scan,
            libraries: { lib: { ...s.libraries.lib, lastScanAt: 0 } },
        }));
        const id = useGraphStore.getState().addNode('library', { x: 0, y: 0 });
        useGraphStore.getState().updateNodeData(id, { libraryId: 'lib' });
        render(<LibraryNode {...faceProps(id)} />);
        await act(async () => { await Promise.resolve(); });
        expect(spy).not.toHaveBeenCalled();
    });

    /**
     * SPIN-1 — found by this file, not by the eye.
     *
     * The auto-scan effect depended on the whole `libraries` object and retried
     * on any status but `scanning`. A scan that FAILS writes `status: 'error'`
     * into `libraries`, which changes its identity, which re-runs the effect,
     * which retries the same doomed scan — forever, at whatever rate the event
     * loop allows, with an IndexedDB read each time. Nothing changes between
     * attempts, so it can neither recover nor stop. On the pre-fix component
     * this test does not fail; it hangs the worker until it is killed, which is
     * the same thing the player's tab does.
     */
    it('does not retry a scan that failed — an error is terminal until the player acts', async () => {
        const scan = vi.fn(async (libraryId: string) => {
            // What the real `scanLibrary` does when the handle is gone.
            useLibraryStore.setState((s) => ({
                libraries: {
                    ...s.libraries,
                    [libraryId]: { ...s.libraries[libraryId], status: 'error' as const },
                },
            }));
        });
        seedLibrary([item()]);
        useLibraryStore.setState((s) => ({
            scanLibrary: scan,
            libraries: { lib: { ...s.libraries.lib, lastScanAt: 0 } },
        }));
        const id = useGraphStore.getState().addNode('library', { x: 0, y: 0 });
        useGraphStore.getState().updateNodeData(id, { libraryId: 'lib' });
        render(<LibraryNode {...faceProps(id)} />);

        await act(async () => { await new Promise((r) => setTimeout(r, 120)); });

        expect(scan).toHaveBeenCalledTimes(1);
    });

    it('says how many, strikes the row, and hands over one control', async () => {
        const { container } = await mountWithMissing(['drums/clap.wav']);

        await waitFor(() =>
            expect(screen.getByText(/1 sample moved or went missing/)).toBeTruthy(),
        );
        // The banner is a Callout, not a modal: it never takes the keyboard.
        expect(container.querySelector('.library-missing.oj-callout')).toBeTruthy();
        expect(screen.queryByRole('alertdialog')).toBeNull();
        // …and the row it is about actually reads as broken.
        await waitFor(() =>
            expect(container.querySelector('.library-file-row.is-missing')).toBeTruthy(),
        );
        expect(
            container.querySelector('.library-file-row.is-missing')!.textContent,
        ).toContain('kick.wav');
    });

    it('stays quiet when nothing is missing', async () => {
        await mountWithMissing(['drums/clap.wav', 'drums/kick.wav']);
        await act(async () => { await Promise.resolve(); });
        expect(screen.queryByText(/moved or went missing/)).toBeNull();
    });

    it('opens the relink sheet from the banner', async () => {
        await mountWithMissing(['drums/clap.wav']);
        const open = await screen.findByRole('button', { name: /Relink 1 missing sample/ });

        fireEvent.click(open);

        const dialog = await screen.findByRole('dialog', { name: 'Missing samples' });
        // The sheet lists the SAME item the banner counted…
        expect(dialog.textContent).toContain('kick.wav');
        expect(dialog.textContent).not.toContain('clap.wav');
        // …and offers both folder-shaped recoveries, not just the per-file one.
        expect(screen.getByRole('button', { name: /Relink the whole folder/ })).toBeTruthy();
        expect(screen.getByRole('button', { name: /Search a folder by name/ })).toBeTruthy();
    });

    it('clears the banner once the file is found again', async () => {
        await mountWithMissing(['drums/clap.wav']);
        await screen.findByRole('button', { name: /Relink 1 missing sample/ });

        // What a successful relink leaves behind: the item is available and the
        // walk agrees. Re-run it with the file back where it belongs — which is
        // exactly what the sheet's `onClose` does.
        fsa.restoreHandle.mockResolvedValue(fakeDir(['drums/clap.wav', 'drums/kick.wav']));
        await act(async () => {
            await useLibraryStore.getState().checkMissingItems('lib');
        });

        await waitFor(() =>
            expect(screen.queryByText(/moved or went missing/)).toBeNull(),
        );
        expect(useLibraryStore.getState().items.gone.status).toBe('available');
    });
});

// ---------------------------------------------------------------------------
// 5. Undo — one step, and that step is sealed
// ---------------------------------------------------------------------------

describe('a relink on the undo stack', () => {
    /** A file handle that behaves like the one `showOpenFilePicker` returns. */
    const fileHandle = {
        kind: 'file',
        name: 'kick.wav',
        async getFile() {
            return { name: 'kick.wav', size: 2048, lastModified: 99 } as File;
        },
    } as unknown as FileSystemFileHandle;

    it('is ONE sealed step: Ctrl+Z consumes it and the sample stays linked', async () => {
        const { recordSealedLibraryEditAsync } = await import('../../../store/libraryVerbs');
        seedLibrary([item({ id: 'gone', fileName: 'kick.wav', status: 'missing' })]);
        idb.set('oj-item-handle-gone', { old: true });
        useLibraryStore.setState((s) => ({
            items: { gone: { ...s.items.gone, handleKey: 'oj-item-handle-gone' } },
        }));
        useHistoryStore.getState().clear();

        await act(async () => {
            await recordSealedLibraryEditAsync('Relink sample', () =>
                useLibraryStore.getState().relinkItem('gone', fileHandle),
            );
        });

        // One entry, not one per store write inside the gesture.
        expect(useHistoryStore.getState().cursor).toBe(1);
        expect(useLibraryStore.getState().items.gone.status).toBe('available');
        expect(useLibraryStore.getState().items.gone.fileSize).toBe(2048);

        act(() => { useHistoryStore.getState().undo(); });

        // SEALED: the step is spent and NOTHING moved. The old handle left
        // IndexedDB when the relink succeeded, so an inverse could only restore
        // a record pointing at nothing — a row that says "available" and plays
        // silence. And, the part that matters on stage, Ctrl+Z did not fall
        // through into the graph entry that would delete the Library card.
        expect(useHistoryStore.getState().cursor).toBe(0);
        expect(useLibraryStore.getState().items.gone.status).toBe('available');
        expect(useLibraryStore.getState().items.gone.fileSize).toBe(2048);
    });

    it('is the recorder the dialog actually uses, for both routes', async () => {
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        const src = await fs.readFile(
            path.resolve(__dirname, '../../Dialogs/RelinkSamplesDialog.tsx'),
            'utf8',
        );
        // A plain `recordLibraryEdit` here would be the bug this seals against.
        expect(src).toContain("recordSealedLibraryEditAsync('Relink sample'");
        expect(src).toContain("recordSealedLibraryEditAsync('Relink samples from a folder'");
        expect(src).toContain("recordSealedLibraryEditAsync('Relink the library folder'");
        expect(src).not.toMatch(/[^d]recordLibraryEdit\(/);
        // The folder sweep's bracket wraps the LOOP, not each file: one button
        // press is one entry however many files it matches.
        const sweep = src.slice(src.indexOf('Relink samples from a folder'));
        expect(sweep.indexOf('for (const sample of remainingMissing)')).toBeGreaterThan(0);
        expect(sweep.indexOf('for (const sample of remainingMissing)')).toBeLessThan(
            sweep.indexOf('if (foundCount === 0)'),
        );
    });
});
