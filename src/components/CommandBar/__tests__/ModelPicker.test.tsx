/**
 * W6-CAP D5 / D8 — the two command-bar defects.
 *
 * D5. `--accent-success` was being used to mean "selected": the model picker
 * tagged the active model with `<Chip tone="success">current</Chip>`. DESIGN.md
 * §2, the Signal-Not-Brand Rule, is explicit — success / warning / danger report
 * MACHINE STATE, and "never use `--accent-success` to mean 'selected' (green
 * means healthy, not chosen)". The row already says "this is the one" twice:
 * `ListRow current` draws a 6px `--accent-ink` dot and sets `aria-current`. The
 * green was both the wrong hue and the third copy of the same fact.
 *
 * D8. The `/resume` filter field was a ~210px box floating under the header on a
 * surface where every other field is full-bleed. `width: auto` on an <input> is
 * its INTRINSIC size, not its parent's — the model picker's filter stretches
 * only because it is a direct child of that picker's own flex column, and
 * `SessionPicker` puts its field inside cmdk's root <div>. The fix gives cmdk's
 * root the same stretching column; both fields stay the one `.command-bar-input`.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useAuthStore } from '../../../auth/authStore';
import { useModelCatalogStore } from '../../../store/modelCatalogStore';
import type { PiCommandRuntime } from '../../../ai/piSessions';
import { ModelPicker } from '../ModelPicker';

vi.mock('../../../ai/piSessions', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../ai/piSessions')>()),
    listAvailableModels: vi.fn(async () => [
        { provider: 'anthropic', id: 'opus-5', name: 'Opus 5' },
        { provider: 'anthropic', id: 'haiku-4.5', name: 'Haiku 4.5' },
    ]),
    setModel: vi.fn(async () => ({ ok: true })),
}));

const runtime = () => ({ providerCustomModels: {} }) as unknown as PiCommandRuntime;

beforeEach(() => {
    useModelCatalogStore.setState({ entries: {} } as never);
    useAuthStore.setState({
        activeProvider: 'anthropic',
        modelId: 'opus-5',
        configured: true,
        configuredProviderIds: ['anthropic'],
        providerKeys: { anthropic: 'k' },
        providerBaseUrls: {},
        providerCustomModels: {},
    } as never);
});

afterEach(cleanup);

describe('ModelPicker — the current model', () => {
    it('marks the current row without spending a state colour on it', async () => {
        render(<ModelPicker runtime={runtime} onSelected={() => {}} onCancel={() => {}} />);

        const chip = await screen.findByText('current');
        const pill = chip.closest('.oj-chip')!;
        expect(pill).not.toBeNull();
        // Green means healthy, not chosen. No tone at all — the neutral inset pill.
        expect(pill.className).not.toMatch(/oj-chip--(success|warning|danger)/);
        expect(pill.className.trim()).toBe('oj-chip');
    });

    it('still says "current" twice over, so the mark is never colour alone', async () => {
        render(<ModelPicker runtime={runtime} onSelected={() => {}} onCancel={() => {}} />);

        const row = (await screen.findByText('current')).closest('.oj-list-row')!;
        expect(row.className).toContain('is-current');
        expect(row.getAttribute('aria-current')).toBe('true');
    });
});

describe('the /resume filter field', () => {
    const CSS = readFileSync(
        resolve(process.cwd(), 'src/components/CommandBar/CommandBar.css'),
        'utf8',
    );

    it('reuses the palette\'s one search Input, not a second one', () => {
        const picker = readFileSync(
            resolve(process.cwd(), 'src/components/CommandBar/SessionPicker.tsx'),
            'utf8',
        );
        expect(picker).toContain('className="command-bar-input"');
    });

    it('keeps the two picker sub-views on the 13px sans floor', () => {
        // Measured live on the fixed build: the model picker's help row and both
        // pickers' `↑↓ choose · ↵ switch · Esc back` hint were 11px sans, and the
        // session id was 11px mono at 3.93:1 light / 3.80:1 dark on the SELECTED
        // row — mono micro is held to the full 4.5 bar, not a large-text exemption.
        for (const selector of [
            '.command-bar-ai-hint',
            '.command-bar-models-help',
            '.command-bar-session-current',
        ]) {
            const rule = new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`).exec(CSS)?.[1] ?? '';
            expect(rule).not.toMatch(/font-size:\s*var\(--text-(xs|micro)\)/);
        }
        const id = /\.command-bar-session-id\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '';
        expect(id).toMatch(/font-family:\s*var\(--font-mono\)/);
        expect(id).toMatch(/color:\s*var\(--text-secondary\)/);
    });

    it('stretches to the panel, like every other field on the surface', () => {
        // cmdk's root is the field's parent; making it the same stretching flex
        // column is what turns `width: auto` from ~210px of intrinsic size into
        // the full-bleed field the model picker already gets for free.
        const rule = /\.command-bar-sessions \[cmdk-root\]\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '';
        expect(rule).toMatch(/display:\s*flex/);
        expect(rule).toMatch(/flex-direction:\s*column/);
    });

    it('gives AuthChooser the same rule, not a second one', () => {
        // `AuthChooser` builds the identical shape — its `<Command>` root wraps
        // the same `.command-bar-input` — so it had the same ~210px floating
        // field. One selector list, one rule: forking it is the failure mode.
        const rule =
            /\.command-bar-auth \[cmdk-root\],\s*\.command-bar-sessions \[cmdk-root\]\s*\{([^}]*)\}/.exec(
                CSS,
            )?.[1] ?? '';
        expect(rule).toMatch(/display:\s*flex/);
        expect(rule).toMatch(/flex-direction:\s*column/);
        expect(rule).toMatch(/min-height:\s*0/);
        // Exactly one `[cmdk-root]` block on this surface.
        expect(CSS.match(/\[cmdk-root\]\s*\{/g) ?? []).toHaveLength(1);
    });

    it('writes category headers in the micro mono voice, not the retired 10.5px sans', () => {
        // W6-UI retired 10.5px sans from the design system (Menu.css's
        // `.oj-menu-category` is the vocabulary). Mono is the one face allowed
        // under the 13px sans floor, and 9.5px mono measures within a pixel of
        // the 10.5px sans it replaces.
        // Comments name the retired value to explain the swap, so judge the
        // declarations: no `font-size` in this sheet is a hand-typed px step.
        // (Three `0.9em`/`0.92em` survive, all on `--font-mono` runs — relative
        // mono sizing, which the sans floor does not govern.)
        const literals = [...CSS.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/font-size:\s*([^;]+);/g)]
            .map((m) => m[1].trim())
            .filter((v) => v.endsWith('px'));
        expect(literals).toEqual([]);
        for (const selector of ['\\.command-bar-group \\[cmdk-group-heading\\]', '\\.command-bar-ai-slash-head']) {
            const rule = new RegExp(`${selector}[^{]*\\{([^}]*)\\}`).exec(CSS)?.[1] ?? '';
            expect(rule).toMatch(/font-family:\s*var\(--font-mono\)/);
            expect(rule).toMatch(/font-size:\s*var\(--text-micro\)/);
            expect(rule).toMatch(/letter-spacing:\s*var\(--tracking-micro\)/);
            expect(rule).toMatch(/text-transform:\s*uppercase/);
        }
        // The slash-menu empty row is a SENTENCE, not a header — it shares the
        // box but must opt back out to sans prose on the 13px floor.
        // It appears twice — once sharing the header's box, then its own
        // override. The cascade winner is the last one.
        const emptyRules = [...CSS.matchAll(/\.command-bar-ai-slash-empty\s*\{([^}]*)\}/g)];
        const empty = emptyRules.at(-1)?.[1] ?? '';
        expect(empty).toMatch(/font-family:\s*var\(--font-sans\)/);
        expect(empty).toMatch(/font-size:\s*var\(--text-sm\)/);
    });

    it('renders the auth field inside that cmdk root', () => {
        const chooser = readFileSync(
            resolve(process.cwd(), 'src/components/CommandBar/AuthChooser.tsx'),
            'utf8',
        );
        expect(chooser).toContain('className="command-bar-input"');
    });
});
