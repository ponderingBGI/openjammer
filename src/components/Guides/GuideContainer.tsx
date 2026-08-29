import React from 'react';
import { Modal, PanelHeader } from '@openjammer/oj-ui';
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
 * GuideContainer — the dialog shell every guide is poured into.
 *
 * The overlay chrome is the oj-ui Modal: scrim, Escape, the Tab focus trap,
 * initial focus and focus restoration all come from there rather than being
 * hand-rolled here (the old version had a `role="dialog"` div with an onKeyDown
 * Escape and no trap at all). The strip is a PanelHeader; the body scrolls
 * inside the panel so the footer actions never leave the bottom.
 */
export function GuideContainer({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  footer
}: GuideContainerProps) {
  return (
    <Modal open={isOpen} onClose={onClose} ariaLabel={title} align="center" size="auto">
      <div className="guide-container">
        <PanelHeader title={title} subtitle={subtitle} onClose={onClose} />

        <ScrollContainer mode="dropdown" className="guide-content">
          {children}
        </ScrollContainer>

        {footer && <div className="guide-footer">{footer}</div>}
      </div>
    </Modal>
  );
}

export default GuideContainer;
