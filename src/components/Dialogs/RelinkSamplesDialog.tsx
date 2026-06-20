/**
 * RelinkSamplesDialog - Allows users to relink missing sample files
 *
 * Shows a list of missing samples and provides options to:
 * - Browse for individual files
 * - Browse for the folder containing all samples
 * - Attempt auto-locate by scanning a directory
 *
 * The overlay chrome (portal, scrim, Escape, focus-trap) is the oj-ui Modal;
 * the header, banners, list rows, and actions are oj-ui primitives.
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
  const libraries = useLibraryStore(s => s.libraries);

  const [relinkingId, setRelinkingId] = useState<string | null>(null);
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
        setError('File System Access API not supported. Please use Chrome or Edge.');
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

        await relinkItem(sample.id, fileHandle);
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
      setError('File System Access API not supported. Please use Chrome or Edge.');
      return;
    }

    setError(null);

    try {
      // Open directory picker
      const dirHandle = await (window as Window & {
        showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
      }).showDirectoryPicker!();

      // Scan for matching files
      let foundCount = 0;
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

      if (foundCount === 0) {
        setError('No matching files found in the selected folder.');
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError(`Failed to scan folder: ${(err as Error).message}`);
      }
    } finally {
      setRelinkingId(null);
    }
  }, [remainingMissing, relinkItem]);

  // Close if all samples have been relinked
  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  return (
    <Modal open onClose={handleClose} ariaLabel="Missing Samples" size="md">
      <PanelHeader title="Missing Samples" onClose={handleClose} />

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
            All samples have been relinked!
          </Callout>
        ) : (
          <>
            <Callout variant="info" className="relink-banner">
              {remainingMissing.length} sample{remainingMissing.length !== 1 ? 's' : ''} could not
              be found. You can relink them individually or browse a folder to auto-locate.
            </Callout>

            <List aria-label="Missing samples" className="relink-samples-list">
              {remainingMissing.map(sample => (
                <ListRow
                  key={sample.id}
                  actions={
                    <Button
                      onClick={() => handleRelinkFile(sample)}
                      disabled={relinkingId === sample.id}
                    >
                      {relinkingId === sample.id ? 'Browsing...' : 'Browse'}
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

            <div className="relink-actions">
              <Button
                variant="primary"
                onClick={handleRelinkFromFolder}
                disabled={relinkingId !== null}
              >
                Browse Folder to Auto-Locate
              </Button>
            </div>
          </>
        )}
      </ScrollContainer>

      <footer className="relink-dialog-footer">
        <Button onClick={handleClose}>
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
