const page = await figma.getNodeByIdAsync('3:4'); await figma.setCurrentPageAsync(page);
const V = async (id) => await figma.variables.getVariableByIdAsync(id);

// Build the speaker glyph from the exact Icons.tsx SVG markup (viewBox 0 0 24 24,
// stroke=currentColor, width 2, round caps/joins). One polygon body + two sound-wave arcs.
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>';
const svgFrame = figma.createNodeFromSvg(svg);

const c = figma.createComponent();
c.name = 'IconSpeaker';
c.resize(24, 24);
c.layoutMode = 'NONE';
c.clipsContent = false;
c.fills = [];

// Move the imported svg children into the component, normalize geometry to 24x24,
// and bind every stroke to color/text-primary (the currentColor the icon inherits).
const textPrimary = await V('VariableID:2:9');
if (!textPrimary) throw new Error('color/text-primary variable (VariableID:2:9) not found on this file');
for (const child of [...svgFrame.children]) {
    c.appendChild(child);
}
svgFrame.remove();

const boundIds = [];
const bindStroke = (node) => {
    if ('strokes' in node && node.strokes && node.strokes.length) {
        node.strokes = node.strokes.map((p) =>
            p.type === 'SOLID'
                ? figma.variables.setBoundVariableForPaint(p, 'color', textPrimary)
                : p,
        );
        boundIds.push(node.id);
    }
    if ('children' in node) for (const ch of node.children) bindStroke(ch);
};
for (const child of c.children) bindStroke(child);

c.x = 1520; c.y = 320;
return { ids: [c.id], componentId: c.id, boundStrokeNodeIds: boundIds };