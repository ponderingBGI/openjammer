import figma from '@figma/code-connect'
import { Swatch } from './Swatch'

figma.connect(Swatch, 'https://www.figma.com/design/ayHEMsJL1BPhvTYWi1CFJs?node-id=6-10', {
  example: () => (<Swatch />),
})
