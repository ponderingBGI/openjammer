import type { ButtonHTMLAttributes, ReactNode } from 'react';
import './LaneButton.css';

export type LaneButtonTone = 'default' | 'mute' | 'solo' | 'armed' | 'recording';
export interface LaneButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    tone?: LaneButtonTone;
    children: ReactNode;
}

export function LaneButton({ tone = 'default', className, children, ...props }: LaneButtonProps) {
    return <button type="button" className={['oj-lane-button', `oj-lane-button--${tone}`, className].filter(Boolean).join(' ')} {...props}>{children}</button>;
}
