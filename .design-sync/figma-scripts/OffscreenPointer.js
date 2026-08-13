const page = await figma.getNodeByIdAsync('3:2'); await figma.setCurrentPageAsync(page);
await figma.loadFontAsync({ family: 'Caveat', style: 'Bold' });
await figma.loadFontAsync({ family: 'Caveat', style: 'Regular' });
const V = async (id) => await figma.variables.getVariableByIdAsync(id);

const c = figma.createComponent();
c.name = 'OffscreenPointer';
c.layoutMode = 'VERTICAL';
c.primaryAxisSizingMode = 'AUTO';
c.counterAxisSizingMode = 'AUTO';
c.counterAxisAlignItems = 'CENTER';
c.primaryAxisAlignItems = 'CENTER';

// padding: var(--space-lg) all sides; gap: var(--space-sm)
c.setBoundVariable('paddingTop', await V('VariableID:1:7'));
c.setBoundVariable('paddingBottom', await V('VariableID:1:7'));
c.setBoundVariable('paddingLeft', await V('VariableID:1:7'));
c.setBoundVariable('paddingRight', await V('VariableID:1:7'));
c.setBoundVariable('itemSpacing', await V('VariableID:1:5'));

// border-radius: var(--radius-lg)
for (const k of ['topLeftRadius','topRightRadius','bottomLeftRadius','bottomRightRadius']) c.setBoundVariable(k, await V('VariableID:1:11'));

// background: var(--bg-node)
c.fills = [figma.variables.setBoundVariableForPaint({ type: 'SOLID', color: { r: .5, g: .5, b: .5 } }, 'color', await V('VariableID:2:4'))];

// border: var(--border-sketch-width) solid var(--sketch-black)
c.strokes = [figma.variables.setBoundVariableForPaint({ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }, 'color', await V('VariableID:2:16'))];
c.setBoundVariable('strokeWeight', await V('VariableID:1:24'));

// box-shadow: var(--shadow-menu) => 3px 4px 0 rgba(0,0,0,0.15), hard offset, no blur
c.effects = [{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.15 }, offset: { x: 3, y: 4 }, radius: 0, spread: 0, visible: true, blendMode: 'NORMAL' }];

// arrow glyph "→" — Caveat, text-2xl, text-primary
const arrow = figma.createText();
arrow.fontName = { family: 'Caveat', style: 'Bold' };
arrow.characters = '→';
arrow.setBoundVariable('fontSize', await V('VariableID:1:19'));
arrow.fills = [figma.variables.setBoundVariableForPaint({ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }, 'color', await V('VariableID:2:9'))];
c.appendChild(arrow);
arrow.layoutSizingHorizontal = 'HUG';
arrow.layoutSizingVertical = 'HUG';

// label — Caveat, text-md, text-secondary
const label = figma.createText();
label.fontName = { family: 'Caveat', style: 'Regular' };
label.characters = 'Back to nodes';
label.setBoundVariable('fontSize', await V('VariableID:1:16'));
label.fills = [figma.variables.setBoundVariableForPaint({ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }, 'color', await V('VariableID:2:10'))];
c.appendChild(label);
label.layoutSizingHorizontal = 'HUG';
label.layoutSizingVertical = 'HUG';

c.x = 1520;
c.y = 760;
return { ids: [c.id] };