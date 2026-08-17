import { describe, expect, it } from 'vitest';
import { familiesFromClapFeatures } from '../pluginFamily';

describe('CLAP plugin family mapping', () => {
    it('maps only recognizable CLAP features in shelf order', () => {
        expect(familiesFromClapFeatures(['audio-effect', 'reverb', 'filter'])).toEqual(['Filter', 'Space']);
    });
    it('does not invent Other', () => expect(familiesFromClapFeatures(['unknown-vendor-feature'])).toEqual([]));
});
