import { Chip, ProgressBar, IconWindows, IconApple, IconLinux } from '@openjammer/oj-ui';
import './Guide.css';

type Platform = 'windows' | 'mac' | 'linux' | 'unknown';

interface GuideProgressProps {
  completed: number;
  total: number;
  platform?: Platform;
}

/**
 * GuideProgress — how far through a guide you are.
 *
 * The bar is the shared oj-ui {@link ProgressBar} (a solid token fill, never a
 * gradient — Signal-Not-Brand), the count is mono because it is an exact number,
 * and the platform badge is a Chip with the shared icon set.
 */
export function GuideProgress({
  completed,
  total,
  platform,
}: GuideProgressProps) {
  const done = total > 0 && completed >= total;

  return (
    <div className="guide-progress">
      <div className="guide-progress-header">
        <span className="guide-progress-stats">
          <strong>{completed}</strong> of {total} steps complete
        </span>
        {platform && platform !== 'unknown' && (
          <Chip glyph={<PlatformIcon platform={platform} />}>{getPlatformName(platform)}</Chip>
        )}
      </div>
      <ProgressBar
        value={completed}
        max={Math.max(1, total)}
        tone={done ? 'success' : 'neutral'}
        aria-label={`${completed} of ${total} steps complete`}
      />
    </div>
  );
}

function getPlatformName(platform: Platform): string {
  switch (platform) {
    case 'windows':
      return 'Windows';
    case 'mac':
      return 'macOS';
    case 'linux':
      return 'Linux';
    default:
      return 'Unknown';
  }
}

function PlatformIcon({ platform }: { platform: Platform }) {
  switch (platform) {
    case 'windows':
      return <IconWindows size={12} />;
    case 'mac':
      return <IconApple size={12} />;
    case 'linux':
      return <IconLinux size={12} />;
    default:
      return <ComputerIcon />;
  }
}

function ComputerIcon() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

export default GuideProgress;
