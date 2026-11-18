import React from 'react';
import { Callout, type CalloutVariant } from '@openjammer/oj-ui';
import './Guide.css';

export type InfoBoxType = 'info' | 'success' | 'warning' | 'error' | 'tip';

interface GuideInfoBoxProps {
  type: InfoBoxType;
  title?: string;
  children: React.ReactNode;
}

/** The guide's own vocabulary mapped onto the app's one message component. */
const VARIANT: Record<InfoBoxType, CalloutVariant> = {
  info: 'info',
  success: 'success',
  warning: 'warning',
  error: 'danger',
  tip: 'tip',
};

/**
 * GuideInfoBox — a message inside a guide.
 *
 * This is now a thin adapter over the oj-ui {@link Callout}: same surface, same
 * hairline, same tinted-title-only rule as every other message in the app. It
 * used to draw five bespoke tinted cards in literal hex, which meant a guide's
 * warning looked nothing like a warning anywhere else in OpenJammer.
 */
export function GuideInfoBox({
  type,
  title,
  children,
}: GuideInfoBoxProps) {
  return (
    <Callout variant={VARIANT[type]} title={title} icon={<InfoIcon type={type} />}>
      {children}
    </Callout>
  );
}

function InfoIcon({ type }: { type: InfoBoxType }) {
  switch (type) {
    case 'success':
      return <CheckCircleIcon />;
    case 'warning':
      return <WarningIcon />;
    case 'error':
      return <ErrorIcon />;
    case 'tip':
      return <LightbulbIcon />;
    default:
      return <InfoCircleIcon />;
  }
}

// Icons
function InfoCircleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
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

function ErrorIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
}

function LightbulbIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18h6" />
      <path d="M10 22h4" />
      <path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0018 8 6 6 0 006 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 018.91 14" />
    </svg>
  );
}

export default GuideInfoBox;
