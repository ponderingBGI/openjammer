/**
 * ChatMessage — one turn in the Ctrl/Cmd+K conversation.
 *
 * Two cards, one grammar: the player's turn sits on the panel surface behind a
 * hairline; the agent answers on the recessed tertiary card (markdown prose plus
 * the quiet action chips for any graph edits it made). While a turn streams, a
 * three-dot pulse marks the tail — motion is the whole signal, so it holds still
 * under reduced motion. An empty streaming turn reads as "Thinking…" so a
 * question never shows a blank box.
 */

import type { ConversationEntry } from '../../store/agentSessionStore';
import { Markdown } from './Markdown';
import { ActionChip } from './ActionChip';

/** The streaming indicator — three dots, mono-scale, calm during a live set. */
export function StreamingDots({ label }: { label?: string }) {
    return (
        <span className="command-bar-dots" role="presentation" aria-label={label}>
            <i />
            <i />
            <i />
        </span>
    );
}

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
                <p className="command-bar-msg-thinking">
                    Thinking
                    <StreamingDots />
                </p>
            ) : null}

            {entry.streaming && entry.markdown && <StreamingDots label="Still writing" />}

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
