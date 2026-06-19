import figma from '@figma/code-connect'
import { OffscreenPointer } from './OffscreenPointer'

figma.connect(OffscreenPointer, 'https://www.figma.com/design/ayHEMsJL1BPhvTYWi1CFJs?node-id=10-10', {
  example: () => (<OffscreenPointer />),
})
