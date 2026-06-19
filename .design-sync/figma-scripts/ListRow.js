const page = await figma.getNodeByIdAsync('3:2'); await figma.setCurrentPageAsync(page);
await figma.loadFontAsync({ family:'Caveat', style:'Bold' });
await figma.loadFontAsync({ family:'JetBrains Mono', style:'Regular' });
const V = async (id) => await figma.variables.getVariableByIdAsync(id);

// shared variable ids
const SP_XS='VariableID:1:4', SP_SM='VariableID:1:5';
const RAD_MD='VariableID:1:10', BORDER_W='VariableID:1:24';
const TXT_MD='VariableID:1:16', TXT_XS='VariableID:1:14';
const C_TEXT='VariableID:2:9', C_MUTED='VariableID:2:11';
const C_ACCENT='VariableID:2:19', C_TERTIARY='VariableID:2:5';

// builds one ListRow variant.  selected -> accent ring + faint fill, current -> left accent marker, disabled -> dimmed
async function makeRow(variantValue, label, code, opts){
  opts = opts || {};
  const row = figma.createComponent();
  row.name = 'State='+variantValue;
  row.layoutMode='HORIZONTAL';
  row.primaryAxisSizingMode='FIXED';
  row.counterAxisSizingMode='AUTO';
  row.counterAxisAlignItems='CENTER';
  row.layoutAlign='STRETCH';            // FIX: was `layoutAlignItems` — not a real property; assigning it throws "object is not extensible" and atomically aborts the whole script
  row.setBoundVariable('paddingTop', await V(SP_XS));
  row.setBoundVariable('paddingBottom', await V(SP_XS));
  row.setBoundVariable('paddingLeft', await V(SP_SM));
  row.setBoundVariable('paddingRight', await V(SP_SM));
  row.setBoundVariable('itemSpacing', await V(SP_SM));
  for (const k of ['topLeftRadius','topRightRadius','bottomLeftRadius','bottomRightRadius']) row.setBoundVariable(k, await V(RAD_MD));
  row.setBoundVariable('strokeWeight', await V(BORDER_W));
  row.strokeAlign='INSIDE';

  // background: resting/current/disabled = bg-tertiary at 0 opacity (transparent), selected = faint accent fill
  if (opts.selected){
    row.fills=[figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:.5,g:.5,b:.5},opacity:0.12},'color', await V(C_ACCENT))];
    row.strokes=[figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:.5,g:.5,b:.5}},'color', await V(C_ACCENT))];
  } else if (opts.hoverFill){
    row.fills=[figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:.5,g:.5,b:.5}},'color', await V(C_TERTIARY))];
  } else {
    row.fills=[];
  }

  // current: left accent marker (a thin rule pinned to the row's start)
  if (opts.current){
    const marker = figma.createRectangle();
    marker.name='current-marker';
    marker.resize(3, 10);
    marker.fills=[figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:.5,g:.5,b:.5}},'color', await V(C_ACCENT))];
    row.appendChild(marker);
    marker.layoutSizingHorizontal='FIXED';
    marker.layoutSizingVertical='FILL';
  }

  // body text — Caveat (font/sketch), text-md, text-primary
  const t=figma.createText(); t.fontName={family:'Caveat',style:'Bold'}; t.characters=label;
  t.setBoundVariable('fontSize', await V(TXT_MD));
  t.fills=[figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:0,g:0,b:0}},'color', await V(C_TEXT))];
  row.appendChild(t);
  t.layoutSizingVertical='HUG';
  t.layoutGrow=1;          // body flexes to fill
  t.textAutoResize='HEIGHT';
  t.layoutSizingHorizontal='FILL';

  // trailing actions slot — JetBrains Mono, text-xs, text-muted (the session hash in the real /resume picker)
  if (code){
    const a=figma.createText(); a.fontName={family:'JetBrains Mono',style:'Regular'}; a.characters=code;
    a.setBoundVariable('fontSize', await V(TXT_XS));
    a.fills=[figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:0,g:0,b:0}},'color', await V(C_MUTED))];
    row.appendChild(a);
    a.layoutSizingHorizontal='HUG'; a.layoutSizingVertical='HUG';
  }

  if (opts.disabled) row.opacity=0.5;

  // FIX: resize() silently resets BOTH sizing modes to FIXED, freezing the row height.
  // Resize first, then restore the sizing modes (width FIXED, height AUTO/hug).
  row.resize(300, row.height);
  row.primaryAxisSizingMode='FIXED';
  row.counterAxisSizingMode='AUTO';
  return row;
}

const comps = [];
comps.push(await makeRow('Default', 'Resting row', null, {}));
comps.push(await makeRow('Hover', 'Hovered row', null, { hoverFill:true }));
comps.push(await makeRow('Selected', 'Selected (accent ring + fill)', null, { selected:true }));
comps.push(await makeRow('Current', "Tonight’s set", 'ef34gh', { current:true }));
comps.push(await makeRow('Disabled', 'Disabled', null, { disabled:true }));

const set = figma.combineAsVariants(comps, page);
set.name='ListRow';
set.layoutMode='VERTICAL';
set.primaryAxisSizingMode='AUTO';
set.counterAxisSizingMode='AUTO';
set.itemSpacing=24; set.paddingTop=24; set.paddingBottom=24; set.paddingLeft=24; set.paddingRight=24;
set.x = 1160; set.y = 1000;
return { ids: [set.id] };