import { OffscreenPointer } from '@openjammer/oj-ui';

export const Directions = () => (
    <div style={{ display: 'flex', gap: 'var(--space-xl)', flexWrap: 'wrap', alignItems: 'center' }}>
        <OffscreenPointer rotation={0} label="Back to nodes" onClick={() => {}} />
        <OffscreenPointer rotation={90} label="Below" onClick={() => {}} />
        <OffscreenPointer rotation={180} label="Left" onClick={() => {}} />
        <OffscreenPointer rotation={-90} label="Above" onClick={() => {}} />
        <OffscreenPointer rotation={135} label="Down &amp; left" onClick={() => {}} />
    </div>
);
