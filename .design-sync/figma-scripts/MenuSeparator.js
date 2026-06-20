const page = await figma.getNodeByIdAsync('3:3'); await figma.setCurrentPageAsync(page);
const V = async (id) => await figma.variables.getVariableByIdAsync(id);

// MenuSeparator = .oj-menu-separator: height 1px, margin var(--space-xs) 0, background var(--border-subtle).
// Modelled as a vertical auto-layout wrapper whose top/bottom padding IS the margin (space/xs),
// containing a 1px hairline filled with color/border-subtle that fills the menu width.
const c = figma.createComponent();
c.name = 'MenuSeparator';
c.layoutMode = 'VERTICAL';
c.primaryAxisSizingMode = 'FIXED';   // fixed width (representative menu width), hug height
c.counterAxisSizingMode = 'FIXED';
c.primaryAxisAlignItems = 'CENTER';
c.counterAxisAlignItems = 'CENTER';
// margin var(--space-xs) 0  -> vertical padding only, no horizontal padding
c.setBoundVariable('paddingTop', await V('VariableID:1:4'));     // space/xs
c.setBoundVariable('paddingBottom', await V('VariableID:1:4'));  // space/xs
c.paddingLeft = 0;
c.paddingRight = 0;
c.itemSpacing = 0;
c.fills = [];           // separator wrapper is transparent (the line carries the color)
c.strokes = [];
c.resize(220, 9);       // representative menu width (>= node/min-width 180); height = 1px line + 2*4px margin

// The hairline rule itself — height 1px, fill border-subtle, fills container width.
const line = figma.createRectangle();
line.name = 'rule';
line.fills = [figma.variables.setBoundVariableForPaint({ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }, 'color', await V('VariableID:2:13'))]; // color/border-subtle
line.resize(220, 1);
c.appendChild(line);
// Set sizing modes LAST. (FIX) The original trailing `line.resize(line.width, 1)`
// ran AFTER FILL was set and silently reset layoutSizingHorizontal back to FIXED,
// undoing the "fills the menu width" behaviour. Removed it; height is already 1px.
line.layoutSizingVertical = 'FIXED';
line.layoutSizingHorizontal = 'FILL';

c.x = 1160; c.y = 800;
return { ids: [c.id] };