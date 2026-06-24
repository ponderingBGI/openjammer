// scripts/oj/song.ts — `oj song`: author a whole song through the TIMELINE feature
// (an Arrangement), conduct it to the flat {graph, schedule} the engine plays,
// render it to audio device-free (the second clock), self-grade the result, and
// EXPORT a human-openable project. The headless author -> arrange -> produce ->
// export loop, end to end, with no GUI and no audio device.
//
//   oj song                       # produce + grade "Paper Sketch No. 1"
//   oj song --assert 'rms>0.05'   # extra render assertions pass through (real fields only)
//
// Exit code is the render gate's: 0 when the song plays + meets its assertions.

import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { conduct } from '../../src/song/conduct';
import { specToGraph } from '../../src/song/spec';
import { buildPaperSketch } from '../../src/song/songs/paperSketch';
import { exportWorkflow } from '../../src/engine/serialization';
import { render } from './render';

const ROOT = resolve(import.meta.dir, '..', '..');

export async function song(args: string[]): Promise<number> {
    const arr = buildPaperSketch();

    let result;
    try {
        result = conduct(arr);
    } catch (e) {
        process.stderr.write(`oj song: conduct failed — ${(e as Error).message}\n`);
        return 2;
    }

    const outDir = resolve(ROOT, 'target', 'audition');
    await mkdir(outDir, { recursive: true });
    const slug = arr.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
    const graphPath = resolve(outDir, `${slug}.graph.json`);
    const schedPath = resolve(outDir, `${slug}.schedule.json`);
    const wavPath = resolve(outDir, `${slug}.wav`);
    const reportPath = resolve(outDir, `${slug}.report.json`);
    const projectPath = resolve(outDir, `${slug}.openjammer`);

    await Bun.write(graphPath, JSON.stringify(result.graph, null, 2));
    await Bun.write(schedPath, JSON.stringify(result.events, null, 2));

    // EXPORT the human-openable project: the SAME Save shape `importWorkflow` reads
    // (so it opens on the canvas), with the Arrangement carried as an additive field
    // and the transport hook populated — never a lossy flat OjGraph.
    const { nodes, connections } = specToGraph(arr.graph);
    const workflow = exportWorkflow(nodes, connections, arr.name);
    await Bun.write(
        projectPath,
        JSON.stringify(
            {
                ...workflow,
                transport: { bpm: arr.tempoBpm, timeSignature: arr.timeSignature ?? [4, 4] },
                arrangement: arr,
            },
            null,
            2,
        ),
    );

    process.stdout.write(
        `oj song: "${arr.name}" — ${arr.tracks.length} tracks, ${result.events.length} events, ${result.seconds.toFixed(1)}s\n`,
    );
    process.stdout.write(`  graph    -> ${graphPath}\n`);
    process.stdout.write(`  schedule -> ${schedPath}\n`);
    process.stdout.write(`  project  -> ${projectPath}\n`);

    // Write each agent-AUTHORED code node's faust source next to the project and
    // build its `--code-node` flag; the render bin compiles each to a native .dll
    // and hosts it as a real WasmHost node. Pull `author-host` only when needed.
    const codeNodeArgs: string[] = [];
    for (const cn of result.codeNodes) {
        const safe = cn.id.replace(/[^a-z0-9]+/gi, '_');
        const dspPath = resolve(outDir, `${safe}.dsp`);
        await Bun.write(dspPath, cn.faustSource);
        codeNodeArgs.push('--code-node', `${cn.id}=${dspPath}`);
        process.stdout.write(`  authored -> ${cn.id} on "${cn.onTrack}" (${dspPath})\n`);
    }
    const features = result.codeNodes.length > 0 ? 'demo,author-host' : 'demo';

    // PRODUCE: drive the timeline through the device-free render bin and self-grade.
    const code = await render(
        [
            '--graph',
            graphPath,
            '--schedule',
            schedPath,
            '--secs',
            result.seconds.toFixed(2),
            '--out',
            wavPath,
            '--report',
            reportPath,
            ...codeNodeArgs,
            '--assert',
            'finite',
            '--assert',
            'rms>0.02',
            '--assert',
            'nonsilent_pct>20',
            ...args,
        ],
        features,
    );

    if (code === 0) {
        process.stdout.write(`oj song: PRODUCED + EXPORTED -> ${wavPath}\n`);
    } else {
        process.stderr.write(`oj song: render/grade FAILED (exit ${code}) — see ${reportPath}\n`);
    }
    return code;
}
