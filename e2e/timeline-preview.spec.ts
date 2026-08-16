import { test, expect } from '@playwright/test';

// ENGINE W3 proof: the worklet receives immutable tempo/timeline documents and one
// transport verb. The harness mirrors the EngineFrame::Transport snapshots a real W3
// worklet returns so the UI is tested against engine-confirmed motion, never its own
// AudioContext clock.

const WARN_ALLOWLIST: RegExp[] = [
    /cross-origin isolated/i,
    /AudioContext was (not allowed|prevented)/i,
    /was prevented from loading/i,
    /Tracking Prevention/i,
    /Synchronous XMLHttpRequest/i,
];
const ERROR_ALLOWLIST: RegExp[] = [/Web MIDI API/i];

test.describe('Timeline live preview', () => {
    test('Play publishes the engine timeline; Stop sends only TransportPause', async ({ page }) => {
        const consoleErrors: string[] = [];
        const consoleWarnings: string[] = [];
        page.on('console', (msg) => {
            if (msg.type() === 'error') consoleErrors.push(msg.text());
            else if (msg.type() === 'warning') consoleWarnings.push(msg.text());
        });
        const pageErrors: string[] = [];
        page.on('pageerror', (e) => pageErrors.push(e.stack ?? e.message));

        // Instrument BEFORE app code: mark worklet-ready (engine alive) and record the
        // type/kind of every message the app posts to the worklet port, decoding the
        // command bytes so we can see NoteOn / NoteOff / SetParam / graph loads.
        await page.addInitScript(() => {
            interface Probe {
                __ojWorkletReady?: boolean;
                __ojPosted?: Array<{ type: string; kind?: string }>;
                __ojTimelineSetParams?: number;
            }
            const w = window as unknown as Probe;
            w.__ojWorkletReady = false;
            w.__ojPosted = [];
            w.__ojTimelineSetParams = 0;
            const Orig = window.AudioWorkletNode;
            if (!Orig) return;
            class Probed extends Orig {
                constructor(...args: ConstructorParameters<typeof AudioWorkletNode>) {
                    super(...args);
                    if (args[1] !== 'ojcore-processor') return;
                    const port = this.port;
                    // Worklet-ready signal.
                    port.addEventListener('message', (e: MessageEvent) => {
                        const d = e.data as { type?: string };
                        if (d?.type === 'ready') w.__ojWorkletReady = true;
                    });
                    port.start();
                    // Record everything the app posts TO the worklet.
                    const origPost = port.postMessage.bind(port);
                    let engineSample = 0;
                    let transportTimer: number | null = null;
                    const emitTransport = (motion: number) => {
                        port.dispatchEvent(new MessageEvent('message', { data: {
                            type: 'transport',
                            frame: {
                                sample: engineSample,
                                tick: engineSample / 25,
                                bar: 1,
                                beat: 1,
                                phase: 0,
                                motion,
                                rec: false,
                                loop_on: false,
                            },
                        } }));
                    };
                    (port as MessagePort).postMessage = (msg: unknown, transfer?: unknown) => {
                        try {
                            const m = msg as { type?: string; bytes?: Uint8Array };
                            if (m?.type === 'graph') {
                                w.__ojPosted!.push({ type: 'graph' });
                            } else if (m?.type === 'load_tempo_map' || m?.type === 'load_timeline') {
                                w.__ojPosted!.push({ type: m.type });
                                if (m.type === 'load_timeline' && m.bytes) {
                                    const timeline = JSON.parse(new TextDecoder().decode(m.bytes)) as { events?: Array<{ kind?: number }> };
                                    w.__ojTimelineSetParams = (timeline.events ?? []).filter((event) => event.kind === 0).length;
                                }
                            } else if (m?.type === 'command' && m.bytes) {
                                const cmd = JSON.parse(new TextDecoder().decode(m.bytes));
                                const kind = typeof cmd === 'string' ? cmd : Object.keys(cmd)[0];
                                w.__ojPosted!.push({ type: 'command', kind });
                                if (kind === 'Seek') engineSample = cmd.Seek.samples;
                                if (kind === 'TransportPlay') {
                                    if (transportTimer !== null) window.clearInterval(transportTimer);
                                    queueMicrotask(() => emitTransport(1));
                                    transportTimer = window.setInterval(() => {
                                        engineSample += 960;
                                        emitTransport(1);
                                    }, 20);
                                } else if (kind === 'TransportPause') {
                                    if (transportTimer !== null) window.clearInterval(transportTimer);
                                    transportTimer = null;
                                    queueMicrotask(() => emitTransport(0));
                                }
                            }
                        } catch {
                            // best-effort probe; never break the real post
                        }
                        return (origPost as (m: unknown, t?: unknown) => void)(msg, transfer);
                    };
                }
            }
            window.AudioWorkletNode = Probed as unknown as typeof AudioWorkletNode;
        });

        await page.goto('/');
        await expect(page.locator('#root')).not.toBeEmpty();

        const hasWebAudio = await page.evaluate(
            () => typeof AudioContext !== 'undefined' && typeof AudioWorkletNode !== 'undefined',
        );
        test.skip(!hasWebAudio, 'browser has no Web Audio API (Playwright WebKit)');

        // Bring the engine to life.
        await page.getByRole('button', { name: /play here in your browser/i }).click();
        await expect
            .poll(() => page.evaluate(() => (window as { __ojWorkletReady?: boolean }).__ojWorkletReady === true), {
                timeout: 30_000,
            })
            .toBe(true);

        // Dismiss the latency banner so it doesn't intercept clicks.
        const dismiss = page.getByRole('button', { name: /^Dismiss$/i });
        if (await dismiss.count()) {
            try {
                await dismiss.first().click({ timeout: 2000 });
            } catch {
                /* not present */
            }
        }

        // Add a Song node (Utility → Add Song), use the global Tab gesture to open
        // its peer arrangement surface, then seed Paper Sketch.
        const canvas = page.locator('.node-canvas').first();
        const box = (await canvas.boundingBox())!;
        // Open the menu centred-but-high: clear of the top-left first-run toast and
        // the top-centre toolbar, yet high enough that the Utility submenu fits.
        await page.mouse.click(box.x + box.width / 2, box.y + 170, { button: 'right' });
        await page.getByText('Utility', { exact: false }).last().click();
        await page.getByRole('menuitem', { name: /Add Song/i }).click();
        await expect(page.locator('.song-node')).toHaveCount(1);
        await page.keyboard.press('Tab');
        await expect(page.locator('[data-surface-root="canvas"]')).toBeHidden();
        await expect(page.locator('[data-surface-root="arrangement"]')).toBeVisible();
        await expect(page.getByRole('heading', { name: 'An empty page.' })).toBeVisible();
        await page.getByRole('button', { name: /Start from 'Paper Sketch'/i }).click();
        await expect(page.locator('.arrangement-track')).toHaveCount(3);
        await expect(page.locator('.arrangement-clip')).toHaveCount(3);

        // Wave 6: reveal the first track's automation lane, author a Linear ramp,
        // and prove the published immutable timeline contains the densified
        // SetParam schedule (not pointer-time commands).
        await page.getByRole('button', { name: /Show automation for/i }).first().click();
        const automation = page.locator('.arrangement-automation__field').first();
        await expect(automation).toBeVisible();
        await page.getByRole('tab', { name: 'Linear' }).first().click();
        const pointsBefore = await automation.locator('.arrangement-automation__point').count();
        await automation.dblclick({ position: { x: 24, y: 72 } });
        await automation.dblclick({ position: { x: 160, y: 20 } });
        await expect(automation.locator('.arrangement-automation__point')).toHaveCount(pointsBefore + 2);

        // Isolate the messages caused by pressing Play.
        await page.evaluate(() => {
            (window as { __ojPosted?: unknown[] }).__ojPosted!.length = 0;
        });

        // PLAY: whole authored documents + one transport verb, then engine frames
        // (simulated above) move the playhead.
        const playheadBefore = await page.locator('.arrangement-playhead').evaluate((element) => (element as HTMLElement).style.transform);
        await page.getByTitle('Play').click();
        await expect.poll(() => page.locator('.arrangement-playhead').evaluate((element) => (element as HTMLElement).style.transform)).not.toBe(playheadBefore);
        await expect.poll(() => page.evaluate(() =>
            ((window as { __ojPosted?: Array<{ type: string; kind?: string }> }).__ojPosted ?? [])
                .some((m) => m.kind === 'TransportPlay'),
        )).toBe(true);
        await expect.poll(() => page.evaluate(() => (window as { __ojTimelineSetParams?: number }).__ojTimelineSetParams ?? 0)).toBeGreaterThan(2);

        const posted = await page.evaluate(
            () => (window as { __ojPosted?: Array<{ type: string; kind?: string }> }).__ojPosted ?? [],
        );
        expect(posted.some((m) => m.type === 'graph'), 'Play must load the arrangement graph').toBe(true);
        expect(posted.some((m) => m.type === 'load_tempo_map')).toBe(true);
        expect(posted.some((m) => m.type === 'load_timeline')).toBe(true);
        expect(posted.some((m) => m.kind === 'NoteOn')).toBe(false);
        expect(posted.some((m) => m.kind === 'SetParam')).toBe(false);

        // STOP: held-note masks are engine-owned. TS sends one pause and no NoteOff flood.
        await page.getByTitle('Stop').click();
        await expect.poll(() => page.evaluate(() =>
            ((window as { __ojPosted?: Array<{ type: string; kind?: string }> }).__ojPosted ?? [])
                .filter((m) => m.kind === 'TransportPause').length,
        )).toBe(1);
        const stoppedPosted = await page.evaluate(
            () => (window as { __ojPosted?: Array<{ type: string; kind?: string }> }).__ojPosted ?? [],
        );
        expect(stoppedPosted.some((m) => m.kind === 'NoteOff')).toBe(false);

        // W5 piano roll: inline expansion keeps the arrangement axis, drawing
        // auditions through the worklet command seam, palette quantize is atomic,
        // and one undo restores the pre-quantized onset.
        await page.locator('.arrangement-clip').first().dblclick({ position: { x: 28, y: 34 } });
        const roll = page.locator('.piano-roll--inline');
        await expect(roll).toBeVisible();
        await page.getByRole('button', { name: 'Snap to grid' }).click();
        const noteCount = await roll.locator('.piano-roll-note:not(.piano-roll-note--elsewhere):not(.piano-roll-note--draw)').count();
        await roll.locator('.piano-roll__field').evaluate((element) => {
            const rect = element.getBoundingClientRect();
            element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: rect.left + 137, clientY: rect.top + 9 }));
        });
        await expect(roll.locator('.piano-roll-note:not(.piano-roll-note--elsewhere):not(.piano-roll-note--draw)')).toHaveCount(noteCount + 1);
        await expect.poll(() => page.evaluate(() =>
            ((window as { __ojPosted?: Array<{ type: string; kind?: string }> }).__ojPosted ?? []).some((m) => m.kind === 'NoteOn'),
        )).toBe(true);
        const selectedNote = roll.locator('.piano-roll-note.is-selected').last();
        const beforeQuantize = await selectedNote.evaluate((element) => (element as HTMLElement).style.left);
        await page.keyboard.press('Control+k');
        await page.locator('.command-bar-input').fill('Quantize selected notes');
        await page.getByText('Quantize selected notes', { exact: true }).click();
        await expect.poll(() => selectedNote.evaluate((element) => (element as HTMLElement).style.left)).not.toBe(beforeQuantize);
        await page.keyboard.press('Control+z');
        await expect.poll(() => selectedNote.evaluate((element) => (element as HTMLElement).style.left)).toBe(beforeQuantize);

        // No uncaught exceptions, no unexpected console noise while previewing audio.
        expect(pageErrors, 'no uncaught exceptions during timeline preview').toEqual([]);
        const unexpectedErrors = consoleErrors.filter((l) => !ERROR_ALLOWLIST.some((re) => re.test(l)));
        expect(unexpectedErrors, `unexpected console.error:\n${unexpectedErrors.join('\n')}`).toEqual([]);
        const unexpectedWarnings = consoleWarnings.filter((l) => !WARN_ALLOWLIST.some((re) => re.test(l)));
        expect(unexpectedWarnings, `unexpected console.warn:\n${unexpectedWarnings.join('\n')}`).toEqual([]);
    });
});
