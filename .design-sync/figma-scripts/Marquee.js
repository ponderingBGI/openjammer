const page = await figma.getNodeByIdAsync('3:2');
await figma.setCurrentPageAsync(page);

const V = async (id) => await figma.variables.getVariableByIdAsync(id);

const c = figma.createComponent();
c.name = 'Marquee';
c.layoutMode = 'NONE';
c.resize(180, 120);

// Faint accent fill: color-mix(in srgb, accent-primary 10%, transparent)
// Bind the fill paint to color/accent-primary and lower its opacity to ~10%.
const fillPaint = figma.variables.setBoundVariableForPaint(
  { type: 'SOLID', color: { r: 0.5, g: 0.5, b: 0.5 }, opacity: 0.1 },
  'color',
  await V('VariableID:2:19')
);
c.fills = [fillPaint];

// 1px dashed accent border
const strokePaint = figma.variables.setBoundVariableForPaint(
  { type: 'SOLID', color: { r: 0.5, g: 0.5, b: 0.5 } },
  'color',
  await V('VariableID:2:19')
);
c.strokes = [strokePaint];
c.strokeWeight = 1;
c.strokeAlign = 'INSIDE';
c.dashPattern = [4, 4];

// No corner radius — the marquee is a plain rectangle.

c.x = 1160;
c.y = 760;

return { ids: [c.id] };