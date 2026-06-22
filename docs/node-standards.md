# Node Standards — "every node is a stage instrument"

OpenJammer is played live, on stage, with no second take. A node is not a widget;
it is part of an instrument. This standard is the contract every node meets so the
whole fleet is trustworthy under a performer's hands. It follows from the two
beliefs ([agents.md](../agents.md)): **perception is the medium** (the audio path
blocks for nothing; a held note beats a glitch) and **a minimal core made infinite
by everyone** (ojcore stays tiny; when in doubt, it is a plugin).

> **How to read this doc.** The **cosmetic floor** (naming, ports, CSS, registry
> shape, oj-ui chrome) is **Section 0** at the bottom — necessary but *no longer
> sufficient*. Sections 1–6 below are the deep standard: the seam contract, the
> tiered requirements every node must meet, the antipatterns it forbids, the
> per-node authoring contract, the live-audio acceptance test, and the CI gates
> that make all of it self-enforcing.

---

## 1. The seam contract (one contract, pinned in both languages)

- **`node.data` is the persisted single source of truth.** Steady-state values
  flow `node.data` → manifest `ParamDecl` → `RtCommand::SetParam` to the kernel.
  Events (notes, sustain, looper actions, bypass) flow as typed `RtCommand`s.
- **No audio buffers cross the UI↔engine seam** — only `OjGraph` / `RtCommand` /
  `EngineFrame` JSON (and the packed `ParamPatch`). The *only* audio returns are
  the recorder/looper finalize tap and control-rate telemetry frames.
- **No protocol drift.** Every `PrimitiveKind` / `RtCommand` / `EngineFrame` /
  param-id must agree across `crates/ojproto`, `packages/oj-protocol-ts`, and
  `src/engine/manifest.ts`. The manifest's `PrimitiveKind` is **derived** from the
  SSOT, never hand-copied. Param ids for a bespoke (`ui:'react'`) engine node are
  declared explicitly (`PARAMS_BY_TYPE`), never auto-derived from `defaultData`
  field order. *(The looper's `looper→Delay` mismap and its `currentTime→WET=0`
  collision are the canonical failures this section prevents.)*

---

## 2. Requirements (tiered — each is testable; cite the belief it serves)

### P0 — Correctness & Safety (BLOCKING: cannot ship/perform)

| ID | Requirement | Verified by |
|----|-------------|-------------|
| SEAM-1 | No dead controls — every UI control provably drives the engine | seam round-trip test |
| SEAM-2 | Round-trip proven *by rendered sound*, not "command dispatched" | golden render |
| SEAM-3 | No protocol/manifest drift | SSOT gate (`oj doctor`) |
| SEAM-4 | Param ids agree with the kernel | param-id golden table |
| GAIN-1 | Inserting a transparent node is transparent (steady-state RMS Δ < ε after smoothing) | transparency test |
| GAIN-2 | Summing has headroom; one signal path (no doubled/redundant route into an output) | emit dedup + insert test |
| LIFE-1 | Every state has a reachable exit; capture always resolves a result | state-machine test |
| RT-1 | Audio thread is alloc/lock/block-free | `assert_no_alloc`, ≤16 B `RtCommand`/`RtEvent` guards, acyclic schedule |
| RT-2 | On failure, hold the last good sound; map onto the existing closed `FaultKind` (never grow the kernel from a UI need) | fault-injection test |

### P1 — Truth, Reversibility, Persistence

| ID | Requirement | Verified by |
|----|-------------|-------------|
| VIS-1 | Visuals come from a **real** engine feed (Meter / Beat / finalize PCM) — no synthetic motion; explicit empty state | no-synthetic-visual gate + zero-frame golden |
| REV-1 | Every user action is Ctrl+Z-reversible (via `beginGesture`/`endGesture`) | store + per-node undo test |
| PERSIST-1 | State survives save+reload **and is re-applied to the engine on load** | reload round-trip test |
| ERR-1 | Failures reported in-node, non-modal, no focus steal (shared `NodeStatus`) | no-focus-steal lint |
| RT-3 | Continuous controls send a coalesced `SetParam` — never a full recompile-on-drag | profiler / command test |

### P2 — Feel & Polish

Optimistic render then reconcile-to-truth · one shared value-editor primitive
(scroll/click/Enter/Escape) · legible empty/armed/active/error in peripheral
vision (colour always paired with label/icon) · No-Surprise/Hard-Shadow motion +
`prefers-reduced-motion` · keyboard + Ctrl+K reachable, ≥14 px, ≥4.5:1, oj-tokens
only · honest latency-tier badge.

### P3 — Docs, Extensibility, Self-enforcement

BND-1 plugin-by-default (new DSP = `PluginManifest` + `DspInstance`; a new RT-core
branch needs explicit [BOUNDARY.md](./BOUNDARY.md) justification) · `creating-nodes.md`
kept current · the inline **authoring-contract block** (§4) · `oj scaffold node` ·
the CI gates (§6).

---

## 3. Antipattern catalog (the looper defect class, generalised — all forbidden)

Dead control · nested-param seam miss · protocol/manifest drift · unpinned param
ids · fake/synthetic visual · dual/quadruple source of truth (params, labels,
device maps, registration) · recompile-on-drag · distortion/gain on insert ·
dead-end lifecycle · focus-stealing or silent failure · ephemeral (lost-on-reload)
state · un-undoable side effect · RT-violating node · empty no-op seam method ·
dead (declared-but-unrendered/unconsumed) registry port · core-creep.

---

## 4. The per-node authoring contract block

Every node ships an inline contract block (the CI couples it to the tests):

```
AUTHORING CONTRACT — <node-type>
  states:        <state machine; every state has a reachable exit>
  control→verb:  <each UI control → the RtCommand/SetParam/graph-verb it drives>
  visual source: <the REAL engine feed each visual reads; "none/static" if idle-only>
  persistence:   <node.data keys that survive reload + re-apply on load>
  error states:  <device-lost / not-ready / empty / overload — all non-modal>
  boundary:      <core vs plugin placement + why>
```

---

## 5. The live-audio acceptance test (the only test that ultimately matters)

Headphones on, patched into a sounding graph: move **every** control and **hear**
it; watch the visual stop when the audio stops; unplug a device mid-sound and
confirm the held note survives and a **badge** (not a dialog) appears; reload and
confirm state returns.

---

## 6. Self-enforcement (one `oj doctor` runner — no parallel scripts)

SSOT gate (manifest ↔ ojproto ↔ schema) · param-id golden table · node-registry
coupling (types ↔ registry ↔ single component map ↔ manifest ↔ contract block) ·
seam-coverage (every declared control has a round-trip test) · no-synthetic-visual
lint + zero-frame golden · transparency/gain test · RT-safety guards · no-empty-
seam-method / every-port-consumed · no-focus-steal lint. Gates ramp **warn → fail
per node** via a shrinking allowlist until empty — at which point the standard is
self-sustaining and a regression requires actively removing safety.

---

# Section 0 — The Cosmetic Floor (necessary, not sufficient)

The conventions below are the baseline every node already meets. They are required
but do **not** make a node a stage instrument on their own — Sections 1–6 do.

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

Examples: `effect`

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
