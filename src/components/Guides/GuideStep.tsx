import React, { useState } from 'react';
import { Spinner } from '@openjammer/oj-ui';
import './Guide.css';
import type { StepStatus } from './guideTypes';

export type { StepStatus } from './guideTypes';

interface GuideStepProps {
  stepNumber: number;
  title: string;
  description?: string;
  status: StepStatus;
  children?: React.ReactNode;
  defaultExpanded?: boolean;
}

const stepStatusClass = (status: StepStatus): string =>
  status === 'in_progress' ? 'in-progress' : status;

/** Announced beside the number so status is never colour alone. */
const STATUS_LABEL: Record<StepStatus, string> = {
  pending: 'Not started',
  in_progress: 'In progress',
  completed: 'Done',
  failed: 'Failed',
  skipped: 'Skipped',
};

/**
 * GuideStep — one step in a guide.
 *
 * A disclosure row: a status marker (the step number, a tick, a cross, a dash,
 * or the shared oj-ui Spinner while a step is running), the title + description,
 * and a chevron when the step carries content. `in_progress` is the one state
 * that draws the eye: the marker takes the accent fill and the row lifts onto
 * the node surface, because that is the step you are meant to be doing.
 */
export function GuideStep({
  stepNumber,
  title,
  description,
  status,
  children,
  defaultExpanded = false,
}: GuideStepProps) {
  const [isExpanded, setIsExpanded] = useState(
    defaultExpanded || status === 'in_progress' || status === 'pending'
  );

  const toggleExpanded = () => {
    setIsExpanded(!isExpanded);
  };

  return (
    <div className={`guide-step ${stepStatusClass(status)}`}>
      <button
        type="button"
        className="guide-step-header"
        onClick={toggleExpanded}
        aria-expanded={children ? isExpanded : undefined}
      >
        <StepStatusIndicator status={status} stepNumber={stepNumber} />

        <div className="guide-step-info">
          <h4 className="guide-step-title">{title}</h4>
          {description && (
            <p className="guide-step-description">{description}</p>
          )}
        </div>

        {children && (
          <div className={`guide-step-toggle ${isExpanded ? 'expanded' : ''}`}>
            <ChevronDownIcon />
          </div>
        )}
      </button>

      {children && isExpanded && (
        <div className="guide-step-content">
          {children}
        </div>
      )}
    </div>
  );
}

// Status indicator with step number or icon
function StepStatusIndicator({ status, stepNumber }: { status: StepStatus; stepNumber: number }) {
  const content = () => {
    switch (status) {
      case 'completed':
        return <CheckIcon />;
      case 'failed':
        return <XIcon />;
      case 'in_progress':
        return <Spinner size={14} />;
      case 'skipped':
        return <MinusIcon />;
      default:
        return stepNumber;
    }
  };

  return (
    <div className={`guide-step-status ${stepStatusClass(status)}`} title={STATUS_LABEL[status]}>
      <span className="sr-only">{STATUS_LABEL[status]}</span>
      {content()}
    </div>
  );
}

// Icons
function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function MinusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
