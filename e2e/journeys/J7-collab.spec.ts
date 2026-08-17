import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { activateBrowser } from './support';

interface CollabBridge {
    hostCollab(name: string): Promise<string>;
    joinCollab(sessionCode: string, name: string): Promise<void>;
    hostCollabWebRTC(name: string): Promise<string>;
    joinCollabWebRTC(sessionCode: string, name: string): Promise<void>;
    createCollabOffer(): Promise<string>;
    acceptCollabOffer(offer: string): Promise<string>;
    acceptCollabAnswer(answer: string): Promise<void>;
    addGraphNode(label: string): string;
    graphSnapshot(): { nodes: Array<{ id: string; data?: { name?: string } }> };
}

const call = <T>(page: Page, method: keyof CollabBridge, args: string[]) => page.evaluate(
    ({ method, args }) => {
        const bridge = (window as unknown as { __openjammerE2E: Record<string, (...values: string[]) => unknown> }).__openjammerE2E;
        return bridge[method]!(...args) as T;
    },
    { method, args },
);

async function newAppContext(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
    const context = await browser.newContext({ baseURL: 'http://localhost:4173' });
    return { context, page: await context.newPage() };
}

test('@journey @collab J7 Collab seed — graph nodes converge between two contexts', async ({ browser }) => {
    // Separate Playwright BrowserContexts prove the graph crosses an actual
    // isolation boundary. The production manual-WebRTC data channel supplies
    // that cross-context seam; same-tab BroadcastChannel remains covered below it.
    const a = await newAppContext(browser);
    const b = await newAppContext(browser);
    try {
        await Promise.all([activateBrowser(a.page), activateBrowser(b.page)]);
        const sessionCode = await call<string>(a.page, 'hostCollabWebRTC', ['Alice']);
        await call<void>(b.page, 'joinCollabWebRTC', [sessionCode, 'Bob']);
        const offer = await call<string>(a.page, 'createCollabOffer', []);
        const answer = await call<string>(b.page, 'acceptCollabOffer', [offer]);
        await call<void>(a.page, 'acceptCollabAnswer', [answer]);
        const addedId = await call<string>(a.page, 'addGraphNode', ['J7 shared effect']);

        await expect.poll(async () => {
            const graph = await call<ReturnType<CollabBridge['graphSnapshot']>>(b.page, 'graphSnapshot', []);
            return graph.nodes.some((node) => node.id === addedId && node.data?.name === 'J7 shared effect');
        }, { timeout: 15_000, message: 'Loro graph update from context A never converged in context B' }).toBe(true);

        // Seam: arrangement documents are not CRDT-projected yet. This journey
        // is deliberately graph-only until arrangement collaboration lands.
    } finally {
        await Promise.all([a.context.close(), b.context.close()]);
    }
});
