const page = await figma.getNodeByIdAsync('3:3'); await figma.setCurrentPageAsync(page);
// Load BOTH Caveat weights up front: the text node is set to Caveat Bold explicitly,
// but it ALSO binds `fontFamily` to the font/sketch variable, and binding a
// FONT_FAMILY variable requires every font value the variable can resolve to
// (across all modes) to already be loaded — font/sketch can resolve to Caveat
// Regular. Loading only Bold throws "Cannot write to node with unloaded font".
await Promise.all([
    figma.loadFontAsync({ family:'Caveat', style:'Regular' }),
    figma.loadFontAsync({ family:'Caveat', style:'Bold' }),
]);
const V = async (id) => await figma.variables.getVariableByIdAsync(id);

// Resolve the bound color variables we need up front.
const audioConn = await V('VariableID:2:26');     // color/audio-connection (blue)
const controlConn = await V('VariableID:2:30');   // color/control-connection (grey)
const universalConn = await V('VariableID:2:33'); // color/universal-connection (violet)
const strokeW = await V('VariableID:1:24');       // border/sketch-width
const labelFont = await V('VariableID:1:31');     // font/sketch
const labelSize = await V('VariableID:1:16');     // text/md
const labelColor = await V('VariableID:2:9');     // color/text-primary
const padV = await V('VariableID:1:7');           // space/lg
const padH = await V('VariableID:1:7');           // space/lg
const gap = await V('VariableID:1:6');            // space/md
const radius = await V('VariableID:1:11');        // radius/lg
const bgFill = await V('VariableID:2:6');         // color/bg-canvas
const borderCol = await V('VariableID:2:13');     // color/border-subtle

// The S-curve a patch cable settles into (cablePath geometry: start 20,20 end 300,80,
// controlOffset capped at 100): M 20 20 C 120 20, 200 80, 300 80
const cableSvg = '<svg width="320" height="100" viewBox="0 0 320 100" xmlns="http://www.w3.org/2000/svg"><path d="M 20 20 C 120 20, 200 80, 300 80" fill="none" stroke="#000000" stroke-width="3" stroke-linecap="round"/></svg>';

function makeCableComponent(kindName, connVar) {
    const c = figma.createComponent();
    c.name = 'Kind=' + kindName;
    c.layoutMode = 'VERTICAL';
    c.primaryAxisSizingMode = 'AUTO';
    c.counterAxisSizingMode = 'AUTO';
    c.counterAxisAlignItems = 'CENTER';
    c.setBoundVariable('paddingTop', padV);
    c.setBoundVariable('paddingBottom', padV);
    c.setBoundVariable('paddingLeft', padH);
    c.setBoundVariable('paddingRight', padH);
    c.setBoundVariable('itemSpacing', gap);
    for (const k of ['topLeftRadius','topRightRadius','bottomLeftRadius','bottomRightRadius']) c.setBoundVariable(k, radius);
    c.fills = [figma.variables.setBoundVariableForPaint({ type:'SOLID', color:{ r:0.05, g:0.05, b:0.06 } }, 'color', bgFill)];
    c.strokes = [figma.variables.setBoundVariableForPaint({ type:'SOLID', color:{ r:0.5, g:0.5, b:0.5 } }, 'color', borderCol)];
    c.setBoundVariable('strokeWeight', strokeW);

    // The cable itself: an SVG bezier path. Stroke bound to the kind's wiring color.
    const wrapper = figma.createNodeFromSvg(cableSvg);
    wrapper.name = 'cable';
    // Find the vector inside and bind its stroke + width to variables.
    const vec = wrapper.findOne(n => n.type === 'VECTOR');
    if (vec) {
        vec.strokes = [figma.variables.setBoundVariableForPaint({ type:'SOLID', color:{ r:0.3, g:0.5, b:0.9 } }, 'color', connVar)];
        vec.setBoundVariable('strokeWeight', strokeW);
        vec.strokeCap = 'ROUND';
    }
    c.appendChild(wrapper);
    wrapper.layoutSizingHorizontal = 'FIXED';
    wrapper.layoutSizingVertical = 'FIXED';
    wrapper.resize(320, 100);

    // Label naming the signal type — the legend.
    const t = figma.createText();
    t.fontName = { family:'Caveat', style:'Bold' };
    t.characters = kindName;
    t.setBoundVariable('fontSize', labelSize);
    t.setBoundVariable('fontFamily', labelFont);
    t.fills = [figma.variables.setBoundVariableForPaint({ type:'SOLID', color:{ r:1, g:1, b:1 } }, 'color', labelColor)];
    c.appendChild(t);
    t.layoutSizingHorizontal = 'HUG';
    t.layoutSizingVertical = 'HUG';

    return c;
}

const audio = makeCableComponent('Audio', audioConn);
const control = makeCableComponent('Control', controlConn);
const universal = makeCableComponent('Universal', universalConn);

const set = figma.combineAsVariants([audio, control, universal], page);
set.name = 'Cable';
set.layoutMode = 'VERTICAL';
set.primaryAxisSizingMode = 'AUTO';
set.counterAxisSizingMode = 'AUTO';
set.itemSpacing = 24;
set.paddingTop = 24; set.paddingBottom = 24; set.paddingLeft = 24; set.paddingRight = 24;
set.x = 80;
set.y = 320;

return { ids: [set.id] };