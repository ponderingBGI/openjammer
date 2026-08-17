import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();
let tauriPresent = false;
vi.mock('../../../ai/tauri', () => ({ isTauri: () => tauriPresent, getInvoke: () => tauriPresent ? invokeMock : null }));
import { PluginsPanel } from '../PluginsPanel';
import { browserActionWord, defaultBrowserFamilies, filterBrowserItems, type BrowserItem } from '../browserModel';

beforeEach(() => { tauriPresent = false; invokeMock.mockReset(); });
afterEach(cleanup);
const open = (context: 'browse' | 'pick' | 'insert' = 'browse') => act(() => window.dispatchEvent(new CustomEvent('openjammer:open-browser', { detail: { context } })));
const plugin = { uid: 'acme', name: 'Acme Reverb', vendor: 'Acme', path: '/p/acme.clap', format: 'Clap', is_instrument: false, ports: { audio_in: 2, audio_out: 2 }, param_count: 5, latency_samples: 0, features: ['reverb'] };
function mockNative(plugins: unknown[] = [plugin]) { invokeMock.mockImplementation((command: string) => command === 'scan_plugins' ? Promise.resolve(plugins) : command === 'plugin_dirs' ? Promise.resolve([{ path: '/Library/Audio/Plug-Ins/CLAP', scope: 'system' }]) : command === 'hosting_backend' ? Promise.resolve({ backend: 'clap', formats: ['clap'] }) : command === 'plugin_quarantine_list' ? Promise.resolve([]) : Promise.resolve(null)); }

describe('Browser contexts', () => {
    it('opens as the Browser and autofocuses search', () => { render(<PluginsPanel />); open(); expect(screen.getByRole('dialog', { name: 'Browser' })).toBeTruthy(); expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Search plugins' })); });
    it('changes only action word and instrument defaults by context', () => { expect(browserActionWord('browse')).toBe('Add'); expect(browserActionWord('pick')).toBe('Use'); expect(browserActionWord('insert')).toBe('Insert'); expect(defaultBrowserFamilies('pick')).toEqual(['Keys', 'Synth', 'Drums', 'Sampler']); });
    it('keeps built-ins visible in a browser-only build', () => { render(<PluginsPanel />); open(); expect(screen.getByRole('option', { name: /Keyboard, OpenJammer/ })).toBeTruthy(); expect(screen.getByText(/built-ins only/i)).toBeTruthy(); });
    it('interleaves hosted plugins and states format as a word', async () => { tauriPresent = true; mockNative(); render(<PluginsPanel />); open(); await waitFor(() => expect(screen.getByText('Acme Reverb')).toBeTruthy()); expect(screen.getByText('Acme · Space · CLAP')).toBeTruthy(); });
    it('uses the same keyboard list in insert context', async () => { tauriPresent = true; mockNative(); render(<PluginsPanel />); open('insert'); await waitFor(() => expect(screen.getByText('Acme Reverb')).toBeTruthy()); expect(screen.getAllByRole('button', { name: 'Insert' }).length).toBeGreaterThan(0); fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' }); });
});

describe('Browser ranking', () => {
    const items: BrowserItem[] = [
        { id: 'host', name: 'Zebra', vendor: 'u-he', source: 'installed', family: 'Synth', declarationOrder: 0 },
        { id: 'built', name: 'Keys', vendor: 'OpenJammer', source: 'built-in', family: 'Keys', declarationOrder: 3 },
    ];
    it('puts built-ins before hosted results without alphabetizing', () => expect(filterBrowserItems(items, '', 'all', []).map((item) => item.id)).toEqual(['built', 'host']));
    it('ranks exact matches first', () => expect(filterBrowserItems(items, 'Zebra', 'all', [])[0]?.id).toBe('host'));
});
