const page = await figma.getNodeByIdAsync('3:2'); await figma.setCurrentPageAsync(page);
await figma.loadFontAsync({ family:'Caveat', style:'Bold' });
const V = async (id) => await figma.variables.getVariableByIdAsync(id);

// Container: pill-shaped inline-flex row, sketch-black border, bg-node bg, overflow hidden
const c = figma.createComponent(); c.name='SegmentedControl';
c.layoutMode='HORIZONTAL';
c.primaryAxisSizingMode='AUTO'; c.counterAxisSizingMode='AUTO';
c.counterAxisAlignItems='CENTER';
c.itemSpacing = 0;
c.paddingTop=0; c.paddingBottom=0; c.paddingLeft=0; c.paddingRight=0;
c.clipsContent = true;
for (const k of ['topLeftRadius','topRightRadius','bottomLeftRadius','bottomRightRadius']) c.setBoundVariable(k, await V('VariableID:1:13'));
c.fills=[figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:.95,g:.95,b:.92}},'color', await V('VariableID:2:4'))];
c.strokes=[figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:0,g:0,b:0}},'color', await V('VariableID:2:16'))];
c.setBoundVariable('strokeWeight', await V('VariableID:1:24'));
c.strokeAlign='INSIDE';

// Segment factory: padding xs (vertical) / lg (horizontal), Caveat sm, no own border/radius
const segments = [
  { label:'Stable', active:true },
  { label:'Beta', active:false },
  { label:'Nightly', active:false },
];

for (let i=0; i<segments.length; i++) {
  const seg = segments[i];
  const b = figma.createFrame();
  b.name = seg.active ? 'Segment/active' : 'Segment';
  b.layoutMode='HORIZONTAL';
  b.primaryAxisSizingMode='AUTO'; b.counterAxisSizingMode='AUTO';
  b.primaryAxisAlignItems='CENTER'; b.counterAxisAlignItems='CENTER';
  b.itemSpacing = 0;
  b.setBoundVariable('paddingTop', await V('VariableID:1:4'));
  b.setBoundVariable('paddingBottom', await V('VariableID:1:4'));
  b.setBoundVariable('paddingLeft', await V('VariableID:1:7'));
  b.setBoundVariable('paddingRight', await V('VariableID:1:7'));
  for (const k of ['topLeftRadius','topRightRadius','bottomLeftRadius','bottomRightRadius']) b[k]=0;
  if (seg.active) {
    // active pill inks with accent-primary fill
    b.fills=[figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:.2,g:.4,b:.9}},'color', await V('VariableID:2:19'))];
  } else {
    b.fills=[];
  }
  // Hairline divider between adjacent segments: left border via border-subtle on segments after first.
  // Weight is bound to the stroke-weight variable on the LEFT side specifically
  // (uniform strokeWeight is overridden by per-side weights, so bind the per-side field directly).
  if (i > 0) {
    b.strokes=[figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:.8,g:.8,b:.78}},'color', await V('VariableID:2:13'))];
    b.strokeAlign='CENTER';
    b.strokeTopWeight = 0; b.strokeRightWeight = 0; b.strokeBottomWeight = 0;
    b.setBoundVariable('strokeLeftWeight', await V('VariableID:1:24'));
  } else {
    b.strokes=[];
  }

  const t=figma.createText();
  t.fontName={family:'Caveat',style:'Bold'};
  t.characters=seg.label;
  t.setBoundVariable('fontSize', await V('VariableID:1:15'));
  if (seg.active) {
    // text-on-accent
    t.fills=[figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:1,g:1,b:1}},'color', await V('VariableID:2:12'))];
  } else {
    // text-secondary
    t.fills=[figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:.4,g:.4,b:.4}},'color', await V('VariableID:2:10'))];
  }
  b.appendChild(t);
  t.layoutSizingHorizontal='HUG'; t.layoutSizingVertical='HUG';

  c.appendChild(b);
  b.layoutSizingHorizontal='HUG'; b.layoutSizingVertical='HUG';
}

c.x = 80; c.y = 1000;
return { ids: [c.id] };