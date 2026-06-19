const page = await figma.getNodeByIdAsync('3:4'); await figma.setCurrentPageAsync(page);
const V = async (id) => await figma.variables.getVariableByIdAsync(id);

// IconBolt: a lightning-bolt glyph. Source <svg> is 24x24, fill="none",
// stroke="currentColor", strokeWidth=2, round caps/joins, one polygon.
// Color follows surrounding text (currentColor) -> bind stroke to color/text-primary.
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>';
const svgNode = figma.createNodeFromSvg(svg);
svgNode.name = 'bolt';

// Bind every vector stroke in the imported svg to the theme text color.
const textColor = await V('VariableID:2:9'); // color/text-primary
const applyStroke = (node) => {
  if ('strokes' in node && node.strokes && node.strokes.length) {
    node.strokes = node.strokes.map((p) =>
      p.type === 'SOLID' ? figma.variables.setBoundVariableForPaint(p, 'color', textColor) : p
    );
  }
  if ('fills' in node && Array.isArray(node.fills)) {
    node.fills = node.fills.map((p) =>
      p.type === 'SOLID' ? figma.variables.setBoundVariableForPaint(p, 'color', textColor) : p
    );
  }
  if ('children' in node) for (const ch of node.children) applyStroke(ch);
};
applyStroke(svgNode);

// Component wrapper: a 24x24 square that hugs the glyph (matches default UI size).
const c = figma.createComponent();
c.name = 'IconBolt';
c.layoutMode = 'HORIZONTAL';
c.primaryAxisSizingMode = 'FIXED';
c.counterAxisSizingMode = 'FIXED';
c.primaryAxisAlignItems = 'CENTER';
c.counterAxisAlignItems = 'CENTER';
c.fills = [];
c.clipsContent = false;
c.appendChild(svgNode);
c.resize(24, 24);
svgNode.constraints = { horizontal: 'CENTER', vertical: 'CENTER' };

c.x = 440; c.y = 80;
return { ids: [c.id] };