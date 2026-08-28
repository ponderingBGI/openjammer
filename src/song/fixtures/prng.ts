/** Small, reproducible PRNG used only while explicitly building a fixture. */
export interface FixtureRandom {
    float(): number;
    int(min: number, max: number): number;
    pick<T>(values: readonly T[]): T;
}

export function seededRandom(seed: number): FixtureRandom {
    let state = seed >>> 0;
    const float = () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
    };
    return {
        float,
        int: (min, max) => Math.floor(float() * (max - min + 1)) + min,
        pick: <T>(values: readonly T[]) => values[Math.floor(float() * values.length)]!,
    };
}
