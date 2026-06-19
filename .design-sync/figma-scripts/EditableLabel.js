const page = await figma.getNodeByIdAsync('3:3'); await figma.setCurrentPageAsync(page);
await figma.loadFontAsync({ family:'Caveat', style:'Regular' });
const V = async (id) => await figma.variables.getVariableByIdAsync(id);

// ---- Variant 1: Resting (the hand-drawn name, transparent border, hover/click target) ----
const rest = figma.createComponent();
rest.name = 'State=Resting';
rest.layoutMode = 'HORIZONTAL';
rest.primaryAxisSizingMode = 'AUTO';
rest.counterAxisSizingMode = 'AUTO';
rest.counterAxisAlignItems = 'CENTER';
rest.setBoundVariable('paddingTop', await V('VariableID:1:4'));      // space/xs
rest.setBoundVariable('paddingBottom', await V('VariableID:1:4'));   // space/xs
rest.setBoundVariable('paddingLeft', await V('VariableID:1:5'));     // space/sm
rest.setBoundVariable('paddingRight', await V('VariableID:1:5'));    // space/sm
for (const k of ['topLeftRadius','topRightRadius','bottomLeftRadius','bottomRightRadius']) rest.setBoundVariable(k, await V('VariableID:1:9')); // radius/sm
// border: var(--border-sketch-width) solid transparent — keep transparent stroke, bound weight
rest.strokes = [{ type:'SOLID', color:{r:0,g:0,b:0}, opacity:0 }];
rest.setBoundVariable('strokeWeight', await V('VariableID:1:24')); // border/sketch-width
rest.fills = [];
const restText = figma.createText();
restText.fontName = { family:'Caveat', style:'Regular' };
restText.characters = 'Reverb Bus';
restText.setBoundVariable('fontSize', await V('VariableID:1:16')); // text/md
restText.fills = [figma.variables.setBoundVariableForPaint({ type:'SOLID', color:{r:0,g:0,b:0} }, 'color', await V('VariableID:2:9'))]; // text/primary
rest.appendChild(restText);
restText.layoutSizingHorizontal = 'HUG';
restText.layoutSizingVertical = 'HUG';

// ---- Variant 2: Editing (the Input primitive seeded with the name, accent border, paper fill) ----
const edit = figma.createComponent();
edit.name = 'State=Editing';
edit.layoutMode = 'HORIZONTAL';
edit.primaryAxisSizingMode = 'AUTO';
edit.counterAxisSizingMode = 'AUTO';
edit.counterAxisAlignItems = 'CENTER';
edit.setBoundVariable('paddingTop', await V('VariableID:1:4'));      // space/xs
edit.setBoundVariable('paddingBottom', await V('VariableID:1:4'));   // space/xs
edit.setBoundVariable('paddingLeft', await V('VariableID:1:5'));     // space/sm
edit.setBoundVariable('paddingRight', await V('VariableID:1:5'));    // space/sm
for (const k of ['topLeftRadius','topRightRadius','bottomLeftRadius','bottomRightRadius']) edit.setBoundVariable(k, await V('VariableID:1:9')); // radius/sm
edit.fills = [figma.variables.setBoundVariableForPaint({ type:'SOLID', color:{r:1,g:1,b:1} }, 'color', await V('VariableID:2:6'))]; // bg/canvas (paper)
edit.strokes = [figma.variables.setBoundVariableForPaint({ type:'SOLID', color:{r:0.5,g:0.5,b:0.9} }, 'color', await V('VariableID:2:19'))]; // accent/primary (focus border)
edit.setBoundVariable('strokeWeight', await V('VariableID:1:24')); // border/sketch-width
const editText = figma.createText();
editText.fontName = { family:'Caveat', style:'Regular' }; // EditableLabel.css overrides Input mono → font/sketch
editText.characters = 'Reverb Bus';
editText.setBoundVariable('fontSize', await V('VariableID:1:16')); // text/md
editText.fills = [figma.variables.setBoundVariableForPaint({ type:'SOLID', color:{r:0,g:0,b:0} }, 'color', await V('VariableID:2:9'))]; // text/primary
edit.appendChild(editText);
editText.layoutSizingHorizontal = 'HUG';
editText.layoutSizingVertical = 'HUG';

// ---- Combine into a COMPONENT_SET on the State axis ----
const set = figma.combineAsVariants([rest, edit], page);
set.name = 'EditableLabel';
set.layoutMode = 'VERTICAL';
set.primaryAxisSizingMode = 'AUTO';
set.counterAxisSizingMode = 'AUTO';
set.itemSpacing = 24;
set.paddingTop = 24; set.paddingBottom = 24; set.paddingLeft = 24; set.paddingRight = 24;
set.x = 1160; set.y = 560;
return { ids: [set.id] };