import { expect, type Download, type Locator, type Page } from '@playwright/test';

/** The onboarding overlay, addressed by the question it is asking. */
const ONBOARDING = /made music with a computer before/i;

export interface BootOptions {
    /**
     * Leave the first-run overlay up and answer it yourself. Default `true`
     * (skip it) — most specs are about a surface, not about the first run.
     */
    skipOnboarding?: boolean;
    /**
     * Boot as a genuinely NEW user: no stored answers, so the overlay appears
     * and finishing it installs a preset rig. Default `false`, which pre-answers
     * the run so the canvas starts empty and a spec's own fixture is the only
     * thing on it.
     */
    firstRun?: boolean;
}

/**
 * Boot the app and leave audio unlocked.
 *
 * The browser tier has an autoplay gate, and exactly one thing satisfies it: a
 * real click. Which click depends on how the app opened —
 *   • first run → "Skip, take me in" finishes with defaults AND unlocks audio in
 *     the same gesture (that is the whole point of the button);
 *   • returning user → the transport pill's play button, which unlocks audio for
 *     the same reason.
 *
 * By default this pre-answers the first run (as the "years of it" persona, so the
 * shortcut card starts collapsed and nothing floats over the stage) and no preset
 * rig is installed. Pass `{ firstRun: true }` to exercise the real first run.
 */
export async function bootApp(page: Page, options: BootOptions = {}): Promise<void> {
    const { skipOnboarding = true, firstRun = false } = options;

    if (!firstRun) {
        await page.addInitScript(() => {
            try {
                localStorage.setItem('oj-onboarding-v1', JSON.stringify({ exp: 'pro', goal: 'jam', theme: 'light' }));
            } catch {
                /* private mode — the overlay simply appears and gets skipped below */
            }
        });
    }

    await page.goto('/');
    await expect(page.locator('#root')).not.toBeEmpty();
    if (!skipOnboarding) return;

    const overlay = page.getByRole('dialog', { name: ONBOARDING });
    if (await overlay.count()) {
        await page.getByRole('button', { name: /skip, take me in/i }).first().click();
        await expect(overlay).toHaveCount(0);
        return;
    }

    // No overlay: unlock audio with the transport's own gesture.
    await page.getByRole('button', { name: /^(Play|Start sound|Hold all sound)$/ }).first().click();
}

/** The journeys' name for the same boot. Kept so their prose still reads right. */
export async function activateBrowser(page: Page): Promise<void> {
    await bootApp(page);
}

/**
 * Swap the visible surface with `Tab`, from the stage floor.
 *
 * `Tab` switches surface ONLY when the event target is `document.body` or a
 * `[data-surface-root]` element itself; anything inside a surface — a node, a
 * port, a clip, a track header — keeps native traversal (docs/shell.md, "Tab,
 * focus, and the chrome"). `bootApp` finishes by *clicking* a button, so the
 * focus is sitting on a control and a bare `Tab` there walks the chrome instead
 * of toggling. Every helper that means "show me the other surface" therefore
 * steps back onto the floor first.
 */
export async function tabToOtherSurface(page: Page): Promise<void> {
    await page.locator('body').focus();
    await page.keyboard.press('Tab');
}

export async function openStarter(page: Page, starter: 'Paper Sketch' | 'First Light' = 'Paper Sketch'): Promise<void> {
    await bootApp(page);
    await tabToOtherSurface(page);
    await page.getByRole('button', { name: new RegExp(`start from '${starter}'`, 'i') }).click();
    await expect(page.locator('.arrangement-track')).not.toHaveCount(0);
}

export async function loadFixture(page: Page, name: 'denseEdit' | 'firstLight' | 'hundredTracks' | 'pathological'): Promise<void> {
    await bootApp(page);
    await page.evaluate((fixture) => (window as unknown as { __openjammerE2E: { setFixture(name: string): void } }).__openjammerE2E.setFixture(fixture), name);
    await tabToOtherSurface(page);
    await expect(page.locator('[data-surface-root="arrangement"]')).toBeVisible();
}

export async function pointerDrag(page: Page, locator: Locator, deltaX: number, deltaY = 0, modifiers: readonly ('Alt' | 'Control' | 'Shift')[] = []): Promise<void> {
    const box = await locator.boundingBox();
    if (!box) throw new Error('Gesture target has no layout box');
    const x = box.x + Math.min(Math.max(8, box.width * 0.4), Math.max(8, box.width - 8));
    const y = box.y + box.height / 2;
    for (const modifier of modifiers) await page.keyboard.down(modifier);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + deltaX, y + deltaY, { steps: 12 });
    await page.mouse.up();
    for (const modifier of [...modifiers].reverse()) await page.keyboard.up(modifier);
}

export async function downloadBytes(download: Download): Promise<ArrayBuffer> {
    const stream = await download.createReadStream();
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream) chunks.push(Uint8Array.from(chunk));
    const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const bytes = new Uint8Array(length);
    let at = 0;
    for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
    return bytes.buffer;
}

export async function exportSong(page: Page, timeout = 150_000): Promise<ArrayBuffer> {
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Export song' });
    const pending = page.waitForEvent('download', { timeout });
    await dialog.getByRole('button', { name: 'Export song' }).click();
    return downloadBytes(await pending);
}

export async function snapshot(page: Page): Promise<unknown> {
    // `page.reload()` resolves at the document load event, which may precede
    // evaluation of a production ESM graph containing async WASM chunks. Wait
    // for the automation boundary itself instead of racing module startup.
    await page.waitForFunction(() => (
        typeof (window as unknown as { __openjammerE2E?: { snapshot?: unknown } })
            .__openjammerE2E?.snapshot === 'function'
    ));
    return page.evaluate(() => (window as unknown as { __openjammerE2E: { snapshot(): unknown } }).__openjammerE2E.snapshot());
}

/* ────────────────────────────────────────────────────────────────────────────
 * W6-E2E — helpers for the §11 T-list.
 *
 * Everything below is ADDITIVE. It exists because the T-list drives the
 * arrangement through real pointer streams and then reads the DOCUMENT, and
 * both halves of that need one vocabulary the specs can share. The selectors
 * and the gesture shapes are lifted from the W4-TBb harness
 * (`plans/redesign-new-dna/.scratch/w4-tbb/tbb.ts`), which already proved every
 * one of them headlessly — re-deriving them would be a second source of truth.
 * ──────────────────────────────────────────────────────────────────────────── */

/** The three shapes the arrangement's automation boundary hands back. */
export interface HistorySummary { cursor: number; entries: number; scopes: string[] }
export interface SelectionSummary {
    clipIds: string[];
    noteIds: string[];
    trackIds: string[];
    sectionIds: string[];
    automationPointIds: string[];
    timeRange: { fromTick: number; toTick: number; trackIds: string[] } | null;
}
export interface LoggedVerb { domain: string; verb: { kind: string; [key: string]: unknown } }

type BridgeMethod = 'snapshot' | 'history' | 'selection' | 'verbLog' | 'setFixture' | 'setAgentScript' | 'sendAgent';

/** One call into `window.__openjammerE2E`, waiting for the boundary to exist. */
export async function bridge<T>(page: Page, method: BridgeMethod, arg?: unknown): Promise<T> {
    await page.waitForFunction(() => typeof (window as unknown as { __openjammerE2E?: unknown }).__openjammerE2E === 'object');
    return page.evaluate(({ method, arg }) => {
        const api = (window as unknown as { __openjammerE2E: Record<string, (...args: unknown[]) => unknown> }).__openjammerE2E;
        return api[method]!(...(arg === undefined ? [] : [arg])) as T;
    }, { method, arg }) as Promise<T>;
}

export const historyOf = (page: Page) => bridge<HistorySummary>(page, 'history');
export const selectionOf = (page: Page) => bridge<SelectionSummary>(page, 'selection');
export const verbLogOf = (page: Page) => bridge<LoggedVerb[]>(page, 'verbLog');

/** `history().cursor` — the number of committed, undoable steps. */
export async function historyLength(page: Page): Promise<number> {
    return (await historyOf(page)).cursor;
}

/** The document as a stable string, for the spec's byte-identical assertions. */
export async function documentJson(page: Page): Promise<string> {
    return JSON.stringify(await snapshot(page));
}

/**
 * Wait until the surface's entry animation is over and the field's geometry has
 * stopped moving.
 *
 * This is not politeness, it is correctness. `.surface-transition-in` animates
 * `transform: scale(1.015) → scale(1)` over 180ms after a 60ms delay
 * (`ArrangementSurface.css`), and `getBoundingClientRect` reports the SCALED
 * box. Measuring mid-animation gives a header right edge of 197.04px instead of
 * 200 — exactly `200 / 1.015` — and every `pxPerTick` derived from it is 1.5%
 * short. A test that captures `fieldMetrics` early and asserts pixel geometry
 * late then fails by ~4px on a surface that is in fact pixel-perfect.
 *
 * The same class of bug bites AFTER a zoom, where the scale and the scroll are
 * written on different frames: read in between and you get the new `pxPerTick`
 * with the old `scrollLeft`, which puts the anchor tick 329px from where it
 * really is on a surface whose anchoring is in fact correct to 0.15px.
 *
 * So: wait for every animation on the visible surface to finish, then require
 * two consecutive agreeing measurements of the WHOLE field signature — the
 * header edge, the scale and the scroll offset together.
 */
export async function settleField(page: Page): Promise<void> {
    await page.waitForFunction(() => {
        const surface = document.querySelector('[data-surface-root]:not([hidden])');
        if (!surface) return false;
        return surface
            .getAnimations({ subtree: true })
            .every((animation) => animation.playState === 'finished' || animation.playState === 'idle');
    });
    const signature = () => page.evaluate(() => {
        const round = (value: number) => Math.round(value * 100) / 100;
        const header = document.querySelector<HTMLElement>('.arrangement-track__header');
        const clip = document.querySelector<HTMLElement>('.arrangement-clip');
        const scroll = document.querySelector<HTMLElement>('.arrangement-scroll');
        if (!header) return null;
        return [
            round(header.getBoundingClientRect().right),
            clip ? round(clip.getBoundingClientRect().width) : 0,
            clip ? round(clip.getBoundingClientRect().x) : 0,
            round(scroll?.scrollLeft ?? 0),
        ].join('|');
    });
    let last = await signature();
    for (let attempt = 0; attempt < 30; attempt += 1) {
        await page.waitForTimeout(50);
        const now = await signature();
        if (now !== null && now === last) return;
        last = now;
    }
    throw new Error('The field never stopped moving');
}

/**
 * Boot straight into a seeded arrangement. `openStarter` already does the whole
 * dance; this name is what §11 calls it, and every T-item starts here.
 */
export async function openPaperSketch(page: Page, starter: 'Paper Sketch' | 'First Light' = 'Paper Sketch'): Promise<void> {
    await openStarter(page, starter);
    await expect(page.locator('.arrangement-clip')).not.toHaveCount(0);
    await settleField(page);
}

/** The onboarding overlay, addressed the way a screen reader announces it. */
export const onboardingOverlay = (page: Page) => page.getByRole('dialog', { name: ONBOARDING });

export interface OnboardingChoice {
    exp?: 'First time' | "I've dabbled" | 'Years of it';
    goal?: 'Jam some keys' | 'Build a beat' | 'Design a sound';
    theme?: 'light' | 'dark';
}

/**
 * Walk the REAL first run to the end, pointer-first, and wait for the rig it
 * installs to finish landing.
 *
 * The third tap is the browser's autoplay gesture (`OnboardingHost` comment), so
 * this is also how a first-run spec gets audio unlocked. `goal: 'Build a beat'`
 * is the only preset carrying a Song (`rigs/presets.ts`), so it is the only way
 * to get a Song node onto the canvas headlessly.
 */
export async function completeOnboarding(page: Page, choice: OnboardingChoice = {}): Promise<void> {
    const { exp = 'Years of it', goal = 'Build a beat', theme = 'light' } = choice;
    await expect(onboardingOverlay(page)).toHaveCount(1);
    await page.getByRole('button', { name: exp, exact: false }).click();
    await page.getByRole('button', { name: goal, exact: false }).click();
    await page.locator(`.ob-swatch--${theme}`).click();
    await expect(page.locator('.ob-card')).toHaveCount(0);
    await expect(page.locator('.schematic-node')).not.toHaveCount(0);
}

/** Boot a genuinely new user straight onto a canvas that has a Song node on it. */
export async function openSongRig(page: Page): Promise<void> {
    await bootApp(page, { firstRun: true, skipOnboarding: false });
    await completeOnboarding(page, { goal: 'Build a beat' });
    await expect(page.locator('.song-node')).toHaveCount(1);
}

/** The last tick any clip in the document reaches — the song's end. */
export async function songEndTick(page: Page): Promise<number> {
    const clips = await flatClips(page);
    return clips.reduce((end, clip) => Math.max(end, clip.startTick + clip.lengthTick), 0);
}

/** Put the keyboard on the arrangement surface, where its binding set lives. */
export async function focusArrangement(page: Page): Promise<void> {
    await page.locator('[data-surface-root="arrangement"]').focus();
}

/** Which surface the player is looking at, read off the DOM the shell builds. */
export async function visibleSurface(page: Page): Promise<string | null> {
    return page.evaluate(() => {
        const shown = [...document.querySelectorAll('[data-surface-root]')].find((element) => !element.hasAttribute('hidden'));
        return shown?.getAttribute('data-surface-root') ?? null;
    });
}

/**
 * Zoom with the shipped binding, one step per press, so the test exercises the
 * same path a player does. Each step is x1.25.
 */
export async function zoomIn(page: Page, steps: number): Promise<void> {
    await focusArrangement(page);
    for (let step = 0; step < steps; step += 1) {
        const before = await pxPerBar(page);
        await page.keyboard.press('=');
        await expect.poll(() => pxPerBar(page)).toBeGreaterThan(before);
    }
}

/** Zoom in until a bar is at least `target` pixels wide (T4 wants ~200px). */
export async function zoomToBarWidth(page: Page, target: number): Promise<number> {
    await focusArrangement(page);
    for (let attempt = 0; attempt < 20; attempt += 1) {
        const width = await pxPerBar(page);
        if (width >= target) return width;
        await page.keyboard.press('=');
        await expect.poll(() => pxPerBar(page)).toBeGreaterThan(width);
    }
    throw new Error(`Could not reach ${target}px per bar`);
}

/** Live field geometry, measured the way the field itself computes it. */
export interface FieldMetrics {
    pxPerTick: number;
    ticksPerBar: number;
    pxPerBar: number;
    headerRight: number;
    scrollLeft: number;
    fieldTop: number;
}

export async function fieldMetrics(page: Page): Promise<FieldMetrics> {
    return page.evaluate(() => {
        const api = (window as unknown as { __openjammerE2E: { snapshot(): { ppq: number; timeSigNum?: number; timeSigDen?: number; tracks: Array<{ clips: Array<{ id?: string; lengthTick: number }> }> } | null } }).__openjammerE2E;
        const document_ = api.snapshot();
        const element = window.document.querySelector<HTMLElement>('.arrangement-clip');
        if (!document_ || !element) throw new Error('No arrangement on screen');
        const id = element.getAttribute('data-clip-id');
        const clip = document_.tracks.flatMap((track) => track.clips).find((item) => item.id === id);
        if (!clip) throw new Error('Rendered clip is not in the document');
        const rect = element.getBoundingClientRect();
        const pxPerTick = rect.width / clip.lengthTick;
        const beatsPerBar = document_.timeSigNum ?? 4;
        const ticksPerBar = document_.ppq * beatsPerBar * (4 / (document_.timeSigDen ?? 4));
        const header = window.document.querySelector<HTMLElement>('.arrangement-track__header');
        const scroll = window.document.querySelector<HTMLElement>('.arrangement-scroll');
        const ruler = window.document.querySelector<HTMLElement>('.arrangement-ruler-viewport');
        return {
            pxPerTick,
            ticksPerBar,
            pxPerBar: pxPerTick * ticksPerBar,
            headerRight: header ? header.getBoundingClientRect().right : 200,
            scrollLeft: scroll?.scrollLeft ?? 0,
            fieldTop: ruler ? ruler.getBoundingClientRect().bottom : 0,
        };
    });
}

export const pxPerBar = async (page: Page): Promise<number> => (await fieldMetrics(page)).pxPerBar;

export type Modifier = 'Alt' | 'Control' | 'Shift' | 'Meta';

export interface DragOptions {
    /** Held down before the press and released after the release. */
    modifiers?: readonly Modifier[];
    /** Pressed only once the pointer is already moving (snap override). */
    moveModifiers?: readonly Modifier[];
    steps?: number;
    /** Press Escape at the far end, before releasing. */
    escape?: boolean;
    /** Leave the button down and the pointer where it stopped. */
    hold?: boolean;
    /** Extra settle time at the far end, in ms. */
    dwell?: number;
}

/**
 * One pointer stream: press, cross the threshold in `steps`, release.
 *
 * `steps` matters. The gesture controller establishes its dominant axis at the
 * threshold crossing, so a single teleporting move would freeze the axis from a
 * jump instead of from a direction — which is not what a hand does.
 */
export async function dragBy(page: Page, from: { x: number; y: number }, deltaX: number, deltaY = 0, options: DragOptions = {}): Promise<void> {
    const { modifiers = [], moveModifiers = [], steps = 12, escape = false, hold = false, dwell = 0 } = options;
    for (const modifier of modifiers) await page.keyboard.down(modifier);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + deltaX / 4, from.y + deltaY / 4, { steps: Math.max(2, Math.round(steps / 4)) });
    for (const modifier of moveModifiers) await page.keyboard.down(modifier);
    await page.mouse.move(from.x + deltaX, from.y + deltaY, { steps });
    if (dwell) await page.waitForTimeout(dwell);
    if (escape) await page.keyboard.press('Escape');
    if (hold) return;
    await page.mouse.up();
    for (const modifier of [...moveModifiers].reverse()) await page.keyboard.up(modifier);
    for (const modifier of [...modifiers].reverse()) await page.keyboard.up(modifier);
}

/** Finish a `hold: true` drag. */
export async function releaseDrag(page: Page, options: DragOptions = {}): Promise<void> {
    await page.mouse.up();
    for (const modifier of [...(options.moveModifiers ?? [])].reverse()) await page.keyboard.up(modifier);
    for (const modifier of [...(options.modifiers ?? [])].reverse()) await page.keyboard.up(modifier);
}

/**
 * Grab a clip and move it.
 *
 * The grab point is deliberately kept clear of the header column: the header's
 * col-resize grip is 6px wide at z-index 20, so a clip that starts at tick 0
 * has its first ~3 pixels covered by it. Pressing there resizes the header
 * instead of moving the clip — silently, and the document never changes.
 */
export async function clipGrabPoint(page: Page, clip: Locator, fromLeft = 24): Promise<{ x: number; y: number }> {
    const box = await clip.boundingBox();
    if (!box) throw new Error('Clip has no layout box');
    const { headerRight } = await fieldMetrics(page);
    return { x: Math.max(box.x + fromLeft, headerRight + 12), y: box.y + box.height / 2 };
}

export async function dragClip(page: Page, clip: Locator, deltaX: number, deltaY = 0, options: DragOptions = {}): Promise<void> {
    await dragBy(page, await clipGrabPoint(page, clip), deltaX, deltaY, options);
}

/** Drag a clip start or end edge. The hit zone is min(8px, width/2 - 1). */
export async function dragClipEdge(page: Page, clip: Locator, edge: 'start' | 'end', deltaX: number, options: DragOptions = {}): Promise<void> {
    const box = await clip.boundingBox();
    if (!box) throw new Error('Clip has no layout box');
    const x = edge === 'start' ? box.x + 3 : box.x + box.width - 3;
    await dragBy(page, { x, y: box.y + box.height / 2 }, deltaX, 0, options);
}

/** Every clip in the document, flattened, with the track it sits on. */
export interface FlatClip { id: string; trackId: string; startTick: number; lengthTick: number; sourceId: string; sourceStart?: number; mute?: boolean }

export async function flatClips(page: Page): Promise<FlatClip[]> {
    const document_ = await snapshot(page) as { tracks: Array<{ id?: string; ref: string; clips: Array<Record<string, unknown>> }> };
    return document_.tracks.flatMap((track) => track.clips.map((clip) => ({ ...(clip as unknown as FlatClip), trackId: track.id ?? track.ref })));
}

export const clipCount = async (page: Page): Promise<number> => (await flatClips(page)).length;

/** The document locations, by kind. */
export async function locationsOf(page: Page): Promise<Array<{ id?: string; name: string; kind: string; startTick: number; endTick?: number }>> {
    const document_ = await snapshot(page) as { locations?: Array<{ id?: string; name: string; kind: string; startTick: number; endTick?: number }> };
    return document_.locations ?? [];
}

/**
 * Stub the engine transport confirmations.
 *
 * MUST be called before `bootApp`. Headless Chromium runs the real wasm
 * worklet, but nothing downstream of it ever returns a TransportFrame, so the
 * store honestly refuses to claim it is playing ("The audio engine did not
 * acknowledge the transport command"). That is correct product behaviour and
 * useless as a test fixture, so — exactly as `e2e/timeline-preview.spec.ts`
 * already does — we mirror the frames a live W3 worklet would send. Anything
 * asserting isPlaying needs this; nothing else does.
 *
 * `samplesPerFrame` is how fast the stub engine runs. The default matches
 * `timeline-preview.spec.ts`; raise it to reach the end of a song quickly.
 */
export async function installEngineProbe(page: Page, options: { samplesPerFrame?: number } = {}): Promise<void> {
    const samplesPerFrame = options.samplesPerFrame ?? 960;
    await page.addInitScript((step: number) => {
        interface Probe { __ojWorkletReady?: boolean; __ojPosted?: Array<{ type: string; kind?: string }> }
        const w = window as unknown as Probe;
        w.__ojWorkletReady = false;
        w.__ojPosted = [];
        const Original = window.AudioWorkletNode;
        if (!Original) return;
        class Probed extends Original {
            constructor(...args: ConstructorParameters<typeof AudioWorkletNode>) {
                super(...args);
                if (args[1] !== 'ojcore-processor') return;
                const port = this.port;
                port.addEventListener('message', (event: MessageEvent) => {
                    if ((event.data as { type?: string })?.type === 'ready') w.__ojWorkletReady = true;
                });
                port.start();
                const originalPost = port.postMessage.bind(port);
                let engineSample = 0;
                let timer: number | null = null;
                const emit = (motion: number) => {
                    port.dispatchEvent(new MessageEvent('message', { data: {
                        type: 'transport',
                        frame: { sample: engineSample, tick: engineSample / 25, bar: 1, beat: 1, phase: 0, motion, rec: false, loop_on: false },
                    } }));
                };
                (port as MessagePort).postMessage = (message: unknown, transfer?: unknown) => {
                    try {
                        const parsed = message as { type?: string; bytes?: Uint8Array };
                        if (parsed?.type === 'command' && parsed.bytes) {
                            const command = JSON.parse(new TextDecoder().decode(parsed.bytes)) as Record<string, { samples: number }> | string;
                            const kind = typeof command === 'string' ? command : Object.keys(command)[0];
                            w.__ojPosted!.push({ type: 'command', kind });
                            if (kind === 'Seek' && typeof command !== 'string') { engineSample = command.Seek!.samples; queueMicrotask(() => emit(0)); }
                            if (kind === 'TransportPlay') {
                                if (timer !== null) window.clearInterval(timer);
                                queueMicrotask(() => emit(1));
                                timer = window.setInterval(() => { engineSample += step; emit(1); }, 20);
                            } else if (kind === 'TransportPause') {
                                if (timer !== null) window.clearInterval(timer);
                                timer = null;
                                queueMicrotask(() => emit(0));
                            }
                        } else if (parsed?.type) {
                            w.__ojPosted!.push({ type: parsed.type });
                        }
                    } catch {
                        // Best-effort probe; never break the real post.
                    }
                    return (originalPost as (m: unknown, t?: unknown) => void)(message, transfer);
                };
            }
        }
        window.AudioWorkletNode = Probed as unknown as typeof AudioWorkletNode;
    }, samplesPerFrame);
}

/** What the shipped transport says about itself, read the way a player reads it. */
export const playButton = (page: Page) => page.locator('.oj-transport__play');
export const positionReadout = (page: Page) => page.locator('.oj-transport__position');

export async function isPlaying(page: Page): Promise<boolean> {
    return (await playButton(page).getAttribute('aria-label')) === 'Stop';
}

/** `Playhead at 4.1` reads back as `4.1`. */
export async function playheadDisplay(page: Page): Promise<string> {
    const label = await positionReadout(page).getAttribute('aria-label');
    return (label ?? '').replace(/^Playhead at\s*/, '');
}
