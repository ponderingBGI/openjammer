const page = await figma.getNodeByIdAsync('3:2'); await figma.setCurrentPageAsync(page);
await figma.loadFontAsync({ family: 'Caveat', style: 'Regular' });
const V = async (id) => await figma.variables.getVariableByIdAsync(id);

// Builds one Toggle variant. checked=true => on (success track, knob right, on-accent knob).
const buildVariant = async (checked, withDesc) => {
  const c = figma.createComponent();
  c.name = 'State=' + (checked ? 'On' : 'Off');
  c.layoutMode = 'HORIZONTAL';
  c.primaryAxisSizingMode = 'AUTO';
  c.counterAxisSizingMode = 'AUTO';
  c.counterAxisAlignItems = 'MIN'; // align-items: flex-start
  c.setBoundVariable('itemSpacing', await V('VariableID:1:5')); // gap: space-sm (8)
  c.fills = [];

  // --- Track (geometry-fixed frame, knob absolutely positioned inside) ---
  const track = figma.createFrame();
  track.name = 'track';
  track.layoutMode = 'NONE';
  track.resize(32, 16); // width space-xl, height space-md
  for (const k of ['topLeftRadius','topRightRadius','bottomLeftRadius','bottomRightRadius'])
    track.setBoundVariable(k, await V('VariableID:1:13')); // radius-pill
  track.fills = [figma.variables.setBoundVariableForPaint(
    { type: 'SOLID', color: { r: 0.5, g: 0.5, b: 0.5 } }, 'color',
    await V(checked ? 'VariableID:2:21' : 'VariableID:2:5'))]; // on: accent-success, off: bg-tertiary
  track.strokes = [figma.variables.setBoundVariableForPaint(
    { type: 'SOLID', color: { r: 0, g: 0, b: 0 } }, 'color', await V('VariableID:2:16'))]; // sketch-black
  track.setBoundVariable('strokeWeight', await V('VariableID:1:24')); // border-sketch-width (2)
  track.strokeAlign = 'INSIDE';

  // --- Knob ---
  const knob = figma.createEllipse();
  knob.name = 'knob';
  knob.resize(10, 10); // calc(space-md - space-xs - 2px) = 10
  knob.fills = [figma.variables.setBoundVariableForPaint(
    { type: 'SOLID', color: { r: 1, g: 1, b: 1 } }, 'color',
    await V(checked ? 'VariableID:2:12' : 'VariableID:2:4'))]; // on: text-on-accent, off: bg-node
  knob.strokes = [figma.variables.setBoundVariableForPaint(
    { type: 'SOLID', color: { r: 0, g: 0, b: 0 } }, 'color', await V('VariableID:2:16'))]; // sketch-black
  knob.setBoundVariable('strokeWeight', await V('VariableID:1:24'));
  knob.strokeAlign = 'INSIDE';
  track.appendChild(knob);
  // off: top/left 1px -> x=1,y=1 ; on: translateX(space-xl - space-md - 2px)=14 -> x=15,y=1
  knob.x = checked ? 15 : 1;
  knob.y = 1;

  c.appendChild(track);
  track.layoutSizingHorizontal = 'FIXED';
  track.layoutSizingVertical = 'FIXED';

  // --- Text stack (label + optional description) ---
  const textCol = figma.createFrame();
  textCol.name = 'text';
  textCol.layoutMode = 'VERTICAL';
  textCol.primaryAxisSizingMode = 'AUTO';
  textCol.counterAxisSizingMode = 'AUTO';
  textCol.setBoundVariable('itemSpacing', await V('VariableID:1:4')); // gap: space-xs (4)
  textCol.fills = [];

  const label = figma.createText();
  label.name = 'label';
  label.fontName = { family: 'Caveat', style: 'Regular' };
  label.characters = checked ? 'Auto-update' : 'Low-latency mode';
  label.setBoundVariable('fontSize', await V('VariableID:1:16')); // text-md (18)
  label.lineHeight = { value: 120, unit: 'PERCENT' };
  label.fills = [figma.variables.setBoundVariableForPaint(
    { type: 'SOLID', color: { r: 0, g: 0, b: 0 } }, 'color', await V('VariableID:2:9'))]; // text-primary
  textCol.appendChild(label);
  label.layoutSizingHorizontal = 'HUG';
  label.layoutSizingVertical = 'HUG';

  if (withDesc) {
    const desc = figma.createText();
    desc.name = 'desc';
    desc.fontName = { family: 'Caveat', style: 'Regular' };
    // FIX: switch to HEIGHT autoresize BEFORE sizing/characters so the 240px
    // wrapping width holds. Left at the default WIDTH_AND_HEIGHT, resize(240)
    // is ignored (text hugs to ~0 width -> "text thread" bug).
    desc.textAutoResize = 'HEIGHT';
    desc.characters = "Install new versions automatically when they're ready.";
    desc.setBoundVariable('fontSize', await V('VariableID:1:15')); // text-sm (16)
    desc.lineHeight = { value: 150, unit: 'PERCENT' };
    desc.fills = [figma.variables.setBoundVariableForPaint(
      { type: 'SOLID', color: { r: 0.5, g: 0.5, b: 0.5 } }, 'color', await V('VariableID:2:11'))]; // text-muted
    textCol.appendChild(desc);
    desc.layoutSizingHorizontal = 'FIXED';
    desc.resize(240, desc.height);
    desc.layoutSizingVertical = 'HUG';
  }

  c.appendChild(textCol);
  textCol.layoutSizingHorizontal = 'HUG';
  textCol.layoutSizingVertical = 'HUG';
  return c;
};

const off = await buildVariant(false, false); // Low-latency mode, no desc
const on = await buildVariant(true, true);    // Auto-update, with desc

const set = figma.combineAsVariants([off, on], page);
set.name = 'Toggle';
set.layoutMode = 'VERTICAL';
set.primaryAxisSizingMode = 'AUTO';
set.counterAxisSizingMode = 'AUTO';
set.itemSpacing = 24;
set.paddingTop = 24; set.paddingBottom = 24; set.paddingLeft = 24; set.paddingRight = 24;
set.x = 80; set.y = 760;

return { ids: [set.id] };