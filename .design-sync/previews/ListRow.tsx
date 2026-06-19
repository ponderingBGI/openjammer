import { List, ListRow } from '@openjammer/oj-ui';

export const States = () => (
    <div style={{ maxWidth: 360 }}>
        <List aria-label="Models">
            <ListRow>Resting row</ListRow>
            <ListRow selected>Selected (accent ring + fill)</ListRow>
            <ListRow current>Current (left accent marker)</ListRow>
            <ListRow selected current>
                Selected + current
            </ListRow>
            <ListRow disabled>Disabled</ListRow>
        </List>
    </div>
);

export const WithActions = () => (
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
