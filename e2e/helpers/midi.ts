import type { Page } from '@playwright/test';

type MidiBytes = readonly [number, number, number];

export async function installWebMidiShim(page: Page): Promise<void> {
    await page.addInitScript(() => {
        type Input = {
            id: string; name: string; manufacturer: string; version: string; type: 'input'; state: 'connected'; connection: 'open';
            onmidimessage: ((event: MIDIMessageEvent) => void) | null; open(): Promise<Input>; close(): Promise<Input>;
        };
        const input: Input = {
            id: 'e2e-keys', name: 'E2E Keys', manufacturer: 'OpenJammer', version: '1.0', type: 'input', state: 'connected', connection: 'open',
            onmidimessage: null, async open() { return this; }, async close() { return this; },
        };
        const inputs = new Map<string, Input>([[input.id, input]]);
        const access = { inputs, outputs: new Map(), sysexEnabled: false, onstatechange: null, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } };
        Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => access });
        (window as unknown as { __e2eMidi: { send(bytes: number[], at?: number): void; sent: Array<{ bytes: number[]; at: number }> } }).__e2eMidi = {
            sent: [],
            send(bytes, at = performance.now()) {
                this.sent.push({ bytes: [...bytes], at });
                const event = new Event('midimessage') as MIDIMessageEvent;
                Object.defineProperties(event, { data: { value: Uint8Array.from(bytes) }, timeStamp: { value: at } });
                input.onmidimessage?.(event);
            },
        };
    });
}

export class VirtualMidiInput {
    constructor(private readonly page: Page) {}

    private async send(bytes: MidiBytes, tick?: number): Promise<void> {
        await this.page.evaluate(({ message, musicalTick }) => {
            (window as unknown as { __e2eMidi: { send(bytes: number[]): void } }).__e2eMidi.send(message);
            const command = message[0]! & 0xf0;
            if ((command === 0x80 || command === 0x90) && musicalTick !== undefined) {
                const on = command === 0x90 && message[2]! > 0;
                window.dispatchEvent(new CustomEvent('openjammer:test-live-note', { detail: { note: message[1], velocity: on ? message[2] : 0, on, tick: musicalTick } }));
            }
        }, { message: [...bytes], musicalTick: tick });
    }

    async note(note: number, velocity: number, durationMs: number, tick: number, durationTick: number, channel = 0): Promise<void> {
        await this.send([0x90 | channel, note, velocity], tick);
        await this.page.waitForTimeout(durationMs);
        await this.send([0x80 | channel, note, 0], tick + durationTick);
    }

    async chord(notes: readonly number[], velocity: number, durationMs: number, tick: number, durationTick: number): Promise<void> {
        for (const note of notes) await this.send([0x90, note, velocity], tick);
        await this.page.waitForTimeout(durationMs);
        for (const note of notes) await this.send([0x80, note, 0], tick + durationTick);
    }

    async sustain(down: boolean): Promise<void> { await this.send([0xb0, 64, down ? 127 : 0]); }

    async noteStorm(options: { notes?: number; startNote?: number; tick?: number; spacingTick?: number; jitterMs?: number } = {}): Promise<void> {
        const count = options.notes ?? 32;
        const start = options.startNote ?? 48;
        const baseTick = options.tick ?? 0;
        const spacing = options.spacingTick ?? 60;
        const jitter = options.jitterMs ?? 3;
        for (let index = 0; index < count; index++) {
            const note = start + index % 24;
            await this.send([0x90, note, 50 + index % 70], baseTick + index * spacing);
            if (jitter) await this.page.waitForTimeout((index * 17) % (jitter + 1));
            await this.send([0x80, note, 0], baseTick + index * spacing + Math.max(1, spacing - 1));
        }
    }

    async sentCount(): Promise<number> {
        return this.page.evaluate(() => (window as unknown as { __e2eMidi: { sent: unknown[] } }).__e2eMidi.sent.length);
    }
}
