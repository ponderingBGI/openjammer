import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { assertAudiblePeak, assertMusicalDuration, assertSectionsDiffer, barWindowRms, decodeWav, energyFingerprint } from '../e2e/helpers/audio';
import type { Arrangement } from '../src/song/types';
import { TauriWebDriver, waitForDriver } from './webdriver';

const enabled = process.env.OJ_NATIVE_E2E_RUN === '1';
const root = resolve(import.meta.dir, '..');
const binary = process.env.OJ_NATIVE_APP ?? resolve(root, 'target', 'debug', process.platform === 'win32' ? 'openjammer.exe' : 'openjammer');
let stateDir = '';
let outputDir = '';
let driverProcess: ReturnType<typeof Bun.spawn> | null = null;
let browser: TauriWebDriver;
let sessionNumber = 0;

async function clickXpath(xpath: string, timeout = 15_000): Promise<void> {
    await browser.click(await browser.waitFor('xpath', xpath, timeout));
}

async function openStarter(name: 'Paper Sketch' | 'First Light'): Promise<void> {
    // `#root` is static index.html, so it exists before React commits and before
    // the keymap arbiter's window keydown listener attaches (a mount effect).
    // PR #72's Linux lane hit exactly that gap: the Tab below was swallowed, the
    // surface stayed on canvas, and the starter click failed with `element not
    // interactable` because the arrangement layer still rendered `hidden`
    // (locally reproduced under xvfb: one trusted Tab keydown recorded, surface
    // unchanged). Wait for a React-rendered surface first, then require the Tab
    // to have actually switched surfaces before touching the starter button,
    // re-sending it only if the switch never landed.
    await browser.waitFor('css selector', '[data-surface-root="canvas"]', 30_000);
    for (let attempt = 0; ; attempt++) {
        await browser.keys(['\uE004']); // Tab switches canvas -> arrangement.
        try {
            await browser.waitFor('css selector', '[data-surface-root="arrangement"]:not([hidden])', 2_000);
            break;
        } catch (error) {
            if (attempt >= 4) throw error;
        }
    }
    await clickXpath(`//button[contains(normalize-space(.), "Start from '${name}'")]`);
    await browser.waitFor('css selector', '.arrangement-track');
}

async function snapshot(): Promise<Arrangement> {
    return browser.execute<Arrangement>('return window.__openjammerE2E.snapshot()');
}

async function startSession(): Promise<void> {
    await browser?.quit();
    browser = new TauriWebDriver();
    const webviewProfile = resolve(stateDir, `webview-profile-${sessionNumber++}`);
    await mkdir(webviewProfile, { recursive: true });
    await browser.start(binary, process.platform === 'win32' ? webviewProfile : undefined);
    await browser.waitFor('css selector', '#root', 30_000);
    // React-mount gate: `#root` is static index.html and can be found tens of
    // seconds before React commits under xvfb. Anything a journey does next —
    // key presses, CustomEvent dispatches (DevLog toggle), reading recovery
    // state — needs the app's mount-time listeners live, so wait for a
    // React-rendered surface before returning.
    await browser.waitFor('css selector', '[data-surface-root="canvas"]', 30_000);
}

beforeAll(async () => {
    if (!enabled) return;
    if (!existsSync(binary)) throw new Error(`Native app is not built: ${binary}`);
    stateDir = await mkdtemp(resolve(tmpdir(), 'openjammer-native-state-'));
    outputDir = await mkdtemp(resolve(tmpdir(), 'openjammer-native-output-'));
    driverProcess = Bun.spawn(['tauri-driver'], {
        cwd: root,
        env: {
            ...process.env,
            OJ_DEV_SKIP_PI: '1',
            OJ_NATIVE_E2E: '1',
            OJ_NATIVE_E2E_DIR: stateDir,
            XDG_DATA_HOME: stateDir,
            LOCALAPPDATA: stateDir,
            APPDATA: stateDir,
        },
        stdout: 'inherit', stderr: 'inherit',
    });
    await waitForDriver();
}, 30_000);

afterAll(async () => {
    if (!enabled) return;
    await browser?.quit();
    driverProcess?.kill();
    await Promise.all([rm(stateDir, { recursive: true, force: true }), rm(outputDir, { recursive: true, force: true })]);
});

afterEach(async () => {
    if (!enabled) return;
    // A failed assertion must not strand WebKitWebDriver's one allowed session
    // and turn every later journey into "Maximum number of active sessions".
    await browser?.quit();
});

describe.skipIf(!enabled)('tauri-driver native journeys', () => {
    test('N1 — First Light plays in the native engine and exports analyzed audio', async () => {
        await startSession();
        await openStarter('First Light');
        // CI-gated native plugin insertion doorway: the Browser remains one
        // shelf even when the runner has no third-party binary installed.
        await browser.execute("window.dispatchEvent(new CustomEvent('openjammer:open-browser', {detail:{context:'insert'}}))");
        await browser.waitFor('xpath', '//*[@role="dialog" and @aria-label="Browser"]');
        await clickXpath('//*[@role="listbox"]//*[@role="option"][1]//button');
        const beforePlayhead = await browser.execute<string>('return document.querySelector(".arrangement-playhead")?.style.transform || ""');
        await clickXpath('//button[@title="Play"]');
        await browser.waitFor('xpath', '//button[@title="Stop"]');
        const playheadDeadline = Date.now() + 10_000;
        let afterPlayhead = beforePlayhead;
        while (afterPlayhead === beforePlayhead && Date.now() < playheadDeadline) {
            await Bun.sleep(100);
            afterPlayhead = await browser.execute<string>('return document.querySelector(".arrangement-playhead")?.style.transform || ""');
        }
        expect(afterPlayhead).not.toBe(beforePlayhead); // only authoritative engine Transport frames move it
        await clickXpath('//button[@title="Stop"]');

        await clickXpath('//button[@title="Export song"]');
        const destination = await browser.waitFor('css selector', '#export-destination');
        await browser.clear(destination);
        await browser.type(destination, outputDir);
        const filename = await browser.find('css selector', '#export-filename');
        await browser.clear(filename);
        await browser.type(filename, 'native-first-light');
        await clickXpath('//div[contains(@class,"export-dialog__actions")]//button[normalize-space(.)="Export song"]');
        const output = resolve(outputDir, 'native-first-light.wav');
        const deadline = Date.now() + 180_000;
        while (!existsSync(output) && Date.now() < deadline) await Bun.sleep(250);
        expect(existsSync(output)).toBe(true);

        const bytes = await readFile(output);
        const wav = decodeWav(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
        assertMusicalDuration(wav, 71.43, 1.2);
        assertAudiblePeak(wav, -48, 0.1);
        const windows = barWindowRms(wav, [
            { fromBar: 0, toBar: 8 }, { fromBar: 8, toBar: 16 }, { fromBar: 16, toBar: 24 },
        ], 84, 960);
        expect(windows.every((window) => window.rmsDbfs > -60)).toBe(true);
        const fingerprint = energyFingerprint(wav, 16);
        assertSectionsDiffer(Array.from({ length: 4 }, (_, index) => fingerprint.slice(index * 4, index * 4 + 4)), 0.005);
        await browser.quit();
    }, 240_000);

    test('N2 — SIGKILL mid-record recovers the fsynced reclog and take', async () => {
        await startSession();
        await openStarter('Paper Sketch');
        await Bun.sleep(2_200); // allow the normal recovery snapshot to become durable
        const before = await snapshot();
        const beforeNotes = Object.values(before.sources ?? {}).reduce((sum, source) => sum + (source.kind === 'midi' ? source.notes.length : 0), 0);
        await clickXpath('//button[contains(@aria-label,"for MIDI recording")][1]');
        expect(await browser.execute<string>('return document.querySelector("button[title^=\\"Count-in\\"]")?.getAttribute("aria-pressed") || "false"')).toBe('false');
        // The committed starters contain arrangement instruments but no visual
        // Keyboard node. Translate genuine WebDriver keydown/up events at the
        // existing automation-only live-note boundary so the normal record,
        // journal, history, and recovery path still receives computer keys.
        await browser.execute(`
            const notes = {a: 60, s: 62, d: 64, f: 65}; let tick = 120;
            for (const type of ['keydown', 'keyup']) window.addEventListener(type, event => {
                const note = notes[event.key.toLowerCase()]; if (note === undefined || event.repeat) return;
                window.dispatchEvent(new CustomEvent('openjammer:test-live-note', {
                    detail: {note, velocity: type === 'keydown' ? 102 : 0, on: type === 'keydown', tick},
                }));
                if (type === 'keyup') tick += 240;
            });
        `);
        await clickXpath('//button[@title="Record"]');
        await browser.invoke('native_e2e_reclog_begin');
        await browser.keys(['\uE004', '2']); // return to canvas, then select computer keyboard 2
        for (const [key, note] of [['a', 60], ['s', 62], ['d', 64], ['f', 65]] as const) {
            await browser.keys([key]);
            await browser.invoke('native_e2e_reclog_note', { note, velocity: 102, on: true });
            await browser.invoke('native_e2e_reclog_note', { note, velocity: 0, on: false });
        }
        const pid = await browser.invoke<number>('native_e2e_process_id');
        // Kill the WHOLE process tree, children first: a real crash/power-cut
        // takes WebKit's web/network child processes down with the app. Killing
        // only the UI process leaves WebKit orphans whose graceful teardown can
        // still fire `pagehide` — locally reproduced: the next boot then read a
        // CLEAN-exit marker (bootSeq advanced, crashes:[]) and ignored the
        // intact emergency backup. (That orphan-flush window is a genuine
        // native-tier durability hole worth its own native session marker; this
        // journey asserts the recovery machinery under the honest full-tree
        // crash it names.)
        if (process.platform === 'win32') {
            const killed = Bun.spawnSync(['taskkill', '/PID', String(pid), '/T', '/F']);
            expect(killed.exitCode).toBe(0);
        } else {
            Bun.spawnSync(['pkill', '-9', '-P', String(pid)]);
            process.kill(pid, 'SIGKILL');
        }
        await Bun.sleep(750);
        await browser.quit();

        await startSession();
        const count = await browser.invoke<number>('native_e2e_reclog_note_count');
        expect(count).toBe(8);
        // The "Recovered your work" pill lives 8 s (calm, non-blocking by
        // design), while a WebKitWebDriver relaunch handshake on this harness
        // stalls up to ~30 s before the driver can look at the DOM — locally the
        // full-suite replays missed the already-expired toast at exactly this
        // wait while isolated replays caught it. Assert the recovery through its
        // DURABLE user-visible surface instead: the DevLog records the restore
        // in the same ring the AI reads, and the substance (recovered notes +
        // the Take clip) is asserted right below.
        await browser.execute("window.dispatchEvent(new CustomEvent('openjammer:toggle-devlog'))");
        await browser.waitFor('xpath', '//*[contains(normalize-space(.),"restored work after an unclean shutdown")]', 20_000);
        await browser.execute("window.dispatchEvent(new CustomEvent('openjammer:toggle-devlog'))");
        await browser.keys(['\uE004']);
        const deadline = Date.now() + 15_000;
        let recovered = await snapshot();
        while (Date.now() < deadline) {
            const notes = Object.values(recovered.sources ?? {}).reduce((sum, source) => sum + (source.kind === 'midi' ? source.notes.length : 0), 0);
            const clips = recovered.tracks.flatMap((track) => track.clips).filter((clip) => clip.name?.startsWith('Take '));
            if (notes > beforeNotes && clips.length > 0) break;
            await Bun.sleep(200);
            recovered = await snapshot();
        }
        const afterNotes = Object.values(recovered.sources ?? {}).reduce((sum, source) => sum + (source.kind === 'midi' ? source.notes.length : 0), 0);
        expect(afterNotes).toBeGreaterThan(beforeNotes);
        expect(recovered.tracks.flatMap((track) => track.clips).some((clip) => clip.name?.startsWith('Take '))).toBe(true);
        await browser.quit();
    }, 120_000);

    test('N5 — a hostile hosted track surfaces the calm Bench card and project state still saves', async () => {
        await startSession();
        await openStarter('Paper Sketch');
        await browser.execute("window.__openjammerE2E.pluginFault('probe-block-hang', 'AutoBypassed')");
        // The calm Bench card's real AutoBypassed copy is "<plugin> stopped
        // answering." (src/components/Bench/Bench.tsx). The journey previously
        // asserted "took too long" — copy that has never existed anywhere in the
        // product (repo-wide grep), so the test could not pass on any platform.
        // Assert the shipped card, still by plugin name.
        await browser.waitFor('xpath', '//*[contains(normalize-space(.),"probe-block-hang stopped answering")]', 15_000);
        const states = await browser.invoke<Array<{ node: number; blob: number[] }>>('save_plugin_states');
        expect(Array.isArray(states)).toBe(true);
        const project = await snapshot();
        expect(JSON.stringify(project).length).toBeGreaterThan(100);
        await browser.quit();
    }, 120_000);
});
