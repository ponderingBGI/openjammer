const page = await figma.getNodeByIdAsync('3:2'); await figma.setCurrentPageAsync(page);
await figma.loadFontAsync({ family:'Caveat', style:'Regular' });
await figma.loadFontAsync({ family:'JetBrains Mono', style:'Regular' });
const V = async (id) => await figma.variables.getVariableByIdAsync(id);

// Build one Input control (mirrors Input.css) given placeholder text
const makeInput = async (text) => {
  const inp = figma.createFrame();
  inp.name = 'Input';
  inp.layoutMode = 'HORIZONTAL';
  inp.primaryAxisSizingMode = 'FIXED';
  inp.counterAxisSizingMode = 'AUTO';
  inp.counterAxisAlignItems = 'CENTER';
  inp.setBoundVariable('paddingTop', await V('VariableID:1:4'));      // space-xs
  inp.setBoundVariable('paddingBottom', await V('VariableID:1:4'));   // space-xs
  inp.setBoundVariable('paddingLeft', await V('VariableID:1:5'));     // space-sm
  inp.setBoundVariable('paddingRight', await V('VariableID:1:5'));    // space-sm
  for (const k of ['topLeftRadius','topRightRadius','bottomLeftRadius','bottomRightRadius']) inp.setBoundVariable(k, await V('VariableID:1:9')); // radius-sm
  inp.fills = [figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:1,g:1,b:1}}, 'color', await V('VariableID:2:6'))]; // bg-canvas
  inp.strokes = [figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:0,g:0,b:0}}, 'color', await V('VariableID:2:16'))]; // sketch-black
  inp.setBoundVariable('strokeWeight', await V('VariableID:1:24')); // border-sketch-width
  const it = figma.createText();
  it.fontName = { family:'JetBrains Mono', style:'Regular' };
  it.characters = text;
  it.setBoundVariable('fontSize', await V('VariableID:1:15')); // text-sm
  it.fills = [figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:0,g:0,b:0}}, 'color', await V('VariableID:2:9'))]; // text-primary
  inp.appendChild(it);
  it.layoutSizingHorizontal = 'HUG'; it.layoutSizingVertical = 'HUG';
  return inp;
};

// Build a Field variant: row=false (stacked) or row=true (inline)
const makeField = async (row, labelText, inputText, inputWidth) => {
  const c = figma.createComponent();
  c.name = row ? 'layout=row' : 'layout=stacked';
  c.layoutMode = row ? 'HORIZONTAL' : 'VERTICAL';
  c.primaryAxisSizingMode = 'AUTO';
  c.counterAxisSizingMode = 'AUTO';
  if (row) c.counterAxisAlignItems = 'CENTER';
  // gap: space-xs stacked, space-sm row
  c.setBoundVariable('itemSpacing', await V(row ? 'VariableID:1:5' : 'VariableID:1:4'));
  // margin-bottom: space-sm — represent as paddingBottom on the field group
  c.setBoundVariable('paddingBottom', await V('VariableID:1:5'));
  c.fills = [];

  // Label — Caveat voice, text-sm, text-muted
  const lbl = figma.createText();
  lbl.fontName = { family:'Caveat', style:'Regular' };
  lbl.characters = labelText;
  lbl.setBoundVariable('fontSize', await V('VariableID:1:15')); // text-sm
  lbl.fills = [figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:.5,g:.5,b:.5}}, 'color', await V('VariableID:2:11'))]; // text-muted
  c.appendChild(lbl);
  lbl.layoutSizingHorizontal = 'HUG'; lbl.layoutSizingVertical = 'HUG';

  // Control child (an Input)
  const inp = await makeInput(inputText);
  c.appendChild(inp);
  inp.resize(inputWidth, inp.height);
  inp.layoutSizingHorizontal = 'FIXED'; inp.layoutSizingVertical = 'HUG';

  return c;
};

const stacked = await makeField(false, 'Session name', 'Sunset session', 200);
const rowv = await makeField(true, 'Tempo (BPM)', '120', 90);

const set = figma.combineAsVariants([stacked, rowv], page);
set.name = 'Field';
set.layoutMode = 'VERTICAL';
set.primaryAxisSizingMode = 'AUTO';
set.counterAxisSizingMode = 'AUTO';
set.itemSpacing = 24;
set.paddingTop = 24; set.paddingBottom = 24; set.paddingLeft = 24; set.paddingRight = 24;
set.x = 1160; set.y = 520;

return { ids: [set.id] };