import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useScrollCapture } from '../useScrollCapture';

function ValueScrubber() {
    const [value, setValue] = useState(10);
    const { ref } = useScrollCapture<HTMLSpanElement>({
        capture: true,
        onScroll: ({ scrollingUp }) => setValue((current) => current + (scrollingUp ? 1 : -1)),
    });
    return <span ref={ref} data-testid="scrubber">{value}</span>;
}

describe('useScrollCapture value-scrubber contract', () => {
    it('preserves the established positive-delta scrollingUp semantics', () => {
        render(<ValueScrubber />);
        fireEvent.wheel(screen.getByTestId('scrubber'), { deltaY: 40 });
        expect(screen.getByTestId('scrubber')).toHaveTextContent('11');

        fireEvent.wheel(screen.getByTestId('scrubber'), { deltaY: -40 });
        expect(screen.getByTestId('scrubber')).toHaveTextContent('10');
    });
});
