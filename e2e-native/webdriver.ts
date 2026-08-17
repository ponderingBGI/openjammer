const ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf';

interface WebDriverReply<T> { value: T }
type ElementRef = Record<typeof ELEMENT_KEY, string>;
type WebDriverError = { error?: string; message?: string; stacktrace?: string };

export class TauriWebDriver {
    private sessionId: string | null = null;

    constructor(private readonly endpoint = 'http://127.0.0.1:4444') {}

    private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
        const response = await fetch(`${this.endpoint}${path}`, {
            method,
            headers: { 'content-type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const payload = await response.json() as WebDriverReply<T> & { value?: WebDriverError | string };
        if (!response.ok) {
            const detail = typeof payload.value === 'string'
                ? payload.value
                : payload.value?.message || payload.value?.error || response.status;
            throw new Error(`WebDriver ${method} ${path}: ${detail}`);
        }
        return payload.value;
    }

    async start(application: string, webviewUserDataFolder?: string): Promise<void> {
        const reply = await this.request<{ sessionId?: string } & Record<string, unknown>>('POST', '/session', {
            capabilities: {
                alwaysMatch: {
                    browserName: 'wry',
                    'tauri:options': {
                        application,
                        ...(webviewUserDataFolder
                            ? { webviewOptions: { userDataFolder: webviewUserDataFolder } }
                            : {}),
                    },
                },
            },
        });
        this.sessionId = reply.sessionId ?? (reply as { session_id?: string }).session_id ?? null;
        if (!this.sessionId) throw new Error('tauri-driver did not return a session id');
    }

    async quit(): Promise<void> {
        if (!this.sessionId) return;
        const session = this.sessionId;
        this.sessionId = null;
        await this.request('DELETE', `/session/${session}`).catch(() => undefined);
    }

    private path(suffix: string): string {
        if (!this.sessionId) throw new Error('WebDriver session is not running');
        return `/session/${this.sessionId}${suffix}`;
    }

    async find(using: 'css selector' | 'xpath', value: string): Promise<string> {
        const element = await this.request<ElementRef>('POST', this.path('/element'), { using, value });
        return element[ELEMENT_KEY];
    }

    async waitFor(using: 'css selector' | 'xpath', value: string, timeoutMs = 15_000): Promise<string> {
        const deadline = Date.now() + timeoutMs;
        let last: unknown;
        while (Date.now() < deadline) {
            try { return await this.find(using, value); } catch (error) { last = error; }
            await Bun.sleep(100);
        }
        throw last ?? new Error(`Timed out waiting for ${value}`);
    }

    async click(element: string): Promise<void> {
        try {
            await this.request('POST', this.path(`/element/${element}/click`), {});
        } catch (nativeClickError) {
            // Ubuntu 24.04's WebKitWebDriver can resolve a visible button and then
            // reject its element-click command with an empty `unknown error` after
            // the xvfb webview finishes booting. PR #72 run 32039122597 reproduced
            // that exact sequence in N1, N2, and N5; script execution remained the
            // working automation channel. Dispatch the element's standard DOM click
            // as the narrow fallback, preserving the native pointer path everywhere
            // WebKit implements it. Passing the WebDriver element reference avoids a
            // selector re-query or stale-node ambiguity.
            if (!(nativeClickError instanceof Error) || !nativeClickError.message.includes('unknown error')) {
                throw nativeClickError;
            }
            try {
                await this.execute('arguments[0].click()', [{ [ELEMENT_KEY]: element }]);
            } catch (domClickError) {
                throw new AggregateError(
                    [nativeClickError, domClickError],
                    'WebDriver native and DOM click paths both failed',
                );
            }
        }
    }

    async clear(element: string): Promise<void> {
        await this.request('POST', this.path(`/element/${element}/clear`), {});
    }

    async type(element: string, value: string): Promise<void> {
        await this.request('POST', this.path(`/element/${element}/value`), { text: value, value: [...value] });
    }

    async keys(value: string[]): Promise<void> {
        await this.request('POST', this.path('/actions'), {
            actions: [{ type: 'key', id: 'keyboard', actions: value.flatMap((key) => [
                { type: 'keyDown', value: key }, { type: 'keyUp', value: key },
            ]) }],
        });
        await this.request('DELETE', this.path('/actions'));
    }

    async execute<T>(script: string, args: unknown[] = []): Promise<T> {
        return this.request<T>('POST', this.path('/execute/sync'), { script, args });
    }

    async executeAsync<T>(script: string, args: unknown[] = []): Promise<T> {
        return this.request<T>('POST', this.path('/execute/async'), { script, args });
    }

    async invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
        const result = await this.executeAsync<T | { __error: string }>(
            `const done = arguments[arguments.length - 1]; window.__TAURI__.core.invoke(arguments[0], arguments[1]).then(done, error => done({__error: String(error)}));`,
            [command, args],
        );
        if (result && typeof result === 'object' && '__error' in result) throw new Error(result.__error);
        return result as T;
    }
}

export async function waitForDriver(endpoint = 'http://127.0.0.1:4444', timeoutMs = 15_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(`${endpoint}/status`);
            if (response.ok) return;
        } catch { /* server is still starting */ }
        await Bun.sleep(100);
    }
    throw new Error('tauri-driver did not become ready');
}
