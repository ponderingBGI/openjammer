const page = await figma.getNodeByIdAsync('3:3');
await figma.setCurrentPageAsync(page);
await figma.loadFontAsync({ family: 'Caveat', style: 'Regular' });
await figma.loadFontAsync({ family: 'JetBrains Mono', style: 'Regular' });

const V = async (id) => await figma.variables.getVariableByIdAsync(id);

// --- shared variable ids (VARMAP) ---
const SP_XS = 'VariableID:1:4';
const SP_SM = 'VariableID:1:5';
const SP_MD = 'VariableID:1:6';
const RAD_SM = 'VariableID:1:9';
const TXT_XS = 'VariableID:1:14';
const TXT_SM = 'VariableID:1:15';
const FONT_SKETCH = 'VariableID:1:31'; // (referenced for intent; fontName set directly)
const C_BG_TERTIARY = 'VariableID:2:5';
const C_TEXT_PRIMARY = 'VariableID:2:9';
const C_TEXT_SECONDARY = 'VariableID:2:10';
const C_TEXT_MUTED = 'VariableID:2:11';
const C_TEXT_ON_ACCENT = 'VariableID:2:12';
const C_BORDER_SUBTLE = 'VariableID:2:13';
const C_ACCENT_PRIMARY = 'VariableID:2:19';

// IconBolt svg (leading icon, viewBox 0 0 24 24, stroke currentColor)
const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>';

// Build one MenuItem row variant.
// state: 'Default' | 'Hover' | 'Disabled'
async function buildRow(state) {
    const c = figma.createComponent();
    c.name = `State=${state}`;
    c.layoutMode = 'HORIZONTAL';
    c.primaryAxisSizingMode = 'FIXED';
    c.counterAxisSizingMode = 'AUTO';
    c.counterAxisAlignItems = 'CENTER';
    c.clipsContent = false;

    // padding: space/sm (top/bottom) x space/md (left/right)
    c.setBoundVariable('paddingTop', await V(SP_SM));
    c.setBoundVariable('paddingBottom', await V(SP_SM));
    c.setBoundVariable('paddingLeft', await V(SP_MD));
    c.setBoundVariable('paddingRight', await V(SP_MD));
    c.setBoundVariable('itemSpacing', await V(SP_SM));

    const isHover = state === 'Hover';
    const isDisabled = state === 'Disabled';

    // Row fill: accent on hover, transparent otherwise
    if (isHover) {
        c.fills = [figma.variables.setBoundVariableForPaint(
            { type: 'SOLID', color: { r: 0.5, g: 0.5, b: 0.5 } }, 'color', await V(C_ACCENT_PRIMARY))];
    } else {
        c.fills = [];
    }

    // text/icon color tokens for this state
    const labelColorId = isHover ? C_TEXT_ON_ACCENT : C_TEXT_PRIMARY;
    const iconColorId = isHover ? C_TEXT_ON_ACCENT : C_TEXT_MUTED;

    // --- leading icon (IconBolt) ---
    const iconWrap = figma.createFrame();
    iconWrap.name = 'icon';
    iconWrap.layoutMode = 'HORIZONTAL';
    iconWrap.primaryAxisSizingMode = 'FIXED';
    iconWrap.counterAxisSizingMode = 'FIXED';
    iconWrap.primaryAxisAlignItems = 'CENTER';
    iconWrap.counterAxisAlignItems = 'CENTER';
    iconWrap.fills = [];
    iconWrap.clipsContent = false;
    const svg = figma.createNodeFromSvg(ICON_SVG);
    svg.name = 'IconBolt';
    // recolor every stroked vector to the state's icon color
    const vecPaint = figma.variables.setBoundVariableForPaint(
        { type: 'SOLID', color: { r: 0, g: 0, b: 0 } }, 'color', await V(iconColorId));
    const recolor = (n) => {
        if ('strokes' in n && n.strokes && n.strokes.length) n.strokes = [vecPaint];
        if ('fills' in n && Array.isArray(n.fills) && n.fills.length) n.fills = [vecPaint];
        if ('children' in n) for (const ch of n.children) recolor(ch);
    };
    recolor(svg);
    iconWrap.appendChild(svg);
    c.appendChild(iconWrap);
    iconWrap.resize(14, 14);
    iconWrap.layoutSizingHorizontal = 'FIXED';
    iconWrap.layoutSizingVertical = 'FIXED';

    // --- label (Caveat) ---
    const label = figma.createText();
    label.name = 'label';
    label.fontName = { family: 'Caveat', style: 'Regular' };
    label.characters = 'Oscillator';
    label.setBoundVariable('fontSize', await V(TXT_SM));
    label.fills = [figma.variables.setBoundVariableForPaint(
        { type: 'SOLID', color: { r: 0, g: 0, b: 0 } }, 'color', await V(labelColorId))];
    c.appendChild(label);
    label.layoutSizingVertical = 'HUG';
    label.layoutGrow = 1; // label flex: 1 — pushes the shortcut to the trailing edge
    label.layoutSizingHorizontal = 'FILL';

    // --- shortcut keycap (Kbd, JetBrains Mono) ---
    const kbd = figma.createFrame();
    kbd.name = 'shortcut';
    kbd.layoutMode = 'HORIZONTAL';
    kbd.primaryAxisSizingMode = 'AUTO';
    kbd.counterAxisSizingMode = 'AUTO';
    kbd.primaryAxisAlignItems = 'CENTER';
    kbd.counterAxisAlignItems = 'CENTER';
    kbd.setBoundVariable('paddingTop', await V(SP_XS));
    kbd.setBoundVariable('paddingBottom', await V(SP_XS));
    kbd.setBoundVariable('paddingLeft', await V(SP_SM));
    kbd.setBoundVariable('paddingRight', await V(SP_SM));
    for (const k of ['topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius'])
        kbd.setBoundVariable(k, await V(RAD_SM));
    // Kbd fill: faint bg-tertiary normally; transparent on hover (rides accent)
    if (isHover) {
        kbd.fills = [];
    } else {
        kbd.fills = [figma.variables.setBoundVariableForPaint(
            { type: 'SOLID', color: { r: 0.5, g: 0.5, b: 0.5 } }, 'color', await V(C_BG_TERTIARY))];
    }
    // Kbd border: border-subtle normally; text-on-accent on hover
    const kbdBorderId = isHover ? C_TEXT_ON_ACCENT : C_BORDER_SUBTLE;
    kbd.strokes = [figma.variables.setBoundVariableForPaint(
        { type: 'SOLID', color: { r: 0, g: 0, b: 0 } }, 'color', await V(kbdBorderId))];
    kbd.strokeWeight = 1;

    const kbdText = figma.createText();
    kbdText.name = 'key';
    kbdText.fontName = { family: 'JetBrains Mono', style: 'Regular' };
    kbdText.characters = 'O';
    kbdText.setBoundVariable('fontSize', await V(TXT_XS));
    const kbdTextColorId = isHover ? C_TEXT_ON_ACCENT : C_TEXT_SECONDARY;
    kbdText.fills = [figma.variables.setBoundVariableForPaint(
        { type: 'SOLID', color: { r: 0, g: 0, b: 0 } }, 'color', await V(kbdTextColorId))];
    kbd.appendChild(kbdText);
    kbdText.layoutSizingHorizontal = 'HUG';
    kbdText.layoutSizingVertical = 'HUG';

    c.appendChild(kbd);
    kbd.layoutSizingHorizontal = 'HUG';
    kbd.layoutSizingVertical = 'HUG';

    // Disabled — dimmed whole row.
    if (isDisabled) c.opacity = 0.5;

    // Give the row a defined width so the label FILL + trailing shortcut layout works.
    c.resize(220, c.height);
    return c;
}

const dflt = await buildRow('Default');
const hover = await buildRow('Hover');
const disabled = await buildRow('Disabled');

const set = figma.combineAsVariants([dflt, hover, disabled], page);
set.name = 'MenuItem';
set.layoutMode = 'VERTICAL';
set.primaryAxisSizingMode = 'AUTO';
set.counterAxisSizingMode = 'AUTO';
set.itemSpacing = 8;
set.paddingTop = 8;
set.paddingBottom = 8;
set.paddingLeft = 8;
set.paddingRight = 8;
set.x = 440;
set.y = 800;

return { ids: [set.id] };