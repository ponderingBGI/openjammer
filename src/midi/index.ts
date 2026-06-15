/**
 * MIDI Module
 * Exports all MIDI-related functionality
 */

// Types
export * from './types';

// Manager
export { getMIDIManager, MIDIManager } from './MIDIManager';

// Parser
export {
  parseMIDIMessage,
  midiNoteToName,
  noteNameToMidi,
  getCCName,
  normalizeMIDIValue,
  denormalizeMIDIValue,
} from './MIDIMessageParser';

// Presets
export { getPresetRegistry, MIDIPresetRegistry, type MIDIBundleConfig } from './MIDIDevicePresets';
export { genericPreset } from './presets/generic';
export { arturiaMinilab3Preset } from './presets/arturia-minilab-3';

// Port Generation
export {
  generateMIDIPorts,
  getMIDICCMapping,
  getMIDINoteMapping,
  createCCLookupTable,
  createNoteLookupTable,
} from './MIDIPortGenerator';

// Voice Routing (U13) — control-side MIDI -> instrument note resolution
export {
  MIDIVoiceRouter,
  initMidiVoiceRouting,
  disposeMidiVoiceRouting,
  createDefaultRoutingContext,
  midiNoteToRowKey,
  isRowKeyInRange,
  DEFAULT_ROW_OCTAVES,
} from './routing';
export type {
  RoutingContext,
  GraphAccess,
  VoiceExecutor,
  MIDISource,
  ResolvedVoice,
  RowKey,
} from './routing';
