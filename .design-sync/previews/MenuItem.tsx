import { Menu, MenuItem, MenuCategory, MenuSeparator } from '@openjammer/oj-ui';
import { IconDownload, IconBolt } from '@openjammer/oj-ui';

/** MenuItem renders inside its parent Menu — categories group rows, items carry
 *  shortcuts + leading icons, a separator fences the destructive action. */
export const InMenu = () => (
    <Menu ariaLabel="Add node" style={{ width: 260 }}>
        <MenuCategory label="Sources" icon={<IconBolt size={14} />} />
        <MenuItem label="Oscillator" shortcut="O" onSelect={() => {}} />
        <MenuItem label="Sampler" onSelect={() => {}} />
        <MenuSeparator />
        <MenuCategory label="Output" />
        <MenuItem label="Export…" leadingIcon={<IconDownload size={14} />} onSelect={() => {}} />
        <MenuItem label="Delete" disabled />
    </Menu>
);
