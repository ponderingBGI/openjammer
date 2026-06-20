import figma from '@figma/code-connect'
import { Kbd } from './Kbd'

figma.connect(Kbd, 'https://www.figma.com/design/ayHEMsJL1BPhvTYWi1CFJs?node-id=6-4', {
  example: () => (<Kbd>Ctrl</Kbd>),
})
