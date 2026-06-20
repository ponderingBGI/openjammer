import figma from '@figma/code-connect'
import { StatusDot } from './StatusDot'

figma.connect(StatusDot, 'https://www.figma.com/design/ayHEMsJL1BPhvTYWi1CFJs?node-id=6-6', {
  example: () => (<StatusDot />),
})
