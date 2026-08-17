export const PLUGIN_FAMILIES = [
    'Keys', 'Synth', 'Drums', 'Sampler',
    'Filter', 'Space', 'Drive', 'Dynamics', 'Utility',
] as const;

export type PluginFamily = (typeof PLUGIN_FAMILIES)[number];

const CLAP_FEATURE_FAMILY: ReadonlyArray<readonly [string, PluginFamily]> = [
    ['piano', 'Keys'], ['keyboard', 'Keys'],
    ['synthesizer', 'Synth'], ['synth', 'Synth'],
    ['drum', 'Drums'],
    ['sampler', 'Sampler'],
    ['filter', 'Filter'],
    ['reverb', 'Space'], ['delay', 'Space'],
    ['distortion', 'Drive'],
    ['compressor', 'Dynamics'], ['limiter', 'Dynamics'],
    ['utility', 'Utility'], ['analyzer', 'Utility'],
];

/** OPEN-3: family tags are derived only from CLAP features. */
export function familiesFromClapFeatures(features: readonly string[] = []): PluginFamily[] {
    const lowered = features.map((feature) => feature.toLowerCase());
    return PLUGIN_FAMILIES.filter((family) =>
        CLAP_FEATURE_FAMILY.some(([needle, mapped]) => mapped === family && lowered.some((feature) => feature.includes(needle))),
    );
}

export function familyForBuiltIn(category: string, name: string): PluginFamily | undefined {
    const value = `${category} ${name}`.toLowerCase();
    if (/piano|keys|keyboard/.test(value)) return 'Keys';
    if (/synth|instrument/.test(value)) return 'Synth';
    if (/drum/.test(value)) return 'Drums';
    if (/sampler/.test(value)) return 'Sampler';
    if (/filter/.test(value)) return 'Filter';
    if (/reverb|delay|space/.test(value)) return 'Space';
    if (/drive|distort|waveshap/.test(value)) return 'Drive';
    if (/compress|limit|dynamics/.test(value)) return 'Dynamics';
    if (/utility|pan|width|gain/.test(value)) return 'Utility';
    return undefined;
}
