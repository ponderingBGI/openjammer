import figma from '@figma/code-connect'
import { Marquee } from './Marquee'

figma.connect(Marquee, 'https://www.figma.com/design/ayHEMsJL1BPhvTYWi1CFJs?node-id=10-9', {
  example: () => (<Marquee />),
})
