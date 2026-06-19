/**
 * @openjammer/oj-ui — OpenJammer's presentational component library.
 *
 * Theme-agnostic React primitives that read ONLY the semantic design-token CSS
 * variables (see @openjammer/oj-tokens). No imports from the app's stores,
 * audio engine, or WASM — these compose upward into the app, Ladle, Figma
 * (Code Connect), and the AI design agent.
 */

// ── Base primitives ────────────────────────────────────────────────────────
export { Button } from './components/Button/Button';
export type { ButtonProps, ButtonVariant } from './components/Button/Button';

export { Input } from './components/Input/Input';
export type { InputProps } from './components/Input/Input';

export { Field } from './components/Field/Field';
export type { FieldProps } from './components/Field/Field';

export { Select } from './components/Select/Select';
export type { SelectProps } from './components/Select/Select';

export { Port } from './components/Port/Port';
export type { PortProps, PortKind, PortDirection } from './components/Port/Port';

export { NodeShell } from './components/NodeShell/NodeShell';
export type { NodeShellProps } from './components/NodeShell/NodeShell';

// ── Surfaces & feedback ──────────────────────────────────────────────────────
export { Surface } from './components/Surface/Surface';
export type { SurfaceProps, SurfaceElevation, SurfaceRadius } from './components/Surface/Surface';

export { Callout } from './components/Callout/Callout';
export type { CalloutProps, CalloutVariant } from './components/Callout/Callout';

export { Chip } from './components/Chip/Chip';
export type { ChipProps, ChipTone } from './components/Chip/Chip';

export { Kbd } from './components/Kbd/Kbd';
export type { KbdProps } from './components/Kbd/Kbd';

export { StatusDot } from './components/StatusDot/StatusDot';
export type { StatusDotProps, StatusDotStatus } from './components/StatusDot/StatusDot';

export { Spinner } from './components/Spinner/Spinner';
export type { SpinnerProps } from './components/Spinner/Spinner';

export { ProgressBar } from './components/ProgressBar/ProgressBar';
export type { ProgressBarProps, ProgressBarTone } from './components/ProgressBar/ProgressBar';

// ── Form controls ────────────────────────────────────────────────────────────
export { Textarea } from './components/Textarea/Textarea';
export type { TextareaProps } from './components/Textarea/Textarea';

export { Slider } from './components/Slider/Slider';
export type { SliderProps } from './components/Slider/Slider';

export { Toggle } from './components/Toggle/Toggle';
export type { ToggleProps } from './components/Toggle/Toggle';

export { SegmentedControl, Tabs } from './components/SegmentedControl/SegmentedControl';
export type {
    SegmentedControlProps,
    SegmentedOption,
    TabsProps,
} from './components/SegmentedControl/SegmentedControl';

// ── Lists ────────────────────────────────────────────────────────────────────
export { List, ListRow } from './components/ListRow/ListRow';
export type { ListProps, ListRowProps } from './components/ListRow/ListRow';

// ── Canvas & misc ────────────────────────────────────────────────────────────
export { Marquee } from './components/Marquee/Marquee';
export type { MarqueeProps } from './components/Marquee/Marquee';

export { OffscreenPointer } from './components/OffscreenPointer/OffscreenPointer';
export type { OffscreenPointerProps } from './components/OffscreenPointer/OffscreenPointer';

export { Swatch } from './components/Swatch/Swatch';
export type { SwatchProps } from './components/Swatch/Swatch';

export { CodeBlock } from './components/CodeBlock/CodeBlock';
export type { CodeBlockProps } from './components/CodeBlock/CodeBlock';

// ── Icons ────────────────────────────────────────────────────────────────────
export {
    IconClose,
    IconChevronDown,
    IconChevronRight,
    IconMute,
    IconSpeaker,
    IconDownload,
    IconBolt,
    IconCheck,
    IconWarning,
    IconWindows,
    IconApple,
    IconLinux,
} from './components/Icons/Icons';
export type { IconProps } from './components/Icons/Icons';

// ── Composites ───────────────────────────────────────────────────────────────
export { IconButton } from './components/IconButton/IconButton';
export type { IconButtonProps, IconButtonVariant } from './components/IconButton/IconButton';

export { Modal } from './components/Modal/Modal';
export type { ModalProps, ModalAlign, ModalSize } from './components/Modal/Modal';

export { PanelHeader } from './components/PanelHeader/PanelHeader';
export type { PanelHeaderProps } from './components/PanelHeader/PanelHeader';

export { Menu, MenuItem, MenuCategory, MenuSeparator } from './components/Menu/Menu';
export type {
    MenuProps,
    MenuItemProps,
    MenuCategoryProps,
    MenuSeparatorProps,
} from './components/Menu/Menu';

export { PortRow } from './components/PortRow/PortRow';
export type { PortRowProps } from './components/PortRow/PortRow';

export { NodeFrame } from './components/NodeFrame/NodeFrame';
export type { NodeFrameProps, NodeFramePosition } from './components/NodeFrame/NodeFrame';

export { EditableLabel } from './components/EditableLabel/EditableLabel';
export type { EditableLabelProps } from './components/EditableLabel/EditableLabel';

export { ValueScrubber } from './components/ValueScrubber/ValueScrubber';
export type { ValueScrubberProps } from './components/ValueScrubber/ValueScrubber';

export { Cable } from './components/Cable/Cable';
export type { CableProps, CableKind } from './components/Cable/Cable';
export { cablePath } from './components/Cable/cablePath';
export type { CablePoint } from './components/Cable/cablePath';

export { Waveform } from './components/Waveform/Waveform';
export type { WaveformProps } from './components/Waveform/Waveform';

export { WaveformView } from './components/WaveformView/WaveformView';
export type { WaveformViewProps } from './components/WaveformView/WaveformView';

export { DeviceSelect } from './components/DeviceSelect/DeviceSelect';
export type { DeviceSelectProps, DeviceSelectItem } from './components/DeviceSelect/DeviceSelect';

export { KeyTile } from './components/KeyTile/KeyTile';
export type { KeyTileProps, KeyTileVariant } from './components/KeyTile/KeyTile';

export { Banner } from './components/Banner/Banner';
export type { BannerProps, BannerTone } from './components/Banner/Banner';
