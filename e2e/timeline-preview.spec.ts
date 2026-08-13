import { test, expect } from '@playwright/test';

// Timeline live-preview proof (WF5 / slice 5c). The on-canvas timeline's transport
// must actually DRIVE the audio engine, not merely move a playhead: pressing Play
// loads the conducted arrangement graph into the AudioWorklet and dispatches real
// NoteOn commands; pressing Stop releases them. We cannot "hear" in headless CI, so
// we instrument the worklet port and assert the exact messages the engine receives —
// the audible chain is then closed by the kernels (the headless WAV grades them) plus
// these commands reaching the engine. A silent transport (the half-wired state the
// covenant forbids) fails this gate.

const WARN_ALLOWLIST: RegExp[] = [
    /cross-origin isolated/i,
    /AudioContext was (not allowed|prevented)/i,
    /was prevented from loading/i,
    /Tracking Prevention/i,
    /Synchronous XMLHttpRequest/i,
];
const ERROR_ALLOWLIST: RegExp[] = [/Web MIDI API/i];

test.describe('Timeline live preview', () => {
    test('Play loads the arrangement graph + dispatches NoteOn; Stop releases', async ({ page }) => {
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
            }
            const w = window as unknown as Probe;
            w.__ojWorkletReady = false;
            w.__ojPosted = [];
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
                    (port as MessagePort).postMessage = (msg: unknown, transfer?: unknown) => {
                        try {
                            const m = msg as { type?: string; bytes?: Uint8Array };
                            if (m?.type === 'graph') {
                                w.__ojPosted!.push({ type: 'graph' });
                            } else if (m?.type === 'command' && m.bytes) {
                                const cmd = JSON.parse(new TextDecoder().decode(m.bytes));
                                const kind = typeof cmd === 'string' ? cmd : Object.keys(cmd)[0];
                                w.__ojPosted!.push({ type: 'command', kind });
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

        // Add a Song node (Utility → Add Song), enter its timeline, seed Paper Sketch.
        const canvas = page.locator('.node-canvas').first();
        const box = (await canvas.boundingBox())!;
        // Open the menu centred-but-high: clear of the top-left first-run toast and
        // the top-centre toolbar, yet high enough that the Utility submenu fits.
        await page.mouse.click(box.x + box.width / 2, box.y + 170, { button: 'right' });
        await page.getByText('Utility', { exact: false }).last().click();
        await page.getByRole('menuitem', { name: /Add Song/i }).click();
        await expect(page.locator('.song-node')).toHaveCount(1);
        await page.locator('.song-node-header').first().click();
        await page.keyboard.press('e');
        await expect(page.locator('.song-interior')).toBeVisible();
        await page.getByRole('button', { name: /Start from/i }).click();
        await expect(page.locator('.song-track')).toHaveCount(3);

        // Isolate the messages caused by pressing Play.
        await page.evaluate(() => {
            (window as { __ojPosted?: unknown[] }).__ojPosted!.length = 0;
        });

        // PLAY: the transport must load the arrangement graph and dispatch NoteOn.
        await page.getByTitle('Play').click();
        await expect
            .poll(
                () =>
                    page.evaluate(
                        () =>
                            ((window as { __ojPosted?: Array<{ type: string; kind?: string }> }).__ojPosted ?? []).filter(
                                (m) => m.type === 'command' && m.kind === 'NoteOn',
                            ).length,
                    ),
                { message: 'pressing Play must dispatch NoteOn to the engine', timeout: 8000 },
            )
            .toBeGreaterThan(0);

        const posted = await page.evaluate(
            () => (window as { __ojPosted?: Array<{ type: string; kind?: string }> }).__ojPosted ?? [],
        );
        // The arrangement graph was loaded into the worklet …
        expect(posted.some((m) => m.type === 'graph'), 'Play must load the arrangement graph').toBe(true);
        // … and a SetParam rode in too (Paper Sketch automates the filter sweep).
        expect(posted.some((m) => m.kind === 'SetParam')).toBe(true);

        // STOP: must release sounding notes (no stuck voices) — a held note beats a glitch.
        await page.getByTitle('Stop').click();
        await expect
            .poll(
                () =>
                    page.evaluate(
                        () =>
                            ((window as { __ojPosted?: Array<{ type: string; kind?: string }> }).__ojPosted ?? []).filter(
                                (m) => m.kind === 'NoteOff',
                            ).length,
                    ),
                { message: 'pressing Stop must release notes (NoteOff)', timeout: 5000 },
            )
            .toBeGreaterThan(0);

        // No uncaught exceptions, no unexpected console noise while previewing audio.
        expect(pageErrors, 'no uncaught exceptions during timeline preview').toEqual([]);
        const unexpectedErrors = consoleErrors.filter((l) => !ERROR_ALLOWLIST.some((re) => re.test(l)));
        expect(unexpectedErrors, `unexpected console.error:\n${unexpectedErrors.join('\n')}`).toEqual([]);
        const unexpectedWarnings = consoleWarnings.filter((l) => !WARN_ALLOWLIST.some((re) => re.test(l)));
        expect(unexpectedWarnings, `unexpected console.warn:\n${unexpectedWarnings.join('\n')}`).toEqual([]);
    });
});
