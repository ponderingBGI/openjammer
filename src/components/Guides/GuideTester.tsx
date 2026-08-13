import { useState } from 'react';
import { Button } from '@openjammer/oj-ui';
import './Guide.css';

export type TestStatus = 'idle' | 'testing' | 'success' | 'failure' | 'warning';

interface GuideTesterProps {
  label: string;
  onTest: () => Promise<TestResult>;
  onSuccess?: () => void;
  onFailure?: () => void;
  disabled?: boolean;
  initialStatus?: TestStatus;
}

export interface TestResult {
  status: 'success' | 'failure' | 'warning';
  message?: string;
}

/**
 * GuideTester - Interactive test button with result display
 *
 * Features:
 * - Test button with loading state
 * - Result display (success/failure/warning)
 * - Retry capability
 * - Custom test function support
 */
export function GuideTester({
  label,
  onTest,
  onSuccess,
  onFailure,
  disabled = false,
  initialStatus = 'idle',
}: GuideTesterProps) {
  const [status, setStatus] = useState<TestStatus>(initialStatus);
  const [message, setMessage] = useState<string>('');

  const handleTest = async () => {
    if (disabled || status === 'testing') return;

    setStatus('testing');
    setMessage('');

    try {
      const result = await onTest();
      setStatus(result.status);
      setMessage(result.message || '');

      if (result.status === 'success' && onSuccess) {
        onSuccess();
      } else if (result.status === 'failure' && onFailure) {
        onFailure();
      }
    } catch (error) {
      setStatus('failure');
      setMessage(error instanceof Error ? error.message : 'Test failed');
      if (onFailure) onFailure();
    }
  };

  const handleRetry = () => {
    setStatus('idle');
    setMessage('');
  };

  return (
    <div className="guide-tester">
      {status === 'idle' || status === 'testing' ? (
        <Button
          variant="primary"
          onClick={handleTest}
          disabled={disabled || status === 'testing'}
        >
          {status === 'testing' ? (
            <>
              <SpinnerIcon />
              Testing...
            </>
          ) : (
            <>
              <PlayIcon />
              {label}
            </>
          )}
        </Button>
      ) : (
        <>
          <div className={`guide-test-result ${status}`}>
            {status === 'success' && <CheckIcon />}
            {status === 'failure' && <XIcon />}
            {status === 'warning' && <WarningIcon />}
            <span>{message || getDefaultMessage(status)}</span>
          </div>
          <Button
            variant="secondary"
            onClick={handleRetry}
            disabled={disabled}
          >
            <RefreshIcon />
            Retry
          </Button>
        </>
      )}
    </div>
  );
}

function getDefaultMessage(status: TestStatus): string {
  switch (status) {
    case 'success':
      return 'Test passed';
    case 'failure':
      return 'Test failed';
    case 'warning':
      return 'Partial success';
    default:
      return '';
  }
}

// Icons
function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="guide-spinner">
      <path d="M21 12a9 9 0 11-6.219-8.56" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
    </svg>
  );
}

export default GuideTester;
