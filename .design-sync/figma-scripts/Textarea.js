const page = await figma.getNodeByIdAsync('3:2'); await figma.setCurrentPageAsync(page);
await figma.loadFontAsync({ family:'Inter', style:'Regular' });
const V = async (id) => await figma.variables.getVariableByIdAsync(id);

const ids = {
  spaceXs:'VariableID:1:4', spaceSm:'VariableID:1:5',
  radiusSm:'VariableID:1:9', textSm:'VariableID:1:15',
  fontSans:'VariableID:1:32', borderW:'VariableID:1:24',
  bgCanvas:'VariableID:2:6', textPrimary:'VariableID:2:9', textMuted:'VariableID:2:11',
  sketchBlack:'VariableID:2:16', accentPrimary:'VariableID:2:19',
};

async function makeVariant(stateName, opts){
  const c = figma.createComponent();
  c.name = 'State=' + stateName;
  c.layoutMode = 'HORIZONTAL';
  c.primaryAxisSizingMode = 'FIXED';
  c.counterAxisSizingMode = 'FIXED';
  c.primaryAxisAlignItems = 'MIN';
  c.counterAxisAlignItems = 'MIN';
  // padding: xs vertical, sm horizontal (matches CSS: var(--space-xs) var(--space-sm))
  c.setBoundVariable('paddingTop', await V(ids.spaceXs));
  c.setBoundVariable('paddingBottom', await V(ids.spaceXs));
  c.setBoundVariable('paddingLeft', await V(ids.spaceSm));
  c.setBoundVariable('paddingRight', await V(ids.spaceSm));
  for (const k of ['topLeftRadius','topRightRadius','bottomLeftRadius','bottomRightRadius']) c.setBoundVariable(k, await V(ids.radiusSm));
  // paper fill
  c.fills = [figma.variables.setBoundVariableForPaint({type:'SOLID', color:{r:1,g:1,b:1}}, 'color', await V(ids.bgCanvas))];
  if (opts.disabled) c.opacity = 0.5;
  // ink border (or accent on focus)
  const borderId = opts.focus ? ids.accentPrimary : ids.sketchBlack;
  c.strokes = [figma.variables.setBoundVariableForPaint({type:'SOLID', color:{r:0,g:0,b:0}}, 'color', await V(borderId))];
  c.setBoundVariable('strokeWeight', await V(ids.borderW));
  c.strokeAlign = 'INSIDE';

  // multiline text content (sans, prose)
  const t = figma.createText();
  t.fontName = { family:'Inter', style:'Regular' };
  t.setBoundVariable('fontFamily', await V(ids.fontSans));
  t.characters = opts.text;
  t.setBoundVariable('fontSize', await V(ids.textSm));
  t.lineHeight = { unit:'PERCENT', value:150 };
  const textColorId = opts.placeholder ? ids.textMuted : ids.textPrimary;
  t.fills = [figma.variables.setBoundVariableForPaint({type:'SOLID', color:{r:0,g:0,b:0}}, 'color', await V(textColorId))];
  c.appendChild(t);
  t.layoutSizingHorizontal = 'FILL';
  t.layoutSizingVertical = 'HUG';
  t.textAutoResize = 'HEIGHT';

  // fixed geometry: full-width field (matches preview maxWidth 360, rows~3)
  c.resize(360, 84);
  return c;
}

const cDefault = await makeVariant('Default', { text:'Write a prompt…', placeholder:true });
const cFocus = await makeVariant('Focus', { text:'Multiple\nlines\nof prose', focus:true });
const cDisabled = await makeVariant('Disabled', { text:'Disabled', disabled:true });

const set = figma.combineAsVariants([cDefault, cFocus, cDisabled], page);
set.name = 'Textarea';
set.layoutMode = 'VERTICAL';
set.primaryAxisSizingMode = 'AUTO';
set.counterAxisSizingMode = 'AUTO';
set.itemSpacing = 24;
set.paddingTop = 24; set.paddingBottom = 24; set.paddingLeft = 24; set.paddingRight = 24;
set.x = 440; set.y = 520;

return { ids: [set.id, cDefault.id, cFocus.id, cDisabled.id] };