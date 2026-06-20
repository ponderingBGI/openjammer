import { Banner } from '@openjammer/oj-ui';
import { Button } from '@openjammer/oj-ui';
import { IconWarning } from '@openjammer/oj-ui';

export const Tones = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        <Banner
            tone="info"
            icon={<IconWarning />}
            title="A new audio interface is available"
            message="Plugging in a USB interface usually drops your round-trip latency."
        />
        <Banner
            tone="warning"
            icon={<IconWarning />}
            title="Audio latency is climbing"
            message="Your round-trip is in the ~25ms range — playable, but you may feel it."
        />
        <Banner
            tone="danger"
            icon={<IconWarning />}
            title="High Audio Latency Detected"
            message="Your audio latency may affect live playing experience."
        />
    </div>
);

export const WithActions = () => (
    <Banner
        tone="danger"
        icon={<IconWarning />}
        title="High Audio Latency Detected"
        message="Your audio latency may affect live playing experience."
        actions={
            <>
                <Button variant="primary">Fix Now</Button>
                <Button variant="secondary">Ask AI</Button>
                <Button variant="ghost">Dismiss</Button>
            </>
        }
    />
);

export const TitleOnly = () => (
    <Banner tone="warning" icon={<IconWarning />} title="Saved offline — changes will sync when you reconnect" />
);
