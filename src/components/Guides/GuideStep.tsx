import React, { useState } from 'react';
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

/**
 * GuideStep - An individual step in a guide
 *
 * Features:
 * - Visual status indicator (pending, in_progress, completed, failed, skipped)
 * - Expandable/collapsible content
 * - Step number display
 * - Animated transitions
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
        return <SpinnerIcon />;
      case 'skipped':
        return <MinusIcon />;
      default:
        return stepNumber;
    }
  };

  return (
    <div className={`guide-step-status ${stepStatusClass(status)}`}>
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

function SpinnerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="guide-spinner">
      <path d="M21 12a9 9 0 11-6.219-8.56" />
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

