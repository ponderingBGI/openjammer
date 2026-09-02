/**
 * A one-line channel into the app's polite live region.
 *
 * Most feedback rides the history store: every recording verb is named by
 * `LiveAnnouncer` without a call site having to remember (see `historyPhrase`).
 * A few moments in a gesture are NOT history events and still have to be spoken,
 * because they are the whole feedback a keyboard player gets:
 *
 *   - "Audio out armed. Move to a port and press Enter." — a cable in the air
 *     records nothing until it lands.
 *   - "Two outputs cannot connect" — a refusal that must not be silence.
 *
 * A module-level emitter rather than a store: this is not state (nothing renders
 * from a *past* announcement), it is an event, and modelling it as state is how
 * you end up needing a nonce to say the same thing twice.
 */

type Listener = (message: string) => void;

const listeners = new Set<Listener>();

/** Say something, politely, once. Empty strings are ignored. */
export function announce(message: string): void {
    if (!message) return;
    for (const listener of listeners) listener(message);
}

export function subscribeAnnounce(listener: Listener): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}
