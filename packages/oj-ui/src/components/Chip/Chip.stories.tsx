import type { Story } from '@ladle/react';
import { Chip } from './Chip';

export default { title: 'Primitives/Chip' };

export const Tones: Story = () => (
    <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap', alignItems: 'center' }}>
        <Chip>Neutral</Chip>
        <Chip tone="success">
            Connected
        </Chip>
        <Chip tone="warning">
            Pending
        </Chip>
        <Chip tone="danger">
            Failed
        </Chip>
    </div>
);

export const WithGlyphAndCount: Story = () => (
    <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap', alignItems: 'center' }}>
        <Chip glyph="＋">added looper</Chip>
        <Chip glyph="↬">connected Looper → Speaker</Chip>
        <Chip glyph="#" count={12}>
            reverb
        </Chip>
        <Chip count={3}>tags</Chip>
    </div>
);

export const FilterChips: Story = () => (
    <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap', alignItems: 'center' }}>
        <Chip pressed>Synths</Chip>
        <Chip>Effects</Chip>
        <Chip pressed glyph="★">
            Favorites
        </Chip>
        <Chip>Utility</Chip>
    </div>
);

/**
 * THE 13px FLOOR (DESIGN.md §3). A chip carries information, so it sits on the
 * floor with every other functional sans run; the trailing `count` is mono at
 * 11px, where the floor does not apply. This story is the size check — the row
 * below is what the topbar, the node type chips, the timeline section chips and
 * the Library tags all render.
 */
export const OnTheTypeFloor: Story = () => (
    <div style={{ display: 'grid', gap: 'var(--space-md)', maxWidth: 520 }}>
        <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap', alignItems: 'center' }}>
            <Chip>EFFECTS</Chip>
            <Chip>UTILITY</Chip>
            <Chip tone="success">44.1 kHz</Chip>
            <Chip tone="warning">2 plugins benched</Chip>
            <Chip count={12}>drums</Chip>
        </div>
        <p style={{ margin: 0, font: '500 var(--text-sm)/1.5 var(--font-sans)', color: 'var(--text-secondary)' }}>
            Both runs above are 13px Outfit 600; the count is 11px JetBrains Mono.
            Nothing in a chip is 12px — that step belongs to the <code>Field</code>{' '}
            label alone, which names a control instead of carrying information.
        </p>
    </div>
);
