/**
 * Output Panel Node — the OUTPUTS half of the container boundary.
 *
 * See `PortPanelNode`: one directional component behind both panels.
 */

import { PortPanelNode, type PortPanelNodeProps } from './PortPanelNode';

export function OutputPanelNode(props: PortPanelNodeProps) {
    return <PortPanelNode direction="output" {...props} />;
}
