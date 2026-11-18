/**
 * W6-CAP D4 — the 13px sans floor, in the four shipped surfaces that broke it.
 *
 * DESIGN.md §3: `--text-xs` (11px) and `--text-micro` (9.5px) exist ONLY for
 * uppercase JetBrains Mono micro-labels, where the letterforms are wide and
 * spaced and still held to the full 4.5:1 body bar. Functional sans text never
 * goes below `--text-sm` (13px); `Field`'s 12px label is the one documented
 * exception, and it lives in oj-ui.
 *
 * W6-CAP measured five sans runs at 11px across four panels — Settings section
 * captions, Safe Mode's actions ("Open a different project", "Send a report",
 * and the onboarding footer's "Skip, take me in"), the Help panel's mode chip
 * and honesty copy, and the plugin window strip's "on <node>" / "Unsaved". All
 * five are prose or an actionable label, not a micro-label, so all five lift to
 * the floor rather than changing face.
 *
 * The rule this pins is deliberately strict: a block that sets a sub-13px size
 * must SAY it is mono, in the same block. Inheritance is invisible to a reader
 * and to this gate, and "it happens to inherit mono from an ancestor" is exactly
 * how an 11px sans run gets shipped.
 *
 * W6-SHIP widened it twice, because the gate had two blind spots and nine live
 * breaks were sitting in both of them:
 *
 *  1. **The `font:` SHORTHAND.** Every rule here matched on `font-size:`, so
 *     `font: 600 var(--text-xs)/15px var(--font-sans)` — which is how the whole
 *     timeline writes type — was invisible. All nine offenders used the shorthand.
 *  2. **The sheet list.** Only the four surfaces W6-CAP happened to measure were
 *     scanned. The timeline, the piano roll and the oj-ui parts were never in
 *     anyone's frame, which is the same "the glob did not follow the surface"
 *     failure that let a retired hex ship in `TrackLaneView.tsx`.
 *
 * The nine, and the bucket each landed in — prose and actionable labels LIFT to
 * the 13px floor, name and marker runs move INTO the micro mono voice:
 *
 *  - lifted: the section chip's name, the instrument chip's button, the lane
 *    menu and its buttons, the automation segmented buttons (which merely
 *    restored `SegmentedControl`'s own `--text-sm`), the time prompt's form
 *    labels, and the roll's mode note;
 *  - mono: the drum key gutter (whose BASE rule was already mono — the drum
 *    override was switching it to sans) and the waveform `Cropped` badge (whose
 *    own sibling `__duration` was already mono at the same size).
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * EVERY stylesheet under `src` and `packages/oj-ui/src`, walked the way the
 * sibling gate in `reducedMotionContract.test.ts` walks them.
 *
 * The hard-coded list was the blind spot, not its length: the first fix for it
 * added four more names to the same list, which took the gate from 4 sheets to 8
 * — out of 115. Running the widened regexes over the other 107 turned up 39 more
 * candidate declarations. A floor gate covering 7% of the surface is a gate that
 * mostly reports on the files someone already thought about.
 */
function cssFiles(root: string): string[] {
    return readdirSync(root).flatMap((name) => {
        const path = join(root, name);
        if (statSync(path).isDirectory()) return name === 'node_modules' || name === 'dist' ? [] : cssFiles(path);
        return path.endsWith('.css') ? [path] : [];
    });
}

const SHEETS: readonly string[] = ['src', 'packages/oj-ui/src']
    .flatMap((root) => cssFiles(join(process.cwd(), root)))
    .map((path) => path.slice(process.cwd().length + 1).replace(/\\/g, '/'))
    .sort();

/** `selector { … }` pairs, comments stripped so a comment can quote a token. */
function rules(css: string): { selector: string; body: string }[] {
    const flat = css.replace(/\/\*[\s\S]*?\*\//g, '');
    return [...flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
        selector: m[1]!.trim().replace(/\s+/g, ' '),
        body: m[2]!,
    }));
}

/**
 * A sub-13px size, however it is written: the longhand, or the `font:` shorthand
 * where the size sits between the weight and the `/line-height`.
 */
const MICRO = /font-size:\s*var\(--text-(xs|micro)\)|font-size:\s*(9\.5|1[012])px|font:[^;]*var\(--text-(xs|micro)\)|font:[^;]*\b(9\.5|1[012])px\s*[/ ]/;

/** The mono face, declared either as its own property or inside the shorthand. */
const DECLARES_MONO = /font-family:\s*var\(--font-mono\)|font:[^;]*var\(--font-mono\)/;

/**
 * Runs that are NOT functional UI text, and therefore not what the 13px floor is
 * about. Each carries its own reason; adding a line here is a deliberate edit
 * that a reviewer sees, which is the whole point of listing rather than skipping.
 */
const NOT_TEXT: ReadonlyMap<string, string> = new Map([
    ['src/components/Canvas/NodeCanvas.css', 'a 48px back-arrow GLYPH, not a text run'],
    ['src/components/MIDI/MIDIDeviceCard.css', 'a 26px device EMOJI, and a status chip in the micro voice'],
    ['src/components/Nodes/MiniLab3Visual.css', 'legends printed on a DEPICTION of an Arturia MiniLab — a picture of hardware, not app chrome'],
    ['src/components/Nodes/KeyboardVisualNode.css', 'key legends on a DRAWN keyboard; the same depiction rule'],
    ['src/components/EngineHealthDot/EngineHealthDot.css', 'a single status GLYPH inside an 8px dot'],
    ['src/components/Shell/HintBubble.css', '13.5px is ABOVE the floor — it is off the scale, not under it'],
    ['src/components/Shell/SurfaceSwitcher.css', '10.5px keycap hint; a keycap, like the transport pill s'],
    ['src/components/CommandBar/CommandBar.css', 'the two off-scale values are RELATIVE (0.9em / 0.92em) inside markdown output'],
    ['packages/oj-ui/src/components/TransportPill/TransportPill.css', 'the 9px `space` KEYCAP — a key legend, DESIGN s documented keycap voice'],
    ['packages/oj-ui/src/components/Field/Field.css', 'Field s 12px label is DESIGN.md s ONE documented sub-13px sans exception'],
    ['src/components/Onboarding/Onboarding.css', 'a 9px glyph value and a 16px display size on the first-run card'],
    ['packages/oj-ui/src/components/CodeBlock/CodeBlock.css', '12px inside a MONO code block — the face is already mono at the block level'],
    ['packages/oj-ui/src/components/ParamRow/ParamRow.css', '12px on a mono numeric readout'],
    ['packages/oj-ui/src/components/OffscreenPointer/OffscreenPointer.css', '12px on an off-canvas pointer chip; listed as floor DEBT below, and its size is off the scale for the same reason'],
    ['packages/oj-ui/src/components/ValueScrubber/ValueScrubber.css', '12px inside a scrubber INPUT; same run as the debt entry below'],
    ['src/components/Collab/CollabControl.css', '12px on the collab field label; same run as the debt entry below'],
]);

/**
 * REAL floor breaks, on surfaces this lane never measured — enumerated rather
 * than waived.
 *
 * The honest position: these are DEBT, not exceptions. Widening the gate from 8
 * sheets to all 115 is what found them, and fixing 20-odd rules across the
 * command bar, onboarding, MIDI, Collab, Settings and six oj-ui parts is a
 * visual change on surfaces nobody in this lane has rendered, at the end of a fix
 * round, with visual baselines already owed. Landing that blind would be worse
 * than saying so.
 *
 * What this list DOES buy: the blind spot is closed. The gate now reads every
 * stylesheet, so a NEW offender — or a new rule in one of these files — fails,
 * because the entry names the exact selectors that are known-bad and nothing else.
 * The debt is frozen at its current size and visible in one place.
 */
const KNOWN_FLOOR_DEBT: ReadonlyMap<string, readonly string[]> = new Map([
    ['src/components/AppErrorBoundary.css', ['.app-error-msg']],
    ['src/components/BundlePortGroup.css', ['.bundle-expand-button', '.bundle-channel-row']],
    ['src/components/Clips/AudioClipVisual.css', ['.audio-clip-name']],
    ['src/components/Clips/ClipDragLayer.css', ['.clip-drag-hint']],
    ['src/components/Collab/CollabControl.css', ['.collab-transport', '.collab-divider', '.collab-field > span']],
    ['src/components/Collab/PresenceOverlay.css', ['.presence-cursor-label']],
    ['src/components/CommandBar/CommandBar.css', [
        '.command-bar-item__hint', '.command-bar-footer', '.command-bar-ask', '.command-bar-md table',
        '.command-bar-chip', '.command-bar-ai-runtime, .command-bar-ai-notice', '.command-bar-ai-slash-desc',
        '.command-bar-ai-slash-main span, .command-bar-ai-slash-source',
        '.command-bar-auth-configured span:last-child',
    ]],
    ['src/components/Export/ExportDialog.css', ['.export-stats__cell span']],
    ['src/components/Guides/Guide.css', ['.guide-latency-label']],
    ['src/components/MIDI/MIDIDeviceBrowser.css', ['.midi-browser-section h3', '.midi-browser-footer']],
    ['src/components/MIDI/MIDIDeviceCard.css', ['.midi-device-card-status']],
    ['src/components/Nodes/InstrumentNode.css', ['.instrument-node .inst-voice-error']],
    ['src/components/Nodes/LooperNode.css', ['.looper-layer__name .oj-editable-label__text']],
    ['src/components/Nodes/PortPanelNode.css', ['.port-panel__name .oj-input']],
    ['src/components/Plugins/PluginsPanel.css', ['.plugin-browser__status-text']],
    ['src/components/Settings/KeybindingsPanel.css', ['.keybindings-category-title', '.keybindings-surface-chip']],
    ['packages/oj-ui/src/components/DeviceSelect/DeviceSelect.css', ['.oj-device-select__latency']],
    ['packages/oj-ui/src/components/Field/Field.css', ['.oj-field__label', '.oj-field__description', '.oj-field__error']],
    ['packages/oj-ui/src/components/OffscreenPointer/OffscreenPointer.css', ['.oj-offscreen-pointer__label']],
    ['packages/oj-ui/src/components/ValueScrubber/ValueScrubber.css', ['.oj-value-scrubber__input']],
    ['packages/oj-ui/src/components/TransportPill/TransportPill.css', ['.oj-transport__hint']],
    ['src/components/Nodes/KeyboardVisualNode.css', ['.keyboard-visual-node .keyboard-visual-key']],
    ['src/components/Nodes/MiniLab3Visual.css', ['.minilab3-arturia']],
    ['src/components/EngineHealthDot/EngineHealthDot.css', ['.engine-health-dot__glyph']],
]);

describe.each(SHEETS)('%s', (path) => {
    const css = readFileSync(resolve(process.cwd(), path), 'utf8');

    it('sets no sub-13px size without declaring the mono face beside it', () => {
        const known = KNOWN_FLOOR_DEBT.get(path) ?? [];
        const offenders = rules(css)
            .filter((rule) => MICRO.test(rule.body))
            .filter((rule) => !DECLARES_MONO.test(rule.body))
            .map((rule) => rule.selector)
            .filter((selector) => !known.includes(selector));
        expect(offenders).toEqual([]);
    });

    it('does not carry a stale entry in the known-debt list', () => {
        // A frozen list rots the moment a rule is fixed or renamed and the entry
        // stays behind, quietly widening the hole. If a listed selector is no
        // longer an offender, the entry has to go.
        const live = new Set(rules(css)
            .filter((rule) => MICRO.test(rule.body))
            .filter((rule) => !DECLARES_MONO.test(rule.body))
            .map((rule) => rule.selector));
        const stale = (KNOWN_FLOOR_DEBT.get(path) ?? []).filter((selector) => !live.has(selector));
        expect(stale, `${path}: fixed or renamed — remove from KNOWN_FLOOR_DEBT`).toEqual([]);
    });

    it('names only sizes that are on the scale', () => {
        // 30 / 22 / 15 / 14 / 13 sans, 11 / 9.5 mono — through their tokens.
        // `0` is allowed and is not a size choice: it is how a control that draws
        // its mark in a `::before` says "there is no text here" (the loop/punch
        // brace handles), and a zero-height run cannot break a legibility floor.
        if (NOT_TEXT.has(path)) return; // reason recorded in NOT_TEXT
        for (const [, value] of css.matchAll(/font-size:\s*([^;]+);/g)) {
            expect(value.trim()).toMatch(
                /^var\(--text-(2xl|xl|lg|md|sm|xs|micro)\)$|^(30|22|15|14|13|11|9\.5)px$|^0$|^inherit$|^1em$/,
            );
        }
    });
});
