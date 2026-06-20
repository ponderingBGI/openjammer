const page = await figma.getNodeByIdAsync('3:3'); await figma.setCurrentPageAsync(page);
// FIX 1: load Caveat (the only allowed family), both required styles, before any text is created.
await figma.loadFontAsync({ family:'Caveat', style:'Regular' });
await figma.loadFontAsync({ family:'Caveat', style:'Bold' });
const CAPTION_FONT = { family:'Caveat', style:'Regular' };
const V = async (id) => await figma.variables.getVariableByIdAsync(id);

// --- token ids ---
const SPACE_SM='VariableID:1:5', SPACE_XS='VariableID:1:4', RADIUS_MD='VariableID:1:10';
const TEXT_XS='VariableID:1:14', FONT_MONO='VariableID:1:33', BORDER_W='VariableID:1:24';
const BG_NODE='VariableID:2:4', BORDER_SUBTLE='VariableID:2:13', TEXT_MUTED='VariableID:2:11';
const AUDIO_OUTPUT='VariableID:2:25', ACCENT_DANGER='VariableID:2:23', ACCENT_PRIMARY='VariableID:2:19';

// --- geometry of the SVG trace (mirrors Waveform.tsx buildPoints on the preview's bipolar buffer) ---
const VIEW_W=1000, VIEW_H=100, CENTER_Y=50;
const N=128;
const data = Array.from({length:N}, (_,i)=>{ const t=i/(N-1); return Math.sin(t*Math.PI*12)*(1-t*0.7); });
const step = VIEW_W/(N-1);
const round = (v)=> Math.round(v*100)/100;
const pts = [];
for (let i=0;i<N;i++){ const x=i*step; const c=Math.min(Math.max(data[i],-1),1); const y=CENTER_Y-c*CENTER_Y; pts.push(round(x)+','+round(y)); }
const points = pts.join(' ');

const SVG_W=336, SVG_H=48; // 360 frame - 2*space-sm(12) padding ≈ 336 wide; default height 48

// Build one variant component. `state` in {'default','playing','recording'}
async function makeVariant(state){
  const c = figma.createComponent();
  c.name = 'State=' + state;
  // outer realistic preview frame: bg-node card, subtle sketch border, radius-md, space-sm padding
  c.layoutMode='VERTICAL'; c.primaryAxisSizingMode='AUTO'; c.counterAxisSizingMode='FIXED';
  c.counterAxisAlignItems='MIN'; c.itemSpacing=0;
  c.resize(360, c.height);
  c.setBoundVariable('paddingTop', await V(SPACE_SM));
  c.setBoundVariable('paddingBottom', await V(SPACE_SM));
  c.setBoundVariable('paddingLeft', await V(SPACE_SM));
  c.setBoundVariable('paddingRight', await V(SPACE_SM));
  for (const k of ['topLeftRadius','topRightRadius','bottomLeftRadius','bottomRightRadius']) c.setBoundVariable(k, await V(RADIUS_MD));
  c.fills=[figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:.16,g:.16,b:.16}},'color', await V(BG_NODE))];
  c.strokes=[figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:.5,g:.5,b:.5}},'color', await V(BORDER_SUBTLE))];
  c.setBoundVariable('strokeWeight', await V(BORDER_W));

  // tiny caption (matches preview frame label) — Caveat Regular only
  const cap = figma.createText();
  cap.fontName=CAPTION_FONT;
  cap.characters = state==='recording' ? 'recording' : state==='playing' ? 'playing · playhead 0.4' : 'bipolar buffer';
  cap.setBoundVariable('fontSize', await V(TEXT_XS));
  cap.fills=[figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:.6,g:.6,b:.6}},'color', await V(TEXT_MUTED))];
  c.appendChild(cap); cap.layoutSizingHorizontal='HUG'; cap.layoutSizingVertical='HUG';

  // spacer gap below caption (space-xs)
  const spacer = figma.createFrame();
  spacer.name='gap'; spacer.fills=[]; spacer.resize(1,4);
  c.appendChild(spacer); spacer.layoutSizingHorizontal='HUG';
  spacer.setBoundVariable('height', await V(SPACE_XS));

  // the waveform SVG itself.
  // FIX 2: use SVG id="" (which createNodeFromSvg maps to the node name) instead of class=""
  // (class attributes are dropped on import, so the old name match never fired and every
  // stroke fell through to the AUDIO_OUTPUT fallback — wrong semantic tokens).
  const traceId = state==='recording' ? 'id="r"' : 'id="o"';
  let svg = '<svg width="'+SVG_W+'" height="'+SVG_H+'" viewBox="0 0 '+VIEW_W+' '+VIEW_H+'" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">';
  // center line (subtle hairline) — shown on default + playing (preview uses showCenterLine there)
  if (state!=='recording') svg += '<line id="c" x1="0" y1="'+CENTER_Y+'" x2="'+VIEW_W+'" y2="'+CENTER_Y+'" stroke="#888" stroke-width="1"/>';
  svg += '<polyline '+traceId+' fill="none" stroke="#3b82f6" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" points="'+points+'"/>';
  if (state==='playing') svg += '<line id="p" x1="'+(0.4*VIEW_W)+'" y1="0" x2="'+(0.4*VIEW_W)+'" y2="'+VIEW_H+'" stroke="#22c55e" stroke-width="1"/>';
  svg += '</svg>';

  const node = figma.createNodeFromSvg(svg);
  node.name = 'oj-waveform';
  // bind stroke colors of children to semantic tokens.
  // Use findAll so nested/grouped SVG output is still covered (not just direct children).
  const stroked = node.findAll(n => Array.isArray(n.strokes) && n.strokes.length > 0);
  for (const child of stroked) {
    let id;
    if (child.name==='r') id = ACCENT_DANGER;
    else if (child.name==='o') id = AUDIO_OUTPUT;
    else if (child.name==='c') id = BORDER_SUBTLE;
    else if (child.name==='p') id = ACCENT_PRIMARY;
    // fallback by stroke heuristics if name lost
    if (!id) id = AUDIO_OUTPUT;
    const stk = JSON.parse(JSON.stringify(child.strokes[0]));
    child.strokes=[figma.variables.setBoundVariableForPaint(stk,'color', await V(id))];
  }
  c.appendChild(node);
  node.layoutSizingHorizontal='FILL';
  // keep the SVG's drawn height
  node.layoutSizingVertical='FIXED';
  node.resize(node.width, SVG_H);
  return c;
}

const cDefault = await makeVariant('default');
const cPlaying = await makeVariant('playing');
const cRecording = await makeVariant('recording');

const set = figma.combineAsVariants([cDefault, cPlaying, cRecording], page);
set.name='Waveform';
set.layoutMode='VERTICAL'; set.primaryAxisSizingMode='AUTO'; set.counterAxisSizingMode='AUTO';
set.itemSpacing=16; set.paddingTop=16; set.paddingBottom=16; set.paddingLeft=16; set.paddingRight=16;
set.x = 440; set.y = 320;

return { ids: [set.id] };