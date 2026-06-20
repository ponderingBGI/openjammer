import { List, ListRow } from '@openjammer/oj-ui';

/** A selectable list — resting, selected (accent fill), and current (left marker) rows. */
export const Default = () => (
    <List aria-label="Audio devices" style={{ minWidth: 280 }}>
        <ListRow>Built-in Output</ListRow>
        <ListRow selected>Scarlett 2i2 USB</ListRow>
        <ListRow current>BlackHole 2ch</ListRow>
        <ListRow>Aggregate Device</ListRow>
    </List>
);
