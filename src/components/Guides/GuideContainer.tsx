import React from 'react';
import { Button } from '@openjammer/oj-ui';
import { ScrollContainer } from '../common/ScrollContainer';
import './Guide.css';

interface GuideContainerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

/**
 * GuideContainer - A reusable full-screen modal wrapper for guides
 *
 * Features:
 * - Overlay with blur backdrop
 * - Animated entrance (fade + slide up)
 * - Header with title, subtitle, and close button
 * - Scrollable content area
 * - Optional footer for actions
 */
export function GuideContainer({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  footer
}: GuideContainerProps) {
  if (!isOpen) return null;

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div
      className="guide-overlay"
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-labelledby="guide-title"
    >
      <div className="guide-container">
        {/* Header */}
        <div className="guide-header">
          <div>
            <h2 id="guide-title" className="guide-header-title">{title}</h2>
            {subtitle && <p className="guide-header-subtitle">{subtitle}</p>}
          </div>
          <Button
            variant="ghost"
            iconOnly
            className="guide-close-btn"
            onClick={onClose}
            aria-label="Close guide"
          >
            <CloseIcon />
          </Button>
        </div>

        {/* Scrollable Content */}
        <ScrollContainer mode="dropdown" className="guide-content">
          {children}
        </ScrollContainer>

        {/* Footer */}
        {footer && (
          <div className="guide-footer">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// Close icon component
function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export default GuideContainer;
