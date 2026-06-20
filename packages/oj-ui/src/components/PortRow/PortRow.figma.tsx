import figma from '@figma/code-connect'
import { PortRow } from './PortRow'

figma.connect(PortRow, 'https://www.figma.com/design/ayHEMsJL1BPhvTYWi1CFJs?node-id=13-16', {
  example: () => (<PortRow />),
})
