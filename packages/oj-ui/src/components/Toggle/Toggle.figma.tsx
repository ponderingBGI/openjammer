import figma from '@figma/code-connect'
import { Toggle } from './Toggle'

figma.connect(Toggle, 'https://www.figma.com/design/ayHEMsJL1BPhvTYWi1CFJs?node-id=9-17', {
  example: () => (<Toggle />),
})
