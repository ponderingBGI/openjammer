const page = await figma.getNodeByIdAsync('3:3'); await figma.setCurrentPageAsync(page);
await figma.loadFontAsync({ family: 'Caveat', style: 'Regular' });
await figma.loadFontAsync({ family: 'Caveat', style: 'Bold' });
const V = async (id) => await figma.variables.getVariableByIdAsync(id);

// Helper to bind a SOLID paint fill to a color variable.
const paint = async (id) => figma.variables.setBoundVariableForPaint({ type: 'SOLID', color: { r: 0.5, g: 0.5, b: 0.5 } }, 'color', await V(id));

// ---- The Modal component: a full-viewport scrim wrapping a lifted Surface panel.
const c = figma.createComponent();
c.name = 'Modal';
c.layoutMode = 'VERTICAL';
c.primaryAxisSizingMode = 'FIXED';
c.counterAxisSizingMode = 'FIXED';
// Scrim aligns the panel center horizontally, top vertically (representative center-ish render with scrim padding visible).
c.primaryAxisAlignItems = 'CENTER';
c.counterAxisAlignItems = 'CENTER';
// Scrim padding = space/lg on all sides (the .oj-modal__scrim padding).
for (const k of ['paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight']) c.setBoundVariable(k, await V('VariableID:1:7'));
// Scrim wash = overlay/scrim (no blur — Hard-Shadow Rule).
c.fills = [await paint('VariableID:1:40')];

// ---- The panel: a lifted Surface (bg-node fill, 2px ink border, radius-lg, hard offset shadow).
const panel = figma.createFrame();
panel.name = 'panel';
panel.layoutMode = 'VERTICAL';
panel.primaryAxisSizingMode = 'AUTO';
panel.counterAxisSizingMode = 'FIXED';
// Panel content padding = space/lg (the preview panelStyle), gap = space/md.
for (const k of ['paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight']) panel.setBoundVariable(k, await V('VariableID:1:7'));
panel.setBoundVariable('itemSpacing', await V('VariableID:1:6'));
// Radius-lg corners.
for (const k of ['topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius']) panel.setBoundVariable(k, await V('VariableID:1:11'));
// Surface fill = bg-node, ink border = sketch-black @ border/sketch-width.
panel.fills = [await paint('VariableID:2:4')];
panel.strokes = [await paint('VariableID:2:16')];
panel.setBoundVariable('strokeWeight', await V('VariableID:1:24'));
panel.strokeAlign = 'INSIDE';
// Hard (blur-free) lifted shadow: 4px 5px 0 in the ink color. Effect colors are not variable-bindable in the API, so use the resolved sketch-black ink (#1A1A1A).
panel.effects = [{ type: 'DROP_SHADOW', color: { r: 0.102, g: 0.102, b: 0.102, a: 1 }, offset: { x: 4, y: 5 }, radius: 0, spread: 0, visible: true, blendMode: 'NORMAL' }];

// ---- Append panel to the scrim FIRST so all subsequent layoutSizing='FILL' calls have a settled auto-layout ancestry.
c.appendChild(panel);

// ---- Panel body text (sketch font paragraph from the Default preview).
const body = figma.createText();
body.fontName = { family: 'Caveat', style: 'Regular' };
body.characters = 'Escape, a scrim click, or the button below all close this.';
body.setBoundVariable('fontSize', await V('VariableID:1:16'));
body.fills = [await paint('VariableID:2:9')];
panel.appendChild(body);
body.layoutSizingHorizontal = 'FILL';
body.layoutSizingVertical = 'HUG';

// ---- Right-aligned button row (Cancel + Confirm) with space/sm gap.
const row = figma.createFrame();
row.name = 'actions';
row.layoutMode = 'HORIZONTAL';
row.primaryAxisSizingMode = 'FIXED';
row.counterAxisSizingMode = 'AUTO';
row.primaryAxisAlignItems = 'MAX'; // justify-content: flex-end
row.counterAxisAlignItems = 'CENTER';
row.setBoundVariable('itemSpacing', await V('VariableID:1:5'));
row.fills = [];
panel.appendChild(row);
row.layoutSizingHorizontal = 'FILL';
row.layoutSizingVertical = 'HUG';

// Reusable button builder mirroring oj-btn: padding xs/sm, radius-md, 2px ink border, Caveat label.
const mkButton = async (label, primary) => {
    const b = figma.createFrame();
    b.name = primary ? 'Button/primary' : 'Button';
    b.layoutMode = 'HORIZONTAL';
    b.primaryAxisSizingMode = 'AUTO';
    b.counterAxisSizingMode = 'AUTO';
    b.primaryAxisAlignItems = 'CENTER';
    b.counterAxisAlignItems = 'CENTER';
    b.setBoundVariable('paddingTop', await V('VariableID:1:4'));
    b.setBoundVariable('paddingBottom', await V('VariableID:1:4'));
    b.setBoundVariable('paddingLeft', await V('VariableID:1:5'));
    b.setBoundVariable('paddingRight', await V('VariableID:1:5'));
    for (const k of ['topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius']) b.setBoundVariable(k, await V('VariableID:1:10'));
    b.fills = [await paint(primary ? 'VariableID:2:19' : 'VariableID:2:4')];
    b.strokes = [await paint('VariableID:2:16')];
    b.setBoundVariable('strokeWeight', await V('VariableID:1:24'));
    b.strokeAlign = 'INSIDE';
    const t = figma.createText();
    t.fontName = { family: 'Caveat', style: 'Bold' };
    t.characters = label;
    t.setBoundVariable('fontSize', await V('VariableID:1:15'));
    t.fills = [await paint(primary ? 'VariableID:2:12' : 'VariableID:2:9')];
    b.appendChild(t);
    t.layoutSizingHorizontal = 'HUG';
    t.layoutSizingVertical = 'HUG';
    return b;
};

const cancel = await mkButton('Cancel', false);
const confirm = await mkButton('Confirm', true);
row.appendChild(cancel);
row.appendChild(confirm);
cancel.layoutSizingHorizontal = 'HUG';
cancel.layoutSizingVertical = 'HUG';
confirm.layoutSizingHorizontal = 'HUG';
confirm.layoutSizingVertical = 'HUG';

// ---- Fix the scrim geometry and the panel md width step.
c.resize(560, 360); // scrim viewport area (geometry only)
panel.layoutSizingHorizontal = 'FIXED';
panel.resize(440, panel.height); // size=md ceiling (~32.5rem) within the scrim padding
panel.layoutSizingVertical = 'HUG';

c.x = 1520; c.y = 320;
return { ids: [c.id] };