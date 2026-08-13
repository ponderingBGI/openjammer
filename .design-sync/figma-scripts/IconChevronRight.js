const page = await figma.getNodeByIdAsync('3:4'); await figma.setCurrentPageAsync(page);
const V = async (id) => await figma.variables.getVariableByIdAsync(id);

// IconChevronRight: 24x24 viewBox, polyline "9 18 15 12 9 6", stroke=currentColor, strokeWidth 2, round cap/join.
// currentColor in the UI resolves to text-primary by default, so bind the stroke to color/text-primary.
const svg = figma.createNodeFromSvg('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>');

// Bind every vector stroke inside the imported svg to color/text-primary.
const textPrimary = await V('VariableID:2:9');
const bindStrokes = (node) => {
  if ('strokes' in node && node.strokes && node.strokes.length) {
    node.strokes = node.strokes.map((p) =>
      p.type === 'SOLID' ? figma.variables.setBoundVariableForPaint(p, 'color', textPrimary) : p
    );
  }
  if ('children' in node) for (const child of node.children) bindStrokes(child);
};
bindStrokes(svg);

// Wrap the icon in a 24x24 component with a centered auto-layout.
const c = figma.createComponent();
c.name = 'IconChevronRight';
c.layoutMode = 'HORIZONTAL';
c.primaryAxisSizingMode = 'FIXED';
c.counterAxisSizingMode = 'FIXED';
c.primaryAxisAlignItems = 'CENTER';
c.counterAxisAlignItems = 'CENTER';
c.itemSpacing = 0;
// No padding on a fixed 24x24 wrapper centering a fixed 24x24 glyph — padding plays no
// role here and hardcoding px literals would violate the "no hardcoded px" token rule.
// (If the design system requires a bound zero-spacing token, discover its VariableID via
//  getLocalVariableCollectionsAsync first, then setBoundVariable('paddingTop'/.../'paddingRight', v).)
c.fills = [];
c.resize(24, 24);

c.appendChild(svg);
svg.layoutSizingHorizontal = 'FIXED';
svg.layoutSizingVertical = 'FIXED';
svg.resize(24, 24);
svg.constrainProportions = true;

c.x = 1520; c.y = 80;
return { ids: [c.id] };