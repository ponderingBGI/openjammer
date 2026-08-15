import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function cssFiles(root: string): string[] {
    return readdirSync(root).flatMap((name) => {
        const path = join(root, name);
        return statSync(path).isDirectory() ? cssFiles(path) : path.endsWith('.css') ? [path] : [];
    });
}

describe('Arrangement semantic color gate', () => {
    it('contains no hex, rgb, rgba, hsl, or hsla literals', () => {
        const root = join(process.cwd(), 'src/components/Arrangement');
        const offenders = cssFiles(root).filter((path) => /#[\da-f]{3,8}\b|rgba?\s*\(|hsla?\s*\(/i.test(readFileSync(path, 'utf8')));
        expect(offenders).toEqual([]);
    });
});
