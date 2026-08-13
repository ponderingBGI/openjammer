const page = await figma.getNodeByIdAsync('3:3'); await figma.setCurrentPageAsync(page);
await figma.loadFontAsync({ family:'Caveat', style:'Regular' });
await figma.loadFontAsync({ family:'JetBrains Mono', style:'Regular' });
const V = async (id) => await figma.variables.getVariableByIdAsync(id);

// VARMAP refs used
const SPACE_XS='VariableID:1:4', SPACE_SM='VariableID:1:5', SPACE_MD='VariableID:1:6';
const RADIUS_SM='VariableID:1:9', RADIUS_MD='VariableID:1:10';
const TEXT_XS='VariableID:1:14', TEXT_SM='VariableID:1:15';
const FONT_SKETCH='VariableID:1:31', FONT_MONO='VariableID:1:33';
const BORDER_SKETCH_W='VariableID:1:24';
const BG_NODE='VariableID:2:4', BG_CANVAS='VariableID:2:6';
const TEXT_SECONDARY='VariableID:2:10', TEXT_MUTED='VariableID:2:11';
const BORDER_SUBTLE='VariableID:2:13', BORDER_SKETCH='VariableID:2:15', SKETCH_BLACK='VariableID:2:16';
const ACCENT_WARNING='VariableID:2:22', ACCENT_SUCCESS='VariableID:2:21';
const AUDIO_OUTPUT='VariableID:2:25', AUDIO_CONNECTED='VariableID:2:27';

const CARD_W = 160;

// A few cycles of a damped sine — mirrors the preview PEAKS (length 64, bipolar).
const N = 64;
const peaks = [];
for (let i=0;i<N;i++){ const t=i/(N-1); peaks.push(Math.sin(t*Math.PI*6)*(1-t)*0.9); }

// Build a single WaveformView component for a given state.
async function buildCard(stateName, opts){
  const c = figma.createComponent();
  c.name = stateName;
  c.layoutMode='VERTICAL';
  c.primaryAxisSizingMode='AUTO';
  c.counterAxisSizingMode='FIXED';
  c.clipsContent = true;
  // sketch border + radius
  c.strokes=[figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:0,g:0,b:0}},'color', await V(opts.borderId))];
  c.setBoundVariable('strokeWeight', await V(BORDER_SKETCH_W));
  c.fills=[figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:0.5,g:0.5,b:0.5}},'color', await V(BG_NODE))];
  for (const k of ['topLeftRadius','topRightRadius','bottomLeftRadius','bottomRightRadius']) c.setBoundVariable(k, await V(RADIUS_MD));
  // hard sketch shadow: 2px 2px 0 sketch-black (Hard-Shadow Rule), or the hard accent ring for selected/drop states
  c.effects=[ { type:'DROP_SHADOW', color:{r:0,g:0,b:0,a:1}, offset:{x:2,y:2}, radius:0, spread:0, visible:true, blendMode:'NORMAL', boundVariables:{ color: { type:'VARIABLE_ALIAS', id: SKETCH_BLACK } } } ];

  // ---- preview region (waveform on canvas tone) ----
  const preview = figma.createFrame();
  preview.name='preview';
  preview.layoutMode='HORIZONTAL';
  preview.primaryAxisSizingMode='FIXED';
  preview.counterAxisSizingMode='FIXED';
  preview.clipsContent=true;
  preview.fills=[figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:0.5,g:0.5,b:0.5}},'color', await V(BG_CANVAS))];
  for (const k of ['paddingTop','paddingBottom','paddingLeft','paddingRight']) preview.setBoundVariable(k, await V(SPACE_XS));
  c.appendChild(preview);
  preview.layoutSizingHorizontal='FILL';
  preview.resize(preview.width, 52);

  // inner box that holds the absolute-positioned svg + badges
  const traceBox = figma.createFrame();
  traceBox.name='trace';
  traceBox.fills=[];
  traceBox.clipsContent=false;
  preview.appendChild(traceBox);
  traceBox.layoutSizingHorizontal='FILL';
  traceBox.layoutSizingVertical='FILL';

  const tw = Math.max(10, CARD_W - 4 - 8); // card minus border minus xs padding both sides (approx)
  const th = 40;

  // build the bipolar polyline svg matching Waveform.tsx geometry
  const VW=tw, VH=th, CY=VH/2;
  let pts='';
  for (let i=0;i<N;i++){ const x=(i/(N-1))*VW; const cl=Math.max(-1,Math.min(1,peaks[i])); const y=CY - cl*CY; pts+=(i?' ':'')+x.toFixed(2)+','+y.toFixed(2); }
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="'+tw+'" height="'+th+'" viewBox="0 0 '+VW+' '+VH+'">'
    + '<line x1="0" y1="'+CY+'" x2="'+VW+'" y2="'+CY+'" stroke="#D9D4C8" stroke-width="1"/>'
    + '<polyline fill="none" stroke="#3B82F6" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" points="'+pts+'"/>'
    + '</svg>';
  const traceNode = figma.createNodeFromSvg(svg);
  traceNode.name='waveform';
  traceBox.appendChild(traceNode);
  traceNode.x=0; traceNode.y=(th-traceNode.height)/2;
  // rebind trace stroke -> audio-output, center line -> border-subtle
  const audioOut = await V(AUDIO_OUTPUT);
  const subtle = await V(BORDER_SUBTLE);
  for (const child of traceNode.findAll(()=>true)){
    if (child.type==='VECTOR' || child.type==='LINE'){
      if (child.strokes && child.strokes.length){
        const s = child.strokes[0];
        // first stroked geometry is the polyline (blue), the line is the center axis
        const isCenter = (s && s.color && Math.round(s.color.r*255)===217);
        const target = isCenter ? subtle : audioOut;
        child.strokes=[figma.variables.setBoundVariableForPaint({type:'SOLID',color:s.color},'color', target)];
      }
    }
  }

  // duration badge (mono) top-right, absolute
  const dur = figma.createText();
  dur.fontName={family:'JetBrains Mono',style:'Regular'};
  dur.characters=opts.duration;
  dur.setBoundVariable('fontSize', await V(TEXT_XS));
  dur.fills=[figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:0,g:0,b:0}},'color', await V(TEXT_MUTED))];
  const durBg = figma.createFrame();
  durBg.name='duration';
  durBg.layoutMode='HORIZONTAL';
  durBg.primaryAxisSizingMode='AUTO';
  durBg.counterAxisSizingMode='AUTO';
  durBg.setBoundVariable('paddingLeft', await V(SPACE_XS));
  durBg.setBoundVariable('paddingRight', await V(SPACE_XS));
  durBg.fills=[figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:0.5,g:0.5,b:0.5}},'color', await V(BG_NODE))];
  for (const k of ['topLeftRadius','topRightRadius','bottomLeftRadius','bottomRightRadius']) durBg.setBoundVariable(k, await V(RADIUS_SM));
  durBg.appendChild(dur); dur.layoutSizingHorizontal='HUG'; dur.layoutSizingVertical='HUG';
  traceBox.appendChild(durBg);
  durBg.layoutPositioning='ABSOLUTE';
  durBg.x = th>0 ? (tw - durBg.width - 1) : 0;
  durBg.y = 0;

  // crop marker bottom-left, absolute (warning glyph)
  if (opts.cropped){
    const crop = figma.createText();
    crop.fontName={family:'JetBrains Mono',style:'Regular'};
    crop.characters='⟩⟨';
    crop.setBoundVariable('fontSize', await V(TEXT_XS));
    crop.fills=[figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:0,g:0,b:0}},'color', await V(ACCENT_WARNING))];
    traceBox.appendChild(crop);
    crop.layoutPositioning='ABSOLUTE';
    crop.x=0; crop.y=th-crop.height;
  }

  // ---- name region (Caveat, truncated, top border) ----
  const nameWrap = figma.createFrame();
  nameWrap.name='name';
  nameWrap.layoutMode='HORIZONTAL';
  nameWrap.primaryAxisSizingMode='FIXED';
  nameWrap.counterAxisSizingMode='AUTO';
  nameWrap.primaryAxisAlignItems='CENTER';
  nameWrap.counterAxisAlignItems='CENTER';
  nameWrap.clipsContent=true;
  nameWrap.fills=[];
  nameWrap.setBoundVariable('paddingTop', await V(SPACE_XS));
  nameWrap.setBoundVariable('paddingBottom', await V(SPACE_XS));
  nameWrap.setBoundVariable('paddingLeft', await V(SPACE_SM));
  nameWrap.setBoundVariable('paddingRight', await V(SPACE_SM));
  nameWrap.strokes=[figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:0,g:0,b:0}},'color', await V(BORDER_SUBTLE))];
  nameWrap.strokeWeight=1;
  nameWrap.strokeTopWeight=1; nameWrap.strokeBottomWeight=0; nameWrap.strokeLeftWeight=0; nameWrap.strokeRightWeight=0;
  c.appendChild(nameWrap);
  nameWrap.layoutSizingHorizontal='FILL';

  const nameTxt = figma.createText();
  nameTxt.fontName={family:'Caveat',style:'Regular'};
  // FIX: leave the default WIDTH_AND_HEIGHT and the node hugs to content, so
  // layoutSizingHorizontal='FILL' is ignored and textTruncation never engages.
  // Switch to single-line/height-resize BEFORE assigning characters + FILL.
  nameTxt.textAutoResize='HEIGHT';
  nameTxt.characters=opts.name;
  nameTxt.setBoundVariable('fontSize', await V(TEXT_SM));
  nameTxt.textAlignHorizontal='CENTER';
  nameTxt.fills=[figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:0,g:0,b:0}},'color', await V(opts.nameColorId))];
  nameWrap.appendChild(nameTxt);
  nameTxt.layoutSizingHorizontal='FILL';
  nameTxt.layoutSizingVertical='HUG';
  nameTxt.textTruncation='ENDING';

  // size the whole card
  c.resize(CARD_W, c.height);
  // FIX: resize() resets BOTH sizing modes to FIXED, which clobbers the intended
  // vertical hug. Re-assert it so each card hugs its content height.
  c.primaryAxisSizingMode='AUTO';
  if (opts.opacity!=null) c.opacity=opts.opacity;
  return c;
}

const cDefault = await buildCard('State=Default', { duration:'2.4s', name:'kick_loop.wav', borderId:BORDER_SKETCH, nameColorId:TEXT_SECONDARY });
const cSelected = await buildCard('State=Selected', { duration:'2.4s', name:'snare_roll.wav', borderId:AUDIO_CONNECTED, nameColorId:AUDIO_CONNECTED });
const cDrop = await buildCard('State=DropTarget', { duration:'0.8s', name:'vocal_chop.wav', borderId:ACCENT_SUCCESS, nameColorId:TEXT_SECONDARY });
const cDrag = await buildCard('State=Dragging', { duration:'2.4s', name:'hat_loop.wav', borderId:BORDER_SKETCH, nameColorId:TEXT_SECONDARY, opacity:0.6 });
const cCropped = await buildCard('State=Cropped', { duration:'1.1s', name:'a_very_long_sample_name_here.wav', borderId:BORDER_SKETCH, nameColorId:TEXT_SECONDARY, cropped:true });

// Selected/DropTarget carry a hard 0-blur accent ring (box-shadow 0 0 0 2px) on top of the sketch shadow.
cSelected.effects=[
  { type:'DROP_SHADOW', color:{r:0,g:0,b:0,a:1}, offset:{x:2,y:2}, radius:0, spread:0, visible:true, blendMode:'NORMAL', boundVariables:{ color:{ type:'VARIABLE_ALIAS', id: SKETCH_BLACK } } },
  { type:'DROP_SHADOW', color:{r:0,g:0,b:0,a:1}, offset:{x:0,y:0}, radius:0, spread:2, visible:true, blendMode:'NORMAL', boundVariables:{ color:{ type:'VARIABLE_ALIAS', id: AUDIO_CONNECTED } } }
];
cDrop.effects=[
  { type:'DROP_SHADOW', color:{r:0,g:0,b:0,a:1}, offset:{x:2,y:2}, radius:0, spread:0, visible:true, blendMode:'NORMAL', boundVariables:{ color:{ type:'VARIABLE_ALIAS', id: SKETCH_BLACK } } },
  { type:'DROP_SHADOW', color:{r:0,g:0,b:0,a:1}, offset:{x:0,y:0}, radius:0, spread:2, visible:true, blendMode:'NORMAL', boundVariables:{ color:{ type:'VARIABLE_ALIAS', id: ACCENT_SUCCESS } } }
];

const comps=[cDefault,cSelected,cDrop,cDrag,cCropped];
const set = figma.combineAsVariants(comps, page);
set.name='WaveformView';
set.layoutMode='HORIZONTAL';
set.primaryAxisSizingMode='AUTO';
set.counterAxisSizingMode='AUTO';
set.counterAxisAlignItems='MIN';
set.itemSpacing=24;
set.paddingTop=24; set.paddingBottom=24; set.paddingLeft=24; set.paddingRight=24;
set.x=800; set.y=320;
return { ids: [set.id] };