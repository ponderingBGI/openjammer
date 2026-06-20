const page = await figma.getNodeByIdAsync('3:4'); await figma.setCurrentPageAsync(page);
const V = async (id) => await figma.variables.getVariableByIdAsync(id);
const textPrimary = await V('VariableID:2:9');

// IconApple: 24x24 viewBox, fill=currentColor, stroke=none, two paths (Icons.tsx:148)
const svg = figma.createNodeFromSvg('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="#000000" stroke="none"><path d="M16.36 12.78c-.02-2.05 1.67-3.03 1.74-3.08-.95-1.39-2.43-1.58-2.96-1.6-1.26-.13-2.46.74-3.1.74-.64 0-1.62-.72-2.67-.7-1.37.02-2.64.8-3.35 2.03-1.43 2.48-.37 6.15 1.03 8.16.68.98 1.49 2.08 2.55 2.04 1.02-.04 1.41-.66 2.65-.66 1.23 0 1.58.66 2.66.64 1.1-.02 1.8-1 2.47-1.99.78-1.14 1.1-2.24 1.12-2.3-.02-.01-2.15-.83-2.18-3.26Z"/><path d="M14.4 6.42c.56-.68.94-1.62.84-2.56-.81.03-1.79.54-2.37 1.22-.52.6-.98 1.56-.86 2.48.9.07 1.83-.46 2.39-1.14Z"/></svg>');

// Bind every vector fill to color/text-primary (the icon inherits currentColor = active text color)
const bindFills = (node) => {
  if ('fills' in node && Array.isArray(node.fills) && node.fills.length) {
    node.fills = node.fills.map((p) => p.type === 'SOLID' ? figma.variables.setBoundVariableForPaint(p, 'color', textPrimary) : p);
  }
  if ('children' in node) for (const ch of node.children) bindFills(ch);
};
bindFills(svg);

// Build the component as a 24x24 square (the canonical UI size) holding the glyph
const c = figma.createComponent();
c.name = 'IconApple';
c.layoutMode = 'NONE';
c.resize(24, 24);
c.fills = [];
c.clipsContent = false;
c.appendChild(svg);
svg.x = 0; svg.y = 0;
svg.resize(24, 24);

c.x = 80; c.y = 80;
return { ids: [c.id] };