import { useState } from 'react';
import { Tabs } from '@openjammer/oj-ui';

const OPTIONS = [
    { value: 'graphics', label: 'Graphics' },
    { value: 'audio', label: 'Audio' },
    { value: 'about', label: 'About' },
];

/** Underline-style tabs (one selected segment). */
export const Default = () => {
    const [value, setValue] = useState('audio');
    return <Tabs aria-label="Settings sections" value={value} onChange={setValue} options={OPTIONS} />;
};
