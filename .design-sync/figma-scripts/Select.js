const page = await figma.getNodeByIdAsync('3:2'); await figma.setCurrentPageAsync(page);
await figma.loadFontAsync({ family:'Caveat', style:'Regular' });
const V = async (id) => await figma.variables.getVariableByIdAsync(id);

const c = figma.createComponent();
c.name = 'Select';
c.layoutMode = 'HORIZONTAL';
c.primaryAxisSizingMode = 'FIXED';
c.counterAxisSizingMode = 'AUTO';
c.counterAxisAlignItems = 'CENTER';
c.primaryAxisAlignItems = 'SPACE_BETWEEN';

// padding: var(--space-xs) var(--space-sm)
c.setBoundVariable('paddingTop', await V('VariableID:1:4'));
c.setBoundVariable('paddingBottom', await V('VariableID:1:4'));
c.setBoundVariable('paddingLeft', await V('VariableID:1:5'));
c.setBoundVariable('paddingRight', await V('VariableID:1:5'));
c.setBoundVariable('itemSpacing', await V('VariableID:1:5'));

// border-radius: var(--radius-sm)
for (const k of ['topLeftRadius','topRightRadius','bottomLeftRadius','bottomRightRadius']) c.setBoundVariable(k, await V('VariableID:1:9'));

// background: var(--bg-canvas)
c.fills = [figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:1,g:1,b:1}}, 'color', await V('VariableID:2:6'))];

// border: var(--border-sketch-width) solid var(--sketch-black)
c.strokes = [figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:0,g:0,b:0}}, 'color', await V('VariableID:2:16'))];
c.setBoundVariable('strokeWeight', await V('VariableID:1:24'));

// selected value label — Caveat (font/sketch), text-sm, text-primary
const t = figma.createText();
t.fontName = { family:'Caveat', style:'Regular' };
t.characters = 'Reverb';
t.setBoundVariable('fontSize', await V('VariableID:1:15'));
t.fills = [figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:0,g:0,b:0}}, 'color', await V('VariableID:2:9'))];
c.appendChild(t);
t.layoutSizingHorizontal = 'HUG';
t.layoutSizingVertical = 'HUG';

// dropdown chevron (IconChevronDown) — inherits text-primary via currentColor
const svg = figma.createNodeFromSvg('<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>');
svg.name = 'chevron';
svg.resize(16, 16);
const chevColor = await V('VariableID:2:9');
const paintToken = (node) => {
  if (node.strokes && node.strokes.length) {
    node.strokes = node.strokes.map((p) => p.type === 'SOLID' ? figma.variables.setBoundVariableForPaint(p, 'color', chevColor) : p);
  }
  if (node.fills && node.fills.length && Array.isArray(node.fills)) {
    node.fills = node.fills.map((p) => p.type === 'SOLID' ? figma.variables.setBoundVariableForPaint(p, 'color', chevColor) : p);
  }
  if ('children' in node) for (const ch of node.children) paintToken(ch);
};
paintToken(svg);
c.appendChild(svg);
svg.layoutSizingHorizontal = 'FIXED';
svg.layoutSizingVertical = 'FIXED';

// minWidth: 200 (geometry-only, from the preview style)
c.resize(200, c.height);
c.layoutSizingVertical = 'HUG';

c.x = 800; c.y = 520;
return { ids: [c.id] };