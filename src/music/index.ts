// src/music/index.ts — the pure music-theory library. The agent CALLS these so it
// never hand-rolls MIDI arithmetic; the human's future scale/chord/arp nodes call
// the SAME functions (one SSOT, no privileged citizen).

export * from './note';
export * from './scale';
export * from './chord';
export * from './euclid';
