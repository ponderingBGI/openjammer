/**
 * Theme System - Multiple color themes with persistence
 */

export interface Theme {
    id: string;
    name: string;
    colors: {
        // Background colors
        bgPrimary: string;
        bgSecondary: string;
        bgNode: string;
        bgTertiary: string;
        bgCanvas: string;          // Main canvas background
        bgCanvasAlt: string;       // Alternative canvas shade
        bgNodeHeader: string;      // Node header background

        // Text colors
        textPrimary: string;
        textSecondary: string;
        textMuted: string;
        textOnAccent: string;      // Text color on primary/success/warning buttons

        // Border colors
        borderSubtle: string;
        borderStrong: string;
        borderSketch: string;      // Primary border color for sketch elements

        // Sketch/Drawing colors
        sketchBlack: string;       // Primary lines/borders
        sketchGray: string;        // Secondary lines
        sketchLight: string;       // Subtle lines

        // Accent colors
        accentPrimary: string;
        accentSecondary: string;
        accentSuccess: string;
        accentWarning: string;
        accentDanger: string;

        // Audio connections (Blue, Directional)
        audioInput: string;       // Light blue - audio input ports
        audioOutput: string;      // Dark blue - audio output ports
        audioConnection: string;  // Medium blue - audio connection lines
        audioConnected: string;   // Bright blue - connected audio ports

        // Control connections (Grey, Bidirectional)
        controlInput: string;      // Dark grey - control input ports
        controlOutput: string;     // Light grey - control output ports
        controlConnection: string; // Medium grey - control connection lines
        controlConnected: string;  // Grey - connected control ports

        // Universal connections (Rainbow gradient, adapts to connected type)
        universalPort: string;     // Rainbow gradient for unconnected universal ports
        universalConnection: string; // Medium color for universal connection lines
    };
}

export const themes: Theme[] = [
    {
        id: 'cream',
        name: 'Cream',
        colors: {
            bgPrimary: '#F5F0E8',
            bgSecondary: '#EDE8DF',
            bgNode: '#FFFFFF',
            bgTertiary: '#E8E3DA',
            bgCanvas: '#F5F0E8',
            bgCanvasAlt: '#EDE8E0',
            bgNodeHeader: '#EDE8E0',
            textPrimary: '#1A1A1A',
            textSecondary: '#4A4A4A',
            textMuted: '#8A8A8A',
            textOnAccent: '#FFFFFF',
            borderSubtle: '#D4CFC6',
            borderStrong: '#1A1A1A',
            borderSketch: '#1A1A1A',
            sketchBlack: '#1A1A1A',
            sketchGray: '#4A4A4A',
            sketchLight: '#8A8A8A',
            accentPrimary: '#1A1A1A',
            accentSecondary: '#6B5B4F',
            accentSuccess: '#4A7C59',
            accentWarning: '#C68B3F',
            accentDanger: '#A65353',
            audioInput: '#7EB3D8',
            audioOutput: '#2C5F88',
            audioConnection: '#4A90C2',
            audioConnected: '#5B9FD4',
            controlInput: '#606060',
            controlOutput: '#A0A0A0',
            controlConnection: '#808080',
            controlConnected: '#909090',
            universalPort: '#9B59B6',  // Purple as base (gradient applied via CSS)
            universalConnection: '#9B59B6'
        }
    },
    {
        id: 'cyberpunk',
        name: 'Cyberpunk',
        colors: {
            // Ultra-dark backgrounds with deep purple undertones
            bgPrimary: '#08070D',        // Near-black with purple tint - the void
            bgSecondary: '#0F0E16',      // Deep purple-black for panels
            bgNode: '#14121D',           // Rich dark purple for nodes with neon glow
            bgTertiary: '#1C1826',       // Medium-dark purple for elevation
            bgCanvas: '#08070D',         // Deep void canvas
            bgCanvasAlt: '#0D0C13',      // Alternative dark shade
            bgNodeHeader: '#1A1625',     // Distinct header with purple depth

            // Neon text colors - bright but not harsh
            textPrimary: '#E0F4FF',      // Electric ice-blue for primary text
            textSecondary: '#D896FF',    // Neon purple for secondary text
            textMuted: '#6B6B85',        // Muted purple-grey for less important text
            textOnAccent: '#08070D',     // Deep black on neon buttons

            // Sharp neon borders
            borderSubtle: '#2A2538',     // Subtle purple borders
            borderStrong: '#00F0FF',     // Electric cyan for strong borders
            borderSketch: '#00F0FF',     // Neon cyan sketch elements

            // Neon sketch/drawing colors
            sketchBlack: '#00F0FF',      // Electric cyan for primary lines
            sketchGray: '#A855F7',       // Neon purple for secondary lines
            sketchLight: '#2A2538',      // Subtle purple for light elements

            // Stunning neon accent colors
            accentPrimary: '#FF0090',    // Hot magenta - bold and electric
            accentSecondary: '#00F0FF',  // Electric cyan - crisp and futuristic
            accentSuccess: '#00FF9F',    // Neon mint green for success
            accentWarning: '#FFD600',    // Electric yellow for warnings
            accentDanger: '#FF0050',     // Hot pink-red for danger

            // Audio connections - cyan/blue neon spectrum
            audioInput: '#00DDFF',       // Bright electric cyan for inputs
            audioOutput: '#0088FF',      // Deep neon blue for outputs
            audioConnection: '#00B8FF',  // Medium cyan-blue for lines
            audioConnected: '#00F4FF',   // Ultra-bright cyan when connected

            // Control connections - purple/magenta neon spectrum
            controlInput: '#6B4E8A',      // Deep neon purple for inputs
            controlOutput: '#B084D6',     // Bright purple for outputs
            controlConnection: '#8B6BB0', // Medium purple for lines
            controlConnected: '#A88BD6',  // Bright purple when connected
            universalPort: '#FF0090',     // Hot magenta as base (gradient applied via CSS)
            universalConnection: '#FF0090'
        }
    },
    {
        id: 'midnight',
        name: 'Midnight Blue',
        colors: {
            // Deep, rich dark backgrounds with blue undertones
            bgPrimary: '#0B0F19',        // Deep space blue-black for main canvas
            bgSecondary: '#131824',      // Slightly lighter for panels
            bgNode: '#1A2332',           // Rich dark blue for nodes with subtle elevation
            bgTertiary: '#24303F',       // Medium-dark for tertiary elements
            bgCanvas: '#0B0F19',         // Deep canvas background
            bgCanvasAlt: '#111620',      // Alternative canvas shade
            bgNodeHeader: '#1F2937',     // Distinct header with depth

            // Crisp, readable text with blue tints
            textPrimary: '#E8F0FF',      // Bright blue-white for maximum readability
            textSecondary: '#B4C5E4',    // Soft blue-grey for secondary text
            textMuted: '#6B7B95',        // Muted blue-grey for less important text
            textOnAccent: '#FFFFFF',     // Pure white on colored buttons

            // Elegant borders with proper contrast
            borderSubtle: '#2A3547',     // Subtle borders that define without overwhelming
            borderStrong: '#E8F0FF',     // Strong borders matching primary text
            borderSketch: '#E8F0FF',     // Sketch elements in crisp white-blue

            // Sketch/drawing colors for depth
            sketchBlack: '#E8F0FF',      // Primary sketch color
            sketchGray: '#6B7B95',       // Secondary sketch lines
            sketchLight: '#2A3547',      // Subtle sketch elements

            // Beautiful, vibrant accent colors
            accentPrimary: '#4A9EFF',    // Electric blue - energetic and clear
            accentSecondary: '#8B7FE8',  // Elegant purple-violet for variety
            accentSuccess: '#22D084',    // Vibrant emerald green for success
            accentWarning: '#FFA94D',    // Warm amber for warnings
            accentDanger: '#FF6B6B',     // Vibrant coral red for danger

            // Audio connections - blues with excellent contrast
            audioInput: '#6DB4FF',       // Bright cyan-blue for inputs
            audioOutput: '#2563EB',      // Deep electric blue for outputs
            audioConnection: '#4A8FE7',  // Medium blue for connection lines
            audioConnected: '#5B9FFF',   // Bright highlighted blue when connected

            // Control connections - greys with proper distinction
            controlInput: '#404B5C',      // Dark slate for control inputs
            controlOutput: '#8694A8',     // Medium grey for outputs
            controlConnection: '#5F6B7C', // Medium-dark grey for lines
            controlConnected: '#758195',  // Lighter grey when connected
            universalPort: '#8B7FE8',     // Purple-violet as base (gradient applied via CSS)
            universalConnection: '#8B7FE8'
        }
    }
];

export function applyTheme(theme: Theme): void {
    const root = document.documentElement;

    root.style.setProperty('--bg-primary', theme.colors.bgPrimary);
    root.style.setProperty('--bg-secondary', theme.colors.bgSecondary);
    root.style.setProperty('--bg-node', theme.colors.bgNode);
    root.style.setProperty('--bg-tertiary', theme.colors.bgTertiary);
    root.style.setProperty('--bg-canvas', theme.colors.bgCanvas);
    root.style.setProperty('--bg-canvas-alt', theme.colors.bgCanvasAlt);
    root.style.setProperty('--bg-node-header', theme.colors.bgNodeHeader);

    root.style.setProperty('--text-primary', theme.colors.textPrimary);
    root.style.setProperty('--text-secondary', theme.colors.textSecondary);
    root.style.setProperty('--text-muted', theme.colors.textMuted);
    root.style.setProperty('--text-on-accent', theme.colors.textOnAccent);

    root.style.setProperty('--border-subtle', theme.colors.borderSubtle);
    root.style.setProperty('--border-strong', theme.colors.borderStrong);
    root.style.setProperty('--border-sketch', theme.colors.borderSketch);

    root.style.setProperty('--sketch-black', theme.colors.sketchBlack);
    root.style.setProperty('--sketch-gray', theme.colors.sketchGray);
    root.style.setProperty('--sketch-light', theme.colors.sketchLight);

    root.style.setProperty('--accent-primary', theme.colors.accentPrimary);
    root.style.setProperty('--accent-secondary', theme.colors.accentSecondary);
    root.style.setProperty('--accent-success', theme.colors.accentSuccess);
    root.style.setProperty('--accent-warning', theme.colors.accentWarning);
    root.style.setProperty('--accent-danger', theme.colors.accentDanger);

    root.style.setProperty('--audio-input', theme.colors.audioInput);
    root.style.setProperty('--audio-output', theme.colors.audioOutput);
    root.style.setProperty('--audio-connection', theme.colors.audioConnection);
    root.style.setProperty('--audio-connected', theme.colors.audioConnected);
    root.style.setProperty('--control-input', theme.colors.controlInput);
    root.style.setProperty('--control-output', theme.colors.controlOutput);
    root.style.setProperty('--control-connection', theme.colors.controlConnection);
    root.style.setProperty('--control-connected', theme.colors.controlConnected);
    root.style.setProperty('--universal-port', theme.colors.universalPort);
    root.style.setProperty('--universal-connection', theme.colors.universalConnection);
}

export function getThemeById(id: string): Theme | undefined {
    return themes.find(t => t.id === id);
}

export function getSavedThemeId(): string {
    try {
        const savedId = localStorage.getItem('openjammer-theme');
        // Validate the saved theme ID exists
        if (savedId && themes.some(t => t.id === savedId)) {
            return savedId;
        }
        return 'cream';
    } catch (error) {
        console.error('Failed to read theme from localStorage:', error);
        return 'cream';
    }
}

export function saveThemeId(id: string): void {
    try {
        // Validate the theme ID exists before saving
        if (!themes.some(t => t.id === id)) {
            console.warn(`Invalid theme ID: ${id}, not saving`);
            return;
        }
        localStorage.setItem('openjammer-theme', id);
    } catch (error) {
        console.error('Failed to save theme to localStorage:', error);
    }
}
