const page = await figma.getNodeByIdAsync('3:2'); await figma.setCurrentPageAsync(page);
await figma.loadFontAsync({ family:'JetBrains Mono', style:'Regular' });
const V = async (id) => await figma.variables.getVariableByIdAsync(id);

const makeInput = async (stateName, text, isPlaceholder, isDisabled) => {
  const c = figma.createComponent();
  c.name = 'State=' + stateName;
  c.layoutMode = 'HORIZONTAL';
  c.primaryAxisSizingMode = 'FIXED';
  c.counterAxisSizingMode = 'AUTO';
  c.counterAxisAlignItems = 'CENTER';
  c.primaryAxisAlignItems = 'MIN';
  // padding: var(--space-xs) var(--space-sm)
  c.setBoundVariable('paddingTop', await V('VariableID:1:4'));
  c.setBoundVariable('paddingBottom', await V('VariableID:1:4'));
  c.setBoundVariable('paddingLeft', await V('VariableID:1:5'));
  c.setBoundVariable('paddingRight', await V('VariableID:1:5'));
  // radius: var(--radius-sm)
  for (const k of ['topLeftRadius','topRightRadius','bottomLeftRadius','bottomRightRadius']) c.setBoundVariable(k, await V('VariableID:1:9'));
  // fill: var(--bg-canvas)
  c.fills = [figma.variables.setBoundVariableForPaint({type:'SOLID', color:{r:1,g:1,b:1}}, 'color', await V('VariableID:2:6'))];
  // border: 2px ink (focus uses accent — represented by Focus variant if added; here static states use sketch-black)
  c.strokes = [figma.variables.setBoundVariableForPaint({type:'SOLID', color:{r:0,g:0,b:0}}, 'color', await V('VariableID:2:16'))];
  c.setBoundVariable('strokeWeight', await V('VariableID:1:24'));
  c.strokeAlign = 'INSIDE';

  const t = figma.createText();
  t.fontName = { family:'JetBrains Mono', style:'Regular' };
  t.characters = text;
  t.setBoundVariable('fontSize', await V('VariableID:1:15')); // text-sm
  // color: placeholder/disabled -> text-muted ; filled -> text-primary
  const colorId = (isPlaceholder || isDisabled) ? 'VariableID:2:11' : 'VariableID:2:9';
  t.fills = [figma.variables.setBoundVariableForPaint({type:'SOLID', color:{r:0,g:0,b:0}}, 'color', await V(colorId))];
  c.appendChild(t);
  t.layoutSizingHorizontal = 'HUG';
  t.layoutSizingVertical = 'HUG';

  c.resize(240, c.height);
  c.primaryAxisSizingMode = 'FIXED';
  if (isDisabled) c.opacity = 0.55;
  return c;
};

const c1 = await makeInput('Placeholder', 'Search nodes…', true, false);
const c2 = await makeInput('Filled', 'Sunset session', false, false);
const c3 = await makeInput('Numeric', '120', false, false);
const c4 = await makeInput('Disabled', 'Disabled', true, true);

const set = figma.combineAsVariants([c1, c2, c3, c4], page);
set.name = 'Input';
set.layoutMode = 'VERTICAL';
set.primaryAxisSizingMode = 'AUTO';
set.counterAxisSizingMode = 'AUTO';
set.itemSpacing = 16;
set.paddingTop = 16; set.paddingBottom = 16; set.paddingLeft = 16; set.paddingRight = 16;
set.x = 80; set.y = 520;

return { ids: [set.id] };