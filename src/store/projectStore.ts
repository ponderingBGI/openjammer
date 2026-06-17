/**
 * Project Store - Manages local project folders and persistence
 *
 * Features:
 * - Create/open project folders
 * - Auto-save workflow to disk
 * - Track recent projects
 * - Persist directory handles across sessions
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import {
  persistHandle,
  restoreHandle,
  removeHandle,
  verifyPermission,
  isFileSystemAccessSupported,
} from '../utils/fileSystemAccess';
import { useLibraryStore } from './libraryStore';
import { useGraphStore } from './graphStore';
import { useAudioClipStore, clearClipBufferCache } from './audioClipStore';

// ============================================================================
// Types
// ============================================================================

export interface ProjectManifest {
  name: string;
  version: string;
  engine: 'openjammer';
  engineVersion: string;
  created: string;
  modified: string;
  transport?: {
    bpm: number;
    timeSignature: [number, number];
    loop: boolean;
    loopStart: number;
    loopEnd: number;
  };
  audioFiles?: Record<string, {
    path: string;
    duration?: number;
    sampleRate?: number;
  }>;
  graph?: {
    nodes: unknown[];
    edges: unknown[];
    viewport?: { x: number; y: number; zoom: number };
  };
}

export interface RecentProject {
  name: string;
  handleKey: string;
  lastOpened: string;
}

export interface ProjectState {
  // Current project
  name: string | null;
  handleKey: string | null;
  hasUnsavedChanges: boolean;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;

  // Feature detection
  isSupported: boolean;

  // Recent projects (persisted separately in localStorage)
  recentProjects: RecentProject[];

  // Actions
  createProject: (name?: string) => Promise<FileSystemDirectoryHandle>;
  openProject: () => Promise<{ handle: FileSystemDirectoryHandle; manifest: ProjectManifest }>;
  openRecentProject: (project: RecentProject) => Promise<{ handle: FileSystemDirectoryHandle; manifest: ProjectManifest }>;
  saveProject: (graphData: { nodes: unknown[]; edges: unknown[]; viewport?: { x: number; y: number; zoom: number } }) => Promise<void>;
  closeProject: () => void;
  markDirty: () => void;
  markClean: () => void;
  clearError: () => void;

  // Internal
  getProjectHandle: () => Promise<FileSystemDirectoryHandle | null>;
  addAudioFile: (fileId: string, fileInfo: { path: string; duration?: number; sampleRate?: number }) => Promise<void>;
  loadRecentProjects: () => Promise<void>;
}

// ============================================================================
// Constants
// ============================================================================

const ENGINE_VERSION = '0.1.0';
const PROJECT_FILE_NAME = 'project.openjammer';
const RECENT_PROJECTS_KEY = 'openjammer-recent-projects';

// Default viewport settings
const DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 1 };

/**
 * Check if a path contains traversal attempts
 * Returns true if the path is safe, false if it contains traversal
 */
function isPathSafe(path: string): boolean {
  if (!path) return false;

  // Block absolute paths
  if (path.startsWith('/') || path.startsWith('\\')) {
    return false;
  }

  // Check each segment for traversal attempts
  const segments = path.split(/[/\\]/);
  for (const segment of segments) {
    // Decode to catch encoded traversal
    let decoded = segment;
    try {
      let prev = '';
      let iterations = 0;
      while (decoded !== prev && iterations < 10) {
        prev = decoded;
        decoded = decodeURIComponent(decoded);
        iterations++;
      }
    } catch {
      // Invalid encoding is suspicious
      return false;
    }

    // Block parent directory traversal and current directory
    if (decoded === '..' || decoded === '.') {
      return false;
    }

    // Block null bytes and other dangerous characters
    if (decoded.includes('\0')) {
      return false;
    }

    // Block Windows drive letters at start of path
    if (/^[a-zA-Z]:/.test(decoded)) {
      return false;
    }
  }

  return true;
}

/**
 * Validate and sanitize audio file paths in manifest
 * Removes any paths that could be security risks
 */
function validateAudioFilePaths(
  audioFiles?: Record<string, { path: string; duration?: number; sampleRate?: number }>
): Record<string, { path: string; duration?: number; sampleRate?: number }> {
  if (!audioFiles) return {};

  const validated: Record<string, { path: string; duration?: number; sampleRate?: number }> = {};

  for (const [id, info] of Object.entries(audioFiles)) {
    if (isPathSafe(info.path)) {
      validated[id] = info;
    } else {
      console.warn(`[ProjectStore] Blocked potentially unsafe audio file path: ${info.path}`);
    }
  }

  return validated;
}

/**
 * Validate viewport data to prevent corrupted values from breaking the UI.
 * Uses partial recovery - keeps valid values while fixing invalid ones.
 */
function validateViewport(viewport?: { x: number; y: number; zoom: number }): { x: number; y: number; zoom: number } {
  if (!viewport) return DEFAULT_VIEWPORT;

  // Validate each field independently for partial recovery
  let { x, y, zoom } = viewport;
  let hasWarning = false;

  // Validate x coordinate
  if (!isFinite(x)) {
    console.warn('[ProjectStore] Invalid viewport x value, using default:', x);
    x = DEFAULT_VIEWPORT.x;
    hasWarning = true;
  }

  // Validate y coordinate
  if (!isFinite(y)) {
    console.warn('[ProjectStore] Invalid viewport y value, using default:', y);
    y = DEFAULT_VIEWPORT.y;
    hasWarning = true;
  }

  // Validate zoom (must be positive and within reasonable bounds)
  // Bounds: 0.1x (10%) to 5.0x (500%) - beyond this causes rendering performance issues
  if (!isFinite(zoom) || zoom < 0.1 || zoom > 5.0) {
    console.warn('[ProjectStore] Invalid viewport zoom value, using default:', zoom);
    zoom = DEFAULT_VIEWPORT.zoom;
    hasWarning = true;
  }

  if (hasWarning) {
    console.warn('[ProjectStore] Viewport partially recovered:', { x, y, zoom });
  }

  return { x, y, zoom };
}

// Graph data limits to prevent DoS and corruption
const MAX_GRAPH_NODES = 10000;
const MAX_GRAPH_EDGES = 50000;

/**
 * Validate graph data structure to prevent corruption, DoS, and injection attacks.
 * Checks array types, size limits, and basic object structure.
 */
function validateGraphData(graphData: {
  nodes: unknown[];
  edges: unknown[];
}): { nodes: unknown[]; edges: unknown[] } {
  // Validate nodes is an array
  if (!Array.isArray(graphData.nodes)) {
    throw new Error('Invalid graph: nodes must be an array');
  }

  // Validate edges is an array
  if (!Array.isArray(graphData.edges)) {
    throw new Error('Invalid graph: edges must be an array');
  }

  // Size limits to prevent DoS
  if (graphData.nodes.length > MAX_GRAPH_NODES) {
    throw new Error(`Invalid graph: nodes count (${graphData.nodes.length}) exceeds maximum (${MAX_GRAPH_NODES})`);
  }

  if (graphData.edges.length > MAX_GRAPH_EDGES) {
    throw new Error(`Invalid graph: edges count (${graphData.edges.length}) exceeds maximum (${MAX_GRAPH_EDGES})`);
  }

  // Validate each node is a plain object
  for (let i = 0; i < graphData.nodes.length; i++) {
    const node = graphData.nodes[i];
    if (typeof node !== 'object' || node === null) {
      throw new Error(`Invalid graph: node ${i} is not an object`);
    }
  }

  // Validate each edge is a plain object
  for (let i = 0; i < graphData.edges.length; i++) {
    const edge = graphData.edges[i];
    if (typeof edge !== 'object' || edge === null) {
      throw new Error(`Invalid graph: edge ${i} is not an object`);
    }
  }

  return {
    nodes: graphData.nodes,
    edges: graphData.edges
  };
}

// ============================================================================
// Manifest Write Mutex - Prevents concurrent read-modify-write races
// ============================================================================

let manifestMutex: Promise<void> = Promise.resolve();

/**
 * Acquire the manifest write lock. All manifest read-modify-write operations
 * should use this to prevent race conditions.
 *
 * Usage:
 *   const release = await acquireManifestLock();
 *   try { ... } finally { release(); }
 */
function acquireManifestLock(): Promise<() => void> {
  let release: () => void;
  const newMutex = new Promise<void>((resolve) => {
    release = resolve;
  });

  const previousMutex = manifestMutex;
  manifestMutex = newMutex;

  return previousMutex.then(() => release!);
}

/**
 * Generate a unique ID with fallback for non-secure contexts
 */
function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for non-secure contexts
  return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

// ============================================================================
// Helper Functions
// ============================================================================

async function createProjectStructure(
  handle: FileSystemDirectoryHandle,
  name: string
): Promise<ProjectManifest> {
  // Create folder structure with error handling
  try {
    await handle.getDirectoryHandle('library', { create: true });
  } catch (err) {
    throw new Error(`Failed to create library folder: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }

  try {
    await handle.getDirectoryHandle('presets', { create: true });
  } catch (err) {
    throw new Error(`Failed to create presets folder: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }

  // Create manifest
  const manifest: ProjectManifest = {
    name,
    version: '1.0.0',
    engine: 'openjammer',
    engineVersion: ENGINE_VERSION,
    created: new Date().toISOString(),
    modified: new Date().toISOString(),
    transport: {
      bpm: 120,
      timeSignature: [4, 4],
      loop: false,
      loopStart: 0,
      loopEnd: 16,
    },
    audioFiles: {},
    graph: {
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  };

  // Write project file with error handling
  const projectFile = await handle.getFileHandle(PROJECT_FILE_NAME, { create: true });
  const writable = await projectFile.createWritable();
  try {
    await writable.write(JSON.stringify(manifest, null, 2));
    await writable.close();
  } catch (err) {
    // Abort the writable stream on error to prevent corruption
    await writable.abort().catch((abortErr) => {
      console.error('[ProjectStore] Failed to abort writable during project creation:', abortErr);
    });
    throw new Error(`Failed to write project file: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }

  // Create README with error handling (non-fatal - project still valid without README)
  try {
    const readme = await handle.getFileHandle('README.txt', { create: true });
    const readmeWritable = await readme.createWritable();
    try {
      await readmeWritable.write(`OpenJammer Project: ${name}
Created: ${new Date().toLocaleDateString()}

This folder contains:
- ${PROJECT_FILE_NAME}: Main workflow file
- library/: Audio files (recordings, samples, loops)
- presets/: Saved node presets

Open this folder in OpenJammer to continue working on your project.
https://github.com/PonderingBGI/openjammer
`);
      await readmeWritable.close();
    } catch (err) {
      await readmeWritable.abort().catch(() => {});
      console.warn('[ProjectStore] Failed to write README file:', err);
      // Don't throw - README failure shouldn't fail project creation
    }
  } catch (err) {
    console.warn('[ProjectStore] Failed to create README file:', err);
    // Don't throw - README failure shouldn't fail project creation
  }

  return manifest;
}

async function readProjectManifest(
  handle: FileSystemDirectoryHandle
): Promise<ProjectManifest> {
  try {
    const fileHandle = await handle.getFileHandle(PROJECT_FILE_NAME);
    const file = await fileHandle.getFile();
    const content = await file.text();
    const manifest = JSON.parse(content) as ProjectManifest;

    // Validate engine
    if (manifest.engine !== 'openjammer') {
      throw new Error('Not an OpenJammer project');
    }

    // Validate and sanitize audio file paths to prevent path traversal
    if (manifest.audioFiles) {
      manifest.audioFiles = validateAudioFilePaths(manifest.audioFiles);
    }

    // Validate viewport data
    if (manifest.graph?.viewport) {
      manifest.graph.viewport = validateViewport(manifest.graph.viewport);
    }

    return manifest;
  } catch (err) {
    if ((err as DOMException).name === 'NotFoundError') {
      throw new Error(`No ${PROJECT_FILE_NAME} found in this folder`);
    }
    throw err;
  }
}

async function writeProjectManifest(
  handle: FileSystemDirectoryHandle,
  manifest: ProjectManifest
): Promise<void> {
  const fileHandle = await handle.getFileHandle(PROJECT_FILE_NAME, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(JSON.stringify(manifest, null, 2));
    await writable.close();
  } catch (err) {
    // Abort the writable stream on error to prevent corruption
    await writable.abort().catch(() => {});
    throw err;
  }
}

async function saveRecentProjects(projects: RecentProject[]): Promise<void> {
  await idbSet(RECENT_PROJECTS_KEY, projects);
}

async function loadRecentProjectsFromStorage(): Promise<RecentProject[]> {
  try {
    const projects = await idbGet<RecentProject[]>(RECENT_PROJECTS_KEY);
    return projects || [];
  } catch (err) {
    console.warn('[ProjectStore] Failed to load recent projects from storage:', err);
    return [];
  }
}

// ============================================================================
// Store
// ============================================================================

export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => ({
      // Initial state
      name: null,
      handleKey: null,
      hasUnsavedChanges: false,
      isLoading: false,
      isSaving: false,
      error: null,
      isSupported: isFileSystemAccessSupported(),
      recentProjects: [],

      // ========================================
      // Create New Project
      // ========================================
      createProject: async (name?: string) => {
        if (!isFileSystemAccessSupported()) {
          throw new Error('File System Access API not supported in this browser');
        }

        // Prevent concurrent operations
        if (get().isLoading) {
          throw new Error('Another operation is in progress');
        }

        set({ isLoading: true, error: null });

        try {
          // User picks a folder FIRST (must be direct user gesture)
          const handle = await window.showDirectoryPicker!({
            mode: 'readwrite',
            startIn: 'documents',
          });

          // Now prompt for name (after folder is selected)
          const folderName = handle.name;
          const projectName = name || prompt('Enter project name:', folderName);
          if (!projectName) {
            set({ isLoading: false });
            throw new Error('Cancelled');
          }

          // Check if folder already has a project
          try {
            await handle.getFileHandle(PROJECT_FILE_NAME);
            // Project file exists - ask if they want to overwrite
            const overwrite = confirm(
              `This folder already contains a project. Overwrite?`
            );
            if (!overwrite) {
              set({ isLoading: false });
              throw new Error('Cancelled - folder already contains a project');
            }
          } catch (err) {
            // NotFoundError means no existing project - that's good
            if ((err as DOMException).name !== 'NotFoundError') {
              throw err;
            }
          }

          // Create project structure
          await createProjectStructure(handle, projectName);

          // Persist handle
          const handleKey = `project-${generateId()}`;
          await persistHandle(handleKey, handle);

          // Update recent projects and clean up orphaned handles
          const recent = await loadRecentProjectsFromStorage();
          const filtered = recent.filter((p) => p.name !== projectName);
          const updated = [
            { name: projectName, handleKey, lastOpened: new Date().toISOString() },
            ...filtered,
          ].slice(0, 10);

          // Clean up handles for projects being removed from recent list
          const removed = recent.filter((p) => !updated.some(u => u.handleKey === p.handleKey));
          for (const p of removed) {
            await removeHandle(p.handleKey);
          }

          await saveRecentProjects(updated);

          set({
            name: projectName,
            handleKey,
            hasUnsavedChanges: false,
            isLoading: false,
            recentProjects: updated,
          });

          // Auto-connect library (non-blocking, errors don't affect project creation)
          useLibraryStore.getState().addProjectLibrary(handle, projectName)
            .catch(err => console.warn('[Project] Failed to connect library:', err));

          return handle;
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to create project';
          set({ isLoading: false, error: message });
          throw err;
        }
      },

      // ========================================
      // Open Project
      // ========================================
      openProject: async () => {
        if (!isFileSystemAccessSupported()) {
          throw new Error('File System Access API not supported');
        }

        // Prevent concurrent operations
        if (get().isLoading) {
          throw new Error('Another operation is in progress');
        }

        set({ isLoading: true, error: null });

        try {
          const handle = await window.showDirectoryPicker!({
            mode: 'readwrite',
          });

          // Validate project
          const manifest = await readProjectManifest(handle);

          // Persist handle
          const handleKey = `project-${generateId()}`;
          await persistHandle(handleKey, handle);

          // Update recent projects and clean up orphaned handles
          const recent = await loadRecentProjectsFromStorage();
          const filtered = recent.filter((p) => p.name !== manifest.name);
          const updated = [
            { name: manifest.name, handleKey, lastOpened: new Date().toISOString() },
            ...filtered,
          ].slice(0, 10);

          // Clean up handles for projects being removed from recent list
          const removed = recent.filter((p) => !updated.some(u => u.handleKey === p.handleKey));
          for (const p of removed) {
            await removeHandle(p.handleKey);
          }

          await saveRecentProjects(updated);

          set({
            name: manifest.name,
            handleKey,
            hasUnsavedChanges: false,
            isLoading: false,
            recentProjects: updated,
          });

          // Auto-connect sample library (non-blocking, errors don't affect project opening)
          useLibraryStore.getState().addProjectLibrary(handle, manifest.name)
            .catch(err => console.warn('[Project] Failed to connect sample library:', err));

          return { handle, manifest };
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to open project';
          set({ isLoading: false, error: message });
          throw err;
        }
      },

      // ========================================
      // Open Recent Project
      // ========================================
      openRecentProject: async (project: RecentProject) => {
        // Prevent concurrent operations
        if (get().isLoading) {
          throw new Error('Another operation is in progress');
        }

        set({ isLoading: true, error: null });

        try {
          const handle = await restoreHandle(project.handleKey);
          if (!handle) {
            // Clean up invalid handle
            await removeHandle(project.handleKey);
            throw new Error('Project folder not found - it may have been moved or deleted');
          }

          // Validate handle is still valid (folder still exists)
          try {
            await handle.getDirectoryHandle('.', { create: false });
          } catch {
            // Handle is stale - clean it up
            await removeHandle(project.handleKey);
            throw new Error('Project folder no longer exists or was moved');
          }

          // Verify/request permission
          const hasPermission = await verifyPermission(handle, true, 'readwrite');
          if (!hasPermission) {
            throw new Error('Permission denied. Please click the project button again to grant folder access.');
          }

          // Read manifest
          const manifest = await readProjectManifest(handle);

          // Update recent projects (move to top)
          const recent = await loadRecentProjectsFromStorage();
          const filtered = recent.filter((p) => p.handleKey !== project.handleKey);
          const updated = [
            { ...project, lastOpened: new Date().toISOString() },
            ...filtered,
          ].slice(0, 10);
          await saveRecentProjects(updated);

          set({
            name: manifest.name,
            handleKey: project.handleKey,
            hasUnsavedChanges: false,
            isLoading: false,
            recentProjects: updated,
          });

          // Auto-connect sample library (non-blocking, errors don't affect project opening)
          useLibraryStore.getState().addProjectLibrary(handle, manifest.name)
            .catch(err => console.warn('[Project] Failed to connect sample library:', err));

          return { handle, manifest };
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to open project';
          set({ isLoading: false, error: message });
          throw err;
        }
      },

      // ========================================
      // Save Project
      // ========================================
      saveProject: async (graphData) => {
        const { handleKey, isSaving } = get();

        // Prevent concurrent saves
        if (isSaving) {
          return;
        }

        if (!handleKey) {
          throw new Error('No project open');
        }

        set({ isSaving: true });

        // Use mutex to prevent race conditions with addAudioFile
        const release = await acquireManifestLock();
        try {
          const handle = await restoreHandle(handleKey);
          if (!handle) {
            throw new Error('Project folder not found');
          }

          const hasPermission = await verifyPermission(handle, true, 'readwrite');
          if (!hasPermission) {
            throw new Error('Permission denied. Please click save again to grant folder access.');
          }

          // Read current manifest
          const manifest = await readProjectManifest(handle);

          // Update with new data, validating graph and viewport to prevent corrupted values
          manifest.modified = new Date().toISOString();
          const validatedGraph = validateGraphData(graphData);
          manifest.graph = {
            nodes: validatedGraph.nodes,
            edges: validatedGraph.edges,
            viewport: validateViewport(graphData.viewport)
          };

          // Write back
          await writeProjectManifest(handle, manifest);

          set({ hasUnsavedChanges: false, isSaving: false });
        } catch (err) {
          set({ isSaving: false });
          throw err;
        } finally {
          release();
        }
      },

      // ========================================
      // Close Project
      // ========================================
      closeProject: () => {
        const { name } = get();

        // Disconnect library
        if (name) {
          useLibraryStore.getState().removeProjectLibrary(name);
        }

        // Clear graph state to prevent stale data in the next project
        const graphStore = useGraphStore.getState();
        graphStore.clearGraph();
        graphStore.clearSelection();

        // Clear audio clip state
        useAudioClipStore.getState().clearAllClips();

        // Clear clip buffer cache to free memory
        clearClipBufferCache();

        set({
          name: null,
          handleKey: null,
          hasUnsavedChanges: false,
          error: null,
        });
      },

      // ========================================
      // Dirty State
      // ========================================
      markDirty: () => set({ hasUnsavedChanges: true }),
      markClean: () => set({ hasUnsavedChanges: false }),
      clearError: () => set({ error: null }),

      // ========================================
      // Get Handle
      // ========================================
      getProjectHandle: async () => {
        const { handleKey } = get();
        if (!handleKey) return null;

        const handle = await restoreHandle(handleKey);
        if (!handle) return null;

        const hasPermission = await verifyPermission(handle, false, 'readwrite');
        if (!hasPermission) return null;

        return handle;
      },

      // ========================================
      // Add Audio File to Manifest
      // ========================================
      addAudioFile: async (fileId: string, fileInfo: { path: string; duration?: number; sampleRate?: number }) => {
        const { handleKey } = get();
        if (!handleKey) {
          throw new Error('No project open');
        }

        // Use mutex to prevent race conditions with saveProject
        const release = await acquireManifestLock();
        try {
          const handle = await restoreHandle(handleKey);
          if (!handle) {
            throw new Error('Project folder not found');
          }

          const hasPermission = await verifyPermission(handle, true, 'readwrite');
          if (!hasPermission) {
            throw new Error('Permission denied');
          }

          // Read current manifest
          const manifest = await readProjectManifest(handle);

          // Update audioFiles
          manifest.audioFiles = manifest.audioFiles || {};
          manifest.audioFiles[fileId] = fileInfo;
          manifest.modified = new Date().toISOString();

          // Write back
          await writeProjectManifest(handle, manifest);
        } finally {
          release();
        }
      },

      // ========================================
      // Load Recent Projects
      // ========================================
      loadRecentProjects: async () => {
        const projects = await loadRecentProjectsFromStorage();
        set({ recentProjects: projects });
      },
    }),
    {
      name: 'openjammer-project',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        name: state.name,
        handleKey: state.handleKey,
      }),
    }
  )
);

// ============================================================================
// Initialize on module load
// ============================================================================

// Track initialization state to prevent race conditions
let initializationPromise: Promise<void> | null = null;

/**
 * Ensure the project store is initialized.
 * Safe to call multiple times - will only run once.
 */
export async function ensureProjectStoreInitialized(): Promise<void> {
  if (initializationPromise) {
    return initializationPromise;
  }

  initializationPromise = (async () => {
    const state = useProjectStore.getState();

    // Load recent projects
    await state.loadRecentProjects();

    // If a project was open, reconnect the sample library
    if (state.name && state.handleKey) {
      try {
        const handle = await restoreHandle(state.handleKey);
        if (handle) {
          const hasPermission = await verifyPermission(handle, false);
          if (hasPermission) {
            // Reconnect library silently (non-blocking)
            useLibraryStore.getState().addProjectLibrary(handle, state.name)
              .catch(err => console.warn('[Project] Failed to reconnect library:', err));
          }
        }
      } catch (err) {
        console.warn('Failed to reconnect project sample library:', err);
      }
    }
  })();

  return initializationPromise;
}

// Auto-initialize when module loads in browser environment
if (typeof window !== 'undefined') {
  ensureProjectStoreInitialized();
}
