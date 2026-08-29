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
