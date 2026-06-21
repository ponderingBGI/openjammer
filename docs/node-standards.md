# Node Standards

This document defines the standards and conventions for creating nodes in OpenJammer. Following these standards ensures consistency across the codebase and makes nodes easier to maintain.

---

## Naming Conventions

### Node Types

Node types use **kebab-case**:

```typescript
// GOOD
'audio-mixer'
'mini-lab-3'
'keyboard-visual'

// BAD
'audioMixer'      // camelCase
'AudioMixer'      // PascalCase
'audio_mixer'     // snake_case
```

### Port IDs

Port IDs use **kebab-case**:

```typescript
// GOOD
'audio-in'
'audio-out'
'control-in'
'bundle-keys'

// BAD
'audioIn'         // camelCase
'audio_in'        // snake_case
```

### Component Names

Component names use **PascalCase** with `Node` suffix:

```typescript
// GOOD
export function MicrophoneNode() { }
export function AudioMixerNode() { }
export function MiniLab3VisualNode() { }

// BAD
export function Microphone() { }         // Missing Node suffix
export function microphoneNode() { }     // Wrong case
```

### CSS Classes

CSS classes match the node type in **kebab-case**:

```css
/* GOOD */
.microphone-node { }
.audio-mixer-node { }

/* BAD */
.microphoneNode { }    /* camelCase */
.MicrophoneNode { }    /* PascalCase */
```

### File Names

Component files use **PascalCase** matching the component:

```
src/components/Nodes/
├── MicrophoneNode.tsx
├── AudioMixerNode.tsx
├── MiniLab3VisualNode.tsx
└── MiniLab3VisualNode.css
```

---

## Port Templates

Use these standard port definitions for consistency:

### Audio Ports

```typescript
// Standard audio input
const audioInput: PortDefinition = {
    id: 'audio-in',
    name: 'Audio In',
    type: 'audio',
    direction: 'input',
    position: { x: 0, y: 0.5 }  // Left side, centered
};

// Standard audio output
const audioOutput: PortDefinition = {
    id: 'audio-out',
    name: 'Audio Out',
    type: 'audio',
    direction: 'output',
    position: { x: 1, y: 0.5 }  // Right side, centered
};
```

### Control Ports

```typescript
// Standard control input
const controlInput: PortDefinition = {
    id: 'control-in',
    name: 'Control',
    type: 'control',
    direction: 'input',
    position: { x: 0, y: 0.5 }
};

// Standard control output
const controlOutput: PortDefinition = {
    id: 'control-out',
    name: 'Control',
    type: 'control',
    direction: 'output',
    position: { x: 1, y: 0.5 }
};
```

### Bundle Ports

```typescript
// Bundle input (receives multiple signals)
const bundleInput: PortDefinition = {
    id: 'bundle-in',
    name: 'Bundle',
    type: 'control',
    direction: 'input',
    isBundled: true,
    position: { x: 0, y: 0.5 }
};
```

### Universal Ports

```typescript
// Universal port (accepts any signal type)
const universalInput: PortDefinition = {
    id: 'in-1',
    name: 'In 1',
    type: 'universal',
    direction: 'input',
    position: { x: 0, y: 0.5 }
};
```

---

## Required Fields by Category

### Input Nodes

Category: `'input'`

Required data fields:
```typescript
interface InputNodeData {
    isActive?: boolean;      // Whether input is active/streaming
    isMuted?: boolean;       // Whether output is muted
    deviceId?: string;       // Selected device ID (if device selection)
}
```

Examples: `keyboard`, `microphone`, `midi`, `library`

### Instrument Nodes

Category: `'instruments'`

Required data fields:
```typescript
interface InstrumentNodeData {
    offsets: Record<string, number>;  // Per-input pitch offsets
    activeInputs: string[];           // List of active input IDs
    instrumentId?: string;            // Instrument sample set ID
}
```

Examples: `piano`, `cello`, `violin`, `strings`, `keys`, `sampler`

### Effect Nodes

Category: `'effects'`

Required data fields:
```typescript
interface EffectNodeData {
    effectType?: string;              // Effect type identifier
    params?: Record<string, number>;  // Effect parameters
    // OR specific parameters:
    gain?: number;                    // For gain-based effects
    amount?: number;                  // For intensity-based effects
}
```

Examples: `effect`, `amplifier`

### Routing Nodes

Category: `'routing'`

Required data fields:
```typescript
interface RoutingNodeData {
    // Minimal - mainly for panels
    portLabels?: Record<string, string>;
    portHideExternalLabel?: Record<string, boolean>;
}
```

Examples: `container`, `looper`, `input-panel`, `output-panel`

### Output Nodes

Category: `'output'`

Required data fields:
```typescript
interface OutputNodeData {
    volume: number;          // 0-1 output volume
    isMuted: boolean;        // Mute state
    deviceId?: string;       // Output device ID
}
```

Examples: `speaker`, `recorder`

### Utility Nodes

Category: `'utility'`

Required data fields:
```typescript
interface UtilityNodeData {
    resolvedType?: 'audio' | 'control' | null;  // For universal ports
}
```

Examples: `add`, `subtract`

---

## Port Position Guidelines

### Position Normalization

All port positions use normalized 0-1 coordinates:
- `x: 0` = left edge
- `x: 1` = right edge
- `y: 0` = top edge
- `y: 1` = bottom edge

### Standard Layouts

**Single input/output:**
```typescript
ports: [
    { ...input,  position: { x: 0, y: 0.5 } },  // Centered left
    { ...output, position: { x: 1, y: 0.5 } }   // Centered right
]
```

**Two inputs, one output:**
```typescript
ports: [
    { id: 'in-1', position: { x: 0, y: 0.33 } },
    { id: 'in-2', position: { x: 0, y: 0.67 } },
    { id: 'out',  position: { x: 1, y: 0.5  } }
]
```

**Three inputs, one output:**
```typescript
ports: [
    { id: 'in-1', position: { x: 0, y: 0.25 } },
    { id: 'in-2', position: { x: 0, y: 0.5  } },
    { id: 'in-3', position: { x: 0, y: 0.75 } },
    { id: 'out',  position: { x: 1, y: 0.5  } }
]
```

**Multiple rows (keyboard-style):**
```typescript
// Keep ports in logical groups
ports: [
    // Row 1 ports: y 0.05-0.25
    { id: 'row-1-a', position: { x: 1, y: 0.10 } },
    { id: 'row-1-b', position: { x: 1, y: 0.20 } },
    // Row 2 ports: y 0.30-0.50
    { id: 'row-2-a', position: { x: 1, y: 0.35 } },
    { id: 'row-2-b', position: { x: 1, y: 0.45 } },
    // ...
]
```

### Port Spacing Formula

For `n` evenly-spaced ports:
```typescript
const portPositions = Array.from({ length: n }, (_, i) => ({
    y: (i + 1) / (n + 1)  // Evenly distributed between 0 and 1
}));
```

---

## Registry Entry Structure

### Required Fields

```typescript
'my-node': {
    type: 'my-node',           // Must match NodeType (registry is a Record, keyed by type)
    category: 'effects',       // One of: input, instruments, effects, routing, output, utility
    name: 'My Node',           // Display name in menu
    description: 'Does X',     // Tooltip/help text
    defaultPorts: [...],       // Initial port configuration
    defaultData: {...}         // Initial node data
}
```

### Optional Fields

```typescript
{
    // Dimensions
    dimensions: { width: 180, height: 100 },

    // Port layout for automatic positioning
    portLayout: {
        direction: 'vertical',
        inputArea: { x: 0, startY: 0.2, endY: 0.8 },
        outputArea: { x: 1, startY: 0.4, endY: 0.6 }
    },

    // Hierarchical behavior
    canEnter: true    // Allows E key to enter the internal canvas (omit for atomic nodes)
}
```

---

## Component Props Interface

All node components should accept these props:

```typescript
interface StandardNodeProps {
    // Core
    node: GraphNode;
    isSelected: boolean;
    isDragging: boolean;
    style: React.CSSProperties;

    // Port interaction
    handlePortMouseDown?: (portId: string, e: React.MouseEvent) => void;
    handlePortMouseUp?: (portId: string, e: React.MouseEvent) => void;
    handlePortMouseEnter?: (portId: string) => void;
    handlePortMouseLeave?: () => void;
    hasConnection: (portId: string) => boolean;

    // Node interaction
    handleHeaderMouseDown: (e: React.MouseEvent) => void;
    handleNodeMouseEnter: () => void;
    handleNodeMouseLeave: () => void;

    // Connection state
    isHoveredWithConnections?: boolean;
    incomingConnectionCount?: number;
}
```

---

## CSS Class Conventions

### Base Structure

```css
.my-node {
    /* Container styles */
}

.my-node.selected {
    /* Selected state */
}

.my-node.dragging {
    /* Dragging state */
}

.my-node .node-header {
    /* Header/title area */
}

.my-node .node-body {
    /* Content area */
}

.my-node .my-node-port {
    /* Port styling */
}

.my-node .my-node-port.connected {
    /* Connected port state */
}
```

### Schematic Style

Most nodes use the "schematic" style for consistency:

```css
.schematic-node {
    background: var(--node-bg, #1a1a2e);
    border: 1px solid var(--node-border, #2a2a4e);
    border-radius: 4px;
}

.schematic-node.selected {
    border-color: var(--selection-color, #4a9eff);
    box-shadow: 0 0 0 1px var(--selection-color, #4a9eff);
}

.schematic-header {
    padding: 4px 8px;
    background: var(--header-bg, #252540);
    border-bottom: 1px solid var(--node-border, #2a2a4e);
    font-size: 11px;
    font-weight: 500;
}
```

---

## Validation Rules

The `validate-nodes` tool checks for these issues:

### Errors (Must Fix)
- Node type not in `NodeType` union
- No registry entry for type
- No component file exists
- No NodeWrapper routing case

### Warnings (Should Fix)
- Port ID not in kebab-case
- Port position outside 0-1 range
- Component name doesn't end in `Node`
- Missing `defaultData` in registry
- CSS file referenced but doesn't exist

### Info (Nice to Have)
- Description is empty or very short
- No dimensions specified (uses defaults)
- Missing category-specific data fields

---

## Examples of Well-Structured Nodes

### Atomic Node: MicrophoneNode

```
Location: src/components/Nodes/MicrophoneNode.tsx

Features:
- Clean separation of audio logic and UI
- Proper cleanup in useEffect
- Device selection with dropdown
- Waveform visualization
- Mute toggle
- Low latency mode support
```

### Hierarchical Node: KeyboardNode

```
Location:
- src/components/Nodes/KeyboardNode.tsx (parent)
- src/components/Nodes/KeyboardVisualNode.tsx (internal)
- src/utils/nodeInternals.ts (internal structure)

Features:
- Internal keyboard-visual with per-key ports
- Output panel syncing ports to parent
- Row-based organization
- Bundle connections
```

### Resizable Node: LibraryNode

```
Location: src/components/Nodes/LibraryNode.tsx

Features:
- useResize hook for node sizing
- usePanelResize hook for internal separator
- Persistent dimensions in node.data
- Responsive internal layout
```

---

## Quick Reference

| Aspect | Convention |
|--------|-----------|
| Node type | `kebab-case` |
| Port ID | `kebab-case` |
| Component | `PascalCaseNode` |
| CSS class | `kebab-case` |
| File name | `PascalCaseNode.tsx` |
| Position x | 0 (input) or 1 (output) |
| Position y | 0-1 normalized |
| Data updates | `useGraphStore().updateNodeData()` |
| Audio cleanup | In useEffect return function |
