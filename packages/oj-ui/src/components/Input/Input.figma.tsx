import figma from '@figma/code-connect'
import { Input } from './Input'

figma.connect(Input, 'https://www.figma.com/design/ayHEMsJL1BPhvTYWi1CFJs?node-id=8-10', {
  example: () => (<Input />),
})
