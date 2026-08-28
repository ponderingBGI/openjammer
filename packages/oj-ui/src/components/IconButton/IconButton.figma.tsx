import figma from '@figma/code-connect'
import { IconButton } from './IconButton'
import { IconClose } from '../Icons/Icons'

figma.connect(IconButton, 'https://www.figma.com/design/ayHEMsJL1BPhvTYWi1CFJs?node-id=21-16', {
  example: () => (<IconButton label="Close" icon={<IconClose />} />),
})
