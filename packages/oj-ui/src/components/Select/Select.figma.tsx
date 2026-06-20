import figma from '@figma/code-connect'
import { Select } from './Select'

figma.connect(Select, 'https://www.figma.com/design/ayHEMsJL1BPhvTYWi1CFJs?node-id=8-18', {
  example: () => (<Select />),
})
