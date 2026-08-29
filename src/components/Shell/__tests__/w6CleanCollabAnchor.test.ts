/**
 * W6-CLEAN #1 — the collaboration popover anchors to its TRIGGER.
 *
 * `Topbar.css` used to carry `.oj-topbar .collab-control { position: static }`,
 * a leftover from before P9 restyled the control. It cancelled the control's own
 * `position: relative`, which sent the popover's `absolute` anchor all the way up
 * to `.oj-topbar` — a full-window-width box — so the compensating `right: 0`
 * pinned the panel flush to the WINDOW edge instead of hanging under the button
 * that opened it.
 *
 * The test is on the shipped stylesheets, cascaded the way a browser cascades
 * them: mount both files, put a `.collab-control` inside a `.oj-topbar`, and ask
 * what `position` it computes to. `static` fails.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const TOPBAR_CSS = readFileSync(
    resolve(process.cwd(), 'src/components/Shell/Topbar.css'),
    'utf8',
);
const COLLAB_CSS = readFileSync(
    resolve(process.cwd(), 'src/components/Collab/CollabControl.css'),
    'utf8',
);

afterEach(() => {
    document.head.querySelectorAll('style[data-w6-clean]').forEach((node) => node.remove());
    document.body.innerHTML = '';
});

/** Mount both stylesheets in the order the app imports them and build the DOM. */
function mountTopbarWithCollab(): HTMLElement {
    for (const css of [COLLAB_CSS, TOPBAR_CSS]) {
        const style = document.createElement('style');
        style.setAttribute('data-w6-clean', 'true');
        style.textContent = css;
        document.head.appendChild(style);
    }
    document.body.innerHTML = `
        <div class="oj-topbar">
            <div class="oj-topbar__cluster oj-topbar__cluster--right">
                <div class="collab-control">
                    <button class="collab-toggle">Collaborate</button>
                    <div class="collab-panel"></div>
                </div>
            </div>
        </div>
    `;
    return document.querySelector<HTMLElement>('.collab-control')!;
}

describe('W6-CLEAN — the collab popover hangs from its trigger', () => {
    it('leaves the control as the popover’s containing block', () => {
        const control = mountTopbarWithCollab();

        // `static` is the failing value: it hands the anchor to `.oj-topbar`.
        expect(getComputedStyle(control).position).toBe('relative');
    });

    it('carries no topbar override of the collab control at all', () => {
        // Belt and braces on the source: the two blocks had to go TOGETHER —
        // deleting either one alone leaves the panel misplaced — so the file must
        // not mention the control outside prose.
        const declarations = TOPBAR_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
        expect(declarations).not.toContain('.collab-control');
        expect(declarations).not.toContain('.collab-panel');
    });
});
