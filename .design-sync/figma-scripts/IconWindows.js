const page = await figma.getNodeByIdAsync('3:4'); await figma.setCurrentPageAsync(page);
const V = async (id) => await figma.variables.getVariableByIdAsync(id);

// Build the Windows mark from its source SVG (24x24 viewBox, filled paths, no stroke).
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="#000000" stroke="none"><path d="M3 5.5 10.5 4.4V11.4H3V5.5Z"/><path d="M12 4.2 21 3V11.4H12V4.2Z"/><path d="M3 12.6H10.5V19.6L3 18.5V12.6Z"/><path d="M12 12.6H21V21L12 19.8V12.6Z"/></svg>';
const svgNode = figma.createNodeFromSvg(svg);
svgNode.name = 'glyph';

// Bind every vector fill (the currentColor paths) to color/text-primary.
const textPrimary = await V('VariableID:2:9');
const bindVectorFills = (node) => {
    if ('fills' in node && Array.isArray(node.fills) && node.fills.length) {
        node.fills = node.fills.map((p) =>
            p.type === 'SOLID'
                ? figma.variables.setBoundVariableForPaint({ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }, 'color', textPrimary)
                : p
        );
    }
    if ('children' in node) for (const child of node.children) bindVectorFills(child);
};
bindVectorFills(svgNode);

// Component wrapper sized to the canonical 24px UI icon, glyph stretched to fill.
const c = figma.createComponent();
c.name = 'IconWindows';
c.layoutMode = 'HORIZONTAL';
c.primaryAxisSizingMode = 'FIXED';
c.counterAxisSizingMode = 'FIXED';
c.primaryAxisAlignItems = 'CENTER';
c.counterAxisAlignItems = 'CENTER';
c.fills = [];
c.clipsContent = false;
c.appendChild(svgNode);
c.resize(24, 24);
svgNode.constraints = { horizontal: 'STRETCH', vertical: 'STRETCH' };
svgNode.layoutSizingHorizontal = 'FILL';
svgNode.layoutSizingVertical = 'FILL';

c.x = 440; c.y = 560;
return { ids: [c.id, svgNode.id] };