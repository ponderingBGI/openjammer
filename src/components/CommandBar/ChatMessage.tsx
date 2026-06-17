/**
 * ChatMessage — one turn in the Ctrl/Cmd+K conversation.
 *
 * A user turn is the hand-drawn voice (Caveat), a small distinct bubble. An
 * assistant turn is the prose answer (markdown) plus the quiet action chips for
 * any graph edits it made, with a blinking caret while it streams. Empty +
 * streaming reads as "Thinking…" so a question never shows a blank box.
 */

import type { ConversationEntry } from '../../store/agentSessionStore';
import { Markdown } from './Markdown';
import { ActionChip } from './ActionChip';

export function ChatMessage({ entry }: { entry: ConversationEntry }) {
    if (entry.role === 'user') {
        return (
            <div className="command-bar-msg command-bar-msg-user">
                <p className="command-bar-msg-user-text">{entry.text}</p>
            </div>
        );
    }

    const showThinking = entry.streaming && !entry.markdown && entry.actions.length === 0;

    return (
        <div
            className="command-bar-msg command-bar-msg-assistant"
            data-errored={entry.errored ? 'true' : undefined}
        >
            {entry.markdown ? (
                <Markdown>{entry.markdown}</Markdown>
            ) : showThinking ? (
                <p className="command-bar-msg-thinking">Thinking…</p>
            ) : null}

            {entry.streaming && entry.markdown && (
                <span className="command-bar-caret" aria-hidden="true" />
            )}

            {entry.actions.length > 0 && (
                <div className="command-bar-actions">
                    {entry.actions.map((chip, i) => (
                        <ActionChip key={i} chip={chip} />
                    ))}
                </div>
            )}
        </div>
    );
}
