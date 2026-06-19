import figma from '@figma/code-connect'
import { EditableLabel } from './EditableLabel'

figma.connect(EditableLabel, 'https://www.figma.com/design/ayHEMsJL1BPhvTYWi1CFJs?node-id=21-46', {
  example: () => (<EditableLabel />),
})
