/**
 * The spoken half of a refusal.
 *
 * The danger edge in `SchematicBase.css` is the glance; this is the sentence.
 * Colour is never the only carrier of a state (DESIGN.md), and a node that
 * silently refuses a delete or an `E` is a node that looks broken.
 */
export function NodeFeedback({ active, message }: { active: boolean; message: string }) {
    return (
        <span className="oj-node__feedback" role="status" aria-live="polite">
            {active ? message : ''}
        </span>
    );
}
