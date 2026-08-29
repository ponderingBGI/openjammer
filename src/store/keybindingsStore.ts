/**
 * Keybindings Store - Manages customizable keyboard shortcuts
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { KeymapScope } from '../keymap/types';
import type { SurfaceId } from './uiViewStore';

// ============================================================================
// Constants
// ============================================================================

// Sentinel value for explicitly unbound keybindings (cleared conflicts)
export const UNBOUND_KEY = '__UNBOUND__';

// ============================================================================
// Types
// ============================================================================

export interface KeyCombo {
    key: string;           // The main key (e.g., 'z', 'Delete', '=')
    ctrl?: boolean;        // Ctrl key (Windows/Linux)
    meta?: boolean;        // Cmd key (Mac)
    shift?: boolean;       // Shift key
    alt?: boolean;         // Alt key
}

export interface KeybindingAction {
    id: string;
    label: string;         // Display name
    category: string;      // For grouping in UI
    defaultBinding: KeyCombo;
    /** Surface where the shortcut is active. Global shortcuts overlap every scope. */
    scope: Exclude<KeymapScope, 'text' | 'modal'>;
    surface?: SurfaceId;
    /**
     * Mutually-exclusive editing mode inside a surface. Two actions on the same
     * surface whose modes are BOTH set and DIFFERENT can never be live at the
     * same moment (the piano roll's step-entry keybed vs its tool letters are
     * guarded on `stepEntry.trackId`), so they are not a conflict even when they
     * share a combo. An action with no mode is ambient on its surface and
     * conflicts with everything there.
     */
    mode?: string;
}

// ============================================================================
// Default Keybindings
// ============================================================================

export const keybindingActions: KeybindingAction[] = [
    // New/import remain menu-driven until their destructive/file-picker flows have
    // real keymap consumers. Do not advertise shortcuts that silently do nothing.
    {
        id: 'file.save',
        label: 'Save Project',
        category: 'File',
        defaultBinding: { key: 's', ctrl: true },
        scope: 'global',
    },
    {
        id: 'file.export',
        label: 'Export Song',
        category: 'File',
        defaultBinding: { key: 'e', ctrl: true, shift: true },
        scope: 'global',
    },

    // Edit actions
    {
        id: 'edit.delete',
        label: 'Delete Selected',
        category: 'Edit',
        defaultBinding: { key: 'Delete' },
        scope: 'surface', surface: 'canvas',
    },
    {
        id: 'edit.undo',
        label: 'Undo',
        category: 'Edit',
        defaultBinding: { key: 'z', ctrl: true },
        scope: 'surface', surface: 'canvas',
    },
    {
        id: 'edit.redo',
        label: 'Redo',
        category: 'Edit',
        defaultBinding: { key: 'z', ctrl: true, shift: true },
        scope: 'surface', surface: 'canvas',
    },

    // View actions
    {
        id: 'view.zoomIn',
        label: 'Zoom In',
        category: 'View',
        // Alt is cancellable by Chromium; Ctrl/Cmd +/-/0 are reserved browser zoom.
        defaultBinding: { key: '=', alt: true },
        scope: 'surface', surface: 'canvas',
    },
    {
        id: 'view.zoomOut',
        label: 'Zoom Out',
        category: 'View',
        defaultBinding: { key: '-', alt: true },
        scope: 'surface', surface: 'canvas',
    },
    {
        id: 'view.resetView',
        label: 'Reset View',
        category: 'View',
        defaultBinding: { key: '0', alt: true },
        scope: 'surface', surface: 'canvas',
    },
    {
        id: 'view.ghostMode',
        label: 'Toggle Ghost Mode',
        category: 'View',
        defaultBinding: { key: 'w' },
        scope: 'surface', surface: 'canvas',
    },

    // Canvas actions
    {
        id: 'canvas.multiConnect',
        label: 'Multi-Connect Mode',
        category: 'Canvas',
        defaultBinding: { key: 'a' },
        scope: 'surface', surface: 'canvas',
    },
    { id: 'canvas.selectAll', label: 'Select All Nodes', category: 'Canvas', defaultBinding: { key: 'a', ctrl: true }, scope: 'surface', surface: 'canvas' },
    { id: 'canvas.duplicate', label: 'Duplicate Nodes', category: 'Canvas', defaultBinding: { key: 'd', ctrl: true }, scope: 'surface', surface: 'canvas' },
    { id: 'view.toggleArrangement', label: 'Toggle Arrangement', category: 'View', defaultBinding: { key: 'Tab' }, scope: 'global' },
    { id: 'window.focusHost', label: 'Return to OpenJammer', category: 'View', defaultBinding: { key: 'F6' }, scope: 'global' },
    { id: 'commandBar.toggle', label: 'Open Command Bar', category: 'View', defaultBinding: { key: 'k', ctrl: true }, scope: 'global' },
    { id: 'panel.devLog', label: 'Toggle Developer Log', category: 'View', defaultBinding: { key: 'l', ctrl: true, shift: true }, scope: 'global' },
    { id: 'panel.audioHealth', label: 'Toggle Audio Health', category: 'View', defaultBinding: { key: 'h', ctrl: true, shift: true }, scope: 'global' },
    { id: 'panel.plugins', label: 'Toggle Plugins', category: 'View', defaultBinding: { key: 'p', ctrl: true, shift: true }, scope: 'global' },
    { id: 'canvas.escape', label: 'Escape Canvas Action', category: 'Canvas', defaultBinding: { key: 'Escape' }, scope: 'surface', surface: 'canvas' },
    { id: 'canvas.exitLevel', label: 'Exit Node Level', category: 'Canvas', defaultBinding: { key: 'q' }, scope: 'surface', surface: 'canvas' },
    { id: 'canvas.enterNode', label: 'Open Selected Node', category: 'Canvas', defaultBinding: { key: 'e' }, scope: 'surface', surface: 'canvas' },
    { id: 'canvas.transport', label: 'Toggle Canvas Transport', category: 'Canvas', defaultBinding: { key: ' ' }, scope: 'surface', surface: 'canvas' },
    { id: 'canvas.copy', label: 'Copy Nodes', category: 'Canvas', defaultBinding: { key: 'c', ctrl: true }, scope: 'surface', surface: 'canvas' },
    { id: 'canvas.paste', label: 'Paste Nodes', category: 'Canvas', defaultBinding: { key: 'v', ctrl: true }, scope: 'surface', surface: 'canvas' },
    { id: 'canvas.deleteBackspace', label: 'Delete Selected (Backspace)', category: 'Canvas', defaultBinding: { key: 'Backspace' }, scope: 'surface', surface: 'canvas' },
    { id: 'arrangement.transport', label: 'Toggle Arrangement Transport', category: 'Arrangement', defaultBinding: { key: ' ' }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.undo', label: 'Undo Arrangement Edit', category: 'Arrangement', defaultBinding: { key: 'z', ctrl: true }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.redo', label: 'Redo Arrangement Edit', category: 'Arrangement', defaultBinding: { key: 'z', ctrl: true, shift: true }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.selectionUndo', label: 'Undo Selection', category: 'Arrangement', defaultBinding: { key: 'z', ctrl: true, alt: true }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.selectionRedo', label: 'Redo Selection', category: 'Arrangement', defaultBinding: { key: 'z', ctrl: true, alt: true, shift: true }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.cut', label: 'Cut Selection', category: 'Arrangement', defaultBinding: { key: 'x', ctrl: true }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.copy', label: 'Copy Selection', category: 'Arrangement', defaultBinding: { key: 'c', ctrl: true }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.paste', label: 'Paste', category: 'Arrangement', defaultBinding: { key: 'v', ctrl: true }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.delete', label: 'Delete Arrangement Selection', category: 'Arrangement', defaultBinding: { key: 'Delete' }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.deleteBackspace', label: 'Delete Arrangement Selection (Backspace)', category: 'Arrangement', defaultBinding: { key: 'Backspace' }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.zoomToSelection', label: 'Zoom to Arrangement Selection', category: 'Arrangement', defaultBinding: { key: 'z', shift: true }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.duplicate', label: 'Duplicate Clips', category: 'Arrangement', defaultBinding: { key: 'd', ctrl: true }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.nudgeLeft', label: 'Nudge Clips Left', category: 'Arrangement', defaultBinding: { key: 'ArrowLeft' }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.nudgeRight', label: 'Nudge Clips Right', category: 'Arrangement', defaultBinding: { key: 'ArrowRight' }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.nudgeLeftFine', label: 'Fine Nudge Clips Left', category: 'Arrangement', defaultBinding: { key: 'ArrowLeft', shift: true }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.nudgeRightFine', label: 'Fine Nudge Clips Right', category: 'Arrangement', defaultBinding: { key: 'ArrowRight', shift: true }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.split', label: 'Split Clips at Edit Point', category: 'Arrangement', defaultBinding: { key: 's' }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.toggleRipple', label: 'Toggle Ripple Mode', category: 'Arrangement', defaultBinding: { key: 'r' }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.escape', label: 'Clear Arrangement Selection', category: 'Arrangement', defaultBinding: { key: 'Escape' }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.openPianoRoll', label: 'Open Selected MIDI Clip in Piano Roll', category: 'Arrangement', defaultBinding: { key: 'Enter' }, scope: 'surface', surface: 'arrangement' },
    ...Array.from({ length: 9 }, (_, index): KeybindingAction => ({
        id: `mode.${index + 1}`,
        label: `Switch to Mode ${index + 1}`,
        category: 'Modes',
        defaultBinding: { key: String(index + 1) },
        scope: 'global',
    })),
    ...['q','w','e','r','t','y','u','i','o','p','a','s','d','f','g','h','j','k','l','z','x','c','v','b','n','m',',','.','/'].map((key): KeybindingAction => ({
        id: `note.${key}`,
        label: `Play Note (${key.toUpperCase()})`,
        category: 'Note Input',
        defaultBinding: { key },
        scope: 'surface',
        surface: 'canvas',
    })),
    { id: 'note.controlSpace', label: 'Keyboard Control Signal', category: 'Note Input', defaultBinding: { key: ' ' }, scope: 'surface', surface: 'canvas' },

    // The rebuilt timeline's own actions (Waves 3-4). Every entry below is
    // REGISTERED by an arrangement or piano-roll binding set at runtime; the
    // catalogue exists so all of them are visible, rebindable and conflict-
    // checked in Settings -> Keybindings instead of being invisible surface
    // trivia. `keybindingsCatalogue.test.ts` fails if a registered id is missing.

    // Arrangement - editing and navigation
    { id: 'arrangement.enter', label: 'Open Selected Clip', category: 'Arrangement', defaultBinding: { key: 'e' }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.exit', label: 'Leave Arrangement', category: 'Arrangement', defaultBinding: { key: 'q' }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.selectAll', label: 'Select All Clips', category: 'Arrangement', defaultBinding: { key: 'a', ctrl: true }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.muteClips', label: 'Mute Selected Clips', category: 'Arrangement', defaultBinding: { key: '0' }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.insertTime', label: 'Insert Time', category: 'Arrangement', defaultBinding: { key: 'e', ctrl: true }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.deleteTime', label: 'Delete Time', category: 'Arrangement', defaultBinding: { key: 'Backspace', ctrl: true, shift: true }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.moveTrackUp', label: 'Move Track Up', category: 'Arrangement', defaultBinding: { key: 'ArrowUp' }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.moveTrackDown', label: 'Move Track Down', category: 'Arrangement', defaultBinding: { key: 'ArrowDown' }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.nudgeBarLeft', label: 'Nudge Clips One Bar Left', category: 'Arrangement', defaultBinding: { key: 'ArrowLeft', alt: true }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.nudgeBarRight', label: 'Nudge Clips One Bar Right', category: 'Arrangement', defaultBinding: { key: 'ArrowRight', alt: true }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.selectSpatialLeft', label: 'Extend Clip Selection Left', category: 'Arrangement', defaultBinding: { key: 'ArrowLeft', ctrl: true, alt: true }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.selectSpatialRight', label: 'Extend Clip Selection Right', category: 'Arrangement', defaultBinding: { key: 'ArrowRight', ctrl: true, alt: true }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.selectSpatialUp', label: 'Extend Clip Selection Up', category: 'Arrangement', defaultBinding: { key: 'ArrowUp', ctrl: true, alt: true }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.selectSpatialDown', label: 'Extend Clip Selection Down', category: 'Arrangement', defaultBinding: { key: 'ArrowDown', ctrl: true, alt: true }, scope: 'surface', surface: 'arrangement' },

    // Arrangement - transport, loop/punch and markers
    { id: 'arrangement.playFromSelection', label: 'Play From Selection', category: 'Arrangement Transport', defaultBinding: { key: ' ', shift: true }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.loop', label: 'Loop the Selection', category: 'Arrangement Transport', defaultBinding: { key: 'l' }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.loopIn', label: 'Set Loop In', category: 'Arrangement Transport', defaultBinding: { key: 'i' }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.loopOut', label: 'Set Loop Out', category: 'Arrangement Transport', defaultBinding: { key: 'o' }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.punch', label: 'Toggle Punch Recording', category: 'Arrangement Transport', defaultBinding: { key: 'p' }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.metronome', label: 'Toggle Metronome', category: 'Arrangement Transport', defaultBinding: { key: 'm' }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.addMarker', label: 'Add Marker', category: 'Arrangement Transport', defaultBinding: { key: 'm', ctrl: true }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.markerPrevious', label: 'Previous Marker', category: 'Arrangement Transport', defaultBinding: { key: 'ArrowLeft', ctrl: true }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.markerNext', label: 'Next Marker', category: 'Arrangement Transport', defaultBinding: { key: 'ArrowRight', ctrl: true }, scope: 'surface', surface: 'arrangement' },

    // Arrangement - the view: zoom, scroll and grid
    { id: 'arrangement.zoomIn', label: 'Zoom In Timeline', category: 'Arrangement View', defaultBinding: { key: '=' }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.zoomOut', label: 'Zoom Out Timeline', category: 'Arrangement View', defaultBinding: { key: '-' }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.fitSong', label: 'Fit Song to Window', category: 'Arrangement View', defaultBinding: { key: '0', ctrl: true }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.home', label: 'Go to Song Start', category: 'Arrangement View', defaultBinding: { key: 'Home' }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.end', label: 'Go to Song End', category: 'Arrangement View', defaultBinding: { key: 'End' }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.follow', label: 'Follow the Playhead', category: 'Arrangement View', defaultBinding: { key: 'f' }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.snapToggle', label: 'Toggle Snap', category: 'Arrangement View', defaultBinding: { key: 'g', alt: true }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.gridCoarser', label: 'Coarser Grid', category: 'Arrangement View', defaultBinding: { key: '[' }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.gridFiner', label: 'Finer Grid', category: 'Arrangement View', defaultBinding: { key: ']' }, scope: 'surface', surface: 'arrangement' },

    // Arrangement - tools
    { id: 'arrangement.tool.select', label: 'Select Tool', category: 'Arrangement Tools', defaultBinding: { key: 'v' }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.tool.draw', label: 'Draw Tool', category: 'Arrangement Tools', defaultBinding: { key: 'b' }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.tool.erase', label: 'Erase Tool', category: 'Arrangement Tools', defaultBinding: { key: 'x' }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.tool.knife', label: 'Knife Tool', category: 'Arrangement Tools', defaultBinding: { key: 'k' }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.tool.time', label: 'Time Range Tool', category: 'Arrangement Tools', defaultBinding: { key: 't' }, scope: 'surface', surface: 'arrangement' },

    // Piano roll - note editing
    { id: 'pianoroll.transport', label: 'Play/Stop (Piano Roll)', category: 'Piano Roll', defaultBinding: { key: ' ' }, scope: 'surface', surface: 'pianoroll', mode: 'edit' },
    { id: 'pianoroll.undo', label: 'Undo (Piano Roll)', category: 'Piano Roll', defaultBinding: { key: 'z', ctrl: true }, scope: 'surface', surface: 'pianoroll' },
    { id: 'pianoroll.redo', label: 'Redo (Piano Roll)', category: 'Piano Roll', defaultBinding: { key: 'z', ctrl: true, shift: true }, scope: 'surface', surface: 'pianoroll' },
    { id: 'pianoroll.escape', label: 'Clear Note Selection', category: 'Piano Roll', defaultBinding: { key: 'Escape' }, scope: 'surface', surface: 'pianoroll' },
    { id: 'pianoroll.exit', label: 'Close the Piano Roll', category: 'Piano Roll', defaultBinding: { key: 'q' }, scope: 'surface', surface: 'pianoroll' },
    { id: 'pianoroll.selectAll', label: 'Select All Notes', category: 'Piano Roll', defaultBinding: { key: 'a', ctrl: true }, scope: 'surface', surface: 'pianoroll' },
    { id: 'pianoroll.selectionUndo', label: 'Undo Note Selection', category: 'Piano Roll', defaultBinding: { key: 'z', ctrl: true, alt: true }, scope: 'surface', surface: 'pianoroll' },
    { id: 'pianoroll.selectionRedo', label: 'Redo Note Selection', category: 'Piano Roll', defaultBinding: { key: 'y', ctrl: true, alt: true }, scope: 'surface', surface: 'pianoroll' },
    { id: 'pianoroll.cut', label: 'Cut Notes', category: 'Piano Roll', defaultBinding: { key: 'x', ctrl: true }, scope: 'surface', surface: 'pianoroll' },
    { id: 'pianoroll.copy', label: 'Copy Notes', category: 'Piano Roll', defaultBinding: { key: 'c', ctrl: true }, scope: 'surface', surface: 'pianoroll' },
    { id: 'pianoroll.paste', label: 'Paste Notes', category: 'Piano Roll', defaultBinding: { key: 'v', ctrl: true }, scope: 'surface', surface: 'pianoroll' },
    { id: 'pianoroll.delete', label: 'Delete Notes', category: 'Piano Roll', defaultBinding: { key: 'Delete' }, scope: 'surface', surface: 'pianoroll' },
    { id: 'pianoroll.deleteBackspace', label: 'Delete Notes (Backspace)', category: 'Piano Roll', defaultBinding: { key: 'Backspace' }, scope: 'surface', surface: 'pianoroll' },
    { id: 'pianoroll.duplicate', label: 'Duplicate Notes', category: 'Piano Roll', defaultBinding: { key: 'd', ctrl: true }, scope: 'surface', surface: 'pianoroll' },
    { id: 'pianoroll.nudgeLeft', label: 'Nudge Notes Left', category: 'Piano Roll', defaultBinding: { key: 'ArrowLeft' }, scope: 'surface', surface: 'pianoroll' },
    { id: 'pianoroll.nudgeRight', label: 'Nudge Notes Right', category: 'Piano Roll', defaultBinding: { key: 'ArrowRight' }, scope: 'surface', surface: 'pianoroll' },
    { id: 'pianoroll.nudgeLeftFine', label: 'Fine Nudge Notes Left', category: 'Piano Roll', defaultBinding: { key: 'ArrowLeft', shift: true }, scope: 'surface', surface: 'pianoroll' },
    { id: 'pianoroll.nudgeRightFine', label: 'Fine Nudge Notes Right', category: 'Piano Roll', defaultBinding: { key: 'ArrowRight', shift: true }, scope: 'surface', surface: 'pianoroll' },
    { id: 'pianoroll.transposeUp', label: 'Transpose Notes Up', category: 'Piano Roll', defaultBinding: { key: 'ArrowUp' }, scope: 'surface', surface: 'pianoroll' },
    { id: 'pianoroll.transposeDown', label: 'Transpose Notes Down', category: 'Piano Roll', defaultBinding: { key: 'ArrowDown' }, scope: 'surface', surface: 'pianoroll' },
    { id: 'pianoroll.transposeOctaveUp', label: 'Transpose Notes Up an Octave', category: 'Piano Roll', defaultBinding: { key: 'ArrowUp', alt: true }, scope: 'surface', surface: 'pianoroll' },
    { id: 'pianoroll.transposeOctaveDown', label: 'Transpose Notes Down an Octave', category: 'Piano Roll', defaultBinding: { key: 'ArrowDown', alt: true }, scope: 'surface', surface: 'pianoroll' },
    { id: 'pianoroll.velocityUp', label: 'Raise Note Velocity', category: 'Piano Roll', defaultBinding: { key: 'ArrowUp', ctrl: true }, scope: 'surface', surface: 'pianoroll' },
    { id: 'pianoroll.velocityDown', label: 'Lower Note Velocity', category: 'Piano Roll', defaultBinding: { key: 'ArrowDown', ctrl: true }, scope: 'surface', surface: 'pianoroll' },
    { id: 'pianoroll.resizeShorter', label: 'Shorten Notes', category: 'Piano Roll', defaultBinding: { key: ',' }, scope: 'surface', surface: 'pianoroll' },
    { id: 'pianoroll.resizeLonger', label: 'Lengthen Notes', category: 'Piano Roll', defaultBinding: { key: '.' }, scope: 'surface', surface: 'pianoroll' },
    { id: 'pianoroll.quantize', label: 'Quantize Notes', category: 'Piano Roll', defaultBinding: { key: 'q', ctrl: true }, scope: 'surface', surface: 'pianoroll' },

    // Piano roll - tools (live only while step entry is OFF)
    { id: 'pianoroll.tool.select', label: 'Select Tool (Piano Roll)', category: 'Piano Roll Tools', defaultBinding: { key: 'v' }, scope: 'surface', surface: 'pianoroll', mode: 'edit' },
    { id: 'pianoroll.tool.draw', label: 'Draw Tool (Piano Roll)', category: 'Piano Roll Tools', defaultBinding: { key: 'b' }, scope: 'surface', surface: 'pianoroll', mode: 'edit' },
    { id: 'pianoroll.tool.erase', label: 'Erase Tool (Piano Roll)', category: 'Piano Roll Tools', defaultBinding: { key: 'x' }, scope: 'surface', surface: 'pianoroll', mode: 'edit' },
    { id: 'pianoroll.tool.knife', label: 'Knife Tool (Piano Roll)', category: 'Piano Roll Tools', defaultBinding: { key: 'k' }, scope: 'surface', surface: 'pianoroll', mode: 'edit' },
    { id: 'pianoroll.tool.step', label: 'Step Entry Tool', category: 'Piano Roll Tools', defaultBinding: { key: 't' }, scope: 'surface', surface: 'pianoroll', mode: 'edit' },

    // Piano roll - step entry keybed (live only while step entry is ON)
    { id: 'pianoroll.step.a', label: 'Step Entry C (A)', category: 'Piano Roll Step Entry', defaultBinding: { key: 'a' }, scope: 'surface', surface: 'pianoroll', mode: 'step' },
    { id: 'pianoroll.step.w', label: 'Step Entry C# (W)', category: 'Piano Roll Step Entry', defaultBinding: { key: 'w' }, scope: 'surface', surface: 'pianoroll', mode: 'step' },
    { id: 'pianoroll.step.s', label: 'Step Entry D (S)', category: 'Piano Roll Step Entry', defaultBinding: { key: 's' }, scope: 'surface', surface: 'pianoroll', mode: 'step' },
    { id: 'pianoroll.step.e', label: 'Step Entry D# (E)', category: 'Piano Roll Step Entry', defaultBinding: { key: 'e' }, scope: 'surface', surface: 'pianoroll', mode: 'step' },
    { id: 'pianoroll.step.d', label: 'Step Entry E (D)', category: 'Piano Roll Step Entry', defaultBinding: { key: 'd' }, scope: 'surface', surface: 'pianoroll', mode: 'step' },
    { id: 'pianoroll.step.f', label: 'Step Entry F (F)', category: 'Piano Roll Step Entry', defaultBinding: { key: 'f' }, scope: 'surface', surface: 'pianoroll', mode: 'step' },
    { id: 'pianoroll.step.t', label: 'Step Entry F# (T)', category: 'Piano Roll Step Entry', defaultBinding: { key: 't' }, scope: 'surface', surface: 'pianoroll', mode: 'step' },
    { id: 'pianoroll.step.g', label: 'Step Entry G (G)', category: 'Piano Roll Step Entry', defaultBinding: { key: 'g' }, scope: 'surface', surface: 'pianoroll', mode: 'step' },
    { id: 'pianoroll.step.y', label: 'Step Entry G# (Y)', category: 'Piano Roll Step Entry', defaultBinding: { key: 'y' }, scope: 'surface', surface: 'pianoroll', mode: 'step' },
    { id: 'pianoroll.step.h', label: 'Step Entry A (H)', category: 'Piano Roll Step Entry', defaultBinding: { key: 'h' }, scope: 'surface', surface: 'pianoroll', mode: 'step' },
    { id: 'pianoroll.step.u', label: 'Step Entry A# (U)', category: 'Piano Roll Step Entry', defaultBinding: { key: 'u' }, scope: 'surface', surface: 'pianoroll', mode: 'step' },
    { id: 'pianoroll.step.j', label: 'Step Entry B (J)', category: 'Piano Roll Step Entry', defaultBinding: { key: 'j' }, scope: 'surface', surface: 'pianoroll', mode: 'step' },
    { id: 'pianoroll.step.advance', label: 'Step Entry: Rest and Advance', category: 'Piano Roll Step Entry', defaultBinding: { key: ' ' }, scope: 'surface', surface: 'pianoroll', mode: 'step' },
    { id: 'pianoroll.step.retreat', label: 'Step Entry: Step Back', category: 'Piano Roll Step Entry', defaultBinding: { key: 'Backspace' }, scope: 'surface', surface: 'pianoroll', mode: 'step' },
    { id: 'pianoroll.step.octaveDown', label: 'Step Entry: Octave Down', category: 'Piano Roll Step Entry', defaultBinding: { key: 'z' }, scope: 'surface', surface: 'pianoroll', mode: 'step' },
    { id: 'pianoroll.step.octaveUp', label: 'Step Entry: Octave Up', category: 'Piano Roll Step Entry', defaultBinding: { key: 'z', shift: true }, scope: 'surface', surface: 'pianoroll', mode: 'step' },
];

// ============================================================================
// Helpers
// ============================================================================

export function keyComboToString(combo: KeyCombo): string {
    const parts: string[] = [];

    if (combo.ctrl) parts.push('Ctrl');
    if (combo.meta) parts.push('Cmd');
    if (combo.alt) parts.push('Alt');
    if (combo.shift) parts.push('Shift');

    // Format the key nicely
    let keyDisplay = combo.key;
    if (combo.key === ' ') keyDisplay = 'Space';
    else if (combo.key === 'Delete') keyDisplay = 'Del';
    else if (combo.key === 'Backspace') keyDisplay = 'Backspace';
    else if (combo.key === 'Escape') keyDisplay = 'Esc';
    // Arrow keys are spelled out rather than drawn as glyphs: a keycap is read
    // aloud as often as it is looked at, and "Left" survives a screen reader.
    else if (combo.key.startsWith('Arrow')) keyDisplay = combo.key.slice('Arrow'.length);
    else if (combo.key.length === 1) keyDisplay = combo.key.toUpperCase();

    parts.push(keyDisplay);

    return parts.join('+');
}

export function matchesKeyCombo(e: KeyboardEvent, combo: KeyCombo): boolean {
    // Check modifiers (convert to boolean to handle undefined)
    const ctrlOrMeta = e.ctrlKey || e.metaKey;
    const wantsCtrlOrMeta = Boolean(combo.ctrl || combo.meta);

    if (wantsCtrlOrMeta !== ctrlOrMeta) return false;
    if (Boolean(combo.shift) !== e.shiftKey) return false;
    if (Boolean(combo.alt) !== e.altKey) return false;

    // Check main key (case-insensitive for letters)
    const comboKey = combo.key.toLowerCase();

    // Option modifies the produced character on macOS (for example Alt+= is ≠),
    // while the physical key code remains stable across keyboard layouts.
    if (combo.alt) {
        const codeForKey: Record<string, string> = { '=': 'Equal', '-': 'Minus', '0': 'Digit0' };
        const expectedCode = codeForKey[comboKey];
        if (expectedCode) return e.code === expectedCode;
    }

    const eventKey = e.key.toLowerCase();

    return eventKey === comboKey;
}

/**
 * Compare two key combos for equality
 */
export function keyComboEquals(a: KeyCombo, b: KeyCombo): boolean {
    return (
        a.key.toLowerCase() === b.key.toLowerCase() &&
        Boolean(a.ctrl || a.meta) === Boolean(b.ctrl || b.meta) &&
        Boolean(a.shift) === Boolean(b.shift) &&
        Boolean(a.alt) === Boolean(b.alt)
    );
}

// ============================================================================
// Store Interface
// ============================================================================

interface KeybindingsStore {
    // Custom bindings override defaults (action id -> KeyCombo)
    customBindings: Record<string, KeyCombo>;

    // Get the current binding for an action (custom or default)
    getBinding: (actionId: string) => KeyCombo | undefined;

    // Set a custom binding
    setBinding: (actionId: string, combo: KeyCombo) => void;

    // Remove custom binding (revert to default)
    resetBinding: (actionId: string) => void;

    // Reset all to defaults
    resetAllBindings: () => void;

    // Check if a key event matches an action
    matchesAction: (e: KeyboardEvent, actionId: string) => boolean;

    // Get all actions that match a key event
    getMatchingActions: (e: KeyboardEvent) => string[];

    // Get actions that would conflict with a proposed binding
    getConflictingActions: (actionId: string, combo: KeyCombo) => KeybindingAction[];

    // Clear bindings that conflict with the given combo (except for the specified action)
    clearConflictingBindings: (actionId: string, combo: KeyCombo) => void;
}

// ============================================================================
// Store Implementation
// ============================================================================

// Custom storage with validation
const validatedStorage = {
    getItem: (name: string) => {
        try {
            const item = localStorage.getItem(name);
            if (!item) return null;

            const parsed = JSON.parse(item);
            if (!parsed || typeof parsed !== 'object') return null;

            // Validate customBindings structure
            if (parsed.state?.customBindings) {
                const bindings = parsed.state.customBindings;
                if (typeof bindings !== 'object' || Array.isArray(bindings)) {
                    parsed.state.customBindings = {};
                } else {
                    // Validate each binding has required 'key' property
                    // Collect invalid keys first, then delete in separate pass to avoid mutation during iteration
                    const invalidKeys: string[] = [];
                    for (const [actionId, combo] of Object.entries(bindings)) {
                        if (!combo || typeof combo !== 'object' || typeof (combo as KeyCombo).key !== 'string') {
                            invalidKeys.push(actionId);
                        }
                        // Note: UNBOUND_KEY sentinel is valid and passes validation
                    }
                    for (const key of invalidKeys) {
                        delete bindings[key];
                    }
                }
            }

            return parsed;
        } catch {
            // On any error, return null to use default state
            return null;
        }
    },
    setItem: (name: string, value: { state: KeybindingsStore }): void => {
        try {
            localStorage.setItem(name, JSON.stringify(value));
        } catch {
            // Ignore storage errors (quota exceeded, etc.)
        }
    },
    removeItem: (name: string): void => {
        try {
            localStorage.removeItem(name);
        } catch {
            // Ignore errors
        }
    },
};

export const useKeybindingsStore = create<KeybindingsStore>()(
    persist(
        (set, get) => ({
            customBindings: {},

            getBinding: (actionId: string) => {
                const { customBindings } = get();

                // Check for custom binding first
                if (customBindings[actionId]) {
                    const binding = customBindings[actionId];

                    // Return undefined for explicitly unbound keys
                    if (binding.key === UNBOUND_KEY) {
                        return undefined;
                    }

                    // Runtime validation: ensure binding has valid key
                    if (typeof binding.key !== 'string' || binding.key === '') {
                        console.error(`Invalid keybinding for action "${actionId}": missing or empty key`);
                        return undefined;
                    }

                    return binding;
                }

                // Fall back to default
                const action = keybindingActions.find(a => a.id === actionId);
                return action?.defaultBinding;
            },

            setBinding: (actionId: string, combo: KeyCombo) => {
                set((state) => ({
                    customBindings: {
                        ...state.customBindings,
                        [actionId]: combo,
                    },
                }));
            },

            resetBinding: (actionId: string) => {
                set((state) => {
                    const { [actionId]: _, ...rest } = state.customBindings;
                    return { customBindings: rest };
                });
            },

            resetAllBindings: () => {
                set({ customBindings: {} });
            },

            matchesAction: (e: KeyboardEvent, actionId: string) => {
                const binding = get().getBinding(actionId);
                if (!binding) return false;
                return matchesKeyCombo(e, binding);
            },

            getMatchingActions: (e: KeyboardEvent) => {
                const matching: string[] = [];

                for (const action of keybindingActions) {
                    const binding = get().getBinding(action.id);
                    if (binding && matchesKeyCombo(e, binding)) {
                        matching.push(action.id);
                    }
                }

                return matching;
            },

            getConflictingActions: (actionId: string, combo: KeyCombo) => {
                const conflicting: KeybindingAction[] = [];
                const target = keybindingActions.find((action) => action.id === actionId);
                const targetScope = target?.scope ?? 'global';

                for (const action of keybindingActions) {
                    // Skip the action we're setting
                    if (action.id === actionId) continue;

                    const actionScope = action.scope ?? 'global';
                    // Two different modes on one surface are never live together.
                    if (target?.mode && action.mode && target.mode !== action.mode) continue;
                    const sameSurface = target?.surface === action.surface;
                    const scopesOverlap = targetScope === 'global' || actionScope === 'global' ||
                        (targetScope === actionScope && (targetScope !== 'surface' || sameSurface));
                    if (!scopesOverlap) continue;

                    const binding = get().getBinding(action.id);
                    if (binding && keyComboEquals(binding, combo)) {
                        conflicting.push(action);
                    }
                }

                return conflicting;
            },

            clearConflictingBindings: (actionId: string, combo: KeyCombo) => {
                const conflicts = get().getConflictingActions(actionId, combo);
                if (conflicts.length === 0) return;

                set((state) => {
                    const newBindings = { ...state.customBindings };

                    for (const conflict of conflicts) {
                        // Mark conflicting bindings as explicitly unbound
                        // using a sentinel value that getBinding() recognizes
                        newBindings[conflict.id] = { key: UNBOUND_KEY };
                    }

                    return { customBindings: newBindings };
                });
            },
        }),
        {
            name: 'openjammer-keybindings',
            storage: validatedStorage,
        }
    )
);
