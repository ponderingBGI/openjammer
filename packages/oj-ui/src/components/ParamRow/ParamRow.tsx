import type { HTMLAttributes, ReactNode } from 'react';
import { Slider } from '../Slider/Slider';
import './ParamRow.css';

export interface ParamRowProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
    label: string;
    value: number;
    valueText: string;
    min: number;
    max: number;
    step?: number;
    readOnly?: boolean;
    driven?: boolean;
    pinned?: boolean;
    onChange?: (value: number) => void;
    onGestureStart?: () => void;
    onGestureEnd?: () => void;
    onLabelClick?: () => void;
    control?: ReactNode;
}

export function ParamRow({ label, value, valueText, min, max, step, readOnly, driven, pinned, onChange, onGestureStart, onGestureEnd, onLabelClick, control, className, ...rest }: ParamRowProps) {
    return <div className={['oj-param-row', className].filter(Boolean).join(' ')} {...rest}>
        <div className="oj-param-row__line">
            <button type="button" className="oj-param-row__label" title={label} aria-pressed={pinned} onClick={onLabelClick}>{label}</button>
            <span className={`oj-param-row__value${driven ? ' is-driven' : ''}`}>{valueText}</span>
        </div>
        {!readOnly && (control ?? <Slider aria-label={label} aria-valuetext={valueText} min={min} max={max} step={step} value={value} onChange={onChange ?? (() => {})} onPointerDown={onGestureStart} onPointerUp={onGestureEnd} onPointerCancel={onGestureEnd} onMouseDown={(event) => event.stopPropagation()} />)}
    </div>;
}
