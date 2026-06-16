/**
 * Instrument catalog — engine-agnostic instrument metadata (id / name / category).
 *
 * After U-DEDUP the legacy Web-Audio sample loaders (smplr / webaudiofont / Tone)
 * were deleted. The ojcore engine renders instruments natively (selected by the
 * instrument NODE TYPE via the manifest system), but the InstrumentNode picker
 * UI still presents a browsable catalog so a user can label/choose an
 * `instrumentId`. This module provides that catalog as PURE METADATA — no audio
 * loading, no external sample URLs, no dependencies — preserving the picker.
 */

export type InstrumentCategory =
    | 'piano'
    | 'strings'
    | 'woodwinds'
    | 'brass'
    | 'guitar'
    | 'bass'
    | 'synth'
    | 'percussion'
    | 'world';

/** Browsable instrument metadata entry (no audio-engine coupling). */
export interface InstrumentDefinition {
    id: string;
    name: string;
    category: InstrumentCategory;
    defaultOctave?: number;
}

/**
 * The instrument catalog. Mirrors the former definition set (the General-MIDI
 * program list plus a few plucked/keyboard presets) as metadata only.
 */
export const INSTRUMENT_DEFINITIONS: InstrumentDefinition[] = [
    // Plucked / keyboard presets (rendered natively by the engine).
    { id: 'salamander-piano', name: 'Grand Piano', category: 'piano', defaultOctave: 4 },
    { id: 'karplus-acoustic', name: 'Acoustic Guitar', category: 'guitar', defaultOctave: 3 },
    { id: 'karplus-electric', name: 'Electric Guitar', category: 'guitar', defaultOctave: 3 },
    { id: 'karplus-nylon', name: 'Nylon Guitar', category: 'guitar', defaultOctave: 3 },
    { id: 'karplus-harp', name: 'Harp', category: 'strings', defaultOctave: 4 },

    // General MIDI program list (metadata only).
    { id: 'gm-acoustic-grand-piano', name: 'Acoustic Grand Piano', category: 'piano' },
    { id: 'gm-bright-acoustic-piano', name: 'Bright Acoustic Piano', category: 'piano' },
    { id: 'gm-electric-grand-piano', name: 'Electric Grand Piano', category: 'piano' },
    { id: 'gm-honky-tonk-piano', name: 'Honky-tonk Piano', category: 'piano' },
    { id: 'gm-electric-piano-1', name: 'Electric Piano 1', category: 'piano' },
    { id: 'gm-electric-piano-2', name: 'Electric Piano 2', category: 'piano' },
    { id: 'gm-harpsichord', name: 'Harpsichord', category: 'piano' },
    { id: 'gm-clavinet', name: 'Clavinet', category: 'piano' },
    { id: 'gm-celesta', name: 'Celesta', category: 'percussion' },
    { id: 'gm-glockenspiel', name: 'Glockenspiel', category: 'percussion' },
    { id: 'gm-music-box', name: 'Music Box', category: 'percussion' },
    { id: 'gm-vibraphone', name: 'Vibraphone', category: 'percussion' },
    { id: 'gm-marimba', name: 'Marimba', category: 'percussion' },
    { id: 'gm-xylophone', name: 'Xylophone', category: 'percussion' },
    { id: 'gm-tubular-bells', name: 'Tubular Bells', category: 'percussion' },
    { id: 'gm-dulcimer', name: 'Dulcimer', category: 'percussion' },
    { id: 'gm-drawbar-organ', name: 'Drawbar Organ', category: 'piano' },
    { id: 'gm-percussive-organ', name: 'Percussive Organ', category: 'piano' },
    { id: 'gm-rock-organ', name: 'Rock Organ', category: 'piano' },
    { id: 'gm-church-organ', name: 'Church Organ', category: 'piano' },
    { id: 'gm-reed-organ', name: 'Reed Organ', category: 'piano' },
    { id: 'gm-accordion', name: 'Accordion', category: 'world' },
    { id: 'gm-harmonica', name: 'Harmonica', category: 'woodwinds' },
    { id: 'gm-tango-accordion', name: 'Tango Accordion', category: 'world' },
    { id: 'gm-acoustic-guitar-nylon', name: 'Nylon Acoustic Guitar', category: 'guitar' },
    { id: 'gm-acoustic-guitar-steel', name: 'Steel Acoustic Guitar', category: 'guitar' },
    { id: 'gm-electric-guitar-jazz', name: 'Jazz Electric Guitar', category: 'guitar' },
    { id: 'gm-electric-guitar-clean', name: 'Clean Electric Guitar', category: 'guitar' },
    { id: 'gm-electric-guitar-muted', name: 'Muted Electric Guitar', category: 'guitar' },
    { id: 'gm-overdriven-guitar', name: 'Overdriven Guitar', category: 'guitar' },
    { id: 'gm-distortion-guitar', name: 'Distortion Guitar', category: 'guitar' },
    { id: 'gm-guitar-harmonics', name: 'Guitar Harmonics', category: 'guitar' },
    { id: 'gm-acoustic-bass', name: 'Acoustic Bass', category: 'bass' },
    { id: 'gm-electric-bass-finger', name: 'Electric Bass (finger)', category: 'bass' },
    { id: 'gm-electric-bass-pick', name: 'Electric Bass (pick)', category: 'bass' },
    { id: 'gm-fretless-bass', name: 'Fretless Bass', category: 'bass' },
    { id: 'gm-slap-bass-1', name: 'Slap Bass 1', category: 'bass' },
    { id: 'gm-slap-bass-2', name: 'Slap Bass 2', category: 'bass' },
    { id: 'gm-synth-bass-1', name: 'Synth Bass 1', category: 'bass' },
    { id: 'gm-synth-bass-2', name: 'Synth Bass 2', category: 'bass' },
    { id: 'gm-violin', name: 'Violin', category: 'strings' },
    { id: 'gm-viola', name: 'Viola', category: 'strings' },
    { id: 'gm-cello', name: 'Cello', category: 'strings' },
    { id: 'gm-contrabass', name: 'Contrabass', category: 'strings' },
    { id: 'gm-tremolo-strings', name: 'Tremolo Strings', category: 'strings' },
    { id: 'gm-pizzicato-strings', name: 'Pizzicato Strings', category: 'strings' },
    { id: 'gm-orchestral-harp', name: 'Orchestral Harp', category: 'strings' },
    { id: 'gm-timpani', name: 'Timpani', category: 'percussion' },
    { id: 'gm-string-ensemble-1', name: 'String Ensemble 1', category: 'strings' },
    { id: 'gm-string-ensemble-2', name: 'String Ensemble 2', category: 'strings' },
    { id: 'gm-synth-strings-1', name: 'Synth Strings 1', category: 'synth' },
    { id: 'gm-synth-strings-2', name: 'Synth Strings 2', category: 'synth' },
    { id: 'gm-choir-aahs', name: 'Choir Aahs', category: 'synth' },
    { id: 'gm-voice-oohs', name: 'Voice Oohs', category: 'synth' },
    { id: 'gm-synth-voice', name: 'Synth Voice', category: 'synth' },
    { id: 'gm-orchestra-hit', name: 'Orchestra Hit', category: 'percussion' },
    { id: 'gm-trumpet', name: 'Trumpet', category: 'brass' },
    { id: 'gm-trombone', name: 'Trombone', category: 'brass' },
    { id: 'gm-tuba', name: 'Tuba', category: 'brass' },
    { id: 'gm-muted-trumpet', name: 'Muted Trumpet', category: 'brass' },
    { id: 'gm-french-horn', name: 'French Horn', category: 'brass' },
    { id: 'gm-brass-section', name: 'Brass Section', category: 'brass' },
    { id: 'gm-synth-brass-1', name: 'Synth Brass 1', category: 'brass' },
    { id: 'gm-synth-brass-2', name: 'Synth Brass 2', category: 'brass' },
    { id: 'gm-soprano-sax', name: 'Soprano Sax', category: 'woodwinds' },
    { id: 'gm-alto-sax', name: 'Alto Sax', category: 'woodwinds' },
    { id: 'gm-tenor-sax', name: 'Tenor Sax', category: 'woodwinds' },
    { id: 'gm-baritone-sax', name: 'Baritone Sax', category: 'woodwinds' },
    { id: 'gm-oboe', name: 'Oboe', category: 'woodwinds' },
    { id: 'gm-english-horn', name: 'English Horn', category: 'woodwinds' },
    { id: 'gm-bassoon', name: 'Bassoon', category: 'woodwinds' },
    { id: 'gm-clarinet', name: 'Clarinet', category: 'woodwinds' },
    { id: 'gm-piccolo', name: 'Piccolo', category: 'woodwinds' },
    { id: 'gm-flute', name: 'Flute', category: 'woodwinds' },
    { id: 'gm-recorder', name: 'Recorder', category: 'woodwinds' },
    { id: 'gm-pan-flute', name: 'Pan Flute', category: 'woodwinds' },
    { id: 'gm-blown-bottle', name: 'Blown Bottle', category: 'percussion' },
    { id: 'gm-shakuhachi', name: 'Shakuhachi', category: 'world' },
    { id: 'gm-whistle', name: 'Whistle', category: 'woodwinds' },
    { id: 'gm-ocarina', name: 'Ocarina', category: 'woodwinds' },
    { id: 'gm-lead-square', name: 'Lead 1 (square)', category: 'synth' },
    { id: 'gm-lead-sawtooth', name: 'Lead 2 (sawtooth)', category: 'synth' },
    { id: 'gm-lead-calliope', name: 'Lead 3 (calliope)', category: 'synth' },
    { id: 'gm-lead-chiff', name: 'Lead 4 (chiff)', category: 'synth' },
    { id: 'gm-lead-charang', name: 'Lead 5 (charang)', category: 'synth' },
    { id: 'gm-lead-voice', name: 'Lead 6 (voice)', category: 'synth' },
    { id: 'gm-lead-fifths', name: 'Lead 7 (fifths)', category: 'synth' },
    { id: 'gm-lead-bass-lead', name: 'Lead 8 (bass + lead)', category: 'synth' },
    { id: 'gm-pad-new-age', name: 'Pad 1 (new age)', category: 'synth' },
    { id: 'gm-pad-warm', name: 'Pad 2 (warm)', category: 'synth' },
    { id: 'gm-pad-polysynth', name: 'Pad 3 (polysynth)', category: 'synth' },
    { id: 'gm-pad-choir', name: 'Pad 4 (choir)', category: 'synth' },
    { id: 'gm-pad-bowed', name: 'Pad 5 (bowed)', category: 'synth' },
    { id: 'gm-pad-metallic', name: 'Pad 6 (metallic)', category: 'synth' },
    { id: 'gm-pad-halo', name: 'Pad 7 (halo)', category: 'synth' },
    { id: 'gm-pad-sweep', name: 'Pad 8 (sweep)', category: 'synth' },
    { id: 'gm-fx-rain', name: 'FX 1 (rain)', category: 'synth' },
    { id: 'gm-fx-soundtrack', name: 'FX 2 (soundtrack)', category: 'synth' },
    { id: 'gm-fx-crystal', name: 'FX 3 (crystal)', category: 'synth' },
    { id: 'gm-fx-atmosphere', name: 'FX 4 (atmosphere)', category: 'synth' },
    { id: 'gm-fx-brightness', name: 'FX 5 (brightness)', category: 'synth' },
    { id: 'gm-fx-goblins', name: 'FX 6 (goblins)', category: 'synth' },
    { id: 'gm-fx-echoes', name: 'FX 7 (echoes)', category: 'synth' },
    { id: 'gm-fx-sci-fi', name: 'FX 8 (sci-fi)', category: 'synth' },
    { id: 'gm-sitar', name: 'Sitar', category: 'world' },
    { id: 'gm-banjo', name: 'Banjo', category: 'guitar' },
    { id: 'gm-shamisen', name: 'Shamisen', category: 'world' },
    { id: 'gm-koto', name: 'Koto', category: 'world' },
    { id: 'gm-kalimba', name: 'Kalimba', category: 'percussion' },
    { id: 'gm-bag-pipe', name: 'Bag Pipe', category: 'world' },
    { id: 'gm-fiddle', name: 'Fiddle', category: 'strings' },
    { id: 'gm-shanai', name: 'Shanai', category: 'world' },
    { id: 'gm-tinkle-bell', name: 'Tinkle Bell', category: 'percussion' },
    { id: 'gm-agogo', name: 'Agogo', category: 'percussion' },
    { id: 'gm-steel-drums', name: 'Steel Drums', category: 'percussion' },
    { id: 'gm-woodblock', name: 'Woodblock', category: 'percussion' },
    { id: 'gm-taiko-drum', name: 'Taiko Drum', category: 'percussion' },
    { id: 'gm-melodic-tom', name: 'Melodic Tom', category: 'percussion' },
    { id: 'gm-synth-drum', name: 'Synth Drum', category: 'percussion' },
    { id: 'gm-reverse-cymbal', name: 'Reverse Cymbal', category: 'percussion' },
    { id: 'gm-guitar-fret-noise', name: 'Guitar Fret Noise', category: 'percussion' },
    { id: 'gm-breath-noise', name: 'Breath Noise', category: 'percussion' },
    { id: 'gm-seashore', name: 'Seashore', category: 'percussion' },
    { id: 'gm-bird-tweet', name: 'Bird Tweet', category: 'percussion' },
    { id: 'gm-telephone-ring', name: 'Telephone Ring', category: 'percussion' },
    { id: 'gm-helicopter', name: 'Helicopter', category: 'percussion' },
    { id: 'gm-applause', name: 'Applause', category: 'percussion' },
    { id: 'gm-gunshot', name: 'Gunshot', category: 'percussion' },
];

/**
 * Engine-agnostic instrument metadata catalog. Replaces the deleted
 * `InstrumentLoader` for the parts the UI still needs: enumerating definitions,
 * looking one up by id, and filtering by category. No audio loading.
 */
export const InstrumentLoader = {
    /** All instrument definitions. */
    getAllDefinitions(): InstrumentDefinition[] {
        return INSTRUMENT_DEFINITIONS;
    },

    /** Look up one definition by id, or undefined. */
    getDefinition(id: string): InstrumentDefinition | undefined {
        return INSTRUMENT_DEFINITIONS.find((d) => d.id === id);
    },

    /** All definitions in a category. */
    getDefinitionsByCategory(category: InstrumentCategory): InstrumentDefinition[] {
        return INSTRUMENT_DEFINITIONS.filter((d) => d.category === category);
    },
} as const;
