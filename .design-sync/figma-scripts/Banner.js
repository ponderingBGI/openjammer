const page = await figma.getNodeByIdAsync('3:3'); await figma.setCurrentPageAsync(page);
await figma.loadFontAsync({ family:'Caveat', style:'Bold' });
await figma.loadFontAsync({ family:'Caveat', style:'Regular' });
const V = async (id) => await figma.variables.getVariableByIdAsync(id);

// shared variable ids
const fillBg='VariableID:2:4', sketchBlack='VariableID:2:16', strokeW='VariableID:1:24';
const radLg=['VariableID:1:11'], padMd='VariableID:1:6', gapMd='VariableID:1:6';
const spaceXs='VariableID:1:4', textXl='VariableID:1:18';
const fontSketch='VariableID:1:31', fontSans='VariableID:1:32';
const textMd='VariableID:1:16', textSm='VariableID:1:15';
const textPrimary='VariableID:2:9', textSecondary='VariableID:2:10';
const warningPath='M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z M12 9 L12 13 M12 17 L12.01 17';

const tones = [
  { name:'warning', accent:'VariableID:2:22', title:'Audio latency is climbing',         message:'Your round-trip is in the ~25ms range — playable, but you may feel it.' },
  { name:'danger',  accent:'VariableID:2:23', title:'High Audio Latency Detected',        message:'Your audio latency may affect live playing experience.' },
  { name:'info',    accent:'VariableID:2:26', title:'A new audio interface is available',  message:'Plugging in a USB interface usually drops your round-trip latency.' },
];

const comps = [];
for (const tone of tones) {
  const c = figma.createComponent();
  c.name = `tone=${tone.name}`;
  c.layoutMode='HORIZONTAL';
  c.primaryAxisSizingMode='FIXED';
  c.counterAxisSizingMode='AUTO';
  c.counterAxisAlignItems='CENTER';
  // padding + gap (left padding handled by accent bar gap; keep uniform md)
  for (const k of ['paddingTop','paddingBottom','paddingLeft','paddingRight']) c.setBoundVariable(k, await V(padMd));
  c.setBoundVariable('itemSpacing', await V(gapMd));
  for (const k of ['topLeftRadius','topRightRadius','bottomLeftRadius','bottomRightRadius']) c.setBoundVariable(k, await V(radLg[0]));
  // Surface: node fill + 2px ink border (hard shadow approximated via drop shadow in ink)
  c.fills=[figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:1,g:1,b:1}},'color', await V(fillBg))];
  c.strokes=[figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:0,g:0,b:0}},'color', await V(sketchBlack))];
  c.strokeWeight=2; c.setBoundVariable('strokeWeight', await V(strokeW));
  c.effects=[{ type:'DROP_SHADOW', color:{r:0,g:0,b:0,a:1}, offset:{x:3,y:4}, radius:0, spread:0, visible:true, blendMode:'NORMAL' }];

  // Left accent bar (Signal-Not-Brand: accent only on left edge + icon)
  const bar = figma.createRectangle();
  bar.name='accent';
  bar.resize(4, 10);
  bar.fills=[figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:.5,g:.5,b:.5}},'color', await V(tone.accent))];
  bar.setBoundVariable('width', await V(spaceXs));
  c.appendChild(bar);
  bar.layoutSizingHorizontal='FIXED'; bar.layoutSizingVertical='FILL';

  // Icon — tinted with the tone accent
  const svg = figma.createNodeFromSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${warningPath}"/></svg>`);
  svg.name='icon';
  // wrap icon in a fixed-size frame bound to text-xl
  const iconFrame = figma.createFrame();
  iconFrame.name='icon';
  iconFrame.layoutMode='HORIZONTAL'; iconFrame.primaryAxisAlignItems='CENTER'; iconFrame.counterAxisAlignItems='CENTER';
  iconFrame.primaryAxisSizingMode='FIXED'; iconFrame.counterAxisSizingMode='FIXED';
  iconFrame.fills=[];
  iconFrame.resize(20,20);
  iconFrame.setBoundVariable('width', await V(textXl)); iconFrame.setBoundVariable('height', await V(textXl));
  // tint every vector in the svg with the accent
  const tint = figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:.5,g:.5,b:.5}},'color', await V(tone.accent));
  const applyTint = (n)=>{ if('strokes' in n && n.strokes && n.strokes.length){ n.strokes=[tint]; } if('children' in n){ for(const ch of n.children) applyTint(ch);} };
  applyTint(svg);
  svg.resize(20,20);
  iconFrame.appendChild(svg);
  svg.constraints={horizontal:'SCALE',vertical:'SCALE'};
  c.appendChild(iconFrame);
  iconFrame.layoutSizingHorizontal='FIXED'; iconFrame.layoutSizingVertical='FIXED';

  // Body (vertical) — title + message
  const body = figma.createFrame();
  body.name='body'; body.layoutMode='VERTICAL'; body.primaryAxisSizingMode='AUTO'; body.counterAxisSizingMode='AUTO';
  body.fills=[]; body.itemSpacing=4; body.setBoundVariable('itemSpacing', await V(spaceXs));
  c.appendChild(body);
  body.layoutSizingHorizontal='FILL'; body.layoutSizingVertical='HUG';

  const title=figma.createText(); title.fontName={family:'Caveat',style:'Bold'}; title.characters=tone.title;
  title.setBoundVariable('fontSize', await V(textMd));
  title.fills=[figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:0,g:0,b:0}},'color', await V(textPrimary))];
  body.appendChild(title); title.layoutSizingHorizontal='FILL'; title.layoutSizingVertical='HUG';

  const msg=figma.createText(); msg.fontName={family:'Caveat',style:'Regular'}; msg.characters=tone.message;
  msg.setBoundVariable('fontSize', await V(textSm));
  msg.fills=[figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:0,g:0,b:0}},'color', await V(textSecondary))];
  msg.lineHeight={value:150,unit:'PERCENT'};
  body.appendChild(msg); msg.layoutSizingHorizontal='FILL'; msg.layoutSizingVertical='HUG';

  c.resize(520, c.height);
  comps.push(c);
}

const set = figma.combineAsVariants(comps, page);
set.name='Banner';
set.layoutMode='VERTICAL'; set.primaryAxisSizingMode='AUTO'; set.counterAxisSizingMode='AUTO'; set.itemSpacing=24; set.paddingTop=24; set.paddingBottom=24; set.paddingLeft=24; set.paddingRight=24;
set.x=800; set.y=560;
return { ids: [set.id] };