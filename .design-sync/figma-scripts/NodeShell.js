const page = await figma.getNodeByIdAsync('3:3'); await figma.setCurrentPageAsync(page);
await figma.loadFontAsync({ family:'Caveat', style:'Bold' });
await figma.loadFontAsync({ family:'Caveat', style:'Regular' });
const V = async (id) => await figma.variables.getVariableByIdAsync(id);
const bindPaint = (color, id) => figma.variables.setBoundVariableForPaint({ type:'SOLID', color }, 'color', id);

// ---- root node card (.oj-node) : white surface, 2px ink border, radius-lg, hard offset shadow
const c = figma.createComponent();
c.name = 'NodeShell';
c.layoutMode = 'VERTICAL';
c.primaryAxisSizingMode = 'AUTO';
c.counterAxisSizingMode = 'FIXED'; // min-width via fixed width below
c.itemSpacing = 0;
c.paddingTop = 0; c.paddingBottom = 0; c.paddingLeft = 0; c.paddingRight = 0;
for (const k of ['topLeftRadius','topRightRadius','bottomLeftRadius','bottomRightRadius']) c.setBoundVariable(k, await V('VariableID:1:11')); // radius/lg
c.fills = [ bindPaint({ r:1, g:1, b:1 }, await V('VariableID:2:4')) ]; // color/bg-node
c.strokes = [ bindPaint({ r:0, g:0, b:0 }, await V('VariableID:2:16')) ]; // color/sketch-black
c.setBoundVariable('strokeWeight', await V('VariableID:1:24')); // border/sketch-width
c.strokeAlign = 'INSIDE';
// hard offset shadow: var(--shadow-node) = 2px 3px 0 rgba(0,0,0,0.1)
c.effects = [{ type:'DROP_SHADOW', color:{ r:0, g:0, b:0, a:0.1 }, offset:{ x:2, y:3 }, radius:0, spread:0, visible:true, blendMode:'NORMAL' }];

// ---- header (.oj-node__header) : paper panel, title + muted type, space-sm/md padding, border-subtle bottom
const header = figma.createFrame();
header.name = 'header';
header.layoutMode = 'HORIZONTAL';
header.primaryAxisSizingMode = 'FIXED';
header.counterAxisSizingMode = 'AUTO';
header.primaryAxisAlignItems = 'SPACE_BETWEEN';
header.counterAxisAlignItems = 'CENTER';
header.setBoundVariable('paddingTop', await V('VariableID:1:5')); // space/sm
header.setBoundVariable('paddingBottom', await V('VariableID:1:5')); // space/sm
header.setBoundVariable('paddingLeft', await V('VariableID:1:6')); // space/md
header.setBoundVariable('paddingRight', await V('VariableID:1:6')); // space/md
header.fills = [ bindPaint({ r:.95, g:.95, b:.95 }, await V('VariableID:2:8')) ]; // color/bg-node-header
header.setBoundVariable('topLeftRadius', await V('VariableID:1:11')); // radius/lg
header.setBoundVariable('topRightRadius', await V('VariableID:1:11'));
// (removed: header.topLeftRadius = header.topLeftRadius — reading back a bound field
//  and reassigning the raw number CLEARS the variable binding just set above)
// bottom border (border-subtle) via stroke on bottom side only
header.strokes = [ bindPaint({ r:0, g:0, b:0 }, await V('VariableID:2:13')) ]; // color/border-subtle
header.strokeWeight = 1;
header.strokeAlign = 'INSIDE';
header.strokeTopWeight = 0; header.strokeLeftWeight = 0; header.strokeRightWeight = 0; header.strokeBottomWeight = 1;
c.appendChild(header);
header.layoutSizingHorizontal = 'FILL';

const title = figma.createText();
title.fontName = { family:'Caveat', style:'Bold' };
title.characters = 'Oscillator';
title.setBoundVariable('fontSize', await V('VariableID:1:17')); // text/lg
title.fills = [ bindPaint({ r:0, g:0, b:0 }, await V('VariableID:2:9')) ]; // color/text-primary
header.appendChild(title);
title.layoutSizingHorizontal = 'HUG'; title.layoutSizingVertical = 'HUG';

const ntype = figma.createText();
ntype.fontName = { family:'Caveat', style:'Regular' };
ntype.characters = 'instrument';
ntype.setBoundVariable('fontSize', await V('VariableID:1:15')); // text/sm
ntype.fills = [ bindPaint({ r:.5, g:.5, b:.5 }, await V('VariableID:2:11')) ]; // color/text-muted
header.appendChild(ntype);
ntype.layoutSizingHorizontal = 'HUG'; ntype.layoutSizingVertical = 'HUG';

// ---- port rails (.oj-node__ports) : full-bleed, left input / right output, space-sm vertical padding
const ports = figma.createFrame();
ports.name = 'ports';
ports.layoutMode = 'HORIZONTAL';
ports.primaryAxisSizingMode = 'FIXED';
ports.counterAxisSizingMode = 'AUTO';
ports.primaryAxisAlignItems = 'SPACE_BETWEEN';
ports.counterAxisAlignItems = 'CENTER';
ports.setBoundVariable('paddingTop', await V('VariableID:1:5')); // space/sm
ports.setBoundVariable('paddingBottom', await V('VariableID:1:5')); // space/sm
ports.paddingLeft = 0; ports.paddingRight = 0;
ports.fills = [];
c.appendChild(ports);
ports.layoutSizingHorizontal = 'FILL';

// left rail — control input port (grey), connected
const left = figma.createFrame();
left.name = 'ports-left';
left.layoutMode = 'VERTICAL';
left.primaryAxisSizingMode = 'AUTO'; left.counterAxisSizingMode = 'AUTO';
left.counterAxisAlignItems = 'MIN';
left.setBoundVariable('itemSpacing', await V('VariableID:1:5')); // space/sm
left.setBoundVariable('paddingLeft', await V('VariableID:1:5')); // space/sm
left.fills = [];
ports.appendChild(left);
left.layoutSizingHorizontal = 'HUG'; left.layoutSizingVertical = 'HUG';

const portIn = figma.createEllipse();
portIn.name = 'Port control input connected';
portIn.resize(16, 16); // port/size = 16px geometry
portIn.fills = [ bindPaint({ r:.5, g:.5, b:.5 }, await V('VariableID:2:31')) ]; // control-connected
portIn.strokes = [ bindPaint({ r:0, g:0, b:0 }, await V('VariableID:2:16')) ]; // sketch-black
portIn.setBoundVariable('strokeWeight', await V('VariableID:1:24')); // border/sketch-width
left.appendChild(portIn);
portIn.layoutSizingHorizontal = 'FIXED'; portIn.layoutSizingVertical = 'FIXED';

// right rail — audio output port (blue), connected
const right = figma.createFrame();
right.name = 'ports-right';
right.layoutMode = 'VERTICAL';
right.primaryAxisSizingMode = 'AUTO'; right.counterAxisSizingMode = 'AUTO';
right.counterAxisAlignItems = 'MAX';
right.setBoundVariable('itemSpacing', await V('VariableID:1:5')); // space/sm
right.setBoundVariable('paddingRight', await V('VariableID:1:5')); // space/sm
right.fills = [];
ports.appendChild(right);
right.layoutSizingHorizontal = 'HUG'; right.layoutSizingVertical = 'HUG';

const portOut = figma.createEllipse();
portOut.name = 'Port audio output connected';
portOut.resize(16, 16);
portOut.fills = [ bindPaint({ r:.3, g:.7, b:1 }, await V('VariableID:2:27')) ]; // audio-connected
portOut.strokes = [ bindPaint({ r:0, g:0, b:0 }, await V('VariableID:2:16')) ]; // sketch-black
portOut.setBoundVariable('strokeWeight', await V('VariableID:1:24')); // border/sketch-width
// connected ports gain the one allowed soft glow (box-shadow 0 0 8px audio-connected)
portOut.effects = [{ type:'DROP_SHADOW', color:{ r:.3, g:.7, b:1, a:.7 }, offset:{ x:0, y:0 }, radius:8, spread:0, visible:true, blendMode:'NORMAL' }];
right.appendChild(portOut);
portOut.layoutSizingHorizontal = 'FIXED'; portOut.layoutSizingVertical = 'FIXED';

// ---- content (.oj-node__content) : space-md padding, body line (Caveat)
const content = figma.createFrame();
content.name = 'content';
content.layoutMode = 'VERTICAL';
content.primaryAxisSizingMode = 'AUTO';
content.counterAxisSizingMode = 'FIXED';
content.setBoundVariable('paddingTop', await V('VariableID:1:6')); // space/md
content.setBoundVariable('paddingBottom', await V('VariableID:1:6'));
content.setBoundVariable('paddingLeft', await V('VariableID:1:6'));
content.setBoundVariable('paddingRight', await V('VariableID:1:6'));
content.fills = [];
c.appendChild(content);
content.layoutSizingHorizontal = 'FILL';

const body = figma.createText();
body.fontName = { family:'Caveat', style:'Regular' };
body.characters = 'waveform: sine · 440 Hz';
body.setBoundVariable('fontSize', await V('VariableID:1:16')); // text/md
body.fills = [ bindPaint({ r:0, g:0, b:0 }, await V('VariableID:2:9')) ]; // color/text-primary
content.appendChild(body);
body.layoutSizingHorizontal = 'HUG'; body.layoutSizingVertical = 'HUG';

// node min-width — bind the component's width to node/min-width
c.setBoundVariable('width', await V('VariableID:1:20')); // node/min-width

c.x = 800; c.y = 80;
return { ids: [c.id], createdNodeIds: [c.id, header.id, title.id, ntype.id, ports.id, left.id, portIn.id, right.id, portOut.id, content.id, body.id] };