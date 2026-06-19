# Figma component build-scripts (oj-ui → Figma library)

Auto-authored (one per component) from the oj-ui source by a parallel workflow, to be run via
the Figma MCP `use_figma` tool into the **OpenJammer oj-ui Library** file
(`ayHEMsJL1BPhvTYWi1CFJs`) on top of the already-created Variables (Primitives + Theme×3 modes).

Each script builds ONE component as a Figma component/variant-set, every visual property bound
to the design-system Variables. Run sequentially (Figma mutations must not be parallel). `ok` =
passed an automated sanity review; `flagged` = the reviewer noted a design-fidelity gap or a
possible bug — eyeball before/after running. Already built by hand (not here): Button, Chip, Kbd,
StatusDot, Spinner, Swatch, ProgressBar.

| Component | Page | Status |
|---|---|---|
| Input | Primitives | ok |
| Textarea | Primitives | flagged |
| Select | Primitives | ok |
| Field | Primitives | ok |
| Slider | Primitives | ok |
| Toggle | Primitives | flagged |
| Callout | Primitives | ok |
| Surface | Primitives | flagged |
| Marquee | Primitives | ok |
| OffscreenPointer | Primitives | ok |
| SegmentedControl | Primitives | flagged |
| Tabs | Primitives | flagged |
| List | Primitives | flagged |
| ListRow | Primitives | flagged |
| CodeBlock | Primitives | flagged |
| Port | Composites | flagged |
| PortRow | Composites | flagged |
| NodeShell | Composites | flagged |
| NodeFrame | Composites | ok |
| KeyTile | Composites | ok |
| Cable | Composites | flagged |
| Waveform | Composites | flagged |
| WaveformView | Composites | flagged |
| DeviceSelect | Composites | ok |
| Modal | Composites | ok |
| PanelHeader | Composites | flagged |
| IconButton | Composites | ok |
| Banner | Composites | flagged |
| EditableLabel | Composites | ok |
| ValueScrubber | Composites | ok |
| Menu | Composites | flagged |
| MenuItem | Composites | ok |
| MenuCategory | Composites | flagged |
| MenuSeparator | Composites | flagged |
| IconApple | Icons | ok |
| IconBolt | Icons | ok |
| IconCheck | Icons | ok |
| IconChevronDown | Icons | ok |
| IconChevronRight | Icons | flagged |
| IconClose | Icons | ok |
| IconDownload | Icons | ok |
| IconLinux | Icons | ok |
| IconMute | Icons | ok |
| IconSpeaker | Icons | ok |
| IconWarning | Icons | ok |
| IconWindows | Icons | ok |
