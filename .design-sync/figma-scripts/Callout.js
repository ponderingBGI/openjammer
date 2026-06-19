const page = await figma.getNodeByIdAsync('3:2'); await figma.setCurrentPageAsync(page);
await figma.loadFontAsync({ family:'Caveat', style:'Bold' });
await figma.loadFontAsync({ family:'Inter', style:'Regular' });
await figma.loadFontAsync({ family:'Inter', style:'Bold' });
const V = async (id) => await figma.variables.getVariableByIdAsync(id);

// Accent variable id per variant (info→audio-connection, success, warning, danger, tip→accent-secondary)
const ACCENTS = {
  info:    'VariableID:2:26',
  success: 'VariableID:2:21',
  warning: 'VariableID:2:22',
  danger:  'VariableID:2:23',
  tip:     'VariableID:2:20',
};
const COPY = {
  info:    { glyph:'i', title:'Heads up',         body:'Patch the keyboard into the synth to hear it.' },
  success: { glyph:'✓', title:'Connected',   body:'Audio is flowing from the synth to the speakers.' },
  warning: { glyph:'!', title:'High latency',     body:'The browser tier runs around 15–25ms. Use the native build on stage.' },
  danger:  { glyph:'✕', title:'Dropout detected', body:'The audio thread blocked. A held note beats a glitch — recover when ready.' },
  tip:     { glyph:'★', title:'Tip',         body:'Press Ctrl+Z to undo any graph edit the AI agent made.' },
};

async function buildVariant(variant) {
  const accentId = ACCENTS[variant];
  const data = COPY[variant];

  const c = figma.createComponent();
  c.name = 'variant=' + variant;
  c.layoutMode = 'HORIZONTAL';
  c.primaryAxisSizingMode = 'FIXED';
  c.counterAxisSizingMode = 'AUTO';
  c.counterAxisAlignItems = 'MIN';
  // gap (space-sm), padding (space-md)
  c.setBoundVariable('itemSpacing', await V('VariableID:1:5'));
  for (const k of ['paddingTop','paddingBottom','paddingLeft','paddingRight'])
    c.setBoundVariable(k, await V('VariableID:1:6'));
  // surface = bg-node
  c.fills = [figma.variables.setBoundVariableForPaint({type:'SOLID', color:{r:.5,g:.5,b:.5}}, 'color', await V('VariableID:2:4'))];
  // border: sketch-black ink, border-sketch-width; radius md
  c.strokes = [figma.variables.setBoundVariableForPaint({type:'SOLID', color:{r:0,g:0,b:0}}, 'color', await V('VariableID:2:16'))];
  c.setBoundVariable('strokeWeight', await V('VariableID:1:24'));
  for (const k of ['topLeftRadius','topRightRadius','bottomLeftRadius','bottomRightRadius'])
    c.setBoundVariable(k, await V('VariableID:1:10'));

  // Thick accent left edge (Signal-Not-Brand: accent lives only here + icon).
  // Modeled as a left-aligned accent bar since strokeWeight is uniform per node.
  const edge = figma.createRectangle();
  edge.name = 'accent-edge';
  edge.fills = [figma.variables.setBoundVariableForPaint({type:'SOLID', color:{r:.5,g:.5,b:.5}}, 'color', await V(accentId))];
  edge.cornerRadius = 0;
  c.appendChild(edge);
  edge.layoutPositioning = 'ABSOLUTE';
  edge.constraints = { horizontal: 'MIN', vertical: 'STRETCH' };
  edge.resize(4, 10);
  edge.x = 0; edge.y = 0;
  edge.setBoundVariable('width', await V('VariableID:1:4')); // space-xs

  // Icon — a glyph tinted with the variant accent (text-lg box).
  const icon = figma.createText();
  icon.fontName = { family:'Inter', style:'Bold' };
  icon.characters = data.glyph;
  icon.textAlignHorizontal = 'CENTER';
  icon.textAlignVertical = 'CENTER';
  icon.setBoundVariable('fontSize', await V('VariableID:1:17')); // text-lg
  icon.fills = [figma.variables.setBoundVariableForPaint({type:'SOLID', color:{r:.5,g:.5,b:.5}}, 'color', await V(accentId))];
  c.appendChild(icon);
  icon.layoutSizingHorizontal = 'HUG';
  icon.layoutSizingVertical = 'HUG';

  // Body: vertical stack of title + content
  const body = figma.createFrame();
  body.name = 'body';
  body.layoutMode = 'VERTICAL';
  body.fills = [];
  body.setBoundVariable('itemSpacing', await V('VariableID:1:4')); // space-xs (title margin-bottom)
  c.appendChild(body);
  body.layoutSizingHorizontal = 'FILL';
  body.counterAxisSizingMode = 'AUTO';
  body.primaryAxisSizingMode = 'AUTO';

  // Title — neutral text-primary, Caveat voice, text-md
  const title = figma.createText();
  title.fontName = { family:'Caveat', style:'Bold' };
  title.characters = data.title;
  title.setBoundVariable('fontSize', await V('VariableID:1:16')); // text-md
  title.fills = [figma.variables.setBoundVariableForPaint({type:'SOLID', color:{r:0,g:0,b:0}}, 'color', await V('VariableID:2:9'))]; // text-primary
  body.appendChild(title);
  title.layoutSizingHorizontal = 'FILL';
  title.layoutSizingVertical = 'HUG';

  // Content — text-secondary, Inter, text-sm
  const content = figma.createText();
  content.fontName = { family:'Inter', style:'Regular' };
  content.characters = data.body;
  content.setBoundVariable('fontSize', await V('VariableID:1:15')); // text-sm
  content.fills = [figma.variables.setBoundVariableForPaint({type:'SOLID', color:{r:0,g:0,b:0}}, 'color', await V('VariableID:2:10'))]; // text-secondary
  body.appendChild(content);
  content.layoutSizingHorizontal = 'FILL';
  content.layoutSizingVertical = 'HUG';

  // FIX: resize() resets BOTH sizing modes to FIXED. Set the fixed width via
  // resize first, then reassert the counter-axis (height) hug so the card keeps
  // sizing to its content instead of locking to the current pixel height.
  c.resize(420, c.height);
  c.primaryAxisSizingMode = 'FIXED';   // width stays fixed at 420
  c.counterAxisSizingMode = 'AUTO';    // height hugs content again
  body.layoutSizingVertical = 'HUG';
  return c;
}

const order = ['info','success','warning','danger','tip'];
const comps = [];
for (const v of order) comps.push(await buildVariant(v));

const set = figma.combineAsVariants(comps, page);
set.name = 'Callout';
set.layoutMode = 'VERTICAL';
set.primaryAxisSizingMode = 'AUTO';
set.counterAxisSizingMode = 'AUTO';
set.setBoundVariable('itemSpacing', await V('VariableID:1:6')); // space-md between variants
for (const k of ['paddingTop','paddingBottom','paddingLeft','paddingRight'])
  set.setBoundVariable(k, await V('VariableID:1:8')); // space-xl
set.x = 440; set.y = 760;

return { ids: [set.id] };