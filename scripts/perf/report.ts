import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

interface FrameStats {
    frameCount: number;
    p50Ms: number;
    p95Ms: number;
    maxMs: number;
    droppedFrames: number;
}

interface J8Summary {
    generatedAt: string;
    coldOpenMs: number;
    phases: Record<'scroll' | 'zoom' | 'drag' | 'playhead', FrameStats>;
}

interface WalltimeMetric {
    name: string;
    unit: 'frames' | 'ms';
    value: number;
    range?: string;
    extra: string;
}

const resultsDir = process.env.OJ_PERF_RESULTS_DIR ?? 'perf-results';
const statsPath = join(resultsDir, 'j8-stats.json');
const outputPath = join(resultsDir, 'codspeed-walltime.json');

let exitCode = 0;
if (!process.argv.includes('--from-existing')) {
    const child = Bun.spawn(['bun', 'run', 'test:perf'], {
        cwd: process.cwd(),
        env: { ...process.env, OJ_PERF_RESULTS_DIR: resultsDir },
        stdin: 'inherit',
        stdout: 'inherit',
        stderr: 'inherit',
    });
    exitCode = await child.exited;
}

try {
    const stats = JSON.parse(await readFile(statsPath, 'utf8')) as J8Summary;
    const phaseExtra = (name: keyof J8Summary['phases']) => {
        const phase = stats.phases[name];
        return `frames=${phase.frameCount}; p50=${phase.p50Ms}ms; p95=${phase.p95Ms}ms; max=${phase.maxMs}ms; dropped=${phase.droppedFrames}`;
    };
    // CodSpeed's walltime action measures the configured executable target; it
    // does not import arbitrary browser trace values. This stable custom JSON is
    // the closest supported sidecar shape (name/unit/value, smaller-is-better)
    // and preserves every experience metric in the uploaded Ring 3 artifact.
    const metrics: WalltimeMetric[] = [
        { name: 'J8 cold open to interactive', unit: 'ms', value: stats.coldOpenMs, extra: `recorded=${stats.generatedAt}; absolute host value is indicative` },
        { name: 'J8 full-page scroll p95 frame', unit: 'ms', value: stats.phases.scroll.p95Ms, extra: phaseExtra('scroll') },
        { name: 'J8 pointer zoom p95 frame', unit: 'ms', value: stats.phases.zoom.p95Ms, extra: phaseExtra('zoom') },
        { name: 'J8 clip drag maximum frame', unit: 'ms', value: stats.phases.drag.maxMs, extra: phaseExtra('drag') },
        { name: 'J8 rolling playhead dropped frames', unit: 'frames', value: stats.phases.playhead.droppedFrames, extra: phaseExtra('playhead') },
    ];
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(metrics, null, 2)}\n`);
    console.log(`Ring 3 walltime metrics: ${outputPath}`);
    console.log(JSON.stringify(metrics));
} catch (error) {
    console.error(`Could not emit Ring 3 metrics from ${statsPath}:`, error);
    process.exitCode = 1;
}

if (exitCode !== 0) process.exitCode = exitCode;
