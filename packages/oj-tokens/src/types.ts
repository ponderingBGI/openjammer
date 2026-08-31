/**
 * Theme types — the runtime shape of a theme. The color keys ARE the semantic
 * token contract: each `camelCase` key maps to a `--kebab-case` CSS custom
 * property the whole app (and oj-ui) reads. Keep this in sync with the `color`
 * group authored in `tokens/themes/*.json`.
 */

export interface ThemeValues {
    // Background colors
    bgPrimary: string;
    bgSecondary: string;
    bgNode: string;
    bgTertiary: string;
    bgCanvas: string;
    bgNodeHeader: string;

    // Text colors
    textPrimary: string;
    textSecondary: string;
    textMuted: string;
    textOnAccent: string;

    // Border colors
    borderSubtle: string;
    borderStrong: string;
    borderControl: string;

    // Accent colors
    accentPrimary: string;
    accentSecondary: string;
    accentSuccess: string;
    accentWarning: string;
    accentDanger: string;

    // Audio connections (blue, directional)
    audioConnection: string;
    audioConnected: string;

    // Control connections (grey, bidirectional)
    controlConnection: string;
    controlConnected: string;

    // Universal connections (adapts to connected type)
    universalPort: string;
    universalConnection: string;

    // Arrangement timeline
    timelineBg: string;
    timelineChromeBg: string;
    timelineLaneBg: string;
    timelineLaneAltBg: string;
    timelineGridBar: string;
    timelineGridBeat: string;
    timelineGridSub: string;
    timelineLaneDivider: string;
    timelineClipBg: string;
    timelineClipBorder: string;
    timelineClipMutedBg: string;
    timelineNoteFill: string;
    timelineWaveformFill: string;
    timelineAutomationLine: string;
    timelinePlayhead: string;
    timelineSectionMarker: string;
    timelineLoopRange: string;
    timelineSelection: string;

    // Elevation, focus, accessible semantic ink, and overlays
    shadowRaised: string;
    shadowOverlay: string;
    shadowInset: string;
    shadowPressed: string;
    focusRing: string;
    accentInk: string;
    accentTwoInk: string;
    successInk: string;
    warningInk: string;
    dangerInk: string;
    audioInk: string;
    overlayScrim: string;
}

export interface Theme {
    id: string;
    name: string;
    colors: ThemeValues;
}
