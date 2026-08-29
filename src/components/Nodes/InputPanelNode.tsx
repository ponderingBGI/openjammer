/**
 * Input Panel Node — the INPUTS half of the container boundary.
 *
 * The panel itself is `PortPanelNode`: input and output panels are the same
 * object seen from two sides, and they used to be two 250-line files that had
 * already drifted (only this one knew about bundles). This module exists so the
 * node type keeps its own name at the NodeWrapper switch.
 */

import { PortPanelNode, type PortPanelNodeProps } from './PortPanelNode';

export function InputPanelNode(props: PortPanelNodeProps) {
    return <PortPanelNode direction="input" {...props} />;
}
