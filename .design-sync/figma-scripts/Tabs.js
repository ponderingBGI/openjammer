const page = await figma.getNodeByIdAsync('3:2'); await figma.setCurrentPageAsync(page);
await figma.loadFontAsync({ family:'Caveat', style:'Bold' });
const V = async (id) => await figma.variables.getVariableByIdAsync(id);

// One vertical Tab segment. axis = State (Default / Active).
// Mirrors .oj-seg--vertical .oj-seg__btn: full width, left-aligned text,
// padding space-sm space-lg, font-sketch, text-md.
//   Default: color text-muted, transparent bg.
//   Active : color text-primary, bg bg-tertiary, inked right edge (sketch-black, border-sketch-width).
const makeSeg = async (label, active) => {
  const c = figma.createComponent();
  c.name = 'State=' + (active ? 'Active' : 'Default');
  c.layoutMode = 'HORIZONTAL';
  c.primaryAxisSizingMode = 'FIXED';   // full-width row
  c.counterAxisSizingMode = 'AUTO';    // height hugs text + padding
  c.primaryAxisAlignItems = 'MIN';     // text-align:left
  c.counterAxisAlignItems = 'CENTER';
  c.clipsContent = false;
  c.setBoundVariable('paddingTop', await V('VariableID:1:5'));    // space-sm
  c.setBoundVariable('paddingBottom', await V('VariableID:1:5')); // space-sm
  c.setBoundVariable('paddingLeft', await V('VariableID:1:7'));   // space-lg
  c.setBoundVariable('paddingRight', await V('VariableID:1:7'));  // space-lg
  if (active) {
    c.fills = [figma.variables.setBoundVariableForPaint({ type:'SOLID', color:{ r:.93, g:.92, b:.90 } }, 'color', await V('VariableID:2:5'))]; // bg-tertiary
  } else {
    c.fills = [];
  }
  const t = figma.createText();
  t.fontName = { family:'Caveat', style:'Bold' };
  t.characters = label;
  t.setBoundVariable('fontSize', await V('VariableID:1:16')); // text-md
  const txtColor = active ? 'VariableID:2:9' : 'VariableID:2:11'; // text-primary / text-muted
  t.fills = [figma.variables.setBoundVariableForPaint({ type:'SOLID', color:{ r:0, g:0, b:0 } }, 'color', await V(txtColor))];
  c.appendChild(t);
  t.layoutSizingHorizontal = 'HUG';
  t.layoutSizingVertical = 'HUG';
  // Lock the row to its final full-width size BEFORE placing the absolute edge,
  // so edge.x is computed against the real width.
  c.resize(180, c.height);
  // Inked right edge for the active row (mirrors the CSS inset box-shadow on the
  // right: sketch-black, border-sketch-width). Absolute child pinned to the right
  // and STRETCHed vertically — its height is sized explicitly with resize() because
  // FILL is rejected on absolute-positioned auto-layout children.
  if (active) {
    const edge = figma.createRectangle();
    edge.name = 'active-edge';
    edge.fills = [figma.variables.setBoundVariableForPaint({ type:'SOLID', color:{ r:0, g:0, b:0 } }, 'color', await V('VariableID:2:16'))]; // sketch-black
    c.appendChild(edge);
    edge.layoutPositioning = 'ABSOLUTE';
    edge.constraints = { horizontal:'MAX', vertical:'STRETCH' };
    edge.setBoundVariable('width', await V('VariableID:1:24')); // border-sketch-width
    edge.resize(edge.width, c.height); // span full height; STRETCH keeps it spanning on later resize
    edge.x = c.width - edge.width;
    edge.y = 0;
  }
  return c;
};

const def = await makeSeg('Graphics', false);
const act = await makeSeg('Audio', true);

const set = figma.combineAsVariants([def, act], page);
set.name = 'Tabs';
set.layoutMode = 'VERTICAL';
set.primaryAxisSizingMode = 'AUTO';
set.counterAxisSizingMode = 'AUTO';
set.itemSpacing = 16;
set.paddingTop = 16; set.paddingBottom = 16; set.paddingLeft = 16; set.paddingRight = 16;
set.x = 440; set.y = 1000;

return { ids: [set.id] };