const page = await figma.getNodeByIdAsync('3:3'); await figma.setCurrentPageAsync(page);
await figma.loadFontAsync({ family:'Caveat', style:'Regular' });
const V = async (id) => await figma.variables.getVariableByIdAsync(id);

// space/md (16px) token — same scale family as the row gap (space/xs = VariableID:1:4).
// NOTE: replace with the real space/md variable ID from THIS file (not derivable
// from the codebase). The set-level gap + padding MUST be bound, not hardcoded px.
const SPACE_MD = 'VariableID:1:8';

// Helper: build one PortRow variant
async function buildRow(sideName, kind, labelText, connected) {
  const c = figma.createComponent();
  c.name = 'side=' + sideName;
  c.layoutMode = 'HORIZONTAL';
  c.primaryAxisSizingMode = 'AUTO';
  c.counterAxisSizingMode = 'AUTO';
  c.counterAxisAlignItems = 'CENTER';
  // output rows read right-to-left [label][dot]; input rows [dot][label]
  c.itemReverseZIndex = false;
  if (sideName === 'output') c.primaryAxisAlignItems = 'MAX';
  c.setBoundVariable('itemSpacing', await V('VariableID:1:4')); // space/xs gap
  c.fills = [];

  // --- The Port dot: 16px circle, sketch-black stroke, kind-colored fill ---
  const dot = figma.createEllipse();
  dot.name = 'Port';
  dot.resize(16, 16);
  // fill by wiring color (audio-input / audio-output / control-input / control-output)
  let fillId;
  if (connected) {
    fillId = kind === 'audio' ? 'VariableID:2:27' : 'VariableID:2:31'; // audio/control-connected
  } else if (kind === 'audio') {
    fillId = sideName === 'input' ? 'VariableID:2:24' : 'VariableID:2:25';
  } else {
    fillId = sideName === 'input' ? 'VariableID:2:28' : 'VariableID:2:29';
  }
  dot.fills = [figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:0.3,g:0.6,b:1}}, 'color', await V(fillId))];
  dot.strokes = [figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:0,g:0,b:0}}, 'color', await V('VariableID:2:16'))]; // sketch-black
  dot.setBoundVariable('strokeWeight', await V('VariableID:1:24')); // border/sketch-width

  // --- The label: Caveat, text-sm, text-secondary (text-primary if connected) ---
  const t = figma.createText();
  t.name = 'label';
  t.fontName = { family:'Caveat', style:'Regular' };
  t.characters = labelText;
  t.setBoundVariable('fontSize', await V('VariableID:1:15')); // text/sm
  t.lineHeight = { value: 120, unit: 'PERCENT' };
  t.fills = [figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:0.3,g:0.3,b:0.3}}, 'color', await V(connected ? 'VariableID:2:9' : 'VariableID:2:10'))]; // text-primary / text-secondary

  // input: [dot][label]; output: [label][dot]
  if (sideName === 'output') {
    c.appendChild(t); c.appendChild(dot);
  } else {
    c.appendChild(dot); c.appendChild(t);
  }
  t.layoutSizingHorizontal = 'HUG'; t.layoutSizingVertical = 'HUG';
  dot.layoutSizingHorizontal = 'FIXED'; dot.layoutSizingVertical = 'FIXED';
  if (sideName === 'output') t.textAlignHorizontal = 'RIGHT';
  return c;
}

const inputRow = await buildRow('input', 'audio', 'Sidechain', false);
const outputRow = await buildRow('output', 'audio', 'Out L', false);

const set = figma.combineAsVariants([inputRow, outputRow], page);
set.name = 'PortRow';
set.layoutMode = 'VERTICAL';
set.primaryAxisSizingMode = 'AUTO';
set.counterAxisSizingMode = 'AUTO';
// FIX: bind gap + padding to space/md instead of hardcoding 16px
const spaceMd = await V(SPACE_MD);
set.setBoundVariable('itemSpacing', spaceMd);
set.setBoundVariable('paddingTop', spaceMd);
set.setBoundVariable('paddingBottom', spaceMd);
set.setBoundVariable('paddingLeft', spaceMd);
set.setBoundVariable('paddingRight', spaceMd);
set.x = 440; set.y = 80;

return { ids: [set.id, inputRow.id, outputRow.id] };