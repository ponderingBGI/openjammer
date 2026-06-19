const page = await figma.getNodeByIdAsync('3:3'); await figma.setCurrentPageAsync(page);
const V = async (id) => await figma.variables.getVariableByIdAsync(id);

// Helpers --------------------------------------------------------------
// A Port is a 16px circle (var port/size) with a 2px ink border
// (var border/sketch-width, color sketch-black), filled by a wiring color.
const SIZE = 16;
const makePort = async (variantName, fillId, opts = {}) => {
  const c = figma.createComponent();
  c.name = variantName;
  c.layoutMode = 'NONE';
  c.resize(SIZE, SIZE);
  // circle: pill radius on all corners (port is fully round)
  for (const k of ['topLeftRadius','topRightRadius','bottomLeftRadius','bottomRightRadius']) {
    c.setBoundVariable(k, await V('VariableID:1:13')); // radius/pill
  }
  // fill
  if (Array.isArray(fillId)) {
    // gradient fallback for universal (rainbow-until-typed) — represented statically.
    // A single color variable cannot bind a multi-stop gradient, so this fill is
    // intentionally exempt from the bind-everything rule.
    c.fills = [{
      type: 'GRADIENT_LINEAR',
      gradientTransform: [[0.707, 0.707, -0.207], [-0.707, 0.707, 0.5]],
      gradientStops: [
        { position: 0, color: { r: 1, g: 0.42, b: 0.42, a: 1 } },
        { position: 0.25, color: { r: 1, g: 0.902, b: 0.427, a: 1 } },
        { position: 0.5, color: { r: 0.306, g: 0.796, b: 0.443, a: 1 } },
        { position: 0.75, color: { r: 0.302, g: 0.722, b: 1, a: 1 } },
        { position: 1, color: { r: 0.608, g: 0.349, b: 0.714, a: 1 } },
      ],
    }];
  } else {
    c.fills = [figma.variables.setBoundVariableForPaint({ type: 'SOLID', color: { r: 0.5, g: 0.5, b: 0.5 } }, 'color', await V(fillId))];
  }
  // 2px ink border, bound
  c.strokes = [figma.variables.setBoundVariableForPaint({ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }, 'color', await V('VariableID:2:16'))]; // sketch-black
  c.setBoundVariable('strokeWeight', await V('VariableID:1:24')); // border/sketch-width
  // dashed slot for placeholder
  if (opts.dashed) { c.dashPattern = [3, 3]; c.opacity = 0.4; }
  // connected / active soft glow — the one sanctioned glow (live connection = meaning)
  if (opts.glow) {
    c.effects = [{ type: 'DROP_SHADOW', color: opts.glow, offset: { x: 0, y: 0 }, radius: opts.glowRadius || 8, spread: 0, visible: true, blendMode: 'NORMAL' }];
  }
  return c;
};

// Variants — mirror the two preview rows (Kinds + States) ----------------
const comps = [];
// Kinds row: resting ports per wiring color
comps.push(await makePort('kind=Audio, state=Default',     'VariableID:2:25'));                                  // audio-output
comps.push(await makePort('kind=Control, state=Default',   'VariableID:2:29'));                                  // control-output
comps.push(await makePort('kind=Universal, state=Default', ['gradient']));                                       // universal rainbow-until-typed
// States row: connected (glow), active control (green pulse), dashed placeholder
comps.push(await makePort('kind=Audio, state=Connected',   'VariableID:2:27', { glow: { r: 0.302, g: 0.722, b: 1, a: 0.8 }, glowRadius: 8 }));   // audio-connected
comps.push(await makePort('kind=Control, state=Connected', 'VariableID:2:31', { glow: { r: 0.55, g: 0.55, b: 0.6, a: 0.8 }, glowRadius: 8 }));   // control-connected
comps.push(await makePort('kind=Control, state=Active',    'VariableID:2:21', { glow: { r: 0.306, g: 0.796, b: 0.443, a: 0.85 }, glowRadius: 10 })); // accent-success firing
comps.push(await makePort('kind=Universal, state=Placeholder', ['gradient'], { dashed: true }));                 // dashed add-a-port slot

// Lay out variants in a grid before combining (keeps the set tidy)
const COLS = 4, GAP = 32;
comps.forEach((c, i) => { c.x = (i % COLS) * GAP; c.y = Math.floor(i / COLS) * GAP; });

const set = figma.combineAsVariants(comps, page);
set.name = 'Port';
set.layoutMode = 'HORIZONTAL';
set.layoutWrap = 'WRAP';
set.primaryAxisSizingMode = 'AUTO';
set.counterAxisSizingMode = 'AUTO';
set.itemSpacing = GAP - SIZE;
set.counterAxisSpacing = GAP - SIZE;
// padding bound via variable (no hardcoded px) — spacing/lg
const padVar = await V('VariableID:1:30');
for (const k of ['paddingTop','paddingBottom','paddingLeft','paddingRight']) {
  set.setBoundVariable(k, padVar);
}
set.x = 80; set.y = 80;

return { ids: [set.id] };