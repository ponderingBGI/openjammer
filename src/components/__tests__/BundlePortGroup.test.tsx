/**
 * The bundle panel is WIDE ENOUGH to say what it is.
 *
 * A bundle port carries an identity ("Keyboard Row 1"), not a hint, and the
 * player reads it off the panel to know what a cable is carrying. On a 176px
 * panel the tracked 9.5px mono name has ~52px left after the disclosure, the
 * channel count and the well, so it clipped. Two rules make it legible and
 * they live in two files: the label column in `BundlePortGroup.css` and the
 * widened panel in `Nodes/PortPanelNode.css` (moved there from `_sockets.css`
 * in W5-P6). Nothing else asserts either number, so a tidy-up that reunified
 * the panel widths would silently bring the ellipsis back.
 *
 * jsdom has no layout engine, hence the CSS-text assertions: this pins the
 * RULES that produced the measured browser evidence, not a rendered width.
 */
import { readFileSync } from 'node:fs';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { BundlePortDefinition } from '../../engine/types';
import { BundlePortGroup } from '../BundlePortGroup';

const bundleCss = readFileSync('src/components/BundlePortGroup.css', 'utf8');
// The panel width that keeps a bundle identity legible moved out of
// `_sockets.css` and next to the panel it belongs to when W5-P6 consolidated
// the two panel nodes into `PortPanelNode`. Same rule, same 190px.
const panelCss = readFileSync('src/components/Nodes/PortPanelNode.css', 'utf8');

const keyboardRow: BundlePortDefinition = {
    id: 'keyboard-row-1',
    name: 'Keyboard Row 1',
    type: 'control',
    direction: 'input',
    isBundled: true,
    bundleInfo: {
        bundleId: 'keyboard-row-1',
        bundleLabel: 'Keyboard Row 1',
        label: 'Keyboard Row 1',
        size: 1,
        sourceNodeName: 'Keyboard',
        sourceNodeType: 'keyboard',
        channels: [
            {
                id: 'c4',
                label: 'C4',
                sourcePortId: 'key-60',
                sourceNodeId: 'keyboard',
            },
        ],
        expanded: false,
    },
};

describe('BundlePortGroup', () => {
    it('gives a keyboard bundle identity enough rendered width without ellipsis clipping', () => {
        const { container } = render(
            <BundlePortGroup port={keyboardRow} nodeId="keyboard" labelPosition="left" />,
        );
        const label = container.querySelector<HTMLElement>('.bundle-label')!;
        const labelRule = bundleCss.match(/\.bundle-label\s*\{([^}]*)\}/)?.[1] ?? '';

        expect(label.textContent).toBe('Keyboard Row 1');
        expect(labelRule).toContain('min-width: 90px');
        expect(labelRule).not.toContain('text-overflow');
        expect(labelRule).not.toContain('overflow: hidden');
        expect(bundleCss).toContain('grid-template-columns: 22px minmax(90px, 1fr) auto 18px');
        expect(panelCss).toMatch(/\.oj-node\.port-panel:has\(\.bundle-port-group\)\s*\{\s*width:\s*190px;/);
    });
});
