import figma from '@figma/code-connect'
import { Chip } from './Chip'

figma.connect(Chip, 'https://www.figma.com/design/ayHEMsJL1BPhvTYWi1CFJs?node-id=6-2', {
  example: () => (<Chip>Chip</Chip>),
})
