const page = await figma.getNodeByIdAsync('3:3');
await figma.setCurrentPageAsync(page);
await figma.loadFontAsync({ family: 'Caveat', style: 'Regular' });
await figma.loadFontAsync({ family: 'JetBrains Mono', style: 'Regular' });
const V = async (id) => await figma.variables.getVariableByIdAsync(id);

// Build one ValueScrubber instance with a given visual State.
// state: 'editable' (default rest) | 'hover' | 'readonly' | 'disabled'
const build = async (state) => {
  const c = figma.createComponent();
  c.name = 'State=' + state;
  c.layoutMode = 'HORIZONTAL';
  c.primaryAxisSizingMode = 'AUTO';
  c.counterAxisSizingMode = 'AUTO';
  // CSS: align-items: baseline; closest auto-layout option is BASELINE
  c.counterAxisAlignItems = 'BASELINE';
  c.itemSpacing = 0;
  c.setBoundVariable('itemSpacing', await V('VariableID:1:4')); // gap: space-xs
  c.fills = [];

  // Label — Caveat (font/sketch), text-secondary, text-sm
  const label = figma.createText();
  label.fontName = { family: 'Caveat', style: 'Regular' };
  label.characters = 'Gain';
  label.setBoundVariable('fontSize', await V('VariableID:1:15')); // text-sm
  label.fills = [figma.variables.setBoundVariableForPaint({ type: 'SOLID', color: { r: 0.4, g: 0.4, b: 0.4 } }, 'color', await V('VariableID:2:10'))]; // text-secondary
  c.appendChild(label);
  label.layoutSizingHorizontal = 'HUG';
  label.layoutSizingVertical = 'HUG';

  // Value chip — padding space-xs/space-sm, border border-sketch-width, radius-sm, bg, mono text-sm
  const chip = figma.createFrame();
  chip.name = 'value';
  chip.layoutMode = 'HORIZONTAL';
  chip.primaryAxisSizingMode = 'AUTO';
  chip.counterAxisSizingMode = 'AUTO';
  chip.counterAxisAlignItems = 'CENTER';
  chip.itemSpacing = 0;
  chip.setBoundVariable('paddingTop', await V('VariableID:1:4'));    // space-xs
  chip.setBoundVariable('paddingBottom', await V('VariableID:1:4')); // space-xs
  chip.setBoundVariable('paddingLeft', await V('VariableID:1:5'));   // space-sm
  chip.setBoundVariable('paddingRight', await V('VariableID:1:5'));  // space-sm
  for (const k of ['topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius']) {
    chip.setBoundVariable(k, await V('VariableID:1:9')); // radius-sm
  }
  chip.setBoundVariable('strokeWeight', await V('VariableID:1:24')); // border-sketch-width
  chip.strokeAlign = 'INSIDE';

  // Rest/readonly: bg-canvas + transparent border. Hover: bg-tertiary + border-subtle.
  if (state === 'hover') {
    chip.fills = [figma.variables.setBoundVariableForPaint({ type: 'SOLID', color: { r: 0.9, g: 0.9, b: 0.9 } }, 'color', await V('VariableID:2:5'))]; // bg-tertiary
    chip.strokes = [figma.variables.setBoundVariableForPaint({ type: 'SOLID', color: { r: 0.8, g: 0.8, b: 0.8 } }, 'color', await V('VariableID:2:13'))]; // border-subtle
  } else {
    chip.fills = [figma.variables.setBoundVariableForPaint({ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }, 'color', await V('VariableID:2:6'))]; // bg-canvas
    // transparent border to hold layout (CSS: border ... solid transparent)
    chip.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 0 }];
  }

  const val = figma.createText();
  val.fontName = { family: 'JetBrains Mono', style: 'Regular' };
  val.characters = '0.75 dB';
  val.setBoundVariable('fontSize', await V('VariableID:1:15')); // text-sm
  val.lineHeight = { value: 140, unit: 'PERCENT' };
  val.fills = [figma.variables.setBoundVariableForPaint({ type: 'SOLID', color: { r: 0.1, g: 0.1, b: 0.1 } }, 'color', await V('VariableID:2:9'))]; // text-primary
  chip.appendChild(val);
  val.layoutSizingHorizontal = 'HUG';
  val.layoutSizingVertical = 'HUG';

  c.appendChild(chip);
  chip.layoutSizingHorizontal = 'HUG';
  chip.layoutSizingVertical = 'HUG';

  // Disabled: opacity 0.5 on the whole component (CSS .is-disabled { opacity: .5 })
  if (state === 'disabled') c.opacity = 0.5;

  return c;
};

const comps = [];
comps.push(await build('editable'));
comps.push(await build('hover'));
comps.push(await build('readonly'));
comps.push(await build('disabled'));

const set = figma.combineAsVariants(comps, page);
set.name = 'ValueScrubber';
set.layoutMode = 'VERTICAL';
set.primaryAxisSizingMode = 'AUTO';
set.counterAxisSizingMode = 'AUTO';
set.itemSpacing = 16;
set.paddingTop = 16; set.paddingBottom = 16; set.paddingLeft = 16; set.paddingRight = 16;
set.x = 1520;
set.y = 560;

return { ids: [set.id] };