import figma from '@figma/code-connect'
import { Surface } from './Surface'

figma.connect(Surface, 'https://www.figma.com/design/ayHEMsJL1BPhvTYWi1CFJs?node-id=10-8', {
  example: () => (<Surface>Content</Surface>),
})
