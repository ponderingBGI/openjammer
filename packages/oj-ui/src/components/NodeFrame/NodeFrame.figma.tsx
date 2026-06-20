import figma from '@figma/code-connect'
import { NodeFrame } from './NodeFrame'

figma.connect(NodeFrame, 'https://www.figma.com/design/ayHEMsJL1BPhvTYWi1CFJs?node-id=14-13', {
  example: () => (<NodeFrame />),
})
