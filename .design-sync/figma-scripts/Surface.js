const page = await figma.getNodeByIdAsync('3:2');
await figma.setCurrentPageAsync(page);
await figma.loadFontAsync({ family: 'Caveat', style: 'Regular' });
const V = async (id) => await figma.variables.getVariableByIdAsync(id);

// Hard (blur-0) ink drop shadows — DESIGN.md Hard-Shadow Rule.
// rest = --shadow-node (2px 3px 0 rgba(0,0,0,.1)); menu = --shadow-menu (3px 4px 0 rgba(0,0,0,.15));
// lifted = 4px 5px 0 sketch-black (full ink). DropShadowEffect.color is RGBA, so {r,g,b,a} is correct here.
const shadows = {
  rest:   { offset: { x: 2, y: 3 }, color: { r: 0, g: 0, b: 0, a: 0.1 } },
  menu:   { offset: { x: 3, y: 4 }, color: { r: 0, g: 0, b: 0, a: 0.15 } },
  lifted: { offset: { x: 4, y: 5 }, color: { r: 0, g: 0, b: 0, a: 1 } },
};

const labels = { rest: 'Rest', menu: 'Menu', lifted: 'Lifted' };

async function makeVariant(elevation) {
  const c = figma.createComponent();
  c.name = `elevation=${elevation}`;
  c.layoutMode = 'VERTICAL';
  c.counterAxisAlignItems = 'MIN';

  // Set the fixed width FIRST, while sizing modes are still at their defaults.
  // resize() resets BOTH primaryAxisSizingMode and counterAxisSizingMode to FIXED,
  // so it must run before we declare the intended sizing modes — otherwise the
  // height (primaryAxisSizingMode = 'AUTO') would be silently re-locked to FIXED.
  c.resize(160, c.height);
  c.primaryAxisSizingMode = 'AUTO';   // height hugs content
  c.counterAxisSizingMode = 'FIXED';  // width pinned to 160

  // padding: --space-md all sides (matches preview demoStyle padding)
  c.setBoundVariable('paddingTop', await V('VariableID:1:6'));
  c.setBoundVariable('paddingBottom', await V('VariableID:1:6'));
  c.setBoundVariable('paddingLeft', await V('VariableID:1:6'));
  c.setBoundVariable('paddingRight', await V('VariableID:1:6'));

  // radius: default `lg`
  for (const k of ['topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius']) {
    c.setBoundVariable(k, await V('VariableID:1:11'));
  }

  // fill: --bg-node (setBoundVariableForPaint returns a NEW paint — capture + reassign)
  c.fills = [figma.variables.setBoundVariableForPaint(
    { type: 'SOLID', color: { r: 1, g: 1, b: 1 } }, 'color', await V('VariableID:2:4'))];

  // border: --border-sketch-width solid --sketch-black
  c.strokes = [figma.variables.setBoundVariableForPaint(
    { type: 'SOLID', color: { r: 0, g: 0, b: 0 } }, 'color', await V('VariableID:2:16'))];
  c.setBoundVariable('strokeWeight', await V('VariableID:1:24'));
  c.strokeAlign = 'INSIDE';

  // hard (blur-0) ink shadow per elevation
  const s = shadows[elevation];
  c.effects = [{ type: 'DROP_SHADOW', color: s.color, offset: s.offset, radius: 0, spread: 0, visible: true, blendMode: 'NORMAL' }];

  // demo content (Caveat sketch font, text-primary)
  const t = figma.createText();
  t.fontName = { family: 'Caveat', style: 'Regular' };
  t.characters = labels[elevation];
  t.setBoundVariable('fontSize', await V('VariableID:1:16'));
  t.fills = [figma.variables.setBoundVariableForPaint(
    { type: 'SOLID', color: { r: 0, g: 0, b: 0 } }, 'color', await V('VariableID:2:9'))];
  c.appendChild(t);
  // HUG/FILL must be set AFTER appendChild (Rule 12). TEXT child may HUG.
  t.layoutSizingHorizontal = 'HUG';
  t.layoutSizingVertical = 'HUG';

  return c;
}

const rest = await makeVariant('rest');
const menu = await makeVariant('menu');
const lifted = await makeVariant('lifted');

const set = figma.combineAsVariants([rest, menu, lifted], page);
set.name = 'Surface';
// ComponentSet supports auto-layout; setting layoutMode reflows the children that
// combineAsVariants stacked at (0,0), so no manual grid positioning is needed.
set.layoutMode = 'HORIZONTAL';
set.primaryAxisSizingMode = 'AUTO';
set.counterAxisSizingMode = 'AUTO';
set.counterAxisAlignItems = 'MIN';
set.itemSpacing = 40;
set.paddingTop = 24; set.paddingBottom = 24; set.paddingLeft = 24; set.paddingRight = 24;
set.x = 800;
set.y = 760;

return { ids: [set.id], variantIds: [rest.id, menu.id, lifted.id] };