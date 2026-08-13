const page = await figma.getNodeByIdAsync('3:3'); await figma.setCurrentPageAsync(page);
await figma.loadFontAsync({ family:'Caveat', style:'Bold' });
await figma.loadFontAsync({ family:'Inter', style:'Regular' });
await figma.loadFontAsync({ family:'JetBrains Mono', style:'Regular' });
const V = async (id) => await figma.variables.getVariableByIdAsync(id);
const setRadius = async (n, id) => { for (const k of ['topLeftRadius','topRightRadius','bottomLeftRadius','bottomRightRadius']) n.setBoundVariable(k, await V(id)); };
const boundFill = async (id) => [figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:0,g:0,b:0}},'color', await V(id))];

// ── Root component: column, hairline bottom border ────────────────────────────
const c = figma.createComponent(); c.name='PanelHeader';
c.layoutMode='VERTICAL'; c.primaryAxisSizingMode='AUTO'; c.counterAxisSizingMode='FIXED';
c.counterAxisAlignItems='MIN';
c.setBoundVariable('itemSpacing', await V('VariableID:1:5')); // space/sm
c.setBoundVariable('paddingTop', await V('VariableID:1:5'));
c.setBoundVariable('paddingBottom', await V('VariableID:1:5'));
c.setBoundVariable('paddingLeft', await V('VariableID:1:6')); // space/md
c.setBoundVariable('paddingRight', await V('VariableID:1:6'));
c.fills = await boundFill('VariableID:2:4'); // bg-node
// bottom hairline: individual border + strokeBottomWeight
c.strokes = await boundFill('VariableID:2:13'); // border-subtle
c.strokeAlign = 'INSIDE';
c.strokeTopWeight = 0; c.strokeLeftWeight = 0; c.strokeRightWeight = 0;
c.strokeBottomWeight = 1;

// ── Title row: space-between (left cluster | right cluster) ────────────────────
const row = figma.createFrame(); row.name='row';
row.layoutMode='HORIZONTAL'; row.primaryAxisSizingMode='FIXED'; row.counterAxisSizingMode='AUTO';
row.primaryAxisAlignItems='SPACE_BETWEEN'; row.counterAxisAlignItems='CENTER';
row.setBoundVariable('itemSpacing', await V('VariableID:1:6')); // space/md
row.fills = [];
c.appendChild(row); row.layoutSizingHorizontal='FILL'; row.layoutSizingVertical='HUG';

// ── Left cluster: back button + heading ───────────────────────────────────────
const left = figma.createFrame(); left.name='left';
left.layoutMode='HORIZONTAL'; left.primaryAxisSizingMode='AUTO'; left.counterAxisSizingMode='AUTO';
left.counterAxisAlignItems='CENTER';
left.setBoundVariable('itemSpacing', await V('VariableID:1:5')); // space/sm
left.fills = [];
row.appendChild(left); left.layoutSizingHorizontal='HUG'; left.layoutSizingVertical='HUG';

// Back button — ghost Button: chevron(left) + label, transparent
const back = figma.createFrame(); back.name='back';
back.layoutMode='HORIZONTAL'; back.primaryAxisSizingMode='AUTO'; back.counterAxisSizingMode='AUTO';
back.counterAxisAlignItems='CENTER';
back.setBoundVariable('itemSpacing', await V('VariableID:1:4')); // space/xs
back.setBoundVariable('paddingTop', await V('VariableID:1:4'));
back.setBoundVariable('paddingBottom', await V('VariableID:1:4'));
back.setBoundVariable('paddingLeft', await V('VariableID:1:5'));
back.setBoundVariable('paddingRight', await V('VariableID:1:5'));
await setRadius(back, 'VariableID:1:10'); // radius/md
back.fills = []; // ghost = transparent
left.appendChild(back); back.layoutSizingHorizontal='HUG'; back.layoutSizingVertical='HUG';

// chevron-left icon — import a LEFT-pointing SVG directly (do NOT rotate; rotation pivots
// around the top-left origin and breaks placement inside auto-layout)
const chev = figma.createNodeFromSvg('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>');
chev.name='back-chevron'; chev.resize(16,16);
back.appendChild(chev); chev.layoutSizingHorizontal='FIXED'; chev.layoutSizingVertical='FIXED';
// bind stroke of vector children to text-primary
for (const v of chev.findAllWithCriteria({types:['VECTOR']})) { v.strokes = await boundFill('VariableID:2:9'); }

const backT = figma.createText(); backT.fontName={family:'Caveat',style:'Bold'}; backT.characters='Back';
backT.setBoundVariable('fontSize', await V('VariableID:1:15')); // text/sm
backT.fills = await boundFill('VariableID:2:9'); // text-primary
back.appendChild(backT); backT.layoutSizingHorizontal='HUG'; backT.layoutSizingVertical='HUG';

// Heading: title-row (title + badge) over subtitle
const heading = figma.createFrame(); heading.name='heading';
heading.layoutMode='VERTICAL'; heading.primaryAxisSizingMode='AUTO'; heading.counterAxisSizingMode='AUTO';
heading.counterAxisAlignItems='MIN';
heading.setBoundVariable('itemSpacing', await V('VariableID:1:4')); // space/xs
heading.fills = [];
left.appendChild(heading); heading.layoutSizingHorizontal='HUG'; heading.layoutSizingVertical='HUG';

// title-row
const titleRow = figma.createFrame(); titleRow.name='title-row';
titleRow.layoutMode='HORIZONTAL'; titleRow.primaryAxisSizingMode='AUTO'; titleRow.counterAxisSizingMode='AUTO';
titleRow.counterAxisAlignItems='CENTER';
titleRow.setBoundVariable('itemSpacing', await V('VariableID:1:5')); // space/sm
titleRow.fills = [];
heading.appendChild(titleRow); titleRow.layoutSizingHorizontal='HUG'; titleRow.layoutSizingVertical='HUG';

const title = figma.createText(); title.fontName={family:'Caveat',style:'Bold'}; title.characters='Browse Nodes';
title.setBoundVariable('fontSize', await V('VariableID:1:17')); // text/lg
title.fills = await boundFill('VariableID:2:9'); // text-primary
titleRow.appendChild(title); title.layoutSizingHorizontal='HUG'; title.layoutSizingVertical='HUG';

// badge — a Chip with a count (neutral tone): label + mono count, pill
const badge = figma.createFrame(); badge.name='badge';
badge.layoutMode='HORIZONTAL'; badge.primaryAxisSizingMode='AUTO'; badge.counterAxisSizingMode='AUTO';
badge.counterAxisAlignItems='CENTER';
badge.setBoundVariable('itemSpacing', await V('VariableID:1:4')); // space/xs
badge.setBoundVariable('paddingTop', await V('VariableID:1:4'));
badge.setBoundVariable('paddingBottom', await V('VariableID:1:4'));
badge.setBoundVariable('paddingLeft', await V('VariableID:1:5'));
badge.setBoundVariable('paddingRight', await V('VariableID:1:5'));
await setRadius(badge, 'VariableID:1:13'); // radius/pill
badge.fills = await boundFill('VariableID:2:5'); // bg-tertiary
badge.strokes = await boundFill('VariableID:2:13'); // border-subtle
badge.setBoundVariable('strokeWeight', await V('VariableID:1:24')); // border/sketch-width
titleRow.appendChild(badge); badge.layoutSizingHorizontal='HUG'; badge.layoutSizingVertical='HUG';

const badgeLbl = figma.createText(); badgeLbl.fontName={family:'Caveat',style:'Bold'}; badgeLbl.characters='tags';
badgeLbl.setBoundVariable('fontSize', await V('VariableID:1:15')); // text/sm
badgeLbl.fills = await boundFill('VariableID:2:10'); // text-secondary
badge.appendChild(badgeLbl); badgeLbl.layoutSizingHorizontal='HUG'; badgeLbl.layoutSizingVertical='HUG';

const badgeCount = figma.createText(); badgeCount.fontName={family:'JetBrains Mono',style:'Regular'}; badgeCount.characters='42';
badgeCount.setBoundVariable('fontSize', await V('VariableID:1:14')); // text/xs
badgeCount.fills = await boundFill('VariableID:2:11'); // text-muted
badge.appendChild(badgeCount); badgeCount.layoutSizingHorizontal='HUG'; badgeCount.layoutSizingVertical='HUG';

// subtitle — Inter, text-sm, secondary
const subtitle = figma.createText(); subtitle.fontName={family:'Inter',style:'Regular'}; subtitle.characters='Tap a node to drop it on the canvas';
subtitle.setBoundVariable('fontSize', await V('VariableID:1:15')); // text/sm
subtitle.fills = await boundFill('VariableID:2:10'); // text-secondary
heading.appendChild(subtitle); subtitle.layoutSizingHorizontal='HUG'; subtitle.layoutSizingVertical='HUG';

// ── Right cluster: actions slot + close button ────────────────────────────────
const right = figma.createFrame(); right.name='right';
right.layoutMode='HORIZONTAL'; right.primaryAxisSizingMode='AUTO'; right.counterAxisSizingMode='AUTO';
right.counterAxisAlignItems='CENTER';
right.setBoundVariable('itemSpacing', await V('VariableID:1:5')); // space/sm
right.fills = [];
row.appendChild(right); right.layoutSizingHorizontal='HUG'; right.layoutSizingVertical='HUG';

// actions: one ghost Button "Filter"
const actions = figma.createFrame(); actions.name='actions';
actions.layoutMode='HORIZONTAL'; actions.primaryAxisSizingMode='AUTO'; actions.counterAxisSizingMode='AUTO';
actions.counterAxisAlignItems='CENTER';
actions.setBoundVariable('itemSpacing', await V('VariableID:1:4')); // space/xs
actions.fills = [];
right.appendChild(actions); actions.layoutSizingHorizontal='HUG'; actions.layoutSizingVertical='HUG';

const filterBtn = figma.createFrame(); filterBtn.name='action-filter';
filterBtn.layoutMode='HORIZONTAL'; filterBtn.primaryAxisSizingMode='AUTO'; filterBtn.counterAxisSizingMode='AUTO';
filterBtn.primaryAxisAlignItems='CENTER'; filterBtn.counterAxisAlignItems='CENTER';
filterBtn.setBoundVariable('paddingTop', await V('VariableID:1:4'));
filterBtn.setBoundVariable('paddingBottom', await V('VariableID:1:4'));
filterBtn.setBoundVariable('paddingLeft', await V('VariableID:1:5'));
filterBtn.setBoundVariable('paddingRight', await V('VariableID:1:5'));
await setRadius(filterBtn, 'VariableID:1:10'); // radius/md
filterBtn.fills = []; // ghost
actions.appendChild(filterBtn); filterBtn.layoutSizingHorizontal='HUG'; filterBtn.layoutSizingVertical='HUG';

const filterT = figma.createText(); filterT.fontName={family:'Caveat',style:'Bold'}; filterT.characters='Filter';
filterT.setBoundVariable('fontSize', await V('VariableID:1:15')); // text/sm
filterT.fills = await boundFill('VariableID:2:9'); // text-primary
filterBtn.appendChild(filterT); filterT.layoutSizingHorizontal='HUG'; filterT.layoutSizingVertical='HUG';

// close — IconButton (icon-only, ghost-ish box with the close cross)
const close = figma.createFrame(); close.name='close';
close.layoutMode='HORIZONTAL'; close.primaryAxisSizingMode='AUTO'; close.counterAxisSizingMode='AUTO';
close.primaryAxisAlignItems='CENTER'; close.counterAxisAlignItems='CENTER';
close.setBoundVariable('paddingTop', await V('VariableID:1:4'));
close.setBoundVariable('paddingBottom', await V('VariableID:1:4'));
close.setBoundVariable('paddingLeft', await V('VariableID:1:4'));
close.setBoundVariable('paddingRight', await V('VariableID:1:4'));
await setRadius(close, 'VariableID:1:10'); // radius/md
close.fills = []; // ghost icon button
right.appendChild(close); close.layoutSizingHorizontal='HUG'; close.layoutSizingVertical='HUG';

const x = figma.createNodeFromSvg('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>');
x.name='close-icon'; x.resize(16,16);
close.appendChild(x); x.layoutSizingHorizontal='FIXED'; x.layoutSizingVertical='FIXED';
for (const v of x.findAllWithCriteria({types:['VECTOR']})) { v.strokes = await boundFill('VariableID:2:9'); }

c.resize(420, c.height);
c.x = 80; c.y = 560;
return { ids: [c.id] };