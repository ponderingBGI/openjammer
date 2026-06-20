import type { Story } from '@ladle/react';
import { Menu, MenuItem, MenuCategory, MenuSeparator } from './Menu';
import { IconDownload, IconMute, IconBolt } from '../Icons/Icons';

export default { title: 'Composites/Menu' };

/**
 * A toolbar-style dropdown: items with shortcuts, a leading icon, a disabled
 * row, a separator, and a nested submenu (hover or focus the "Export as" row).
 */
export const Dropdown: Story = () => (
    <Menu ariaLabel="File" style={{ width: 240 }}>
        <MenuItem label="New Patch" shortcut="Ctrl N" onSelect={() => {}} />
        <MenuItem label="Open…" shortcut="Ctrl O" onSelect={() => {}} />
        <MenuItem label="Save" shortcut="Ctrl S" onSelect={() => {}} />
        <MenuItem
            label="Export as"
            submenu={
                <Menu ariaLabel="Export as" style={{ width: 200 }}>
                    <MenuItem
                        label="WAV"
                        leadingIcon={<IconDownload size={14} />}
                        onSelect={() => {}}
                    />
                    <MenuItem
                        label="Stems"
                        leadingIcon={<IconDownload size={14} />}
                        onSelect={() => {}}
                    />
                </Menu>
            }
        />
        <MenuSeparator />
        <MenuItem label="Close" shortcut="Ctrl W" disabled />
    </Menu>
);

/**
 * A context-menu projection: categories group the actions, a leading icon
 * marks each row, and a separator fences off the cancel affordance.
 */
export const ContextMenu: Story = () => (
    <Menu ariaLabel="Add node" style={{ width: 260 }}>
        <MenuCategory label="Instruments" icon={<IconBolt size={14} />} />
        <MenuItem label="Synth" onSelect={() => {}} />
        <MenuItem label="Sampler" onSelect={() => {}} />
        <MenuSeparator />
        <MenuCategory label="Effects" icon={<IconMute size={14} />} />
        <MenuItem label="Reverb" onSelect={() => {}} />
        <MenuItem label="Delay" shortcut="D" onSelect={() => {}} />
        <MenuSeparator />
        <MenuItem label="Cancel" onSelect={() => {}} />
    </Menu>
);
