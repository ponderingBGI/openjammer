import { resolve } from 'node:path';
import { buildFirstLight } from '../../src/song/songs/firstLight';

export { buildFirstLight };
export const firstLight = buildFirstLight();
export default firstLight;

if (import.meta.main) {
    const index = Bun.argv.indexOf('--out');
    const requested = index >= 0 ? Bun.argv[index + 1] : undefined;
    if (!requested) {
        console.error('Usage: bun scripts/demo/first-light.ts --out <path.json>');
        process.exitCode = 2;
    } else {
        const out = resolve(requested);
        await Bun.write(out, `${JSON.stringify(firstLight, null, 2)}\n`);
        console.log(`First Light -> ${out}`);
    }
}
