import type { Story } from '@ladle/react';
import { Field } from './Field';
import { Input } from '../Input/Input';
import { Select } from '../Select/Select';
import { Textarea } from '../Textarea/Textarea';

export default { title: 'Primitives/Field' };

export const States: Story = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)', maxWidth: 360 }}>
        <Field label="Project name" htmlFor="f-name">
            <Input id="f-name" defaultValue="Midnight Set" />
        </Field>

        <Field
            label="Buffer size"
            htmlFor="f-buffer"
            description="Smaller buffers cut latency and cost CPU. 128 is the live default."
        >
            <Select id="f-buffer" defaultValue="128">
                <option value="64">64 samples</option>
                <option value="128">128 samples</option>
                <option value="256">256 samples</option>
            </Select>
        </Field>

        <Field label="Tempo" htmlFor="f-bpm" error="Tempo must be between 20 and 300.">
            <Input id="f-bpm" mono type="number" defaultValue="999" aria-invalid="true" />
        </Field>

        <Field label="Notes" htmlFor="f-notes">
            <Textarea id="f-notes" rows={3} placeholder="What is this rig for?" />
        </Field>

        <Field label="Snap" htmlFor="f-snap" row>
            <Select id="f-snap" defaultValue="1/8">
                <option value="1/4">1/4</option>
                <option value="1/8">1/8</option>
                <option value="1/16">1/16</option>
            </Select>
        </Field>
    </div>
);
