const page = await figma.getNodeByIdAsync('3:4');
await figma.setCurrentPageAsync(page);

const V = async (id) => await figma.variables.getVariableByIdAsync(id);

// IconMute: square 24x24 glyph (viewBox 0 0 24 24), stroke=currentColor, strokeWidth 2,
// round caps/joins. A speaker polygon + an X (two crossed lines). Inherits color via
// currentColor -> bound to color/text-primary (the default --text-primary in previews).
const svg = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>';
const svgNode = figma.createNodeFromSvg(svg);

// Recolor every vector's stroke to bound color/text-primary (the currentColor source).
const textPrimary = await V('VariableID:2:9');
const recolor = (node) => {
    if ('strokes' in node && node.strokes && node.strokes.length) {
        node.strokes = node.strokes.map((p) =>
            p.type === 'SOLID'
                ? figma.variables.setBoundVariableForPaint({ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }, 'color', textPrimary)
                : p,
        );
    }
    if ('children' in node) for (const ch of node.children) recolor(ch);
};
recolor(svgNode);

// Wrap the imported SVG group in a COMPONENT sized 24x24 (default IconProps size).
const c = figma.createComponent();
c.name = 'IconMute';
c.layoutMode = 'NONE';
c.fills = [];
c.clipsContent = false;
c.appendChild(svgNode);
c.resize(24, 24);
// Fit the imported SVG to the 24x24 slot (idiomatic over rescale(1), and robust
// even if createNodeFromSvg ever returns a differently-sized node).
svgNode.resize(24, 24);
svgNode.x = 0;
svgNode.y = 0;
c.x = 1160;
c.y = 320;

return { ids: [c.id] };