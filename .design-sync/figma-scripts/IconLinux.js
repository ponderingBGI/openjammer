const page = await figma.getNodeByIdAsync('3:4'); await figma.setCurrentPageAsync(page);
const V = async (id) => await figma.variables.getVariableByIdAsync(id);

// IconLinux is a single-path glyph (Tux silhouette) in a 24x24 viewBox.
// Source: fill="currentColor", stroke="none". currentColor follows the theme
// text color, so we bind the vector fill to color/text-primary.
const svg = figma.createNodeFromSvg('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="#000000"><path d="M12 2c-1.93 0-3 1.66-3 3.6 0 .9.1 1.7.32 2.4-.7.9-1.86 2.4-2.66 4-.7 1.4-1.16 2.7-1.45 3.7-.2.7-.3 1.3-.06 1.8.2.4.6.6 1 .6.2.4.5.8 1 1.05.7.36 1.66.55 2.8.55h.1c1.14 0 2.1-.19 2.8-.55.5-.25.8-.65 1-1.05.4 0 .8-.2 1-.6.24-.5.14-1.1-.06-1.8-.29-1-.75-2.3-1.45-3.7-.8-1.6-1.96-3.1-2.66-4 .22-.7.32-1.5.32-2.4C15 3.66 13.93 2 12 2Z"/></svg>');

// Bind every vector child's fill to color/text-primary (the currentColor source).
const textPrimary = await V('VariableID:2:9');
const bindFills = (node) => {
  if ('fills' in node && Array.isArray(node.fills) && node.fills.length) {
    node.fills = node.fills.map((p) =>
      p.type === 'SOLID' ? figma.variables.setBoundVariableForPaint(p, 'color', textPrimary) : p
    );
  }
  if ('children' in node) for (const ch of node.children) bindFills(ch);
};
bindFills(svg);

// Wrap the glyph in a square 24x24 component that hugs the vector.
const c = figma.createComponent();
c.name = 'IconLinux';
c.layoutMode = 'HORIZONTAL';
c.primaryAxisSizingMode = 'FIXED';
c.counterAxisSizingMode = 'FIXED';
c.primaryAxisAlignItems = 'CENTER';
c.counterAxisAlignItems = 'CENTER';
c.clipsContent = false;
c.fills = [];
c.appendChild(svg);
c.resize(24, 24);
svg.layoutSizingHorizontal = 'FIXED';
svg.layoutSizingVertical = 'FIXED';
svg.resize(24, 24);

c.x = 800; c.y = 320;
return { ids: [c.id] };