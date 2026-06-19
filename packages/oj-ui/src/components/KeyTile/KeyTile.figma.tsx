import figma from '@figma/code-connect'
import { KeyTile } from './KeyTile'

figma.connect(KeyTile, 'https://www.figma.com/design/ayHEMsJL1BPhvTYWi1CFJs?node-id=15-14', {
  example: () => (<KeyTile />),
})
