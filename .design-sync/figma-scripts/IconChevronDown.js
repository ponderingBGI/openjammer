const page = await figma.getNodeByIdAsync('3:4'); await figma.setCurrentPageAsync(page);
const V = async (id) => await figma.variables.getVariableByIdAsync(id);

// IconChevronDown: a 24x24 stroked polyline glyph, currentColor stroke (theme text),
// no fill, strokeWidth 2, round caps/joins. Mirrors Icons.tsx <Icon> wrapper.
const svg = figma.createNodeFromSvg('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>');
svg.name = 'glyph';

// Bind every stroke in the imported SVG to color/text-primary (currentColor in source).
const textPrimary = await V('VariableID:2:9');
if (!textPrimary) throw new Error('color/text-primary (VariableID:2:9) not found');
const bindStrokes = (node) => {
  if ('strokes' in node && Array.isArray(node.strokes) && node.strokes.length) {
    node.strokes = node.strokes.map((p) =>
      p.type === 'SOLID' ? figma.variables.setBoundVariableForPaint(p, 'color', textPrimary) : p
    );
  }
  if ('children' in node) for (const ch of node.children) bindStrokes(ch);
};
bindStrokes(svg);

// Component wrapper sized to the icon glyph (24x24 = the "24" UI size from the preview).
const c = figma.createComponent();
c.name = 'IconChevronDown';
c.layoutMode = 'HORIZONTAL';
c.primaryAxisSizingMode = 'FIXED';
c.counterAxisSizingMode = 'FIXED';
c.primaryAxisAlignItems = 'CENTER';
c.counterAxisAlignItems = 'CENTER';
c.fills = [];
c.clipsContent = false;
c.resize(24, 24);
c.appendChild(svg);
// resize BEFORE setting sizing modes — resize() resets sizing modes to FIXED,
// so set FIXED afterward to lock the intended end state (canonical order).
svg.resize(24, 24);
svg.layoutSizingHorizontal = 'FIXED';
svg.layoutSizingVertical = 'FIXED';

c.x = 1160; c.y = 80;
return { ids: [c.id] };