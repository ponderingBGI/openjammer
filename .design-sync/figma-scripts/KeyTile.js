const page = await figma.getNodeByIdAsync('3:3'); await figma.setCurrentPageAsync(page);
await figma.loadFontAsync({ family:'Caveat', style:'Bold' });
const V = async (id) => await figma.variables.getVariableByIdAsync(id);

// shared variable ids
const spaceXs='VariableID:1:4', spaceSm='VariableID:1:5', radiusSm='VariableID:1:9', radiusLg='VariableID:1:11';
const textSm='VariableID:1:15', fontSketch='VariableID:1:31', sketchWidth='VariableID:1:24';
const sketchBlack='VariableID:2:16', bgNode='VariableID:2:4', bgTertiary='VariableID:2:5';
const bgCanvas='VariableID:2:6', textPrimary='VariableID:2:9', textOnAccent='VariableID:2:12';
const controlOutput='VariableID:2:29';

// build one KeyTile variant. opts: {name,w,h,bgId,labelColorId,radiusTopId,radiusBotId,label,centerLabel}
async function makeTile(o){
  const c = figma.createComponent();
  c.name = o.name;
  c.layoutMode = 'VERTICAL';
  c.primaryAxisSizingMode = 'FIXED';
  c.counterAxisSizingMode = 'FIXED';
  c.counterAxisAlignItems = 'CENTER';
  c.primaryAxisAlignItems = o.centerLabel ? 'CENTER' : 'MAX';
  // padding xs all sides
  for (const k of ['paddingTop','paddingRight','paddingBottom','paddingLeft']) c.setBoundVariable(k, await V(spaceXs));
  // radius: piano keys round only the bottom; key/pad round all corners
  c.setBoundVariable('topLeftRadius', await V(o.radiusTopId));
  c.setBoundVariable('topRightRadius', await V(o.radiusTopId));
  c.setBoundVariable('bottomLeftRadius', await V(o.radiusBotId));
  c.setBoundVariable('bottomRightRadius', await V(o.radiusBotId));
  // ink border
  c.strokes = [figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:0,g:0,b:0}},'color', await V(sketchBlack))];
  c.setBoundVariable('strokeWeight', await V(sketchWidth));
  c.strokeAlign = 'INSIDE';
  // fill
  c.fills = [figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:.5,g:.5,b:.5}},'color', await V(o.bgId))];

  // label (Caveat) anchored at the bottom (or centered)
  const t = figma.createText();
  t.fontName = {family:'Caveat',style:'Bold'};
  t.characters = o.label;
  t.textAlignHorizontal = 'CENTER';
  t.setBoundVariable('fontSize', await V(textSm));
  t.fills = [figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:0,g:0,b:0}},'color', await V(o.labelColorId))];
  c.appendChild(t);
  t.layoutSizingHorizontal = 'HUG';
  t.layoutSizingVertical = 'HUG';

  // embedded control Port — grey output dot pinned top-right (absolute)
  const port = figma.createEllipse();
  port.name = 'port';
  port.resize(16,16);
  port.fills = [figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:.5,g:.5,b:.5}},'color', await V(controlOutput))];
  port.strokes = [figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:0,g:0,b:0}},'color', await V(sketchBlack))];
  port.setBoundVariable('strokeWeight', await V(sketchWidth));
  port.strokeAlign = 'INSIDE';
  c.appendChild(port);
  port.layoutPositioning = 'ABSOLUTE';
  port.constraints = { horizontal:'MAX', vertical:'MIN' };
  port.x = o.w - 4 - 16; // space-xs inset from right
  port.y = 4;            // space-xs inset from top

  c.resize(o.w, o.h);
  return c;
}

// geometry from CSS calc() with space xs=4 sm=8 md=16 lg=24 xl=32
const white = await makeTile({ name:'variant=white', w:28, h:128, bgId:bgNode, labelColorId:textPrimary, radiusTopId:radiusSm, radiusBotId:radiusSm, label:'C', centerLabel:false });
const black = await makeTile({ name:'variant=black', w:24, h:80, bgId:sketchBlack, labelColorId:textOnAccent, radiusTopId:radiusSm, radiusBotId:radiusSm, label:'C#', centerLabel:false });
const key   = await makeTile({ name:'variant=key', w:40, h:40, bgId:bgNode, labelColorId:textPrimary, radiusTopId:radiusSm, radiusBotId:radiusSm, label:'A', centerLabel:true });
const pad   = await makeTile({ name:'variant=pad', w:64, h:64, bgId:bgTertiary, labelColorId:textPrimary, radiusTopId:radiusLg, radiusBotId:radiusLg, label:'Kick', centerLabel:true });

// black key has only bottom radius (top sharp) — override top corners to 0
black.topLeftRadius = 0; black.topRightRadius = 0;
white.topLeftRadius = 0; white.topRightRadius = 0;

const set = figma.combineAsVariants([white, black, key, pad], page);
set.name = 'KeyTile';
set.layoutMode = 'HORIZONTAL';
set.itemSpacing = 24;
set.counterAxisAlignItems = 'MAX';
set.primaryAxisSizingMode = 'AUTO';
set.counterAxisSizingMode = 'AUTO';
for (const k of ['paddingTop','paddingRight','paddingBottom','paddingLeft']) set.setBoundVariable(k, await V('VariableID:1:7'));
set.fills = [figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:1,g:1,b:1}},'color', await V(bgCanvas))];
set.x = 1520; set.y = 80;
return { ids: [set.id] };