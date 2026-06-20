const page = await figma.getNodeByIdAsync('3:2'); await figma.setCurrentPageAsync(page);
await figma.loadFontAsync({ family:'Caveat', style:'Regular' });
const V = async (id) => await figma.variables.getVariableByIdAsync(id);

// helper: build one ListRow frame in a given state
const makeRow = async (label, state) => {
  // state: 'resting' | 'selected' | 'current'
  const row = figma.createFrame();
  row.name = 'ListRow / ' + state;
  row.layoutMode = 'HORIZONTAL';
  row.primaryAxisSizingMode = 'FIXED';      // fill list width
  row.counterAxisSizingMode = 'AUTO';        // hug height
  row.counterAxisAlignItems = 'CENTER';
  row.clipsContent = false;
  // padding: var(--space-xs) var(--space-sm)
  row.setBoundVariable('paddingTop', await V('VariableID:1:4'));
  row.setBoundVariable('paddingBottom', await V('VariableID:1:4'));
  row.setBoundVariable('paddingLeft', await V('VariableID:1:5'));
  row.setBoundVariable('paddingRight', await V('VariableID:1:5'));
  // gap between body + actions: var(--space-sm)
  row.setBoundVariable('itemSpacing', await V('VariableID:1:5'));
  // radius: var(--radius-md)
  for (const k of ['topLeftRadius','topRightRadius','bottomLeftRadius','bottomRightRadius']) row.setBoundVariable(k, await V('VariableID:1:10'));
  // border: var(--border-sketch-width) solid transparent (resting) / accent (selected)
  row.setBoundVariable('strokeWeight', await V('VariableID:1:24'));
  row.strokeAlign = 'INSIDE';

  if (state === 'selected') {
    // border-color: accent-primary; background: faint accent fill (~12%)
    row.strokes = [figma.variables.setBoundVariableForPaint({ type:'SOLID', color:{r:0.18,g:0.45,b:0.95} }, 'color', await V('VariableID:2:19'))];
    const fill = figma.variables.setBoundVariableForPaint({ type:'SOLID', opacity:0.12, color:{r:0.18,g:0.45,b:0.95} }, 'color', await V('VariableID:2:19'));
    row.fills = [fill];
  } else {
    // transparent border + transparent background
    row.strokes = [{ type:'SOLID', color:{r:0,g:0,b:0}, opacity:0 }];
    row.fills = [{ type:'SOLID', color:{r:0,g:0,b:0}, opacity:0 }];
  }

  // current -> left accent marker (inset 3px 0 0 accent): a thin accent bar pinned left
  if (state === 'current') {
    const marker = figma.createRectangle();
    marker.name = 'current-marker';
    marker.resize(3, 1);
    marker.fills = [figma.variables.setBoundVariableForPaint({ type:'SOLID', color:{r:0.18,g:0.45,b:0.95} }, 'color', await V('VariableID:2:19'))];
    row.appendChild(marker);
    marker.layoutPositioning = 'ABSOLUTE';
    marker.constraints = { horizontal:'MIN', vertical:'STRETCH' };
    marker.x = 0; marker.y = 0;
    // NOTE: do NOT set layoutSizingVertical = 'FILL' on an ABSOLUTE child (throws
    // "FILL cannot be set on absolute positioned auto-layout children").
    // The constraints { vertical:'STRETCH' } already stretch the marker to row height.
  }

  // body text — Caveat (font/sketch), text/md, text-primary
  const t = figma.createText();
  t.fontName = { family:'Caveat', style:'Regular' };
  t.characters = label;
  t.setBoundVariable('fontSize', await V('VariableID:1:16'));
  t.fills = [figma.variables.setBoundVariableForPaint({ type:'SOLID', color:{r:0,g:0,b:0} }, 'color', await V('VariableID:2:9'))];
  row.appendChild(t);
  t.layoutSizingHorizontal = 'FILL';   // body flex:1
  t.layoutSizingVertical = 'HUG';
  return row;
};

// the List container — flex column, gap var(--space-xs)
const c = figma.createComponent();
c.name = 'List';
c.layoutMode = 'VERTICAL';
c.primaryAxisSizingMode = 'AUTO';     // hug height
c.counterAxisSizingMode = 'FIXED';     // fixed width so rows fill (minWidth 280 in preview)
c.counterAxisAlignItems = 'MIN';
c.clipsContent = false;
c.setBoundVariable('itemSpacing', await V('VariableID:1:4'));
// the List itself has no chrome (layout-only); transparent bg/stroke
c.fills = [{ type:'SOLID', color:{r:0,g:0,b:0}, opacity:0 }];

// rows mirror the preview: resting, selected, current, resting
const r1 = await makeRow('Built-in Output', 'resting');
const r2 = await makeRow('Scarlett 2i2 USB', 'selected');
const r3 = await makeRow('BlackHole 2ch', 'current');
const r4 = await makeRow('Aggregate Device', 'resting');
c.appendChild(r1); c.appendChild(r2); c.appendChild(r3); c.appendChild(r4);

// width from preview minWidth: 280
c.resize(280, c.height);
for (const r of [r1,r2,r3,r4]) { r.layoutSizingHorizontal = 'FILL'; }

c.x = 800; c.y = 1000;
return { ids: [c.id] };