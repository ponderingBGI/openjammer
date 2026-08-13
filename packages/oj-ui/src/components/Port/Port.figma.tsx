import figma from '@figma/code-connect'
import { Port } from './Port'

figma.connect(Port, 'https://www.figma.com/design/ayHEMsJL1BPhvTYWi1CFJs?node-id=13-9', {
  example: () => (<Port kind="audio" direction="output" />),
})
