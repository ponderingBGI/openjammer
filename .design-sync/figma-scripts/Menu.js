const page = await figma.getNodeByIdAsync('3:3'); await figma.setCurrentPageAsync(page);
await figma.loadFontAsync({ family:'Caveat', style:'Bold' });
await figma.loadFontAsync({ family:'JetBrains Mono', style:'Regular' });
await figma.loadFontAsync({ family:'Inter', style:'Semi Bold' });
const V = async (id) => await figma.variables.getVariableByIdAsync(id);
const bindRadius = async (n, id) => { for (const k of ['topLeftRadius','topRightRadius','bottomLeftRadius','bottomRightRadius']) n.setBoundVariable(k, await V(id)); };
const bindPad = async (n, t, r, b, l) => { n.setBoundVariable('paddingTop', await V(t)); n.setBoundVariable('paddingRight', await V(r)); n.setBoundVariable('paddingBottom', await V(b)); n.setBoundVariable('paddingLeft', await V(l)); };
const fillVar = async (id) => [figma.variables.setBoundVariableForPaint({ type:'SOLID', color:{ r:.1,g:.1,b:.1 } }, 'color', await V(id))];

// icon path data (24x24 viewBox, stroke 2, currentColor)
const SVG = (inner) => '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+inner+'</svg>';
const ICONS = {
  chevronRight: SVG('<polyline points="9 18 15 12 9 6"/>'),
  download: SVG('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'),
  mute: SVG('<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>'),
  bolt: SVG('<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>')
};
// build an icon node bound to a color var, sized 14x14
const makeIcon = async (key, colorId) => {
  const svg = figma.createNodeFromSvg(ICONS[key]);
  svg.name = 'icon-' + key;
  svg.resize(14, 14);
  const col = await V(colorId);
  const paint = figma.variables.setBoundVariableForPaint({ type:'SOLID', color:{ r:.1,g:.1,b:.1 } }, 'color', col);
  const recolor = (n) => { if ('strokes' in n && n.strokes && n.strokes.length) n.strokes = n.strokes.map(()=>paint); if ('fills' in n && Array.isArray(n.fills) && n.fills.length) n.fills = n.fills.map(()=>paint); if ('children' in n) n.children.forEach(recolor); };
  recolor(svg);
  return svg;
};

// a Kbd keycap
const makeKbd = async (text, onAccent) => {
  const k = figma.createFrame(); k.name='Kbd'; k.layoutMode='HORIZONTAL';
  k.primaryAxisSizingMode='AUTO'; k.counterAxisSizingMode='AUTO'; k.primaryAxisAlignItems='CENTER'; k.counterAxisAlignItems='CENTER';
  await bindPad(k, 'VariableID:1:4', 'VariableID:1:5', 'VariableID:1:4', 'VariableID:1:5'); // xs / sm
  await bindRadius(k, 'VariableID:1:9'); // radius/sm
  k.strokeWeight = 1;
  if (onAccent) {
    k.fills = [];
    k.strokes = [figma.variables.setBoundVariableForPaint({ type:'SOLID', color:{ r:1,g:1,b:1 } }, 'color', await V('VariableID:2:12'))]; // text-on-accent
  } else {
    k.fills = await fillVar('VariableID:2:5'); // bg-tertiary
    k.strokes = [figma.variables.setBoundVariableForPaint({ type:'SOLID', color:{ r:.83,g:.81,b:.78 } }, 'color', await V('VariableID:2:13'))]; // border-subtle
  }
  const t = figma.createText(); t.fontName={ family:'JetBrains Mono', style:'Regular' }; t.characters=text;
  t.setBoundVariable('fontSize', await V('VariableID:1:14')); // text/xs
  t.fills = await fillVar(onAccent ? 'VariableID:2:12' : 'VariableID:2:10'); // text-on-accent / text-secondary
  k.appendChild(t); t.layoutSizingHorizontal='HUG'; t.layoutSizingVertical='HUG';
  return k;
};

// a menu item row. opts: {shortcut, iconKey, disabled, chevron, accent}
const makeItem = async (label, opts={}) => {
  const row = figma.createFrame(); row.name='MenuItem'; row.layoutMode='HORIZONTAL';
  row.primaryAxisSizingMode='FIXED'; row.counterAxisSizingMode='AUTO'; row.counterAxisAlignItems='CENTER';
  row.setBoundVariable('itemSpacing', await V('VariableID:1:5')); // space/sm
  await bindPad(row, 'VariableID:1:5', 'VariableID:1:6', 'VariableID:1:5', 'VariableID:1:6'); // sm / md
  const textColorId = opts.accent ? 'VariableID:2:12' : 'VariableID:2:9'; // on-accent / text-primary
  if (opts.accent) row.fills = await fillVar('VariableID:2:19'); else row.fills = [];
  if (opts.iconKey) { const ic = await makeIcon(opts.iconKey, opts.accent ? 'VariableID:2:12' : 'VariableID:2:11'); row.appendChild(ic); ic.layoutSizingHorizontal='FIXED'; ic.layoutSizingVertical='FIXED'; }
  const lbl = figma.createText(); lbl.fontName={ family:'Caveat', style:'Bold' }; lbl.characters=label;
  lbl.setBoundVariable('fontSize', await V('VariableID:1:15')); // text/sm
  lbl.fills = await fillVar(textColorId);
  if (opts.disabled) lbl.opacity = 0.5;
  row.appendChild(lbl); lbl.layoutSizingHorizontal='FILL'; lbl.layoutSizingVertical='HUG';
  if (opts.shortcut) { const kb = await makeKbd(opts.shortcut, opts.accent); row.appendChild(kb); kb.layoutSizingHorizontal='HUG'; kb.layoutSizingVertical='HUG'; if (opts.disabled) kb.opacity=0.5; }
  if (opts.chevron) { const ch = await makeIcon('chevronRight', opts.accent ? 'VariableID:2:12' : 'VariableID:2:11'); row.appendChild(ch); ch.layoutSizingHorizontal='FIXED'; ch.layoutSizingVertical='FIXED'; }
  if (opts.disabled && !opts.shortcut) lbl.opacity = 0.5;
  return row;
};

// a category header
const makeCategory = async (label, iconKey) => {
  const cat = figma.createFrame(); cat.name='MenuCategory'; cat.layoutMode='HORIZONTAL';
  cat.primaryAxisSizingMode='FIXED'; cat.counterAxisSizingMode='AUTO'; cat.counterAxisAlignItems='CENTER';
  cat.setBoundVariable('itemSpacing', await V('VariableID:1:4')); // space/xs
  await bindPad(cat, 'VariableID:1:4', 'VariableID:1:6', 'VariableID:1:4', 'VariableID:1:6'); // xs / md
  cat.fills = [];
  if (iconKey) { const ic = await makeIcon(iconKey, 'VariableID:2:11'); cat.appendChild(ic); ic.layoutSizingHorizontal='FIXED'; ic.layoutSizingVertical='FIXED'; }
  const t = figma.createText(); t.fontName={ family:'Inter', style:'Semi Bold' }; t.characters=label.toUpperCase();
  t.setBoundVariable('fontSize', await V('VariableID:1:14')); // text/xs
  t.letterSpacing = { unit:'PERCENT', value:4 };
  t.fills = await fillVar('VariableID:2:11'); // text-muted
  cat.appendChild(t); t.layoutSizingHorizontal='FILL'; t.layoutSizingVertical='HUG';
  return cat;
};

// a separator
const makeSeparator = async () => {
  const wrap = figma.createFrame(); wrap.name='MenuSeparator'; wrap.layoutMode='VERTICAL';
  wrap.primaryAxisSizingMode='AUTO'; wrap.counterAxisSizingMode='FIXED'; wrap.fills=[];
  await bindPad(wrap, 'VariableID:1:4', 'VariableID:1:5', 'VariableID:1:4', 'VariableID:1:5'); // xs vert / sm horiz
  const rule = figma.createFrame(); rule.name='rule'; rule.fills = await fillVar('VariableID:2:13'); // border-subtle
  rule.resize(100, 1);
  wrap.appendChild(rule); rule.layoutSizingHorizontal='FILL'; rule.layoutSizingVertical='FIXED';
  return wrap;
};

// the Surface panel shell
const makePanel = async (name, width) => {
  const p = figma.createComponent(); p.name=name; p.layoutMode='VERTICAL';
  p.primaryAxisSizingMode='AUTO'; p.counterAxisSizingMode='FIXED'; p.itemSpacing=0;
  await bindPad(p, 'VariableID:1:4', 'VariableID:1:1', 'VariableID:1:4', 'VariableID:1:1'); // xs vert / 1:1 horiz — all four bound
  p.fills = await fillVar('VariableID:2:4'); // bg-node
  p.strokes = [figma.variables.setBoundVariableForPaint({ type:'SOLID', color:{ r:.1,g:.1,b:.1 } }, 'color', await V('VariableID:2:16'))]; // sketch-black
  p.setBoundVariable('strokeWeight', await V('VariableID:1:24')); // border/sketch-width
  await bindRadius(p, 'VariableID:1:10'); // radius/md
  p.effects = [{ type:'DROP_SHADOW', color:{ r:0,g:0,b:0,a:0.15 }, offset:{ x:3, y:4 }, radius:0, spread:0, visible:true, blendMode:'NORMAL' }];
  p.resize(width, p.height);
  return p;
};

// VARIANT 1 — Dropdown (toolbar File menu)
const dd = await makePanel('Type=Dropdown', 240);
const addAll = async (panel, rows) => { for (const r of rows) { panel.appendChild(r); r.layoutSizingHorizontal='FILL'; if (r.name==='MenuSeparator') r.layoutSizingVertical='HUG'; else r.layoutSizingVertical='HUG'; } };
await addAll(dd, [
  await makeItem('New Patch', { shortcut:'Ctrl N' }),
  await makeItem('Open…', { shortcut:'Ctrl O' }),
  await makeItem('Save', { shortcut:'Ctrl S', accent:true }),
  await makeItem('Export as', { chevron:true }),
  await makeSeparator(),
  await makeItem('Close', { shortcut:'Ctrl W', disabled:true }),
]);

// VARIANT 2 — Context (Add node menu with categories)
const cm = await makePanel('Type=Context', 260);
await addAll(cm, [
  await makeCategory('Instruments', 'bolt'),
  await makeItem('Synth', {}),
  await makeItem('Sampler', {}),
  await makeSeparator(),
  await makeCategory('Effects', 'mute'),
  await makeItem('Reverb', {}),
  await makeItem('Delay', { shortcut:'D' }),
  await makeSeparator(),
  await makeItem('Cancel', {}),
]);

const set = figma.combineAsVariants([dd, cm], page);
set.name = 'Menu';
set.layoutMode = 'HORIZONTAL'; set.primaryAxisSizingMode='AUTO'; set.counterAxisSizingMode='AUTO'; set.counterAxisAlignItems='MIN';
set.itemSpacing = 48; set.paddingTop = 24; set.paddingBottom = 24; set.paddingLeft = 24; set.paddingRight = 24;
set.fills = [];
set.x = 80; set.y = 800;
return { ids: [set.id] };