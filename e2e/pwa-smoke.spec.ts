import { test, expect } from '@playwright/test';

// Render-smoke for the browser PWA target (plan §4.2 / §3). Proves the production
// bundle loads, comes up cross-origin isolated (so the SharedArrayBuffer fast
// path the wasm engine relies on is available), actually mounts the React shell,
// AND — the part that matters most — that clicking "Play here in your browser"
// brings the audio engine to life: the AudioWorklet processor registers and
// posts `ready`. The browser tier was silently DEAD in the production build
// (the worklet's wasm-bindgen `initSync` was tree-shaken, so `new
// AudioWorkletNode('ojcore-processor')` threw `InvalidStateError` in every
// browser) and the smoke stayed green because it never clicked Play. It does now.

// Console messages the app legitimately emits that must NOT fail the run. Keep
// this allowlist as tight as the app allows: the wasm executor logs a COOP/COEP
// notice on non-isolated origins, and browsers emit autoplay / COEP warnings we
// don't control. Anything OUTSIDE this list (especially `console.error`) fails.
const WARN_ALLOWLIST: RegExp[] = [
    /cross-origin isolated/i, // OjcoreWasmExecutor COOP/COEP fallback notice
    /AudioContext was (not allowed|prevented)/i, // browser autoplay policy
    /was prevented from loading/i, // COEP subresource warnings
    /Tracking Prevention/i, // WebKit ITP noise
    /Synchronous XMLHttpRequest/i, // a metadata dep (Firefox flags it); plan §6 item
];

// `console.error` lines that are caused by the HEADLESS TEST ENVIRONMENT, not an
// app defect — kept deliberately tiny. Headless browsers deny the Web MIDI
// permission, and the app's MIDIManager logs that denial; it is not a worklet/audio
// failure. Anything not matched here fails the run, so a regressed dead engine
// (which used to `console.error('worklet setup failed')`) still trips the gate.
const ERROR_ALLOWLIST: RegExp[] = [
    /Web MIDI API/i, // MIDIManager: permission denied under headless automation
];

test.describe('PWA shell', () => {
    test('loads cross-origin isolated and mounts the app', async ({ page }) => {
        const pageErrors: string[] = [];
        page.on('pageerror', (error) => {
            pageErrors.push(error.stack ?? error.message);
        });
        await page.goto('/');

        // The React app mounts into #root (index.html).
        await expect(page.locator('#root')).toBeAttached();

        // COOP/COEP (served by vite preview) must make the document cross-origin
        // isolated — the precondition for SharedArrayBuffer.
        const isolated = await page.evaluate(() => self.crossOriginIsolated);
        expect(isolated, 'crossOriginIsolated must be true (COOP/COEP served)').toBe(true);

        // And SAB must actually be constructible under that isolation.
        const hasSab = await page.evaluate(() => {
            try {
                void new SharedArrayBuffer(8);
                return true;
            } catch {
                return false;
            }
        });
        expect(hasSab, 'SharedArrayBuffer must be constructible under isolation').toBe(true);

        // Render-smoke: the shell put real content in #root (not a blank page),
        // and the browser welcome screen's primary CTA is visible. This catches
        // production bundle TDZ/circular-import crashes where #root stays empty white.
        await expect(page.locator('#root')).not.toBeEmpty();
        await expect(
            page.getByRole('button', { name: /play here in your browser/i })
        ).toBeVisible();
        expect(pageErrors, 'no uncaught startup exceptions').toEqual([]);
    });

    test('clicking "Play here" brings the AudioWorklet engine to life (posts ready)', async ({
        page,
    }) => {
        // Fail on ANY console.error; collect warnings and assert they're allowlisted.
        const consoleErrors: string[] = [];
        const consoleWarnings: string[] = [];
        page.on('console', (msg) => {
            const t = msg.type();
            if (t === 'error') consoleErrors.push(msg.text());
            else if (t === 'warning') consoleWarnings.push(msg.text());
        });
        const pageErrors: string[] = [];
        page.on('pageerror', (error) => {
            pageErrors.push(error.stack ?? error.message);
        });

        // Instrument the engine's readiness BEFORE any app code runs: wrap
        // `AudioWorkletNode` so we can observe its processor port. The worklet posts
        // `{ type: 'ready' }` once `registerProcessor('ojcore-processor')` took
        // effect and the wasm host instantiated — the exact event that was silently
        // never reached in the dead production bundle. We also record
        // `{ type: 'error' }` from the worklet so a startup throw fails the test.
        //
        // We observe by intercepting the app's OWN `port.onmessage` assignment (via a
        // property accessor) and chaining a sniffer in front of the real handler. A
        // bare `port.addEventListener` does NOT see traffic delivered to a port whose
        // consumer uses the `onmessage` setter (the app does) — so the accessor chain
        // is the portable approach across Chromium, Firefox, and WebKit.
        await page.addInitScript(() => {
            interface ProbeWindow {
                __ojWorkletReady?: boolean;
                __ojWorkletError?: string;
            }
            const w = window as unknown as ProbeWindow;
            w.__ojWorkletReady = false;
            const Orig = window.AudioWorkletNode;
            if (!Orig) return;
            class ProbedAudioWorkletNode extends Orig {
                constructor(...args: ConstructorParameters<typeof AudioWorkletNode>) {
                    super(...args);
                    if (args[1] !== 'ojcore-processor') return;
                    const port = this.port;
                    let real: ((e: MessageEvent) => void) | null = null;
                    Object.defineProperty(port, 'onmessage', {
                        configurable: true,
                        get() {
                            return real;
                        },
                        set(fn: ((e: MessageEvent) => void) | null) {
                            real = fn;
                            port.addEventListener('message', (e: MessageEvent) => {
                                const d = e.data as { type?: string; message?: string };
                                if (d?.type === 'ready') w.__ojWorkletReady = true;
                                else if (d?.type === 'error')
                                    w.__ojWorkletError = d.message ?? 'unknown worklet error';
                                real?.(e);
                            });
                            port.start();
                        },
                    });
                }
            }
            window.AudioWorkletNode =
                ProbedAudioWorkletNode as unknown as typeof AudioWorkletNode;
        });

        await page.goto('/');
        await expect(page.locator('#root')).not.toBeEmpty();

        // Playwright's WebKit build (on Linux/Windows) ships NO Web Audio API at all
        // (`AudioContext` / `AudioWorkletNode` are undefined), so the audio engine
        // cannot start there — a harness limitation, not an app defect. Skip the
        // engine-liveness assertions on such a browser; the render-smoke test above
        // still covers WebKit. Chromium and Firefox DO have Web Audio and run this
        // gate for real, so a regressed dead engine still fails the suite.
        const hasWebAudio = await page.evaluate(
            () =>
                typeof AudioContext !== 'undefined' &&
                typeof AudioWorkletNode !== 'undefined',
        );
        test.skip(!hasWebAudio, 'browser has no Web Audio API (Playwright WebKit)');

        // Click the browser-tier CTA: this resumes the AudioContext and spins up
        // the OjcoreWasmExecutor → addModule → new AudioWorkletNode → worklet init.
        await page.getByRole('button', { name: /play here in your browser/i }).click();

        // The worklet must report `ready` (audio engine alive). Before the fix this
        // never happened: the node construction threw InvalidStateError. Generous
        // timeout because it includes fetch+compile of the ~2 MB wasm module.
        await expect
            .poll(
                () =>
                    page.evaluate(
                        () =>
                            (window as unknown as { __ojWorkletReady?: boolean })
                                .__ojWorkletReady === true,
                    ),
                {
                    message: 'AudioWorklet "ojcore-processor" must post ready (engine alive)',
                    // Generous: includes fetch+compile of the ~2 MB wasm, and the
                    // configured browser projects build/run in parallel (contention).
                    timeout: 30_000,
                },
            )
            .toBe(true);

        const workletError = await page.evaluate(
            () =>
                (window as unknown as { __ojWorkletError?: string }).__ojWorkletError ??
                null,
        );
        expect(workletError, 'the worklet must not post a startup error').toBeNull();

        // No uncaught exceptions, and no UNEXPECTED console.error (the dead-engine
        // path used to `console.error('worklet setup failed')`). Environment-caused
        // errors (headless Web MIDI denial) are allowlisted; everything else fails.
        expect(pageErrors, 'no uncaught exceptions while starting audio').toEqual([]);
        const unexpectedErrors = consoleErrors.filter(
            (line) => !ERROR_ALLOWLIST.some((re) => re.test(line)),
        );
        expect(
            unexpectedErrors,
            `unexpected console.error while starting the browser engine:\n${unexpectedErrors.join('\n')}`,
        ).toEqual([]);

        // Warnings are tolerated only if every one is on the allowlist.
        const unexpectedWarnings = consoleWarnings.filter(
            (line) => !WARN_ALLOWLIST.some((re) => re.test(line)),
        );
        expect(
            unexpectedWarnings,
            `unexpected console warnings (not on allowlist):\n${unexpectedWarnings.join('\n')}`,
        ).toEqual([]);
    });
});
