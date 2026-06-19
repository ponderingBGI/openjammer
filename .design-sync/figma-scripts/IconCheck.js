const page = await figma.getNodeByIdAsync('3:4'); await figma.setCurrentPageAsync(page);
const V = async (id) => await figma.variables.getVariableByIdAsync(id);

// IconCheck: a 24x24 stroke glyph — single polyline "20 6 9 17 4 12", strokeWidth 2,
// round caps/joins, fill none, stroke currentColor → bound to color/text-primary.
const svg = figma.createNodeFromSvg('<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>');

// The imported svg is a FRAME containing a vector. Bind the stroke to text-primary.
const textPrimary = await V('VariableID:2:9');
const bindStrokes = (node) => {
  if ('strokes' in node && Array.isArray(node.strokes) && node.strokes.length) {
    node.strokes = node.strokes.map((p) => p.type === 'SOLID' ? figma.variables.setBoundVariableForPaint(p, 'color', textPrimary) : p);
  }
  if ('children' in node) { for (const ch of node.children) bindStrokes(ch); }
};
bindStrokes(svg);

// Wrap into a COMPONENT sized exactly to the glyph (24x24), no padding, transparent fill.
const c = figma.createComponent();
c.name = 'IconCheck';
c.layoutMode = 'HORIZONTAL';
c.primaryAxisSizingMode = 'FIXED';
c.counterAxisSizingMode = 'FIXED';
c.primaryAxisAlignItems = 'CENTER';
c.counterAxisAlignItems = 'CENTER';
c.fills = [];
c.clipsContent = false;
c.appendChild(svg);
c.resize(24, 24);
svg.x = 0; svg.y = 0;

c.x = 800; c.y = 80;
return { ids: [c.id] };