import { Chip } from '@openjammer/oj-ui';

export const Tones = () => (
    <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap', alignItems: 'center' }}>
        <Chip>Neutral</Chip>
        <Chip tone="success" glyph="●">
            Connected
        </Chip>
        <Chip tone="warning" glyph="▲">
            Pending
        </Chip>
        <Chip tone="danger" glyph="✕">
            Failed
        </Chip>
    </div>
);

export const WithGlyphAndCount = () => (
    <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap', alignItems: 'center' }}>
        <Chip glyph="＋">added looper</Chip>
        <Chip glyph="↬">connected Looper → Speaker</Chip>
        <Chip glyph="#" count={12}>
            reverb
        </Chip>
        <Chip count={3}>tags</Chip>
    </div>
);

export const FilterChips = () => (
    <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap', alignItems: 'center' }}>
        <Chip pressed>Synths</Chip>
        <Chip>Effects</Chip>
        <Chip pressed glyph="✓">
            Favorites
        </Chip>
        <Chip>Utility</Chip>
    </div>
);
