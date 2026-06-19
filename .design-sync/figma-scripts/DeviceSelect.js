const page = await figma.getNodeByIdAsync('3:3'); await figma.setCurrentPageAsync(page);
await figma.loadFontAsync({ family:'Caveat', style:'Bold' });
const V = async (id) => await figma.variables.getVariableByIdAsync(id);
const setPad = async (n, t,r,b,l) => { n.setBoundVariable('paddingTop', await V(t)); n.setBoundVariable('paddingRight', await V(r)); n.setBoundVariable('paddingBottom', await V(b)); n.setBoundVariable('paddingLeft', await V(l)); };
const setRadius = async (n, id) => { for (const k of ['topLeftRadius','topRightRadius','bottomLeftRadius','bottomRightRadius']) n.setBoundVariable(k, await V(id)); };
const solid = async (rgb, id) => figma.variables.setBoundVariableForPaint({ type:'SOLID', color: rgb }, 'color', await V(id));

// ----- root: vertical stack (trigger over popover list), matches preview 280px width -----
const c = figma.createComponent(); c.name = 'DeviceSelect';
c.layoutMode = 'VERTICAL'; c.primaryAxisSizingMode = 'AUTO'; c.counterAxisSizingMode = 'FIXED';
c.counterAxisAlignItems = 'MIN'; c.itemSpacing = 0; c.fills = []; c.clipsContent = false;
c.setBoundVariable('itemSpacing', await V('VariableID:1:4')); // space-xs gap between trigger and list

// ----- TRIGGER: node Button (bg-node fill, 2px sketch-black border, radius-md) -----
const trig = figma.createFrame(); trig.name = 'trigger';
trig.layoutMode = 'HORIZONTAL'; trig.primaryAxisSizingMode = 'FIXED'; trig.counterAxisSizingMode = 'AUTO';
trig.counterAxisAlignItems = 'CENTER'; trig.primaryAxisAlignItems = 'SPACE_BETWEEN';
await setPad(trig, 'VariableID:1:4','VariableID:1:5','VariableID:1:4','VariableID:1:5'); // xs/sm/xs/sm
trig.setBoundVariable('itemSpacing', await V('VariableID:1:4')); // space-xs gap
await setRadius(trig, 'VariableID:1:10'); // radius-md
trig.fills = [await solid({ r:1, g:1, b:1 }, 'VariableID:2:4')]; // bg-node
trig.strokes = [await solid({ r:0, g:0, b:0 }, 'VariableID:2:16')]; // sketch-black
trig.setBoundVariable('strokeWeight', await V('VariableID:1:24')); // border-sketch-width
c.appendChild(trig); trig.layoutSizingHorizontal = 'FILL';

// trigger label (selected device name) — text-primary, Caveat, text-sm
const tlab = figma.createText(); tlab.fontName = { family:'Caveat', style:'Bold' };
tlab.characters = 'Focusrite Scarlett 2i2';
tlab.setBoundVariable('fontSize', await V('VariableID:1:15')); // text-sm
tlab.fills = [await solid({ r:0, g:0, b:0 }, 'VariableID:2:9')]; // text-primary
tlab.textAlignHorizontal = 'LEFT'; trig.appendChild(tlab);
tlab.layoutSizingHorizontal = 'FILL'; tlab.layoutSizingVertical = 'HUG'; tlab.layoutGrow = 1;

// trailing cluster on trigger: bolt (accent) + caret (muted)
const tend = figma.createFrame(); tend.name = 'end'; tend.layoutMode = 'HORIZONTAL';
tend.primaryAxisSizingMode = 'AUTO'; tend.counterAxisSizingMode = 'AUTO'; tend.counterAxisAlignItems = 'CENTER';
tend.fills = []; tend.setBoundVariable('itemSpacing', await V('VariableID:1:4'));
trig.appendChild(tend); tend.layoutSizingHorizontal = 'HUG'; tend.layoutSizingVertical = 'HUG';

// low-latency bolt — accent-primary (selected device is fast-path)
const boltSvg = figma.createNodeFromSvg('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>');
boltSvg.name = 'IconBolt'; boltSvg.resize(14, 14);
const paintBoltVec = async (frame, colorId) => { for (const v of frame.findAllWithCriteria({ types:['VECTOR'] })) { if (v.strokes && v.strokes.length) v.strokes = [await solid({ r:0, g:0, b:0 }, colorId)]; if (v.fills && v.fills.length) v.fills = [await solid({ r:0, g:0, b:0 }, colorId)]; } };
await paintBoltVec(boltSvg, 'VariableID:2:19'); // accent-primary
tend.appendChild(boltSvg); boltSvg.layoutSizingHorizontal = 'FIXED'; boltSvg.layoutSizingVertical = 'FIXED';

// caret — chevron-down, text-muted
const caretSvg = figma.createNodeFromSvg('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>');
caretSvg.name = 'IconChevronDown'; caretSvg.resize(14, 14);
await paintBoltVec(caretSvg, 'VariableID:2:11'); // text-muted
tend.appendChild(caretSvg); caretSvg.layoutSizingHorizontal = 'FIXED'; caretSvg.layoutSizingVertical = 'FIXED';

// ----- POPOVER LIST: Surface (menu elevation, radius-md, bg-node, sketch border) -----
const list = figma.createFrame(); list.name = 'list';
list.layoutMode = 'VERTICAL'; list.primaryAxisSizingMode = 'AUTO'; list.counterAxisSizingMode = 'FIXED';
list.counterAxisAlignItems = 'MIN'; list.itemSpacing = 1; // gap: 1px
await setPad(list, 'VariableID:1:4','VariableID:1:4','VariableID:1:4','VariableID:1:4'); // space-xs all
await setRadius(list, 'VariableID:1:10'); // radius-md
list.fills = [await solid({ r:1, g:1, b:1 }, 'VariableID:2:4')]; // bg-node
list.strokes = [await solid({ r:0, g:0, b:0 }, 'VariableID:2:16')]; // sketch-black
list.setBoundVariable('strokeWeight', await V('VariableID:1:24')); // border-sketch-width
// menu Surface = hard, blur-free shadow in the ink color (4,5 offset / Hard-Shadow)
list.effects = [{ type:'DROP_SHADOW', color:{ r:0, g:0, b:0, a:1 }, offset:{ x:4, y:5 }, radius:0, spread:0, visible:true, blendMode:'NORMAL' }];
c.appendChild(list); list.layoutSizingHorizontal = 'FILL';

// option row builder: ghost Button (transparent) or is-active (accent-success fill)
const addOption = async (label, lowLatency, isActive) => {
  const row = figma.createFrame(); row.name = 'option' + (isActive ? ' (active)' : '');
  row.layoutMode = 'HORIZONTAL'; row.primaryAxisSizingMode = 'FIXED'; row.counterAxisSizingMode = 'AUTO';
  row.counterAxisAlignItems = 'CENTER'; row.primaryAxisAlignItems = 'SPACE_BETWEEN';
  await setPad(row, 'VariableID:1:4','VariableID:1:5','VariableID:1:4','VariableID:1:5'); // xs/sm/xs/sm
  row.setBoundVariable('itemSpacing', await V('VariableID:1:5')); // space-sm
  await setRadius(row, 'VariableID:1:9'); // radius-sm
  if (isActive) { row.fills = [await solid({ r:0, g:0, b:0 }, 'VariableID:2:21')]; } // accent-success
  else { row.fills = []; }
  list.appendChild(row); row.layoutSizingHorizontal = 'FILL';
  const rowTextColor = isActive ? 'VariableID:2:12' : 'VariableID:2:9'; // text-on-accent : text-primary
  const lab = figma.createText(); lab.fontName = { family:'Caveat', style:'Bold' };
  lab.characters = label; lab.setBoundVariable('fontSize', await V('VariableID:1:15')); // text-sm
  lab.fills = [await solid({ r:0, g:0, b:0 }, rowTextColor)];
  lab.textAlignHorizontal = 'LEFT'; row.appendChild(lab);
  lab.layoutSizingHorizontal = 'FILL'; lab.layoutSizingVertical = 'HUG'; lab.layoutGrow = 1;
  if (lowLatency) {
    const b = figma.createNodeFromSvg('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>');
    b.name = 'IconBolt'; b.resize(14, 14);
    await paintBoltVec(b, rowTextColor); // rides row text color
    row.appendChild(b); b.layoutSizingHorizontal = 'FIXED'; b.layoutSizingVertical = 'FIXED';
  }
};
await addOption('Built-in Microphone', false, false);
await addOption('Focusrite Scarlett 2i2', true, true);
await addOption('RØDE NT-USB', false, false);
await addOption('Aggregate Device', true, false);

// ----- size + position -----
c.resize(280, c.height); trig.layoutSizingHorizontal = 'FILL'; list.layoutSizingHorizontal = 'FILL';
c.x = 1160; c.y = 320;
return { ids: [c.id] };