import figma from '@figma/code-connect'
import { Modal } from './Modal'

figma.connect(Modal, 'https://www.figma.com/design/ayHEMsJL1BPhvTYWi1CFJs?node-id=19-23', {
  example: () => (<Modal />),
})
