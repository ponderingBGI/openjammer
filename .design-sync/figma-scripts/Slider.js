const page = await figma.getNodeByIdAsync('3:2');
await figma.setCurrentPageAsync(page);

const V = async (id) => await figma.variables.getVariableByIdAsync(id);
const RADII = ['topLeftRadius','topRightRadius','bottomLeftRadius','bottomRightRadius'];

const WIDTH = 240;        // fixed track geometry (px) — sliders fill their row in real use
const FILL_RATIO = 0.5;   // representative value at 50%
const TRACK_H = 4;        // space-xs
const THUMB = 16;         // space-md
const ROW_H = THUMB;      // root height = thumb diameter
const trackY = (ROW_H - TRACK_H) / 2; // center the thin rail on the row

// Root — non-auto-layout so the thumb can overlap the rail (a slider isn't a stack)
const c = figma.createComponent();
c.name = 'Slider';
c.resize(WIDTH, ROW_H);
c.fills = []; // transparent track background per .oj-slider

// Rail (full track) — bg-tertiary fill, sketch-light ink border, pill radius
const rail = figma.createRectangle();
rail.name = 'track';
rail.resize(WIDTH, TRACK_H);
rail.x = 0;
rail.y = trackY;
rail.fills = [figma.variables.setBoundVariableForPaint({ type:'SOLID', color:{ r:0.5, g:0.5, b:0.5 } }, 'color', await V('VariableID:2:5'))]; // color/bg-tertiary
rail.strokes = [figma.variables.setBoundVariableForPaint({ type:'SOLID', color:{ r:0.8, g:0.8, b:0.8 } }, 'color', await V('VariableID:2:18'))]; // color/sketch-light
rail.setBoundVariable('strokeWeight', await V('VariableID:1:24')); // border/sketch-width
for (const k of RADII) rail.setBoundVariable(k, await V('VariableID:1:13')); // radius/pill
c.appendChild(rail);

// Filled portion — sketch-light fill, pill radius
const fill = figma.createRectangle();
fill.name = 'fill';
fill.resize(Math.round(WIDTH * FILL_RATIO), TRACK_H);
fill.x = 0;
fill.y = trackY;
fill.fills = [figma.variables.setBoundVariableForPaint({ type:'SOLID', color:{ r:0.8, g:0.8, b:0.8 } }, 'color', await V('VariableID:2:18'))]; // color/sketch-light
for (const k of RADII) fill.setBoundVariable(k, await V('VariableID:1:13')); // radius/pill
c.appendChild(fill);

// Thumb — accent-primary disc, 2px sketch-black ink border, pill radius
const thumb = figma.createEllipse();
thumb.name = 'thumb';
thumb.resize(THUMB, THUMB);
thumb.x = Math.round(WIDTH * FILL_RATIO) - THUMB / 2; // center on the fill edge (the value)
thumb.y = 0;
thumb.fills = [figma.variables.setBoundVariableForPaint({ type:'SOLID', color:{ r:1, g:0.5, b:0.2 } }, 'color', await V('VariableID:2:19'))]; // color/accent-primary
thumb.strokes = [figma.variables.setBoundVariableForPaint({ type:'SOLID', color:{ r:0, g:0, b:0 } }, 'color', await V('VariableID:2:16'))]; // color/sketch-black
thumb.setBoundVariable('strokeWeight', await V('VariableID:1:24')); // border/sketch-width
c.appendChild(thumb);

c.x = 1520;
c.y = 520;

return { ids: [c.id, rail.id, fill.id, thumb.id] };