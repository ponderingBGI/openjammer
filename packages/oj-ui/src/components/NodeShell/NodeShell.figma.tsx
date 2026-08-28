import figma from '@figma/code-connect'
import { NodeShell } from './NodeShell'
import { PortRow } from '../PortRow/PortRow'

figma.connect(NodeShell, 'https://www.figma.com/design/ayHEMsJL1BPhvTYWi1CFJs?node-id=14-2', {
  example: () => (
    <NodeShell
      title="Reverb"
      nodeType="effect"
      inputs={<PortRow side="input" kind="audio" label="In" connected />}
      outputs={<PortRow side="output" kind="audio" label="Out" />}
    >
      body
    </NodeShell>
  ),
})
