import figma from '@figma/code-connect'
import { NodeShell } from './NodeShell'

figma.connect(NodeShell, 'https://www.figma.com/design/ayHEMsJL1BPhvTYWi1CFJs?node-id=14-2', {
  example: () => (<NodeShell />),
})
