const page = await figma.getNodeByIdAsync('3:4'); await figma.setCurrentPageAsync(page);
const V = async (id) => await figma.variables.getVariableByIdAsync(id);

// IconWarning: warning-triangle glyph from Icons.tsx, rendered via the shared Icon wrapper.
// viewBox 0 0 24 24, fill none, stroke currentColor, strokeWidth 2, round caps/joins.
// currentColor follows the parent's text color -> bind strokes to color/text-primary.
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
const svgNode = figma.createNodeFromSvg(svg);

// Wrap in a component sized 24x24.
const c = figma.createComponent();
c.name = 'IconWarning';
c.layoutMode = 'NONE';
c.resize(24, 24);
c.fills = [];
c.clipsContent = false;
c.appendChild(svgNode);
svgNode.x = 0; svgNode.y = 0;

// Bind every vector stroke (currentColor) to color/text-primary; clear any fills.
const textPrimary = await V('VariableID:2:9');
const applyStroke = (node) => {
  if ('strokes' in node && node.strokes && node.strokes.length) {
    node.strokes = node.strokes.map((p) => p.type === 'SOLID' ? figma.variables.setBoundVariableForPaint(p, 'color', textPrimary) : p);
  }
  if ('fills' in node && Array.isArray(node.fills) && node.fills.length) {
    // Icon uses fill="none" on stroked glyph; keep fills empty.
    node.fills = [];
  }
  if ('children' in node) { for (const ch of node.children) applyStroke(ch); }
};
applyStroke(svgNode);

c.x = 80; c.y = 560;
return { ids: [c.id] };