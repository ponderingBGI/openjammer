const page = await figma.getNodeByIdAsync('3:3'); await figma.setCurrentPageAsync(page);
const V = async (id) => await figma.variables.getVariableByIdAsync(id);

// Build one icon-only square button. variant: 'ghost' | 'node' | 'active'.
// icon: 'close' | 'download' | 'mute'
const buildIcon = (which) => {
  let svg;
  if (which === 'close') {
    svg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  } else if (which === 'download') {
    svg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
  } else {
    svg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>';
  }
  return figma.createNodeFromSvg(svg);
};

const makeVariant = async (variantValue, iconWhich) => {
  const c = figma.createComponent();
  c.name = 'variant=' + variantValue;
  c.layoutMode = 'HORIZONTAL';
  c.primaryAxisSizingMode = 'AUTO';
  c.counterAxisSizingMode = 'AUTO';
  c.primaryAxisAlignItems = 'CENTER';
  c.counterAxisAlignItems = 'CENTER';
  // .oj-btn--icon-only: equal padding of space-xs on all sides, square.
  c.setBoundVariable('paddingTop', await V('VariableID:1:4'));
  c.setBoundVariable('paddingBottom', await V('VariableID:1:4'));
  c.setBoundVariable('paddingLeft', await V('VariableID:1:4'));
  c.setBoundVariable('paddingRight', await V('VariableID:1:4'));
  c.setBoundVariable('itemSpacing', await V('VariableID:1:4'));
  // radius-md on all corners.
  for (const k of ['topLeftRadius','topRightRadius','bottomLeftRadius','bottomRightRadius']) c.setBoundVariable(k, await V('VariableID:1:10'));

  // Determine fill / stroke / icon color per variant.
  let fillVarId, strokeVarId, hasStroke, iconColorVarId;
  if (variantValue === 'ghost') {
    // transparent bg, transparent border, color text-primary.
    fillVarId = null; hasStroke = false; iconColorVarId = 'VariableID:2:9';
  } else if (variantValue === 'node') {
    // bg-node fill, sketch-black border, color text-primary.
    fillVarId = 'VariableID:2:4'; strokeVarId = 'VariableID:2:16'; hasStroke = true; iconColorVarId = 'VariableID:2:9';
  } else {
    // active: accent-success fill, sketch-black border, color text-on-accent.
    fillVarId = 'VariableID:2:21'; strokeVarId = 'VariableID:2:16'; hasStroke = true; iconColorVarId = 'VariableID:2:12';
  }

  if (fillVarId) {
    c.fills = [figma.variables.setBoundVariableForPaint({ type:'SOLID', color:{ r:1, g:1, b:1 } }, 'color', await V(fillVarId))];
  } else {
    c.fills = [];
  }
  if (hasStroke) {
    c.strokes = [figma.variables.setBoundVariableForPaint({ type:'SOLID', color:{ r:0, g:0, b:0 } }, 'color', await V(strokeVarId))];
    c.setBoundVariable('strokeWeight', await V('VariableID:1:24'));
  } else {
    c.strokes = [];
  }

  // Icon glyph wrapped in a 24x24 frame, vector stroke bound to the icon color.
  const svgFrame = buildIcon(iconWhich);
  svgFrame.name = 'icon';
  const iconColor = await V(iconColorVarId);
  const recolor = (node) => {
    if (node.strokes && node.strokes.length) {
      node.strokes = node.strokes.map((p) => p.type === 'SOLID' ? figma.variables.setBoundVariableForPaint(p, 'color', iconColor) : p);
    }
    if (node.fills && Array.isArray(node.fills) && node.fills.length) {
      node.fills = node.fills.map((p) => p.type === 'SOLID' ? figma.variables.setBoundVariableForPaint(p, 'color', iconColor) : p);
    }
    if ('children' in node) for (const ch of node.children) recolor(ch);
  };
  recolor(svgFrame);
  svgFrame.resize(16, 16);
  c.appendChild(svgFrame);
  svgFrame.layoutSizingHorizontal = 'FIXED';
  svgFrame.layoutSizingVertical = 'FIXED';
  return c;
};

const cGhost = await makeVariant('ghost', 'close');
const cNode = await makeVariant('node', 'download');
const cActive = await makeVariant('active', 'mute');

const set = figma.combineAsVariants([cGhost, cNode, cActive], page);
set.name = 'IconButton';
set.layoutMode = 'HORIZONTAL';
set.primaryAxisSizingMode = 'AUTO';
set.counterAxisSizingMode = 'AUTO';
set.counterAxisAlignItems = 'CENTER';
set.itemSpacing = 24;
set.paddingTop = 24; set.paddingBottom = 24; set.paddingLeft = 24; set.paddingRight = 24;
set.x = 440; set.y = 560;

return { ids: [set.id] };