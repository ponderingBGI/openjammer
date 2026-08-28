import figma from '@figma/code-connect'
import { NodeFrame } from './NodeFrame'
import { NodeShell } from '../NodeShell/NodeShell'

figma.connect(NodeFrame, 'https://www.figma.com/design/ayHEMsJL1BPhvTYWi1CFJs?node-id=14-13', {
  example: () => (
    <NodeFrame position={{ x: 120, y: 80 }}>
      <NodeShell title="Reverb" nodeType="effect">body</NodeShell>
    </NodeFrame>
  ),
})
