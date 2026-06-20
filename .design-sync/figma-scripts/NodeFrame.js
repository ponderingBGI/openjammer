const page = await figma.getNodeByIdAsync('3:3');
await figma.setCurrentPageAsync(page);
await figma.loadFontAsync({ family: 'Caveat', style: 'Bold' });
await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
const V = async (id) => await figma.variables.getVariableByIdAsync(id);

// NodeFrame is the absolute-positioned canvas slot that places a node at {x,y}.
// Represent it statically as the frame slot holding a representative NodeShell
// card (the preview's "Reverb" / effect node). The frame itself is just a slot;
// the visible chrome belongs to the child card.

// --- The NodeFrame slot (transparent positioning wrapper) ---
const frame = figma.createComponent();
frame.name = 'NodeFrame';
frame.layoutMode = 'VERTICAL';
frame.primaryAxisSizingMode = 'AUTO';
frame.counterAxisSizingMode = 'AUTO';
frame.fills = [];

// --- NodeShell card (the node it positions) ---
const card = figma.createFrame();
card.name = 'NodeShell';
card.layoutMode = 'VERTICAL';
card.primaryAxisSizingMode = 'AUTO';
card.counterAxisSizingMode = 'FIXED';
card.itemSpacing = 0;
card.fills = [figma.variables.setBoundVariableForPaint({ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }, 'color', await V('VariableID:2:4'))];
card.strokes = [figma.variables.setBoundVariableForPaint({ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }, 'color', await V('VariableID:2:16'))];
card.setBoundVariable('strokeWeight', await V('VariableID:1:24'));
for (const k of ['topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius']) card.setBoundVariable(k, await V('VariableID:1:11'));
frame.appendChild(card);
card.resize(200, card.height);
card.layoutSizingHorizontal = 'FIXED';
card.layoutSizingVertical = 'HUG';

// --- Header strip (paper-panel: title + muted type, space-between) ---
const header = figma.createFrame();
header.name = 'header';
header.layoutMode = 'HORIZONTAL';
header.primaryAxisSizingMode = 'FIXED';
header.counterAxisSizingMode = 'AUTO';
header.primaryAxisAlignItems = 'SPACE_BETWEEN';
header.counterAxisAlignItems = 'CENTER';
header.setBoundVariable('paddingTop', await V('VariableID:1:5'));
header.setBoundVariable('paddingBottom', await V('VariableID:1:5'));
header.setBoundVariable('paddingLeft', await V('VariableID:1:6'));
header.setBoundVariable('paddingRight', await V('VariableID:1:6'));
header.setBoundVariable('itemSpacing', await V('VariableID:1:6'));
header.fills = [figma.variables.setBoundVariableForPaint({ type: 'SOLID', color: { r: .96, g: .96, b: .96 } }, 'color', await V('VariableID:2:8'))];
header.setBoundVariable('topLeftRadius', await V('VariableID:1:11'));
header.setBoundVariable('topRightRadius', await V('VariableID:1:11'));
card.appendChild(header);
header.layoutSizingHorizontal = 'FILL';
header.layoutSizingVertical = 'HUG';

const title = figma.createText();
title.fontName = { family: 'Caveat', style: 'Bold' };
title.characters = 'Reverb';
title.setBoundVariable('fontSize', await V('VariableID:1:17'));
title.fills = [figma.variables.setBoundVariableForPaint({ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }, 'color', await V('VariableID:2:9'))];
header.appendChild(title);
title.layoutSizingHorizontal = 'HUG';
title.layoutSizingVertical = 'HUG';

const ntype = figma.createText();
ntype.fontName = { family: 'Caveat', style: 'Bold' };
ntype.characters = 'effect';
ntype.setBoundVariable('fontSize', await V('VariableID:1:15'));
ntype.fills = [figma.variables.setBoundVariableForPaint({ type: 'SOLID', color: { r: .55, g: .55, b: .55 } }, 'color', await V('VariableID:2:11'))];
header.appendChild(ntype);
ntype.layoutSizingHorizontal = 'HUG';
ntype.layoutSizingVertical = 'HUG';

// 1px subtle border under the header (border-bottom: 1px solid border-subtle)
const divider = figma.createFrame();
divider.name = 'header-divider';
divider.layoutMode = 'HORIZONTAL';
divider.primaryAxisSizingMode = 'FIXED';
divider.counterAxisSizingMode = 'FIXED';
divider.fills = [figma.variables.setBoundVariableForPaint({ type: 'SOLID', color: { r: .85, g: .85, b: .85 } }, 'color', await V('VariableID:2:13'))];
card.appendChild(divider);
// FIX: resize() resets both axes to FIXED, so it must run BEFORE setting the
// horizontal FILL — otherwise the resize wipes out FILL and the divider stops
// stretching with the card. Set height via resize first, then FILL the width.
divider.resize(divider.width, 1);
divider.layoutSizingHorizontal = 'FILL';
divider.layoutSizingVertical = 'FIXED';

// --- Content area (padded body, Inter sans) ---
const content = figma.createFrame();
content.name = 'content';
content.layoutMode = 'VERTICAL';
content.primaryAxisSizingMode = 'AUTO';
content.counterAxisSizingMode = 'FIXED';
content.setBoundVariable('paddingTop', await V('VariableID:1:6'));
content.setBoundVariable('paddingBottom', await V('VariableID:1:6'));
content.setBoundVariable('paddingLeft', await V('VariableID:1:6'));
content.setBoundVariable('paddingRight', await V('VariableID:1:6'));
content.fills = [];
card.appendChild(content);
content.layoutSizingHorizontal = 'FILL';
content.layoutSizingVertical = 'HUG';

const body = figma.createText();
body.fontName = { family: 'Inter', style: 'Regular' };
body.characters = 'A node placed by NodeFrame.';
body.setBoundVariable('fontSize', await V('VariableID:1:15'));
body.fills = [figma.variables.setBoundVariableForPaint({ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }, 'color', await V('VariableID:2:9'))];
content.appendChild(body);
body.layoutSizingHorizontal = 'FILL';
body.layoutSizingVertical = 'HUG';

frame.x = 1160;
frame.y = 80;
return { ids: [frame.id] };