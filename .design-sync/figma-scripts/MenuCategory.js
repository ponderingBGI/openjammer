const page = await figma.getNodeByIdAsync('3:3'); await figma.setCurrentPageAsync(page);
await figma.loadFontAsync({ family:'Caveat', style:'Bold' });
const V = async (id) => await figma.variables.getVariableByIdAsync(id);

// Build one MenuCategory variant. hasIcon controls whether the leading IconBolt glyph is present.
async function buildCategory(name, labelText, hasIcon) {
  const c = figma.createComponent();
  c.name = name;
  c.layoutMode = 'HORIZONTAL';
  c.primaryAxisSizingMode = 'AUTO';
  c.counterAxisSizingMode = 'AUTO';
  c.counterAxisAlignItems = 'CENTER';
  // padding: var(--space-xs) var(--space-md)  -> top/bottom = xs, left/right = md
  c.setBoundVariable('paddingTop', await V('VariableID:1:4'));
  c.setBoundVariable('paddingBottom', await V('VariableID:1:4'));
  c.setBoundVariable('paddingLeft', await V('VariableID:1:6'));
  c.setBoundVariable('paddingRight', await V('VariableID:1:6'));
  // gap: var(--space-xs)
  c.setBoundVariable('itemSpacing', await V('VariableID:1:4'));
  c.fills = []; // category itself is transparent; it rides on the Menu surface

  if (hasIcon) {
    // IconBolt — single polygon, stroke=currentColor (-> text-muted), strokeWidth 2, viewBox 0 0 24 24, rendered at size 14
    const svg = figma.createNodeFromSvg('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>');
    svg.name = 'icon';
    // bind the bolt stroke to color/text-muted
    const muted = await V('VariableID:2:11');
    for (const ch of svg.children) {
      if (ch.strokes && ch.strokes.length) {
        ch.strokes = [figma.variables.setBoundVariableForPaint({ type:'SOLID', color:{ r:0, g:0, b:0 } }, 'color', muted)];
      }
    }
    c.appendChild(svg);
    svg.resize(14, 14);
    svg.layoutSizingHorizontal = 'FIXED';
    svg.layoutSizingVertical = 'FIXED';
  }

  const t = figma.createText();
  t.name = 'label';
  t.fontName = { family:'Caveat', style:'Bold' }; // font-sans (Caveat), bold
  t.characters = labelText;
  t.textCase = 'UPPER'; // text-transform: uppercase
  t.letterSpacing = { value: 4, unit: 'PERCENT' }; // letter-spacing: 0.04em
  t.setBoundVariable('fontSize', await V('VariableID:1:14')); // text/xs
  t.fills = [figma.variables.setBoundVariableForPaint({ type:'SOLID', color:{ r:0, g:0, b:0 } }, 'color', await V('VariableID:2:11'))]; // text-muted
  c.appendChild(t);
  t.layoutSizingHorizontal = 'HUG';
  t.layoutSizingVertical = 'HUG';

  return c;
}

const withIcon = await buildCategory('Has Icon=True', 'Sources', true);
const noIcon = await buildCategory('Has Icon=False', 'Output', false);

const set = figma.combineAsVariants([withIcon, noIcon], page);
set.name = 'MenuCategory';
set.layoutMode = 'VERTICAL';
set.primaryAxisSizingMode = 'AUTO';
set.counterAxisSizingMode = 'AUTO';
set.itemSpacing = 16;
set.paddingTop = 16; set.paddingBottom = 16; set.paddingLeft = 16; set.paddingRight = 16;
set.x = 800; set.y = 800;

return { ids: [set.id] };