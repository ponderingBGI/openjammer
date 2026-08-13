import figma from '@figma/code-connect'
import { Textarea } from './Textarea'

figma.connect(Textarea, 'https://www.figma.com/design/ayHEMsJL1BPhvTYWi1CFJs?node-id=8-17', {
  example: () => (<Textarea />),
})
