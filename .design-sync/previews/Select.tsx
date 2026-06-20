import { Select } from '@openjammer/oj-ui';

/** Native select in the design-system shell. */
export const Default = () => (
    <Select defaultValue="reverb" style={{ minWidth: 200 }}>
        <option value="reverb">Reverb</option>
        <option value="delay">Delay</option>
        <option value="distortion">Distortion</option>
        <option value="chorus">Chorus</option>
    </Select>
);
