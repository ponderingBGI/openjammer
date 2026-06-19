/**
 * Theme types — the runtime shape of a theme. The color keys ARE the semantic
 * token contract: each `camelCase` key maps to a `--kebab-case` CSS custom
 * property the whole app (and oj-ui) reads. Keep this in sync with the `color`
 * group authored in `tokens/themes/*.json`.
 */

export interface ThemeColors {
    // Background colors
    bgPrimary: string;
    bgSecondary: string;
    bgNode: string;
    bgTertiary: string;
    bgCanvas: string;
    bgCanvasAlt: string;
    bgNodeHeader: string;

    // Text colors
    textPrimary: string;
    textSecondary: string;
    textMuted: string;
    textOnAccent: string;

    // Border colors
    borderSubtle: string;
    borderStrong: string;
    borderSketch: string;

    // Sketch / drawing colors
    sketchBlack: string;
    sketchGray: string;
    sketchLight: string;

    // Accent colors
    accentPrimary: string;
    accentSecondary: string;
    accentSuccess: string;
    accentWarning: string;
    accentDanger: string;

    // Audio connections (blue, directional)
    audioInput: string;
    audioOutput: string;
    audioConnection: string;
    audioConnected: string;

    // Control connections (grey, bidirectional)
    controlInput: string;
    controlOutput: string;
    controlConnection: string;
    controlConnected: string;

    // Universal connections (adapts to connected type)
    universalPort: string;
    universalConnection: string;
}

export interface Theme {
    id: string;
    name: string;
    colors: ThemeColors;
}
