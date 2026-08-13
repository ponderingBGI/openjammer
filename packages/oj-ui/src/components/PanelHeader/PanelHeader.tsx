import type { HTMLAttributes, ReactNode } from 'react';
import { Button } from '../Button/Button';
import { IconButton } from '../IconButton/IconButton';
import { IconClose, IconChevronRight } from '../Icons/Icons';
import './PanelHeader.css';

export interface PanelHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
    /** The strip's heading, set in the Caveat voice (Caveat-Is-the-Voice). */
    title?: ReactNode;
    /** A quieter line under the title, set in Inter for dense reading. */
    subtitle?: ReactNode;
    /**
     * When given, a leading ghost back affordance (a left-pointing chevron +
     * `backLabel`) is shown; clicking it calls this. Mirrors the AI command
     * bar's `← Back` step.
     */
    onBack?: () => void;
    /** Accessible/visible label for the back affordance. Defaults to `Back`. */
    backLabel?: string;
    /**
     * A marker next to the title — a Chip, a count, a status. Accepts any node
     * so the caller owns its exact shape; per Signal-Not-Brand it should carry
     * its own label/glyph when toned.
     */
    badge?: ReactNode;
    /** When given, a trailing close button (an `IconClose`) is shown. */
    onClose?: () => void;
    /** Right-aligned slot for header actions (buttons, menus), before close. */
    actions?: ReactNode;
    /** Extra content rendered below the title row (e.g. a search field, tabs). */
    children?: ReactNode;
}

/**
 * A panel / dialog title strip. A space-between row: on the left an optional
 * back step then the title (Caveat) and subtitle (Inter) with an optional
 * badge; on the right an actions slot then an optional close button. Composes
 * Button, IconButton and the close/chevron icons — props in, callbacks out, no
 * app state. Theme-agnostic: styled entirely via semantic CSS variables, so it
 * follows the active theme. Replaces the AI command-bar header, the minimal
 * settings header, the MIDI browser header, and the other `*-header` strips.
 */
export function PanelHeader({
    title,
    subtitle,
    onBack,
    backLabel = 'Back',
    badge,
    onClose,
    actions,
    className,
    children,
    ...rest
}: PanelHeaderProps) {
    const classes = ['oj-panel-header', className].filter(Boolean).join(' ');

    return (
        <div className={classes} {...rest}>
            <div className="oj-panel-header__row">
                <div className="oj-panel-header__left">
                    {onBack && (
                        <Button
                            variant="ghost"
                            className="oj-panel-header__back"
                            onClick={onBack}
                        >
                            <IconChevronRight
                                className="oj-panel-header__back-chevron"
                                aria-hidden="true"
                            />
                            {backLabel}
                        </Button>
                    )}
                    {(title != null || subtitle != null || badge != null) && (
                        <div className="oj-panel-header__heading">
                            {(title != null || badge != null) && (
                                <div className="oj-panel-header__title-row">
                                    {title != null && (
                                        <span className="oj-panel-header__title">{title}</span>
                                    )}
                                    {badge != null && (
                                        <span className="oj-panel-header__badge">{badge}</span>
                                    )}
                                </div>
                            )}
                            {subtitle != null && (
                                <span className="oj-panel-header__subtitle">{subtitle}</span>
                            )}
                        </div>
                    )}
                </div>
                {(actions != null || onClose) && (
                    <div className="oj-panel-header__right">
                        {actions != null && (
                            <div className="oj-panel-header__actions">{actions}</div>
                        )}
                        {onClose && (
                            <IconButton
                                label="Close"
                                className="oj-panel-header__close"
                                onClick={onClose}
                            >
                                <IconClose />
                            </IconButton>
                        )}
                    </div>
                )}
            </div>
            {children != null && <div className="oj-panel-header__extra">{children}</div>}
        </div>
    );
}
