import './TimeRuler.css';
export interface TimeRulerMark { id: string | number; x: number; label?: string; level: 'bar' | 'beat' | 'sub'; }
export interface TimeRulerProps { marks: TimeRulerMark[]; width: number; className?: string; }
export function TimeRuler({ marks, width, className }: TimeRulerProps) {
    return <div className={['oj-time-ruler', className].filter(Boolean).join(' ')} style={{ width }} aria-hidden="true">{marks.map((mark) => <span key={mark.id} className={`oj-time-ruler__mark is-${mark.level}`} style={{ left: mark.x }}>{mark.label}</span>)}</div>;
}
