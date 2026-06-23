/**
 * ActionChip — a quiet "what the agent did" marker under an assistant turn.
 *
 * The chat is conversation-first; graph edits are reported, not celebrated. Each
 * chip is a small sand pill with a glyph + a human summary ("added looper",
 * "connected Looper → Speaker"). It carries no controls — edits already applied
 * and are reverted with plain Ctrl+Z — so it stays out of the way. A failed
 * mutation wears clay (Signal-Not-Brand), always with its label.
 *
 * A SELF-EDIT chip (`chip.self`) is Philia editing ITSELF — a remembered preference
 * or a learned skill, not a canvas edit. It reads distinctly (a memory glyph + its
 * own tone) so the player sees "you editing you", reversed via Ctrl+K forget rather
 * than a canvas Ctrl+Z.
 */

import type { ActionChip as ActionChipData } from '../../store/agentSessionStore';

/** A glyph per tool, so the eye reads the kind of edit before the words. */
const GLYPHS: Record<string, string> = {
    add_node: '＋',
    remove_node: '－',
    add_connection: '↬',
    remove_connection: '⌁',
    update_node_data: '✎',
    author_dsp_node: '✦',
    author_code_node: '✦',
    batch_apply: '⛓',
    emit_plan: '⛓',
    self_edit: '❀',
};

export function ActionChip({ chip }: { chip: ActionChipData }) {
    const glyph = GLYPHS[chip.name] ?? (chip.self ? '❀' : '•');
    return (
        <span className="command-bar-chip" data-ok={chip.ok} data-self={chip.self || undefined}>
            <span className="command-bar-chip-glyph" aria-hidden="true">
                {glyph}
            </span>
            <span className="command-bar-chip-text">{chip.summary || chip.name}</span>
        </span>
    );
}
