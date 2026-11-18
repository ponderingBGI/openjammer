import type { Story } from '@ladle/react';
import { List, ListRow } from './ListRow';

export default { title: 'Primitives/ListRow' };

export const States: Story = () => (
    <div style={{ maxWidth: 360 }}>
        <List aria-label="Models">
            <ListRow tabIndex={0}>Resting row</ListRow>
            <ListRow tabIndex={0} selected>Selected (inset fill + focus outline)</ListRow>
            <ListRow tabIndex={0} current>Current (accent dot)</ListRow>
            <ListRow tabIndex={0} selected current>
                Selected + current
            </ListRow>
            <ListRow disabled>Disabled</ListRow>
        </List>
    </div>
);

export const WithActions: Story = () => (
    <div style={{ maxWidth: 360 }}>
        <List role="listbox" aria-label="Sessions">
            <ListRow
                actions={
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                        ab12cd
                    </span>
                }
            >
                Last warm-up jam
            </ListRow>
            <ListRow
                current
                actions={
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                        ef34gh
                    </span>
                }
            >
                Tonight&rsquo;s set
            </ListRow>
            <ListRow
                selected
                actions={
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                        ij56kl
                    </span>
                }
            >
                Encore ideas
            </ListRow>
        </List>
    </div>
);

/**
 * THE BODY IS A ROW, and the component says so (W5-P7b non-blocking 12).
 *
 * The first list is the shape six consumers each re-declared for themselves: a
 * sized dot, a name that truncates, a trailing chip. It renders correctly with
 * nothing but `ListRow` now — before the fix the dot was an inline span and
 * painted 0×0.
 *
 * The second list is the case the fix must NOT break: a body that is nothing but
 * text and truncates with an ellipsis, the way the command bar's rewind list
 * does.
 */
export const BodyShapes: Story = () => (
    <div style={{ display: 'grid', gap: 'var(--space-lg)', maxWidth: 340 }}>
        <List aria-label="Tags">
            {[
                ['oklch(0.66 0.19 40)', 'drums'],
                ['oklch(0.6 0.12 200)', 'pads that need a much longer name'],
                ['oklch(0.66 0.19 300)', 'warm'],
            ].map(([color, name]) => (
                <ListRow key={name} actions={<span style={{ font: '500 var(--text-xs)/1 var(--font-mono)', color: 'var(--text-muted)' }}>12</span>}>
                    <span style={{ flex: 'none', width: 8, height: 8, borderRadius: 'var(--radius-pill)', background: color }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                </ListRow>
            ))}
        </List>
        {/* The command bar's own rule, verbatim, so the story shows the real case. */}
        <style>{'.story-rewind-row { overflow: hidden; } .story-rewind-row .oj-list-row__body { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }'}</style>
        <List role="listbox" aria-label="Rewind">
            {['Add a looper after the sampler and wire it into the speaker, then arm the take', 'Shorter turn'].map((text) => (
                <ListRow key={text} className="story-rewind-row">{text}</ListRow>
            ))}
        </List>
    </div>
);
