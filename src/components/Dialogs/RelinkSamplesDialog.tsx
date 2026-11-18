/**
 * RelinkSamplesDialog — the way back from a sample that left the disk.
 *
 * Shows the files the folder walk could not find and offers two routes: point
 * at one file, or point at a folder and let it match the rest by name.
 *
 * The overlay chrome (portal, scrim, Escape, focus-trap) is the oj-ui Modal;
 * the header, banners, list rows, and actions are oj-ui primitives.
 *
 * ---------------------------------------------------------------------------
 * UNDO (W6-P7D). A relink is a library mutation, so it goes on the stack — but
 * it goes on **sealed**, the same way `emptyTrash` and `permanentlyDeleteItem`
 * do, and for the same reason: its payload is destroyed OUTSIDE the store.
 * `relinkItem` writes the new `FileSystemFileHandle` into IndexedDB and then
 * `idbDel`s the old key, so the handle an inverse would need to restore is
 * already gone. A plain reversible step would put back a record whose
 * `handleKey` points at nothing — a row that says "available" and plays
 * silence, which is exactly the lie `libraryVerbs`' sealed recorder exists to
 * prevent.
 *
 * There is also nothing to go back TO. Undoing a relink means restoring the
 * broken pointer that sent the player here; the state it would return is the
 * failure, not a version of their work. So the step is recorded, `Ctrl+Z`
 * consumes it and changes nothing, and — the part that matters on stage — it
 * does NOT fall through into the previous graph entry and take the whole
 * Library card off the canvas.
 *
 * ONE GESTURE, ONE UNDO: "Browse…" on a row is one step; "Browse a folder to
 * auto-locate" is ONE step for the whole sweep, however many files it matches,
 * because the player pressed one button.
 */

import { useState, useCallback, useMemo } from 'react';
import {
  Modal,
  PanelHeader,
  Callout,
  List,
  ListRow,
  Button,
} from '@openjammer/oj-ui';
import {
  useLibraryStore,
  type LibraryItem,
} from '../../store/libraryStore';
import { recordSealedLibraryEditAsync } from '../../store/libraryVerbs';
import { isFileSystemAccessSupported } from '../../utils/fileSystemAccess';
import { ScrollContainer } from '../common/ScrollContainer';
import './RelinkSamplesDialog.css';

interface RelinkSamplesDialogProps {
  libraryId: string;
  missingSamples: LibraryItem[];
  onClose: () => void;
}

export function RelinkSamplesDialog({
  libraryId,
  missingSamples,
  onClose,
}: RelinkSamplesDialogProps) {
  const relinkItem = useLibraryStore(s => s.relinkItem);
  const relinkLibrary = useLibraryStore(s => s.relinkLibrary);
  const libraries = useLibraryStore(s => s.libraries);

  const [relinkingId, setRelinkingId] = useState<string | null>(null);
  const [isRelinkingRoot, setIsRelinkingRoot] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [relinkedIds, setRelinkedIds] = useState<Set<string>>(new Set());

  const library = libraries[libraryId];
  const remainingMissing = useMemo(
    () => missingSamples.filter(s => !relinkedIds.has(s.id)),
    [missingSamples, relinkedIds]
  );

  // Handle relinking a single file
  const handleRelinkFile = useCallback(
    async (sample: LibraryItem) => {
      if (!isFileSystemAccessSupported()) {
        setError('This browser cannot open a file. Chrome or Edge can.');
        return;
      }

      setRelinkingId(sample.id);
      setError(null);

      try {
        // Open file picker
        const [fileHandle] = await (window as Window & {
          showOpenFilePicker?: (options?: {
            types?: Array<{
              description: string;
              accept: Record<string, string[]>;
            }>;
          }) => Promise<FileSystemFileHandle[]>;
        }).showOpenFilePicker!({
          types: [
            {
              description: 'Audio Files',
              accept: {
                'audio/*': ['.wav', '.mp3', '.flac', '.aiff', '.aif', '.ogg', '.m4a'],
              },
            },
          ],
        });

        // One row, one gesture, one sealed step (see the file header).
        await recordSealedLibraryEditAsync('Relink sample', () =>
          relinkItem(sample.id, fileHandle),
        );
        setRelinkedIds(prev => new Set([...prev, sample.id]));
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setError(`Failed to relink: ${(err as Error).message}`);
        }
      } finally {
        setRelinkingId(null);
      }
    },
    [relinkItem]
  );

  // Handle relinking by browsing a folder (auto-scan)
  const handleRelinkFromFolder = useCallback(async () => {
    if (!isFileSystemAccessSupported()) {
      setError('This browser cannot open a folder. Chrome or Edge can.');
      return;
    }

    setError(null);

    try {
      // Open directory picker
      const dirHandle = await (window as Window & {
        showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
      }).showDirectoryPicker!();

      // Scan for matching files. ONE bracket around the whole sweep: the
      // player pressed one button, so it is one entry on the stack however
      // many files it matches.
      let foundCount = 0;
      await recordSealedLibraryEditAsync('Relink samples from a folder', async () => {
        for (const sample of remainingMissing) {
          setRelinkingId(sample.id);

          try {
            // Try to find the file by its filename
            const fileName = sample.fileName;
            const fileHandle = await findFileInDirectory(dirHandle, fileName);

            if (fileHandle) {
              await relinkItem(sample.id, fileHandle);
              setRelinkedIds(prev => new Set([...prev, sample.id]));
              foundCount++;
            }
          } catch {
            // File not found, continue
          }
        }
      });

      if (foundCount === 0) {
        setError('Nothing in that folder matches these names.');
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError(`Failed to scan folder: ${(err as Error).message}`);
      }
    } finally {
      setRelinkingId(null);
    }
  }, [remainingMissing, relinkItem]);

  /**
   * The whole-folder route.
   *
   * The commonest way to reach this sheet is not "one file moved" — it is
   * "the folder moved, or the browser dropped its permission to it", and then
   * EVERY row is missing at once. Matching those one by one is the wrong shape
   * (the auto-locate above walks the tree once per file), and relinking 400
   * samples by hand is not a recovery. `relinkLibrary` is the verb for it: one
   * folder pick, re-persisted against the library's own handle key, and every
   * item resolves again by the relative path it already stores.
   *
   * It was written for exactly this and had no caller — reachable only from
   * this dialog, which nothing imported. This is that caller.
   */
  const handleRelinkRoot = useCallback(async () => {
    if (!isFileSystemAccessSupported()) {
      setError('This browser cannot open a folder. Chrome or Edge can.');
      return;
    }

    setError(null);
    setIsRelinkingRoot(true);

    try {
      const dirHandle = await (window as Window & {
        showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
      }).showDirectoryPicker!();

      // Sealed for the same reason as `relinkItem` (see the file header): this
      // OVERWRITES the library's root handle in IndexedDB, so the pointer an
      // inverse would restore is gone the moment it succeeds.
      await recordSealedLibraryEditAsync('Relink the library folder', () =>
        relinkLibrary(libraryId, dirHandle),
      );

      const stillMissing = useLibraryStore.getState().items;
      const found = missingSamples.filter(s => stillMissing[s.id]?.status !== 'missing');
      setRelinkedIds(prev => new Set([...prev, ...found.map(s => s.id)]));
      if (found.length === 0) {
        setError('That folder does not hold these files at the paths they were scanned from.');
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError(`Failed to relink the folder: ${(err as Error).message}`);
      }
    } finally {
      setIsRelinkingRoot(false);
    }
  }, [libraryId, missingSamples, relinkLibrary]);

  /** Any picker is open or a sweep is running — nothing else may start one. */
  const isBusy = relinkingId !== null || isRelinkingRoot;

  return (
    <Modal open onClose={onClose} ariaLabel="Missing samples" size="md">
      <PanelHeader title="Missing samples" onClose={onClose} />

      <ScrollContainer mode="dropdown" className="relink-dialog-body">
        {library && (
          <p className="relink-library-info">
            Library: <strong>{library.name}</strong>
          </p>
        )}

        {error && (
          <Callout variant="danger" className="relink-banner">
            {error}
          </Callout>
        )}

        {remainingMissing.length === 0 ? (
          <Callout variant="success" className="relink-banner">
            Every sample is linked again.
          </Callout>
        ) : (
          <>
            <Callout variant="info" className="relink-banner">
              {remainingMissing.length} sample{remainingMissing.length !== 1 ? 's' : ''} could not
              be found where the scan left {remainingMissing.length !== 1 ? 'them' : 'it'}. If the
              whole folder moved, point at it once below. Otherwise point at{' '}
              {remainingMissing.length !== 1 ? 'the files' : 'the file'} one at a time. Tags, crops
              and names come with {remainingMissing.length !== 1 ? 'them' : 'it'} either way.
            </Callout>

            <List aria-label="Missing samples" className="relink-samples-list">
              {remainingMissing.map(sample => (
                <ListRow
                  key={sample.id}
                  actions={
                    /* `loading`, not a swapped label: the Button already owns
                       the busy treatment, and a control whose WORD changes
                       under the pointer moves the row. */
                    <Button
                      onClick={() => handleRelinkFile(sample)}
                      loading={relinkingId === sample.id}
                      disabled={isBusy}
                    >
                      Browse...
                    </Button>
                  }
                >
                  <span className="relink-sample-info">
                    <span className="relink-sample-name">{sample.fileName}</span>
                    <span className="relink-sample-path">{sample.relativePath}</span>
                  </span>
                </ListRow>
              ))}
            </List>

            {/* Two folder-shaped answers, most-likely first. "The folder
                moved" re-points the library itself and every path resolves
                again in one gesture; "find them by name" is the fallback for a
                folder that was reorganised, and it walks the tree per file, so
                it is the slower, quieter option and reads that way. */}
            <div className="relink-actions">
              <Button
                variant="primary"
                onClick={handleRelinkRoot}
                loading={isRelinkingRoot}
                disabled={isBusy}
              >
                Relink the whole folder
              </Button>
              <Button
                onClick={handleRelinkFromFolder}
                loading={relinkingId !== null}
                disabled={isBusy}
              >
                Search a folder by name
              </Button>
            </div>
          </>
        )}
      </ScrollContainer>

      <footer className="relink-dialog-footer">
        <Button onClick={onClose} disabled={isBusy}>
          {remainingMissing.length === 0 ? 'Done' : 'Close'}
        </Button>
      </footer>
    </Modal>
  );
}

// Helper: Find a file by name in a directory (recursive with depth limit)
const MAX_SEARCH_DEPTH = 50;

async function findFileInDirectory(
  dirHandle: FileSystemDirectoryHandle,
  fileName: string,
  depth = 0
): Promise<FileSystemFileHandle | null> {
  // Prevent stack overflow on deeply nested or cyclic directories
  if (depth > MAX_SEARCH_DEPTH) {
    console.warn(`[RelinkSamplesDialog] Max search depth ${MAX_SEARCH_DEPTH} reached`);
    return null;
  }

  // Type for iterator
  type FSEntry = FileSystemFileHandle | FileSystemDirectoryHandle;

  for await (const entry of (dirHandle as FileSystemDirectoryHandle & {
    values(): AsyncIterableIterator<FSEntry>;
  }).values()) {
    const fsEntry = entry as FSEntry & { kind: 'file' | 'directory'; name: string };

    if (fsEntry.kind === 'file' && fsEntry.name === fileName) {
      return fsEntry as FileSystemFileHandle;
    }

    if (fsEntry.kind === 'directory') {
      const found = await findFileInDirectory(
        fsEntry as FileSystemDirectoryHandle,
        fileName,
        depth + 1
      );
      if (found) return found;
    }
  }

  return null;
}
