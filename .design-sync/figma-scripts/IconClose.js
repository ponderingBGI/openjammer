const page = await figma.getNodeByIdAsync('3:4');
await figma.setCurrentPageAsync(page);
const V = async (id) => await figma.variables.getVariableByIdAsync(id);

const c = figma.createComponent();
c.name = 'IconClose';
c.layoutMode = 'NONE';
c.clipsContent = false;
c.fills = [];
c.resize(24, 24);

// IconClose is a 2px round-cap cross drawn on a 24x24 viewBox.
// Two lines: (18,6)->(6,18) and (6,6)->(18,18). stroke=currentColor (text-primary).
const svg = figma.createNodeFromSvg('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>');
svg.name = 'glyph';

// Recolor + bind every vector stroke to color/text-primary (the currentColor source),
// and bind the stroke weight to border/sketch-width.
const textPrimary = await V('VariableID:2:9');
const sketchWidth = await V('VariableID:1:24');
const recolor = (node) => {
  if ('strokes' in node && node.strokes && node.strokes.length) {
    node.strokes = [figma.variables.setBoundVariableForPaint({ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }, 'color', textPrimary)];
  }
  if ('setBoundVariable' in node) {
    try { node.setBoundVariable('strokeWeight', sketchWidth); } catch (e) {}
  }
  if ('children' in node && node.children) node.children.forEach(recolor);
};
recolor(svg);

c.appendChild(svg);
svg.x = 0;
svg.y = 0;

c.x = 80;
c.y = 320;
return { ids: [c.id] };