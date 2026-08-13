const page = await figma.getNodeByIdAsync('3:4'); await figma.setCurrentPageAsync(page);
const V = async (id) => await figma.variables.getVariableByIdAsync(id);
const strokeVar = await V('VariableID:2:9'); // color/text-primary (currentColor)

const svg = figma.createNodeFromSvg('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#1a1a1a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>');
svg.name = 'glyph';

// Bind every stroked path/vector to color/text-primary so the icon follows the theme (currentColor).
const bindStrokes = (node) => {
  if ('strokes' in node && node.strokes && node.strokes.length) {
    node.strokes = node.strokes.map((p) => p.type === 'SOLID' ? figma.variables.setBoundVariableForPaint(p, 'color', strokeVar) : p);
  }
  if ('children' in node) for (const ch of node.children) bindStrokes(ch);
};
bindStrokes(svg);

const c = figma.createComponent();
c.name = 'IconDownload';
c.layoutMode = 'HORIZONTAL';
c.primaryAxisSizingMode = 'FIXED';
c.counterAxisSizingMode = 'FIXED';
c.primaryAxisAlignItems = 'CENTER';
c.counterAxisAlignItems = 'CENTER';
c.fills = [];
c.appendChild(svg);
c.resize(24, 24);

c.x = 440; c.y = 320;
return { ids: [c.id] };